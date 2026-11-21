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
  formatObsReasonFr,
} from '../utils/dataAuditEngine';
import {
  computeShiftMinutes,
  DEFAULT_NON_PUBLISH_REASONS,
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getObservationChars,
  getSlotMaxCapacity,
  getValidationItemChars,
  normalizeClosureReason,
  SECONDARY_INSTRUCTOR_PRESETS,
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

type ReconciliationSituation =
  | 'realized'
  | 'cancelled_weather'
  | 'closed_no_bookings'
  | 'not_published'
  | 'excluded'
  | 'shifted'
  | 'open_active';

type BulkDaySituation =
  | 'not_published'
  | 'excluded'
  | 'closed_no_bookings'
  | 'cancelled_weather'
  | 'open_active'
  | 'realized';

const SITUATION_META: Record<
  ReconciliationSituation,
  { label: string; short: string; group: string; badgeBg: string; badgeFg: string; border: string }
> = {
  realized: {
    label: '🏁 Séance effectuée (roulée)',
    short: 'Séance effectuée',
    group: 'Bilan final',
    badgeBg: '#dcfce7',
    badgeFg: '#166534',
    border: '#16a34a',
  },
  cancelled_weather: {
    label: '⛔ Annulée · Météo / État plage',
    short: 'Annulée météo',
    group: 'Bilan final',
    badgeBg: '#fee2e2',
    badgeFg: '#991b1b',
    border: '#dc2626',
  },
  closed_no_bookings: {
    label: '👥 Annulée · Pas d’inscrits',
    short: 'Pas d’inscrits',
    group: 'Commercial / Clients',
    badgeBg: '#f3e8ff',
    badgeFg: '#6b21a8',
    border: '#9333ea',
  },
  not_published: {
    label: '🚫 École fermée · Non publié',
    short: 'École fermée',
    group: 'Offre école',
    badgeBg: '#fef3c7',
    badgeFg: '#92400e',
    border: '#d97706',
  },
  excluded: {
    label: '➖ Hors offre (exclu des stats)',
    short: 'Hors offre',
    group: 'Offre école',
    badgeBg: '#f1f5f9',
    badgeFg: '#334155',
    border: '#64748b',
  },
  shifted: {
    label: '🕒 Séance décalée (horaire modifié)',
    short: 'Séance décalée',
    group: 'En cours / Terrain',
    badgeBg: '#ffedd5',
    badgeFg: '#9a3412',
    border: '#ea580c',
  },
  open_active: {
    label: '📅 À venir / Inscriptions en cours',
    short: 'Ouvert / En cours',
    group: 'Planning actif',
    badgeBg: '#e0f2fe',
    badgeFg: '#0369a1',
    border: '#0284c7',
  },
};

const normalizeTimeHHhMM = (raw?: string): string | null => {
  const clean = (raw || '').trim().toLowerCase().replace(':', 'h');
  const m = clean.match(/^(\d{1,2})h(\d{0,2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}`;
};

const timeToMinutes = (raw?: string): number | null => {
  const norm = normalizeTimeHHhMM(raw);
  if (!norm) return null;
  const [h, m] = norm.split('h').map(Number);
  return h * 60 + m;
};

const mapSituationToCycleStates = (
  situation: ReconciliationSituation | BulkDaySituation,
  totalChars: number
): {
  c1Status: 'published' | 'not_published' | 'excluded' | 'closed_no_bookings';
  c2Status?: 'awaiting_booking' | 'confirmed' | 'shifted' | 'cancelled_weather' | 'realized';
  isRejected: boolean;
} => {
  switch (situation) {
    case 'realized':
      return { c1Status: 'published', c2Status: 'realized', isRejected: false };
    case 'shifted':
      return { c1Status: 'published', c2Status: 'shifted', isRejected: false };
    case 'open_active':
      return {
        c1Status: 'published',
        c2Status: totalChars > 0 ? 'confirmed' : 'awaiting_booking',
        isRejected: false,
      };
    case 'cancelled_weather':
      return { c1Status: 'published', c2Status: 'cancelled_weather', isRejected: true };
    case 'closed_no_bookings':
      return { c1Status: 'closed_no_bookings', isRejected: true };
    case 'not_published':
      return { c1Status: 'not_published', isRejected: true };
    case 'excluded':
      return { c1Status: 'excluded', isRejected: true };
  }
};

interface EditDraftState {
  situation: ReconciliationSituation;
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
  secondaryQualification?: 'CQP' | 'DE_BPJEPS';
  secondaryMaxChars?: number;
  realignSlotKey: boolean;
  syncObservation: boolean;
  auditNote: string;
}

interface DayBulkDraftState {
  situation: BulkDaySituation;
  nonPublishReason: string;
  weatherReason: string;
  instructor: string;
  secondaryInstructor: string;
  secondaryQualification?: 'CQP' | 'DE_BPJEPS';
  secondaryMaxChars?: number;
  realignSlotKeys: boolean;
  syncObservationsMode: 'existing_only' | 'all_slots';
  auditNote: string;
}

const mapWeatherTextToCancellationReason = (text: string): CancellationReason => {
  const low = (text || '').toLowerCase();
  if (low.includes('fort') || low.includes('rafale') || low.includes('tempête')) return 'wind_high';
  if (low.includes('faible') || low.includes('pétole') || low.includes('sans vent') || low.includes('insuffisant')) return 'wind_low';
  if (low.includes('secteur') || low.includes('dévent') || low.includes('terre')) return 'wind_dir';
  if (low.includes('plage') || low.includes('bâche') || low.includes('caillou') || low.includes('sable')) return 'beach_state';
  if (low.includes('orage') || low.includes('pluie') || low.includes('submersion') || low.includes('houle')) return 'weather_extreme';
  return 'other';
};

const mapCancellationReasonToWeatherText = (reason?: CancellationReason): string => {
  switch (reason) {
    case 'wind_high':
      return C2_WEATHER_REASONS[1];
    case 'wind_dir':
      return C2_WEATHER_REASONS[2];
    case 'beach_state':
      return C2_WEATHER_REASONS[3];
    case 'weather_extreme':
      return C2_WEATHER_REASONS[4];
    case 'wind_low':
    default:
      return C2_WEATHER_REASONS[0];
  }
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
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedEntryKey, setCopiedEntryKey] = useState<string | null>(null);
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
  const [showPedagogyGuide, setShowPedagogyGuide] = useState<boolean>(false);
  const [showChecklistPanel, setShowChecklistPanel] = useState<boolean>(false);
  const [checklistCopied, setChecklistCopied] = useState<boolean>(false);

  const allNonPublishChoices = useMemo(() => {
    const merged = [...DEFAULT_NON_PUBLISH_REASONS, ...customNonPublishReasons];
    return Array.from(new Set(merged));
  }, [customNonPublishReasons]);

  const availableMonths = useMemo(() => {
    const map: Record<
      string,
      { ym: string; label: string; total: number; conflicts: number; warnings: number }
    > = {};
    report.entries.forEach(e => {
      if (!e.ds || e.ds.length < 7) return;
      const ym = e.ds.slice(0, 7);
      if (!map[ym]) {
        const dt = new Date(`${ym}-15T12:00:00`);
        const raw = Number.isNaN(dt.getTime())
          ? ym
          : dt.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        map[ym] = { ym, label, total: 0, conflicts: 0, warnings: 0 };
      }
      map[ym].total += 1;
      if (e.severity === 'conflict') map[ym].conflicts += 1;
      else if (e.severity === 'warning') map[ym].warnings += 1;
    });
    return Object.values(map).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [report.entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.entries.filter(entry => {
      if (monthFilter !== 'all' && !entry.ds.startsWith(monthFilter)) return false;
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
  }, [report.entries, filterMode, monthFilter, searchQuery]);

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

  const checklistEntries = useMemo(
    () =>
      report.entries.filter(
        e => e.severity === 'conflict' || (e.severity === 'warning' && !e.isVerified)
      ),
    [report.entries]
  );

  const checklistText = useMemo(() => {
    if (checklistEntries.length === 0) {
      return `✅ Aucune anomalie à corriger sur les ${report.daysAnalyzed} journées (${report.totalCount} créneaux) analysées !`;
    }
    const conflicts = checklistEntries.filter(e => e.severity === 'conflict');
    const warnings = checklistEntries.filter(e => e.severity === 'warning');
    const byDate = new Map<string, AuditSlotEntry[]>();
    checklistEntries.forEach(e => {
      const list = byDate.get(e.ds) || [];
      list.push(e);
      byDate.set(e.ds, list);
    });
    const datesSorted = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));
    const lines: string[] = [
      `LISTE DES CORRECTIONS À FAIRE (${checklistEntries.length} créneau${checklistEntries.length > 1 ? 'x' : ''} sur ${datesSorted.length} journée${datesSorted.length > 1 ? 's' : ''})`,
      `• 🔴 Contradictions prioritaires : ${conflicts.length}`,
      `• 🟠 Points à préciser / vérifier : ${warnings.length}`,
      '',
    ];
    for (const ds of datesSorted) {
      const dayList = (byDate.get(ds) || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
      lines.push(`📅 ${formatDateFr(ds)} (${ds})`);
      for (const e of dayList) {
        const icon = e.severity === 'conflict' ? '🔴' : '🟠';
        const valChars = getValidationItemChars(e.valItem).totalChars;
        const obsChars = e.obs ? getObservationChars(e.obs) : null;
        const issueLabels = e.issues.map(i => i.label).join(' | ');
        lines.push(
          `  ${icon} ${e.displayTime} · ${e.summaryStatusLabel} · Planning=${valChars} ch. / Inscrits=${e.bookingSummary.totalChars} ch.${
            obsChars !== null ? ` / REX=${obsChars} ch.` : ''
          }`
        );
        if (issueLabels) {
          lines.push(`     → ${issueLabels}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }, [checklistEntries, report.daysAnalyzed, report.totalCount]);

  if (!isOpen) return null;

  const evaluateDraftCoherence = (
    d: EditDraftState,
    entry: AuditSlotEntry
  ): { blockingErrors: string[]; warnings: string[] } => {
    const blockingErrors: string[] = [];
    const warnings: string[] = [];
    const todayStr = tdy();

    const pStartMin = timeToMinutes(d.publishedStart);
    const pEndMin = timeToMinutes(d.publishedEnd);
    if (pStartMin === null || pEndMin === null) {
      blockingErrors.push('Format d’horaire invalide (utilise le format 10h00 ou 10:00).');
    } else if (pEndMin <= pStartMin) {
      blockingErrors.push('L’heure de fin doit être postérieure à l’heure de début.');
    }

    if (d.situation === 'shifted') {
      const aStartMin = timeToMinutes(d.actualStart);
      const aEndMin = timeToMinutes(d.actualEnd);
      if (aStartMin === null || aEndMin === null) {
        blockingErrors.push('Format de l’horaire décalé invalide (utilise 10h00 ou 10:00).');
      } else if (aEndMin <= aStartMin) {
        blockingErrors.push('L’heure de fin décalée doit être postérieure à l’heure de début décalée.');
      } else if (pStartMin !== null && pEndMin !== null && aStartMin === pStartMin && aEndMin === pEndMin) {
        warnings.push('L’horaire décalé est identique à l’horaire initial : si rien n’a bougé, choisis plutôt « Séance effectuée » ou « Ouvert / En cours ».');
      }
    }

    const totalChars = d.monoCount + d.biCount;

    if (d.situation === 'realized' && totalChars <= 0) {
      blockingErrors.push(
        'Une séance effectuée doit compter au moins 1 char (mono ou bi). Sinon choisis « 👥 Annulée · Pas d’inscrits ».'
      );
    }

    if (d.situation === 'open_active' && entry.ds < todayStr) {
      blockingErrors.push(
        'Cette date est déjà passée : tu ne peux pas la laisser « En cours ». Choisis « Séance effectuée », « Annulée Météo », « Pas d’inscrits », « École fermée » ou « Hors offre ».'
      );
    }

    if (d.situation === 'not_published') {
      const norm = normalizeClosureReason(d.nonPublishReason);
      if (!d.nonPublishReason.trim() || norm.isGenericClosed) {
        blockingErrors.push(
          'Précise un vrai motif de fermeture école (Vacances, Réunion, Impératif personnel…) au lieu d’un simple « Fermé ».'
        );
      }
    }

    if (d.situation === 'cancelled_weather') {
      const norm = normalizeClosureReason(d.weatherReason);
      if (!d.weatherReason.trim() || norm.isGenericClosed) {
        blockingErrors.push('Précise la cause météo ou l’état de plage (vent faible, vent fort, secteur, plage…).');
      }
    }

    if (
      entry.bookingSummary.totalChars > 0 &&
      (d.situation === 'excluded' || d.situation === 'not_published' || d.situation === 'closed_no_bookings')
    ) {
      blockingErrors.push(
        `${entry.bookings.length} dossier(s) client (${entry.bookingSummary.totalChars} char(s)) sont inscrits sur ce créneau : impossible de le classer sans inscrits / fermé / hors offre tant que ces inscriptions existent.`
      );
    }

    if (d.situation === 'realized' || d.situation === 'shifted' || d.situation === 'open_active') {
      const cleanSec = d.secondaryInstructor.trim();
      const secAddChars = cleanSec
        ? d.secondaryMaxChars ?? (d.secondaryQualification === 'CQP' ? 8 : MAX_CHARS_PER_INSTRUCTOR)
        : undefined;
      const secQual: 'CQP' | 'DE_BPJEPS' | undefined = cleanSec
        ? d.secondaryQualification || (secAddChars! <= 8 ? 'CQP' : 'DE_BPJEPS')
        : undefined;
      const maxCap = getSlotMaxCapacity({
        secondaryInstructor: cleanSec || undefined,
        secondaryQualification: secQual,
        secondaryMaxChars: secAddChars,
      });
      if (totalChars > maxCap) {
        blockingErrors.push(
          `Capacité dépassée (${totalChars}/${maxCap} chars) : réduis le nombre de chars ou ajoute un 2e moniteur (Youenn +8 → 20 max, Katleen +12 → 24 max).`
        );
      }

      if (
        entry.bookingSummary.totalChars > 0 &&
        totalChars !== entry.bookingSummary.totalChars
      ) {
        warnings.push(
          `Les inscriptions clients comptent ${entry.bookingSummary.totalChars} char(s) contre ${totalChars} saisi(s) ici (vérifie si le chiffre saisi est bien le réel).`
        );
      }
    }

    if (
      d.realignSlotKey &&
      entry.computedMatch &&
      entry.computedMatch.slotKey !== entry.slotKey &&
      validations[entry.ds]?.items?.some(it => it.k === entry.computedMatch!.slotKey)
    ) {
      warnings.push(
        `Un autre créneau existe déjà sur la référence cible (${entry.computedMatch.startTime}–${entry.computedMatch.endTime}) : le réalignement fusionnera les deux lignes.`
      );
    }

    return { blockingErrors, warnings };
  };

  const openEditor = (entry: AuditSlotEntry) => {
    setActionError(null);
    setConfirmDeleteKey(null);
    const val = entry.valItem;
    const obs = entry.obs;
    const todayStr = tdy();

    let situation: ReconciliationSituation = entry.ds < todayStr ? 'realized' : 'open_active';
    let nonPublishReason = '';
    let weatherReason: string = C2_WEATHER_REASONS[0];

    if (val) {
      const effC1 = getEffectiveCycle1Status(val);
      const effC2 = getEffectiveCycle2Status(val, entry.bookingSummary.totalChars);
      const isLegacyGenericVal =
        val.status === 'rejected' &&
        !val.cycle1Status &&
        !val.cycle2Status &&
        normalizeClosureReason(val.rejectReason).isGenericClosed;

      if (effC1 === 'excluded') situation = 'excluded';
      else if (effC1 === 'not_published') situation = 'not_published';
      else if (effC1 === 'closed_no_bookings') situation = 'closed_no_bookings';
      else if (isLegacyGenericVal && obs && obs.status === 'cancelled') {
        if (obs.cancellationReason === 'no_clients') {
          situation = 'closed_no_bookings';
        } else if (
          (obs.cancellationNote || '').toLowerCase().includes('hors offre') ||
          (obs.cancellationNote || '').toLowerCase().includes('non pertinent')
        ) {
          situation = 'excluded';
        } else if (obs.cancellationReason === 'instructor') {
          situation = 'not_published';
          const normObs = normalizeClosureReason(obs.cancellationNote);
          nonPublishReason = normObs.isGenericClosed
            ? 'Impératif personnel'
            : normObs.label || 'Impératif personnel';
        } else {
          situation = 'cancelled_weather';
          weatherReason =
            obs.cancellationNote || mapCancellationReasonToWeatherText(obs.cancellationReason);
        }
      } else if (effC2 === 'cancelled_weather') situation = 'cancelled_weather';
      else if (effC2 === 'realized') situation = 'realized';
      else if (effC2 === 'shifted') situation = 'shifted';
      else situation = 'open_active';

      const rawNonPub =
        val.nonPublishReason ||
        val.rejectReason?.replace(/^Non publié\s*\(C1\)\s*:\s*/i, '') ||
        '';
      if (rawNonPub && !nonPublishReason) {
        const norm = normalizeClosureReason(rawNonPub);
        nonPublishReason = norm.isGenericClosed ? 'Impératif personnel' : norm.label;
      }
      if (situation === 'cancelled_weather' && !isLegacyGenericVal) {
        const rawW = val.rejectReason || obs?.cancellationNote || '';
        const normW = normalizeClosureReason(rawW);
        weatherReason =
          rawW && !normW.isGenericClosed
            ? rawW
            : mapCancellationReasonToWeatherText(obs?.cancellationReason);
      }

      // Si planning resté en attente/actif sur une date passée ou avec REX existant -> pré-proposer le verdict REX ou clôture cohérente
      if (situation === 'open_active') {
        if (obs) {
          if (obs.status === 'realized') {
            situation = 'realized';
          } else if (obs.cancellationReason === 'no_clients') {
            situation = 'closed_no_bookings';
          } else if (
            (obs.cancellationNote || '').toLowerCase().includes('hors offre') ||
            (obs.cancellationNote || '').toLowerCase().includes('non pertinent')
          ) {
            situation = 'excluded';
          } else if (obs.cancellationReason === 'instructor') {
            situation = 'not_published';
            const norm = normalizeClosureReason(obs.cancellationNote);
            nonPublishReason = norm.isGenericClosed
              ? 'Impératif personnel'
              : norm.label || 'Impératif personnel';
          } else {
            situation = 'cancelled_weather';
            weatherReason =
              obs.cancellationNote || mapCancellationReasonToWeatherText(obs.cancellationReason);
          }
        } else if (entry.ds < todayStr) {
          const valC = getValidationItemChars(val);
          const hasChars = valC.totalChars > 0 || entry.bookingSummary.totalChars > 0;
          situation = hasChars ? 'realized' : 'closed_no_bookings';
        }
      }
    } else if (obs) {
      if (obs.status === 'realized') {
        situation = 'realized';
      } else if (obs.cancellationReason === 'no_clients') {
        situation = 'closed_no_bookings';
      } else if (
        (obs.cancellationNote || '').toLowerCase().includes('hors offre') ||
        (obs.cancellationNote || '').toLowerCase().includes('non pertinent')
      ) {
        situation = 'excluded';
      } else if (obs.cancellationReason === 'instructor') {
        situation = 'not_published';
        const norm = normalizeClosureReason(obs.cancellationNote);
        nonPublishReason = norm.isGenericClosed
          ? 'Impératif personnel'
          : norm.label || 'Impératif personnel';
      } else {
        situation = 'cancelled_weather';
        weatherReason =
          obs.cancellationNote || mapCancellationReasonToWeatherText(obs.cancellationReason);
      }
    }

    const valChars = getValidationItemChars(val);
    const obsMono = obs?.monoCount ?? 0;
    const obsBi = obs?.biCount ?? 0;
    const obsTotal = getObservationChars(obs);
    const monoCount =
      valChars.mono > 0
        ? valChars.mono
        : obsMono > 0
        ? obsMono
        : entry.bookingSummary.mono > 0
        ? entry.bookingSummary.mono
        : valChars.totalChars === 0 && obsTotal > 0 && obsBi === 0
        ? obsTotal
        : 0;
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

    const shouldRealign = Boolean(entry.computedMatch && !entry.computedMatch.isExactKeyMatch);
    const pStart =
      shouldRealign && entry.computedMatch
        ? entry.computedMatch.startTime
        : val?.publishedStart || val?.s || obs?.slotStart || '10h00';
    const pEnd =
      shouldRealign && entry.computedMatch
        ? entry.computedMatch.endTime
        : val?.publishedEnd || val?.e || obs?.slotEnd || '11h00';

    const secName = val?.secondaryInstructor || obs?.secondaryInstructor || '';
    const inferredSecQual: 'CQP' | 'DE_BPJEPS' | undefined = val?.secondaryQualification
      ? val.secondaryQualification
      : secName.toLowerCase().includes('youenn')
      ? 'CQP'
      : secName.trim()
      ? 'DE_BPJEPS'
      : undefined;
    const inferredSecMaxChars: number | undefined =
      val?.secondaryMaxChars ??
      (inferredSecQual === 'CQP' ? 8 : inferredSecQual === 'DE_BPJEPS' ? MAX_CHARS_PER_INSTRUCTOR : undefined);

    setDraft({
      situation,
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
      secondaryInstructor: secName,
      secondaryQualification: inferredSecQual,
      secondaryMaxChars: inferredSecMaxChars,
      realignSlotKey: shouldRealign,
      syncObservation: Boolean(obs) || situation === 'realized' || situation === 'cancelled_weather',
      auditNote: entry.signOff?.note || '',
    });
    setEditingEntryKey(entry.entryKey);
  };

  const handleToggleSignOff = async (entry: AuditSlotEntry) => {
    if (!entry.isVerified && entry.severity === 'conflict') {
      setActionError(
        'Contradiction rouge détectée : clique sur « ⚖️ Trancher » pour aligner les sources avant de valider.'
      );
      openEditor(entry);
      return;
    }
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
    const situation: BulkDaySituation =
      effC1 === 'excluded'
        ? 'excluded'
        : effC1 === 'closed_no_bookings'
        ? 'closed_no_bookings'
        : effC1 === 'published'
        ? 'open_active'
        : 'not_published';

    const rawNonPub =
      firstWithVal?.nonPublishReason ||
      firstWithVal?.rejectReason?.replace(/^Non publié\s*\(C1\)\s*:\s*/i, '') ||
      firstWithObs?.cancellationNote ||
      '';
    const norm = normalizeClosureReason(rawNonPub);
    const hasAnyObs = dayEntries.some(e => Boolean(e.obs));

    const bulkSecName = firstWithVal?.secondaryInstructor || '';
    const bulkSecQual: 'CQP' | 'DE_BPJEPS' | undefined = firstWithVal?.secondaryQualification
      ? firstWithVal.secondaryQualification
      : bulkSecName.toLowerCase().includes('youenn')
      ? 'CQP'
      : bulkSecName.trim()
      ? 'DE_BPJEPS'
      : undefined;
    const bulkSecMax =
      firstWithVal?.secondaryMaxChars ??
      (bulkSecQual === 'CQP' ? 8 : bulkSecQual === 'DE_BPJEPS' ? MAX_CHARS_PER_INSTRUCTOR : undefined);

    setBulkDraft({
      situation,
      nonPublishReason: norm.isGenericClosed
        ? 'Impératif personnel'
        : norm.label || 'Impératif personnel',
      weatherReason: C2_WEATHER_REASONS[0],
      instructor: firstWithVal?.instructor || firstWithVal?.assignedPilot || 'Jérôme',
      secondaryInstructor: bulkSecName,
      secondaryQualification: bulkSecQual,
      secondaryMaxChars: bulkSecMax,
      realignSlotKeys: dayEntries.some(e => e.computedMatch && !e.computedMatch.isExactKeyMatch),
      syncObservationsMode: hasAnyObs ? 'existing_only' : 'all_slots',
      auditNote: '',
    });
    setBulkDayDs(ds);
  };

  const handleValidateWholeDay = async (dayEntries: AuditSlotEntry[], verify: boolean) => {
    if (dayEntries.length === 0) return;
    const targets = verify
      ? dayEntries.filter(e => e.severity !== 'conflict' && !e.isVerified)
      : dayEntries.filter(e => e.isVerified);
    if (targets.length === 0) {
      if (verify && dayEntries.some(e => e.severity === 'conflict')) {
        setActionError(
          'Les créneaux en contradiction rouge doivent être tranchés individuellement (« ⚖️ Trancher ») ou uniformisés via « ⚡ Valider / uniformiser la journée ».'
        );
      }
      return;
    }
    setIsBatchSaving(true);
    setActionError(null);
    try {
      const now = Date.now();
      const author = getActiveInstructor();
      const batchMap: Record<string, DataAuditEntrySignOff | null> = {};
      targets.forEach(e => {
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

    const todayStr = tdy();
    if (bulkDraft.situation === 'open_active' && ds < todayStr) {
      setActionError(
        'Cette journée est déjà passée : tu ne peux pas l’uniformiser en « À venir / En cours ». Choisis « École fermée », « Annulée Météo », « Pas d’inscrits », « Hors offre » ou « Effectuée ».'
      );
      return;
    }

    const totalBookedDay = dayEntries.reduce((acc, e) => acc + e.bookingSummary.totalChars, 0);
    if (
      totalBookedDay > 0 &&
      (bulkDraft.situation === 'excluded' ||
        bulkDraft.situation === 'not_published' ||
        bulkDraft.situation === 'closed_no_bookings')
    ) {
      setActionError(
        `Impossible sur toute la journée : ${totalBookedDay} char(s) client(s) sont inscrits ce jour-là. Traite les créneaux inscrits individuellement ou choisis « Annulée Météo ».`
      );
      return;
    }

    const cleanNonPubReason = bulkDraft.nonPublishReason.trim();
    if (
      bulkDraft.situation === 'not_published' &&
      (!cleanNonPubReason || normalizeClosureReason(cleanNonPubReason).isGenericClosed)
    ) {
      setActionError('Précise un vrai motif de fermeture école (Vacances, Réunion, Impératif personnel…).');
      return;
    }

    if (
      bulkDraft.situation === 'cancelled_weather' &&
      (!bulkDraft.weatherReason.trim() || normalizeClosureReason(bulkDraft.weatherReason).isGenericClosed)
    ) {
      setActionError('Précise une cause météo ou plage pour toute la journée.');
      return;
    }

    if (bulkDraft.situation === 'realized') {
      const zeroSlot = dayEntries.find(e => {
        const vc = getValidationItemChars(e.valItem).totalChars;
        const oc = getObservationChars(e.obs);
        return Math.max(vc, oc, e.bookingSummary.totalChars) <= 0;
      });
      if (zeroSlot) {
        setActionError(
          `Le créneau ${zeroSlot.displayTime} a 0 char saisi : saisis ses chars sur sa fiche avant de marquer toute la journée « Effectuée ».`
        );
        return;
      }
    }

    setIsBatchSaving(true);
    setActionError(null);

    try {
      const author = getActiveInstructor();
      const now = Date.now();
      const finalNonPubReason = cleanNonPubReason || 'Impératif personnel';
      if (bulkDraft.situation === 'not_published' && onAddCustomNonPublishReason) {
        onAddCustomNonPublishReason(finalNonPubReason);
      }

      const { c1Status, c2Status, isRejected } = mapSituationToCycleStates(bulkDraft.situation, 0);

      const rejectReason =
        c1Status === 'excluded'
          ? 'Hors offre / Non pertinent (C1)'
          : c1Status === 'not_published'
          ? `Non publié (C1) : ${finalNonPubReason}`
          : c1Status === 'closed_no_bookings'
          ? "Pas d'inscrits (Vie 2)"
          : c2Status === 'cancelled_weather'
          ? bulkDraft.weatherReason.trim() || 'Annulé météo (Vie 2)'
          : undefined;

      const cleanBulkSec = bulkDraft.secondaryInstructor.trim();
      const bulkSecAddChars = cleanBulkSec
        ? bulkDraft.secondaryMaxChars ??
          (bulkDraft.secondaryQualification === 'CQP' ? 8 : MAX_CHARS_PER_INSTRUCTOR)
        : undefined;
      const bulkSecQual: 'CQP' | 'DE_BPJEPS' | undefined = cleanBulkSec
        ? bulkDraft.secondaryQualification || (bulkSecAddChars! <= 8 ? 'CQP' : 'DE_BPJEPS')
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
        const pStart =
          bulkDraft.realignSlotKeys && entry.computedMatch
            ? entry.computedMatch.startTime
            : existingVal?.publishedStart || existingVal?.s || entry.obs?.slotStart || entry.startTime;
        const pEnd =
          bulkDraft.realignSlotKeys && entry.computedMatch
            ? entry.computedMatch.endTime
            : existingVal?.publishedEnd || existingVal?.e || entry.obs?.slotEnd || entry.endTime;

        const existingValChars = getValidationItemChars(existingVal);
        const slotChars =
          existingValChars.totalChars > 0
            ? existingValChars.totalChars
            : Math.max(getObservationChars(entry.obs), entry.bookingSummary.totalChars);
        const slotMono =
          existingValChars.mono > 0
            ? existingValChars.mono
            : (entry.obs?.monoCount ?? 0) > 0
            ? entry.obs!.monoCount!
            : entry.bookingSummary.mono;
        const slotBi =
          existingValChars.bi > 0
            ? existingValChars.bi
            : (entry.obs?.biCount ?? 0) > 0
            ? entry.obs!.biCount!
            : entry.bookingSummary.bi;
        const slotPeople =
          existingVal?.pilotsCount ?? entry.obs?.participantsCount ?? entry.bookingSummary.people;

        const effectiveC2 =
          bulkDraft.situation === 'open_active'
            ? slotChars > 0
              ? 'confirmed'
              : 'awaiting_booking'
            : c2Status;

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
          cycle1Status: c1Status,
          nonPublishReason: c1Status === 'not_published' ? finalNonPubReason : undefined,
          cycle2Status: c1Status === 'published' ? effectiveC2 : undefined,
          instructor: bulkDraft.instructor.trim() || 'Jérôme',
          assignedPilot: bulkDraft.instructor.trim() || 'Jérôme',
          secondaryInstructor: isRejected ? undefined : cleanBulkSec || undefined,
          secondaryQualification: isRejected ? undefined : bulkSecQual,
          secondaryMaxChars: isRejected ? undefined : bulkSecAddChars,
          monoCount: isRejected ? 0 : slotMono,
          biCount: isRejected ? 0 : slotBi,
          charsCount: isRejected ? 0 : slotChars,
          pilotsCount: isRejected ? 0 : slotPeople,
        };

        if (targetSlotKey !== entry.slotKey) {
          nextItemsMap.delete(entry.slotKey);
          auditBatchMap[entry.entryKey] = null;
          if (entry.bookings.length > 0) {
            const existingTargetBookings =
              report.entries.find(e => e.ds === ds && e.slotKey === targetSlotKey)?.bookings || [];
            const seenIds = new Set(existingTargetBookings.map(b => b.id));
            const mergedTargetBookings = [
              ...existingTargetBookings,
              ...entry.bookings.filter(b => !seenIds.has(b.id)),
            ];
            await saveBookingToFirestore(`${ds}_${targetSlotKey}`, mergedTargetBookings);
            await saveBookingToFirestore(`${ds}_${entry.slotKey}`, []);
          }
        }
        nextItemsMap.set(targetSlotKey, nextItem);

        // Si un REX existe déjà, le garder aligné — mais ne JAMAIS créer de bilan REX "effectué" sur une séance "À venir / Ouvert"
        const shouldSyncObs =
          bulkDraft.situation !== 'open_active' &&
          (Boolean(entry.obs) || bulkDraft.syncObservationsMode === 'all_slots');

        if (shouldSyncObs) {
          const obsStatus: 'realized' | 'cancelled' = isRejected ? 'cancelled' : 'realized';
          const obsCancelReason: CancellationReason | undefined =
            c1Status === 'excluded'
              ? 'other'
              : c1Status === 'closed_no_bookings'
              ? 'no_clients'
              : c1Status === 'not_published'
              ? 'instructor'
              : c2Status === 'cancelled_weather'
              ? mapWeatherTextToCancellationReason(bulkDraft.weatherReason)
              : undefined;
          const obsCancelNote =
            c1Status === 'excluded'
              ? 'Hors offre / Non pertinent (C1)'
              : c1Status === 'not_published'
              ? finalNonPubReason
              : c1Status === 'closed_no_bookings'
              ? "Pas d'inscrits (Vie 2)"
              : c2Status === 'cancelled_weather'
              ? bulkDraft.weatherReason.trim()
              : undefined;

          const updatedObs: SlotObservation = {
            ...(entry.obs || {
              id: `obs-${ds}-${targetSlotKey}`,
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
            monoCount: obsStatus === 'realized' ? nextItem.monoCount : undefined,
            biCount: obsStatus === 'realized' ? nextItem.biCount : undefined,
            charsCount: obsStatus === 'realized' ? nextItem.charsCount : undefined,
            participantsCount: obsStatus === 'realized' ? nextItem.pilotsCount : undefined,
            author: bulkDraft.instructor.trim() || entry.obs?.author || author,
            secondaryInstructor: isRejected ? undefined : cleanBulkSec || undefined,
            updatedAt: now,
          };
          await saveObservationToFirestore(updatedObs);
        } else if (bulkDraft.situation === 'open_active' && entry.obs?.id) {
          await deleteObservationFromFirestore(entry.obs.id);
        }

        const nextKey = `${ds}__${targetSlotKey}`;
        auditBatchMap[nextKey] = {
          entryKey: nextKey,
          verified: true,
          verifiedBy: author,
          verifiedAt: now,
          note:
            bulkDraft.auditNote.trim() ||
            (c1Status === 'not_published'
              ? `Journée entière uniformisée · ${finalNonPubReason}`
              : 'Journée entière mise en cohérence en bloc'),
        };
      }

      const sortedItems = Array.from(nextItemsMap.values()).sort((a, b) =>
        (a.publishedStart || a.s).localeCompare(b.publishedStart || b.s)
      );

      onSaveDayValidation(ds, {
        sig: sortedItems.map(it => it.k).join('|') || prevDayRecord?.sig || `audit_${ds}`,
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
      const effectiveThreshold = settings.L - (settings.mg || 0) / 100;
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
    const { blockingErrors } = evaluateDraftCoherence(draft, entry);
    if (blockingErrors.length > 0) {
      setActionError(blockingErrors[0]);
      return;
    }

    setSavingKey(entry.entryKey);
    setActionError(null);

    try {
      const author = getActiveInstructor();
      const targetSlotKey =
        draft.realignSlotKey && entry.computedMatch
          ? entry.computedMatch.slotKey
          : entry.slotKey;

      const normStart =
        draft.realignSlotKey && entry.computedMatch
          ? entry.computedMatch.startTime
          : normalizeTimeHHhMM(draft.publishedStart) || entry.startTime;
      const normEnd =
        draft.realignSlotKey && entry.computedMatch
          ? entry.computedMatch.endTime
          : normalizeTimeHHhMM(draft.publishedEnd) || entry.endTime;
      const normActualStart = normalizeTimeHHhMM(draft.actualStart) || normStart;
      const normActualEnd = normalizeTimeHHhMM(draft.actualEnd) || normEnd;

      const totalChars = draft.monoCount + draft.biCount;
      const people =
        draft.pilotsCount > 0 ? draft.pilotsCount : draft.monoCount + draft.biCount * 2;

      const { c1Status, c2Status, isRejected } = mapSituationToCycleStates(draft.situation, totalChars);

      const cleanNonPubReason = draft.nonPublishReason.trim() || 'Impératif personnel';
      if (c1Status === 'not_published' && onAddCustomNonPublishReason) {
        onAddCustomNonPublishReason(cleanNonPubReason);
      }

      const rejectReason =
        c1Status === 'excluded'
          ? 'Hors offre / Non pertinent (C1)'
          : c1Status === 'not_published'
          ? `Non publié (C1) : ${cleanNonPubReason}`
          : c1Status === 'closed_no_bookings'
          ? "Pas d'inscrits (Vie 2)"
          : c2Status === 'cancelled_weather'
          ? draft.weatherReason.trim() || 'Annulé météo (Vie 2)'
          : undefined;

      const cleanSec = isRejected ? '' : draft.secondaryInstructor.trim();
      const secAddChars = cleanSec
        ? draft.secondaryMaxChars ??
          (draft.secondaryQualification === 'CQP' ? 8 : MAX_CHARS_PER_INSTRUCTOR)
        : undefined;
      const secQual: 'CQP' | 'DE_BPJEPS' | undefined = cleanSec
        ? draft.secondaryQualification || (secAddChars! <= 8 ? 'CQP' : 'DE_BPJEPS')
        : undefined;

      const computedShiftMinutes = computeShiftMinutes(normStart, normActualStart);
      const keepActualShift =
        draft.situation === 'shifted' ||
        ((draft.situation === 'realized' || draft.situation === 'open_active') &&
          (normActualStart !== normStart || normActualEnd !== normEnd));

      const existingVal = entry.valItem;
      const nextItem: ValidationItem = {
        k: targetSlotKey,
        s: normStart,
        e: normEnd,
        publishedStart: normStart,
        publishedEnd: normEnd,
        opt: entry.computedMatch?.opt ?? existingVal?.opt ?? false,
        over: entry.computedMatch?.over ?? existingVal?.over ?? 0,
        lim: entry.computedMatch?.lim ?? existingVal?.lim ?? '',
        customTitle: entry.computedMatch?.customTitle ?? existingVal?.customTitle ?? entry.obs?.customTitle,
        status: isRejected ? 'rejected' : 'valid',
        rejectReason,
        cycle1Status: c1Status,
        nonPublishReason: c1Status === 'not_published' ? cleanNonPubReason : undefined,
        cycle2Status: c1Status === 'published' ? c2Status : undefined,
        actualStart: keepActualShift ? normActualStart : undefined,
        actualEnd: keepActualShift ? normActualEnd : undefined,
        shiftMinutes: keepActualShift ? computedShiftMinutes ?? existingVal?.shiftMinutes : undefined,
        instructor: draft.instructor.trim() || 'Jérôme',
        assignedPilot: draft.instructor.trim() || 'Jérôme',
        secondaryInstructor: cleanSec || undefined,
        secondaryQualification: secQual,
        secondaryMaxChars: secAddChars,
        monoCount: isRejected ? 0 : draft.monoCount,
        biCount: isRejected ? 0 : draft.biCount,
        charsCount: isRejected ? 0 : totalChars,
        pilotsCount: isRejected ? 0 : people,
        rescheduledChars:
          c2Status === 'cancelled_weather' ? draft.rescheduledChars : undefined,
        lostChars:
          c2Status === 'cancelled_weather' ? draft.lostChars : undefined,
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

      // 2. Si clé réalignée et réservations attachées à l'ancienne clé -> migrer vers la nouvelle clé sans écraser d'éventuelles fiches déjà présentes
      if (targetSlotKey !== entry.slotKey && entry.bookings.length > 0) {
        const existingTargetBookings =
          report.entries.find(e => e.ds === entry.ds && e.slotKey === targetSlotKey)?.bookings || [];
        const seenIds = new Set(existingTargetBookings.map(b => b.id));
        const mergedTargetBookings = [
          ...existingTargetBookings,
          ...entry.bookings.filter(b => !seenIds.has(b.id)),
        ];
        await saveBookingToFirestore(`${entry.ds}_${targetSlotKey}`, mergedTargetBookings);
        await saveBookingToFirestore(`${entry.ds}_${entry.slotKey}`, []);
      }

      // 3. Toujours garder le REX aligné s'il existe déjà (pour éviter toute réapparition de contradiction), ou en créer un si demandé
      const mustSyncObs = Boolean(entry.obs) || draft.syncObservation;
      if (mustSyncObs && draft.situation !== 'open_active') {
        const obsStatus: 'realized' | 'cancelled' = isRejected ? 'cancelled' : 'realized';
        const obsCancelReason: CancellationReason | undefined =
          c1Status === 'excluded'
            ? 'other'
            : c1Status === 'closed_no_bookings'
            ? 'no_clients'
            : c1Status === 'not_published'
            ? 'instructor'
            : c2Status === 'cancelled_weather'
            ? mapWeatherTextToCancellationReason(draft.weatherReason)
            : undefined;
        const obsCancelNote =
          c1Status === 'excluded'
            ? 'Hors offre / Non pertinent (C1)'
            : c1Status === 'not_published'
            ? cleanNonPubReason
            : c1Status === 'closed_no_bookings'
            ? "Pas d'inscrits (Vie 2)"
            : c2Status === 'cancelled_weather'
            ? draft.weatherReason.trim()
            : undefined;

        const updatedObs: SlotObservation = {
          ...(entry.obs || {
            id: `obs-${entry.ds}-${targetSlotKey}`,
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
          monoCount: obsStatus === 'realized' ? draft.monoCount : undefined,
          biCount: obsStatus === 'realized' ? draft.biCount : undefined,
          charsCount: obsStatus === 'realized' ? totalChars : undefined,
          participantsCount: obsStatus === 'realized' ? people : undefined,
          bookedParticipantsCount:
            obsStatus === 'cancelled' && c2Status === 'cancelled_weather'
              ? people || entry.obs?.bookedParticipantsCount
              : undefined,
          rescheduledCount:
            obsStatus === 'cancelled' && c2Status === 'cancelled_weather'
              ? draft.rescheduledChars
              : undefined,
          lostCount:
            obsStatus === 'cancelled' && c2Status === 'cancelled_weather'
              ? draft.lostChars
              : undefined,
          author: draft.instructor.trim() || entry.obs?.author || author,
          secondaryInstructor: cleanSec || undefined,
          updatedAt: Date.now(),
        };
        await saveObservationToFirestore(updatedObs);
      } else if (draft.situation === 'open_active' && entry.obs?.id) {
        // Si repassé en "À venir / En cours" (futur), supprimer l'ancien REX pour éviter une contradiction Planning Actif vs REX
        await deleteObservationFromFirestore(entry.obs.id);
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
        note: draft.auditNote.trim() || `Mis en cohérence · ${SITUATION_META[draft.situation].short}`,
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
      if (entry.bookings.length > 0) {
        await saveBookingToFirestore(`${entry.ds}_${entry.slotKey}`, []);
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
        e.obs ? getObservationChars(e.obs) : '',
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

  const handleCopyEntrySummary = async (entry: AuditSlotEntry) => {
    const valChars = getValidationItemChars(entry.valItem);
    const lines = [
      `📅 ${formatDateFr(entry.ds)} (${entry.ds}) · 🕒 ${entry.displayTime} · #${entry.slotKey}`,
      `Diagnostic : ${entry.severity === 'conflict' ? '🔴 Contradiction' : entry.severity === 'warning' ? '🟠 À préciser' : '🟢 Cohérente'}`,
      `Planning : ${entry.valItem ? `${entry.summaryStatusLabel} · ${valChars.totalChars} char(s) (${valChars.mono}m/${valChars.bi}b)` : 'Aucune fiche planning'}`,
      `REX : ${entry.obs ? `${entry.obs.status === 'realized' ? 'Réalisée' : `Annulée (${formatObsReasonFr(entry.obs.cancellationReason)})`} · ${getObservationChars(entry.obs)} char(s)${entry.obs.cancellationNote ? ` · « ${entry.obs.cancellationNote} »` : ''}` : 'Aucun REX'}`,
      `Inscrits : ${entry.bookingSummary.totalChars} char(s) (${entry.bookings.length} dossier(s))`,
      entry.issues.length > 0
        ? `Anomalies :\n${entry.issues.map(i => `- ${i.label} : ${i.detail}`).join('\n')}`
        : 'Anomalies : Aucune',
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedEntryKey(entry.entryKey);
      window.setTimeout(() => {
        setCopiedEntryKey(prev => (prev === entry.entryKey ? null : prev));
      }, 2200);
    } catch {
      setActionError('Copie automatique bloquée par le navigateur : utilise le bouton 📥 CSV en haut.');
    }
  };

  const handleCopyChecklist = async () => {
    setShowChecklistPanel(true);
    try {
      await navigator.clipboard.writeText(checklistText);
      setChecklistCopied(true);
      window.setTimeout(() => setChecklistCopied(false), 2400);
    } catch {
      setChecklistCopied(false);
    }
  };

  const severityBadge = (severity: AuditSeverity) => {
    if (severity === 'conflict') {
      return { label: '🔴 Contradiction à trancher', bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' };
    }
    if (severity === 'warning') {
      return { label: '🟠 À préciser / En attente', bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' };
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
          height: '92vh',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px rgba(0,0,0,0.35)',
          border: '2px solid #d97706',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* EN-TÊTE FIXE COMPACT */}
        <div
          style={{
            flexShrink: 0,
            background: '#0f172a',
            color: '#ffffff',
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: '#d97706',
                  color: '#ffffff',
                  fontSize: '0.64rem',
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                }}
              >
                Audit & Réconciliation Cloud
              </span>
              <span style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 700 }}>
                {report.daysAnalyzed} journée{report.daysAnalyzed > 1 ? 's' : ''} · {report.totalCount} créneau{report.totalCount > 1 ? 'x' : ''} ·{' '}
                <strong style={{ color: '#86efac' }}>
                  {report.verifiedCount}/{report.totalCount} validé{report.verifiedCount > 1 ? 's' : ''}
                </strong>
              </span>
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: '1.02rem', fontWeight: 900 }}>
              🩺 Mise en Conformité &amp; Cohérence des Données
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleCopyChecklist}
              style={{
                background: showChecklistPanel ? '#d97706' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '0.72rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
              title="Générer et copier la liste exacte des anomalies à corriger"
            >
              {checklistCopied
                ? '✓ Liste copiée !'
                : `📋 Liste à corriger (${checklistEntries.length})`}
            </button>
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

        {showChecklistPanel && (
          <div
            style={{
              flexShrink: 0,
              background: '#fffbeb',
              borderBottom: '2px solid #f59e0b',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 900, color: '#92400e' }}>
                📋 Liste complète des points à corriger ({checklistEntries.length}) — sélectionne ou copie ce texte pour le suivre ou le partager :
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={handleCopyChecklist}
                  style={{
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {checklistCopied ? '✓ Copié !' : '📋 Copier tout'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowChecklistPanel(false)}
                  style={{
                    background: '#fff',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={checklistText}
              onFocus={e => e.currentTarget.select()}
              style={{
                width: '100%',
                minHeight: '130px',
                maxHeight: '220px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.72rem',
                lineHeight: 1.45,
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid #fcd34d',
                background: '#ffffff',
                color: '#0f172a',
                resize: 'vertical',
              }}
            />
          </div>
        )}

        {/* BARRE DE FILTRES COMPACTE FIXE */}
        <div
          style={{
            flexShrink: 0,
            background: '#f8fafc',
            borderBottom: '1px solid #cbd5e1',
            padding: '8px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {[
                { id: 'all' as const, label: `Toutes (${report.totalCount})`, activeBg: '#0f172a', activeFg: '#fff' },
                { id: 'conflict' as const, label: `🔴 Contradictions (${report.conflictCount})`, activeBg: '#dc2626', activeFg: '#fff' },
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
                      padding: '4px 9px',
                      borderRadius: '6px',
                      border: isActive ? `1.5px solid ${tab.activeBg}` : '1px solid #cbd5e1',
                      background: isActive ? tab.activeBg : '#ffffff',
                      color: isActive ? tab.activeFg : '#334155',
                      fontSize: '0.70rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
                aria-label="Filtrer par mois"
                style={{
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: monthFilter !== 'all' ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  background: monthFilter !== 'all' ? '#e0f2fe' : '#ffffff',
                  color: monthFilter !== 'all' ? '#0369a1' : '#0f172a',
                }}
              >
                <option value="all">📅 Tous les mois ({report.totalCount})</option>
                {availableMonths.map(m => (
                  <option key={m.ym} value={m.ym}>
                    {m.label} ({m.total}
                    {m.conflicts > 0 ? ` · ${m.conflicts} 🔴` : ''}
                    {m.warnings > 0 ? ` · ${m.warnings} 🟠` : ''})
                  </option>
                ))}
              </select>

              <input
                type="text"
                placeholder="🔍 Date, motif, client..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  padding: '5px 9px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.72rem',
                  width: '185px',
                  maxWidth: '100%',
                  background: '#ffffff',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setShowPedagogyGuide(v => !v)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: '1.5px solid #0284c7',
                  background: showPedagogyGuide ? '#0284c7' : '#f0f9ff',
                  color: showPedagogyGuide ? '#ffffff' : '#0369a1',
                  fontSize: '0.70rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {showPedagogyGuide
                  ? '🧭 Masquer le guide'
                  : '🧭 Guide Jérôme (Pourquoi & comment vérifier)'}
              </button>

              {settings && EX.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddDayClosure(v => !v)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1.5px solid #d97706',
                    background: showAddDayClosure ? '#d97706' : '#fffbeb',
                    color: showAddDayClosure ? '#ffffff' : '#92400e',
                    fontSize: '0.70rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {showAddDayClosure
                    ? 'Fermer saisie journée complète'
                    : '➕ Déclarer / fermer une journée entière'}
                </button>
              )}
            </div>

            {monthFilter !== 'all' || filterMode !== 'all' || searchQuery.trim() ? (
              <button
                type="button"
                onClick={() => {
                  setMonthFilter('all');
                  setFilterMode('all');
                  setSearchQuery('');
                }}
                style={{
                  padding: '4px 9px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ↺ Réinitialiser filtres ({filteredEntries.length}/{report.totalCount})
              </button>
            ) : null}
          </div>

          {actionError && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 700,
              }}
            >
              {actionError}
            </div>
          )}
        </div>

        {/* ZONE DE DÉFILEMENT PRINCIPALE (Guide / Outils dépliés + Liste des entrées) */}
        <div
          style={{
            padding: '12px 14px',
            overflowY: 'auto',
            flex: '1 1 auto',
            minHeight: 0,
            background: '#f1f5f9',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {showPedagogyGuide && (
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid #bae6fd',
                borderRadius: '10px',
                padding: '10px 12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '10px',
                fontSize: '0.72rem',
                color: '#1e293b',
                lineHeight: 1.42,
              }}
            >
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                <div style={{ fontWeight: 900, color: '#0369a1', marginBottom: '4px' }}>
                  1. État de la base (Mise à jour)
                </div>
                <div>
                  <strong>Déjà assaini :</strong> l’historique de test d’octobre a été supprimé et <strong>100 % du planning futur après le 30 novembre 2026</strong> (déc. 2026 → sept. 2027) a été remis massivement en cohérence (<strong>0 rouge, 0 orange</strong> sur 1 464 créneaux, recalés sur la règle <em>Début 09h00</em>).
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                <div style={{ fontWeight: 900, color: '#6d28d9', marginBottom: '4px' }}>
                  2. Périmètre restant : Novembre 2026 uniquement
                </div>
                <div>
                  Utilise le filtre mois <strong>« Novembre 2026 »</strong> : seuls les anciens créneaux saisis avant la séparation <strong>Cycle 1</strong> (offre publiée / fermeture école / <em>Hors offre</em>) vs <strong>Cycle 2</strong> (terrain) vs <strong>REX</strong> restent à arbitrer pour fiabiliser les stats Vie 1 / Vie 2 et le seuil de Lestrevet.
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                <div style={{ fontWeight: 900, color: '#b45309', marginBottom: '4px' }}>
                  3. Comment arbitrer Novembre 2026
                </div>
                <div>
                  <strong>🔴 Rouge :</strong> contradiction Planning vs REX ➔ clique <em>⚖️ Trancher</em>.<br />
                  <strong>🟠 Orange :</strong> ancien enregistrement pré-Cycle 1/2 ou motif « Fermé » vague ➔ précise ou aligne en 1 clic.<br />
                  <strong>🟢 Vert :</strong> déjà conforme ➔ clique <em>✅ Valider</em> pour signer.
                </div>
              </div>
            </div>
          )}

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
                const daySignableUnverifiedCount = allOfDay.filter(
                  e => !e.isVerified && e.severity !== 'conflict'
                ).length;
                const allDayVerified = allOfDay.length > 0 && dayVerifiedCount === allOfDay.length;
                const isPastDay = ds < tdy();
                const dayTotalBookedChars = allOfDay.reduce(
                  (sum, e) => sum + e.bookingSummary.totalChars,
                  0
                );
                const bulkNeedsReason = bulkDraft?.situation === 'not_published';
                const bulkNeedsWeather = bulkDraft?.situation === 'cancelled_weather';
                const bulkShowInstructors =
                  bulkDraft?.situation === 'open_active' || bulkDraft?.situation === 'realized';

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

                        {daySignableUnverifiedCount > 0 && (
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
                            {dayConflictCount > 0
                              ? `✅ Valider les ${daySignableUnverifiedCount} sans conflit`
                              : '✅ Valider le jour'}
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
                          Pratique si tous les créneaux du jour partagent la même réalité (ex. journée entièrement fermée, météo toute la journée, hors offre). L’horaire propre à chaque créneau est conservé automatiquement.
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                            Réalité unique pour toute la journée :
                            <select
                              value={bulkDraft.situation}
                              onChange={e =>
                                setBulkDraft({
                                  ...bulkDraft,
                                  situation: e.target.value as BulkDaySituation,
                                })
                              }
                              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, background: '#fff' }}
                            >
                              <option value="not_published" disabled={dayTotalBookedChars > 0}>
                                🚫 École fermée · Non publié (motif perso/école){dayTotalBookedChars > 0 ? ' [inscrits présents]' : ''}
                              </option>
                              <option value="excluded" disabled={dayTotalBookedChars > 0}>
                                ➖ Hors offre (exclu des stats){dayTotalBookedChars > 0 ? ' [inscrits présents]' : ''}
                              </option>
                              <option value="closed_no_bookings" disabled={dayTotalBookedChars > 0}>
                                👥 Annulée · Pas d’inscrits{dayTotalBookedChars > 0 ? ' [inscrits présents]' : ''}
                              </option>
                              <option value="cancelled_weather">⛔ Annulée · Météo / État plage</option>
                              <option value="realized">🏁 Séances effectuées (conserve les chars de chaque créneau)</option>
                              <option value="open_active" disabled={isPastDay}>
                                📅 À venir / Inscriptions en cours{isPastDay ? ' [interdit : date passée]' : ''}
                              </option>
                            </select>
                          </label>

                          {bulkShowInstructors && (
                            <>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                                Moniteur principal :
                                <input
                                  type="text"
                                  value={bulkDraft.instructor}
                                  onChange={e => setBulkDraft({ ...bulkDraft, instructor: e.target.value })}
                                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
                                />
                              </label>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 800, color: '#0f172a' }}>
                                <span>2e moniteur (optionnel) :</span>
                                <input
                                  type="text"
                                  value={bulkDraft.secondaryInstructor}
                                  onChange={e =>
                                    setBulkDraft({
                                      ...bulkDraft,
                                      secondaryInstructor: e.target.value,
                                      secondaryQualification: e.target.value.trim()
                                        ? bulkDraft.secondaryQualification || 'CQP'
                                        : undefined,
                                      secondaryMaxChars: e.target.value.trim()
                                        ? bulkDraft.secondaryMaxChars ?? 8
                                        : undefined,
                                    })
                                  }
                                  placeholder="Aucun (12 chars max)"
                                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
                                />
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                  {SECONDARY_INSTRUCTOR_PRESETS.map(p => {
                                    const isSel = bulkDraft.secondaryInstructor.toLowerCase().includes(p.name.toLowerCase());
                                    return (
                                      <button
                                        key={p.name}
                                        type="button"
                                        onClick={() =>
                                          setBulkDraft({
                                            ...bulkDraft,
                                            secondaryInstructor: p.name,
                                            secondaryQualification: p.qualification,
                                            secondaryMaxChars: p.addChars,
                                          })
                                        }
                                        style={{
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          border: isSel ? '1.5px solid #6d28d9' : '1px solid #cbd5e1',
                                          background: isSel ? '#f5f3ff' : '#fff',
                                          color: isSel ? '#6d28d9' : '#475569',
                                          fontSize: '0.66rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        +{p.name} ({p.qualification === 'CQP' ? '+8 → 20' : '+12 → 24'})
                                      </button>
                                    );
                                  })}
                                  {bulkDraft.secondaryInstructor.trim() && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setBulkDraft({
                                          ...bulkDraft,
                                          secondaryInstructor: '',
                                          secondaryQualification: undefined,
                                          secondaryMaxChars: undefined,
                                        })
                                      }
                                      style={{
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        border: '1px solid #fca5a5',
                                        background: '#fff',
                                        color: '#dc2626',
                                        fontSize: '0.66rem',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ✕ Retirer
                                    </button>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {bulkNeedsReason && (
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

                        {bulkNeedsWeather && (
                          <div style={{ background: '#fef2f2', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
                            <div style={{ fontWeight: 800, color: '#991b1b', marginBottom: '5px' }}>
                              Cause météo ou plage appliquée à toute la journée :
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
                          {bulkDraft.situation !== 'open_active' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 700, color: '#0369a1', flexWrap: 'wrap' }}>
                              <span>🔄 Bilan final REX :</span>
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
                                <option value="existing_only">Mettre à jour les REX déjà existants (garantit 0 contradiction)</option>
                                <option value="all_slots">Créer / aligner un REX sur chacun des {allOfDay.length} créneaux</option>
                              </select>
                            </label>
                          )}

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
                        {entry.severity !== 'conflict' ? (
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
                            {entry.isVerified ? '↩️ Retirer visa' : '✅ Valider'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() =>
                              isEditing ? (setEditingEntryKey(null), setDraft(null)) : openEditor(entry)
                            }
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              background: '#dc2626',
                              color: '#ffffff',
                              fontSize: '0.72rem',
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                            title="Une contradiction rouge doit être tranchée avant de pouvoir valider ce créneau"
                          >
                            ⚖️ Trancher la contradiction
                          </button>
                        )}

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
                          {isEditing ? 'Fermer édition' : '✏️ Corriger / Aligner'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopyEntrySummary(entry)}
                          style={{
                            padding: '5px 8px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: copiedEntryKey === entry.entryKey ? '#ecfdf5' : '#ffffff',
                            color: copiedEntryKey === entry.entryKey ? '#065f46' : '#475569',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                          title="Copier le résumé de ce créneau pour le coller dans le chat"
                        >
                          {copiedEntryKey === entry.entryKey ? '✓ Copié' : '📋'}
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
                      {/* Colonne 1 : Planning (Avant & Pendant séance) */}
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
                          📋 Planning (Avant &amp; Pendant séance)
                        </div>
                        {entry.valItem ? (
                          <div style={{ color: '#334155', lineHeight: 1.45 }}>
                            <div>
                              <strong>Statut :</strong> {entry.summaryStatusLabel}
                            </div>
                            <div>
                              <strong>Matériel :</strong> {valChars.totalChars} / {getSlotMaxCapacity(entry.valItem)} char(s) ({valChars.mono} mono + {valChars.bi} bi · {entry.valItem.pilotsCount ?? valChars.people} pers.)
                            </div>
                            <div>
                              <strong>Moniteur(s) :</strong> {entry.valItem.instructor || entry.valItem.assignedPilot || 'Jérôme'}
                              {entry.valItem.secondaryInstructor
                                ? ` + ${entry.valItem.secondaryInstructor}${entry.valItem.secondaryQualification === 'CQP' ? ' (CQP)' : ''}`
                                : ''}
                            </div>
                            {entry.valItem.rejectReason && (
                              <div style={{ color: '#991b1b' }}>
                                <strong>Motif enregistré :</strong> {entry.valItem.rejectReason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ color: '#991b1b', fontWeight: 700 }}>
                            ❌ Aucune fiche planning trouvée pour ce créneau.
                          </div>
                        )}
                      </div>

                      {/* Colonne 2 : Bilan final (REX après séance) */}
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
                          📝 Bilan final (REX après séance)
                        </div>
                        {entry.obs ? (
                          <div style={{ color: '#334155', lineHeight: 1.45 }}>
                            <div>
                              <strong>Statut REX :</strong>{' '}
                              {entry.obs.status === 'realized' ? '🏁 Réalisée' : `⛔ Annulée (${formatObsReasonFr(entry.obs.cancellationReason)})`}
                            </div>
                            {entry.obs.cancellationNote && (
                              <div>
                                <strong>Précision :</strong> « {entry.obs.cancellationNote} »
                              </div>
                            )}
                            <div>
                              <strong>Matériel REX :</strong> {getObservationChars(entry.obs)} char(s) · {entry.obs.participantsCount ?? 0} pilote(s)
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

                    {/* ÉDITEUR INLINE DE MISE EN COHÉRENCE UNIFIÉ */}
                    {isEditing && draft && (() => {
                      const coherence = evaluateDraftCoherence(draft, entry);
                      const isPastEntry = entry.ds < tdy();
                      const hasClientBookings = entry.bookingSummary.totalChars > 0;
                      const showCharsAndStaff =
                        draft.situation === 'realized' ||
                        draft.situation === 'shifted' ||
                        draft.situation === 'open_active';
                      const obsTotal = getObservationChars(entry.obs);
                      const hasDistinctSources =
                        showCharsAndStaff &&
                        ((valChars.totalChars > 0 && valChars.totalChars !== draft.monoCount + draft.biCount) ||
                          (obsTotal > 0 && obsTotal !== draft.monoCount + draft.biCount) ||
                          (entry.bookingSummary.totalChars > 0 &&
                            entry.bookingSummary.totalChars !== draft.monoCount + draft.biCount));

                      const situationOrder: ReconciliationSituation[] = [
                        'realized',
                        'cancelled_weather',
                        'shifted',
                        'closed_no_bookings',
                        'not_published',
                        'excluded',
                        'open_active',
                      ];

                      return (
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                            <div style={{ fontWeight: 900, color: '#0369a1', fontSize: '0.84rem' }}>
                              ✏️ Mettre en cohérence ce créneau (1 seule vérité Planning + REX)
                            </div>
                            <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700 }}>
                              Les options impossibles (ex. « En cours » sur date passée ou « Sans inscrits » avec clients) sont verrouillées.
                            </span>
                          </div>

                          {/* Étape 1 : Choix unique de la réalité du créneau */}
                          <div>
                            <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
                              1. Que s’est-il réellement passé sur ce créneau ?
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '6px' }}>
                              {situationOrder.map(sit => {
                                const meta = SITUATION_META[sit];
                                const isSelected = draft.situation === sit;
                                const isDisabled =
                                  (sit === 'open_active' && isPastEntry) ||
                                  (hasClientBookings &&
                                    (sit === 'closed_no_bookings' ||
                                      sit === 'not_published' ||
                                      sit === 'excluded'));
                                const disabledReason =
                                  sit === 'open_active' && isPastEntry
                                    ? 'Date déjà passée'
                                    : hasClientBookings &&
                                      (sit === 'closed_no_bookings' ||
                                        sit === 'not_published' ||
                                        sit === 'excluded')
                                    ? `${entry.bookingSummary.totalChars} char(s) client(s) présent(s)`
                                    : undefined;

                                return (
                                  <button
                                    key={sit}
                                    type="button"
                                    disabled={isDisabled}
                                    title={disabledReason}
                                    onClick={() => {
                                      let nextMono = draft.monoCount;
                                      let nextBi = draft.biCount;
                                      let nextPilots = draft.pilotsCount;
                                      if (sit === 'realized' && nextMono + nextBi === 0) {
                                        if (obsTotal > 0 && entry.obs) {
                                          nextMono = entry.obs.monoCount ?? obsTotal;
                                          nextBi = entry.obs.biCount ?? 0;
                                          nextPilots = entry.obs.participantsCount ?? nextMono + nextBi * 2;
                                        } else if (entry.bookingSummary.totalChars > 0) {
                                          nextMono = entry.bookingSummary.mono;
                                          nextBi = entry.bookingSummary.bi;
                                          nextPilots = entry.bookingSummary.people;
                                        }
                                      }
                                      const nextNonPub =
                                        sit === 'not_published' &&
                                        (!draft.nonPublishReason.trim() ||
                                          normalizeClosureReason(draft.nonPublishReason).isGenericClosed)
                                          ? 'Impératif personnel'
                                          : draft.nonPublishReason;
                                      const nextWeather =
                                        sit === 'cancelled_weather' &&
                                        (!draft.weatherReason.trim() ||
                                          normalizeClosureReason(draft.weatherReason).isGenericClosed)
                                          ? C2_WEATHER_REASONS[0]
                                          : draft.weatherReason;
                                      setDraft({
                                        ...draft,
                                        situation: sit,
                                        monoCount: nextMono,
                                        biCount: nextBi,
                                        pilotsCount: nextPilots,
                                        nonPublishReason: nextNonPub,
                                        weatherReason: nextWeather,
                                        syncObservation:
                                          Boolean(entry.obs) ||
                                          (sit !== 'open_active' && draft.syncObservation) ||
                                          sit === 'realized' ||
                                          sit === 'cancelled_weather',
                                      });
                                    }}
                                    style={{
                                      textAlign: 'left',
                                      padding: '7px 9px',
                                      borderRadius: '8px',
                                      border: isSelected ? `2px solid ${meta.border}` : '1px solid #cbd5e1',
                                      background: isDisabled ? '#f1f5f9' : isSelected ? meta.badgeBg : '#ffffff',
                                      color: isDisabled ? '#94a3b8' : isSelected ? meta.badgeFg : '#1e293b',
                                      opacity: isDisabled ? 0.65 : 1,
                                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '2px',
                                    }}
                                  >
                                    <span style={{ fontWeight: 900, fontSize: '0.73rem' }}>{meta.label}</span>
                                    <span style={{ fontSize: '0.64rem', opacity: 0.85 }}>
                                      {disabledReason ? `🔒 ${disabledReason}` : meta.group}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Motif si École fermée · Non publié */}
                          {draft.situation === 'not_published' && (
                            <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fcd34d' }}>
                              <div style={{ fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                                Motif de fermeture école (exclu des calculs de taux de remplissage) :
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

                          {/* Cause météo si Annulée Météo / État plage */}
                          {draft.situation === 'cancelled_weather' && (
                            <div style={{ background: '#fef2f2', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fca5a5', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <div style={{ fontWeight: 800, color: '#991b1b' }}>
                                Cause météo ou état de plage :
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
                                  style={{ flex: 1, minWidth: '180px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #fca5a5', fontSize: '0.74rem', background: '#fff' }}
                                />
                                <label style={{ fontWeight: 700, color: '#166534' }}>
                                  Replacés :
                                  <input
                                    type="number"
                                    min={0}
                                    value={draft.rescheduledChars}
                                    onChange={e => setDraft({ ...draft, rescheduledChars: Math.max(0, Number(e.target.value) || 0) })}
                                    style={{ width: '50px', marginLeft: '4px', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff' }}
                                  />
                                </label>
                                <label style={{ fontWeight: 700, color: '#991b1b' }}>
                                  Perdus :
                                  <input
                                    type="number"
                                    min={0}
                                    value={draft.lostChars}
                                    onChange={e => setDraft({ ...draft, lostChars: Math.max(0, Number(e.target.value) || 0) })}
                                    style={{ width: '50px', marginLeft: '4px', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff' }}
                                  />
                                </label>
                              </div>
                            </div>
                          )}

                          {/* Bandeau d'alignement rapide des chiffres si les sources divergent */}
                          {showCharsAndStaff &&
                            (valChars.totalChars > 0 || obsTotal > 0 || entry.bookingSummary.totalChars > 0) &&
                            hasDistinctSources && (
                              <div
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid #bae6fd',
                                  borderRadius: '8px',
                                  padding: '7px 10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span style={{ fontWeight: 800, color: '#0369a1' }}>⚡ Reprendre les chiffres de :</span>
                                {valChars.totalChars > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        monoCount: valChars.mono,
                                        biCount: valChars.bi,
                                        pilotsCount: entry.valItem?.pilotsCount ?? valChars.people,
                                      })
                                    }
                                    style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    📋 Planning ({valChars.totalChars} ch · {valChars.mono}m/{valChars.bi}b)
                                  </button>
                                )}
                                {obsTotal > 0 && entry.obs && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        monoCount: entry.obs!.monoCount ?? obsTotal,
                                        biCount: entry.obs!.biCount ?? 0,
                                        pilotsCount:
                                          entry.obs!.participantsCount ??
                                          (entry.obs!.monoCount ?? obsTotal) + (entry.obs!.biCount ?? 0) * 2,
                                      })
                                    }
                                    style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid #7dd3fc', background: '#f0f9ff', color: '#0369a1', fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    📝 REX ({obsTotal} ch)
                                  </button>
                                )}
                                {entry.bookingSummary.totalChars > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        monoCount: entry.bookingSummary.mono,
                                        biCount: entry.bookingSummary.bi,
                                        pilotsCount: entry.bookingSummary.people,
                                      })
                                    }
                                    style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    👥 Inscrits ({entry.bookingSummary.totalChars} ch)
                                  </button>
                                )}
                              </div>
                            )}

                          {/* Horaires (+ Matériel & Moniteurs uniquement si la séance est active / effectuée / décalée) */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                            <label style={{ fontWeight: 700 }}>
                              Début {draft.realignSlotKey && entry.computedMatch ? '(aligné)' : ':'}
                              <input
                                type="text"
                                readOnly={Boolean(draft.realignSlotKey && entry.computedMatch)}
                                value={
                                  draft.realignSlotKey && entry.computedMatch
                                    ? entry.computedMatch.startTime
                                    : draft.publishedStart
                                }
                                onChange={e => setDraft({ ...draft, publishedStart: e.target.value })}
                                style={{
                                  width: '100%',
                                  marginTop: '3px',
                                  padding: '5px 7px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  background: draft.realignSlotKey && entry.computedMatch ? '#f1f5f9' : '#ffffff',
                                }}
                              />
                            </label>
                            <label style={{ fontWeight: 700 }}>
                              Fin {draft.realignSlotKey && entry.computedMatch ? '(alignée)' : ':'}
                              <input
                                type="text"
                                readOnly={Boolean(draft.realignSlotKey && entry.computedMatch)}
                                value={
                                  draft.realignSlotKey && entry.computedMatch
                                    ? entry.computedMatch.endTime
                                    : draft.publishedEnd
                                }
                                onChange={e => setDraft({ ...draft, publishedEnd: e.target.value })}
                                style={{
                                  width: '100%',
                                  marginTop: '3px',
                                  padding: '5px 7px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  background: draft.realignSlotKey && entry.computedMatch ? '#f1f5f9' : '#ffffff',
                                }}
                              />
                            </label>

                            {(draft.situation === 'shifted' ||
                              ((draft.situation === 'realized' || draft.situation === 'open_active') &&
                                (normalizeTimeHHhMM(draft.actualStart) !== normalizeTimeHHhMM(draft.publishedStart) ||
                                  normalizeTimeHHhMM(draft.actualEnd) !== normalizeTimeHHhMM(draft.publishedEnd)))) && (
                              <>
                                <label style={{ fontWeight: 700 }}>
                                  Début réel (décalé) :
                                  <input
                                    type="text"
                                    value={draft.actualStart}
                                    onChange={e => setDraft({ ...draft, actualStart: e.target.value })}
                                    style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #f59e0b', background: '#fff' }}
                                  />
                                </label>
                                <label style={{ fontWeight: 700 }}>
                                  Fin réelle (décalée) :
                                  <input
                                    type="text"
                                    value={draft.actualEnd}
                                    onChange={e => setDraft({ ...draft, actualEnd: e.target.value })}
                                    style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #f59e0b', background: '#fff' }}
                                  />
                                </label>
                              </>
                            )}

                            {showCharsAndStaff && (
                              <>
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
                                    style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff' }}
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
                                    style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff' }}
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
                                    style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff' }}
                                  />
                                </label>
                              </>
                            )}

                            <label style={{ fontWeight: 700 }}>
                              Moniteur principal :
                              <input
                                type="text"
                                value={draft.instructor}
                                onChange={e => setDraft({ ...draft, instructor: e.target.value })}
                                style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff' }}
                              />
                            </label>

                            {showCharsAndStaff && (
                              <div style={{ fontWeight: 700 }}>
                                <label style={{ display: 'block' }}>
                                  2e moniteur :
                                  <input
                                    type="text"
                                    value={draft.secondaryInstructor}
                                    onChange={e => {
                                      const valName = e.target.value;
                                      setDraft({
                                        ...draft,
                                        secondaryInstructor: valName,
                                        secondaryQualification: valName.trim()
                                          ? valName.toLowerCase().includes('youenn')
                                            ? 'CQP'
                                            : draft.secondaryQualification || 'DE_BPJEPS'
                                          : undefined,
                                        secondaryMaxChars: valName.trim()
                                          ? valName.toLowerCase().includes('youenn')
                                            ? 8
                                            : draft.secondaryMaxChars ?? MAX_CHARS_PER_INSTRUCTOR
                                          : undefined,
                                      });
                                    }}
                                    placeholder="Optionnel (Youenn, Katleen...)"
                                    style={{ width: '100%', marginTop: '3px', padding: '5px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff' }}
                                  />
                                </label>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                                  {SECONDARY_INSTRUCTOR_PRESETS.map(p => {
                                    const isSel = draft.secondaryInstructor.toLowerCase().includes(p.name.toLowerCase());
                                    return (
                                      <button
                                        key={p.name}
                                        type="button"
                                        onClick={() =>
                                          setDraft({
                                            ...draft,
                                            secondaryInstructor: p.name,
                                            secondaryQualification: p.qualification,
                                            secondaryMaxChars: p.addChars,
                                          })
                                        }
                                        style={{
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          border: isSel ? '1.5px solid #6d28d9' : '1px solid #cbd5e1',
                                          background: isSel ? '#f5f3ff' : '#fff',
                                          color: isSel ? '#6d28d9' : '#475569',
                                          fontSize: '0.65rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        +{p.name} ({p.qualification === 'CQP' ? '+8 → 20' : '+12 → 24'})
                                      </button>
                                    );
                                  })}
                                  {draft.secondaryInstructor.trim() && (
                                    <>
                                      <select
                                        value={draft.secondaryQualification === 'CQP' ? 'CQP' : 'DE_BPJEPS'}
                                        onChange={e => {
                                          const q = e.target.value as 'CQP' | 'DE_BPJEPS';
                                          setDraft({
                                            ...draft,
                                            secondaryQualification: q,
                                            secondaryMaxChars: q === 'CQP' ? 8 : MAX_CHARS_PER_INSTRUCTOR,
                                          });
                                        }}
                                        style={{ padding: '2px 5px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.65rem', fontWeight: 700, background: '#fff' }}
                                      >
                                        <option value="CQP">CQP (+8 → 20 max)</option>
                                        <option value="DE_BPJEPS">Diplômé (+12 → 24 max)</option>
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDraft({
                                            ...draft,
                                            secondaryInstructor: '',
                                            secondaryQualification: undefined,
                                            secondaryMaxChars: undefined,
                                          })
                                        }
                                        style={{
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          border: '1px solid #fca5a5',
                                          background: '#fff',
                                          color: '#dc2626',
                                          fontSize: '0.65rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Options de réalignement & synchronisation REX */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {entry.computedMatch && !entry.computedMatch.isExactKeyMatch && (
                              <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 800, color: '#b45309', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={draft.realignSlotKey}
                                  onChange={e =>
                                    setDraft({
                                      ...draft,
                                      realignSlotKey: e.target.checked,
                                      publishedStart: e.target.checked
                                        ? entry.computedMatch!.startTime
                                        : draft.publishedStart,
                                      publishedEnd: e.target.checked
                                        ? entry.computedMatch!.endTime
                                        : draft.publishedEnd,
                                    })
                                  }
                                />
                                <span>
                                  🔗 Réaligner la référence du créneau sur la grille actuelle ({entry.computedMatch.startTime}–{entry.computedMatch.endTime})
                                </span>
                              </label>
                            )}

                            {draft.situation !== 'open_active' ? (
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '7px',
                                  fontWeight: 700,
                                  color: '#0369a1',
                                  cursor: entry.obs ? 'default' : 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  disabled={Boolean(entry.obs)}
                                  checked={Boolean(entry.obs) || draft.syncObservation}
                                  onChange={e => setDraft({ ...draft, syncObservation: e.target.checked })}
                                />
                                <span>
                                  🔄{' '}
                                  {entry.obs
                                    ? 'Le bilan REX existant sera automatiquement mis à jour (garantit 0 contradiction Planning / REX).'
                                    : 'Créer aussi une fiche Bilan REX cohérente avec cette décision'}
                                </span>
                              </label>
                            ) : entry.obs ? (
                              <div style={{ color: '#b45309', fontWeight: 700 }}>
                                ℹ️ En repassant ce créneau en « À venir / En cours », son ancien bilan REX prématuré sera nettoyé pour garder les écrans cohérents.
                              </div>
                            ) : null}
                          </div>

                          <label style={{ fontWeight: 700 }}>
                            Commentaire de validation / traçabilité (optionnel) :
                            <input
                              type="text"
                              value={draft.auditNote}
                              onChange={e => setDraft({ ...draft, auditNote: e.target.value })}
                              placeholder="Ex: Motif Fermé reclassé en Réunion · Chars alignés avec le cahier..."
                              style={{ width: '100%', marginTop: '3px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
                            />
                          </label>

                          {/* Garde-fou temps réel */}
                          {(coherence.blockingErrors.length > 0 || coherence.warnings.length > 0) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                              {coherence.blockingErrors.map((errMsg, idx) => (
                                <div
                                  key={`blk-${idx}`}
                                  style={{
                                    background: '#fee2e2',
                                    border: '1px solid #fca5a5',
                                    color: '#991b1b',
                                    padding: '6px 9px',
                                    borderRadius: '6px',
                                    fontWeight: 800,
                                    fontSize: '0.72rem',
                                  }}
                                >
                                  ⛔ {errMsg}
                                </div>
                              ))}
                              {coherence.warnings.map((warnMsg, idx) => (
                                <div
                                  key={`wrn-${idx}`}
                                  style={{
                                    background: '#fef3c7',
                                    border: '1px solid #fcd34d',
                                    color: '#92400e',
                                    padding: '6px 9px',
                                    borderRadius: '6px',
                                    fontWeight: 700,
                                    fontSize: '0.72rem',
                                  }}
                                >
                                  ⚠️ {warnMsg}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Boutons bas du formulaire */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
                            <div>
                              {confirmDeleteKey === entry.entryKey ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span style={{ color: '#991b1b', fontWeight: 800 }}>
                                    {entry.bookings.length > 0
                                      ? `Supprimer ce créneau ET ses ${entry.bookings.length} dossier(s) client(s) ?`
                                      : 'Supprimer définitivement ?'}
                                  </span>
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
                                disabled={isRowBusy || coherence.blockingErrors.length > 0}
                                title={coherence.blockingErrors[0] || undefined}
                                onClick={() => handleSaveReconciledEntry(entry)}
                                style={{
                                  padding: '7px 14px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: coherence.blockingErrors.length > 0 ? '#dc2626' : '#0284c7',
                                  color: '#ffffff',
                                  fontWeight: 900,
                                  opacity: coherence.blockingErrors.length > 0 || isRowBusy ? 0.72 : 1,
                                  cursor: coherence.blockingErrors.length > 0 || isRowBusy ? 'not-allowed' : 'pointer',
                                  boxShadow:
                                    coherence.blockingErrors.length > 0
                                      ? 'none'
                                      : '0 2px 8px rgba(2, 132, 199, 0.3)',
                                }}
                              >
                                {isRowBusy
                                  ? 'Enregistrement…'
                                  : coherence.blockingErrors.length > 0
                                  ? '⛔ Corriger le blocage ci-dessus'
                                  : '💾 Enregistrer & Valider comme cohérente'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
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
