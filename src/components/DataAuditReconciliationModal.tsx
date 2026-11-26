import React, { useMemo, useState } from 'react';
import {
  AppSettings,
  CancellationReason,
  CustomSlotsMap,
  MAX_CHARS_PER_INSTRUCTOR,
  SlotObservation,
  TidePoint,
  ValidationDayRecord,
  ValidationItem,
  ValidationsMap,
  WindPoint,
} from '../types';
import {
  AuditSlotEntry,
  DataAuditReport,
  formatObsReasonFr,
} from '../utils/dataAuditEngine';
import {
  DEFAULT_NON_PUBLISH_REASONS,
  getObservationChars,
  getValidationItemChars,
  normalizeClosureReason,
} from '../utils/cycleHelpers';
import {
  batchSaveDataAuditSignOffsToFirestore,
  DataAuditEntrySignOff,
  deleteObservationFromFirestore,
  getActiveInstructor,
  saveDataAuditSignOffToFirestore,
  saveObservationToFirestore,
} from '../utils/firebaseSync';

const WEATHER_CHOICES = [
  { label: 'Vent trop faible / pétole', reason: 'wind_low' as CancellationReason },
  { label: 'Vent trop fort / rafales', reason: 'wind_high' as CancellationReason },
  { label: 'Mauvais secteur / déventé', reason: 'wind_dir' as CancellationReason },
  { label: 'État de la plage (bâches / cailloux)', reason: 'beach_state' as CancellationReason },
  { label: 'Pluie battante / orage', reason: 'weather_extreme' as CancellationReason },
];

const formatDateFr = (ds: string): string => {
  if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return ds;
  const dt = new Date(`${ds}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return ds;
  const formatted = dt.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

export interface DataAuditReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: DataAuditReport;
  validations: ValidationsMap;
  customNonPublishReasons?: string[];
  settings?: AppSettings;
  EX?: TidePoint[];
  windList?: WindPoint[];
  customSlotsMap?: CustomSlotsMap;
  onSaveDayValidation: (ds: string, nextRecord: ValidationDayRecord | null) => void;
  onAddCustomNonPublishReason?: (reason: string) => void;
}

type SimpleChoice =
  | 'no_bookings'
  | 'weather'
  | 'realized'
  | 'school_closed'
  | 'excluded';

interface ExpandedFormState {
  entryKey: string;
  mode: 'weather' | 'realized' | 'school_closed';
  weatherLabel: string;
  weatherCode: CancellationReason;
  schoolReason: string;
  monoCount: number;
  biCount: number;
}

const mapWeatherTextToCode = (text: string): CancellationReason => {
  const low = (text || '').toLowerCase();
  if (low.includes('fort') || low.includes('rafale') || low.includes('tempête')) return 'wind_high';
  if (low.includes('faible') || low.includes('pétole') || low.includes('insuffisant')) return 'wind_low';
  if (low.includes('secteur') || low.includes('dévent') || low.includes('terre')) return 'wind_dir';
  if (low.includes('plage') || low.includes('bâche') || low.includes('caillou')) return 'beach_state';
  if (low.includes('orage') || low.includes('pluie') || low.includes('houle')) return 'weather_extreme';
  return 'wind_low';
};

const inferChoiceFromObs = (
  obs?: SlotObservation
): {
  choice: SimpleChoice;
  label: string;
  weatherLabel?: string;
  weatherCode?: CancellationReason;
  schoolReason?: string;
} => {
  if (!obs) return { choice: 'no_bookings', label: 'Pas d’inscrits' };
  if (obs.status === 'realized') {
    const c = getObservationChars(obs);
    return {
      choice: 'realized',
      label: c > 0 ? `Séance effectuée (${c} char${c > 1 ? 's' : ''})` : 'Séance effectuée',
    };
  }
  const noteLow = (obs.cancellationNote || '').toLowerCase();
  if (noteLow.includes('hors offre') || noteLow.includes('non pertinent')) {
    return { choice: 'excluded', label: 'Hors offre' };
  }
  if (obs.cancellationReason === 'no_clients') {
    return { choice: 'no_bookings', label: 'Pas d’inscrits' };
  }
  if (obs.cancellationReason === 'instructor') {
    const norm = normalizeClosureReason(obs.cancellationNote);
    const r = norm.isGenericClosed ? 'Impératif personnel' : norm.label;
    return { choice: 'school_closed', label: `École fermée (${r})`, schoolReason: r };
  }
  const wLabel =
    obs.cancellationNote?.trim() && !normalizeClosureReason(obs.cancellationNote).isGenericClosed
      ? obs.cancellationNote.trim()
      : formatObsReasonFr(obs.cancellationReason);
  return {
    choice: 'weather',
    label: `Annulée météo (${wLabel})`,
    weatherLabel: wLabel,
    weatherCode: obs.cancellationReason || 'wind_low',
  };
};

const describeQuestionSimply = (entry: AuditSlotEntry): { question: string; hint?: string } => {
  const codes = new Set(entry.issues.map(i => i.code));
  const valReason = entry.valItem?.nonPublishReason || entry.valItem?.rejectReason || '';
  const obsReason = entry.obs ? formatObsReasonFr(entry.obs.cancellationReason) : '';

  if (
    codes.has('reason_mismatch_vie2') ||
    codes.has('reason_mismatch_vie2_noclient') ||
    codes.has('reason_mismatch_c1') ||
    codes.has('reason_mismatch_excluded')
  ) {
    return {
      question: `Le planning indique « ${valReason || 'Annulé'} », mais ton bilan du soir indique « ${obsReason} ». Quelle était la vraie raison ?`,
      hint: entry.obs?.cancellationNote ? `Note du bilan : « ${entry.obs.cancellationNote} »` : undefined,
    };
  }
  if (codes.has('obs_cancelled_val_valid')) {
    return {
      question: `Le planning laisse la séance ouverte, mais ton bilan du soir indique qu’elle a été annulée (${obsReason}). Que s’est-il passé ?`,
    };
  }
  if (codes.has('obs_realized_val_rejected')) {
    const c = getObservationChars(entry.obs);
    return {
      question: `Ton bilan du soir indique que la séance a roulé${c > 0 ? ` (${c} char${c > 1 ? 's' : ''})` : ''}, mais le planning la marque fermée. A-t-elle bien eu lieu ?`,
    };
  }
  if (codes.has('past_slot_unfinished')) {
    return {
      question: 'Cette séance est passée mais n’a pas encore de résultat final. A-t-elle roulé ou a-t-elle été annulée ?',
    };
  }
  if (codes.has('bookings_on_closed_slot')) {
    const names = entry.bookings.map(b => b.name).filter(Boolean).join(', ');
    return {
      question: `${entry.bookingSummary.totalChars} char(s) inscrit(s)${names ? ` (${names})` : ''}, alors que le créneau est marqué fermé. A-t-elle roulé ou été annulée météo ?`,
    };
  }
  if (codes.has('chars_mismatch_val_obs') || codes.has('bookings_count_mismatch')) {
    const vc = getValidationItemChars(entry.valItem).totalChars;
    const oc = getObservationChars(entry.obs);
    return {
      question: `Le nombre de chars ne correspond pas (Planning : ${vc}, Bilan : ${oc}${entry.bookingSummary.totalChars > 0 ? `, Inscrits : ${entry.bookingSummary.totalChars}` : ''}). Quel est le vrai nombre de chars ?`,
    };
  }
  if (codes.has('realized_without_chars')) {
    return {
      question: 'Séance notée effectuée avec 0 char saisi. Combien de chars ont roulé (ou s’agissait-il de « Pas d’inscrits ») ?',
    };
  }
  if (codes.has('missing_validation_for_obs')) {
    const inferred = inferChoiceFromObs(entry.obs);
    return {
      question: `Un bilan du soir existe (« ${inferred.label} ») mais rien n’est noté sur le planning. On confirme ce bilan ?`,
    };
  }
  if (codes.has('generic_closure_reason') || codes.has('ambiguous_rejection') || codes.has('obs_generic_closure')) {
    return {
      question: `Ce créneau indique simplement « ${valReason || 'Fermé'} ». Quelle était la vraie raison ?`,
    };
  }
  if (codes.has('overlapping_slots')) {
    return {
      question: 'Ce créneau chevauche un autre horaire le même jour. Est-ce un doublon à écarter ou bien une séance à garder ?',
    };
  }
  const first = entry.issues[0];
  return {
    question: first ? `${first.label}. Que faut-il retenir pour ce créneau ?` : 'Que s’est-il réellement passé sur ce créneau ?',
  };
};

export const DataAuditReconciliationModal: React.FC<DataAuditReconciliationModalProps> = ({
  isOpen,
  onClose,
  report,
  validations,
  customNonPublishReasons = [],
  onSaveDayValidation,
  onAddCustomNonPublishReason,
}) => {
  const [expandedForm, setExpandedForm] = useState<ExpandedFormState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isAutoAligning, setIsAutoAligning] = useState(false);
  const [showAutoDetails, setShowAutoDetails] = useState(false);
  const [showRecentHistory, setShowRecentHistory] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resolvedThisSession, setResolvedThisSession] = useState<number>(0);

  const closureReasons = useMemo(
    () => Array.from(new Set([...DEFAULT_NON_PUBLISH_REASONS, ...customNonPublishReasons])),
    [customNonPublishReasons]
  );

  // Uniquement ce qui reste vraiment à arbitrer par Jérôme
  const pendingQuestions = useMemo(
    () => report.entries.filter(e => e.needsAction),
    [report.entries]
  );

  // Anciens « Refusé » dont la vraie raison est déjà enregistrée dans le bilan (REX)
  const autoAlignEntries = useMemo(
    () => report.entries.filter(e => e.isAutoAlignableFromRex),
    [report.entries]
  );

  // Réponses manuelles récentes (pour annuler une erreur de clic si besoin)
  const recentSignedEntries = useMemo(
    () =>
      report.entries
        .filter(
          e =>
            e.isVerified &&
            e.signOff?.verifiedAt &&
            e.signOff.note !== 'Lot cohérent validé en bloc'
        )
        .sort((a, b) => (b.signOff?.verifiedAt || 0) - (a.signOff?.verifiedAt || 0))
        .slice(0, 20),
    [report.entries]
  );

  const groupedQuestions = useMemo(() => {
    const byDay = new Map<string, AuditSlotEntry[]>();
    for (const entry of pendingQuestions) {
      const list = byDay.get(entry.ds) || [];
      list.push(entry);
      byDay.set(entry.ds, list);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([ds, list]) => ({
        ds,
        entries: list.sort((a, b) => a.startTime.localeCompare(b.startTime)),
      }));
  }, [pendingQuestions]);

  if (!isOpen) return null;

  const totalRemaining = pendingQuestions.length + autoAlignEntries.length;
  const coherentCount = Math.max(0, report.totalCount - totalRemaining);

  const buildUpdatedItemsForDecision = (
    entry: AuditSlotEntry,
    decision: {
      choice: SimpleChoice;
      weatherLabel?: string;
      weatherCode?: CancellationReason;
      schoolReason?: string;
      monoCount?: number;
      biCount?: number;
    }
  ): {
    nextItem: ValidationItem;
    nextObs: SlotObservation;
    noteLabel: string;
  } => {
    const author = getActiveInstructor();
    const existingVal = entry.valItem;
    const startTime = existingVal?.publishedStart || existingVal?.s || entry.startTime;
    const endTime = existingVal?.publishedEnd || existingVal?.e || entry.endTime;

    const isRejected = decision.choice !== 'realized';
    const mono = isRejected ? 0 : Math.max(0, decision.monoCount ?? 1);
    const bi = isRejected ? 0 : Math.max(0, decision.biCount ?? 0);
    const totalChars = mono + bi;
    const people = mono + bi * 2;

    const cleanSchool = (decision.schoolReason || 'Impératif personnel').trim();
    const cleanWeather = (decision.weatherLabel || WEATHER_CHOICES[0].label).trim();
    const weatherCode = decision.weatherCode || mapWeatherTextToCode(cleanWeather);

    const c1Status: ValidationItem['cycle1Status'] =
      decision.choice === 'excluded'
        ? 'excluded'
        : decision.choice === 'school_closed'
        ? 'not_published'
        : decision.choice === 'no_bookings'
        ? 'closed_no_bookings'
        : 'published';

    const c2Status: ValidationItem['cycle2Status'] =
      decision.choice === 'realized'
        ? 'realized'
        : decision.choice === 'weather'
        ? 'cancelled_weather'
        : undefined;

    const rejectReason =
      decision.choice === 'excluded'
        ? 'Hors offre / Non pertinent (C1)'
        : decision.choice === 'school_closed'
        ? `Non publié (C1) : ${cleanSchool}`
        : decision.choice === 'no_bookings'
        ? "Pas d'inscrits (Vie 2)"
        : decision.choice === 'weather'
        ? cleanWeather
        : undefined;

    const nextItem: ValidationItem = {
      k: entry.slotKey,
      s: startTime,
      e: endTime,
      publishedStart: startTime,
      publishedEnd: endTime,
      opt: entry.computedMatch?.opt ?? existingVal?.opt ?? false,
      over: entry.computedMatch?.over ?? existingVal?.over ?? 0,
      lim: entry.computedMatch?.lim ?? existingVal?.lim ?? '',
      customTitle: entry.computedMatch?.customTitle ?? existingVal?.customTitle ?? entry.obs?.customTitle,
      status: isRejected ? 'rejected' : 'valid',
      rejectReason,
      cycle1Status: c1Status,
      nonPublishReason: c1Status === 'not_published' ? cleanSchool : undefined,
      cycle2Status: c1Status === 'published' ? c2Status : undefined,
      instructor: existingVal?.instructor || existingVal?.assignedPilot || entry.obs?.author || 'Jérôme',
      assignedPilot: existingVal?.assignedPilot || existingVal?.instructor || entry.obs?.author || 'Jérôme',
      secondaryInstructor: isRejected ? undefined : existingVal?.secondaryInstructor || entry.obs?.secondaryInstructor,
      secondaryQualification: isRejected ? undefined : existingVal?.secondaryQualification,
      secondaryMaxChars: isRejected ? undefined : existingVal?.secondaryMaxChars,
      monoCount: mono,
      biCount: bi,
      charsCount: totalChars,
      pilotsCount: people,
    };

    const obsCancelReason: CancellationReason | undefined =
      decision.choice === 'excluded'
        ? 'other'
        : decision.choice === 'no_bookings'
        ? 'no_clients'
        : decision.choice === 'school_closed'
        ? 'instructor'
        : decision.choice === 'weather'
        ? weatherCode
        : undefined;

    const obsCancelNote =
      decision.choice === 'excluded'
        ? 'Hors offre / Non pertinent (C1)'
        : decision.choice === 'school_closed'
        ? cleanSchool
        : decision.choice === 'no_bookings'
        ? "Pas d'inscrits (Vie 2)"
        : decision.choice === 'weather'
        ? cleanWeather
        : undefined;

    const nextObs: SlotObservation = {
      ...(entry.obs || {
        id: `obs-${entry.ds}-${entry.slotKey}`,
        ds: entry.ds,
        createdAt: Date.now(),
      }),
      ds: entry.ds,
      slotKey: entry.slotKey,
      slotStart: startTime,
      slotEnd: endTime,
      isCustom: entry.obs?.isCustom ?? Boolean(nextItem.customTitle),
      customTitle: nextItem.customTitle || entry.obs?.customTitle,
      status: isRejected ? 'cancelled' : 'realized',
      cancellationReason: isRejected ? obsCancelReason : undefined,
      cancellationNote: isRejected ? obsCancelNote : undefined,
      monoCount: isRejected ? undefined : mono,
      biCount: isRejected ? undefined : bi,
      charsCount: isRejected ? undefined : totalChars,
      participantsCount: isRejected ? undefined : people,
      author: existingVal?.instructor || entry.obs?.author || author,
      updatedAt: Date.now(),
    };

    const noteLabel =
      decision.choice === 'realized'
        ? `Séance effectuée (${totalChars} char${totalChars > 1 ? 's' : ''})`
        : decision.choice === 'no_bookings'
        ? 'Pas d’inscrits'
        : decision.choice === 'weather'
        ? `Annulée météo · ${cleanWeather}`
        : decision.choice === 'school_closed'
        ? `École fermée · ${cleanSchool}`
        : 'Hors offre';

    return { nextItem, nextObs, noteLabel };
  };

  const applyDecisionToEntries = async (
    targetEntries: AuditSlotEntry[],
    decision: {
      choice: SimpleChoice;
      weatherLabel?: string;
      weatherCode?: CancellationReason;
      schoolReason?: string;
      monoCount?: number;
      biCount?: number;
    }
  ) => {
    if (targetEntries.length === 0) return;
    const lockKey = targetEntries.length === 1 ? targetEntries[0].entryKey : `day_${targetEntries[0].ds}`;
    setBusyKey(lockKey);
    setErrorMsg(null);
    try {
      const author = getActiveInstructor();
      if (decision.choice === 'school_closed' && decision.schoolReason && onAddCustomNonPublishReason) {
        onAddCustomNonPublishReason(decision.schoolReason.trim());
      }

      const byDate = new Map<string, ValidationItem[]>();
      const obsToSave: SlotObservation[] = [];
      const signOffBatch: Record<string, DataAuditEntrySignOff> = {};
      const now = Date.now();

      for (const entry of targetEntries) {
        const { nextItem, nextObs, noteLabel } = buildUpdatedItemsForDecision(entry, decision);
        const list = byDate.get(entry.ds) || [...(validations[entry.ds]?.items || [])];
        const filtered = list.filter(it => it.k !== entry.slotKey);
        filtered.push(nextItem);
        filtered.sort((a, b) => (a.publishedStart || a.s).localeCompare(b.publishedStart || b.s));
        byDate.set(entry.ds, filtered);

        obsToSave.push(nextObs);
        signOffBatch[entry.entryKey] = {
          entryKey: entry.entryKey,
          verified: true,
          verifiedBy: author,
          verifiedAt: now,
          note: noteLabel,
        };
      }

      for (const [ds, nextItems] of byDate.entries()) {
        const prev = validations[ds];
        onSaveDayValidation(ds, {
          sig: prev?.sig || `audit_${ds}`,
          ts: now,
          k: prev?.k || 'g',
          cycle1PublishedAt: prev?.cycle1PublishedAt || now,
          items: nextItems,
        });
      }

      await Promise.all(obsToSave.map(o => saveObservationToFirestore(o)));
      await batchSaveDataAuditSignOffsToFirestore(signOffBatch);

      setExpandedForm(null);
      setResolvedThisSession(prev => prev + targetEntries.length);
    } catch (err) {
      setErrorMsg('Impossible d’enregistrer cette réponse : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setBusyKey(null);
    }
  };

  // Aligne en 1 clic tous les anciens « Refusé » dont le bilan (REX) contient déjà la réponse
  const handleAutoAlignFromRex = async () => {
    if (autoAlignEntries.length === 0) return;
    setIsAutoAligning(true);
    setErrorMsg(null);
    try {
      const author = getActiveInstructor();
      const now = Date.now();
      const byDate = new Map<string, ValidationItem[]>();
      const signOffBatch: Record<string, DataAuditEntrySignOff> = {};

      for (const entry of autoAlignEntries) {
        const inferred = inferChoiceFromObs(entry.obs);
        const { nextItem, noteLabel } = buildUpdatedItemsForDecision(entry, {
          choice: inferred.choice,
          weatherLabel: inferred.weatherLabel,
          weatherCode: inferred.weatherCode,
          schoolReason: inferred.schoolReason,
          monoCount: entry.obs?.monoCount ?? getObservationChars(entry.obs),
          biCount: entry.obs?.biCount ?? 0,
        });

        const list = byDate.get(entry.ds) || [...(validations[entry.ds]?.items || [])];
        const filtered = list.filter(it => it.k !== entry.slotKey);
        filtered.push(nextItem);
        filtered.sort((a, b) => (a.publishedStart || a.s).localeCompare(b.publishedStart || b.s));
        byDate.set(entry.ds, filtered);

        signOffBatch[entry.entryKey] = {
          entryKey: entry.entryKey,
          verified: true,
          verifiedBy: author,
          verifiedAt: now,
          note: `Aligné sur le bilan enregistré · ${noteLabel}`,
        };
      }

      for (const [ds, nextItems] of byDate.entries()) {
        const prev = validations[ds];
        onSaveDayValidation(ds, {
          sig: prev?.sig || `audit_${ds}`,
          ts: now,
          k: prev?.k || 'g',
          cycle1PublishedAt: prev?.cycle1PublishedAt || now,
          items: nextItems,
        });
      }

      await batchSaveDataAuditSignOffsToFirestore(signOffBatch);
      setResolvedThisSession(prev => prev + autoAlignEntries.length);
    } catch (err) {
      setErrorMsg('Erreur lors de l’alignement automatique : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setIsAutoAligning(false);
    }
  };

  const handleConfirmAsIs = async (entry: AuditSlotEntry) => {
    setBusyKey(entry.entryKey);
    setErrorMsg(null);
    try {
      await saveDataAuditSignOffToFirestore(entry.entryKey, {
        entryKey: entry.entryKey,
        verified: true,
        verifiedBy: getActiveInstructor(),
        verifiedAt: Date.now(),
        note: 'Confirmé tel quel',
      });
      setResolvedThisSession(prev => prev + 1);
    } catch (err) {
      setErrorMsg('Impossible de valider : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteEntry = async (entry: AuditSlotEntry) => {
    setBusyKey(entry.entryKey);
    setErrorMsg(null);
    try {
      const prev = validations[entry.ds];
      if (prev) {
        const nextItems = prev.items.filter(it => it.k !== entry.slotKey);
        onSaveDayValidation(
          entry.ds,
          nextItems.length === 0 ? null : { ...prev, ts: Date.now(), items: nextItems }
        );
      }
      if (entry.obs?.id) {
        await deleteObservationFromFirestore(entry.obs.id);
      }
      await saveDataAuditSignOffToFirestore(entry.entryKey, null);
      setConfirmDeleteKey(null);
      setResolvedThisSession(prev => prev + 1);
    } catch (err) {
      setErrorMsg('Erreur lors de la suppression : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleUndoSignOff = async (entry: AuditSlotEntry) => {
    setBusyKey(entry.entryKey);
    setErrorMsg(null);
    try {
      await saveDataAuditSignOffToFirestore(entry.entryKey, null);
    } catch (err) {
      setErrorMsg('Erreur lors de l’annulation : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setBusyKey(null);
    }
  };

  const openSubForm = (entry: AuditSlotEntry, mode: 'weather' | 'realized' | 'school_closed') => {
    if (expandedForm?.entryKey === entry.entryKey && expandedForm.mode === mode) {
      setExpandedForm(null);
      return;
    }
    const valC = getValidationItemChars(entry.valItem);
    const obsMono = entry.obs?.monoCount ?? 0;
    const obsBi = entry.obs?.biCount ?? 0;
    const obsTotal = getObservationChars(entry.obs);
    const defaultMono =
      valC.mono > 0
        ? valC.mono
        : obsMono > 0
        ? obsMono
        : entry.bookingSummary.mono > 0
        ? entry.bookingSummary.mono
        : obsTotal > 0 && obsBi === 0
        ? obsTotal
        : 2;
    const defaultBi =
      valC.bi > 0 ? valC.bi : obsBi > 0 ? obsBi : entry.bookingSummary.bi;

    const existingWeather =
      entry.valItem?.rejectReason &&
      !normalizeClosureReason(entry.valItem.rejectReason).isGenericClosed &&
      !entry.valItem.rejectReason.toLowerCase().includes('inscr')
        ? entry.valItem.rejectReason
        : WEATHER_CHOICES[0].label;

    setExpandedForm({
      entryKey: entry.entryKey,
      mode,
      weatherLabel: existingWeather,
      weatherCode: mapWeatherTextToCode(existingWeather),
      schoolReason: closureReasons[0] || 'Impératif personnel',
      monoCount: defaultMono,
      biCount: defaultBi,
    });
  };

  const progressDenom = totalRemaining + resolvedThisSession;
  const progressPct = progressDenom === 0 ? 100 : Math.round((resolvedThisSession / progressDenom) * 100);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coherence-modal-title"
        style={{
          background: '#f8fafc',
          borderRadius: '14px',
          maxWidth: '760px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.30)',
          border: '1px solid #cbd5e1',
          color: '#0f172a',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* EN-TÊTE SIMPLE ET ÉPURÉ */}
        <div
          style={{
            flexShrink: 0,
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            padding: '18px 22px 14px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <h2
                id="coherence-modal-title"
                style={{
                  margin: 0,
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.01em',
                }}
              >
                Mise en cohérence pour Jérôme
              </h2>
              <div
                style={{
                  marginTop: '4px',
                  fontSize: '0.82rem',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '6px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {totalRemaining === 0 ? (
                  <span style={{ color: '#15803d', fontWeight: 700 }}>
                    Tout est cohérent · 0 question en attente
                  </span>
                ) : (
                  <>
                    <span style={{ color: '#0f172a', fontWeight: 700 }}>
                      {pendingQuestions.length} question{pendingQuestions.length > 1 ? 's' : ''} à trancher
                    </span>
                    {autoAlignEntries.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {autoAlignEntries.length} alignement{autoAlignEntries.length > 1 ? 's' : ''} en 1 clic
                        </span>
                      </>
                    )}
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>{coherentCount.toLocaleString('fr-FR')} créneaux déjà cohérents masqués</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              style={{
                background: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                minWidth: '40px',
                minHeight: '40px',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Barre de progression discrète */}
          {progressDenom > 0 && (
            <div
              style={{
                marginTop: '12px',
                height: '4px',
                background: '#e2e8f0',
                borderRadius: '999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: totalRemaining === 0 ? '#16a34a' : '#0284c7',
                  transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                marginTop: '10px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* CONTENU PRINCIPAL — UNIQUEMENT CE QUI RESTE À FAIRE */}
        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {/* ÉTAT TERMINÉ */}
          {totalRemaining === 0 && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #bbf7d0',
                borderRadius: '12px',
                padding: '32px 24px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✅</div>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 800, color: '#14532d' }}>
                Tout est cohérent
              </h3>
              <p style={{ margin: '0 auto 18px', maxWidth: '46ch', fontSize: '0.9rem', color: '#475569', lineHeight: 1.55 }}>
                Aucune contradiction ni question en attente. Les {report.totalCount.toLocaleString('fr-FR')} créneaux enregistrés sont alignés entre ton planning et tes bilans.
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '11px 22px',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                Fermer
              </button>
            </div>
          )}

          {/* BLOC 1 CLIC : ANCIENS « REFUSÉ » DONT LE BILAN DU SOIR A DÉJÀ LA RÉPONSE */}
          {autoAlignEntries.length > 0 && (
            <section
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                  {autoAlignEntries.length} ancien{autoAlignEntries.length > 1 ? 's' : ''} « Refusé » déjà renseigné{autoAlignEntries.length > 1 ? 's' : ''} dans tes bilans
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: '#475569', lineHeight: 1.5 }}>
                  Pas besoin de tout ressaisir : tes bilans du soir contiennent déjà la vraie raison (Pas d’inscrits ou Vent insuffisant). Un clic suffit pour recopier ces réponses sur le planning.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <button
                  type="button"
                  disabled={isAutoAligning}
                  onClick={handleAutoAlignFromRex}
                  style={{
                    background: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '11px 18px',
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    cursor: isAutoAligning ? 'wait' : 'pointer',
                    minHeight: '44px',
                    opacity: isAutoAligning ? 0.7 : 1,
                  }}
                >
                  {isAutoAligning
                    ? 'Alignement en cours…'
                    : `Appliquer les ${autoAlignEntries.length} réponses enregistrées`}
                </button>

                <button
                  type="button"
                  onClick={() => setShowAutoDetails(v => !v)}
                  style={{
                    background: 'transparent',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  {showAutoDetails ? 'Masquer la liste' : 'Voir le détail'}
                </button>
              </div>

              {showAutoDetails && (
                <div
                  style={{
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '0.82rem',
                    color: '#334155',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {autoAlignEntries.map(entry => {
                    const inferred = inferChoiceFromObs(entry.obs);
                    return (
                      <div
                        key={entry.entryKey}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px',
                          flexWrap: 'wrap',
                          padding: '6px 0',
                          borderBottom: '1px solid #f1f5f9',
                        }}
                      >
                        <span>
                          <strong>{formatDateFr(entry.ds)}</strong> · {entry.displayTime}
                        </span>
                        <span style={{ color: '#0369a1', fontWeight: 700 }}>
                          → {inferred.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* QUESTIONS À TRANCHER PAR JOURNÉE */}
          {groupedQuestions.map(({ ds, entries }) => {
            const dayBusy = busyKey === `day_${ds}`;
            const dayHasClients = entries.some(e => e.bookingSummary.totalChars > 0);
            const allSameMismatch =
              entries.length >= 2 &&
              entries.every(e =>
                e.issues.some(
                  i => i.code === 'reason_mismatch_vie2' || i.code === 'reason_mismatch_vie2_noclient'
                )
              );

            return (
              <section key={ds} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: '8px',
                    paddingBottom: '4px',
                    borderBottom: '1px solid #cbd5e1',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#0f172a' }}>
                    {formatDateFr(ds)}
                  </h3>
                  <span style={{ fontSize: '0.80rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                    {entries.length} créneau{entries.length > 1 ? 'x' : ''} à trancher
                  </span>
                </div>

                {/* Raccourci journée si plusieurs créneaux ont exactement la même question */}
                {allSameMismatch && !dayHasClients && (
                  <div
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                      Même réponse pour les {entries.length} créneaux de cette journée ?
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      <button
                        type="button"
                        disabled={dayBusy}
                        onClick={() => applyDecisionToEntries(entries, { choice: 'no_bookings' })}
                        style={{
                          background: '#0f172a',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '9px 14px',
                          fontSize: '0.80rem',
                          fontWeight: 700,
                          cursor: dayBusy ? 'wait' : 'pointer',
                          minHeight: '40px',
                        }}
                      >
                        {dayBusy ? 'Enregistrement…' : `Les ${entries.length} : Pas d’inscrits`}
                      </button>
                      <button
                        type="button"
                        disabled={dayBusy}
                        onClick={() =>
                          applyDecisionToEntries(entries, {
                            choice: 'weather',
                            weatherLabel: 'Vent hors plage',
                            weatherCode: 'wind_low',
                          })
                        }
                        style={{
                          background: '#ffffff',
                          color: '#0f172a',
                          border: '1px solid #94a3b8',
                          borderRadius: '8px',
                          padding: '9px 14px',
                          fontSize: '0.80rem',
                          fontWeight: 700,
                          cursor: dayBusy ? 'wait' : 'pointer',
                          minHeight: '40px',
                        }}
                      >
                        Les {entries.length} : Annulés météo
                      </button>
                    </div>
                  </div>
                )}

                {entries.map(entry => {
                  const isBusy = busyKey === entry.entryKey || dayBusy;
                  const { question, hint } = describeQuestionSimply(entry);
                  const hasClients = entry.bookingSummary.totalChars > 0;
                  const obsHint = entry.obs ? inferChoiceFromObs(entry.obs) : null;
                  const isWeatherOpen =
                    expandedForm?.entryKey === entry.entryKey && expandedForm.mode === 'weather';
                  const isRealizedOpen =
                    expandedForm?.entryKey === entry.entryKey && expandedForm.mode === 'realized';
                  const isSchoolOpen =
                    expandedForm?.entryKey === entry.entryKey && expandedForm.mode === 'school_closed';
                  const isOverlapOrWarningOnly =
                    entry.severity === 'warning' ||
                    entry.issues.some(i => i.code === 'overlapping_slots');

                  return (
                    <article
                      key={entry.entryKey}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '18px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                        opacity: isBusy ? 0.65 : 1,
                      }}
                    >
                      {/* Horaire + question claire */}
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '8px',
                            marginBottom: '6px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '1rem',
                              fontWeight: 800,
                              color: '#0f172a',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {entry.displayTime}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            {entry.severity === 'conflict' ? 'À trancher' : 'À préciser'}
                            {hasClients
                              ? ` · ${entry.bookingSummary.totalChars} char${entry.bookingSummary.totalChars > 1 ? 's' : ''} inscrit${entry.bookingSummary.totalChars > 1 ? 's' : ''}`
                              : ''}
                          </span>
                        </div>

                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.92rem',
                            color: '#1e293b',
                            lineHeight: 1.5,
                          }}
                        >
                          {question}
                        </p>
                        {hint && (
                          <div style={{ marginTop: '4px', fontSize: '0.80rem', color: '#64748b' }}>
                            {hint}
                          </div>
                        )}
                      </div>

                      {/* Boutons de réponse directe en 1 clic */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {!hasClients && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => applyDecisionToEntries([entry], { choice: 'no_bookings' })}
                            style={{
                              background: obsHint?.choice === 'no_bookings' ? '#0f172a' : '#ffffff',
                              color: obsHint?.choice === 'no_bookings' ? '#ffffff' : '#0f172a',
                              border:
                                obsHint?.choice === 'no_bookings'
                                  ? '1px solid #0f172a'
                                  : '1px solid #cbd5e1',
                              borderRadius: '8px',
                              padding: '10px 16px',
                              fontSize: '0.84rem',
                              fontWeight: 700,
                              cursor: isBusy ? 'wait' : 'pointer',
                              minHeight: '44px',
                            }}
                          >
                            Pas d’inscrits
                            {obsHint?.choice === 'no_bookings' ? ' (noté au bilan)' : ''}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openSubForm(entry, 'weather')}
                          style={{
                            background: isWeatherOpen
                              ? '#0284c7'
                              : obsHint?.choice === 'weather'
                              ? '#0f172a'
                              : '#ffffff',
                            color:
                              isWeatherOpen || obsHint?.choice === 'weather'
                                ? '#ffffff'
                                : '#0f172a',
                            border: isWeatherOpen
                              ? '1px solid #0284c7'
                              : obsHint?.choice === 'weather'
                              ? '1px solid #0f172a'
                              : '1px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '10px 16px',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            cursor: isBusy ? 'wait' : 'pointer',
                            minHeight: '44px',
                          }}
                        >
                          Annulée météo
                          {obsHint?.choice === 'weather' ? ' (noté au bilan)' : ''}
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openSubForm(entry, 'realized')}
                          style={{
                            background: isRealizedOpen
                              ? '#16a34a'
                              : obsHint?.choice === 'realized'
                              ? '#0f172a'
                              : '#ffffff',
                            color:
                              isRealizedOpen || obsHint?.choice === 'realized'
                                ? '#ffffff'
                                : '#0f172a',
                            border: isRealizedOpen
                              ? '1px solid #16a34a'
                              : obsHint?.choice === 'realized'
                              ? '1px solid #0f172a'
                              : '1px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '10px 16px',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            cursor: isBusy ? 'wait' : 'pointer',
                            minHeight: '44px',
                          }}
                        >
                          Séance effectuée
                          {obsHint?.choice === 'realized' ? ' (noté au bilan)' : ''}
                        </button>

                        {!hasClients && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => openSubForm(entry, 'school_closed')}
                            style={{
                              background: isSchoolOpen ? '#d97706' : '#ffffff',
                              color: isSchoolOpen ? '#ffffff' : '#334155',
                              border: isSchoolOpen ? '1px solid #d97706' : '1px solid #cbd5e1',
                              borderRadius: '8px',
                              padding: '10px 14px',
                              fontSize: '0.84rem',
                              fontWeight: 600,
                              cursor: isBusy ? 'wait' : 'pointer',
                              minHeight: '44px',
                            }}
                          >
                            École fermée
                          </button>
                        )}

                        {!hasClients && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => applyDecisionToEntries([entry], { choice: 'excluded' })}
                            style={{
                              background: '#ffffff',
                              color: '#475569',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              padding: '10px 14px',
                              fontSize: '0.84rem',
                              fontWeight: 600,
                              cursor: isBusy ? 'wait' : 'pointer',
                              minHeight: '44px',
                            }}
                          >
                            Hors offre
                          </button>
                        )}

                        {isOverlapOrWarningOnly && entry.severity !== 'conflict' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleConfirmAsIs(entry)}
                            style={{
                              background: '#ffffff',
                              color: '#15803d',
                              border: '1px solid #86efac',
                              borderRadius: '8px',
                              padding: '10px 14px',
                              fontSize: '0.84rem',
                              fontWeight: 700,
                              cursor: isBusy ? 'wait' : 'pointer',
                              minHeight: '44px',
                            }}
                          >
                            C’est bon tel quel
                          </button>
                        )}

                        {entry.issues.some(i => i.code === 'overlapping_slots') && (
                          confirmDeleteKey === entry.entryKey ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDeleteEntry(entry)}
                              style={{
                                background: '#dc2626',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '10px 14px',
                                fontSize: '0.84rem',
                                fontWeight: 700,
                                cursor: isBusy ? 'wait' : 'pointer',
                                minHeight: '44px',
                              }}
                            >
                              Confirmer suppression
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteKey(entry.entryKey)}
                              style={{
                                background: '#ffffff',
                                color: '#b91c1c',
                                border: '1px solid #fecaca',
                                borderRadius: '8px',
                                padding: '10px 14px',
                                fontSize: '0.84rem',
                                fontWeight: 600,
                                cursor: isBusy ? 'wait' : 'pointer',
                                minHeight: '44px',
                              }}
                            >
                              Supprimer doublon
                            </button>
                          )
                        )}
                      </div>

                      {/* Sous-choix rapide : Météo */}
                      {isWeatherOpen && expandedForm && (
                        <div
                          style={{
                            borderTop: '1px solid #e2e8f0',
                            paddingTop: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                          }}
                        >
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                            Quelle cause météo ? (1 clic enregistre)
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {WEATHER_CHOICES.map(wc => (
                              <button
                                key={wc.label}
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  applyDecisionToEntries([entry], {
                                    choice: 'weather',
                                    weatherLabel: wc.label,
                                    weatherCode: wc.reason,
                                  })
                                }
                                style={{
                                  background: '#f8fafc',
                                  color: '#0f172a',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '8px',
                                  padding: '9px 14px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  cursor: isBusy ? 'wait' : 'pointer',
                                  minHeight: '42px',
                                }}
                              >
                                {wc.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sous-choix rapide : Séance effectuée */}
                      {isRealizedOpen && expandedForm && (
                        <div
                          style={{
                            borderTop: '1px solid #e2e8f0',
                            paddingTop: '12px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '12px',
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600 }}>
                            <span>Monoplaces</span>
                            <input
                              type="number"
                              min={0}
                              max={MAX_CHARS_PER_INSTRUCTOR * 2}
                              value={expandedForm.monoCount}
                              onChange={e =>
                                setExpandedForm(prev =>
                                  prev ? { ...prev, monoCount: Math.max(0, Number(e.target.value) || 0) } : prev
                                )
                              }
                              style={{
                                width: '64px',
                                padding: '8px',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.9rem',
                                fontWeight: 700,
                                textAlign: 'center',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            />
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600 }}>
                            <span>Biplaces</span>
                            <input
                              type="number"
                              min={0}
                              max={12}
                              value={expandedForm.biCount}
                              onChange={e =>
                                setExpandedForm(prev =>
                                  prev ? { ...prev, biCount: Math.max(0, Number(e.target.value) || 0) } : prev
                                )
                              }
                              style={{
                                width: '64px',
                                padding: '8px',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.9rem',
                                fontWeight: 700,
                                textAlign: 'center',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={isBusy || expandedForm.monoCount + expandedForm.biCount <= 0}
                            onClick={() =>
                              applyDecisionToEntries([entry], {
                                choice: 'realized',
                                monoCount: expandedForm.monoCount,
                                biCount: expandedForm.biCount,
                              })
                            }
                            style={{
                              background: '#16a34a',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '8px',
                              padding: '10px 18px',
                              fontSize: '0.84rem',
                              fontWeight: 700,
                              cursor:
                                isBusy || expandedForm.monoCount + expandedForm.biCount <= 0
                                  ? 'not-allowed'
                                  : 'pointer',
                              opacity: expandedForm.monoCount + expandedForm.biCount <= 0 ? 0.5 : 1,
                              minHeight: '44px',
                            }}
                          >
                            Enregistrer ({expandedForm.monoCount + expandedForm.biCount} char
                            {expandedForm.monoCount + expandedForm.biCount > 1 ? 's' : ''})
                          </button>
                        </div>
                      )}

                      {/* Sous-choix rapide : École fermée */}
                      {isSchoolOpen && expandedForm && (
                        <div
                          style={{
                            borderTop: '1px solid #e2e8f0',
                            paddingTop: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                          }}
                        >
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                            Pour quel motif l’école était-elle fermée ? (1 clic enregistre)
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {closureReasons.map(reason => (
                              <button
                                key={reason}
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  applyDecisionToEntries([entry], {
                                    choice: 'school_closed',
                                    schoolReason: reason,
                                  })
                                }
                                style={{
                                  background: '#f8fafc',
                                  color: '#0f172a',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '8px',
                                  padding: '9px 14px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  cursor: isBusy ? 'wait' : 'pointer',
                                  minHeight: '42px',
                                }}
                              >
                                {reason}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}

          {/* HISTORIQUE DISCRET DES RÉPONSES MANUELLES (FERMÉ PAR DÉFAUT) */}
          {recentSignedEntries.length > 0 && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
              <button
                type="button"
                onClick={() => setShowRecentHistory(v => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '4px 0',
                  color: '#64748b',
                  fontSize: '0.80rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {showRecentHistory
                  ? 'Masquer les dernières réponses enregistrées'
                  : `Voir les dernières réponses enregistrées (${recentSignedEntries.length})`}
              </button>

              {showRecentHistory && (
                <div
                  style={{
                    marginTop: '10px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '0.80rem',
                    color: '#334155',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {recentSignedEntries.map(entry => (
                    <div
                      key={entry.entryKey}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        flexWrap: 'wrap',
                        paddingBottom: '8px',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <div>
                        <strong>{formatDateFr(entry.ds)}</strong> · {entry.displayTime}
                        <div style={{ color: '#64748b', fontSize: '0.76rem' }}>
                          {entry.signOff?.note || entry.summaryStatusLabel}
                          {entry.signOff?.verifiedBy ? ` · par ${entry.signOff.verifiedBy}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busyKey === entry.entryKey}
                        onClick={() => handleUndoSignOff(entry)}
                        style={{
                          background: '#f8fafc',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '0.76rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Modifier
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
