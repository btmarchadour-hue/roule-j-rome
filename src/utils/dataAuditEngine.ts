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
  getObservationChars,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  getValidationItemChars,
  hasRecordedShift,
  isNoBookingsReason,
  isNotPublishedCycle1,
  normalizeClosureReason,
} from './cycleHelpers';
import { dayFocus, kOf, lc, tdy, win } from './tides';

const normT = (v?: string): string => (v || '').trim().replace('h', ':');
const parseMinutes = (v?: string): number | null => {
  const clean = normT(v);
  if (!clean.includes(':')) return null;
  const [h, m] = clean.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

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

export const formatObsReasonFr = (reason?: string): string => {
  switch (reason) {
    case 'wind_low':
      return 'Vent insuffisant';
    case 'wind_high':
      return 'Vent trop fort / rafales';
    case 'wind_dir':
      return 'Mauvais secteur / déventé';
    case 'no_clients':
      return 'Manque d’inscrits (Vie 2)';
    case 'beach_state':
      return 'État de la plage / bâches';
    case 'weather_extreme':
      return 'Orage / météo extrême';
    case 'instructor':
      return 'Fermeture école / moniteur';
    case 'other':
      return 'Autre / Hors offre';
    default:
      return reason || 'non précisé';
  }
};

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
    const dayEntries: AuditSlotEntry[] = [];

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

      // Recherche d'une correspondance dans les créneaux calculés du jour (horaire publié OU horaire réel ajusté)
      const exactComp = computedSlots.find(c => c.slotKey === slotKey);
      const timeComp = !exactComp
        ? computedSlots.find(
            c =>
              (normT(c.startTime) === normT(valItem?.publishedStart || valItem?.s || obs?.slotStart) &&
                normT(c.endTime) === normT(valItem?.publishedEnd || valItem?.e || obs?.slotEnd)) ||
              (Boolean(valItem?.actualStart) &&
                Boolean(valItem?.actualEnd) &&
                normT(c.startTime) === normT(valItem?.actualStart) &&
                normT(c.endTime) === normT(valItem?.actualEnd))
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
            label: 'Bilan REX présent sans fiche planning Cycle 1 / Cycle 2',
            detail:
              'Un bilan terrain (REX) a été saisi pour ce créneau, mais aucune décision Cycle 1/2 n’est enregistrée en face. Clique « ✏️ Corriger » pour l’aligner (ex. Effectuée, Pas d’inscrits ou Hors offre).',
          });
        }
        if (bookingSummary.totalChars > 0) {
          issues.push({
            code: 'missing_validation_for_bookings',
            level: 'conflict',
            label: 'Pilotes inscrits sans fiche Cycle 1 / Cycle 2',
            detail: `${bookingSummary.totalChars} char(s) inscrit(s) alors que le créneau n’apparaît pas encore dans les décisions Cycle 1/2. À confirmer pour que la séance compte dans le bilan.`,
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
            label: 'Ancien enregistrement (avant la règle Cycle 1 / Cycle 2)',
            detail:
              'Créneau saisi avant la séparation Offre commerciale (C1) / Terrain (C2). L’outil devine son statut, mais clique « ✅ Valider » si c’est juste ou « ✏️ Corriger » pour le classer proprement.',
          });
        }

        // 3. Créneau passé resté en attente ou confirmé sans bilan final
        if (
          ds < todayStr &&
          c1 === 'published' &&
          (c2 === 'awaiting_booking' || c2 === 'confirmed' || c2 === 'shifted') &&
          !obs
        ) {
          issues.push({
            code: 'past_slot_unfinished',
            level: 'warning',
            label:
              c2 === 'awaiting_booking'
                ? 'Séance passée restée « En attente » sans bilan final'
                : 'Séance passée restée active sans bilan final',
            detail:
              'Cette date est déjà passée mais la séance n’a pas encore été clôturée en « Effectuée », « Annulée météo », « Pas d’inscrits » ou « Hors offre » (ou rattrape-la via le Bilan Express ◀ Jour préc.).',
          });
        }

        const isLegacyGenericRejection =
          valItem.status === 'rejected' &&
          !valItem.cycle1Status &&
          !valItem.cycle2Status &&
          normalizeClosureReason(valItem.rejectReason).isGenericClosed;

        // 4. Motif de fermeture générique ("Fermé", "Refusé", etc.)
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
              label: 'Ancien motif « Fermé » trop vague (à préciser)',
              detail: `Motif actuel : « ${rawReason || 'Non précisé'} ». Précise s’il s’agit de Vacances, Réunion, Impératif personnel, ou « Hors offre » afin de ne pas fausser les stats.`,
            });
          }
        } else if (isLegacyGenericRejection && !obs) {
          issues.push({
            code: 'ambiguous_rejection',
            level: 'warning',
            label: `Ancien « ${valItem.rejectReason || 'Refusé / Fermé'} » sans précision`,
            detail: `Créneau marqué « ${valItem.rejectReason || 'vide'} » avant la règle Cycle 1/2 : clique « ✏️ Corriger / Aligner » pour préciser s’il s’agissait d’un manque d’inscrits, de la météo, d’une fermeture école ou d’un créneau hors offre.`,
          });
        } else if (valItem.status === 'rejected' && c1 !== 'closed_no_bookings' && c2 !== 'cancelled_weather' && c2 !== 'merged') {
          const norm = normalizeClosureReason(valItem.rejectReason);
          if (!valItem.rejectReason || norm.isGenericClosed) {
            issues.push({
              code: 'ambiguous_rejection',
              level: 'conflict',
              label: 'Fermeture ambiguë : offre école, clients ou météo ?',
              detail: `Marqué fermé (« ${valItem.rejectReason || 'vide'} ») sans savoir s’il n’a jamais été mis en vente (Cycle 1), s’il n’y a eu aucun inscrit (Vie 2) ou s’il a été annulé pour météo.`,
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
            label: 'Inscrits présents sur un créneau pourtant marqué fermé',
            detail: `${bookingSummary.totalChars} char(s) inscrit(s) sur la fiche alors que le créneau indique « ${
              c1 === 'excluded'
                ? 'Hors offre (C1)'
                : c1 === 'not_published'
                ? 'À ne pas publier (C1)'
                : "Pas d'inscrits (Vie 2)"
            } ». Vérifie s’il a bien roulé ou s’il faut corriger ce statut.`,
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
              label: 'Contradiction : REX « Annulé » mais Planning « Actif »',
              detail:
                'Le bilan final (REX) dit que la séance a été annulée, mais la fiche planning est restée ouverte/active. Clique « ✏️ Corriger » pour trancher la vérité sur les deux écrans.',
            });
          } else if (obs.status === 'realized' && valIsCancelled) {
            issues.push({
              code: 'obs_realized_val_rejected',
              level: 'conflict',
              label: 'Contradiction : REX « Effectué » mais Planning « Fermé / Annulé »',
              detail:
                'Le bilan final (REX) indique que la séance a bien roulé, mais la fiche planning est restée fermée, hors offre ou annulée. Clique « ✏️ Corriger » pour la passer en effectuée.',
            });
          }

          // Écart de chars entre Validation et REX sur séance réalisée
          if (obs.status === 'realized' && !valIsCancelled) {
            const obsChars = getObservationChars(obs);
            if (obsChars > 0 && valChars.totalChars > 0 && obsChars !== valChars.totalChars) {
              issues.push({
                code: 'chars_mismatch_val_obs',
                level: 'warning',
                label: `Nombre de chars différent (Planning : ${valChars.totalChars} vs REX : ${obsChars})`,
                detail: 'Le nombre de chars saisi en séance et au bilan final ne correspond pas. Uniformise le bon chiffre pour que le taux de remplissage soit exact.',
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
            const obsReasonLabel = formatObsReasonFr(obs.cancellationReason);

            const hasBookedClientsForCancel =
              bookingSummary.totalChars > 0 || (obs.bookedParticipantsCount ?? 0) > 0;

            if (c1 === 'excluded' && !obsIsHorsOffre && obs.cancellationReason !== 'other') {
              issues.push({
                code: 'reason_mismatch_excluded',
                level: 'conflict',
                label: 'Motif REX différent du planning « Hors offre (C1) »',
                detail: `Le planning indique « ➖ Hors offre / Non pertinent », mais le REX indique « ${obsReasonLabel} ». Aligne les deux en cliquant « ✏️ Corriger ».`,
              });
            } else if (c1 === 'closed_no_bookings' && !obsIsNoClients) {
              issues.push({
                code: 'reason_mismatch_vie2_noclient',
                level: 'conflict',
                label: "Motif REX différent de « Pas d'inscrits (Vie 2) »",
                detail: `Le planning indique « Pas d’inscrits (Vie 2) », mais le REX indique « ${obsReasonLabel} ». Aligne la vraie cause.`,
              });
            } else if (c1 === 'not_published' && !obsIsInstructor) {
              issues.push({
                code: 'reason_mismatch_c1',
                level: 'conflict',
                label: 'Motif REX différent d’une fermeture école (Cycle 1)',
                detail: `Le planning indique « À ne pas publier » (motif perso/école), mais le REX indique « ${obsReasonLabel} ». Aligne la vraie cause.`,
              });
            } else if (
              c2 === 'cancelled_weather' &&
              (obsIsNoClients || (obsIsInstructor && !hasBookedClientsForCancel) || obsIsHorsOffre)
            ) {
              if (isLegacyGenericRejection) {
                issues.push({
                  code: 'legacy_rejection_to_align_with_rex',
                  level: 'warning',
                  label: `Ancien « ${valItem.rejectReason || 'Refusé'} » à aligner sur le REX (« ${obsIsHorsOffre ? 'Hors offre' : obsReasonLabel} »)`,
                  detail: `L’ancienne fiche planning indiquait simplement « ${valItem.rejectReason || 'Refusé'} » sans préciser la cause (avant la règle Cycle 1/2), alors que le REX précise déjà « ${obsIsHorsOffre ? 'Hors offre' : obsReasonLabel} ». Clique « ✏️ Corriger / Aligner » puis enregistre (la cause du REX est pré-sélectionnée).`,
                });
              } else {
                issues.push({
                  code: 'reason_mismatch_vie2',
                  level: 'conflict',
                  label: 'Motif REX incohérent avec Annulation Météo',
                  detail: `Le planning indique « Annulé météo », mais le REX indique « ${obsIsHorsOffre ? 'Hors offre' : obsReasonLabel} ». Choisis la vraie cause entre météo, manque d’inscrits, fermeture école ou hors offre.`,
                });
              }
            }
          }

          if (obs.secondaryInstructor && !valItem.secondaryInstructor) {
            issues.push({
              code: 'secondary_instructor_missing_in_val',
              level: 'warning',
              label: `2e moniteur REX (${obs.secondaryInstructor}) oublié sur le planning`,
              detail: `Le REX mentionne « ${obs.secondaryInstructor} » en renfort, mais pas la fiche du jour. Ajoute-le pour compter la bonne capacité (20 ou 24 chars).`,
            });
          }
        }

        // 7. Séance marquée Réalisée avec 0 char et 0 participant
        const obsTotalChars = getObservationChars(obs);
        if (c2 === 'realized' && valChars.totalChars === 0 && (valItem.pilotsCount ?? 0) === 0 && obsTotalChars === 0 && !obs?.participantsCount) {
          issues.push({
            code: 'realized_without_chars',
            level: 'warning',
            label: 'Séance notée « Effectuée » avec 0 char saisi',
            detail: 'Précise combien de chars ont roulé (mono / bi) ou bascule le créneau en « Annulée · Pas d’inscrits » s’il n’y avait aucun pilote.',
          });
        }

        // 7b. Écart entre dossiers d'inscriptions clients et compteur chars saisi sur séance active/réalisée
        if (
          c1 === 'published' &&
          bookingSummary.totalChars > 0 &&
          (c2 === 'realized' || c2 === 'confirmed' || c2 === 'shifted') &&
          valChars.totalChars !== bookingSummary.totalChars
        ) {
          issues.push({
            code: 'bookings_count_mismatch',
            level: 'warning',
            label: `Écart inscrits (${bookingSummary.totalChars} char(s) inscrits vs ${valChars.totalChars} sur la fiche)`,
            detail: `Les inscriptions clients comptent ${bookingSummary.totalChars} char(s), alors que la fiche planning affiche ${valChars.totalChars}. Aligne le nombre réel de chars qui ont roulé ou sont inscrits.`,
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

      // 9. Observation REX annulée avec motif générique « Fermé » ou « Autre » vide
      if (obs && obs.status === 'cancelled' && (obs.cancellationReason === 'instructor' || obs.cancellationReason === 'other')) {
        const noteLow = (obs.cancellationNote || '').toLowerCase();
        const isHorsOffreNote = noteLow.includes('hors offre') || noteLow.includes('non pertinent');
        const normObs = normalizeClosureReason(obs.cancellationNote);
        if (!isHorsOffreNote && (!obs.cancellationNote?.trim() || normObs.isGenericClosed)) {
          issues.push({
            code: 'obs_generic_closure',
            level: 'warning',
            label: 'Bilan REX fermé sans motif détaillé',
            detail: `Note REX : « ${obs.cancellationNote || 'vide'} ». Précise la raison (Réunion, Impératif personnel, Vacances, ou Hors offre).`,
          });
        }
      }

      // 10. Clé de créneau non retrouvée dans le calcul du jour (modification manuelle d'horaire ou dérive marée)
      const isAlreadyExcluded =
        (valItem ? getEffectiveCycle1Status(valItem) === 'excluded' : false) ||
        Boolean(obs && obs.status === 'cancelled' && (obs.cancellationNote || '').toLowerCase().includes('hors offre'));
      const normStart = normT(startTime);
      const [startH, startM] = normStart.split(':').map(Number);
      const startMinutes = !Number.isNaN(startH) && !Number.isNaN(startM) ? startH * 60 + startM : null;
      const isBefore09h = startMinutes !== null && startMinutes < 9 * 60;

      const dayCustomCfg = customSlotsMap[ds];
      const hasDayCustomOverride = Boolean(dayCustomCfg && dayCustomCfg.slots.length > 0);
      const isManualAdjustedEntry =
        hasDayCustomOverride ||
        slotKey.endsWith('c') ||
        Boolean(valItem?.customTitle) ||
        Boolean(obs?.isCustom) ||
        valItem?.cycle2Status === 'shifted' ||
        Boolean(valItem?.actualStart);

      const nearbyComp =
        !computedMatch && startMinutes !== null
          ? computedSlots.find(c => {
              const [ch, cm] = normT(c.startTime).split(':').map(Number);
              if (Number.isNaN(ch) || Number.isNaN(cm)) return false;
              return Math.abs(ch * 60 + cm - startMinutes) <= 120;
            })
          : undefined;

      const hasExplicitManualShiftMemorized =
        hasRecordedShift(valItem) &&
        Boolean(valItem?.actualStart) &&
        Boolean(valItem?.actualEnd) &&
        (Boolean(computedMatch) || hasDayCustomOverride);

      if (
        computedSlots.length > 0 &&
        !computedMatch?.isExactKeyMatch &&
        !isAlreadyExcluded &&
        !hasExplicitManualShiftMemorized
      ) {
        issues.push({
          code: 'slot_key_drift',
          level: 'warning',
          label: computedMatch
            ? `Même horaire (${computedMatch.startTime}–${computedMatch.endTime}) sous une ancienne référence`
            : isManualAdjustedEntry
            ? 'Début de séance modifié manuellement par le moniteur'
            : isBefore09h
            ? 'Créneau d’avant 09h00 (ancienne règle de l’école)'
            : 'Horaire différent de la grille automatique actuelle',
          detail: computedMatch
            ? `Ce créneau existe toujours aux mêmes heures (${computedMatch.startTime}–${computedMatch.endTime}), seule sa référence interne a changé. Clique « ✏️ Corriger / Aligner » puis enregistre (la case de réalignement est déjà cochée).`
            : isManualAdjustedEntry
            ? `Le début ou l’horaire de cette séance a été modifié manuellement (boutons -15/+15 min, « Ajuster », décalage ou créneau sur mesure${
                nearbyComp ? ` · horaire actuel du jour : ${nearbyComp.startTime}–${nearbyComp.endTime}` : ''
              }). • Si c’est bien l’horaire voulu par Jérôme : clique simplement « ✅ Valider ». • Si c’est l’ancien horaire resté en double après la modification : passe-le en « Hors offre » ou supprime l’ancien.`
            : isBefore09h
            ? `Ce créneau démarrait avant 09h00 (ancien calcul automatique, ou horaire avancé manuellement à l’époque). Si la séance a vraiment existé, garde-la en cliquant « ✅ Valider ». Sinon, clique « ✏️ Corriger / Aligner » → « Hors offre » (ou supprime-la si c’était un essai).`
            : `Deux explications possibles : soit Jérôme a modifié manuellement l’heure de début ce jour-là (décalage / sur-mesure), soit tes réglages de marée actuels (seuil, mode Réel/Théorique ou tolérance) ne donnent plus exactement cet horaire${
                nearbyComp ? ` (aujourd’hui l’appli propose ${nearbyComp.startTime}–${nearbyComp.endTime})` : ''
              }. • Si la séance a bien existé à cet horaire : garde-la et clique simplement « ✅ Valider ». • Si c’était un ancien horaire en double ou jamais validé pour la réservation chez le futur prestataire : clique « ✏️ Corriger / Aligner » → « Hors offre » (ou supprime l’ancien).`,
        });
      }

      const hasConflict = issues.some(i => i.level === 'conflict');
      const hasWarning = issues.some(i => i.level === 'warning');
      const severity: AuditSeverity = hasConflict ? 'conflict' : hasWarning ? 'warning' : 'ok';

      const entryKey = `${ds}__${slotKey}`;
      const signOff = auditMap[entryKey];
      const isVerified = !hasConflict && Boolean(signOff?.verified);

      // Libellé lisible du statut actuel
      let summaryStatusLabel = 'Non défini';
      if (valItem) {
        const c1 = getEffectiveCycle1Status(valItem);
        const c2 = getEffectiveCycle2Status(valItem, bookingSummary.totalChars);
        const itemHasShift = hasRecordedShift(valItem);
        const shiftSuffix = itemHasShift
          ? ` · décalée ${valItem.actualStart || startTime}–${valItem.actualEnd || endTime} (C1 : ${valItem.publishedStart || valItem.s})`
          : '';
        if (c1 === 'excluded') {
          summaryStatusLabel = '➖ Hors offre (exclu des stats)';
        } else if (c1 === 'not_published') {
          summaryStatusLabel = `🚫 École fermée · Non publié (${valItem.nonPublishReason || valItem.rejectReason || 'motif à préciser'})`;
        } else if (c1 === 'closed_no_bookings' || isNoBookingsReason(valItem.rejectReason)) {
          summaryStatusLabel = "👥 Annulée · Pas d'inscrits";
        } else if (
          valItem.status === 'rejected' &&
          !valItem.cycle1Status &&
          !valItem.cycle2Status &&
          normalizeClosureReason(valItem.rejectReason).isGenericClosed
        ) {
          summaryStatusLabel = `⛔ Ancien refus / fermeture (« ${valItem.rejectReason || 'sans motif'} » — à classer)`;
        } else if (c2 === 'cancelled_weather') {
          summaryStatusLabel =
            obs?.cancellationReason === 'instructor'
              ? `⛔ Annulée · Indisponibilité moniteur (${obs.cancellationNote || valItem.rejectReason || 'moniteur'})`
              : `⛔ Annulée · Météo / Plage (${valItem.rejectReason || 'météo'})`;
        } else if (c2 === 'merged') {
          summaryStatusLabel = `🔗 Regroupé → ${valItem.mergedLabel || valItem.mergedIntoKey || ''}`;
        } else if (c2 === 'shifted') {
          summaryStatusLabel = `🕒 Séance décalée ${valItem.actualStart || startTime}–${valItem.actualEnd || endTime} (C1 : ${valItem.publishedStart || valItem.s})`;
        } else if (c2 === 'realized') {
          summaryStatusLabel = `🏁 Séance effectuée${shiftSuffix}`;
        } else if (c2 === 'confirmed') {
          summaryStatusLabel = `⚡ Séance active (inscrits confirmés)${shiftSuffix}`;
        } else {
          summaryStatusLabel = '📅 Ouvert (en attente de suite)';
        }
      } else if (obs) {
        const noteLow = (obs.cancellationNote || '').toLowerCase();
        if (obs.status === 'realized') {
          summaryStatusLabel = '📝 Bilan REX : Effectuée (sans fiche planning)';
        } else if (noteLow.includes('hors offre') || noteLow.includes('non pertinent')) {
          summaryStatusLabel = '➖ Bilan REX : Hors offre (sans fiche planning)';
        } else if (obs.cancellationReason === 'no_clients') {
          summaryStatusLabel = "📝 Bilan REX : Pas d'inscrits (sans fiche planning)";
        } else {
          summaryStatusLabel = '📝 Bilan REX : Annulée (sans fiche planning)';
        }
      }

      dayEntries.push({
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

    // Détection des créneaux actifs qui se chevauchent sur la même journée (souvent un ancien horaire resté en doublon après décalage)
    const activeTimeEntries = dayEntries.filter(e => {
      const c1 = e.valItem ? getEffectiveCycle1Status(e.valItem) : undefined;
      const c2 = e.valItem ? getEffectiveCycle2Status(e.valItem, e.bookingSummary.totalChars) : undefined;
      const isExcludedObs =
        !e.valItem &&
        Boolean(e.obs && e.obs.status === 'cancelled' && (e.obs.cancellationNote || '').toLowerCase().includes('hors offre'));
      return c1 !== 'excluded' && c2 !== 'merged' && !isExcludedObs;
    });

    for (let i = 0; i < activeTimeEntries.length; i++) {
      const a = activeTimeEntries[i];
      const aStart = parseMinutes(a.startTime);
      const aEnd = parseMinutes(a.endTime);
      if (aStart === null || aEnd === null || aEnd <= aStart) continue;

      for (let j = i + 1; j < activeTimeEntries.length; j++) {
        const b = activeTimeEntries[j];
        const bStart = parseMinutes(b.startTime);
        const bEnd = parseMinutes(b.endTime);
        if (bStart === null || bEnd === null || bEnd <= bStart) continue;

        if (aStart < bEnd && bStart < aEnd) {
          const isExactSameTime = aStart === bStart && aEnd === bEnd;
          const addOverlapIssue = (target: AuditSlotEntry, other: AuditSlotEntry) => {
            if (target.issues.some(iss => iss.code === 'overlapping_slots')) return;
            target.issues.push({
              code: 'overlapping_slots',
              level: isExactSameTime ? 'conflict' : 'warning',
              label: isExactSameTime
                ? `Doublon exact avec un autre créneau (${other.displayTime})`
                : `Chevauchement horaire avec ${other.displayTime}`,
              detail: isExactSameTime
                ? `Deux fiches différentes existent sur la même journée aux mêmes heures (${other.displayTime}). Clique « ✏️ Corriger / Aligner » sur celle en trop pour la supprimer ou la passer en « Hors offre ».`
                : `Ce créneau chevauche le créneau ${other.displayTime} le même jour. C’est souvent le signe qu’un horaire a été décalé par le moniteur et que l’ancien créneau est resté en doublon : passe celui en trop en « Hors offre » (ou supprime-le), ou clique « ✅ Valider » si deux séances chevauchantes étaient volontaires.`,
            });
            const hasC = target.issues.some(iss => iss.level === 'conflict');
            const hasW = target.issues.some(iss => iss.level === 'warning');
            target.severity = hasC ? 'conflict' : hasW ? 'warning' : 'ok';
            if (hasC) target.isVerified = false;
          };
          addOverlapIssue(a, b);
          addOverlapIssue(b, a);
        }
      }
    }

    entries.push(...dayEntries);
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
