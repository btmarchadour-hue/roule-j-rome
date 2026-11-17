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
  AuditSeverity,
  AuditSlotEntry,
  DataAuditReport,
} from '../utils/dataAuditEngine';
import {
  DEFAULT_NON_PUBLISH_REASONS,
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getValidationItemChars,
  normalizeClosureReason,
} from '../utils/cycleHelpers';
import { dayFocus, kOf, lc, tdy, win } from '../utils/tides';
import {
  batchSaveDataAuditSignOffsToFirestore,
  DataAuditEntrySignOff,
  deleteObservationFromFirestore,
  getActiveInstructor,
  saveBookingToFirestore,
  saveDataAuditSignOffToFirestore,
  saveObservationToFirestore,
} from '../utils/firebaseSync';

const C2_WEATHER_REASONS = [
  'Vent trop faible / pétole',
  'Vent trop fort / rafales',
  'Mauvais secteur / déventé',
  'État de la plage (bâches / cailloux)',
  'Pluie battante / orage',
] as const;

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

interface DataAuditReconciliationModalProps {
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

type AuditFilterMode = 'all' | 'conflict' | 'warning' | 'ok' | 'unverified' | 'verified';

interface EditDraftState {
  c1Status: 'published' | 'not_published' | 'excluded' | 'closed_no_bookings';
  c2Status: 'awaiting_booking' | 'confirmed' | 'shifted' | 'cancelled_weather' | 'realized';
  nonPublishReason: string;
  weatherReason: string;
  publishedStart: string;
  publishedEnd: string;
  actualStart: string;
  actualEnd: string;
  monoCount: number;
  biCount: number;
  pilotsCount: number;
  rescheduledChars: number;
  lostChars: number;
  instructor: string;
  secondaryInstructor: string;
  realignSlotKey: boolean;
  syncObservation: boolean;
  auditNote: string;
}

interface DayBulkDraftState {
  c1Status: 'published' | 'not_published' | 'excluded' | 'closed_no_bookings';
  c2Status: 'awaiting_booking' | 'confirmed' | 'cancelled_weather' | 'realized';
  nonPublishReason: string;
  weatherReason: string;
  instructor: string;
  secondaryInstructor: string;
  realignSlotKeys: boolean;
  syncObservationsMode: 'existing_only' | 'all_slots' | 'none';
  auditNote: string;
}

const mapWeatherTextToCancellationReason = (text: string): CancellationReason => {
  const low = (text || '').toLowerCase();
  if (low.includes('fort') || low.includes('rafale') || low.includes('tempête')) return 'wind_high';
  if (low.includes('faible') || low.includes('pétole') || low.includes('sans vent')) return 'wind_low';
  if (low.includes('secteur') || low.includes('dévent') || low.includes('terre')) return 'wind_dir';
  if (low.includes('plage') || low.includes('bâche') || low.includes('caillou')) return 'beach_state';
  if (low.includes('orage') || low.includes('pluie') || low.includes('submersion')) return 'weather_extreme';
  return 'other';
};

export const DataAuditReconciliationModal: React.FC<DataAuditReconciliationModalProps> = ({
  isOpen,
  onClose,
  report,
  validations,
  customNonPublishReasons = [],
  settings,
  EX = [],
  windList = [],
  customSlotsMap = {},
  onSaveDayValidation,
  onAddCustomNonPublishReason,
}) => {
  const [filterMode, setFilterMode] = useState<AuditFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingEntryKey, setEditingEntryKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraftState | null>(null);
  const [bulkDayDs, setBulkDayDs] = useState<string | null>(null);
  const [bulkDraft, setBulkDraft] = useState<DayBulkDraftState | null>(null);
  const [showAddDayClosure, setShowAddDayClosure] = useState(false);
  const [addDayDate, setAddDayDate] = useState<string>(() => tdy());
  const [addDayReason, setAddDayReason] = useState<string>('Impératif personnel');
  const [addDaySyncRex, setAddDaySyncRex] = useState<boolean>(true);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const allNonPublishChoices = useMemo(() => {
    const merged = [...DEFAULT_NON_PUBLISH_REASONS, ...customNonPublishReasons];
    return Array.from(new Set(merged));
  }, [customNonPublishReasons]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.entries.filter(entry => {
      if (filterMode === 'conflict' && entry.severity !== 'conflict') return false;
      if (filterMode === 'warning' && entry.severity !== 'warning') return false;
      if (filterMode === 'ok' && entry.severity !== 'ok') return false;
      if (filterMode === 'unverified' && entry.isVerified) return false;
      if (filterMode === 'verified' && !entry.isVerified) return false;

      if (!q) return true;
      const frDate = formatDateFr(entry.ds).toLowerCase();
      const hay = [
        entry.ds,
        frDate,
        entry.slotKey,
        entry.displayTime,
        entry.summaryStatusLabel,
        entry.valItem?.nonPublishReason || '',
        entry.valItem?.rejectReason || '',
        entry.obs?.cancellationNote || '',
        entry.obs?.notes || '',
        entry.bookings.map(b => b.name).join(' '),
        entry.issues.map(i => `${i.label} ${i.detail}`).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report.entries, filterMode, searchQuery]);

  const unverifiedOkEntries = useMemo(
    () => report.entries.filter(e => e.severity === 'ok' && !e.isVerified),
    [report.entries]
  );

  // Regrouper les entrées filtrées par journée tout en conservant la liste complète de chaque journée
  const groupedDays = useMemo(() => {
    const allByDay: Record<string, AuditSlotEntry[]> = {};
    report.entries.forEach(e => {
      if (!allByDay[e.ds]) allByDay[e.ds] = [];
      allByDay[e.ds].push(e);
    });

    const filteredByDay: Record<string, AuditSlotEntry[]> = {};
    const orderedDates: string[] = [];
    filteredEntries.forEach(e => {
      if (!filteredByDay[e.ds]) {
        filteredByDay[e.ds] = [];
        orderedDates.push(e.ds);
      }
      filteredByDay[e.ds].push(e);
    });

    return orderedDates.map(ds => ({
      ds,
      filtered: filteredByDay[ds],
      allOfDay: allByDay[ds] || filteredByDay[ds],
    }));
  }, [report.entries, filteredEntries]);

  const yesterdayStr = useMemo(() => {
    const dt = new Date(`${tdy()}T12:00:00`);
    dt.setDate(dt.getDate() - 1);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  if (!isOpen) return null;

  const openEditor = (entry: AuditSlotEntry) => {
    setActionError(null);
    setConfirmDeleteKey(null);
    const val = entry.valItem;
    const obs = entry.obs;

    // Déduction intelligente des valeurs initiales (en privilégiant la donnée la plus riche)
    let c1Status: EditDraftState['c1Status'] = 'published';
    let c2Status: EditDraftState['c2Status'] = 'awaiting_booking';
    let nonPublishReason = '';
    let weatherReason: string = C2_WEATHER_REASONS[0];

    if (val) {
      const effC1 = getEffectiveCycle1Status(val);
      c1Status = effC1 === 'unpublished' ? 'published' : effC1;
      const effC2 = getEffectiveCycle2Status(val, entry.bookingSummary.totalChars);
      c2Status =
        effC2 === 'confirmed' ||
        effC2 === 'shifted' ||
        effC2 === 'cancelled_weather' ||
        effC2 === 'realized'
          ? effC2
          : 'awaiting_booking';

      const rawNonPub =
        val.nonPublishReason ||
        val.rejectReason?.replace(/^Non publié\s*\(C1\)\s*:\s*/i, '') ||
        '';
      if (rawNonPub) {
        const norm = normalizeClosureReason(rawNonPub);
        nonPublishReason = norm.isGenericClosed ? 'Impératif personnel' : norm.label;
      }
      if (c2Status === 'cancelled_weather' && val.rejectReason) {
        weatherReason = val.rejectReason;
      }
    } else if (obs) {
      if (obs.status === 'realized') {
        c1Status = 'published';
        c2Status = 'realized';
      } else if (obs.cancellationReason === 'no_clients') {
        c1Status = 'closed_no_bookings';
      } else if (
        (obs.cancellationNote || '').toLowerCase().includes('hors offre') ||
        (obs.cancellationNote || '').toLowerCase().includes('non pertinent')
      ) {
        c1Status = 'excluded';
      } else if (obs.cancellationReason === 'instructor') {
        c1Status = 'not_published';
        const norm = normalizeClosureReason(obs.cancellationNote);
        nonPublishReason = norm.isGenericClosed
          ? 'Impératif personnel'
          : norm.label || 'Impératif personnel';
      } else {
        c1Status = 'published';
        c2Status = 'cancelled_weather';
        weatherReason = obs.cancellationNote || C2_WEATHER_REASONS[0];
      }
    }

    const valChars = getValidationItemChars(val);
    const obsMono = obs?.monoCount ?? 0;
    const obsBi = obs?.biCount ?? 0;
    const monoCount =
      valChars.mono > 0
        ? valChars.mono
        : obsMono > 0
        ? obsMono
        : entry.bookingSummary.mono;
    const biCount =
      valChars.bi > 0 ? valChars.bi : obsBi > 0 ? obsBi : entry.bookingSummary.bi;
    const computedPeople = monoCount + biCount * 2;
    const pilotsCount =
      (val?.pilotsCount ?? 0) > 0
        ? val!.pilotsCount!
        : (obs?.participantsCount ?? 0) > 0
        ? obs!.participantsCount!
        : entry.bookingSummary.people > 0
        ? entry.bookingSummary.people
        : computedPeople;

    const pStart = val?.publishedStart || val?.s || obs?.slotStart || '10h00';
    const pEnd = val?.publishedEnd || val?.e || obs?.slotEnd || '11h00';

    setDraft({
      c1Status,
      c2Status,
      nonPublishReason: nonPublishReason || 'Impératif personnel',
      weatherReason,
      publishedStart: pStart,
      publishedEnd: pEnd,
      actualStart: val?.actualStart || pStart,
      actualEnd: val?.actualEnd || pEnd,
      monoCount,
      biCount,
      pilotsCount,
      rescheduledChars: val?.rescheduledChars ?? obs?.rescheduledCount ?? 0,
      lostChars: val?.lostChars ?? obs?.lostCount ?? 0,
      instructor: val?.instructor || val?.assignedPilot || obs?.author || 'Jérôme',
      secondaryInstructor: val?.secondaryInstructor || obs?.secondaryInstructor || '',
      realignSlotKey: Boolean(entry.computedMatch && !entry.computedMatch.isExactKeyMatch),
      syncObservation: Boolean(obs),
      auditNote: entry.signOff?.note || '',
    });
    setEditingEntryKey(entry.entryKey);
  };

  const handleToggleSignOff = async (entry: AuditSlotEntry) => {
    setSavingKey(entry.entryKey);
    setActionError(null);
    try {
      const nextSignOff: DataAuditEntrySignOff | null = entry.isVerified
        ? null
        : {
            entryKey: entry.entryKey,
            verified: true,
            verifiedBy: getActiveInstructor(),
            verifiedAt: Date.now(),
          };
      await saveDataAuditSignOffToFirestore(entry.entryKey, nextSignOff);
    } catch (err) {
      setActionError('Erreur lors de la validation Cloud : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleBatchApproveClean = async () => {
    if (unverifiedOkEntries.length === 0) return;
    setIsBatchSaving(true);
    setActionError(null);
    try {
      const now = Date.now();
      const author = getActiveInstructor();
      const batchMap: Record<string, DataAuditEntrySignOff> = {};
      unverifiedOkEntries.forEach(e => {
        batchMap[e.entryKey] = {
          entryKey: e.entryKey,
          verified: true,
          verifiedBy: author,
          verifiedAt: now,
          note: 'Lot cohérent validé en bloc',
        };
      });
      await batchSaveDataAuditSignOffsToFirestore(batchMap);
    } catch (err) {
      setActionError('Erreur lors de la validation groupée : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setIsBatchSaving(false);
    }
  };

  const openBulkDayEditor = (ds: string, dayEntries: AuditSlotEntry[]) => {
    setActionError(null);
    setEditingEntryKey(null);
    setDraft(null);
    setConfirmDeleteKey(null);

    const firstWithVal = dayEntries.find(e => e.valItem)?.valItem;
    const firstWithObs = dayEntries.find(e => e.obs)?.obs;
    const effC1 = firstWithVal ? getEffectiveCycle1Status(firstWithVal) : 'not_published';
    const c1Status: DayBulkDraftState['c1Status'] =
      effC1 === 'excluded'
        ? 'excluded'
        : effC1 === 'closed_no_bookings'
        ? 'closed_no_bookings'
        : effC1 === 'published'
        ? 'published'
        : 'not_published';

    const rawNonPub =
      firstWithVal?.nonPublishReason ||
      firstWithVal?.rejectReason?.replace(/^Non publié\s*\(C1\)\s*:\s*/i, '') ||
      firstWithObs?.cancellationNote ||
      '';
    const norm = normalizeClosureReason(rawNonPub);
    const hasAnyObs = dayEntries.some(e => Boolean(e.obs));

    setBulkDraft({
      c1Status,
      c2Status: 'awaiting_booking',
      nonPublishReason: norm.isGenericClosed
        ? 'Impératif personnel'
        : norm.label || 'Impératif personnel',
      weatherReason: C2_WEATHER_REASONS[0],
      instructor: firstWithVal?.instructor || firstWithVal?.assignedPilot || 'Jérôme',
      secondaryInstructor: firstWithVal?.secondaryInstructor || '',
      realignSlotKeys: dayEntries.some(e => e.computedMatch && !e.computedMatch.isExactKeyMatch),
      syncObservationsMode: hasAnyObs ? 'existing_only' : 'all_slots',
      auditNote: '',
    });
    setBulkDayDs(ds);
  };

  const handleValidateWholeDay = async (dayEntries: AuditSlotEntry[], verify: boolean) => {
    if (dayEntries.length === 0) return;
    setIsBatchSaving(true);
    setActionError(null);
    try {
      const now = Date.now();
      const author = getActiveInstructor();
      const batchMap: Record<string, DataAuditEntrySignOff | null> = {};
      dayEntries.forEach(e => {
        batchMap[e.entryKey] = verify
          ? {
              entryKey: e.entryKey,
              verified: true,
              verifiedBy: author,
              verifiedAt: now,
              note: 'Journée validée en bloc',
            }
          : null;
      });
      await batchSaveDataAuditSignOffsToFirestore(batchMap);
    } catch (err) {
      setActionError('Erreur lors de la mise à jour des visas du jour : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setIsBatchSaving(false);
    }
  };

  const handleSaveBulkDay = async (ds: string, dayEntries: AuditSlotEntry[]) => {
    if (!bulkDraft || dayEntries.length === 0) return;
    setIsBatchSaving(true);
    setActionError(null);

    try {
      const author = getActiveInstructor();
      const now = Date.now();
      const cleanNonPubReason = bulkDraft.nonPublishReason.trim() || 'Impératif personnel';
      if (bulkDraft.c1Status === 'not_published' && onAddCustomNonPublishReason) {
        onAddCustomNonPublishReason(cleanNonPubReason);
      }

      const isRejected =
        bulkDraft.c1Status === 'excluded' ||
        bulkDraft.c1Status === 'not_published' ||
        bulkDraft.c1Status === 'closed_no_bookings' ||
        (bulkDraft.c1Status === 'published' && bulkDraft.c2Status === 'cancelled_weather');

      const rejectReason =
        bulkDraft.c1Status === 'excluded'
          ? 'Hors offre / Non pertinent (C1)'
          : bulkDraft.c1Status === 'not_published'
          ? `Non publié (C1) : ${cleanNonPubReason}`
          : bulkDraft.c1Status === 'closed_no_bookings'
          ? "Faute d'inscrits (Vie 1)"
          : bulkDraft.c2Status === 'cancelled_weather'
          ? bulkDraft.weatherReason.trim() || 'Annulé météo (Vie 2)'
          : undefined;

      const prevDayRecord = validations[ds];
      const nextItemsMap = new Map<string, ValidationItem>();
      (prevDayRecord?.items || []).forEach(it => nextItemsMap.set(it.k, it));

      const auditBatchMap: Record<string, DataAuditEntrySignOff | null> = {};

      for (const entry of dayEntries) {
        const targetSlotKey =
          bulkDraft.realignSlotKeys && entry.computedMatch
            ? entry.computedMatch.slotKey
            : entry.slotKey;

        const existingVal = entry.valItem;
        const pStart = existingVal?.publishedStart || existingVal?.s || entry.obs?.slotStart || entry.startTime;
        const pEnd = existingVal?.publishedEnd || existingVal?.e || entry.obs?.slotEnd || entry.endTime;

        const nextItem: ValidationItem = {
          k: targetSlotKey,
          s: pStart,
          e: pEnd,
          publishedStart: pStart,
          publishedEnd: pEnd,
          opt: entry.computedMatch?.opt ?? existingVal?.opt ?? false,
          over: entry.computedMatch?.over ?? existingVal?.over ?? 0,
          lim: entry.computedMatch?.lim ?? existingVal?.lim ?? '',
          customTitle: entry.computedMatch?.customTitle ?? existingVal?.customTitle ?? entry.obs?.customTitle,
          status: isRejected ? 'rejected' : 'valid',
          rejectReason,
          cycle1Status: bulkDraft.c1Status,
          nonPublishReason: bulkDraft.c1Status === 'not_published' ? cleanNonPubReason : undefined,
          cycle2Status: bulkDraft.c1Status === 'published' ? bulkDraft.c2Status : undefined,
          instructor: bulkDraft.instructor.trim() || 'Jérôme',
          assignedPilot: bulkDraft.instructor.trim() || 'Jérôme',
          secondaryInstructor: bulkDraft.secondaryInstructor.trim() || undefined,
          monoCount: isRejected ? 0 : existingVal?.monoCount ?? entry.bookingSummary.mono,
          biCount: isRejected ? 0 : existingVal?.biCount ?? entry.bookingSummary.bi,
          charsCount: isRejected
            ? 0
            : existingVal?.charsCount ?? entry.bookingSummary.totalChars,
          pilotsCount: isRejected
            ? 0
            : existingVal?.pilotsCount ?? entry.bookingSummary.people,
        };

        if (targetSlotKey !== entry.slotKey) {
          nextItemsMap.delete(entry.slotKey);
          auditBatchMap[entry.entryKey] = null;
          if (entry.bookings.length > 0) {
            await saveBookingToFirestore(`${ds}_${targetSlotKey}`, entry.bookings);
            await saveBookingToFirestore(`${ds}_${entry.slotKey}`, []);
          }
        }
        nextItemsMap.set(targetSlotKey, nextItem);

        const shouldSyncObs =
          bulkDraft.syncObservationsMode === 'all_slots' ||
          (bulkDraft.syncObservationsMode === 'existing_only' && Boolean(entry.obs)) ||
          (Boolean(entry.obs) && targetSlotKey !== entry.slotKey);

        if (shouldSyncObs) {
          const obsStatus: 'realized' | 'cancelled' = isRejected ? 'cancelled' : 'realized';
          const obsCancelReason: CancellationReason | undefined =
            bulkDraft.c1Status === 'excluded'
              ? 'other'
              : bulkDraft.c1Status === 'closed_no_bookings'
              ? 'no_clients'
              : bulkDraft.c1Status === 'not_published'
              ? 'instructor'
              : bulkDraft.c2Status === 'cancelled_weather'
              ? mapWeatherTextToCancellationReason(bulkDraft.weatherReason)
              : undefined;
          const obsCancelNote =
            bulkDraft.c1Status === 'excluded'
              ? 'Hors offre / Non pertinent (C1)'
              : bulkDraft.c1Status === 'not_published'
              ? cleanNonPubReason
              : bulkDraft.c1Status === 'closed_no_bookings'
              ? "Faute d'inscrits (Vie 1)"
              : bulkDraft.c2Status === 'cancelled_weather'
              ? bulkDraft.weatherReason.trim()
              : undefined;

          const updatedObs: SlotObservation = {
            ...(entry.obs || {
              id: `obs_${ds}_${targetSlotKey}`,
              ds,
              createdAt: now,
            }),
            ds,
            slotKey: targetSlotKey,
            slotStart: pStart,
            slotEnd: pEnd,
            isCustom: entry.obs?.isCustom ?? Boolean(nextItem.customTitle),
            customTitle: nextItem.customTitle || entry.obs?.customTitle,
            status: obsStatus,
            cancellationReason: obsStatus === 'cancelled' ? obsCancelReason : undefined,
            cancellationNote: obsStatus === 'cancelled' ? obsCancelNote : undefined,
            author: bulkDraft.instructor.trim() || entry.obs?.author || author,
            secondaryInstructor: bulkDraft.secondaryInstructor.trim() || undefined,
            updatedAt: now,
          };
          await saveObservationToFirestore(updatedObs);
        }

        const nextKey = `${ds}__${targetSlotKey}`;
        auditBatchMap[nextKey] = {
          entryKey: nextKey,
          verified: true,
          verifiedBy: author,
          verifiedAt: now,
          note:
            bulkDraft.auditNote.trim() ||
            (bulkDraft.c1Status === 'not_published'
              ? `Journée entière uniformisée · ${cleanNonPubReason}`
              : 'Journée entière mise en cohérence en bloc'),
        };
      }

      const sortedItems = Array.from(nextItemsMap.values()).sort((a, b) =>
        (a.publishedStart || a.s).localeCompare(b.publishedStart || b.s)
      );

      onSaveDayValidation(ds, {
        sig: prevDayRecord?.sig || `audit_${ds}`,
        ts: now,
        k: prevDayRecord?.k || 'g',
        cycle1PublishedAt: prevDayRecord?.cycle1PublishedAt || now,
        items: sortedItems,
      });

      await batchSaveDataAuditSignOffsToFirestore(auditBatchMap);

      setBulkDayDs(null);
      setBulkDraft(null);
    } catch (err) {
      setActionError(
        'Erreur lors de l’application sur la journée entière : ' + ((err as Error)?.message || 'réseau')
      );
    } finally {
      setIsBatchSaving(false);
    }
  };

  const handleCloseUnlistedDay = async () => {
    if (!addDayDate || !/^\d{4}-\d{2}-\d{2}$/.test(addDayDate)) {
      setActionError('Sélectionne une date valide.');
      return;
    }
    if (!settings || EX.length === 0) {
      setActionError('Données de marée ou paramètres non chargés pour générer les créneaux du jour.');
      return;
    }

    setIsBatchSaving(true);
    setActionError(null);
    try {
      const isRealMode = settings.calculationMode === 'reel';
      const empiricalOffsetM = isRealMode ? ((settings.empiricalOffsetCm ?? 15) / 100) : 0;
      const effectiveThreshold = settings.L + empiricalOffsetM - (settings.mg || 0) / 100;
      const tideW = win(EX, effectiveThreshold);
      const first = EX[0]?.t ?? 0;
      const last = EX[EX.length - 1]?.t ?? 0;
      const df = dayFocus(addDayDate, settings, tideW, first, last, windList, customSlotsMap);

      if (!df.list || df.list.length === 0) {
        setActionError(
          `Aucun créneau théorique roulable trouvé pour le ${formatDateFr(addDayDate)}.`
        );
        return;
      }

      const cleanReason = addDayReason.trim() || 'Impératif personnel';
      if (onAddCustomNonPublishReason) {
        onAddCustomNonPublishReason(cleanReason);
      }

      const now = Date.now();
      const author = getActiveInstructor();
      const prevDayRecord = validations[addDayDate];
      const existingByKey = new Map<string, ValidationItem>();
      (prevDayRecord?.items || []).forEach(it => existingByKey.set(it.k, it));

      const nextItems: ValidationItem[] = [];
      const auditBatchMap: Record<string, DataAuditEntrySignOff | null> = {};

      for (const sess of df.list) {
        const slotKey = kOf(sess);
        const pStart = lc(sess.a, df.y, df.m, df.d);
        const pEnd = lc(sess.b, df.y, df.m, df.d);
        const prev = existingByKey.get(slotKey);

        const item: ValidationItem = {
          k: slotKey,
          s: pStart,
          e: pEnd,
          publishedStart: pStart,
          publishedEnd: pEnd,
          opt: sess.opt,
          over: sess.over,
          lim: sess.lim,
          customTitle: sess.customTitle ?? prev?.customTitle,
          status: 'rejected',
          rejectReason: `Non publié (C1) : ${cleanReason}`,
          cycle1Status: 'not_published',
          nonPublishReason: cleanReason,
          instructor: prev?.instructor || 'Jérôme',
          assignedPilot: prev?.assignedPilot || 'Jérôme',
          monoCount: 0,
          biCount: 0,
          charsCount: 0,
          pilotsCount: 0,
        };
        nextItems.push(item);

        if (addDaySyncRex) {
          const obs: SlotObservation = {
            id: `obs_${addDayDate}_${slotKey}`,
            ds: addDayDate,
            slotKey,
            slotStart: pStart,
            slotEnd: pEnd,
            isCustom: Boolean(sess.customTitle),
            customTitle: sess.customTitle,
            status: 'cancelled',
            cancellationReason: 'instructor',
            cancellationNote: cleanReason,
            author: 'Jérôme',
            createdAt: now,
            updatedAt: now,
          };
          await saveObservationToFirestore(obs);
        }

        const entryKey = `${addDayDate}__${slotKey}`;
        auditBatchMap[entryKey] = {
          entryKey,
          verified: true,
          verifiedBy: author,
          verifiedAt: now,
          note: `Journée fermée en bloc · ${cleanReason}`,
        };
      }

      onSaveDayValidation(addDayDate, {
        sig: prevDayRecord?.sig || `audit_${addDayDate}`,
        ts: now,
        k: prevDayRecord?.k || 'g',
        cycle1PublishedAt: prevDayRecord?.cycle1PublishedAt || now,
        items: nextItems,
      });

      await batchSaveDataAuditSignOffsToFirestore(auditBatchMap);
      setShowAddDayClosure(false);
    } catch (err) {
      setActionError(
        'Erreur lors de la fermeture complète de la journée : ' + ((err as Error)?.message || 'réseau')
      );
    } finally {
      setIsBatchSaving(false);
    }
  };

  const handleSaveReconciledEntry = async (entry: AuditSlotEntry) => {
    if (!draft) return;
    setSavingKey(entry.entryKey);
    setActionError(null);

    try {
      const author = getActiveInstructor();
      const targetSlotKey =
        draft.realignSlotKey && entry.computedMatch
          ? entry.computedMatch.slotKey
          : entry.slotKey;

      const totalChars = draft.monoCount + draft.biCount;
      const people =
        draft.pilotsCount > 0 ? draft.pilotsCount : draft.monoCount + draft.biCount * 2;

      const cleanNonPubReason = draft.nonPublishReason.trim() || 'Impératif personnel';
      if (draft.c1Status === 'not_published' && onAddCustomNonPublishReason) {
        onAddCustomNonPublishReason(cleanNonPubReason);
      }

      const isRejected =
        draft.c1Status === 'excluded' ||
        draft.c1Status === 'not_published' ||
        draft.c1Status === 'closed_no_bookings' ||
        (draft.c1Status === 'published' && draft.c2Status === 'cancelled_weather');

      const rejectReason =
        draft.c1Status === 'excluded'
          ? 'Hors offre / Non pertinent (C1)'
          : draft.c1Status === 'not_published'
          ? `Non publié (C1) : ${cleanNonPubReason}`
          : draft.c1Status === 'closed_no_bookings'
          ? "Faute d'inscrits (Vie 1)"
          : draft.c2Status === 'cancelled_weather'
          ? draft.weatherReason.trim() || 'Annulé météo (Vie 2)'
          : undefined;

      const existingVal = entry.valItem;
      const nextItem: ValidationItem = {
        k: targetSlotKey,
        s: draft.publishedStart.trim() || entry.startTime,
        e: draft.publishedEnd.trim() || entry.endTime,
        publishedStart: draft.publishedStart.trim() || entry.startTime,
        publishedEnd: draft.publishedEnd.trim() || entry.endTime,
        opt: entry.computedMatch?.opt ?? existingVal?.opt ?? false,
        over: entry.computedMatch?.over ?? existingVal?.over ?? 0,
        lim: entry.computedMatch?.lim ?? existingVal?.lim ?? '',
        customTitle: entry.computedMatch?.customTitle ?? existingVal?.customTitle ?? entry.obs?.customTitle,
        status: isRejected ? 'rejected' : 'valid',
        rejectReason,
        cycle1Status: draft.c1Status,
        nonPublishReason: draft.c1Status === 'not_published' ? cleanNonPubReason : undefined,
        cycle2Status:
          draft.c1Status === 'published' ? draft.c2Status : undefined,
        actualStart:
          draft.c1Status === 'published' && draft.c2Status === 'shifted'
            ? draft.actualStart.trim()
            : existingVal?.actualStart,
        actualEnd:
          draft.c1Status === 'published' && draft.c2Status === 'shifted'
            ? draft.actualEnd.trim()
            : existingVal?.actualEnd,
        shiftMinutes:
          draft.c1Status === 'published' && draft.c2Status === 'shifted'
            ? existingVal?.shiftMinutes
            : undefined,
        instructor: draft.instructor.trim() || 'Jérôme',
        assignedPilot: draft.instructor.trim() || 'Jérôme',
        secondaryInstructor: draft.secondaryInstructor.trim() || undefined,
        monoCount: draft.monoCount,
        biCount: draft.biCount,
        charsCount: totalChars,
        pilotsCount: people,
        rescheduledChars:
          draft.c1Status === 'published' && draft.c2Status === 'cancelled_weather'
            ? draft.rescheduledChars
            : existingVal?.rescheduledChars,
        lostChars:
          draft.c1Status === 'published' && draft.c2Status === 'cancelled_weather'
            ? draft.lostChars
            : existingVal?.lostChars,
      };

      // 1. Mettre à jour validations[ds]
      const prevDayRecord = validations[entry.ds];
      const prevItems = prevDayRecord?.items || [];
      let nextItems = prevItems.filter(
        it => it.k !== entry.slotKey && it.k !== targetSlotKey
      );
      nextItems = [...nextItems, nextItem].sort((a, b) =>
        (a.publishedStart || a.s).localeCompare(b.publishedStart || b.s)
      );

      onSaveDayValidation(entry.ds, {
        sig: prevDayRecord?.sig || `audit_${entry.ds}`,
        ts: Date.now(),
        k: prevDayRecord?.k || 'g',
        cycle1PublishedAt: prevDayRecord?.cycle1PublishedAt || Date.now(),
        items: nextItems,
      });

      // 2. Si clé réalignée et réservations attachées à l'ancienne clé -> migrer vers la nouvelle clé
      if (targetSlotKey !== entry.slotKey && entry.bookings.length > 0) {
        await saveBookingToFirestore(`${entry.ds}_${targetSlotKey}`, entry.bookings);
        await saveBookingToFirestore(`${entry.ds}_${entry.slotKey}`, []);
      }

      // 3. Synchroniser l'Observation REX si demandé (ou si déjà présente et clé changée)
      if (draft.syncObservation || (entry.obs && targetSlotKey !== entry.slotKey)) {
        const obsStatus: 'realized' | 'cancelled' = isRejected ? 'cancelled' : 'realized';
        const obsCancelReason: CancellationReason | undefined =
          draft.c1Status === 'excluded'
            ? 'other'
            : draft.c1Status === 'closed_no_bookings'
            ? 'no_clients'
            : draft.c1Status === 'not_published'
            ? 'instructor'
            : draft.c2Status === 'cancelled_weather'
            ? mapWeatherTextToCancellationReason(draft.weatherReason)
            : undefined;
        const obsCancelNote =
          draft.c1Status === 'excluded'
            ? 'Hors offre / Non pertinent (C1)'
            : draft.c1Status === 'not_published'
            ? cleanNonPubReason
            : draft.c1Status === 'closed_no_bookings'
            ? "Faute d'inscrits (Vie 1)"
            : draft.c2Status === 'cancelled_weather'
            ? draft.weatherReason.trim()
            : undefined;

        const updatedObs: SlotObservation = {
          ...(entry.obs || {
            id: `obs_${entry.ds}_${targetSlotKey}`,
            ds: entry.ds,
            createdAt: Date.now(),
          }),
          ds: entry.ds,
          slotKey: targetSlotKey,
          slotStart: nextItem.actualStart || nextItem.publishedStart || nextItem.s,
          slotEnd: nextItem.actualEnd || nextItem.publishedEnd || nextItem.e,
          isCustom: entry.obs?.isCustom ?? Boolean(nextItem.customTitle),
          customTitle: nextItem.customTitle || entry.obs?.customTitle,
          status: obsStatus,
          cancellationReason: obsStatus === 'cancelled' ? obsCancelReason : undefined,
          cancellationNote: obsStatus === 'cancelled' ? obsCancelNote : undefined,
          monoCount: draft.monoCount,
          biCount: draft.biCount,
          charsCount: totalChars,
          participantsCount: obsStatus === 'realized' ? people : entry.obs?.participantsCount ?? 0,
          bookedParticipantsCount:
            obsStatus === 'cancelled' && draft.c2Status === 'cancelled_weather'
              ? people || entry.obs?.bookedParticipantsCount
              : entry.obs?.bookedParticipantsCount,
          rescheduledCount:
            obsStatus === 'cancelled' && draft.c2Status === 'cancelled_weather'
              ? draft.rescheduledChars
              : entry.obs?.rescheduledCount,
          lostCount:
            obsStatus === 'cancelled' && draft.c2Status === 'cancelled_weather'
              ? draft.lostChars
              : entry.obs?.lostCount,
          author: draft.instructor.trim() || entry.obs?.author || author,
          secondaryInstructor: draft.secondaryInstructor.trim() || undefined,
          updatedAt: Date.now(),
        };
        await saveObservationToFirestore(updatedObs);
      }

      // 4. Signer la vérification dans l'audit Cloud
      const nextKey = `${entry.ds}__${targetSlotKey}`;
      if (targetSlotKey !== entry.slotKey) {
        await saveDataAuditSignOffToFirestore(entry.entryKey, null);
      }
      await saveDataAuditSignOffToFirestore(nextKey, {
        entryKey: nextKey,
        verified: true,
        verifiedBy: author,
        verifiedAt: Date.now(),
        note: draft.auditNote.trim() || 'Mis en cohérence avec le modèle Cycle 1 / Cycle 2',
      });

      setEditingEntryKey(null);
      setDraft(null);
    } catch (err) {
      setActionError('Erreur lors de la mise en cohérence : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteEntry = async (entry: AuditSlotEntry) => {
    setSavingKey(entry.entryKey);
    setActionError(null);
    try {
      const prevDayRecord = validations[entry.ds];
      if (prevDayRecord) {
        const nextItems = prevDayRecord.items.filter(it => it.k !== entry.slotKey);
        if (nextItems.length === 0) {
          onSaveDayValidation(entry.ds, null);
        } else {
          onSaveDayValidation(entry.ds, {
            ...prevDayRecord,
            ts: Date.now(),
            items: nextItems,
          });
        }
      }
      if (entry.obs?.id) {
        await deleteObservationFromFirestore(entry.obs.id);
      }
      if (entry.signOff) {
        await saveDataAuditSignOffToFirestore(entry.entryKey, null);
      }
      setConfirmDeleteKey(null);
      setEditingEntryKey(null);
      setDraft(null);
    } catch (err) {
      setActionError('Erreur lors de la suppression : ' + ((err as Error)?.message || 'réseau'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleExportAuditCsv = () => {
    const header = [
      'Date',
      'Horaire',
      'Cle_Creneau',
      'Diagnostic',
      'Statut_C1_C2',
      'Nb_Chars_C2',
      'REX_Statut',
      'REX_Chars',
      'Inscrits',
      'Anomalies',
      'Valide_Par',
    ];
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = report.entries.map(e => {
      const valChars = getValidationItemChars(e.valItem).totalChars;
      return [
        e.ds,
        e.displayTime,
        e.slotKey,
        e.severity === 'conflict' ? 'Incohérence' : e.severity === 'warning' ? 'À préciser' : 'Cohérent',
        e.summaryStatusLabel,
        valChars,
        e.obs ? e.obs.status : 'Aucun REX',
        e.obs?.charsCount ?? '',
        e.bookingSummary.totalChars,
        e.issues.map(i => i.label).join(' | ') || 'OK',
        e.isVerified ? `${e.signOff?.verifiedBy || 'Jérôme'} (${new Date(e.signOff?.verifiedAt || 0).toLocaleDateString('fr-FR')})` : 'Non validé',
      ]
        .map(escapeCsv)
        .join(';');
    });
    const csv = '\uFEFF' + [header.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Audit_Coherence_Donnees_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const severityBadge = (severity: AuditSeverity) => {
    if (severity === 'conflict') {
      return { label: '🔴 Incohérence / Isolée', bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' };
    }
    if (severity === 'warning') {
      return { label: '🟠 Héritée / À préciser', bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' };
    }
    return { label: '🟢 Cohérente', bg: '#dcfce7', fg: '#166534', bd: '#86efac' };
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.80)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '1080px',
          width: '100%',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px rgba(0,0,0,0.35)',
          border: '2px solid #d97706',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* EN-TÊTE FIXE */}
        <div
          style={{
            background: '#0f172a',
            color: '#ffffff',
            padding: '14px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: '#d97706',
                  color: '#ffffff',
                  fontSize: '0.66rem',
                  fontWeight: 900,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                }}
              >
                Outil Audit & Réconciliation Cloud
              </span>
              <span style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 700 }}>
                {report.daysAnalyzed} journée{report.daysAnalyzed > 1 ? 's' : ''} · {report.totalCount} créneau{report.totalCount > 1 ? 'x' : ''} enregistré{report.totalCount > 1 ? 's' : ''} ·{' '}
                <strong style={{ color: '#86efac' }}>
                  {report.verifiedCount}/{report.totalCount} validé{report.verifiedCount > 1 ? 's' : ''}
                </strong>
              </span>
            </div>
            <h3 style={{ margin: '6px 0 2px', fontSize: '1.12rem', fontWeight: 900 }}>
              🩺 Vérification & Mise en Cohérence des Données Existantes (Cycle 1 / Cycle 2 / REX)
            </h3>
            <div style={{ fontSize: '0.74rem', color: '#cbd5e1' }}>
              Passe en revue toutes les données déjà enregistrées : valide en 1 clic si c’est cohérent, ou corrige directement sur place pour aligner Cycle 1, Cycle 2 et REX.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleExportAuditCsv}
              style={{
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid #475569',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '0.72rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
              title="Télécharger l'inventaire complet au format CSV"
            >
              📥 CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer l'outil d'audit"
              style={{
                background: '#334155',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                width: '32px',
                height: '32px',
                fontSize: '1rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* BARRE DE FILTRES & OUTILS */}
        <div
          style={{
            background: '#f8fafc',
            borderBottom: '1px solid #cbd5e1',
            padding: '10px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'all' as const, label: `Toutes (${report.totalCount})`, activeBg: '#0f172a', activeFg: '#fff' },
                { id: 'conflict' as const, label: `🔴 Incohérences (${report.conflictCount})`, activeBg: '#dc2626', activeFg: '#fff' },
                { id: 'warning' as const, label: `🟠 À préciser (${report.warningCount})`, activeBg: '#d97706', activeFg: '#fff' },
                { id: 'ok' as const, label: `🟢 Cohérentes (${report.okCount})`, activeBg: '#16a34a', activeFg: '#fff' },
                { id: 'unverified' as const, label: `⏳ À valider (${report.unverifiedCount})`, activeBg: '#0284c7', activeFg: '#fff' },
                { id: 'verified' as const, label: `✅ Validées (${report.verifiedCount})`, activeBg: '#0f766e', activeFg: '#fff' },
              ].map(tab => {
                const isActive = filterMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterMode(tab.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: isActive ? `1.5px solid ${tab.activeBg}` : '1px solid #cbd5e1',
                      background: isActive ? tab.activeBg : '#ffffff',
                      color: isActive ? tab.activeFg : '#334155',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <input
              type="text"
              placeholder="🔍 Filtrer (date, motif, client, note...)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.74rem',
                width: '230px',
                maxWidth: '100%',
                background: '#ffffff',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            {settings && EX.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddDayClosure(v => !v)}
                style={{
                  padding: '6px 11px',
                  borderRadius: '6px',
                  border: '1.5px solid #d97706',
                  background: showAddDayClosure ? '#d97706' : '#fffbeb',
                  color: showAddDayClosure ? '#ffffff' : '#92400e',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {showAddDayClosure
                  ? 'Fermer saisie journée complète'
                  : '➕ Déclarer / fermer une journée entière (ex. Hier / Aujourd’hui)'}
              </button>
            )}
          </div>

          {showAddDayClosure && (
            <div
              style={{
                background: '#fffbeb',
                border: '1.5px solid #f59e0b',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '0.74rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontWeight: 900, color: '#92400e' }}>
                📅 Fermer une journée entière d’un seul coup (même si aucun créneau n’était encore enregistré ce jour-là) :
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setAddDayDate(yesterdayStr)}
                  style={{
                    padding: '5px 9px',
                    borderRadius: '5px',
                    border: addDayDate === yesterdayStr ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                    background: addDayDate === yesterdayStr ? '#fef3c7' : '#ffffff',
                    color: '#0f172a',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Hier ({yesterdayStr})
                </button>
                <button
                  type="button"
                  onClick={() => setAddDayDate(tdy())}
                  style={{
                    padding: '5px 9px',
                    borderRadius: '5px',
                    border: addDayDate === tdy() ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                    background: addDayDate === tdy() ? '#fef3c7' : '#ffffff',
                    color: '#0f172a',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Aujourd’hui ({tdy()})
                </button>
                <input
                  type="date"
                  value={addDayDate}
                  onChange={e => setAddDayDate(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700 }}
                />
              </div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                {allNonPublishChoices.map(reason => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setAddDayReason(reason)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: addDayReason === reason ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                      background: addDayReason === reason ? '#fef3c7' : '#ffffff',
                      color: addDayReason === reason ? '#92400e' : '#334155',
                      fontSize: '0.70rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  value={addDayReason}
                  onChange={e => setAddDayReason(e.target.value)}
                  placeholder="Motif (Impératif personnel, Vacances, Réunion...)"
                  style={{ flex: 1, minWidth: '200px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#0369a1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={addDaySyncRex}
                    onChange={e => setAddDaySyncRex(e.target.checked)}
                  />
                  <span>Inscrire aussi dans les REX (Stats)</span>
                </label>
                <button
                  type="button"
                  disabled={isBatchSaving}
                  onClick={handleCloseUnlistedDay}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#d97706',
                    color: '#ffffff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  {isBatchSaving ? 'Enregistrement…' : '🚫 Fermer toute cette journée & Valider'}
                </button>
              </div>
            </div>
          )}

          {unverifiedOkEntries.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                background: '#f0fdf4',
                border: '1px solid #86efac',
                borderRadius: '8px',
                padding: '7px 12px',
                fontSize: '0.74rem',
              }}
            >
              <span style={{ color: '#166534', fontWeight: 700 }}>
                💡 <strong>{unverifiedOkEntries.length}</strong> entrée{unverifiedOkEntries.length > 1 ? 's' : ''} déjà détectée{unverifiedOkEntries.length > 1 ? 's' : ''} comme 100 % cohérente{unverifiedOkEntries.length > 1 ? 's' : ''} n’ont pas encore reçu ton visa.
              </span>
              <button
                type="button"
                disabled={isBatchSaving}
                onClick={handleBatchApproveClean}
                style={{
                  background: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 11px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {isBatchSaving
                  ? 'Validation…'
                  : `✅ Tout valider les ${unverifiedOkEntries.length} cohérentes`}
              </button>
            </div>
          )}

          {actionError && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '7px 12px',
                borderRadius: '6px',
                fontSize: '0.74rem',
                fontWeight: 700,
              }}
            >
              {actionError}
            </div>
          )}
        </div>

        {/* LISTE DES ENTRÉES */}
        <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1, background: '#f1f5f9' }}>
          {filteredEntries.length === 0 ? (
            <div
              style={{
                background: '#ffffff',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '12px',
                padding: '36px 20px',
                textAlign: 'center',
                color: '#64748b',
              }}
            >
              <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>
                {report.totalCount === 0 ? '📭' : '✅'}
              </div>
              <div style={{ fontWeight: 900, fontSize: '0.96rem', color: '#0f172a' }}>
                {report.totalCount === 0
                  ? 'Aucune donnée historique trouvée dans la base'
                  : 'Aucune entrée ne correspond à ce filtre'}
              </div>
              <div style={{ fontSize: '0.76rem', marginTop: '4px' }}>
                {report.totalCount === 0
                  ? 'Dès que des journées Cycle 1, créneaux Cycle 2 ou relevés REX seront saisis, ils apparaîtront ici.'
                  : 'Utilise le bouton « Toutes » pour voir l’ensemble des données enregistrées.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {groupedDays.map(({ ds, filtered, allOfDay }) => {
                const isBulkOpen = bulkDayDs === ds && bulkDraft !== null;
                const dayVerifiedCount = allOfDay.filter(e => e.isVerified).length;
                const dayConflictCount = allOfDay.filter(e => e.severity === 'conflict').length;
                const dayWarningCount = allOfDay.filter(e => e.severity === 'warning').length;
                const allDayVerified = allOfDay.length > 0 && dayVerifiedCount === allOfDay.length;

                return (
                  <div
                    key={ds}
                    style={{
                      background: '#e2e8f0',
                      borderRadius: '14px',
                      border: '1.5px solid #cbd5e1',
                      overflow: 'hidden',
                    }}
                  >
                    {/* EN-TÊTE DE JOURNÉE AVEC ACTION EN 1 FOIS */}
                    <div
                      style={{
                        background: '#1e293b',
                        color: '#ffffff',
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.92rem' }}>📅 {formatDateFr(ds)}</strong>
                        <span
                          style={{
                            background: '#334155',
                            color: '#e2e8f0',
                            padding: '2px 8px',
                            borderRadius: '5px',
                            fontSize: '0.70rem',
                            fontWeight: 800,
                          }}
                        >
                          {allOfDay.length} créneau{allOfDay.length > 1 ? 'x' : ''}
                        </span>
                        {dayConflictCount > 0 && (
                          <span style={{ background: '#991b1b', color: '#fee2e2', padding: '2px 7px', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 800 }}>
                            🔴 {dayConflictCount}
                          </span>
                        )}
                        {dayWarningCount > 0 && (
                          <span style={{ background: '#92400e', color: '#fef3c7', padding: '2px 7px', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 800 }}>
                            🟠 {dayWarningCount}
                          </span>
                        )}
                        <span
                          style={{
                            background: allDayVerified ? '#065f46' : '#0f172a',
                            color: allDayVerified ? '#a7f3d0' : '#94a3b8',
                            padding: '2px 8px',
                            borderRadius: '5px',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                          }}
                        >
                          ✅ {dayVerifiedCount}/{allOfDay.length} validé{dayVerifiedCount > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={isBatchSaving}
                          onClick={() =>
                            isBulkOpen ? (setBulkDayDs(null), setBulkDraft(null)) : openBulkDayEditor(ds, allOfDay)
                          }
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: 'none',
                            background: isBulkOpen ? '#f59e0b' : '#0284c7',
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                          title="Appliquer le même statut/motif à tous les créneaux de la journée en une seule fois (ex: journée entièrement fermée)"
                        >
                          {isBulkOpen
                            ? 'Fermer édition journée'
                            : `⚡ Valider / uniformiser la journée (${allOfDay.length})`}
                        </button>

                        {!allDayVerified && (
                          <button
                            type="button"
                            disabled={isBatchSaving}
                            onClick={() => handleValidateWholeDay(allOfDay, true)}
                            style={{
                              padding: '5px 9px',
                              borderRadius: '6px',
                              border: 'none',
                              background: '#16a34a',
                              color: '#ffffff',
                              fontSize: '0.70rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            ✅ Valider le jour
                          </button>
                        )}

                        {dayVerifiedCount > 0 && (
                          <button
                            type="button"
                            disabled={isBatchSaving}
                            onClick={() => handleValidateWholeDay(allOfDay, false)}
                            style={{
                              padding: '5px 9px',
                              borderRadius: '6px',
                              border: '1px solid #64748b',
                              background: '#334155',
                              color: '#e2e8f0',
                              fontSize: '0.70rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                            title="Retirer les visas de cette journée pour réexamen"
                          >
                            ↩️ Retirer visas du jour
                          </button>
                        )}
                      </div>
                    </div>

                    {/* PANNEAU BULK JOURNÉE ENTIÈRE */}
                    {isBulkOpen && bulkDraft && (
                      <div
                        style={{
                          background: '#fffbeb',
                          borderBottom: '2px solid #f59e0b',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          fontSize: '0.74rem',
                        }}
                      >
                        <div style={{ fontWeight: 900, color: '#92400e', fontSize: '0.82rem' }}>
                          ⚡ Traitement groupé pour toute la journée du {formatDateFr(ds)} ({allOfDay.length} créneaux) :
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#78350f' }}>
                          Pratique si tous les créneaux du jour partagent la même situation (ex. journée entièrement fermée pour impératif personnel, déplacement, vacances ou météo). L’horaire propre à chaque créneau est automatiquement conservé.
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                            Décision Cycle 1 pour toute la journée :
                            <select
                              value={bulkDraft.c1Status}
                              onChange={e =>
                                setBulkDraft({
                                  ...bulkDraft,
                                  c1Status: e.target.value as DayBulkDraftState['c1Status'],
                                })
                              }
                              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, background: '#fff' }}
                            >
                              <option value="not_published">🚫 Journée fermée · À ne pas publier (motif perso/école)</option>
                              <option value="excluded">➖ Hors offre / Non pertinent (exclu des stats)</option>
                              <option value="closed_no_bookings">🌑 Clôturée faute d’inscrits (Vie 1)</option>
                              <option value="published">✅ Publiée (Cycle 1 ouvert)</option>
                            </select>
                          </label>

                          {bulkDraft.c1Status === 'published' && (
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                              Statut Cycle 2 pour toute la journée :
                              <select
                                value={bulkDraft.c2Status}
                                onChange={e =>
                                  setBulkDraft({
                                    ...bulkDraft,
                                    c2Status: e.target.value as DayBulkDraftState['c2Status'],
                                  })
                                }
                                style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, background: '#fff' }}
                              >
                                <option value="awaiting_booking">📅 Cycle 1 publié (prêt C2)</option>
                                <option value="confirmed">⚡ Maintenu</option>
                                <option value="realized">🏁 Réalisé</option>
                                <option value="cancelled_weather">⛔ Annulé Météo / Plage (Vie 2)</option>
                              </select>
                            </label>
                          )}

                          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                            Moniteur principal :
                            <input
                              type="text"
                              value={bulkDraft.instructor}
                              onChange={e => setBulkDraft({ ...bulkDraft, instructor: e.target.value })}
                              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
                            />
                          </label>
                        </div>

                        {bulkDraft.c1Status === 'not_published' && (
                          <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fcd34d' }}>
                            <div style={{ fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                              Motif de fermeture appliqué à toute la journée (pour les Statistiques) :
                            </div>
                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '6px' }}>
                              {allNonPublishChoices.map(reason => (
                                <button
                                  key={reason}
                                  type="button"
                                  onClick={() => setBulkDraft({ ...bulkDraft, nonPublishReason: reason })}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '5px',
                                    border: bulkDraft.nonPublishReason === reason ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                                    background: bulkDraft.nonPublishReason === reason ? '#fef3c7' : '#f8fafc',
                                    color: bulkDraft.nonPublishReason === reason ? '#92400e' : '#334155',
                                    fontSize: '0.70rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {reason}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              value={bulkDraft.nonPublishReason}
                              onChange={e => setBulkDraft({ ...bulkDraft, nonPublishReason: e.target.value })}
                              placeholder="Ex: Impératif personnel, Réunion, Vacances..."
                              style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.74rem' }}
                            />
                          </div>
                        )}

                        {bulkDraft.c1Status === 'published' && bulkDraft.c2Status === 'cancelled_weather' && (
                          <div style={{ background: '#fef2f2', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
                            <div style={{ fontWeight: 800, color: '#991b1b', marginBottom: '5px' }}>
                              Cause météo appliquée à toute la journée :
                            </div>
                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '6px' }}>
                              {C2_WEATHER_REASONS.map(r => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setBulkDraft({ ...bulkDraft, weatherReason: r })}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '5px',
                                    border: bulkDraft.weatherReason === r ? '1.5px solid #dc2626' : '1px solid #fca5a5',
                                    background: bulkDraft.weatherReason === r ? '#fee2e2' : '#fff',
                                    color: '#991b1b',
                                    fontSize: '0.70rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {r}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              value={bulkDraft.weatherReason}
                              onChange={e => setBulkDraft({ ...bulkDraft, weatherReason: e.target.value })}
                              style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid #fca5a5', fontSize: '0.74rem' }}
                            />
                          </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 700, color: '#0369a1' }}>
                            <span>🔄 Synchronisation Observations REX (Statistiques) :</span>
                            <select
                              value={bulkDraft.syncObservationsMode}
                              onChange={e =>
                                setBulkDraft({
                                  ...bulkDraft,
                                  syncObservationsMode: e.target.value as DayBulkDraftState['syncObservationsMode'],
                                })
                              }
                              style={{ padding: '4px 8px', borderRadius: '5px', border: '1px solid #bae6fd', background: '#fff', fontWeight: 700 }}
                            >
                              <option value="existing_only">Mettre à jour les REX déjà existants ce jour</option>
                              <option value="all_slots">Créer / aligner un REX sur chacun des {allOfDay.length} créneaux</option>
                              <option value="none">Ne modifier que Cycle 1 / Cycle 2 (validations)</option>
                            </select>
                          </label>

                          {allOfDay.some(e => e.computedMatch && !e.computedMatch.isExactKeyMatch) && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 800, color: '#b45309', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={bulkDraft.realignSlotKeys}
                                onChange={e => setBulkDraft({ ...bulkDraft, realignSlotKeys: e.target.checked })}
                              />
                              <span>🔗 Réaligner automatiquement les clés décalées sur la grille marée actuelle</span>
                            </label>
                          )}
                        </div>

                        <input
                          type="text"
                          value={bulkDraft.auditNote}
                          onChange={e => setBulkDraft({ ...bulkDraft, auditNote: e.target.value })}
                          placeholder="Note de synthèse pour la journée (ex: Jérôme à Paris pour raison perso — journée fermée)..."
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
                        />

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setBulkDayDs(null);
                              setBulkDraft(null);
                            }}
                            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            disabled={isBatchSaving}
                            onClick={() => handleSaveBulkDay(ds, allOfDay)}
                            style={{
                              padding: '7px 14px',
                              borderRadius: '6px',
                              border: 'none',
                              background: '#d97706',
                              color: '#ffffff',
                              fontWeight: 900,
                              cursor: 'pointer',
                              boxShadow: '0 2px 8px rgba(217, 119, 6, 0.3)',
                            }}
                          >
                            {isBatchSaving
                              ? 'Application…'
                              : `💾 Appliquer à toute la journée (${allOfDay.length} créneaux) & Valider`}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* CRÉNEAUX DE LA JOURNÉE */}
                    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {filtered.map(entry => {
                        const badge = severityBadge(entry.severity);
                        const isEditing = editingEntryKey === entry.entryKey && draft !== null;
                        const isRowBusy = savingKey === entry.entryKey;
                        const valChars = getValidationItemChars(entry.valItem);

                        return (
                          <div
                            key={entry.entryKey}
                            style={{
                              background: '#ffffff',
                              borderRadius: '10px',
                              border: entry.isVerified
                                ? '1.5px solid #86efac'
                                : entry.severity === 'conflict'
                                ? '2px solid #ef4444'
                                : entry.severity === 'warning'
                                ? '1.5px solid #f59e0b'
                                : '1.5px solid #cbd5e1',
                              padding: '12px 14px',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                            }}
                          >
                    {/* Ligne de titre */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.90rem', color: '#0f172a' }}>
                          📅 {formatDateFr(entry.ds)}
                        </strong>
                        <span
                          style={{
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '2px 8px',
                            borderRadius: '5px',
                            fontSize: '0.74rem',
                            fontWeight: 900,
                          }}
                        >
                          🕒 {entry.displayTime}
                        </span>
                        <code
                          style={{
                            background: '#f1f5f9',
                            color: '#64748b',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.66rem',
                          }}
                          title="Identifiant technique du créneau"
                        >
                          #{entry.slotKey}
                        </code>
                        <span
                          style={{
                            background: badge.bg,
                            color: badge.fg,
                            border: `1px solid ${badge.bd}`,
                            padding: '2px 8px',
                            borderRadius: '5px',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                          }}
                        >
                          {badge.label}
                        </span>
                        {entry.isVerified && (
                          <span
                            style={{
                              background: '#ecfdf5',
                              color: '#065f46',
                              border: '1px solid #6ee7b7',
                              padding: '2px 8px',
                              borderRadius: '5px',
                              fontSize: '0.68rem',
                              fontWeight: 900,
                            }}
                          >
                            ✅ Validé par {entry.signOff?.verifiedBy || 'Jérôme'}
                            {entry.signOff?.verifiedAt
                              ? ` le ${new Date(entry.signOff.verifiedAt).toLocaleDateString('fr-FR')}`
                              : ''}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={isRowBusy}
                          onClick={() => handleToggleSignOff(entry)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: entry.isVerified ? '1px solid #cbd5e1' : 'none',
                            background: entry.isVerified ? '#f8fafc' : '#16a34a',
                            color: entry.isVerified ? '#475569' : '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {entry.isVerified ? '↩️ Retirer visa' : '✅ Valider telle quelle'}
                        </button>

                        <button
                          type="button"
                          disabled={isRowBusy}
                          onClick={() =>
                            isEditing ? (setEditingEntryKey(null), setDraft(null)) : openEditor(entry)
                          }
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1.5px solid #0284c7',
                            background: isEditing ? '#0284c7' : '#f0f9ff',
                            color: isEditing ? '#ffffff' : '#0369a1',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {isEditing ? 'Fermer édition' : '✏️ Modifier / Mettre en cohérence'}
                        </button>
                      </div>
                    </div>

                    {/* Grille comparative des 3 sources */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '8px',
                        marginBottom: entry.issues.length > 0 || entry.signOff?.note ? '8px' : 0,
                      }}
                    >
                      {/* Colonne 1 : Validations Cycle 1/2 */}
                      <div
                        style={{
                          background: entry.valItem ? '#f8fafc' : '#fef2f2',
                          border: `1px solid ${entry.valItem ? '#e2e8f0' : '#fecaca'}`,
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div style={{ fontWeight: 900, color: '#0f172a', marginBottom: '3px' }}>
                          📋 Cycle 1 / Cycle 2 (validations)
                        </div>
                        {entry.valItem ? (
                          <div style={{ color: '#334155', lineHeight: 1.45 }}>
                            <div>
                              <strong>Statut :</strong> {entry.summaryStatusLabel}
                            </div>
                            <div>
                              <strong>Matériel :</strong> {valChars.totalChars} char(s) ({valChars.mono} mono + {valChars.bi} bi · {entry.valItem.pilotsCount ?? valChars.people} pers.)
                            </div>
                            <div>
                              <strong>Moniteur(s) :</strong> {entry.valItem.instructor || entry.valItem.assignedPilot || 'Jérôme'}
                              {entry.valItem.secondaryInstructor ? ` + ${entry.valItem.secondaryInstructor}` : ''}
                            </div>
                            {entry.valItem.rejectReason && (
                              <div style={{ color: '#991b1b' }}>
                                <strong>Motif brut :</strong> {entry.valItem.rejectReason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ color: '#991b1b', fontWeight: 700 }}>
                            ❌ Aucune fiche Cycle 1 / Cycle 2 trouvée pour ce créneau.
                          </div>
                        )}
                      </div>

                      {/* Colonne 2 : Observation REX */}
                      <div
                        style={{
                          background: entry.obs ? '#f0f9ff' : '#f8fafc',
                          border: `1px solid ${entry.obs ? '#bae6fd' : '#e2e8f0'}`,
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div style={{ fontWeight: 900, color: '#0369a1', marginBottom: '3px' }}>
                          📝 Observation REX terrain
                        </div>
                        {entry.obs ? (
                          <div style={{ color: '#334155', lineHeight: 1.45 }}>
                            <div>
                              <strong>Statut REX :</strong>{' '}
                              {entry.obs.status === 'realized' ? '🏁 Réalisée' : `⛔ Annulée (${entry.obs.cancellationReason || 'non précisé'})`}
                            </div>
                            {entry.obs.cancellationNote && (
                              <div>
                                <strong>Précision :</strong> « {entry.obs.cancellationNote} »
                              </div>
                            )}
                            <div>
                              <strong>Matériel REX :</strong> {entry.obs.charsCount ?? ((entry.obs.monoCount || 0) + (entry.obs.biCount || 0))} char(s) · {entry.obs.participantsCount ?? 0} pilote(s)
                            </div>
                            {(entry.obs.waterDeltaCm != null || entry.obs.notes) && (
                              <div style={{ color: '#475569' }}>
                                {entry.obs.waterDeltaCm != null ? `Marée Δ ${entry.obs.waterDeltaCm > 0 ? '+' : ''}${entry.obs.waterDeltaCm} cm` : ''}
                                {entry.obs.waterDeltaCm != null && entry.obs.notes ? ' · ' : ''}
                                {entry.obs.notes ? `Note : ${entry.obs.notes}` : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ color: '#64748b' }}>— Aucun REX saisi sur ce créneau.</div>
                        )}
                      </div>

                      {/* Colonne 3 : Réservations clients */}
                      <div
                        style={{
                          background: entry.bookingSummary.totalChars > 0 ? '#f0fdf4' : '#f8fafc',
                          border: `1px solid ${entry.bookingSummary.totalChars > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div style={{ fontWeight: 900, color: '#166534', marginBottom: '3px' }}>
                          👥 Inscriptions clients
                        </div>
                        {entry.bookings.length > 0 ? (
                          <div style={{ color: '#334155', lineHeight: 1.45 }}>
                            <div>
                              <strong>{entry.bookings.length} dossier(s) :</strong> {entry.bookingSummary.totalChars} char(s) ({entry.bookingSummary.mono} mono + {entry.bookingSummary.bi} bi)
                            </div>
                            <div style={{ color: '#475569' }}>
                              {entry.bookings.map(b => b.name).filter(Boolean).join(', ')}
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: '#64748b' }}>— 0 fiche client saisie dans l’app.</div>
                        )}
                      </div>
                    </div>

                    {/* Liste des anomalies détectées */}
                    {entry.issues.length > 0 && (
                      <div
                        style={{
                          background: entry.severity === 'conflict' ? '#fef2f2' : '#fffbeb',
                          border: `1px solid ${entry.severity === 'conflict' ? '#fecaca' : '#fde68a'}`,
                          borderRadius: '8px',
                          padding: '7px 10px',
                          fontSize: '0.72rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        {entry.issues.map((iss, idx) => (
                          <div
                            key={idx}
                            style={{ color: iss.level === 'conflict' ? '#991b1b' : '#92400e' }}
                          >
                            <strong>{iss.level === 'conflict' ? '⚠️' : 'ℹ️'} {iss.label} :</strong> {iss.detail}
                          </div>
                        ))}
                      </div>
                    )}

                    {entry.signOff?.note && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '0.70rem',
                          color: '#065f46',
                          background: '#ecfdf5',
                          padding: '5px 9px',
                          borderRadius: '6px',
                          borderLeft: '3px solid #10b981',
                        }}
                      >
                        <strong>Note de validation :</strong> {entry.signOff.note}
                      </div>
                    )}

                    {/* ÉDITEUR INLINE DE MISE EN COHÉRENCE */}
                    {isEditing && draft && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '12px',
                          borderRadius: '10px',
                          background: '#f0f9ff',
                          border: '1.5px solid #0284c7',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          fontSize: '0.74rem',
                        }}
                      >
                        <div style={{ fontWeight: 900, color: '#0369a1', fontSize: '0.82rem' }}>
                          ✏️ Mettre en cohérence ce créneau dans le modèle Cycle 1 / Cycle 2
                        </div>

                        {/* Ligne 1 : Décision Cycle 1 & Cycle 2 */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                            Étape 1 · Décision Cycle 1 :
                            <select
                              value={draft.c1Status}
                              onChange={e =>
                                setDraft({
                                  ...draft,
                                  c1Status: e.target.value as EditDraftState['c1Status'],
                                })
                              }
                              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, background: '#fff' }}
                            >
                              <option value="published">✅ Publié (Cycle 1 ouvert)</option>
                              <option value="excluded">➖ Hors offre / Non pertinent (exclu des stats)</option>
                              <option value="not_published">🚫 À ne pas publier (motif perso/école)</option>
                              <option value="closed_no_bookings">🌑 Clôturé faute d’inscrits (Vie 1)</option>
                            </select>
                          </label>

                          {draft.c1Status === 'published' && (
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                              Étape 2 · Statut Cycle 2 :
                              <select
                                value={draft.c2Status}
                                onChange={e =>
                                  setDraft({
                                    ...draft,
                                    c2Status: e.target.value as EditDraftState['c2Status'],
                                  })
                                }
                                style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, background: '#fff' }}
                              >
                                <option value="awaiting_booking">📅 Cycle 1 publié (prêt C2)</option>
                                <option value="confirmed">⚡ Maintenu</option>
                                <option value="shifted">🕒 Décalé</option>
                                <option value="realized">🏁 Réalisé</option>
                                <option value="cancelled_weather">⛔ Annulé Météo / Plage (Vie 2)</option>
                              </select>
                            </label>
                          )}
                        </div>

                        {/* Motif si À ne pas publier (Cycle 1) */}
                        {draft.c1Status === 'not_published' && (
                          <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                            <div style={{ fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                              Motif de non-publication (Cycle 1) :
                            </div>
                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '6px' }}>
                              {allNonPublishChoices.map(reason => (
                                <button
                                  key={reason}
                                  type="button"
                                  onClick={() => setDraft({ ...draft, nonPublishReason: reason })}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '5px',
                                    border: draft.nonPublishReason === reason ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                                    background: draft.nonPublishReason === reason ? '#e0f2fe' : '#f8fafc',
                                    color: draft.nonPublishReason === reason ? '#0369a1' : '#334155',
                                    fontSize: '0.70rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {reason}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              value={draft.nonPublishReason}
                              onChange={e => setDraft({ ...draft, nonPublishReason: e.target.value })}
                              placeholder="Préciser le motif (Réunion, Impératif personnel, Vacances...)"
                              style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.74rem' }}
                            />
                          </div>
                        )}

                        {/* Cause météo si Annulé Vie 2 */}
                        {draft.c1Status === 'published' && draft.c2Status === 'cancelled_weather' && (
                          <div style={{ background: '#fef2f2', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fca5a5', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontWeight: 800, color: '#991b1b' }}>
                              Motif d’annulation Météo / Terrain (Vie 2) :
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              {C2_WEATHER_REASONS.map(r => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setDraft({ ...draft, weatherReason: r })}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '5px',
                                    border: draft.weatherReason === r ? '1.5px solid #dc2626' : '1px solid #fca5a5',
                                    background: draft.weatherReason === r ? '#fee2e2' : '#fff',
                                    color: '#991b1b',
                                    fontSize: '0.70rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {r}
                                </button>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <input
                                type="text"
                                value={draft.weatherReason}
                                onChange={e => setDraft({ ...draft, weatherReason: e.target.value })}
                                placeholder="Précision météo..."
                                style={{ flex: 1, minWidth: '180px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #fca5a5', fontSize: '0.74rem' }}
                              />
                              <label style={{ fontWeight: 700, color: '#166534' }}>
                                Replacés :
                                <input
                                  type="number"
                                  min={0}
                                  value={draft.rescheduledChars}
                                  onChange={e => setDraft({ ...draft, rescheduledChars: Math.max(0, Number(e.target.value) || 0) })}
                                  style={{ width: '50px', marginLeft: '4px', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                />
                              </label>
                              <label style={{ fontWeight: 700, color: '#991b1b' }}>
                                Perdus :
                                <input
                                  type="number"
                                  min={0}
                                  value={draft.lostChars}
                                  onChange={e => setDraft({ ...draft, lostChars: Math.max(0, Number(e.target.value) || 0) })}
                                  style={{ width: '50px', marginLeft: '4px', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                />
                              </label>
                            </div>
                          </div>
                        )}

                        {/* Horaires & Matériel & Moniteurs */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                          <label style={{ fontWeight: 700 }}>
                            Début C1 :
                            <input
                              type="text"
                              value={draft.publishedStart}
                              onChange={e => setDraft({ ...draft, publishedStart: e.target.value })}
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <label style={{ fontWeight: 700 }}>
                            Fin C1 :
                            <input
                              type="text"
                              value={draft.publishedEnd}
                              onChange={e => setDraft({ ...draft, publishedEnd: e.target.value })}
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          {draft.c1Status === 'published' && draft.c2Status === 'shifted' && (
                            <>
                              <label style={{ fontWeight: 700 }}>
                                Début C2 réel :
                                <input
                                  type="text"
                                  value={draft.actualStart}
                                  onChange={e => setDraft({ ...draft, actualStart: e.target.value })}
                                  style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #f59e0b' }}
                                />
                              </label>
                              <label style={{ fontWeight: 700 }}>
                                Fin C2 réelle :
                                <input
                                  type="text"
                                  value={draft.actualEnd}
                                  onChange={e => setDraft({ ...draft, actualEnd: e.target.value })}
                                  style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #f59e0b' }}
                                />
                              </label>
                            </>
                          )}
                          <label style={{ fontWeight: 700 }}>
                            Monoplaces :
                            <input
                              type="number"
                              min={0}
                              max={24}
                              value={draft.monoCount}
                              onChange={e => {
                                const mono = Math.max(0, Number(e.target.value) || 0);
                                setDraft({
                                  ...draft,
                                  monoCount: mono,
                                  pilotsCount: mono + draft.biCount * 2,
                                });
                              }}
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <label style={{ fontWeight: 700 }}>
                            Biplaces :
                            <input
                              type="number"
                              min={0}
                              max={24}
                              value={draft.biCount}
                              onChange={e => {
                                const bi = Math.max(0, Number(e.target.value) || 0);
                                setDraft({
                                  ...draft,
                                  biCount: bi,
                                  pilotsCount: draft.monoCount + bi * 2,
                                });
                              }}
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <label style={{ fontWeight: 700 }}>
                            Pilotes / pers. :
                            <input
                              type="number"
                              min={0}
                              max={48}
                              value={draft.pilotsCount}
                              onChange={e => setDraft({ ...draft, pilotsCount: Math.max(0, Number(e.target.value) || 0) })}
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <label style={{ fontWeight: 700 }}>
                            Moniteur 1 :
                            <input
                              type="text"
                              value={draft.instructor}
                              onChange={e => setDraft({ ...draft, instructor: e.target.value })}
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <label style={{ fontWeight: 700 }}>
                            2e moniteur :
                            <input
                              type="text"
                              value={draft.secondaryInstructor}
                              onChange={e => setDraft({ ...draft, secondaryInstructor: e.target.value })}
                              placeholder="Optionnel (Youenn...)"
                              style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                        </div>

                        {draft.monoCount + draft.biCount >
                          (draft.secondaryInstructor.trim()
                            ? MAX_CHARS_PER_INSTRUCTOR + 12
                            : MAX_CHARS_PER_INSTRUCTOR) && (
                          <div style={{ color: '#991b1b', fontWeight: 800, fontSize: '0.72rem' }}>
                            ⚠️ Total {draft.monoCount + draft.biCount} chars : dépasse le plafond sans 2e moniteur renseigné.
                          </div>
                        )}

                        {/* Options de réalignement & synchronisation REX */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {entry.computedMatch && !entry.computedMatch.isExactKeyMatch && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 800, color: '#b45309', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={draft.realignSlotKey}
                                onChange={e => setDraft({ ...draft, realignSlotKey: e.target.checked })}
                              />
                              <span>
                                🔗 Réaligner la clé du créneau sur la grille actuelle ({entry.computedMatch.slotKey} · {entry.computedMatch.startTime}–{entry.computedMatch.endTime})
                              </span>
                            </label>
                          )}

                          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 700, color: '#0369a1', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={draft.syncObservation}
                              onChange={e => setDraft({ ...draft, syncObservation: e.target.checked })}
                            />
                            <span>
                              🔄 {entry.obs ? 'Mettre aussi à jour l’Observation REX existante pour garantir 100 % de cohérence' : 'Créer aussi une fiche Observation REX cohérente avec cette correction'}
                            </span>
                          </label>
                        </div>

                        <label style={{ fontWeight: 700 }}>
                          Commentaire de validation / traçabilité (optionnel) :
                          <input
                            type="text"
                            value={draft.auditNote}
                            onChange={e => setDraft({ ...draft, auditNote: e.target.value })}
                            placeholder="Ex: Motif Fermé reclassé en Réunion · Chars alignés avec le cahier..."
                            style={{ width: '100%', marginTop: '3px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                          />
                        </label>

                        {/* Boutons bas du formulaire */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
                          <div>
                            {confirmDeleteKey === entry.entryKey ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: '#991b1b', fontWeight: 800 }}>Supprimer définitivement ?</span>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => handleDeleteEntry(entry)}
                                  style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                                >
                                  Oui, supprimer
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteKey(null)}
                                  style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
                                >
                                  Non
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteKey(entry.entryKey)}
                                style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}
                                title="Supprimer un ancien test ou doublon inutile"
                              >
                                🗑️ Supprimer l’entrée
                              </button>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingEntryKey(null);
                                setDraft(null);
                                setConfirmDeleteKey(null);
                              }}
                              style={{ padding: '7px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                            >
                              Annuler
                            </button>
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => handleSaveReconciledEntry(entry)}
                              style={{
                                padding: '7px 14px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#0284c7',
                                color: '#ffffff',
                                fontWeight: 900,
                                cursor: 'pointer',
                                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)',
                              }}
                            >
                              {isRowBusy ? 'Enregistrement…' : '💾 Enregistrer & Valider comme cohérente'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
