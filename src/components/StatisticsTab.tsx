import React, { useState, useMemo, useEffect } from 'react';
import { AppSettings, BeachCadreConfig, CustomSlotsMap, GpsWaterlineLog, SlotObservation, TidePoint, ValidationsMap, WindPoint } from '../types';
import {
  AbsentSlotRef,
  CANCELLATION_REASONS_INFO,
  computePeriodStats,
  getStoredObservations,
  getFiscalYearStart,
  getFiscalYearBounds,
  upsertSlotObservation,
} from '../utils/statisticsEngine';
import { SlotObservationModal } from './SlotObservationModal';
import { StatisticsComparator } from './StatisticsComparator';
import { PhysicalCorrelationObservatory } from './PhysicalCorrelationObservatory';
import {
  AgendaBookingItem,
  subscribeToObservations,
  subscribeToWaterlineGpsLogs,
  subscribeToBeachCadreConfig,
  saveObservationToFirestore,
} from '../utils/firebaseSync';
import { getStoredBeachCadreConfig } from '../utils/beachCadreEngine';
import {
  computeTideCycleForSlot,
  getOfflineGpsQueue,
  getStoredWaterlineLogs,
  mergeOfflineQueueWithLogs,
} from '../utils/waterlineGpsEngine';
import {
  buildReservationKey,
  DEFAULT_NON_PUBLISH_REASONS,
  findMatchingValidationItem,
  getEffectiveCycle1Status,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  MAX_CHARS_PER_INSTRUCTOR,
  stripReasonAccents,
} from '../utils/cycleHelpers';
import { dayFocus, kOf, lc, minDs, maxDs, MOIS, p2, shf, tdy, win } from '../utils/tides';
import { getSlotWeatherRexDefaults } from '../utils/slotWeatherRex';

interface StatisticsTabProps {
  settings: AppSettings;
  EX: TidePoint[];
  windList: WindPoint[];
  validations: ValidationsMap;
  bookingsMap?: Record<string, AgendaBookingItem[]>;
  customSlotsMap: CustomSlotsMap;
  selectedDate: string;
  currentUserName?: string;
  isReadOnly?: boolean;
  onAddCustomNonPublishReason?: (reason: string) => void;
  onReclassifyValidationReason?: (targets: { ds: string; slotKey: string }[], newReason: string) => void;
  onObservationSaved?: (savedObs: SlotObservation) => void;
  onObservationDeleted?: (deletedObs: SlotObservation) => void;
}

export const StatisticsTab: React.FC<StatisticsTabProps> = ({
  settings,
  EX,
  windList,
  validations,
  bookingsMap = {},
  customSlotsMap,
  selectedDate,
  currentUserName,
  isReadOnly = false,
  onAddCustomNonPublishReason,
  onReclassifyValidationReason,
  onObservationSaved,
  onObservationDeleted,
}) => {
  // Liste des observations terrain enregistrées (données réelles uniquement)
  const [observations, setObservations] = useState<SlotObservation[]>(() =>
    getStoredObservations().filter(o => o && o.id && !o.id.startsWith('sample-obs-'))
  );
  // Relevés GPS bord d'eau + cadre terrain actif pour l'Observatoire Physique (dès 20/11/2026)
  const [gpsLogs, setGpsLogs] = useState<GpsWaterlineLog[]>(() =>
    mergeOfflineQueueWithLogs(getStoredWaterlineLogs(), getOfflineGpsQueue())
  );
  const [cadreConfig, setCadreConfig] = useState<BeachCadreConfig>(() => getStoredBeachCadreConfig());

  // Abonnement temps réel Firestore pour recevoir les relevés REX + GPS bord d'eau
  useEffect(() => {
    // Purger définitivement tout ancien échantillon fictif du stockage local
    try {
      localStorage.removeItem('char_slot_observations_v1');
      const stored = localStorage.getItem('cv_observations_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((o: SlotObservation) => o && o.id && !o.id.startsWith('sample-obs-'));
          localStorage.setItem('cv_observations_v1', JSON.stringify(clean));
          setObservations(clean);
        }
      }
    } catch {
      // ignore
    }

    const unsubscribe = subscribeToObservations(remoteObs => {
      const cleanRemote = (remoteObs || []).filter(o => o && o.id && !o.id.startsWith('sample-obs-'));
      setObservations(cleanRemote);
      try {
        localStorage.setItem('cv_observations_v1', JSON.stringify(cleanRemote));
      } catch {
        // ignore
      }
    });

    const unsubGps = subscribeToWaterlineGpsLogs(
      remoteLogs => {
        setGpsLogs(mergeOfflineQueueWithLogs(remoteLogs, getOfflineGpsQueue()));
      },
      () => {
        // Fallback silencieux sur le cache local si hors-ligne
      }
    );

    const unsubCadre = subscribeToBeachCadreConfig(
      remoteCadre => {
        setCadreConfig(remoteCadre);
      },
      () => {
        // Fallback silencieux sur le cadre local
      }
    );

    return () => {
      unsubscribe();
      unsubGps();
      unsubCadre();
    };
  }, []);

  // Modal de saisie / édition d'un relevé + sélecteur de date et vrai créneau (Option B)
  const todayStr = tdy();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingObservation, setEditingObservation] = useState<SlotObservation | null>(null);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<string>(() => {
    const initial = selectedDate && selectedDate <= todayStr ? selectedDate : todayStr;
    if (initial < minDs) return minDs;
    if (initial > maxDs) return maxDs;
    return initial;
  });
  const [selectedNewSlot, setSelectedNewSlot] = useState<{
    ds: string;
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    customTitle?: string;
    isCustom?: boolean;
    maxChars: number;
    primaryInstructor?: string;
    secondaryInstructor?: string;
  } | null>(null);

  // Requalification rétroactive des motifs de fermeture / absentéisme
  const [expandedReasonKey, setExpandedReasonKey] = useState<string | null>(null);
  const [selectedAbsentIds, setSelectedAbsentIds] = useState<Set<string>>(new Set());
  const [reclassifyReason, setReclassifyReason] = useState<string>(DEFAULT_NON_PUBLISH_REASONS[0]);
  const [reclassifyCustomInput, setReclassifyCustomInput] = useState('');
  const [isReclassifying, setIsReclassifying] = useState(false);

  const availableClosureReasons = useMemo(() => {
    const base: string[] = [...DEFAULT_NON_PUBLISH_REASONS];
    const seen = new Set(base.map(stripReasonAccents));
    for (const c of settings.customNonPublishReasons || []) {
      const t = c.trim();
      const k = stripReasonAccents(t);
      if (t && k !== 'ferme' && k !== 'fermee' && !seen.has(k)) {
        seen.add(k);
        base.push(t);
      }
    }
    return base;
  }, [settings.customNonPublishReasons]);

  const makeSlotUid = (s: AbsentSlotRef) => `${s.ds}__${s.slotKey}`;

  const openReclassifyDrawer = (reasonKey: string, slots: AbsentSlotRef[]) => {
    if (expandedReasonKey === reasonKey) {
      setExpandedReasonKey(null);
      return;
    }
    setExpandedReasonKey(reasonKey);
    setSelectedAbsentIds(new Set(slots.map(makeSlotUid)));
    setReclassifyReason(DEFAULT_NON_PUBLISH_REASONS[0]);
    setReclassifyCustomInput('');
  };

  const applyReclassifyReason = async (slots: AbsentSlotRef[], targetReason: string) => {
    const cleanReason = targetReason.trim();
    if (!cleanReason || selectedAbsentIds.size === 0 || isReadOnly) return;

    const chosenSlots = slots.filter(s => selectedAbsentIds.has(makeSlotUid(s)));
    if (chosenSlots.length === 0) return;

    setIsReclassifying(true);
    try {
      const normCustom = stripReasonAccents(cleanReason);
      const isDefaultOrKnown = availableClosureReasons.some(
        r => stripReasonAccents(r) === normCustom
      );
      if (!isDefaultOrKnown) {
        onAddCustomNonPublishReason?.(cleanReason);
      }

      // 1. Mise à jour des validations Cycle 1 concernées
      const valTargets = chosenSlots
        .filter(s => validations[s.ds]?.items?.some(it => it.k === s.slotKey))
        .map(s => ({ ds: s.ds, slotKey: s.slotKey }));
      if (valTargets.length > 0 && onReclassifyValidationReason) {
        onReclassifyValidationReason(valTargets, cleanReason);
      }

      // 2. Mise à jour des observations REX concernées (sans doublons)
      const obsIdsToUpdate = new Set<string>();
      for (const s of chosenSlots) {
        if (s.observationId) obsIdsToUpdate.add(s.observationId);
      }
      if (obsIdsToUpdate.size > 0) {
        let nextObsList = observations;
        const obsToSave: SlotObservation[] = [];
        observations.forEach(obs => {
          if (obsIdsToUpdate.has(obs.id)) {
            const updated: SlotObservation = {
              ...obs,
              cancellationNote: cleanReason,
              updatedAt: Date.now(),
            };
            obsToSave.push(updated);
            nextObsList = upsertSlotObservation(updated);
          }
        });
        setObservations(nextObsList);
        await Promise.all(obsToSave.map(o => saveObservationToFirestore(o)));
      }

      setExpandedReasonKey(null);
    } catch (err) {
      console.error('Erreur requalification motif fermeture:', err);
    } finally {
      setIsReclassifying(false);
    }
  };

  // Mode d'affichage : Bilan simple d'une période ou Comparateur multi-périodes
  const [viewMode, setViewMode] = useState<'single' | 'comparator'>('single');

  // Granularité temporelle : 'week' | 'month' | 'year' | 'all'
  const [timeGranularity, setTimeGranularity] = useState<'week' | 'month' | 'year' | 'all'>('month');

  // Filtre de population / jours : 'all' | 'holidays_only' | 'weekends_only'
  const [filterScope, setFilterScope] = useState<'all' | 'holidays_only' | 'weekends_only'>('all');

  // Mois / Année d'analyse modifiables directement dans les statistiques
  const [statsYear, setStatsYear] = useState<number>(() => {
    return parseInt(selectedDate.slice(0, 4), 10) || 2026;
  });
  const [statsMonth, setStatsMonth] = useState<number>(() => {
    return parseInt(selectedDate.slice(5, 7), 10) || 11;
  });
  // Exercice comptable de Jérôme (1er novembre -> 31 octobre)
  const [statsFiscalYear, setStatsFiscalYear] = useState<number>(() => {
    return getFiscalYearStart(selectedDate || '2026-11-01');
  });
  const [statsRefDate, setStatsRefDate] = useState<string>(selectedDate || '2026-11-01');

  // Synchronisation avec la date active sélectionnée sur le calendrier
  useEffect(() => {
    if (selectedDate) {
      const [y, m] = selectedDate.split('-').map(Number);
      if (y && m) {
        setStatsYear(y);
        setStatsMonth(m);
        setStatsFiscalYear(getFiscalYearStart(selectedDate));
        setStatsRefDate(selectedDate);
      }
    }
  }, [selectedDate]);

  // Liste des années civiles disponibles dans le jeu de données SHOM (2026 à 2031)
  const availableYears = useMemo(() => {
    const minY = parseInt(minDs.slice(0, 4), 10) || 2026;
    const maxY = parseInt(maxDs.slice(0, 4), 10) || 2031;
    const list: number[] = [];
    for (let y = minY; y <= maxY; y++) list.push(y);
    return list;
  }, []);

  // Liste des exercices comptables disponibles (01/11 -> 31/10)
  const availableFiscalYears = useMemo(() => {
    const minFY = getFiscalYearStart(minDs);
    const maxFY = getFiscalYearStart(maxDs);
    const list: number[] = [];
    for (let fy = minFY; fy <= maxFY; fy++) list.push(fy);
    return list;
  }, []);

  // Calcul des bornes de dates selon la granularité sélectionnée
  const { startDateStr, endDateStr, periodTitle } = useMemo(() => {
    if (timeGranularity === 'week') {
      const d = new Date(`${statsRefDate}T00:00:00`);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Lundi
      const monday = new Date(d.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const sStr = monday.toISOString().slice(0, 10);
      const eStr = sunday.toISOString().slice(0, 10);
      return {
        startDateStr: sStr < minDs ? minDs : sStr,
        endDateStr: eStr > maxDs ? maxDs : eStr,
        periodTitle: `Semaine du ${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      };
    }

    if (timeGranularity === 'month') {
      const lastDay = new Date(statsYear, statsMonth, 0).getDate();
      const sStr = `${statsYear}-${p2(statsMonth)}-01`;
      const eStr = `${statsYear}-${p2(statsMonth)}-${p2(lastDay)}`;
      const monthName = MOIS[statsMonth - 1] || 'novembre';
      return {
        startDateStr: sStr < minDs ? minDs : sStr,
        endDateStr: eStr > maxDs ? maxDs : eStr,
        periodTitle: `Mois de ${monthName} ${statsYear}`,
      };
    }

    if (timeGranularity === 'year') {
      const bounds = getFiscalYearBounds(statsFiscalYear);
      const clampedStart = bounds.startDateStr < minDs ? minDs : bounds.startDateStr;
      const clampedEnd = bounds.endDateStr > maxDs ? maxDs : bounds.endDateStr;
      const isPartial = bounds.endDateStr > maxDs;
      return {
        startDateStr: clampedStart,
        endDateStr: clampedEnd,
        periodTitle: isPartial
          ? `${bounds.fullLabel} · jusqu'au ${maxDs.split('-').reverse().join('/')}`
          : bounds.fullLabel,
      };
    }

    // 'all' : Historique complet (à partir du 01/11/2026)
    const startY = minDs.slice(0, 4);
    const endY = maxDs.slice(0, 4);
    return {
      startDateStr: minDs,
      endDateStr: maxDs,
      periodTitle: `Historique global (${startY}–${endY})`,
    };
  }, [timeGranularity, statsRefDate, statsYear, statsMonth, statsFiscalYear]);

  // Calcul des statistiques de la période sélectionnée
  const periodStats = useMemo(() => {
    return computePeriodStats(
      startDateStr,
      endDateStr,
      settings,
      EX,
      windList,
      validations,
      customSlotsMap,
      observations,
      filterScope
    );
  }, [startDateStr, endDateStr, settings, EX, windList, validations, customSlotsMap, observations, filterScope]);

  // Cadre terrain actif pour le calcul de largeur plage réelle
  const activeCadreProfile = cadreConfig.profiles[cadreConfig.activeProfile];

  // Carnet de bord trié du plus récent au plus ancien (date puis horaire de début décroissants)
  const sortedObservations = useMemo(() => {
    const normStart = (s?: string) => (s || '').replace('h', ':').padStart(5, '0');
    return [...observations].sort((a, b) => {
      const dateCmp = (b.ds || '').localeCompare(a.ds || '');
      if (dateCmp !== 0) return dateCmp;
      const timeCmp = normStart(b.slotStart).localeCompare(normStart(a.slotStart));
      if (timeCmp !== 0) return timeCmp;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }, [observations]);

  const pickerDaySlots = useMemo(() => {
    if (!slotPickerOpen || !pickerDate) return [];
    const effThreshold = settings.L - (settings.mg || 0) / 100;
    const tideW = win(EX, effThreshold);
    const first = EX[0]?.t ?? 0;
    const last = EX[EX.length - 1]?.t ?? 0;
    const focusData = dayFocus(pickerDate, settings, tideW, first, last, windList, customSlotsMap);
    const dayVal = validations[pickerDate];
    const dayObs = observations.filter(o => o.ds === pickerDate);
    const normT = (v?: string) => (v || '').replace('h', ':');

    type PickerSlot = {
      slotKey: string;
      slotStart: string;
      slotEnd: string;
      customTitle?: string;
      isCustom?: boolean;
      maxChars: number;
      primaryInstructor?: string;
      secondaryInstructor?: string;
      statusLabel: string;
      statusColor: string;
      statusBg: string;
      bookedPeople: number;
      existingObs: SlotObservation | null;
    };

    const items: PickerSlot[] = [];
    const seenKeys = new Set<string>();

    const buildStatusBadge = (valItem?: ReturnType<typeof findMatchingValidationItem>, existingObs?: SlotObservation | null) => {
      if (existingObs) {
        return existingObs.status === 'realized'
          ? { label: '✓ REX : Réalisée', color: '#166534', bg: '#dcfce7' }
          : { label: '⛔ REX : Annulée', color: '#b91c1c', bg: '#fee2e2' };
      }
      if (!valItem) {
        return { label: 'Non validé C1', color: '#64748b', bg: '#f1f5f9' };
      }
      if (valItem.cycle2Status === 'realized') {
        return { label: '🏁 Effectuée', color: '#166534', bg: '#dcfce7' };
      }
      if (valItem.cycle2Status === 'cancelled_weather') {
        return { label: '⛔ Annulé météo', color: '#b91c1c', bg: '#fee2e2' };
      }
      const effC1 = getEffectiveCycle1Status(valItem);
      if (effC1 === 'excluded') {
        return { label: 'Hors offre C1', color: '#475569', bg: '#f1f5f9' };
      }
      if (effC1 === 'not_published') {
        return { label: '🚫 Non publié C1', color: '#991b1b', bg: '#fef2f2' };
      }
      if (effC1 === 'closed_no_bookings') {
        return { label: "Pas d'inscrit", color: '#92400e', bg: '#fef3c7' };
      }
      return { label: '✅ Publié C1', color: '#0369a1', bg: '#e0f2fe' };
    };

    focusData.list
      .filter(s => s.txt !== 'n/a')
      .forEach(s => {
        const sKey = kOf(s);
        const startStr = lc(s.a, focusData.y, focusData.m, focusData.d).replace('h', ':');
        const endStr = lc(s.b, focusData.y, focusData.m, focusData.d).replace('h', ':');
        const valItem = findMatchingValidationItem(dayVal, sKey, startStr, endStr);
        const finalKey = valItem?.k || sKey;
        seenKeys.add(finalKey);
        seenKeys.add(sKey);
        const displayStart = normT(valItem?.actualStart || valItem?.publishedStart || valItem?.s || startStr);
        const displayEnd = normT(valItem?.actualEnd || valItem?.publishedEnd || valItem?.e || endStr);
        const existingObs =
          dayObs.find(o => o.slotKey === finalKey || o.slotKey === sKey) ||
          dayObs.find(
            o =>
              normT(o.slotStart) === displayStart &&
              normT(o.slotEnd) === displayEnd
          ) ||
          null;
        const maxChars = valItem ? getSlotMaxCapacity(valItem) : MAX_CHARS_PER_INSTRUCTOR;
        const bookings =
          bookingsMap[buildReservationKey(pickerDate, finalKey)] ||
          bookingsMap[buildReservationKey(pickerDate, sKey)] ||
          [];
        const bookedPeople = getSlotBookingsSummary(bookings, maxChars).totalPeople;
        const badge = buildStatusBadge(valItem, existingObs);
        items.push({
          slotKey: finalKey,
          slotStart: displayStart,
          slotEnd: displayEnd,
          customTitle: valItem?.customTitle || s.customTitle,
          isCustom: Boolean(s.isCustom || finalKey.endsWith('c')),
          maxChars,
          primaryInstructor: valItem?.instructor || existingObs?.author || 'Jérôme',
          secondaryInstructor: valItem?.secondaryInstructor || existingObs?.secondaryInstructor,
          statusLabel: badge.label,
          statusColor: badge.color,
          statusBg: badge.bg,
          bookedPeople,
          existingObs,
        });
      });

    // Inclure d'éventuels créneaux enregistrés en validation absents du calcul du jour
    (dayVal?.items || []).forEach(valItem => {
      if (seenKeys.has(valItem.k)) return;
      const displayStart = normT(valItem.actualStart || valItem.publishedStart || valItem.s);
      const displayEnd = normT(valItem.actualEnd || valItem.publishedEnd || valItem.e);
      const existingObs =
        dayObs.find(o => o.slotKey === valItem.k) ||
        dayObs.find(
          o => normT(o.slotStart) === displayStart && normT(o.slotEnd) === displayEnd
        ) ||
        null;
      const maxChars = getSlotMaxCapacity(valItem);
      const bookings = bookingsMap[buildReservationKey(pickerDate, valItem.k)] || [];
      const bookedPeople = getSlotBookingsSummary(bookings, maxChars).totalPeople;
      const badge = buildStatusBadge(valItem, existingObs);
      items.push({
        slotKey: valItem.k,
        slotStart: displayStart,
        slotEnd: displayEnd,
        customTitle: valItem.customTitle,
        isCustom: valItem.k.endsWith('c'),
        maxChars,
        primaryInstructor: valItem.instructor || existingObs?.author || 'Jérôme',
        secondaryInstructor: valItem.secondaryInstructor || existingObs?.secondaryInstructor,
        statusLabel: badge.label,
        statusColor: badge.color,
        statusBg: badge.bg,
        bookedPeople,
        existingObs,
      });
    });

    return items.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  }, [slotPickerOpen, pickerDate, settings, EX, windList, customSlotsMap, validations, observations, bookingsMap]);

  const handleOpenNewObservation = () => {
    const defaultDate = selectedDate && selectedDate <= todayStr ? selectedDate : todayStr;
    const clamped = defaultDate < minDs ? minDs : defaultDate > maxDs ? maxDs : defaultDate;
    setPickerDate(clamped);
    setSelectedNewSlot(null);
    setEditingObservation(null);
    setSlotPickerOpen(true);
  };

  const handleEditObservation = (obs: SlotObservation) => {
    setSelectedNewSlot(null);
    setEditingObservation(obs);
    setModalOpen(true);
  };

  // Survol interactif du camembert
  const [hoveredReasonIndex, setHoveredReasonIndex] = useState<number | null>(null);

  // Construction des tranches du camembert SVG
  const pieSlices = useMemo(() => {
    const total = periodStats.cancellationReasonsBreakdown.reduce((sum, item) => sum + item.count, 0);
    if (total === 0) return [];

    let currentAngle = 0;
    return periodStats.cancellationReasonsBreakdown.map((item, idx) => {
      const sliceAngle = (item.count / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      currentAngle = endAngle;

      // Coordonnées SVG de l'arc (rayon 100, centre 120, 120)
      const r = 90;
      const cx = 120;
      const cy = 120;

      const radStart = (startAngle - 90) * (Math.PI / 180);
      const radEnd = (endAngle - 90) * (Math.PI / 180);

      const x1 = cx + r * Math.cos(radStart);
      const y1 = cy + r * Math.sin(radStart);
      const x2 = cx + r * Math.cos(radEnd);
      const y2 = cy + r * Math.sin(radEnd);

      const largeArcFlag = sliceAngle > 180 ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      return {
        ...item,
        path: d,
        index: idx,
      };
    });
  }, [periodStats.cancellationReasonsBreakdown]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* 1. HEADER & ACTIONS BAR */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--card)',
          border: '1px solid var(--bd)',
        }}
      >
        <div>
          <div style={{ textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 800, color: 'var(--mu)', letterSpacing: '0.06em' }}>
            Char à Voile du Bout du Monde · Plage de Lestrevet
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 900, color: 'var(--tx)' }}>
            📊 Statistiques Opérationnelles & Observatoire des Écarts
          </h2>
          <div style={{ fontSize: '0.78rem', color: 'var(--mu)', marginTop: '2px' }}>
            Taux de concrétisation, analyse des causes de non-réalisation et calibration fine du spot.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="fbtn"
            onClick={handleOpenNewObservation}
            style={{
              margin: 0,
              padding: '8px 14px',
              fontSize: '0.78rem',
              fontWeight: 800,
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>+</span>
            <span>Noter un relevé terrain</span>
          </button>
        </div>
      </div>

      {/* SÉLECTEUR DE MODE : BILAN PÉRIODE SIMPLE VS COMPARATEUR MULTI-PÉRIODES */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '10px' }}>
          <button
            type="button"
            onClick={() => setViewMode('single')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: viewMode === 'single' ? '#0f172a' : 'transparent',
              color: viewMode === 'single' ? '#fff' : '#475569',
              fontSize: '0.80rem',
              fontWeight: viewMode === 'single' ? 800 : 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <span>📊</span>
            <span>Bilan d'une Période</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('comparator')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: viewMode === 'comparator' ? '#0284c7' : 'transparent',
              color: viewMode === 'comparator' ? '#fff' : '#475569',
              fontSize: '0.80rem',
              fontWeight: viewMode === 'comparator' ? 800 : 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <span>⚖️</span>
            <span>Comparateur Multi-Périodes (A vs B)</span>
          </button>
        </div>

        {viewMode === 'comparator' && (
          <div style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 700 }}>
            ⚡ Comparaison directe d'une année sur l'autre, d'un mois ou d'un trimestre
          </div>
        )}
      </div>

      {viewMode === 'comparator' ? (
        <StatisticsComparator
          settings={settings}
          EX={EX}
          windList={windList}
          validations={validations}
          customSlotsMap={customSlotsMap}
          observations={observations}
          availableYears={availableYears}
        />
      ) : (
        <>
          {/* 2. SÉLECTEUR DE PÉRIODE & FILTRES */}
          <div
            style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--cell, #f1f5f9)',
          padding: '10px 14px',
          borderRadius: '10px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        {/* Sélecteur de granularité : Semaine / Mois / Exercice comptable (01/11–31/10) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase' }}>
            Période :
          </span>
          <div style={{ display: 'inline-flex', background: '#fff', padding: '2px', borderRadius: '8px', border: '1px solid var(--bd, #cbd5e1)' }}>
            {[
              { id: 'week', label: 'Semaine' },
              { id: 'month', label: 'Mois' },
              { id: 'year', label: `Exercice ${statsFiscalYear}/${String(statsFiscalYear + 1).slice(-2)}` },
              { id: 'all', label: 'Tout' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTimeGranularity(tab.id as any)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: timeGranularity === tab.id ? '#0f172a' : 'transparent',
                  color: timeGranularity === tab.id ? '#fff' : '#64748b',
                  fontSize: '0.76rem',
                  fontWeight: timeGranularity === tab.id ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Contrôles de navigation contextuelle selon la granularité */}
          {timeGranularity === 'year' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setStatsFiscalYear(fy => Math.max(availableFiscalYears[0], fy - 1))}
                disabled={statsFiscalYear <= availableFiscalYears[0]}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: statsFiscalYear <= availableFiscalYears[0] ? '#f1f5f9' : '#fff',
                  cursor: statsFiscalYear <= availableFiscalYears[0] ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                }}
                title="Exercice comptable précédent"
              >
                ‹
              </button>
              <select
                value={statsFiscalYear}
                onChange={e => setStatsFiscalYear(Number(e.target.value))}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #0284c7',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  background: '#f0f9ff',
                  color: '#0369a1',
                  cursor: 'pointer',
                }}
              >
                {availableFiscalYears.map(fy => {
                  const b = getFiscalYearBounds(fy);
                  const isPartial = b.endDateStr > maxDs;
                  return (
                    <option key={fy} value={fy}>
                      Exercice {fy}–{fy + 1} (01/11 → 31/10{isPartial ? ', partiel' : ''})
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() =>
                  setStatsFiscalYear(fy => Math.min(availableFiscalYears[availableFiscalYears.length - 1], fy + 1))
                }
                disabled={statsFiscalYear >= availableFiscalYears[availableFiscalYears.length - 1]}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: statsFiscalYear >= availableFiscalYears[availableFiscalYears.length - 1] ? '#f1f5f9' : '#fff',
                  cursor: statsFiscalYear >= availableFiscalYears[availableFiscalYears.length - 1] ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                }}
                title="Exercice comptable suivant"
              >
                ›
              </button>
            </div>
          )}

          {timeGranularity === 'month' && (() => {
            const [minY, minM] = minDs.split('-').map(Number);
            const [maxY, maxM] = maxDs.split('-').map(Number);
            const isAtMin = statsYear < minY || (statsYear === minY && statsMonth <= minM);
            const isAtMax = statsYear > maxY || (statsYear === maxY && statsMonth >= maxM);
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  disabled={isAtMin}
                  onClick={() => {
                    if (isAtMin) return;
                    if (statsMonth === 1) {
                      setStatsYear(y => y - 1);
                      setStatsMonth(12);
                    } else {
                      setStatsMonth(m => m - 1);
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: isAtMin ? '#f1f5f9' : '#fff',
                    cursor: isAtMin ? 'not-allowed' : 'pointer',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                  }}
                  title="Mois précédent"
                >
                  ‹
                </button>
                <select
                  value={statsMonth}
                  onChange={e => setStatsMonth(Number(e.target.value))}
                  style={{
                    padding: '4px 6px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {MOIS.map((mName, idx) => {
                    const mNum = idx + 1;
                    const disabled =
                      (statsYear === minY && mNum < minM) ||
                      (statsYear === maxY && mNum > maxM);
                    return (
                      <option key={mNum} value={mNum} disabled={disabled}>
                        {mName.charAt(0).toUpperCase() + mName.slice(1)}
                      </option>
                    );
                  })}
                </select>
                <select
                  value={statsYear}
                  onChange={e => {
                    const nextY = Number(e.target.value);
                    setStatsYear(nextY);
                    if (nextY === minY && statsMonth < minM) setStatsMonth(minM);
                    if (nextY === maxY && statsMonth > maxM) setStatsMonth(maxM);
                  }}
                  style={{
                    padding: '4px 6px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={isAtMax}
                  onClick={() => {
                    if (isAtMax) return;
                    if (statsMonth === 12) {
                      setStatsYear(y => y + 1);
                      setStatsMonth(1);
                    } else {
                      setStatsMonth(m => m + 1);
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: isAtMax ? '#f1f5f9' : '#fff',
                    cursor: isAtMax ? 'not-allowed' : 'pointer',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                  }}
                  title="Mois suivant"
                >
                  ›
                </button>
              </div>
            );
          })()}

          {timeGranularity === 'week' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={() => {
                  const prev = shf(statsRefDate, -7);
                  if (prev >= minDs) setStatsRefDate(prev);
                }}
                disabled={shf(statsRefDate, -7) < minDs}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: shf(statsRefDate, -7) < minDs ? '#f1f5f9' : '#fff',
                  cursor: shf(statsRefDate, -7) < minDs ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                }}
                title="Semaine précédente"
              >
                ‹ Sem. préc.
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = shf(statsRefDate, 7);
                  if (next <= maxDs) setStatsRefDate(next);
                }}
                disabled={shf(statsRefDate, 7) > maxDs}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: shf(statsRefDate, 7) > maxDs ? '#f1f5f9' : '#fff',
                  cursor: shf(statsRefDate, 7) > maxDs ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                }}
                title="Semaine suivante"
              >
                Sem. suiv. ›
              </button>
            </div>
          )}

          <span style={{ fontWeight: 800, fontSize: '0.82rem', color: '#0f172a', marginLeft: '6px' }}>
            {periodTitle}
          </span>
          {periodStats.isCappedToToday && (
            <span
              style={{
                fontSize: '0.70rem',
                fontWeight: 700,
                color: '#0369a1',
                background: '#e0f2fe',
                border: '1px solid #bae6fd',
                borderRadius: '6px',
                padding: '2px 7px',
              }}
              title="Les statistiques et taux ne prennent en compte que les jours déjà écoulés jusqu'à aujourd'hui"
            >
              ⏱️ Calculé jusqu&apos;au {periodStats.effectiveEndDateStr.split('-').reverse().join('/')} (passé uniquement)
            </span>
          )}
          {periodStats.isFuturePeriod && (
            <span
              style={{
                fontSize: '0.70rem',
                fontWeight: 700,
                color: '#92400e',
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                padding: '2px 7px',
              }}
            >
              ⏳ Période future (taux non calculés avant échéance)
            </span>
          )}
        </div>

        {/* Filtre contextuel : Tous les jours / Vacances / Week-ends */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase' }}>
            Filtre :
          </span>
          <div style={{ display: 'inline-flex', background: '#fff', padding: '2px', borderRadius: '8px', border: '1px solid var(--bd, #cbd5e1)' }}>
            {[
              { id: 'all', label: 'Tous les jours' },
              { id: 'weekends_only', label: 'Week-ends uniquement' },
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterScope(f.id as any)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: filterScope === f.id ? '#0284c7' : 'transparent',
                  color: filterScope === f.id ? '#fff' : '#64748b',
                  fontSize: '0.74rem',
                  fontWeight: filterScope === f.id ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. CARTES DES MÉTRIQUES CLÉS (KPIS) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        {/* KPI 1 : Taux de concrétisation */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #0284c7',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1', letterSpacing: '0.04em' }}>
            🎯 Taux de concrétisation
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
              {periodStats.isFuturePeriod ? '—' : `${periodStats.realizationRate}%`}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700 }}>
              réalisées
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            {periodStats.isFuturePeriod ? (
              'Période à venir : les taux seront calculés au fur et à mesure des séances échues.'
            ) : periodStats.totalRealizedSlots > 0 ? (
              <>
                <strong>{periodStats.totalRealizedSlots}</strong> réalisées sur <strong>{periodStats.totalPossibleSlots}</strong> créneaux {periodStats.excludedSlotsCount > 0 ? 'retenus' : 'possibles'}
              </>
            ) : (
              `0 séance validée sur ${periodStats.totalPossibleSlots} créneaux ${periodStats.excludedSlotsCount > 0 ? 'retenus' : 'possibles calculés'}`
            )}
            {periodStats.excludedSlotsCount > 0 && (
              <div style={{ marginTop: '4px', fontSize: '0.69rem', color: '#475569', fontWeight: 700 }}>
                ➖ {periodStats.excludedSlotsCount} écarté{periodStats.excludedSlotsCount > 1 ? 's' : ''} hors offre en C1 (sur {periodStats.theoreticalCalculatedSlots} théoriques)
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: '0.67rem',
              color: '#0369a1',
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: '1px dashed #bae6fd',
              lineHeight: '1.25',
            }}
          >
            ℹ️ <em>Séances courues rapportées aux créneaux retenus (hors créneaux écartés « Hors offre » en C1).</em>
          </div>
        </div>

        {/* KPI 2 : Séances Annulées / Non Réalisées */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #ef4444',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#b91c1c', letterSpacing: '0.04em' }}>
            ⛔ Séances non réalisées
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#dc2626', fontFamily: 'monospace' }}>
              {periodStats.totalCancelledSlots}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#dc2626', fontWeight: 700 }}>
              créneau{periodStats.totalCancelledSlots > 1 ? 'x' : ''}
            </span>
          </div>

          {/* Distinction Absentéisme plage / Vie 1 (faute d'inscrits) / Vie 2 (météo & état plage) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px', fontSize: '0.70rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#334155', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
              <span>• Non publié C1 / Absentéisme :</span>
              <strong>{periodStats.instructorAbsentSlotsCount}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#991b1b', background: '#fff1f2', padding: '2px 6px', borderRadius: '4px' }}>
              <span>• Pas d&apos;inscrits (Vie 2) :</span>
              <strong>{periodStats.unbookedSlotsCount}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#991b1b', background: '#fef2f2', padding: '2px 6px', borderRadius: '4px' }}>
              <span>• Annulées météo / plage (Vie 2) :</span>
              <strong>{periodStats.weatherCancelledSlotsCount}</strong>
            </div>
          </div>

          <div
            style={{
              fontSize: '0.67rem',
              color: '#b91c1c',
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: '1px dashed #fecaca',
              lineHeight: '1.25',
            }}
          >
            ℹ️ <em>Dissocie l&apos;absentéisme C1, les créneaux sans réservation et la météo / état plage.</em>
          </div>
        </div>

        {/* KPI 2b : Taux d'absentéisme sur la plage (hors météo / clients / état plage) */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #475569',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#334155', letterSpacing: '0.04em' }}>
            🚫 Absentéisme plage (Cycle 1)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
              {periodStats.isFuturePeriod ? '—' : `${periodStats.instructorAbsenteeismRate}%`}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#475569', fontWeight: 700 }}>
              non publiés
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            <strong>{periodStats.instructorAbsentSlotsCount}</strong> créneau{periodStats.instructorAbsentSlotsCount > 1 ? 'x' : ''} sur{' '}
            <strong>{periodStats.totalPossibleSlots}</strong> {periodStats.excludedSlotsCount > 0 ? 'retenus' : 'possibles'}
            {periodStats.instructorAbsentReasonsBreakdown.length > 0 && (
              <div style={{ marginTop: '4px', fontSize: '0.69rem', color: '#1e293b', fontWeight: 700 }}>
                Motif #1 : {periodStats.instructorAbsentReasonsBreakdown[0].reason} ({periodStats.instructorAbsentReasonsBreakdown[0].count})
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: '0.67rem',
              color: '#475569',
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: '1px dashed #cbd5e1',
              lineHeight: '1.25',
            }}
          >
            ℹ️ <em>Absentéisme sur la plage hors météo, manque de clients ou état de la plage.</em>
          </div>
        </div>

        {/* KPI 3 : Remplissage, Participants & Sauvetage Commercial */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #10b981',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#047857', letterSpacing: '0.04em' }}>
            👥 Pilotes & Sauvetage Commercial
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
              {periodStats.totalRealizedParticipants}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>
              ont roulé
            </span>
          </div>

          {/* Détail spécifique demandé par Jérôme : Inscrits qui n'ont pas roulé, replacés vs perdus */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px', fontSize: '0.70rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b91c1c' }}>
              <span>• Inscrits météo annulée :</span>
              <strong>{periodStats.totalCancelledParticipants}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#15803d' }}>
              <span>• Dont replacés (sauvés) :</span>
              <strong>{periodStats.totalRescheduledParticipants} ({periodStats.rescheduledRate}%)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>• Dont perdus / remboursés :</span>
              <strong>{periodStats.totalLostParticipants}</strong>
            </div>
          </div>

          <div
            style={{
              fontSize: '0.67rem',
              color: '#047857',
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: '1px dashed #a7f3d0',
              lineHeight: '1.25',
            }}
          >
            ℹ️ <em>Remplissage moyen : {periodStats.avgFillRate}% (base 12 chars max / moniteur · {periodStats.totalRealizedChars} chars sortis).</em>
          </div>
        </div>

        {/* KPI 4 : Répartition Flotte Chars (Mono / Bi) & Pilotage Cycle 1/2 */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid var(--bd)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--mu)', letterSpacing: '0.04em' }}>
            🏎️ Flotte Chars ({periodStats.totalRealizedChars} chars)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '6px' }}>
            <div>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a' }}>{periodStats.totalMono}</span>
              <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '3px' }}>Mono</span>
            </div>
            <div style={{ color: '#cbd5e1' }}>|</div>
            <div>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a' }}>{periodStats.totalBi}</span>
              <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '3px' }}>Bi</span>
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            {periodStats.totalMono + periodStats.totalBi > 0
              ? `${Math.round((periodStats.totalMono / (periodStats.totalMono + periodStats.totalBi)) * 100)}% monoplaces · ${periodStats.cycle2ShiftedCount} décalage(s)`
              : `${periodStats.cycle1PublishedCount} en attente Cycle 1 · ${periodStats.cycle2ShiftedCount} décalée(s)`}
          </div>
          <div
            style={{
              fontSize: '0.67rem',
              color: '#475569',
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: '1px dashed #e2e8f0',
              lineHeight: '1.25',
            }}
          >
            ℹ️ <em>1 mono = 1 char · 1 bi = 1 char · max 12 chars/moniteur ({periodStats.cycle2MergedCount} fusion(s) Cycle 2).</em>
          </div>
        </div>
      </div>

      {/* 4. SECTION 1 : LE CAMEMBERT DES CAUSES DE NON-RÉALISATION */}
      <div
        className="card"
        style={{
          padding: '18px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
          <div>
            <div style={{ textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 800, color: '#dc2626', letterSpacing: '0.04em' }}>
              Analyse des Annulations · Lestrevet
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
              🥧 Pourquoi les séances n'ont-elles pas eu lieu ?
            </h3>
            <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
              Vent trop faible, rafales excessives, mauvais secteur ou absence d'inscrits sur la période.
            </div>
            <div style={{ fontSize: '0.68rem', color: '#991b1b', marginTop: '3px', fontStyle: 'italic' }}>
              ℹ️ Pourcentage de chaque motif calculé sur le total des {periodStats.totalCancelledSlots} séances non réalisées.
            </div>
          </div>

          <div style={{ fontSize: '0.74rem', background: '#fef2f2', color: '#991b1b', padding: '4px 10px', borderRadius: '6px', fontWeight: 800, border: '1px solid #fecaca' }}>
            Total : {periodStats.totalCancelledSlots} séance{periodStats.totalCancelledSlots > 1 ? 's' : ''} non réalisée{periodStats.totalCancelledSlots > 1 ? 's' : ''}
          </div>
        </div>

        {periodStats.totalRealizedSlots === 0 && periodStats.totalCancelledSlots === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b', fontSize: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            📋 Aucune séance enregistrée (validée ou annulée) sur cette période. Les statistiques s'alimenteront automatiquement à mesure de vos validations et relevés réels.
          </div>
        ) : pieSlices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: '#166534', fontSize: '0.85rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
            🎉 Aucune séance annulée sur cette période ! 100% des créneaux validés ont été réalisés.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'center' }}>
            {/* Graphique SVG Camembert */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
              <svg width="240" height="240" viewBox="0 0 240 240" style={{ transform: 'rotate(0deg)' }}>
                {pieSlices.map(slice => {
                  const isHovered = hoveredReasonIndex === slice.index;
                  return (
                    <path
                      key={slice.reason}
                      d={slice.path}
                      fill={slice.info.color}
                      stroke="#fff"
                      strokeWidth="2"
                      style={{
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease, opacity 0.15s ease',
                        transformOrigin: '120px 120px',
                        transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                        opacity: hoveredReasonIndex != null && !isHovered ? 0.6 : 1,
                      }}
                      onMouseEnter={() => setHoveredReasonIndex(slice.index)}
                      onMouseLeave={() => setHoveredReasonIndex(null)}
                    >
                      <title>{`${slice.info.label}: ${slice.count} séance(s) (${Math.round(slice.percentage)}%)`}</title>
                    </path>
                  );
                })}
                {/* Cercle central pour effet Donut moderne */}
                <circle cx="120" cy="120" r="48" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
                <text x="120" y="115" textAnchor="middle" style={{ fontSize: '0.8rem', fontWeight: 900, fill: '#0f172a' }}>
                  {periodStats.totalCancelledSlots}
                </text>
                <text x="120" y="132" textAnchor="middle" style={{ fontSize: '0.62rem', fontWeight: 700, fill: '#64748b', textTransform: 'uppercase' }}>
                  Annulations
                </text>
              </svg>
            </div>

            {/* Légende détaillée interactive */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {periodStats.cancellationReasonsBreakdown.map((item, idx) => {
                const isHovered = hoveredReasonIndex === idx;
                return (
                  <div
                    key={item.reason}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      background: isHovered ? '#f1f5f9' : '#f8fafc',
                      border: isHovered ? `1.5px solid ${item.info.color}` : '1px solid #e2e8f0',
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                    }}
                    onMouseEnter={() => setHoveredReasonIndex(idx)}
                    onMouseLeave={() => setHoveredReasonIndex(null)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '3px',
                          background: item.info.color,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '0.80rem', fontWeight: 700, color: '#0f172a' }}>
                        {item.info.icon} {item.info.label}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{ fontSize: '0.76rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
                        {item.count} séance{item.count > 1 ? 's' : ''}
                      </span>
                      <span style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 700, width: '42px', textAlign: 'right' }}>
                        ({Math.round(item.percentage)}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Détail de l'absentéisme plage & non-publications Cycle 1 (hors météo, clients, état de plage) */}
        <div
          style={{
            marginTop: '16px',
            padding: '12px 14px',
            background: '#f8fafc',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 900, color: '#0f172a' }}>
                🚫 Détail de l&apos;absentéisme sur la plage (hors météo, manque de clients, état de la plage)
              </div>
              <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
                Regroupe les créneaux non publiés (Cycle 1) et fermetures / indisponibilités (REX). « Ferme » et « Fermé » sont unifiés et requalifiables ci-dessous.
              </div>
            </div>
            <span style={{ fontSize: '0.76rem', fontWeight: 900, color: '#334155', background: '#e2e8f0', padding: '3px 9px', borderRadius: '6px' }}>
              {periodStats.instructorAbsenteeismRate}% ({periodStats.instructorAbsentSlotsCount} créneau{periodStats.instructorAbsentSlotsCount > 1 ? 'x' : ''})
            </span>
          </div>

          {periodStats.instructorAbsentReasonsBreakdown.length === 0 ? (
            <div style={{ fontSize: '0.74rem', color: '#64748b', fontStyle: 'italic' }}>
              Aucune non-publication enregistrée sur cette période (0% d&apos;absentéisme hors météo/clients/plage).
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {periodStats.instructorAbsentReasonsBreakdown.map(item => {
                const isExpanded = expandedReasonKey === item.reasonKey;
                const selectedInGroup = item.slots.filter(s => selectedAbsentIds.has(makeSlotUid(s))).length;
                return (
                  <div
                    key={item.reasonKey}
                    style={{
                      background: '#fff',
                      border: item.isGenericClosed ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '6px 10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(150px, 1.4fr) 1fr auto auto',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span>{item.reason}</span>
                        {item.isGenericClosed && (
                          <span
                            style={{
                              fontSize: '0.64rem',
                              fontWeight: 800,
                              color: '#b45309',
                              background: '#fef3c7',
                              border: '1px solid #fcd34d',
                              borderRadius: '4px',
                              padding: '1px 5px',
                            }}
                          >
                            à détailler
                          </span>
                        )}
                      </span>
                      <div style={{ height: '7px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.min(100, Math.round(item.percentage))}%`,
                            height: '100%',
                            background: item.isGenericClosed ? '#d97706' : '#475569',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '0.74rem', fontWeight: 800, fontFamily: 'monospace', color: '#334155' }}>
                        {item.count} ({Math.round(item.percentage)}%)
                      </span>
                      {!isReadOnly && item.slots.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openReclassifyDrawer(item.reasonKey, item.slots)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '5px',
                            border: isExpanded
                              ? '1px solid #0f172a'
                              : item.isGenericClosed
                              ? '1px solid #d97706'
                              : '1px solid #cbd5e1',
                            background: isExpanded
                              ? '#334155'
                              : item.isGenericClosed
                              ? '#fffbeb'
                              : '#f8fafc',
                            color: isExpanded
                              ? '#fff'
                              : item.isGenericClosed
                              ? '#b45309'
                              : '#334155',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                          title="Attribuer une raison précise (Réunion, Impératif personnel, Vacances...) à tout ou partie de ces créneaux"
                        >
                          {isExpanded ? '✕ Fermer' : '✏️ Préciser'}
                        </button>
                      )}
                    </div>

                    {isExpanded && !isReadOnly && (
                      <div
                        style={{
                          marginTop: '8px',
                          paddingTop: '8px',
                          borderTop: '1px dashed #cbd5e1',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                          <span style={{ fontSize: '0.70rem', fontWeight: 800, color: '#334155' }}>
                            1. Sélectionner les créneaux concernés ({selectedInGroup}/{item.slots.length}) :
                          </span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedAbsentIds(new Set(item.slots.map(makeSlotUid)))
                              }
                              style={{
                                fontSize: '0.67rem',
                                fontWeight: 700,
                                color: '#0369a1',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            >
                              Tout cocher
                            </button>
                            <span style={{ color: '#cbd5e1' }}>·</span>
                            <button
                              type="button"
                              onClick={() => setSelectedAbsentIds(new Set())}
                              style={{
                                fontSize: '0.67rem',
                                fontWeight: 700,
                                color: '#64748b',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            >
                              Tout décocher
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '5px',
                            maxHeight: '110px',
                            overflowY: 'auto',
                          }}
                        >
                          {item.slots.map(s => {
                            const uid = makeSlotUid(s);
                            const checked = selectedAbsentIds.has(uid);
                            return (
                              <label
                                key={uid}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  padding: '3px 7px',
                                  borderRadius: '5px',
                                  border: checked ? '1px solid #0284c7' : '1px solid #e2e8f0',
                                  background: checked ? '#f0f9ff' : '#f8fafc',
                                  fontSize: '0.69rem',
                                  fontWeight: 700,
                                  color: '#1e293b',
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedAbsentIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(uid)) next.delete(uid);
                                      else next.add(uid);
                                      return next;
                                    });
                                  }}
                                />
                                <span>
                                  {s.ds.slice(8, 10)}/{s.ds.slice(5, 7)} · {s.startTime}–{s.endTime}
                                </span>
                              </label>
                            );
                          })}
                        </div>

                        <div>
                          <div style={{ fontSize: '0.70rem', fontWeight: 800, color: '#334155', marginBottom: '5px' }}>
                            2. Choisir ou saisir la raison réelle de fermeture :
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
                            {availableClosureReasons.map(reasonLabel => {
                              const active =
                                !reclassifyCustomInput.trim() &&
                                stripReasonAccents(reclassifyReason) === stripReasonAccents(reasonLabel);
                              return (
                                <button
                                  key={reasonLabel}
                                  type="button"
                                  onClick={() => {
                                    setReclassifyReason(reasonLabel);
                                    setReclassifyCustomInput('');
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '5px',
                                    border: active ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                                    background: active ? '#334155' : '#f8fafc',
                                    color: active ? '#fff' : '#1e293b',
                                    fontSize: '0.70rem',
                                    fontWeight: active ? 800 : 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {reasonLabel}
                                </button>
                              );
                            })}
                          </div>

                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                              type="text"
                              value={reclassifyCustomInput}
                              onChange={e => setReclassifyCustomInput(e.target.value)}
                              placeholder="Ou autre raison libre (ex: RDV pro, Salon nautique...)"
                              style={{
                                flex: '1 1 200px',
                                padding: '5px 8px',
                                fontSize: '0.72rem',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                              }}
                            />
                            <button
                              type="button"
                              disabled={isReclassifying || selectedInGroup === 0}
                              onClick={() =>
                                applyReclassifyReason(
                                  item.slots,
                                  reclassifyCustomInput.trim() || reclassifyReason
                                )
                              }
                              style={{
                                padding: '5px 11px',
                                borderRadius: '5px',
                                border: 'none',
                                background: selectedInGroup > 0 ? '#0284c7' : '#cbd5e1',
                                color: '#fff',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                cursor: selectedInGroup > 0 ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {isReclassifying
                                ? 'Enregistrement...'
                                : `Appliquer à ${selectedInGroup} créneau${selectedInGroup > 1 ? 'x' : ''}`}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. SECTION 2 : OBSERVATOIRE DES ÉCARTS & CALIBRATION DU SPOT (POINT 2) */}
      <div
        className="card"
        style={{
          padding: '18px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <PhysicalCorrelationObservatory
          gpsLogs={gpsLogs}
          observations={observations}
          activeCadre={activeCadreProfile}
          settings={settings}
          windList={windList}
          selectedDate={selectedDate}
          onNewObservation={handleOpenNewObservation}
          onEditObservation={handleEditObservation}
        />

        {/* Tableau des relevés réels enregistrés */}
        <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <span>📋 Carnet de bord des relevés terrain ({sortedObservations.length} entrées · du plus récent au plus ancien)</span>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Cliquez sur une ligne pour modifier</span>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '340px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.70rem', background: '#fff', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', color: '#475569', fontSize: '0.64rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '6px 8px' }}>Date</th>
                  <th style={{ padding: '6px 8px' }}>Séance</th>
                  <th
                    style={{ padding: '6px 8px' }}
                    title="Coefficient SHOM du jour et cycle de marée au début de séance (BM+ = montante, HM+ = descendante)"
                  >
                    Marée (Coef / Cycle)
                  </th>
                  <th style={{ padding: '6px 8px' }}>Statut</th>
                  <th style={{ padding: '6px 8px' }}>Écart Roulage</th>
                  <th style={{ padding: '6px 8px' }}>Surcote (cm)</th>
                  <th style={{ padding: '6px 8px' }}>Pression</th>
                  <th style={{ padding: '6px 8px' }}>Vent & Houle</th>
                  <th style={{ padding: '6px 8px' }}>Plage</th>
                  <th style={{ padding: '6px 8px' }}>Commentaire</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedObservations.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '32px 16px', textAlign: 'center', color: '#64748b' }}>
                      <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>📝</div>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem', marginBottom: '4px' }}>
                        Carnet de relevés vierge (prêt pour la saison)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', maxWidth: '520px', margin: '0 auto', lineHeight: 1.5 }}>
                        Aucun relevé terrain enregistré pour le moment.
                        <br />
                        Pour enregistrer une observation de marée (hauteur d'eau, surcote, vent) ou une cause d’annulation, cliquez sur le bouton bleu « <strong>+ Noter un relevé terrain</strong> » ci-dessus ou sur « <strong>📝 Relevé</strong> » directement depuis le planning.
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedObservations.map((obs, idx) => {
                    const isRealized = obs.status === 'realized';
                    const tc = computeTideCycleForSlot(obs.ds, obs.slotStart);
                    return (
                      <tr
                        key={obs.id || idx}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: idx % 2 === 0 ? '#fff' : '#fcfcfc',
                          cursor: 'pointer',
                        }}
                        onClick={() => handleEditObservation(obs)}
                      >
                        <td style={{ padding: '6px 8px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                          {obs.ds}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {obs.slotStart}–{obs.slotEnd} {obs.customTitle ? `(${obs.customTitle})` : ''}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          {tc.coef != null || tc.label ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ fontWeight: 800, color: '#0f172a' }}>
                                {tc.coef != null ? `C.${tc.coef}` : '—'}
                              </span>
                              {tc.label && (
                                <span
                                  style={{
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    fontSize: '0.62rem',
                                    fontWeight: 800,
                                    background: tc.direction === 'montante' ? '#dbeafe' : '#fef3c7',
                                    color: tc.direction === 'montante' ? '#1e40af' : '#92400e',
                                  }}
                                >
                                  {tc.label}
                                  {tc.direction === 'montante' ? ' ↗' : tc.direction === 'descendante' ? ' ↘' : ''}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {isRealized ? (
                            <span style={{ color: '#166534', fontWeight: 800 }}>
                              ✓ Réalisée{obs.charsCount != null ? ` (${obs.charsCount} ch.)` : ''}
                            </span>
                          ) : (
                            <span style={{ color: '#b91c1c', fontWeight: 800 }}>
                              ⛔ {obs.cancellationReason ? CANCELLATION_REASONS_INFO[obs.cancellationReason]?.shortLabel : 'Annulée'}
                              {obs.cancellationNote ? ` · ${obs.cancellationNote}` : ''}
                            </span>
                          )}
                          {obs.author && (
                            <span style={{ marginLeft: '6px', fontSize: '0.62rem', color: '#64748b', fontWeight: 700 }}>
                              ({obs.author})
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {obs.timeDeltaMin != null ? (
                            <strong style={{ color: obs.timeDeltaMin < 0 ? '#0284c7' : obs.timeDeltaMin > 0 ? '#dc2626' : '#64748b' }}>
                              {obs.timeDeltaMin > 0 ? `+${obs.timeDeltaMin} min` : `${obs.timeDeltaMin} min`}
                            </strong>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {obs.waterDeltaCm != null ? (
                            <strong style={{ color: obs.waterDeltaCm > 0 ? '#0284c7' : '#166534' }}>
                              {obs.waterDeltaCm > 0 ? `+${obs.waterDeltaCm} cm` : `${obs.waterDeltaCm} cm`}
                            </strong>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {obs.observedPressure != null ? `${obs.observedPressure} hPa` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {obs.observedWindKts != null || obs.observedWindDir || obs.observedWaveH != null ? (
                            <>
                              {obs.observedWindKts != null ? `${obs.observedWindKts} nds` : ''}
                              {obs.observedWindDir ? `${obs.observedWindKts != null ? ' ' : ''}${obs.observedWindDir}` : ''}
                              {obs.observedWaveH != null ? `${obs.observedWindKts != null || obs.observedWindDir ? ' · ' : ''}${obs.observedWaveH}m` : ''}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#475569', fontSize: '0.66rem' }}>
                          {obs.beachCondition === 'dur' ? 'Sable dur' : obs.beachCondition === 'mou' ? 'Sable mou' : obs.beachCondition ? 'Bâches' : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#64748b', fontSize: '0.66rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={obs.notes || obs.cancellationNote}>
                          {obs.notes || obs.cancellationNote || '—'}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditObservation(obs);
                            }}
                            style={{
                              background: '#e0f2fe',
                              border: 'none',
                              color: '#0369a1',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Éditer
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )}

      {/* SÉLECTEUR DE DATE ET CRÉNEAU RÉEL AVANT OUVERTURE DE LA FICHE REX (OPTION B) */}
      {slotPickerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setSlotPickerOpen(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.35)',
              border: '1px solid #cbd5e1',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 900, color: '#0f172a' }}>
                  📝 Noter un relevé terrain · Choisir la séance
                </h3>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                  Sélectionnez la date puis le créneau réel concerné pour ouvrir sa fiche REX.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSlotPickerOpen(false)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 9px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  color: '#475569',
                  cursor: 'pointer',
                }}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                disabled={shf(pickerDate, -1) < minDs}
                onClick={() => {
                  const prev = shf(pickerDate, -1);
                  if (prev >= minDs) setPickerDate(prev);
                }}
                style={{
                  padding: '5px 9px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: shf(pickerDate, -1) < minDs ? '#f1f5f9' : '#fff',
                  cursor: shf(pickerDate, -1) < minDs ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.76rem',
                }}
              >
                ‹ Jour préc.
              </button>

              <input
                type="date"
                value={pickerDate}
                min={minDs}
                max={todayStr < maxDs ? todayStr : maxDs}
                onChange={e => {
                  const v = e.target.value;
                  if (v && v >= minDs && v <= maxDs) setPickerDate(v);
                }}
                style={{
                  flex: 1,
                  minWidth: '140px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1.5px solid #0284c7',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  color: '#0f172a',
                  background: '#fff',
                }}
              />

              <button
                type="button"
                disabled={shf(pickerDate, 1) > todayStr || shf(pickerDate, 1) > maxDs}
                onClick={() => {
                  const next = shf(pickerDate, 1);
                  if (next <= todayStr && next <= maxDs) setPickerDate(next);
                }}
                style={{
                  padding: '5px 9px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: shf(pickerDate, 1) > todayStr || shf(pickerDate, 1) > maxDs ? '#f1f5f9' : '#fff',
                  cursor: shf(pickerDate, 1) > todayStr || shf(pickerDate, 1) > maxDs ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: '0.76rem',
                }}
              >
                Jour suiv. ›
              </button>
            </div>

            {pickerDaySlots.length === 0 ? (
              <div
                style={{
                  padding: '20px 14px',
                  textAlign: 'center',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                  fontSize: '0.8rem',
                }}
              >
                <strong>Aucune séance prévue le {pickerDate.split('-').reverse().join('/')}</strong>
                <div style={{ marginTop: '4px', fontSize: '0.74rem' }}>
                  Marée haute ou hors plage d&apos;ouverture. Choisissez une autre date ci-dessus.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pickerDaySlots.map(slot => (
                  <button
                    key={`${pickerDate}_${slot.slotKey}`}
                    type="button"
                    onClick={() => {
                      setSlotPickerOpen(false);
                      if (slot.existingObs) {
                        setSelectedNewSlot(null);
                        setEditingObservation(slot.existingObs);
                      } else {
                        setEditingObservation(null);
                        setSelectedNewSlot({
                          ds: pickerDate,
                          slotKey: slot.slotKey,
                          slotStart: slot.slotStart,
                          slotEnd: slot.slotEnd,
                          customTitle: slot.customTitle,
                          isCustom: slot.isCustom,
                          maxChars: slot.maxChars,
                          primaryInstructor: slot.primaryInstructor,
                          secondaryInstructor: slot.secondaryInstructor,
                        });
                      }
                      setModalOpen(true);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      background: '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900, fontSize: '0.86rem', color: '#0f172a' }}>
                        🕒 {slot.slotStart} – {slot.slotEnd}
                        {slot.customTitle ? ` · ${slot.customTitle}` : ''}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                        {slot.bookedPeople > 0
                          ? `👥 ${slot.bookedPeople} inscrit${slot.bookedPeople > 1 ? 's' : ''} dans l'agenda`
                          : 'Aucun inscrit enregistré'}
                        {slot.secondaryInstructor ? ` · ${slot.primaryInstructor} + ${slot.secondaryInstructor}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          color: slot.statusColor,
                          background: slot.statusBg,
                        }}
                      >
                        {slot.statusLabel}
                      </span>
                      <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#0284c7' }}>
                        {slot.existingObs ? 'Modifier →' : 'Noter →'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE SAISIE / ÉDITION D'OBSERVATION */}
      {modalOpen && (editingObservation || selectedNewSlot) && (() => {
        const obsDate = editingObservation?.ds || selectedNewSlot!.ds;
        const obsStart = editingObservation?.slotStart || selectedNewSlot!.slotStart;
        const obsEnd = editingObservation?.slotEnd || selectedNewSlot!.slotEnd;
        const obsSlotKey = editingObservation?.slotKey || selectedNewSlot!.slotKey;
        const matchedValItem = findMatchingValidationItem(
          validations[obsDate],
          obsSlotKey,
          obsStart,
          obsEnd
        );
        const modalMaxChars = matchedValItem
          ? getSlotMaxCapacity(matchedValItem)
          : selectedNewSlot?.maxChars ??
            (editingObservation?.secondaryInstructor
              ? MAX_CHARS_PER_INSTRUCTOR * 2
              : MAX_CHARS_PER_INSTRUCTOR);
        const bookingKey =
          matchedValItem &&
          (bookingsMap[buildReservationKey(obsDate, matchedValItem.k)]?.length ?? 0) > 0
            ? matchedValItem.k
            : obsSlotKey;
        const agendaBookedPeopleCount = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(obsDate, bookingKey)] || [],
          modalMaxChars
        ).totalPeople;
        const weatherDefaults = getSlotWeatherRexDefaults(obsDate, obsStart, obsEnd, EX, windList);
        return (
          <SlotObservationModal
            key={`${obsDate}_${obsSlotKey}`}
            isOpen={modalOpen}
            onClose={() => {
              setModalOpen(false);
              setSelectedNewSlot(null);
            }}
            dateStr={obsDate}
            slotKey={obsSlotKey}
            slotStart={obsStart}
            slotEnd={obsEnd}
            slotTitle={editingObservation?.customTitle || selectedNewSlot?.customTitle}
            isCustom={editingObservation?.isCustom ?? selectedNewSlot?.isCustom}
            maxChars={modalMaxChars}
            primaryInstructor={
              matchedValItem?.instructor ||
              editingObservation?.author ||
              selectedNewSlot?.primaryInstructor ||
              'Jérôme'
            }
            secondaryInstructor={
              matchedValItem?.secondaryInstructor ||
              editingObservation?.secondaryInstructor ||
              selectedNewSlot?.secondaryInstructor
            }
            defaultPressure={weatherDefaults.pressureHpa ?? null}
            defaultWindKts={weatherDefaults.windKts ?? null}
            defaultGustKts={weatherDefaults.gustKts ?? null}
            defaultWindDir={weatherDefaults.windDir ?? null}
            defaultWaveH={weatherDefaults.waveH ?? null}
            initialObservation={editingObservation}
            currentUserName={currentUserName}
            customNonPublishReasons={settings.customNonPublishReasons}
            defaultBookedParticipantsCount={
              agendaBookedPeopleCount > 0 ? agendaBookedPeopleCount : undefined
            }
            agendaBookedPeopleCount={agendaBookedPeopleCount}
            isReadOnly={isReadOnly}
            onSaveSuccess={(updated, savedObs, deletedObs) => {
              setObservations(updated);
              if (savedObs) {
                onObservationSaved?.(savedObs);
              } else if (deletedObs) {
                onObservationDeleted?.(deletedObs);
              }
              setModalOpen(false);
              setSelectedNewSlot(null);
            }}
          />
        );
      })()}
    </div>
  );
};
