import {
  AppSettings,
  CustomSlotsMap,
  MAX_CHARS_PER_INSTRUCTOR,
  SlotObservation,
  TidePoint,
  ValidationDayRecord,
  ValidationItem,
  ValidationsMap,
  WindPoint,
} from '../types';
import { AgendaBookingItem, DataAuditSignOffMap, DataAuditEntrySignOff } from './firebaseSync';
import {
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  getValidationItemChars,
  isNoBookingsReason,
  isNotPublishedCycle1,
  normalizeClosureReason,
} from './cycleHelpers';
import { dayFocus, kOf, lc, tdy, win } from './tides';

const normT = (v?: string): string => (v || '').trim().replace('h', ':');

export type AuditSeverity = 'ok' | 'warning' | 'conflict';

export interface AuditIssue {
  code: string;
  level: 'warning' | 'conflict';
  label: string;
  detail: string;
}

export interface ComputedSlotMatch {
  slotKey: string;
  startTime: string;
  endTime: string;
  opt: boolean;
  over: number;
  lim: string;
  customTitle?: string;
  isExactKeyMatch: boolean;
}

export interface AuditSlotEntry {
  entryKey: string; // `${ds}__${slotKey}`
  ds: string;
  slotKey: string;
  startTime: string;
  endTime: string;
  displayTime: string;
  valRecord?: ValidationDayRecord;
  valItem?: ValidationItem;
  obs?: SlotObservation;
  bookings: AgendaBookingItem[];
  bookingSummary: {
    totalChars: number;
    mono: number;
    bi: number;
    people: number;
    bookingsCount: number;
  };
  computedMatch?: ComputedSlotMatch;
  severity: AuditSeverity;
  issues: AuditIssue[];
  signOff?: DataAuditEntrySignOff;
  isVerified: boolean;
  summaryStatusLabel: string;
}

export interface DataAuditReport {
  entries: AuditSlotEntry[];
  totalCount: number;
  conflictCount: number;
  warningCount: number;
  okCount: number;
  verifiedCount: number;
  unverifiedCount: number;
  daysAnalyzed: number;
}

export const buildDataAuditReport = ({
  validations,
  observations,
  bookingsMap,
  customSlotsMap,
  auditMap,
  settings,
  EX,
  windList,
}: {
  validations: ValidationsMap;
  observations: SlotObservation[];
  bookingsMap: Record<string, AgendaBookingItem[]>;
  customSlotsMap: CustomSlotsMap;
  auditMap: DataAuditSignOffMap;
  settings: AppSettings;
  EX: TidePoint[];
  windList: WindPoint[];
}): DataAuditReport => {
  const todayStr = tdy();
  const isRealMode = settings.calculationMode === 'reel';
  const empiricalOffsetM = isRealMode ? ((settings.empiricalOffsetCm ?? 15) / 100) : 0;
  const effectiveThreshold = settings.L + empiricalOffsetM - (settings.mg || 0) / 100;
  const tideW = EX.length > 0 ? win(EX, effectiveThreshold) : [];
  const first = EX[0]?.t ?? 0;
  const last = EX[EX.length - 1]?.t ?? 0;

  // Regrouper toutes les observations par date
  const obsByDate: Record<string, SlotObservation[]> = {};
  observations.forEach(obs => {
    if (!obs.ds) return;
    if (!obsByDate[obs.ds]) obsByDate[obs.ds] = [];
    obsByDate[obs.ds].push(obs);
  });

  // Regrouper toutes les clés de réservation par date (`${ds}_${slotKey}`)
  const bookingsByDate: Record<string, Array<{ slotKey: string; items: AgendaBookingItem[] }>> = {};
  Object.entries(bookingsMap).forEach(([resKey, items]) => {
    if (!items || items.length === 0) return;
    const sepIdx = resKey.indexOf('_');
    if (sepIdx <= 0) return;
    const ds = resKey.slice(0, sepIdx);
    const slotKey = resKey.slice(sepIdx + 1);
    if (!bookingsByDate[ds]) bookingsByDate[ds] = [];
    bookingsByDate[ds].push({ slotKey, items });
  });

  // Toutes les dates ayant au moins une donnée stockée
  const allDates = new Set<string>([
    ...Object.keys(validations),
    ...Object.keys(obsByDate),
    ...Object.keys(bookingsByDate),
  ]);

  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));
  const entries: AuditSlotEntry[] = [];

  for (const ds of sortedDates) {
    const valRecord = validations[ds];
    const dayValItems = valRecord?.items || [];
    const dayObsList = obsByDate[ds] || [];
    const dayBookingsList = bookingsByDate[ds] || [];

    // Calcul des créneaux théoriques du jour pour repérer d'éventuelles clés orphelines
    const computedSlots: ComputedSlotMatch[] = [];
    if (EX.length > 0 && ds.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const df = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
      df.list.forEach(sess => {
        computedSlots.push({
          slotKey: kOf(sess),
          startTime: lc(sess.a, df.y, df.m, df.d),
          endTime: lc(sess.b, df.y, df.m, df.d),
          opt: sess.opt,
          over: sess.over,
          lim: sess.lim,
          customTitle: sess.customTitle,
          isExactKeyMatch: false,
        });
      });
    }

    // Construire la table des clés uniques de créneau pour la journée
    const slotKeysOrder: string[] = [];
    const pushKey = (k: string) => {
      if (k && !slotKeysOrder.includes(k)) slotKeysOrder.push(k);
    };

    dayValItems.forEach(it => pushKey(it.k));
    dayObsList.forEach(obs => {
      // Rattacher à un valItem existant même si clé légèrement différente mais mêmes heures (10h00 / 10:00)
      const byKey = dayValItems.find(it => it.k === obs.slotKey);
      if (byKey) {
        pushKey(byKey.k);
      } else {
        const obsStartN = normT(obs.slotStart);
        const obsEndN = normT(obs.slotEnd);
        const byTime = dayValItems.find(
          it =>
            (normT(it.publishedStart || it.s) === obsStartN &&
              normT(it.publishedEnd || it.e) === obsEndN) ||
            (Boolean(it.actualStart) &&
              Boolean(it.actualEnd) &&
              normT(it.actualStart) === obsStartN &&
              normT(it.actualEnd) === obsEndN)
        );
        if (byTime) pushKey(byTime.k);
        else pushKey(obs.slotKey);
      }
    });
    dayBookingsList.forEach(b => pushKey(b.slotKey));

    for (const slotKey of slotKeysOrder) {
      const valItem = dayValItems.find(it => it.k === slotKey);
      const valStart = valItem?.actualStart || valItem?.publishedStart || valItem?.s || '';
      const valEnd = valItem?.actualEnd || valItem?.publishedEnd || valItem?.e || '';

      const obs =
        dayObsList.find(o => o.slotKey === slotKey) ||
        (valItem
          ? dayObsList.find(
              o =>
                (normT(o.slotStart) === normT(valItem.publishedStart || valItem.s) &&
                  normT(o.slotEnd) === normT(valItem.publishedEnd || valItem.e)) ||
                (Boolean(valItem.actualStart) &&
                  Boolean(valItem.actualEnd) &&
                  normT(o.slotStart) === normT(valItem.actualStart) &&
                  normT(o.slotEnd) === normT(valItem.actualEnd))
            )
          : undefined);

      const bookingEntry = dayBookingsList.find(b => b.slotKey === slotKey);
      const bookings = bookingEntry?.items || [];
      const rawBookingSummary = getSlotBookingsSummary(bookings);
      const bookingSummary = {
        totalChars: rawBookingSummary.totalChars,
        mono: rawBookingSummary.monoCount,
        bi: rawBookingSummary.biCount,
        people: rawBookingSummary.totalPeople,
        bookingsCount: rawBookingSummary.bookingsCount,
      };

      const startTime = valStart || obs?.slotStart || '??h??';
      const endTime = valEnd || obs?.slotEnd || '??h??';
      const displayTime = `${startTime} – ${endTime}`;

      // Recherche d'une correspondance dans les créneaux calculés du jour
      const exactComp = computedSlots.find(c => c.slotKey === slotKey);
      const timeComp = !exactComp
        ? computedSlots.find(
            c =>
              normT(c.startTime) === normT(valItem?.publishedStart || valItem?.s || obs?.slotStart) &&
              normT(c.endTime) === normT(valItem?.publishedEnd || valItem?.e || obs?.slotEnd)
          )
        : undefined;
      const computedMatch = exactComp
        ? { ...exactComp, isExactKeyMatch: true }
        : timeComp
        ? { ...timeComp, isExactKeyMatch: false }
        : undefined;

      const issues: AuditIssue[] = [];

      // 1. Donnée REX ou réservation orpheline sans enregistrement Cycle 1 / Cycle 2 dans validations[ds]
      if (!valItem) {
        if (obs) {
          issues.push({
            code: 'missing_validation_for_obs',
            level: 'conflict',
            label: 'REX sans fiche Cycle 1 / Cycle 2',
            detail:
              'Un relevé terrain / REX existe pour ce créneau mais aucune ligne Cycle 1 / Cycle 2 n’est enregistrée dans validations.',
          });
        }
        if (bookingSummary.totalChars > 0) {
          issues.push({
            code: 'missing_validation_for_bookings',
            level: 'conflict',
            label: 'Réservations sur créneau non validé',
            detail: `${bookingSummary.totalChars} char(s) inscrit(s) alors que le créneau est absent du registre Cycle 1/2.`,
          });
        }
      }

      if (valItem) {
        const c1 = getEffectiveCycle1Status(valItem);
        const c2 = getEffectiveCycle2Status(valItem, bookingSummary.totalChars);
        const valChars = getValidationItemChars(valItem);

        // 2. Ancien format pré-Cycle 1/2 sans cycle1Status explicite
        if (!valItem.cycle1Status) {
          issues.push({
            code: 'legacy_missing_c1_status',
            level: 'warning',
            label: 'Format hérité (sans cycle1Status)',
            detail:
              'Enregistrement antérieur à la séparation Cycle 1 / Cycle 2 : statut Cycle 1 déduit automatiquement mais non écrit explicitement.',
          });
        }

        // 3. Créneau passé resté en "À publier (awaiting_booking)" sans statut final (Réalisé / Annulé Météo / Pas d'inscrits / Hors offre)
        if (
          ds < todayStr &&
          c1 === 'published' &&
          c2 === 'awaiting_booking' &&
          !obs
        ) {
          issues.push({
            code: 'past_slot_unfinished',
            level: 'warning',
            label: 'Créneau passé sans statut final',
            detail:
              'Date passée restée en « À publier (C1) » sans indication Séance effectuée, Annulé Météo (Vie 2), Pas d’inscrits (Vie 2) ou Hors offre.',
          });
        }

        // 4. Motif de fermeture générique ("Fermé", "Ferme", etc.)
        if (c1 === 'excluded') {
          // Créneau volontairement écarté hors offre : aucun motif perso requis
        } else if (c1 === 'not_published' || isNotPublishedCycle1(valItem)) {
          const rawReason =
            valItem.nonPublishReason ||
            valItem.rejectReason?.replace(/^Non publié\s*\(C1\)\s*:\s*/i, '') ||
            '';
          const norm = normalizeClosureReason(rawReason);
          if (!rawReason.trim() || norm.isGenericClosed) {
            issues.push({
              code: 'generic_closure_reason',
              level: 'warning',
              label: 'Motif de fermeture générique (« Fermé »)',
              detail: `Motif actuel : « ${rawReason || 'Non précisé'} ». À préciser en Réunion, Impératif personnel, Vacances…`,
            });
          }
        } else if (valItem.status === 'rejected' && c1 !== 'closed_no_bookings' && c2 !== 'cancelled_weather' && c2 !== 'merged') {
          const norm = normalizeClosureReason(valItem.rejectReason);
          if (!valItem.rejectReason || norm.isGenericClosed) {
            issues.push({
              code: 'ambiguous_rejection',
              level: 'conflict',
              label: 'Statut rejeté ambigu',
              detail: `Rejeté avec motif « ${valItem.rejectReason || 'vide'} » sans savoir si c’est Cycle 1 (motif perso / Hors offre) ou Vie 2 (pas d’inscrits / météo).`,
            });
          }
        }

        // 5. Réservations actives sur un créneau fermé en Cycle 1 ou annulé Pas d'inscrits (Vie 2)
        if (
          bookingSummary.totalChars > 0 &&
          (c1 === 'not_published' || c1 === 'excluded' || c1 === 'closed_no_bookings')
        ) {
          issues.push({
            code: 'bookings_on_closed_slot',
            level: 'conflict',
            label: 'Inscrits présents sur créneau fermé',
            detail: `${bookingSummary.totalChars} char(s) dans la fiche réservations alors que le créneau est marqué « ${
              c1 === 'excluded'
                ? 'Hors offre (C1)'
                : c1 === 'not_published'
                ? 'À ne pas publier (C1)'
                : "Pas d'inscrits (Vie 2)"
            } ».`,
          });
        }

        // 6. Contradiction entre Validation (C1/C2) et Observation REX
        if (obs) {
          const valIsCancelled =
            valItem.status === 'rejected' ||
            c1 === 'not_published' ||
            c1 === 'excluded' ||
            c1 === 'closed_no_bookings' ||
            c2 === 'cancelled_weather';
          if (obs.status === 'cancelled' && !valIsCancelled && c2 !== 'merged') {
            issues.push({
              code: 'obs_cancelled_val_valid',
              level: 'conflict',
              label: 'Contradiction REX (Annulé) vs Validation (Valide)',
              detail:
                'L’observation REX indique une séance annulée, mais la fiche Cycle 1/2 indique un créneau actif / publié.',
            });
          } else if (obs.status === 'realized' && valIsCancelled) {
            issues.push({
              code: 'obs_realized_val_rejected',
              level: 'conflict',
              label: 'Contradiction REX (Réalisé) vs Validation (Fermé / Annulé)',
              detail:
                'L’observation REX indique une séance réalisée, mais la fiche Cycle 1/2 indique un créneau fermé, hors offre ou annulé.',
            });
          }

          // Écart de chars entre Validation et REX sur séance réalisée
          if (obs.status === 'realized' && !valIsCancelled) {
            const obsChars =
              obs.charsCount ??
              ((obs.monoCount ?? 0) + (obs.biCount ?? 0) > 0
                ? (obs.monoCount ?? 0) + (obs.biCount ?? 0)
                : 0);
            if (obsChars > 0 && valChars.totalChars > 0 && obsChars !== valChars.totalChars) {
              issues.push({
                code: 'chars_mismatch_val_obs',
                level: 'warning',
                label: `Écart de chars (C2 : ${valChars.totalChars} vs REX : ${obsChars})`,
                detail: 'Le nombre de chars diffère entre Cycle 2 et le REX terrain.',
              });
            }
          }

          // Vérification cohérence cause d'annulation Pas d'inscrits (Vie 2) / Hors offre / C1 non publié / Vie 2 Météo
          if (obs.status === 'cancelled') {
            const obsIsNoClients = obs.cancellationReason === 'no_clients';
            const obsIsInstructor = obs.cancellationReason === 'instructor';
            const obsIsHorsOffre =
              obs.cancellationReason === 'other' &&
              ((obs.cancellationNote || '').toLowerCase().includes('hors offre') ||
                (obs.cancellationNote || '').toLowerCase().includes('non pertinent'));
            if (c1 === 'excluded' && !obsIsHorsOffre && obs.cancellationReason !== 'other') {
              issues.push({
                code: 'reason_mismatch_excluded',
                level: 'conflict',
                label: 'REX non aligné avec « Hors offre (C1) »',
                detail: `Cycle 1 indique « ➖ Hors offre / Non pertinent » mais le REX indique « ${obs.cancellationReason} ».`,
              });
            } else if (c1 === 'closed_no_bookings' && !obsIsNoClients) {
              issues.push({
                code: 'reason_mismatch_vie2_noclient',
                level: 'conflict',
                label: "Cause REX différente de « Pas d'inscrits (Vie 2) »",
                detail: `La fiche indique « Pas d’inscrits (Vie 2) » mais le REX indique « ${obs.cancellationReason} ».`,
              });
            } else if (c1 === 'not_published' && !obsIsInstructor) {
              issues.push({
                code: 'reason_mismatch_c1',
                level: 'conflict',
                label: 'Cause REX différente de Cycle 1 non publié',
                detail: `Cycle 1 indique « À ne pas publier » (motif perso/école) mais le REX indique « ${obs.cancellationReason} ».`,
              });
            } else if (c2 === 'cancelled_weather' && (obsIsNoClients || obsIsInstructor)) {
              issues.push({
                code: 'reason_mismatch_vie2',
                level: 'conflict',
                label: 'Cause REX incohérente avec Annulation Météo (Vie 2)',
                detail: `Cycle 2 indique « Annulé météo (Vie 2) » mais le REX indique « ${obs.cancellationReason} ».`,
              });
            }
          }

          if (obs.secondaryInstructor && !valItem.secondaryInstructor) {
            issues.push({
              code: 'secondary_instructor_missing_in_val',
              level: 'warning',
              label: `2e moniteur REX (${obs.secondaryInstructor}) absent de C2`,
              detail: `Le REX mentionne « ${obs.secondaryInstructor} » en 2e moniteur mais il n’est pas enregistré sur la fiche Cycle 2.`,
            });
          }
        }

        // 7. Séance marquée Réalisée avec 0 char et 0 participant
        if (c2 === 'realized' && valChars.totalChars === 0 && (valItem.pilotsCount ?? 0) === 0 && !obs?.charsCount && !obs?.participantsCount) {
          issues.push({
            code: 'realized_without_chars',
            level: 'warning',
            label: 'Séance effectuée avec 0 char renseigné',
            detail: 'Précisez le nombre de chars (mono / bi) ou basculez en « Pas d’inscrits (Vie 2) » s’il n’y avait aucun pilote.',
          });
        }

        // 8. Contrôle capacité & 2e moniteur (12 / 20 CQP / 24 DE)
        if (c1 === 'published' && c2 !== 'cancelled_weather' && c2 !== 'merged') {
          const maxCap = getSlotMaxCapacity(valItem);
          const activeChars = Math.max(valChars.totalChars, bookingSummary.totalChars);
          if (activeChars > maxCap) {
            issues.push({
              code: 'chars_over_capacity',
              level: 'warning',
              label: `Capacité dépassée (${activeChars}/${maxCap} chars)`,
              detail: valItem.secondaryInstructor
                ? `Le créneau dépasse le plafond de ${maxCap} chars (${valItem.instructor || 'Jérôme'} + ${valItem.secondaryInstructor}).`
                : `Plus de ${MAX_CHARS_PER_INSTRUCTOR} chars sans 2e moniteur renseigné (Youenn CQP +8 → 20 max, Katleen +12 → 24 max).`,
            });
          }
        }
      }

      // 9. Observation REX annulée avec motif générique « Fermé »
      if (obs && obs.status === 'cancelled' && obs.cancellationReason === 'instructor') {
        const normObs = normalizeClosureReason(obs.cancellationNote);
        if (!obs.cancellationNote?.trim() || normObs.isGenericClosed) {
          issues.push({
            code: 'obs_generic_closure',
            level: 'warning',
            label: 'REX fermé sans motif détaillé',
            detail: `Note REX : « ${obs.cancellationNote || 'vide'} ». À préciser (Réunion, Impératif personnel, Vacances…).`,
          });
        }
      }

      // 10. Clé de créneau non retrouvée dans le calcul du jour (dérive d'horaire ou de seuil)
      if (computedSlots.length > 0 && !computedMatch?.isExactKeyMatch) {
        issues.push({
          code: 'slot_key_drift',
          level: computedMatch ? 'warning' : 'conflict',
          label: computedMatch
            ? `Clé créneau décalée (même horaire ${computedMatch.startTime}–${computedMatch.endTime} trouvé)`
            : 'Clé créneau introuvable dans la grille actuelle du jour',
          detail: computedMatch
            ? `Ancienne clé « ${slotKey} » → correspond au créneau actuel « ${computedMatch.slotKey} ». Réalignable en 1 clic.`
            : `La clé « ${slotKey} » ne correspond à aucun créneau calculé ce jour-là (seuil marée ou réglages différents à l’époque).`,
        });
      }

      const hasConflict = issues.some(i => i.level === 'conflict');
      const hasWarning = issues.some(i => i.level === 'warning');
      const severity: AuditSeverity = hasConflict ? 'conflict' : hasWarning ? 'warning' : 'ok';

      const entryKey = `${ds}__${slotKey}`;
      const signOff = auditMap[entryKey];
      const isVerified = Boolean(signOff?.verified);

      // Libellé lisible du statut actuel
      let summaryStatusLabel = 'Non défini';
      if (valItem) {
        const c1 = getEffectiveCycle1Status(valItem);
        const c2 = getEffectiveCycle2Status(valItem, bookingSummary.totalChars);
        if (c1 === 'excluded') {
          summaryStatusLabel = '➖ C1 Hors offre (exclu des stats)';
        } else if (c1 === 'not_published') {
          summaryStatusLabel = `🚫 C1 Non publié (${valItem.nonPublishReason || valItem.rejectReason || 'motif à préciser'})`;
        } else if (c1 === 'closed_no_bookings' || isNoBookingsReason(valItem.rejectReason)) {
          summaryStatusLabel = "⛔ Vie 2 · Pas d'inscrits";
        } else if (c2 === 'cancelled_weather') {
          summaryStatusLabel = `⛔ Vie 2 · Annulé météo (${valItem.rejectReason || 'météo'})`;
        } else if (c2 === 'merged') {
          summaryStatusLabel = `🔗 Regroupé → ${valItem.mergedLabel || valItem.mergedIntoKey || ''}`;
        } else if (c2 === 'shifted') {
          summaryStatusLabel = `🕒 C2 Décalé (${valItem.actualStart || startTime})`;
        } else if (c2 === 'realized') {
          summaryStatusLabel = '🏁 C2 Séance effectuée';
        } else if (c2 === 'confirmed') {
          summaryStatusLabel = '⚡ C2 Actif (inscrits confirmés)';
        } else {
          summaryStatusLabel = '📅 C1 À publier (en attente suite)';
        }
      } else if (obs) {
        const noteLow = (obs.cancellationNote || '').toLowerCase();
        if (obs.status === 'realized') {
          summaryStatusLabel = '📝 REX Réalisé (sans C1/C2)';
        } else if (noteLow.includes('hors offre') || noteLow.includes('non pertinent')) {
          summaryStatusLabel = '➖ REX Hors offre (sans C1/C2)';
        } else if (obs.cancellationReason === 'no_clients') {
          summaryStatusLabel = "📝 REX Pas d'inscrits Vie 2 (sans C1/C2)";
        } else {
          summaryStatusLabel = '📝 REX Annulé (sans C1/C2)';
        }
      }

      entries.push({
        entryKey,
        ds,
        slotKey,
        startTime,
        endTime,
        displayTime,
        valRecord,
        valItem,
        obs,
        bookings,
        bookingSummary,
        computedMatch,
        severity,
        issues,
        signOff,
        isVerified,
        summaryStatusLabel,
      });
    }
  }

  return {
    entries,
    totalCount: entries.length,
    conflictCount: entries.filter(e => e.severity === 'conflict').length,
    warningCount: entries.filter(e => e.severity === 'warning').length,
    okCount: entries.filter(e => e.severity === 'ok').length,
    verifiedCount: entries.filter(e => e.isVerified).length,
    unverifiedCount: entries.filter(e => !e.isVerified).length,
    daysAnalyzed: sortedDates.length,
  };
};
