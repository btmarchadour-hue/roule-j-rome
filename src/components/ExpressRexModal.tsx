import React, { useEffect, useMemo, useState } from 'react';
import {
  AppSettings,
  CancellationReason,
  CustomSlotsMap,
  MAX_CHARS_PER_INSTRUCTOR,
  SlotObservation,
  TidePoint,
  ValidationsMap,
  WindPoint,
  WindsUpSpotData,
} from '../types';
import { AgendaBookingItem } from '../utils/firebaseSync';
import {
  buildReservationKey,
  findMatchingValidationItem,
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  getValidationItemChars,
} from '../utils/cycleHelpers';
import { COEF, dayFocus, kOf, lc, maxDs, minDs } from '../utils/tides';
import { CANCELLATION_REASONS_INFO } from '../utils/statisticsEngine';
import {
  fetchWindsUpQuietly,
  getSlotWeatherRexDefaults,
  SlotWeatherRexDefaults,
} from '../utils/slotWeatherRex';

export interface ExpressRexModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  validations: ValidationsMap;
  bookingsMap: Record<string, AgendaBookingItem[]>;
  observations: SlotObservation[];
  currentUserName?: string;
  isReadOnly?: boolean;
  onSaveBatch: (dateStr: string, obsList: SlotObservation[]) => Promise<void> | void;
}

type ExpressMode = 'pending' | 'realized' | 'no_clients' | 'cancelled_weather';

interface ExpressRowState {
  slotKey: string;
  slotStart: string;
  slotEnd: string;
  isCustom?: boolean;
  customTitle?: string;
  isHiddenC1: boolean;
  c1Label: string;
  maxChars: number;
  primaryInstructor: string;
  secondaryInstructor?: string;
  mode: ExpressMode;
  cancellationReason: CancellationReason;
  cancellationNote: string;
  monoCount: number;
  biCount: number;
  participantsCount: number;
  bookedParticipantsCount: number;
  agendaBookedCount: number;
  rescheduledCount: number;
  lostCount: number;
  observedWindKts?: number;
  observedGustKts?: number;
  observedWindDir?: string;
  observedPressure?: number;
  observedWaveH?: number;
  beachCondition?: SlotObservation['beachCondition'];
  notes: string;
  weatherTouched: boolean;
  weatherMeta: SlotWeatherRexDefaults;
  existingCreatedAt?: number;
  existingId?: string;
  existingAuthor?: string;
  expandedDetails: boolean;
}

const WEATHER_CANCEL_REASONS: CancellationReason[] = [
  'wind_low',
  'wind_high',
  'wind_dir',
  'beach_state',
  'weather_extreme',
  'instructor',
  'other',
];

const BEACH_OPTIONS: Array<{ key: NonNullable<SlotObservation['beachCondition']>; label: string }> = [
  { key: 'dur', label: 'Sable dur' },
  { key: 'mou', label: 'Sable mou' },
  { key: 'baches_faibles', label: 'Bâches faibles' },
  { key: 'baches_fortes', label: 'Bâches fortes' },
];

function shiftDateStr(ds: string, deltaDays: number): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function formatDateFrLong(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const ExpressRexModal: React.FC<ExpressRexModalProps> = ({
  isOpen,
  onClose,
  initialDate,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  customSlotsMap,
  validations,
  bookingsMap,
  observations,
  currentUserName = 'Jérôme',
  isReadOnly = false,
  onSaveBatch,
}) => {
  const [activeDate, setActiveDate] = useState<string>(initialDate);
  const [windsUpData, setWindsUpData] = useState<WindsUpSpotData | null>(null);
  const [windsUpStatus, setWindsUpStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [showHiddenC1, setShowHiddenC1] = useState<boolean>(false);
  const [globalBeach, setGlobalBeach] = useState<SlotObservation['beachCondition'] | undefined>(undefined);
  const [rows, setRows] = useState<ExpressRowState[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Sync date when reopened
  useEffect(() => {
    if (isOpen) {
      setActiveDate(initialDate);
      setValidationError(null);
      setGlobalBeach(undefined);
    }
  }, [isOpen, initialDate]);

  // Fetch Winds-Up Spot 66 silently for activeDate
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setWindsUpStatus('loading');
    setWindsUpData(null);

    fetchWindsUpQuietly(activeDate).then(data => {
      if (cancelled) return;
      if (data && !data.sensorOffline && data.rows.some(r => !r.locked && r.moy != null)) {
        setWindsUpData(data);
        setWindsUpStatus('ready');
      } else {
        setWindsUpData(data);
        setWindsUpStatus('unavailable');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeDate]);

  // Build initial rows whenever activeDate changes
  useEffect(() => {
    if (!isOpen) return;
    const df = dayFocus(activeDate, settings, tideW, first, last, windList, customSlotsMap);
    const valRec = validations[activeDate];
    const dayObs = observations.filter(o => o.ds === activeDate);
    const norm = (s?: string) => (s || '').replace('h', ':');

    const usedValKeys = new Set<string>();
    const builtRows: ExpressRowState[] = [];

    for (const slot of df.list) {
      const slotKey = kOf(slot);
      const slotStart = lc(slot.a, df.y, df.m, df.d);
      const slotEnd = lc(slot.b, df.y, df.m, df.d);

      const valItem = findMatchingValidationItem(valRec, slotKey, slotStart, slotEnd, usedValKeys);
      if (valItem) usedValKeys.add(valItem.k);

      const effectiveBookingKey = valItem ? valItem.k : slotKey;
      const slotBookings =
        bookingsMap[buildReservationKey(activeDate, effectiveBookingKey)] ||
        bookingsMap[buildReservationKey(activeDate, slotKey)] ||
        [];
      const bSummary = getSlotBookingsSummary(slotBookings, getSlotMaxCapacity(valItem));

      const existingObs =
        dayObs.find(o => o.slotKey === slotKey || (valItem && o.slotKey === valItem.k)) ||
        dayObs.find(o => norm(o.slotStart) === norm(slotStart) && norm(o.slotEnd) === norm(slotEnd)) ||
        null;

      const c1Status = getEffectiveCycle1Status(valItem);
      const c2Status = getEffectiveCycle2Status(valItem, bSummary.totalChars, existingObs);
      const isHiddenC1 =
        (c1Status === 'excluded' || c1Status === 'not_published' || c1Status === 'unpublished') &&
        !existingObs;

      const maxChars = valItem ? getSlotMaxCapacity(valItem) : MAX_CHARS_PER_INSTRUCTOR;
      const primaryInstructor = valItem?.instructor || existingObs?.author || 'Jérôme';
      const secondaryInstructor = valItem?.secondaryInstructor || existingObs?.secondaryInstructor;

      const vCounts = getValidationItemChars(valItem);
      const preMono =
        existingObs?.monoCount != null
          ? existingObs.monoCount
          : bSummary.totalChars > 0
          ? bSummary.monoCount
          : vCounts.mono > 0 || vCounts.bi > 0
          ? vCounts.mono
          : vCounts.totalChars;
      const preBi =
        existingObs?.biCount != null
          ? existingObs.biCount
          : bSummary.totalChars > 0
          ? bSummary.biCount
          : vCounts.bi;
      const preChars = preMono + preBi;
      const prePeople =
        existingObs?.participantsCount != null
          ? existingObs.participantsCount
          : bSummary.totalChars > 0
          ? bSummary.totalPeople
          : vCounts.people > 0
          ? vCounts.people
          : preMono + preBi * 2;

      const weatherMeta = getSlotWeatherRexDefaults(
        activeDate,
        valItem?.actualStart || slotStart,
        valItem?.actualEnd || slotEnd,
        EX,
        windList,
        null
      );

      // Determine smart initial mode (Option B: 0-booking undecided slots start on 'pending')
      let mode: ExpressMode = 'pending';
      let cancellationReason: CancellationReason = 'no_clients';
      if (existingObs) {
        if (existingObs.status === 'realized') {
          mode = 'realized';
          cancellationReason = 'wind_low';
        } else if (existingObs.cancellationReason === 'no_clients') {
          mode = 'no_clients';
          cancellationReason = 'no_clients';
        } else {
          mode = 'cancelled_weather';
          cancellationReason = existingObs.cancellationReason || 'wind_low';
        }
      } else if (c2Status === 'realized') {
        mode = 'realized';
        cancellationReason = 'wind_low';
      } else if (c2Status === 'cancelled_weather') {
        mode = 'cancelled_weather';
        cancellationReason = slot.ok === false ? 'wind_high' : 'wind_low';
      } else if (c1Status === 'closed_no_bookings') {
        mode = 'no_clients';
        cancellationReason = 'no_clients';
      } else if (preChars === 0) {
        mode = 'pending';
        cancellationReason = 'no_clients';
      } else if (slot.ok === false) {
        mode = 'cancelled_weather';
        cancellationReason = 'wind_high';
      } else {
        mode = 'realized';
        cancellationReason = 'wind_low';
      }

      const c1Label =
        c1Status === 'excluded'
          ? 'Hors offre'
          : c1Status === 'not_published'
          ? `Non publié (${valItem?.nonPublishReason || 'C1'})`
          : c1Status === 'unpublished'
          ? 'En attente C1'
          : '';

      const bookedCount =
        existingObs?.bookedParticipantsCount != null
          ? existingObs.bookedParticipantsCount
          : prePeople;

      builtRows.push({
        slotKey,
        slotStart: valItem?.actualStart || slotStart,
        slotEnd: valItem?.actualEnd || slotEnd,
        isCustom: slot.isCustom,
        customTitle: slot.customTitle || existingObs?.customTitle,
        isHiddenC1,
        c1Label,
        maxChars,
        primaryInstructor,
        secondaryInstructor,
        mode,
        cancellationReason,
        cancellationNote: existingObs?.cancellationNote || '',
        monoCount: preMono,
        biCount: preBi,
        participantsCount: prePeople,
        bookedParticipantsCount: bookedCount,
        agendaBookedCount: bSummary.totalPeople,
        rescheduledCount: existingObs?.rescheduledCount ?? 0,
        lostCount: existingObs?.lostCount ?? bookedCount,
        observedWindKts: existingObs?.observedWindKts ?? weatherMeta.windKts,
        observedGustKts: existingObs?.observedGustKts ?? weatherMeta.gustKts,
        observedWindDir: existingObs?.observedWindDir ?? weatherMeta.windDir,
        observedPressure: existingObs?.observedPressure ?? weatherMeta.pressureHpa,
        observedWaveH: existingObs?.observedWaveH ?? weatherMeta.waveH,
        beachCondition: existingObs?.beachCondition,
        notes: existingObs?.notes || '',
        weatherTouched: Boolean(
          existingObs &&
            (existingObs.observedWindKts != null ||
              existingObs.observedGustKts != null ||
              existingObs.observedPressure != null ||
              existingObs.observedWaveH != null)
        ),
        weatherMeta,
        existingCreatedAt: existingObs?.createdAt,
        existingId: existingObs?.id,
        existingAuthor: existingObs?.author,
        expandedDetails: false,
      });
    }

    setRows(builtRows);
    setValidationError(null);
  }, [isOpen, activeDate, settings, tideW, first, last, windList, customSlotsMap, validations, bookingsMap, observations, EX]);

  // When Winds-Up Spot 66 loads for activeDate, enrich untouched weather rows seamlessly
  useEffect(() => {
    if (!isOpen || !windsUpData || windsUpData.date !== activeDate) return;
    setRows(prev =>
      prev.map(r => {
        const freshMeta = getSlotWeatherRexDefaults(
          activeDate,
          r.slotStart,
          r.slotEnd,
          EX,
          windList,
          windsUpData
        );
        if (r.weatherTouched || freshMeta.windSource !== 'windsup') {
          return { ...r, weatherMeta: freshMeta };
        }
        return {
          ...r,
          observedWindKts: freshMeta.windKts ?? r.observedWindKts,
          observedGustKts: freshMeta.gustKts ?? r.observedGustKts,
          observedWindDir: freshMeta.windDir ?? r.observedWindDir,
          weatherMeta: freshMeta,
        };
      })
    );
  }, [isOpen, activeDate, windsUpData, EX, windList]);

  const visibleRows = useMemo(
    () => (showHiddenC1 ? rows : rows.filter(r => !r.isHiddenC1)),
    [rows, showHiddenC1]
  );

  const hiddenCount = useMemo(() => rows.filter(r => r.isHiddenC1).length, [rows]);

  const summary = useMemo(() => {
    let realized = 0;
    let noClients = 0;
    let cancelledWeather = 0;
    let pending = 0;
    let totalChars = 0;
    let totalPilots = 0;
    let windsupCount = 0;

    for (const r of visibleRows) {
      if (r.weatherMeta.windSource === 'windsup') windsupCount++;
      if (r.mode === 'realized') {
        realized++;
        const chars = r.monoCount + r.biCount;
        totalChars += chars;
        totalPilots += r.participantsCount > 0 ? r.participantsCount : r.monoCount + r.biCount * 2;
      } else if (r.mode === 'no_clients') {
        noClients++;
      } else if (r.mode === 'cancelled_weather') {
        cancelledWeather++;
      } else {
        pending++;
      }
    }

    return {
      realized,
      noClients,
      cancelledWeather,
      pending,
      toSaveCount: visibleRows.length - pending,
      totalChars,
      totalPilots,
      windsupCount,
    };
  }, [visibleRows]);

  const updateRow = (slotKey: string, updater: (r: ExpressRowState) => ExpressRowState) => {
    setValidationError(null);
    setRows(prev => prev.map(r => (r.slotKey === slotKey ? updater(r) : r)));
  };

  const markPendingAsNoClients = () => {
    setValidationError(null);
    setRows(prev =>
      prev.map(r => {
        if (r.isHiddenC1 && !showHiddenC1) return r;
        if (r.mode !== 'pending') return r;
        return {
          ...r,
          mode: 'no_clients',
          cancellationReason: 'no_clients',
        };
      })
    );
  };

  const applyGlobalBeach = (cond: NonNullable<SlotObservation['beachCondition']>) => {
    const next = globalBeach === cond ? undefined : cond;
    setGlobalBeach(next);
    setRows(prev =>
      prev.map(r => ({
        ...r,
        beachCondition: next,
      }))
    );
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    const rowsToSave = visibleRows.filter(r => r.mode !== 'pending');
    if (isReadOnly || rowsToSave.length === 0) return;
    setValidationError(null);

    // Strict validation guards across selected rows
    for (const r of rowsToSave) {
      if (r.mode === 'realized') {
        const chars = r.monoCount + r.biCount;
        if (chars <= 0 && r.participantsCount <= 0) {
          setValidationError(
            `Créneau ${r.slotStart} – ${r.slotEnd} : une séance « Réalisée » doit avoir au moins 1 char ou 1 pilote (sinon cliquez sur « Pas d'inscrit »).`
          );
          return;
        }
        const checkChars = chars > 0 ? chars : r.participantsCount;
        if (checkChars > r.maxChars) {
          setValidationError(
            `Créneau ${r.slotStart} – ${r.slotEnd} : plafond strict dépassé (${checkChars}/${r.maxChars} chars max).`
          );
          return;
        }
      } else if (r.mode === 'no_clients' && r.agendaBookedCount > 0) {
        setValidationError(
          `Créneau ${r.slotStart} – ${r.slotEnd} : impossible de marquer « Pas d'inscrit » avec ${r.agendaBookedCount} inscrit${
            r.agendaBookedCount > 1 ? 's' : ''
          } dans les réservations.`
        );
        return;
      }
    }

    const obsList: SlotObservation[] = rowsToSave.map(r => {
      const now = Date.now();
      const baseWeather = {
        observedPressure: r.observedPressure,
        observedWindKts: r.observedWindKts,
        observedGustKts: r.observedGustKts,
        observedWindDir: r.observedWindDir || undefined,
        observedWaveH: r.observedWaveH,
        beachCondition: r.beachCondition,
      };

      if (r.mode === 'realized') {
        const chars = r.monoCount + r.biCount;
        const people = r.participantsCount > 0 ? r.participantsCount : r.monoCount + r.biCount * 2;
        return {
          id: r.existingId || `obs-${activeDate}-${r.slotKey}`,
          ds: activeDate,
          slotKey: r.slotKey,
          slotStart: r.slotStart,
          slotEnd: r.slotEnd,
          isCustom: r.isCustom,
          customTitle: r.customTitle,
          status: 'realized',
          ...baseWeather,
          charsCount: chars,
          monoCount: r.monoCount,
          biCount: r.biCount,
          participantsCount: people,
          notes: r.notes.trim() || undefined,
          author: r.existingAuthor || currentUserName || 'Jérôme',
          secondaryInstructor: r.secondaryInstructor,
          createdAt: r.existingCreatedAt || now,
          updatedAt: now,
        };
      }

      if (r.mode === 'no_clients') {
        return {
          id: r.existingId || `obs-${activeDate}-${r.slotKey}`,
          ds: activeDate,
          slotKey: r.slotKey,
          slotStart: r.slotStart,
          slotEnd: r.slotEnd,
          isCustom: r.isCustom,
          customTitle: r.customTitle,
          status: 'cancelled',
          cancellationReason: 'no_clients',
          cancellationNote: r.cancellationNote.trim() || undefined,
          ...baseWeather,
          notes: r.notes.trim() || undefined,
          author: r.existingAuthor || currentUserName || 'Jérôme',
          secondaryInstructor: r.secondaryInstructor,
          createdAt: r.existingCreatedAt || now,
          updatedAt: now,
        };
      }

      return {
        id: r.existingId || `obs-${activeDate}-${r.slotKey}`,
        ds: activeDate,
        slotKey: r.slotKey,
        slotStart: r.slotStart,
        slotEnd: r.slotEnd,
        isCustom: r.isCustom,
        customTitle: r.customTitle,
        status: 'cancelled',
        cancellationReason: r.cancellationReason === 'no_clients' ? 'wind_low' : r.cancellationReason,
        cancellationNote: r.cancellationNote.trim() || undefined,
        bookedParticipantsCount: r.bookedParticipantsCount > 0 ? r.bookedParticipantsCount : undefined,
        rescheduledCount: r.bookedParticipantsCount > 0 ? r.rescheduledCount : undefined,
        lostCount: r.bookedParticipantsCount > 0 ? r.lostCount : undefined,
        ...baseWeather,
        notes: r.notes.trim() || undefined,
        author: r.existingAuthor || currentUserName || 'Jérôme',
        secondaryInstructor: r.secondaryInstructor,
        createdAt: r.existingCreatedAt || now,
        updatedAt: now,
      };
    });

    setIsSaving(true);
    try {
      await onSaveBatch(activeDate, obsList);
      onClose();
    } catch (err) {
      console.error('Erreur enregistrement Bilan Express:', err);
      setValidationError('Erreur lors de l’enregistrement. Vérifiez la connexion et réessayez.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const coef = COEF[activeDate];
  const prevDate = shiftDateStr(activeDate, -1);
  const nextDate = shiftDateStr(activeDate, 1);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(3px)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '940px',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #cbd5e1',
          boxShadow: '0 20px 30px -10px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            background: '#0f172a',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700 }}>
              Bilan Express fin de journée · Pré-rempli météo &amp; inscriptions
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
              <button
                type="button"
                disabled={prevDate < minDs}
                onClick={() => setActiveDate(prevDate)}
                style={{
                  minHeight: '34px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #334155',
                  background: prevDate >= minDs ? '#1e293b' : 'transparent',
                  color: prevDate >= minDs ? '#e2e8f0' : '#475569',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  cursor: prevDate >= minDs ? 'pointer' : 'not-allowed',
                }}
              >
                ◀ Jour préc.
              </button>

              <h3
                style={{
                  margin: 0,
                  fontSize: '1.02rem',
                  fontWeight: 800,
                  color: '#ffffff',
                  textTransform: 'capitalize',
                }}
              >
                {formatDateFrLong(activeDate)}
              </h3>

              {coef != null && (
                <span
                  style={{
                    fontSize: '0.76rem',
                    color: '#94a3b8',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  · Coef {coef}
                </span>
              )}

              <button
                type="button"
                disabled={nextDate > maxDs}
                onClick={() => setActiveDate(nextDate)}
                style={{
                  minHeight: '34px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #334155',
                  background: nextDate <= maxDs ? '#1e293b' : 'transparent',
                  color: nextDate <= maxDs ? '#e2e8f0' : '#475569',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  cursor: nextDate <= maxDs ? 'pointer' : 'not-allowed',
                }}
              >
                Jour suiv. ▶
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              minWidth: '40px',
              minHeight: '40px',
              background: 'transparent',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#cbd5e1',
              fontSize: '1.1rem',
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            ✕
          </button>
        </div>

        {/* Barre outils rapide du jour (État du sable + source météo) */}
        <div
          style={{
            padding: '10px 18px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginRight: '4px' }}>
              Sable du jour :
            </span>
            {BEACH_OPTIONS.map(opt => {
              const active = globalBeach === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => applyGlobalBeach(opt.key)}
                  style={{
                    minHeight: '34px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: active ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background: active ? '#e0f2fe' : '#ffffff',
                    color: active ? '#0369a1' : '#334155',
                    fontSize: '0.74rem',
                    fontWeight: active ? 800 : 600,
                    cursor: isReadOnly ? 'not-allowed' : 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.73rem', color: '#475569' }}>
            {!isReadOnly && summary.pending > 0 && (
              <button
                type="button"
                onClick={markPendingAsNoClients}
                style={{
                  minHeight: '32px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #c4b5fd',
                  background: '#f5f3ff',
                  color: '#5b21b6',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Basculer d'un clic tous les créneaux encore en attente sur « Pas d'inscrit » (idéal en fin de journée)"
              >
                👥 Tout passer en « Pas d&apos;inscrit » ({summary.pending})
              </button>
            )}
            <span>
              {windsUpStatus === 'loading'
                ? 'Chargement balise Winds-Up…'
                : summary.windsupCount > 0
                ? 'Source météo : Balise Winds-Up + AROME + Marine'
                : 'Source météo : AROME / Global + Marine'}
            </span>
            {hiddenCount > 0 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={showHiddenC1}
                  onChange={e => setShowHiddenC1(e.target.checked)}
                />
                <span>Afficher non validés / hors offre ({hiddenCount})</span>
              </label>
            )}
          </div>
        </div>

        {/* Liste des créneaux */}
        <form onSubmit={handleSaveAll} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 18px' }}>
            {validationError && (
              <div
                style={{
                  margin: '8px 0 10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  border: '1px solid #ef4444',
                  color: '#991b1b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                ⛔ {validationError}
              </div>
            )}

            {visibleRows.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b', fontSize: '0.86rem' }}>
                Aucun créneau actif à saisir sur cette journée.
                {hiddenCount > 0 && ' Cochez « Afficher non validés / hors offre » ci-dessus si besoin.'}
              </div>
            ) : (
              <div>
                {visibleRows.map((row, idx) => {
                  const totalChars = row.monoCount + row.biCount;
                  const overCap = row.mode === 'realized' && totalChars > row.maxChars;
                  const zeroRealized =
                    row.mode === 'realized' && totalChars <= 0 && row.participantsCount <= 0;

                  return (
                    <div
                      key={row.slotKey}
                      style={{
                        padding: '14px 4px',
                        borderBottom: idx < visibleRows.length - 1 ? '1px solid #e2e8f0' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      {/* Ligne principale : Horaire + Boutons 1-clic + Résumé météo */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '12px',
                        }}
                      >
                        <div style={{ minWidth: '210px' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                fontSize: '0.98rem',
                                fontWeight: 800,
                                color: '#0f172a',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {row.slotStart} – {row.slotEnd}
                            </span>
                            {row.customTitle && (
                              <span style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 600 }}>
                                · {row.customTitle}
                              </span>
                            )}
                            {row.c1Label && (
                              <span style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 700 }}>
                                · {row.c1Label}
                              </span>
                            )}
                          </div>

                          <div
                            style={{
                              fontSize: '0.74rem',
                              color: '#475569',
                              marginTop: '3px',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {row.primaryInstructor}
                            {row.secondaryInstructor ? ` + ${row.secondaryInstructor}` : ''}
                            {' · '}plafond {row.maxChars} chars
                            {row.observedWindKts != null && (
                              <>
                                {' · '}
                                <span style={{ color: '#0369a1', fontWeight: 600 }}>
                                  {row.observedWindKts}
                                  {row.observedGustKts != null ? ` (raf. ${row.observedGustKts})` : ''} nds{' '}
                                  {row.observedWindDir || ''}
                                </span>
                              </>
                            )}
                            {row.observedPressure != null && ` · ${row.observedPressure} hPa`}
                            {row.observedWaveH != null && ` · ${row.observedWaveH} m`}
                            {' · '}
                            <span style={{ color: row.weatherMeta.windSource === 'windsup' ? '#15803d' : '#64748b' }}>
                              {row.weatherMeta.windSourceLabel}
                            </span>
                          </div>
                        </div>

                        {/* 3 boutons d'état principaux */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() =>
                              updateRow(row.slotKey, prev => {
                                const nextMono =
                                  prev.monoCount === 0 && prev.biCount === 0 ? 1 : prev.monoCount;
                                const nextPeople =
                                  prev.participantsCount === 0
                                    ? nextMono + prev.biCount * 2
                                    : prev.participantsCount;
                                return {
                                  ...prev,
                                  mode: 'realized',
                                  monoCount: nextMono,
                                  participantsCount: nextPeople,
                                };
                              })
                            }
                            style={{
                              minHeight: '40px',
                              padding: '6px 14px',
                              borderRadius: '8px',
                              border: row.mode === 'realized' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                              background: row.mode === 'realized' ? '#f0fdf4' : '#ffffff',
                              color: row.mode === 'realized' ? '#166534' : '#475569',
                              fontSize: '0.78rem',
                              fontWeight: row.mode === 'realized' ? 800 : 600,
                              cursor: isReadOnly ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ✓ Réalisée
                          </button>

                          <button
                            type="button"
                            disabled={isReadOnly || row.agendaBookedCount > 0}
                            title={
                              row.agendaBookedCount > 0
                                ? `Impossible : déjà ${row.agendaBookedCount} inscrit${
                                    row.agendaBookedCount > 1 ? 's' : ''
                                  } sur ce créneau`
                                : "Classer le créneau sans inscrit (hors annulations météo)"
                            }
                            onClick={() => {
                              if (row.agendaBookedCount > 0) return;
                              updateRow(row.slotKey, prev => ({
                                ...prev,
                                mode: 'no_clients',
                                cancellationReason: 'no_clients',
                              }));
                            }}
                            style={{
                              minHeight: '40px',
                              padding: '6px 14px',
                              borderRadius: '8px',
                              border: row.mode === 'no_clients' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                              background:
                                row.agendaBookedCount > 0
                                  ? '#f1f5f9'
                                  : row.mode === 'no_clients'
                                  ? '#f5f3ff'
                                  : '#ffffff',
                              color:
                                row.agendaBookedCount > 0
                                  ? '#94a3b8'
                                  : row.mode === 'no_clients'
                                  ? '#5b21b6'
                                  : '#475569',
                              opacity: row.agendaBookedCount > 0 ? 0.55 : 1,
                              fontSize: '0.78rem',
                              fontWeight: row.mode === 'no_clients' ? 800 : 600,
                              cursor:
                                isReadOnly || row.agendaBookedCount > 0 ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            👥 Pas d&apos;inscrit
                          </button>

                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() =>
                              updateRow(row.slotKey, prev => ({
                                ...prev,
                                mode: 'cancelled_weather',
                                cancellationReason:
                                  prev.cancellationReason === 'no_clients'
                                    ? 'wind_low'
                                    : prev.cancellationReason,
                              }))
                            }
                            style={{
                              minHeight: '40px',
                              padding: '6px 14px',
                              borderRadius: '8px',
                              border:
                                row.mode === 'cancelled_weather' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                              background: row.mode === 'cancelled_weather' ? '#fef2f2' : '#ffffff',
                              color: row.mode === 'cancelled_weather' ? '#991b1b' : '#475569',
                              fontSize: '0.78rem',
                              fontWeight: row.mode === 'cancelled_weather' ? 800 : 600,
                              cursor: isReadOnly ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ⛔ Annulée
                          </button>

                          {!row.existingId && (
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  mode: 'pending',
                                }))
                              }
                              style={{
                                minHeight: '40px',
                                padding: '6px 12px',
                                borderRadius: '8px',
                                border: row.mode === 'pending' ? '2px solid #64748b' : '1px solid #cbd5e1',
                                background: row.mode === 'pending' ? '#f1f5f9' : '#ffffff',
                                color: row.mode === 'pending' ? '#334155' : '#64748b',
                                fontSize: '0.76rem',
                                fontWeight: row.mode === 'pending' ? 800 : 600,
                                cursor: isReadOnly ? 'not-allowed' : 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                              title="Laisser ce créneau en attente (aucun REX enregistré pour lui lors de la sauvegarde)"
                            >
                              ⏳ Ignorer
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Zone contextuelle selon le choix */}
                      {row.mode === 'realized' && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '10px',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: overCap || zeroRealized ? '#fef2f2' : '#f8fafc',
                            border: overCap || zeroRealized ? '1px solid #ef4444' : '1px solid #e2e8f0',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                            {/* Stepper Monos */}
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155' }}>
                                Monos
                              </span>
                              <button
                                type="button"
                                disabled={isReadOnly || row.monoCount <= 0}
                                onClick={() =>
                                  updateRow(row.slotKey, prev => {
                                    const nm = Math.max(0, prev.monoCount - 1);
                                    return {
                                      ...prev,
                                      monoCount: nm,
                                      participantsCount: nm + prev.biCount * 2,
                                    };
                                  })
                                }
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  fontWeight: 800,
                                  cursor: isReadOnly || row.monoCount <= 0 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                -
                              </button>
                              <span
                                style={{
                                  minWidth: '22px',
                                  textAlign: 'center',
                                  fontWeight: 800,
                                  fontSize: '0.88rem',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {row.monoCount}
                              </span>
                              <button
                                type="button"
                                disabled={isReadOnly || totalChars >= row.maxChars}
                                onClick={() =>
                                  updateRow(row.slotKey, prev => {
                                    if (prev.monoCount + prev.biCount >= prev.maxChars) return prev;
                                    const nm = prev.monoCount + 1;
                                    return {
                                      ...prev,
                                      monoCount: nm,
                                      participantsCount: nm + prev.biCount * 2,
                                    };
                                  })
                                }
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  fontWeight: 800,
                                  cursor: isReadOnly || totalChars >= row.maxChars ? 'not-allowed' : 'pointer',
                                }}
                              >
                                +
                              </button>
                            </div>

                            {/* Stepper Biplaces */}
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155' }}>
                                Biplaces
                              </span>
                              <button
                                type="button"
                                disabled={isReadOnly || row.biCount <= 0}
                                onClick={() =>
                                  updateRow(row.slotKey, prev => {
                                    const nb = Math.max(0, prev.biCount - 1);
                                    return {
                                      ...prev,
                                      biCount: nb,
                                      participantsCount: prev.monoCount + nb * 2,
                                    };
                                  })
                                }
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  fontWeight: 800,
                                  cursor: isReadOnly || row.biCount <= 0 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                -
                              </button>
                              <span
                                style={{
                                  minWidth: '22px',
                                  textAlign: 'center',
                                  fontWeight: 800,
                                  fontSize: '0.88rem',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {row.biCount}
                              </span>
                              <button
                                type="button"
                                disabled={isReadOnly || totalChars >= row.maxChars}
                                onClick={() =>
                                  updateRow(row.slotKey, prev => {
                                    if (prev.monoCount + prev.biCount >= prev.maxChars) return prev;
                                    const nb = prev.biCount + 1;
                                    return {
                                      ...prev,
                                      biCount: nb,
                                      participantsCount: prev.monoCount + nb * 2,
                                    };
                                  })
                                }
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  fontWeight: 800,
                                  cursor: isReadOnly || totalChars >= row.maxChars ? 'not-allowed' : 'pointer',
                                }}
                              >
                                +
                              </button>
                            </div>

                            <span
                              style={{
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                color: overCap ? '#991b1b' : '#166534',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {totalChars}/{row.maxChars} chars · {row.participantsCount} pilote
                              {row.participantsCount > 1 ? 's' : ''}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              updateRow(row.slotKey, prev => ({
                                ...prev,
                                expandedDetails: !prev.expandedDetails,
                              }))
                            }
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#334155',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {row.expandedDetails ? '▲ Masquer détails' : 'Ajuster météo / note'}
                          </button>
                        </div>
                      )}

                      {row.mode === 'cancelled_weather' && (
                        <div
                          style={{
                            padding: '10px 12px',
                            borderRadius: '8px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                            {WEATHER_CANCEL_REASONS.map(reasonKey => {
                              const info = CANCELLATION_REASONS_INFO[reasonKey];
                              const active = row.cancellationReason === reasonKey;
                              return (
                                <button
                                  key={reasonKey}
                                  type="button"
                                  disabled={isReadOnly}
                                  onClick={() =>
                                    updateRow(row.slotKey, prev => ({
                                      ...prev,
                                      cancellationReason: reasonKey,
                                    }))
                                  }
                                  style={{
                                    minHeight: '34px',
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    border: active ? `2px solid ${info.color}` : '1px solid #fca5a5',
                                    background: active ? '#ffffff' : 'rgba(255,255,255,0.6)',
                                    color: '#0f172a',
                                    fontSize: '0.73rem',
                                    fontWeight: active ? 800 : 600,
                                    cursor: isReadOnly ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {info.icon} {info.shortLabel}
                                </button>
                              );
                            })}
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '10px',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#991b1b' }}>
                                Prévus :
                                <input
                                  type="number"
                                  min={0}
                                  disabled={isReadOnly}
                                  value={row.bookedParticipantsCount}
                                  onChange={e => {
                                    const v = Math.max(0, Number(e.target.value) || 0);
                                    updateRow(row.slotKey, prev => ({
                                      ...prev,
                                      bookedParticipantsCount: v,
                                      lostCount: Math.max(0, v - prev.rescheduledCount),
                                    }));
                                  }}
                                  style={{
                                    width: '54px',
                                    padding: '4px 6px',
                                    borderRadius: '5px',
                                    border: '1px solid #fca5a5',
                                    fontWeight: 700,
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                />
                              </label>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#15803d' }}>
                                Replacés :
                                <input
                                  type="number"
                                  min={0}
                                  disabled={isReadOnly}
                                  value={row.rescheduledCount}
                                  onChange={e => {
                                    const v = Math.max(0, Number(e.target.value) || 0);
                                    updateRow(row.slotKey, prev => ({
                                      ...prev,
                                      rescheduledCount: v,
                                      lostCount: Math.max(0, prev.bookedParticipantsCount - v),
                                    }));
                                  }}
                                  style={{
                                    width: '54px',
                                    padding: '4px 6px',
                                    borderRadius: '5px',
                                    border: '1px solid #86efac',
                                    fontWeight: 700,
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                />
                              </label>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#b91c1c' }}>
                                Perdus :
                                <input
                                  type="number"
                                  min={0}
                                  disabled={isReadOnly}
                                  value={row.lostCount}
                                  onChange={e => {
                                    const v = Math.max(0, Number(e.target.value) || 0);
                                    updateRow(row.slotKey, prev => ({ ...prev, lostCount: v }));
                                  }}
                                  style={{
                                    width: '54px',
                                    padding: '4px 6px',
                                    borderRadius: '5px',
                                    border: '1px solid #cbd5e1',
                                    fontWeight: 700,
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                />
                              </label>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  expandedDetails: !prev.expandedDetails,
                                }))
                              }
                              style={{
                                padding: '5px 10px',
                                borderRadius: '6px',
                                border: '1px solid #fca5a5',
                                background: '#ffffff',
                                color: '#991b1b',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {row.expandedDetails ? '▲ Masquer détails' : 'Ajuster météo / note'}
                            </button>
                          </div>
                        </div>
                      )}

                      {row.mode === 'no_clients' && (
                        <div style={{ fontSize: '0.74rem', color: '#5b21b6', paddingLeft: '2px' }}>
                          0 inscrit · Classé hors annulations météo (Vie 2)
                        </div>
                      )}

                      {row.mode === 'pending' && (
                        <div style={{ fontSize: '0.74rem', color: '#64748b', paddingLeft: '2px', fontStyle: 'italic' }}>
                          ⏳ Non statué · Ignoré lors de l&apos;enregistrement (aucun REX écrit pour ce créneau)
                        </div>
                      )}

                      {/* Détails météo & note optionnels */}
                      {row.expandedDetails && (row.mode === 'realized' || row.mode === 'cancelled_weather') && (
                        <div
                          style={{
                            padding: '10px 12px',
                            borderRadius: '8px',
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                            gap: '8px',
                          }}
                        >
                          <label style={{ fontSize: '0.70rem', fontWeight: 700, color: '#475569' }}>
                            Vent (nds)
                            <input
                              type="number"
                              disabled={isReadOnly}
                              value={row.observedWindKts ?? ''}
                              onChange={e =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  weatherTouched: true,
                                  observedWindKts: e.target.value === '' ? undefined : Number(e.target.value),
                                }))
                              }
                              style={{ width: '100%', marginTop: '2px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                            />
                          </label>
                          <label style={{ fontSize: '0.70rem', fontWeight: 700, color: '#475569' }}>
                            Rafales (nds)
                            <input
                              type="number"
                              disabled={isReadOnly}
                              value={row.observedGustKts ?? ''}
                              onChange={e =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  weatherTouched: true,
                                  observedGustKts: e.target.value === '' ? undefined : Number(e.target.value),
                                }))
                              }
                              style={{ width: '100%', marginTop: '2px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                            />
                          </label>
                          <label style={{ fontSize: '0.70rem', fontWeight: 700, color: '#475569' }}>
                            Direction
                            <select
                              disabled={isReadOnly}
                              value={row.observedWindDir || ''}
                              onChange={e =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  weatherTouched: true,
                                  observedWindDir: e.target.value || undefined,
                                }))
                              }
                              style={{ width: '100%', marginTop: '2px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', boxSizing: 'border-box' }}
                            >
                              <option value="">—</option>
                              <option value="O">O</option>
                              <option value="SO">SO</option>
                              <option value="ONO">ONO</option>
                              <option value="NO">NO</option>
                              <option value="N">N</option>
                              <option value="NNE">NNE</option>
                              <option value="NE">NE</option>
                              <option value="E">E</option>
                              <option value="SE">SE</option>
                              <option value="S">S</option>
                            </select>
                          </label>
                          <label style={{ fontSize: '0.70rem', fontWeight: 700, color: '#475569' }}>
                            Pression (hPa)
                            <input
                              type="number"
                              disabled={isReadOnly}
                              value={row.observedPressure ?? ''}
                              onChange={e =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  weatherTouched: true,
                                  observedPressure: e.target.value === '' ? undefined : Number(e.target.value),
                                }))
                              }
                              style={{ width: '100%', marginTop: '2px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                            />
                          </label>
                          <label style={{ fontSize: '0.70rem', fontWeight: 700, color: '#475569' }}>
                            Houle (m)
                            <input
                              type="number"
                              step="0.1"
                              disabled={isReadOnly}
                              value={row.observedWaveH ?? ''}
                              onChange={e =>
                                updateRow(row.slotKey, prev => ({
                                  ...prev,
                                  weatherTouched: true,
                                  observedWaveH: e.target.value === '' ? undefined : Number(e.target.value),
                                }))
                              }
                              style={{ width: '100%', marginTop: '2px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                            />
                          </label>
                          <label style={{ fontSize: '0.70rem', fontWeight: 700, color: '#475569', gridColumn: '1 / -1' }}>
                            Remarque / État plage
                            <input
                              type="text"
                              disabled={isReadOnly}
                              value={row.notes}
                              onChange={e =>
                                updateRow(row.slotKey, prev => ({ ...prev, notes: e.target.value }))
                              }
                              placeholder="Observation terrain courte (facultatif)..."
                              style={{ width: '100%', marginTop: '2px', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Synthèse & Validation globale */}
          <div
            style={{
              padding: '12px 18px',
              background: '#f8fafc',
              borderTop: '1px solid #cbd5e1',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {summary.realized} réalisée{summary.realized > 1 ? 's' : ''} ({summary.totalChars} char
              {summary.totalChars > 1 ? 's' : ''} · {summary.totalPilots} pilote
              {summary.totalPilots > 1 ? 's' : ''})
              {' · '}
              {summary.noClients} pas d&apos;inscrit
              {' · '}
              {summary.cancelledWeather} annulée{summary.cancelledWeather > 1 ? 's' : ''}
              {summary.pending > 0 ? ` · ${summary.pending} ignoré${summary.pending > 1 ? 's' : ''}` : ''}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  minHeight: '40px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isReadOnly ? 'Fermer' : 'Annuler'}
              </button>

              {!isReadOnly && (
                <button
                  type="submit"
                  disabled={isSaving || summary.toSaveCount === 0}
                  style={{
                    minHeight: '40px',
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isSaving || summary.toSaveCount === 0 ? '#94a3b8' : '#0284c7',
                    color: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    cursor: isSaving || summary.toSaveCount === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSaving
                    ? 'Enregistrement…'
                    : summary.toSaveCount === 0
                    ? 'Choisissez au moins 1 créneau'
                    : summary.pending === 0
                    ? `✓ Valider toute la journée (${summary.toSaveCount})`
                    : `✓ Enregistrer la sélection (${summary.toSaveCount}/${visibleRows.length})`}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
