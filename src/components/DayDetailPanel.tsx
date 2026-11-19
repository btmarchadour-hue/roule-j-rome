import React, { useState } from 'react';
import {
  AppSettings,
  CancellationReason,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  MAX_CHARS_PER_INSTRUCTOR,
  SessionItem,
  SlotObservation,
  TidePoint,
  ValidationsMap,
  WindPoint,
} from '../types';
import {
  allDay,
  COEF,
  dayFocus,
  dayInfo,
  dayRow,
  isCycle1PastLocked,
  lc,
  p2,
  plan,
  sw,
  toU,
  tdy,
  vstat,
} from '../utils/tides';
import { AgendaBookingItem } from '../utils/firebaseSync';
import {
  buildReservationKey,
  Cycle1SlotAction,
  Cycle2ActionPayload,
  DEFAULT_NON_PUBLISH_REASONS,
  findMatchingValidationItem,
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getMonitorBadgeStyle,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  getValidationItemChars,
  hasCycle2Activity,
  hasCycle2Trigger,
  hasRecordedShift,
  normalizeSlotTimeHHhMM,
  stripReasonAccents,
} from '../utils/cycleHelpers';
import { CurveChart } from './CurveChart';
import { CustomSlotsManager } from './CustomSlotsManager';
import { SlotBookingsModal } from './SlotBookingsModal';
import { CALENDAR_INDICATOR_COLORS, getFrenchHolidayInfo, HOLIDAY_ZONE_COLORS } from '../utils/frenchHolidays';
import { CANCELLATION_REASONS_INFO } from '../utils/statisticsEngine';

interface DayDetailPanelProps {
  selectedDate: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  onUpdateCustomSlots: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  validations?: ValidationsMap;
  bookingsMap?: Record<string, AgendaBookingItem[]>;
  onSaveSlotBookings?: (
    ds: string,
    slotKey: string,
    slotStart: string,
    slotEnd: string,
    bookings: AgendaBookingItem[]
  ) => void;
  onValidateDay?: (
    ds: string,
    record: DayFocusData,
    mode?: 'all' | 'wind_only' | 'not_published',
    nonPublishReason?: string
  ) => void;
  onClearValidation?: (ds: string) => void;
  onSetSlotCycle1Action?: (
    record: DayFocusData,
    slot: SessionItem,
    action: Cycle1SlotAction,
    reason?: string
  ) => void;
  onExcludeRemainingCycle1Slots?: (record: DayFocusData) => void;
  onCycle2Action?: (record: DayFocusData, slot: SessionItem, payload: Cycle2ActionPayload) => void;
  onAddCustomNonPublishReason?: (reason: string) => void;
  onNavigateDay?: (deltaDays: number) => void;
  canPrevDay?: boolean;
  canNextDay?: boolean;
  onOpenCycle2?: (ds: string) => void;
  onOpenObservationModal?: (slot: {
    dateStr: string;
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    isCustom?: boolean;
    customTitle?: string;
    maxChars?: number;
    primaryInstructor?: string;
    secondaryInstructor?: string;
    defaultStatus?: 'realized' | 'cancelled';
    defaultCancellationReason?: CancellationReason;
    defaultCancellationNote?: string;
    defaultMonoCount?: number;
    defaultBiCount?: number;
    defaultParticipantsCount?: number;
    defaultBookedParticipantsCount?: number;
    forceIntent?: boolean;
  }) => void;
  onOpenExpressRex?: (dateStr: string) => void;
  observations?: SlotObservation[];
  isReadOnly?: boolean;
}

export const DayDetailPanel: React.FC<DayDetailPanelProps> = ({
  selectedDate,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  customSlotsMap,
  onUpdateCustomSlots: rawOnUpdateCustomSlots,
  validations = {},
  bookingsMap = {},
  onSaveSlotBookings: rawOnSaveSlotBookings,
  onValidateDay: rawOnValidateDay,
  onSetSlotCycle1Action: rawOnSetSlotCycle1Action,
  onExcludeRemainingCycle1Slots: rawOnExcludeRemainingCycle1Slots,
  onCycle2Action: rawOnCycle2Action,
  onAddCustomNonPublishReason,
  onNavigateDay,
  canPrevDay = false,
  canNextDay = false,
  onOpenCycle2,
  onOpenObservationModal,
  onOpenExpressRex,
  observations = [],
  isReadOnly = false,
}) => {
  const onValidateDay = isReadOnly ? undefined : rawOnValidateDay;
  const onSetSlotCycle1Action = isReadOnly ? undefined : rawOnSetSlotCycle1Action;
  const onExcludeRemainingCycle1Slots = isReadOnly ? undefined : rawOnExcludeRemainingCycle1Slots;
  const onCycle2Action = isReadOnly ? undefined : rawOnCycle2Action;
  const onSaveSlotBookings = isReadOnly ? undefined : rawOnSaveSlotBookings;
  const onUpdateCustomSlots = (ds: string, rep: boolean, slots: CustomSlot[]) => {
    if (isReadOnly) return;
    rawOnUpdateCustomSlots(ds, rep, slots);
  };
  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;

  const P = dayInfo(y, m, d, settings, tideW, first, last);
  const coef = COEF[selectedDate];
  const pl = plan(y, m, d, settings, tideW, first, last);
  const SS = pl.full;
  const XS = pl.extra;

  const [isCustomSlotsOpen, setIsCustomSlotsOpen] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<{
    date: string;
    idx: number;
    start: string;
    end: string;
  } | null>(null);
  const [activeBookingSlot, setActiveBookingSlot] = useState<{
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    slotTitle?: string;
    maxChars?: number;
    primaryInstructor?: string;
    secondaryInstructor?: string;
    secondaryQualification?: 'CQP' | 'DE_BPJEPS';
    secondaryActualEnd?: string;
    secondaryFormula?: string;
  } | null>(null);
  const [activeSlotReasonIdx, setActiveSlotReasonIdx] = useState<number | null>(null);
  const [customSlotReasonInput, setCustomSlotReasonInput] = useState('');
  const [confirmResetSlot, setConfirmResetSlot] = useState<{ date: string; idx: number } | null>(null);
  const [slotAdjustError, setSlotAdjustError] = useState<{ date: string; idx: number; message: string } | null>(null);

  const availableNonPublishReasons = React.useMemo(() => {
    const base = [...DEFAULT_NON_PUBLISH_REASONS];
    const custom = settings.customNonPublishReasons || [];
    const seen = new Set(base.map(stripReasonAccents));
    const result: string[] = [...base];
    for (const c of custom) {
      const trimmed = c.trim();
      const key = stripReasonAccents(trimmed);
      if (trimmed && key !== 'ferme' && key !== 'fermee' && !seen.has(key)) {
        seen.add(key);
        result.push(trimmed);
      }
    }
    return result;
  }, [settings.customNonPublishReasons]);

  const calculatedDefaultSlots = SS.map((x, idx) => ({
    start: lc(x[0], y, m, d),
    end: lc(x[1], y, m, d),
    title: `Séance ${idx + 1}`,
  })).concat(
    XS.map(x => ({
      start: lc(x[0], y, m, d),
      end: lc(x[1], y, m, d),
      title: `Optionnel (+${x[3]} min)`,
    }))
  );

  const a = toU(y, m, d, 0);
  const z = toU(y, m, d + 1, 0);
  const R = dayRow(y, m, d, settings, EX, tideW, first, last, windList);

  const ad = EX.filter(p => p.t >= a && p.t < z && p.adj).map(p => p.adj as number);

  const customCfg = customSlotsMap[selectedDate];
  const hasCustom = customCfg && customCfg.slots.length > 0;
  const replaceDefault = hasCustom && customCfg.replaceDefault;

  type SlotItem = {
    a: number;
    b: number;
    isOpt: boolean;
    isCustom?: boolean;
    isAdapted?: boolean;
    isUnchangedTide?: boolean;
    title?: string;
    lim: string;
    over: number;
    side: string;
  };

  let allSlots: SlotItem[] = [];
  const normHHMMColon = (v: string) => v.trim().replace('h', ':');
  const mapCustomSlotToItem = (cs: CustomSlot): SlotItem => {
    const [sh, sm] = cs.start.split(':').map(Number);
    const [eh, em] = cs.end.split(':').map(Number);
    const aVal = toU(y, m, d, sh * 60 + sm);
    const bVal = toU(y, m, d, eh * 60 + em);
    const isAdaptedRecord = Boolean(cs.isAdapted) || cs.id.startsWith('c1-');
    if (isAdaptedRecord) {
      const csStartNorm = normHHMMColon(cs.start);
      const csEndNorm = normHHMMColon(cs.end);
      const matchesSS = SS.some(
        p =>
          normHHMMColon(lc(p[0], y, m, d)) === csStartNorm &&
          normHHMMColon(lc(p[1], y, m, d)) === csEndNorm
      );
      if (matchesSS) {
        return {
          a: aVal,
          b: bVal,
          isOpt: false,
          isCustom: true,
          isAdapted: false,
          isUnchangedTide: true,
          title: cs.title,
          lim: '',
          over: 0,
          side: '',
        };
      }
      const matchedXS = XS.find(
        p =>
          normHHMMColon(lc(p[0], y, m, d)) === csStartNorm &&
          normHHMMColon(lc(p[1], y, m, d)) === csEndNorm
      );
      if (matchedXS) {
        return {
          a: aVal,
          b: bVal,
          isOpt: true,
          isCustom: true,
          isAdapted: false,
          isUnchangedTide: true,
          title: cs.title,
          lim: matchedXS[2],
          over: matchedXS[3],
          side: matchedXS[4],
        };
      }
      return {
        a: aVal,
        b: bVal,
        isOpt: false,
        isCustom: true,
        isAdapted: true,
        isUnchangedTide: false,
        title: cs.title,
        lim: '',
        over: 0,
        side: '',
      };
    }
    return {
      a: aVal,
      b: bVal,
      isOpt: false,
      isCustom: true,
      isAdapted: false,
      isUnchangedTide: false,
      title: cs.title,
      lim: '',
      over: 0,
      side: '',
    };
  };

  if (replaceDefault) {
    allSlots = customCfg.slots.map(mapCustomSlotToItem);
  } else {
    const defaultSlots: SlotItem[] = (
      SS.map(x => ({
        a: x[0],
        b: x[1],
        isOpt: false,
        lim: '',
        over: 0,
        side: '',
      })) as SlotItem[]
    ).concat(
      XS.map(x => ({
        a: x[0],
        b: x[1],
        isOpt: true,
        lim: x[2],
        over: x[3],
        side: x[4],
      }))
    );

    if (hasCustom) {
      const customItems: SlotItem[] = customCfg.slots.map(mapCustomSlotToItem);
      allSlots = defaultSlots.concat(customItems).sort((p, q) => p.a - q.a);
    } else {
      allSlots = defaultSlots.sort((p, q) => p.a - q.a);
    }
  }

  const focusData = dayFocus(selectedDate, settings, tideW, first, last, windList, customSlotsMap);
  const isPast = selectedDate < tdy();
  const isPastLocked = isCycle1PastLocked(selectedDate);

  const holiday = getFrenchHolidayInfo(selectedDate);

  const parseHHMM = (hhmm: string): number => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
  };

  const formatHHMM = (totalMins: number): string => {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMins));
    return `${p2(Math.floor(clamped / 60))}:${p2(clamped % 60)}`;
  };

  const buildEditableSlotsList = (): CustomSlot[] => {
    if (replaceDefault && customCfg) {
      return customCfg.slots.map(cs => ({
        ...cs,
        isAdapted: Boolean(cs.isAdapted) || cs.id.startsWith('c1-'),
      }));
    }
    return allSlots.map((s, i) => {
      const startStr = lc(s.a, y, m, d).replace('h', ':');
      const endStr = lc(s.b, y, m, d).replace('h', ':');
      const existingCustom =
        s.isCustom && !s.isAdapted && !s.isUnchangedTide && customCfg
          ? customCfg.slots.find(
              cs => normHHMMColon(cs.start) === startStr && normHHMMColon(cs.end) === endStr
            )
          : undefined;
      if (existingCustom) {
        return { ...existingCustom, isAdapted: false };
      }
      return {
        id: `c1-${selectedDate}-${i}-${Math.round(s.a)}`,
        start: startStr,
        end: endStr,
        title: s.title || (s.isOpt ? `Optionnel (+${s.over} min)` : `Séance ${i + 1}`),
        places: MAX_CHARS_PER_INSTRUCTOR,
        isAdapted: true,
      };
    });
  };

  const resolveSlotCycle2Context = (idx: number) => {
    const slot = allSlots[idx];
    if (!slot) return null;
    const slotKey = Math.round(slot.a) + (slot.isOpt ? 'o' : '') + (slot.isCustom ? 'c' : '');
    const startTimeStr = lc(slot.a, y, m, d);
    const endTimeStr = lc(slot.b, y, m, d);
    const valItem = findMatchingValidationItem(validations[selectedDate], slotKey, startTimeStr, endTimeStr);
    const displayStart = normalizeSlotTimeHHhMM(valItem?.actualStart || startTimeStr);
    const displayEnd = normalizeSlotTimeHHhMM(valItem?.actualEnd || endTimeStr);
    const normT = (v?: string) => (v || '').replace('h', ':');
    const slotObs = observations
      .filter(
        o =>
          o.ds === selectedDate &&
          (o.slotKey === slotKey ||
            (Boolean(o.slotStart) &&
              Boolean(o.slotEnd) &&
              (normT(o.slotStart) === normT(startTimeStr) || normT(o.slotStart) === normT(displayStart)) &&
              (normT(o.slotEnd) === normT(endTimeStr) || normT(o.slotEnd) === normT(displayEnd))))
      )
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
    const effectiveBookingKey =
      valItem && (bookingsMap[buildReservationKey(selectedDate, valItem.k)]?.length ?? 0) > 0
        ? valItem.k
        : slotKey;
    const bChars = getSlotBookingsSummary(
      bookingsMap[buildReservationKey(selectedDate, effectiveBookingKey)] || []
    ).totalChars;
    const itemChars = getValidationItemChars(valItem).totalChars;
    const effectiveChars = bChars > 0 ? bChars : itemChars;
    let c1Status = getEffectiveCycle1Status(valItem);
    let inC2 = hasCycle2Trigger(valItem, bChars, slotObs);
    let c2Status = getEffectiveCycle2Status(valItem, effectiveChars, slotObs);
    if (slotObs?.status === 'cancelled') {
      const obsHasBookedClients =
        bChars > 0 || (slotObs.bookedParticipantsCount ?? 0) > 0;
      if (slotObs.cancellationReason === 'no_clients') {
        c1Status = 'closed_no_bookings';
        inC2 = false;
        c2Status = 'none';
      } else if (slotObs.cancellationReason === 'instructor' && !obsHasBookedClients) {
        c1Status = 'not_published';
        inC2 = false;
        c2Status = 'none';
      } else {
        c1Status = 'published';
        inC2 = true;
        c2Status = 'cancelled_weather';
      }
    } else if (slotObs?.status === 'realized') {
      c1Status = 'published';
      inC2 = true;
      c2Status = 'realized';
    }
    const hasC2Act = hasCycle2Activity(valItem, effectiveChars, slotObs);
    const isWithin48h = slot.a - Date.now() / 60000 < 48 * 60;
    const isClosedOrExcluded =
      c1Status === 'closed_no_bookings' ||
      c1Status === 'not_published' ||
      c1Status === 'excluded' ||
      c2Status === 'cancelled_weather' ||
      c2Status === 'merged' ||
      c2Status === 'realized';
    const focusSess: SessionItem =
      focusData.list.find(
        s =>
          Math.round(s.a) === Math.round(slot.a) &&
          Boolean(s.opt) === Boolean(slot.isOpt) &&
          Boolean(s.isCustom) === Boolean(slot.isCustom)
      ) || {
        a: slot.a,
        b: slot.b,
        opt: Boolean(slot.isOpt),
        isCustom: Boolean(slot.isCustom),
        customTitle: slot.title,
        ok: sw(slot.a, slot.b, settings, windList),
        st: null,
        txt: '',
        over: slot.over || 0,
        lim: slot.lim || '',
        side: slot.side || '',
        past: isPast,
      };
    return {
      slot,
      startTimeStr,
      endTimeStr,
      valItem,
      slotObs,
      effectiveChars,
      c1Status,
      inC2,
      c2Status,
      hasC2Act,
      isWithin48h,
      isClosedOrExcluded,
      focusSess,
    };
  };

  const findOverlappingSlot = (
    idx: number,
    nextStartMin: number,
    nextEndMin: number,
    editableList: CustomSlot[]
  ): { start: string; end: string } | null => {
    for (let i = 0; i < editableList.length; i++) {
      if (i === idx) continue;
      const otherCtx = resolveSlotCycle2Context(i);
      if (otherCtx?.isClosedOrExcluded) continue;
      const other = editableList[i];
      const oStart = parseHHMM(other.start);
      const oEnd = parseHHMM(other.end);
      if (nextStartMin < oEnd && nextEndMin > oStart) {
        return {
          start: normalizeSlotTimeHHhMM(other.start),
          end: normalizeSlotTimeHHhMM(other.end),
        };
      }
    }
    return null;
  };

  const handleShiftSlotTime = (idx: number, deltaMinutes: number) => {
    if (isReadOnly || isPastLocked) return;
    const ctx = resolveSlotCycle2Context(idx);
    if (!ctx || ctx.isClosedOrExcluded || ctx.hasC2Act || ctx.isWithin48h) {
      return;
    }

    const nextList = buildEditableSlotsList();
    const target = nextList[idx];
    if (!target) return;

    const sMin = parseHHMM(target.start);
    const eMin = parseHHMM(target.end);
    const duration = Math.max(30, eMin - sMin);

    let nextStart = sMin + deltaMinutes;
    if (nextStart < 0) nextStart = 0;
    if (nextStart + duration > 23 * 60 + 59) {
      nextStart = Math.max(0, 23 * 60 + 59 - duration);
    }
    const nextEnd = nextStart + duration;

    const overlap = findOverlappingSlot(idx, nextStart, nextEnd, nextList);
    if (overlap) {
      setSlotAdjustError({
        date: selectedDate,
        idx,
        message: `Chevauchement avec le créneau ${overlap.start} - ${overlap.end}`,
      });
      return;
    }

    setSlotAdjustError(null);
    nextList[idx] = {
      ...target,
      start: formatHHMM(nextStart),
      end: formatHHMM(nextEnd),
    };
    onUpdateCustomSlots(selectedDate, true, nextList);
  };

  const handleSaveInlineSlotEdit = (idx: number) => {
    if (isReadOnly || isPastLocked || !inlineEdit || inlineEdit.date !== selectedDate || inlineEdit.idx !== idx) {
      return;
    }
    const sMin = parseHHMM(inlineEdit.start);
    const eMin = parseHHMM(inlineEdit.end);
    if (eMin <= sMin) {
      setSlotAdjustError({
        date: selectedDate,
        idx,
        message: 'L’heure de fin doit être postérieure au début',
      });
      return;
    }

    const ctx = resolveSlotCycle2Context(idx);
    if (!ctx || ctx.isClosedOrExcluded || ctx.hasC2Act || ctx.isWithin48h) {
      setInlineEdit(null);
      return;
    }

    const nextList = buildEditableSlotsList();
    if (!nextList[idx]) return;

    const overlap = findOverlappingSlot(idx, sMin, eMin, nextList);
    if (overlap) {
      setSlotAdjustError({
        date: selectedDate,
        idx,
        message: `Chevauchement avec le créneau ${overlap.start} - ${overlap.end}`,
      });
      return;
    }

    setSlotAdjustError(null);
    nextList[idx] = {
      ...nextList[idx],
      start: inlineEdit.start,
      end: inlineEdit.end,
    };
    onUpdateCustomSlots(selectedDate, true, nextList);
    setInlineEdit(null);
  };

  return (
    <div className="pan card cal" id="pan">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="pt" style={{ marginBottom: 0 }}>Plage de roulage</div>
            {onNavigateDay && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '2px 4px' }}>
                <button
                  type="button"
                  disabled={!canPrevDay}
                  onClick={() => onNavigateDay(-1)}
                  style={{
                    border: 'none',
                    background: canPrevDay ? '#fff' : 'transparent',
                    color: canPrevDay ? '#0f172a' : '#94a3b8',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: canPrevDay ? 'pointer' : 'not-allowed',
                    boxShadow: canPrevDay ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                  title="Passer au jour précédent"
                >
                  ◀ Jour préc.
                </button>
                <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#0369a1', padding: '0 6px' }}>
                  {p2(d)}/{p2(m0)}/{y}
                </span>
                <button
                  type="button"
                  disabled={!canNextDay}
                  onClick={() => onNavigateDay(1)}
                  style={{
                    border: 'none',
                    background: canNextDay ? '#0284c7' : 'transparent',
                    color: canNextDay ? '#fff' : '#94a3b8',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: canNextDay ? 'pointer' : 'not-allowed',
                    boxShadow: canNextDay ? '0 1px 2px rgba(2,132,199,0.25)' : 'none',
                  }}
                  title="Passer au jour suivant"
                >
                  Jour suiv. ▶
                </button>
              </div>
            )}
          </div>
          <div className="ps" style={{ marginBottom: 0, marginTop: '4px' }}>
            Date : {p2(d)}/{p2(m0)}/{y} · seuil :{' '}
            {settings.L.toFixed(2).replace('.', 'm')}
            {settings.mg ? ` − ${settings.mg} cm` : ''} · min. 09h00–{settings.h1}h
          </div>
        </div>

        {/* 2 boutons d'action principaux : + NOTER UN RELEVÉ & ✏️ MODIFIER LES CRÉNEAUX */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {onOpenExpressRex && (
            <button
              type="button"
              onClick={() => onOpenExpressRex(selectedDate)}
              style={{
                background: '#0f766e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 14px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(15, 118, 110, 0.3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
              }}
              title="Valider tous les créneaux de la journée en une seule vue avec météo pré-remplie"
            >
              <span>⚡</span>
              <span>BILAN EXPRESS</span>
            </button>
          )}

          {onOpenObservationModal && (
            <button
              type="button"
              onClick={() => {
                onOpenObservationModal({
                  dateStr: selectedDate,
                  slotKey: allSlots[0] ? `s0` : 'general',
                  slotStart: allSlots[0] ? lc(allSlots[0].a, y, m, d) : '09:00',
                  slotEnd: allSlots[0] ? lc(allSlots[0].b, y, m, d) : '10:00',
                  isCustom: allSlots[0]?.isCustom,
                  customTitle: allSlots[0]?.title,
                });
              }}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 14px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              title="Noter un relevé terrain (hauteurs d'eau, surcote, météo) ou une cause d'annulation"
            >
              <span style={{ fontSize: '0.95rem', fontWeight: 900 }}>+</span>
              <span>NOTER UN RELEVÉ</span>
            </button>
          )}

          {!isReadOnly && !isPastLocked && (
            <button
              type="button"
              onClick={() => {
                setIsCustomSlotsOpen(true);
                requestAnimationFrame(() => {
                  const el = document.getElementById('custom-slots-section');
                  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
              }}
              style={{
                background: '#ffffff',
                color: '#0f172a',
                border: '1.5px solid #0284c7',
                borderRadius: '8px',
                padding: '7px 13px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                transition: 'all 0.15s ease',
              }}
              title="Créer un créneau sur mesure ou redéfinir manuellement les créneaux prédéfinis"
            >
              <span>✏️</span>
              <span>CRÉNEAUX SUR MESURE</span>
            </button>
          )}
        </div>
      </div>

      {(holiday.isHoliday || holiday.isPublicHoliday || holiday.isBridgeWeek) && (
        <div
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            background: '#f8fafc',
            border: '1.5px solid #cbd5e1',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '0.74rem',
            marginBottom: '8px',
            color: '#0f172a',
          }}
        >
          {holiday.isPublicHoliday && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
              <span
                style={{
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  background: CALENDAR_INDICATOR_COLORS.F.bg,
                  color: CALENDAR_INDICATOR_COLORS.F.text,
                }}
              >
                F
              </span>
              <span>{holiday.publicHolidayName}</span>
            </span>
          )}
          {holiday.isBridgeWeek && (
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#5b21b6' }}
              title={`Semaine avec jour férié le ${holiday.bridgeHolidayWeekday}`}
            >
              <span
                style={{
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  background: CALENDAR_INDICATOR_COLORS.P.bg,
                  color: CALENDAR_INDICATOR_COLORS.P.text,
                }}
              >
                P
              </span>
              <span>Pont possible ({holiday.bridgeHolidayLabel})</span>
            </span>
          )}
          {holiday.isHoliday && (
            <>
              <span>🎒 {holiday.holidayName}</span>
              <span style={{ fontWeight: 800, color: '#334155' }}>({holiday.zonesLabel})</span>
              <span style={{ display: 'inline-flex', gap: '3px' }}>
                {(['A', 'B', 'C'] as const).map(z => {
                  const active =
                    (z === 'A' && holiday.isZoneA) ||
                    (z === 'B' && holiday.isZoneB) ||
                    (z === 'C' && holiday.isZoneC);
                  const zoneStyle = HOLIDAY_ZONE_COLORS[z];
                  return (
                    <span
                      key={z}
                      title={zoneStyle.label}
                      style={{
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '0.62rem',
                        fontWeight: 900,
                        color: active ? zoneStyle.text : '#475569',
                        background: active ? zoneStyle.bg : '#cbd5e1',
                        opacity: active ? 1 : 0.45,
                      }}
                    >
                      {z}
                    </span>
                  );
                })}
              </span>
            </>
          )}
        </div>
      )}

      <CurveChart
        dateStr={selectedDate}
        settings={settings}
        EX={EX}
        W={tideW}
        first={first}
        last={last}
      />

      {!P.length && (
        <div className="w">
          <span className="chip k">AUCUNE PLAGE</span>
          <span className="chip k">COEF : {coef}</span>
        </div>
      )}

      {P.map((p, idx) => (
        <div key={`pract-${idx}`} className="w">
          <span className="chip">● PRATICABLE</span>
          <span className="chip k">COEF : {coef}</span>
          <span className="hr">
            {lc(p[0], y, m, d)} - {lc(p[1], y, m, d)}
          </span>
        </div>
      ))}

      {allDay(y, m, d, settings) && (
        <div className="m">
          Coef ≤ {settings.cmax} : roulage toute la journée, sans contrainte de marée.
        </div>
      )}

      {/* Sessions list */}
      {(() => {
        const valRecForHeader = validations[selectedDate];
        const valInfo = vstat(focusData, validations);
        const allPublished =
          valInfo.st === 'ok' && valInfo.valCount > 0 && valInfo.notPublishedCount === 0;
        const remainingUndecidedCount = !isReadOnly && !isPastLocked && onExcludeRemainingCycle1Slots
          ? focusData.list.filter(s => {
              const sk = Math.round(s.a) + (s.opt ? 'o' : '') + (s.isCustom ? 'c' : '');
              const stStr = lc(s.a, y, m, d);
              const enStr = lc(s.b, y, m, d);
              const matched = findMatchingValidationItem(valRecForHeader, sk, stStr, enStr);
              if (matched) return false;
              const bKey = buildReservationKey(selectedDate, sk);
              const bChars = getSlotBookingsSummary(bookingsMap[bKey] || []).totalChars;
              return bChars === 0;
            }).length
          : 0;
        const decidedCount = focusData.list.length - remainingUndecidedCount;

        return (
          <div
            className="ps"
            style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <span>
              {(() => {
                const trueCustomCount = allSlots.filter(
                  s => s.isCustom && !s.isAdapted && !s.isUnchangedTide
                ).length;
                const adaptedCount = allSlots.filter(s => s.isAdapted).length;
                if (replaceDefault) {
                  if (trueCustomCount > 0) {
                    return `Séances (${allSlots.length} · dont ${trueCustomCount} sur mesure${
                      adaptedCount > 0 ? `, ${adaptedCount} adapté${adaptedCount > 1 ? 's' : ''}` : ''
                    })`;
                  }
                  if (adaptedCount > 0) {
                    return `Séances (${allSlots.length} · dont ${adaptedCount} horaire${
                      adaptedCount > 1 ? 's' : ''
                    } adapté${adaptedCount > 1 ? 's' : ''})`;
                  }
                  return `Séances proposées (${allSlots.length})`;
                }
                return `Séances proposées (${SS.length}${
                  XS.length ? ` + ${XS.length} optionnel${XS.length > 1 ? 's' : ''}` : ''
                }${trueCustomCount > 0 ? ` + ${trueCustomCount} sur-mesure` : ''})`;
              })()}
              {` · jauge max ${MAX_CHARS_PER_INSTRUCTOR} chars / moniteur (Mono + Bi)`}
            </span>

            {!isReadOnly && !isPastLocked && focusData.list.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {onValidateDay && (
                  <button
                    type="button"
                    className="fbtn"
                    onClick={() => onValidateDay(selectedDate, focusData, 'all')}
                    style={{
                      margin: 0,
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      background: allPublished ? '#16a34a' : 'var(--ac, #ffc40d)',
                      color: allPublished ? '#ffffff' : '#111111',
                      border: allPublished ? '1px solid #15803d' : '1px solid #eab308',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    title="Valider tous les créneaux de la journée « À publier » en un clic (Cycle 1)"
                  >
                    {allPublished ? '✓ Tous publiés (C1)' : '✅ Tout valider (C1)'}
                  </button>
                )}

                {remainingUndecidedCount > 0 && decidedCount > 0 && onExcludeRemainingCycle1Slots && (
                  <button
                    type="button"
                    className="fbtn"
                    onClick={() => onExcludeRemainingCycle1Slots(focusData)}
                    style={{
                      margin: 0,
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      background: '#f8fafc',
                      color: '#475569',
                      border: '1px dashed #94a3b8',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    title="Marquer d'un clic les créneaux encore en attente comme « Hors offre / Non pertinent » (exclus des stats d'absentéisme et du taux de concrétisation)"
                  >
                    ➖ Écarter les {remainingUndecidedCount} non retenu{remainingUndecidedCount > 1 ? 's' : ''} (hors offre)
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Ensemble des créneaux : Cycle 1 (Offre) + Passage automatique Cycle 2 dès 1ère inscription */}
      {(() => {
        const matchedValKeys = new Set<string>();

        const renderedSlots = allSlots.map((x, idx) => {
          const ok = sw(x.a, x.b, settings, windList);
          const slotKey = Math.round(x.a) + (x.isOpt ? 'o' : '') + (x.isCustom ? 'c' : '');
          const startTimeStr = lc(x.a, y, m, d);
          const endTimeStr = lc(x.b, y, m, d);
          const valRecord = validations[selectedDate];

          const valItem = findMatchingValidationItem(
            valRecord,
            slotKey,
            startTimeStr,
            endTimeStr,
            matchedValKeys
          );
          if (valItem) {
            matchedValKeys.add(valItem.k);
          }

          const effectiveBookingKey =
            valItem && (bookingsMap[buildReservationKey(selectedDate, valItem.k)]?.length ?? 0) > 0
              ? valItem.k
              : slotKey;
          const resKey = buildReservationKey(selectedDate, effectiveBookingKey);
          const slotBookings = bookingsMap[resKey] || [];
          const slotMaxChars = getSlotMaxCapacity(valItem);
          const primaryInstructor = valItem?.instructor || valItem?.assignedPilot || 'Jérôme';
          const secondaryInstructor = valItem?.secondaryInstructor;
          const bookingSummary = getSlotBookingsSummary(slotBookings, slotMaxChars);
          const itemChars = getValidationItemChars(valItem);
          const effectiveChars =
            bookingSummary.totalChars > 0 ? bookingSummary.totalChars : itemChars.totalChars;
          const effectiveMono =
            bookingSummary.totalChars > 0 ? bookingSummary.monoCount : itemChars.mono;
          const effectiveBi =
            bookingSummary.totalChars > 0 ? bookingSummary.biCount : itemChars.bi;
          const effectivePeople =
            bookingSummary.totalChars > 0 ? bookingSummary.totalPeople : itemChars.people;
          const isOverCapacity = effectiveChars > slotMaxChars;

          const sessItem: SessionItem =
            focusData.list.find(
              s =>
                Math.round(s.a) === Math.round(x.a) &&
                Boolean(s.opt) === Boolean(x.isOpt) &&
                Boolean(s.isCustom) === Boolean(x.isCustom)
            ) || {
              a: x.a,
              b: x.b,
              opt: Boolean(x.isOpt),
              isCustom: Boolean(x.isCustom),
              customTitle: x.title,
              ok: ok,
              st: null,
              txt: '',
              over: x.over || 0,
              lim: x.lim || '',
              side: x.side || '',
              past: isPast,
            };

          const displayStart = normalizeSlotTimeHHhMM(valItem?.actualStart || startTimeStr);
          const displayEnd = normalizeSlotTimeHHhMM(valItem?.actualEnd || endTimeStr);
          const pubDisplayStart = normalizeSlotTimeHHhMM(valItem?.publishedStart || startTimeStr);
          const pubDisplayEnd = normalizeSlotTimeHHhMM(valItem?.publishedEnd || endTimeStr);
          const normT = (v?: string) => (v || '').replace('h', ':');
          const slotObs = observations
            .filter(
              o =>
                o.ds === selectedDate &&
                (o.slotKey === slotKey ||
                  (Boolean(o.slotStart) &&
                    Boolean(o.slotEnd) &&
                    (normT(o.slotStart) === normT(startTimeStr) || normT(o.slotStart) === normT(displayStart)) &&
                    (normT(o.slotEnd) === normT(endTimeStr) || normT(o.slotEnd) === normT(displayEnd))))
            )
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
          const slotObsReasonInfo =
            slotObs?.status === 'cancelled' && slotObs.cancellationReason
              ? CANCELLATION_REASONS_INFO[slotObs.cancellationReason]
              : null;

          let c1Status = getEffectiveCycle1Status(valItem);
          let inCycle2 = hasCycle2Trigger(valItem, bookingSummary.totalChars);
          let c2Status = getEffectiveCycle2Status(valItem, bookingSummary.totalChars);

          if (slotObs?.status === 'cancelled') {
            const obsHasBookedClients =
              bookingSummary.totalChars > 0 || (slotObs.bookedParticipantsCount ?? 0) > 0;
            if (slotObs.cancellationReason === 'no_clients') {
              c1Status = 'closed_no_bookings';
              inCycle2 = false;
              c2Status = 'none';
            } else if (slotObs.cancellationReason === 'instructor' && !obsHasBookedClients) {
              c1Status = 'not_published';
              inCycle2 = false;
              c2Status = 'none';
            } else {
              c1Status = 'published';
              inCycle2 = true;
              c2Status = 'cancelled_weather';
            }
          } else if (slotObs?.status === 'realized') {
            c1Status = 'published';
            inCycle2 = true;
            c2Status = 'realized';
          }

          const isShifted = hasRecordedShift(valItem);

          const cardBg =
            c2Status === 'cancelled_weather' || c1Status === 'closed_no_bookings'
              ? '#fef2f2'
              : c1Status === 'excluded'
              ? '#f8fafc'
              : c1Status === 'not_published'
              ? '#f1f5f9'
              : inCycle2
              ? '#f0fdf4'
              : c1Status === 'published'
              ? '#f0f9ff'
              : '#ffffff';

          const cardBorder =
            c2Status === 'cancelled_weather' || c1Status === 'closed_no_bookings'
              ? '2px solid #ef4444'
              : c1Status === 'excluded'
              ? '1.5px dashed #94a3b8'
              : c1Status === 'not_published'
              ? '2px solid #64748b'
              : inCycle2
              ? '2px solid #22c55e'
              : c1Status === 'published'
              ? '2px solid #0284c7'
              : '2px dashed #cbd5e1';

          const cardBarColor =
            c2Status === 'cancelled_weather' || c1Status === 'closed_no_bookings'
              ? '#dc2626'
              : c1Status === 'excluded'
              ? '#94a3b8'
              : c1Status === 'not_published'
              ? '#475569'
              : inCycle2
              ? '#16a34a'
              : c1Status === 'published'
              ? '#0284c7'
              : '#94a3b8';

          const hasC2Activity = hasCycle2Activity(valItem, bookingSummary.totalChars, slotObs);
          const isPickingReason = activeSlotReasonIdx === idx && !isReadOnly && !isPastLocked && !hasC2Activity;

          return (
            <div
              key={`slot-${idx}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px 16px',
                borderRadius: '10px',
                marginBottom: '10px',
                backgroundColor: cardBg,
                border: cardBorder,
                borderLeft: `6px solid ${cardBarColor}`,
                boxShadow: inCycle2
                  ? '0 2px 8px rgba(22, 163, 74, 0.12)'
                  : c1Status === 'published'
                  ? '0 2px 6px rgba(2, 132, 199, 0.10)'
                  : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  width: '100%',
                }}
              >
              {/* SECTION GAUCHE : STATUT CYCLE 1 / CYCLE 2 & JAUGE CHARS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {inCycle2 ? (
                  <>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background:
                          c2Status === 'cancelled_weather'
                            ? '#dc2626'
                            : c2Status === 'merged'
                            ? '#7c3aed'
                            : c2Status === 'shifted'
                            ? '#d97706'
                            : '#16a34a',
                        color: '#ffffff',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: 900,
                        fontSize: '0.76rem',
                        letterSpacing: '0.03em',
                      }}
                    >
                      <span>
                        {c2Status === 'cancelled_weather'
                          ? '⛔'
                          : c2Status === 'merged'
                          ? '🔗'
                          : c2Status === 'shifted'
                          ? '🕒'
                          : '⚡'}
                      </span>
                      <span>
                        {c2Status === 'cancelled_weather'
                          ? `ANNULÉ MÉTÉO (VIE 2)${valItem?.rejectReason ? ` · ${valItem.rejectReason}` : ''}`
                          : c2Status === 'merged'
                          ? `CYCLE 2 · REGROUPÉ (${valItem?.mergedLabel || 'autre créneau'})`
                          : c2Status === 'shifted'
                          ? `CYCLE 2 · DÉCALÉ ${valItem?.shiftMinutes ? (valItem.shiftMinutes > 0 ? `+${valItem.shiftMinutes}` : valItem.shiftMinutes) + ' MIN' : ''}`
                          : c2Status === 'realized'
                          ? isShifted && valItem?.shiftMinutes
                            ? `CYCLE 2 · RÉALISÉ (DÉCALÉ ${valItem.shiftMinutes > 0 ? `+${valItem.shiftMinutes}` : valItem.shiftMinutes} MIN)`
                            : isShifted
                            ? 'CYCLE 2 · RÉALISÉ (DÉCALÉ)'
                            : 'CYCLE 2 · RÉALISÉ'
                          : isShifted && valItem?.shiftMinutes
                          ? `CYCLE 2 · ACTIF (DÉCALÉ ${valItem.shiftMinutes > 0 ? `+${valItem.shiftMinutes}` : valItem.shiftMinutes} MIN)`
                          : 'CYCLE 2 · ACTIF'}
                      </span>
                    </span>

                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: isOverCapacity ? '#fee2e2' : '#dcfce7',
                        border: isOverCapacity ? '1px solid #ef4444' : '1px solid #86efac',
                        color: isOverCapacity ? '#991b1b' : '#166534',
                        padding: '2px 8px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontWeight: 900,
                      }}
                    >
                      <span>🚗</span>
                      <span>
                        {effectiveChars} / {slotMaxChars} chars
                      </span>
                      {(effectiveMono > 0 || effectiveBi > 0) && (
                        <span style={{ fontWeight: 700, opacity: 0.85 }}>
                          ({effectiveMono}M+{effectiveBi}B · {effectivePeople}p)
                        </span>
                      )}
                    </span>

                    {(() => {
                      const pStyle = getMonitorBadgeStyle(primaryInstructor);
                      const sStyle = secondaryInstructor ? getMonitorBadgeStyle(secondaryInstructor) : null;
                      return (
                        <>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              background: pStyle.bg,
                              border: `1px solid ${pStyle.bd}`,
                              color: pStyle.fg,
                              padding: '2px 7px',
                              borderRadius: '5px',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                            }}
                          >
                            <span>👤</span>
                            <span>{primaryInstructor}</span>
                          </span>
                          {secondaryInstructor && sStyle && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: sStyle.bg,
                                border: `1px solid ${sStyle.bd}`,
                                color: sStyle.fg,
                                padding: '2px 7px',
                                borderRadius: '5px',
                                fontSize: '0.68rem',
                                fontWeight: 800,
                              }}
                            >
                              <span>👤</span>
                              <span>
                                {secondaryInstructor}
                                {valItem?.secondaryQualification === 'CQP' ? ' (CQP)' : ''}
                                {valItem?.secondaryActualEnd && valItem.secondaryActualEnd !== displayEnd
                                  ? ` · fin ${valItem.secondaryActualEnd}`
                                  : ''}
                                {valItem?.secondaryFormula ? ` · ${valItem.secondaryFormula}` : ''}
                              </span>
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </>
                ) : c1Status === 'published' ? (
                  <>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: '#0284c7',
                        color: '#ffffff',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: 900,
                        fontSize: '0.76rem',
                        letterSpacing: '0.03em',
                      }}
                    >
                      <span>✅</span>
                      <span>À PUBLIER (CYCLE 1 · OUVERT)</span>
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: '#e0f2fe',
                        border: '1px solid #7dd3fc',
                        color: '#0369a1',
                        padding: '2px 7px',
                        borderRadius: '5px',
                        fontSize: '0.70rem',
                        fontWeight: 800,
                      }}
                    >
                      <span>🚗 0 / {slotMaxChars} chars</span>
                    </span>
                  </>
                ) : c1Status === 'excluded' ? (
                  <>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: '#64748b',
                        color: '#ffffff',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: 900,
                        fontSize: '0.76rem',
                        letterSpacing: '0.02em',
                      }}
                    >
                      <span>➖</span>
                      <span>HORS OFFRE (CYCLE 1)</span>
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: '#e2e8f0',
                        border: '1px solid #cbd5e1',
                        color: '#475569',
                        padding: '2px 8px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                      }}
                    >
                      <span>Non pertinent · Exclu des stats</span>
                    </span>
                  </>
                ) : c1Status === 'not_published' ? (
                  <>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: '#334155',
                        color: '#ffffff',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: 900,
                        fontSize: '0.76rem',
                        letterSpacing: '0.02em',
                      }}
                    >
                      <span>🚫</span>
                      <span>À NE PAS PUBLIER (CYCLE 1)</span>
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: '#e2e8f0',
                        border: '1px solid #94a3b8',
                        color: '#1e293b',
                        padding: '2px 8px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                      }}
                    >
                      <span>Motif : {valItem?.nonPublishReason || 'Impératif personnel'}</span>
                    </span>
                  </>
                ) : c1Status === 'closed_no_bookings' ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: '#dc2626',
                      color: '#ffffff',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontWeight: 900,
                      fontSize: '0.76rem',
                      letterSpacing: '0.02em',
                    }}
                  >
                    <span>⛔</span>
                    <span>ANNULÉ (VIE 2) · PAS D&apos;INSCRIT</span>
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: '#fffbeb',
                      color: '#92400e',
                      border: '1px solid #fcd34d',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontWeight: 800,
                      fontSize: '0.74rem',
                    }}
                  >
                    <span>⏳</span>
                    <span>EN ATTENTE DE VALIDATION (C1)</span>
                  </span>
                )}

                {x.isCustom && !x.isAdapted && !x.isUnchangedTide ? (
                  <span
                    style={{
                      background: isPast ? '#f1f5f9' : '#e0f2fe',
                      color: isPast ? '#475569' : '#0369a1',
                      border: isPast ? '1px solid #cbd5e1' : 'none',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontWeight: 800,
                      fontSize: '0.72rem',
                    }}
                  >
                    ● SUR MESURE · {x.title}
                  </span>
                ) : x.isAdapted ? (
                  <span
                    style={{
                      background: isPast ? '#f1f5f9' : '#eef2ff',
                      color: isPast ? '#475569' : '#4338ca',
                      border: isPast ? '1px solid #cbd5e1' : '1px solid #c7d2fe',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontWeight: 800,
                      fontSize: '0.72rem',
                    }}
                  >
                    🕒 ADAPTÉ
                  </span>
                ) : x.isOpt && !isPast ? (
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '0.72rem' }}>
                    ● OPTIONNEL (+{x.over} MIN)
                  </span>
                ) : null}

                {!isPast && (
                  <span
                    className={ok === true ? 'chip fg' : ok === false ? 'chip fr' : 'chip k'}
                    style={{ margin: 0 }}
                  >
                    {ok === true ? '● VENT OK' : ok === false ? 'VENT HORS PLAGE' : '🌊 Marée seule'}
                  </span>
                )}

                {slotObs && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.70rem',
                      fontWeight: 900,
                      background: slotObs.status === 'cancelled' ? '#fef2f2' : '#ecfdf5',
                      color: slotObs.status === 'cancelled' ? '#b91c1c' : '#047857',
                      border: slotObs.status === 'cancelled' ? '1.5px solid #fca5a5' : '1.5px solid #6ee7b7',
                    }}
                    title={`REX saisi${slotObs.author ? ` par ${slotObs.author}` : ''}${slotObs.cancellationNote ? ` · ${slotObs.cancellationNote}` : slotObs.notes ? ` · ${slotObs.notes}` : ''}`}
                  >
                    <span>📝 REX :</span>
                    {slotObs.status === 'cancelled' ? (
                      <span>
                        {slotObsReasonInfo?.icon || '⛔'} {slotObsReasonInfo?.shortLabel || 'Annulé'}
                        {slotObs.cancellationNote ? ` · ${slotObs.cancellationNote}` : ''}
                      </span>
                    ) : (
                      <span>
                        ✓ Réalisé
                        {slotObs.charsCount != null
                          ? ` · ${slotObs.charsCount} char${slotObs.charsCount > 1 ? 's' : ''}`
                          : ''}
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* SECTION DROITE : ACTIONS NUMÉRIQUES + REPOSITIONNEMENT C1 + HORAIRE */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  {c1Status === 'unpublished' && !isReadOnly && !isPastLocked && onSetSlotCycle1Action && !hasC2Activity && (
                    <>
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#0369a1',
                          background: '#fff',
                          border: '1.5px solid #0284c7',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          if (activeSlotReasonIdx === idx) setActiveSlotReasonIdx(null);
                          setConfirmResetSlot(null);
                          onSetSlotCycle1Action(focusData, sessItem, 'publish');
                        }}
                        title="Valider ce créneau « À publier » en Cycle 1"
                      >
                        ✅ À publier
                      </button>

                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#475569',
                          background: '#f8fafc',
                          border: '1.5px dashed #94a3b8',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          if (activeSlotReasonIdx === idx) setActiveSlotReasonIdx(null);
                          setConfirmResetSlot(null);
                          onSetSlotCycle1Action(focusData, sessItem, 'excluded');
                        }}
                        title="Écarter ce créneau non retenu (exclu de l'absentéisme et du taux de concrétisation)"
                      >
                        ➖ Hors offre
                      </button>

                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: isPickingReason ? '#fff' : '#334155',
                          background: isPickingReason ? '#334155' : '#fff',
                          border: '1.5px solid #475569',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setConfirmResetSlot(null);
                          setActiveSlotReasonIdx(prev => (prev === idx ? null : idx));
                          setCustomSlotReasonInput('');
                        }}
                        title="Marquer « À ne pas publier » et choisir la raison (Réunion, Vacances, etc.) pour les stats"
                      >
                        🚫 À ne pas publier
                      </button>

                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#b91c1c',
                          background: '#fef2f2',
                          border: '1.5px solid #fca5a5',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          if (activeSlotReasonIdx === idx) setActiveSlotReasonIdx(null);
                          setConfirmResetSlot(null);
                          if (onOpenObservationModal) {
                            onOpenObservationModal({
                              dateStr: selectedDate,
                              slotKey,
                              slotStart: displayStart,
                              slotEnd: displayEnd,
                              isCustom: x.isCustom,
                              customTitle: x.title,
                              maxChars: slotMaxChars,
                              primaryInstructor,
                              secondaryInstructor,
                              forceIntent: true,
                              defaultStatus: 'cancelled',
                              defaultCancellationReason: 'no_clients',
                            });
                          } else {
                            onSetSlotCycle1Action(focusData, sessItem, 'close_no_bookings');
                          }
                        }}
                        title="Annuler faute d'inscrits (Vie 2) et compléter le REX en un seul écran"
                      >
                        👥 Pas d&apos;inscrit
                      </button>
                    </>
                  )}

                  {(c1Status === 'published' || inCycle2) && (
                    <>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#fff',
                          background: '#16a34a',
                          border: '1px solid #16a34a',
                          borderRadius: '6px',
                        }}
                        title="Option retenue en Cycle 1 : créneau validé À publier"
                      >
                        ✅ À publier
                      </span>

                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: effectiveChars > 0 ? '#166534' : '#0369a1',
                          background: effectiveChars > 0 ? '#dcfce7' : '#e0f2fe',
                          border: effectiveChars > 0 ? '1px solid #86efac' : '1px solid #7dd3fc',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setConfirmResetSlot(null);
                          const bookingTitle = isShifted
                            ? `${x.title ? `${x.title} · ` : ''}C1 : ${pubDisplayStart}–${pubDisplayEnd}`
                            : x.title;
                          setActiveBookingSlot({
                            slotKey: effectiveBookingKey,
                            slotStart: displayStart,
                            slotEnd: displayEnd,
                            slotTitle: bookingTitle,
                            maxChars: slotMaxChars,
                            primaryInstructor,
                            secondaryInstructor,
                            secondaryQualification: valItem?.secondaryQualification,
                            secondaryActualEnd: valItem?.secondaryActualEnd,
                            secondaryFormula: valItem?.secondaryFormula,
                          });
                        }}
                        title="Gérer les inscriptions et chars sur ce créneau (saisie facultative)"
                      >
                        👥 Inscriptions ({effectiveChars}/{slotMaxChars})
                      </button>

                      {onOpenCycle2 && (
                        <button
                          type="button"
                          className="fbtn"
                          style={{
                            margin: 0,
                            padding: '5px 9px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            color: '#6d28d9',
                            background: '#f3e8ff',
                            border: '1px solid #d8b4fe',
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            setConfirmResetSlot(null);
                            onOpenCycle2(selectedDate);
                          }}
                          title="Gérer les décisions terrain (météo, REX, 2e moniteur) dans Cycle 2"
                        >
                          ⚡ Gérer Cycle 2
                        </button>
                      )}
                    </>
                  )}

                  {c1Status === 'excluded' && !inCycle2 && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#fff',
                        background: '#64748b',
                        border: '1.5px solid #475569',
                        borderRadius: '6px',
                      }}
                      title="Option retenue : Hors offre (exclu des statistiques)"
                    >
                      ➖ Hors offre
                    </span>
                  )}

                  {c1Status === 'not_published' && !inCycle2 && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#fff',
                        background: '#334155',
                        border: '1.5px solid #334155',
                        borderRadius: '6px',
                      }}
                      title="Option retenue : À ne pas publier"
                    >
                      🚫 À ne pas publier{valItem?.nonPublishReason ? ` · ${valItem.nonPublishReason}` : ''}
                    </span>
                  )}

                  {c1Status === 'closed_no_bookings' && !inCycle2 && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 9px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#fff',
                        background: '#dc2626',
                        border: '1.5px solid #dc2626',
                        borderRadius: '6px',
                      }}
                      title="Option retenue : Pas d'inscrit"
                    >
                      👥 Pas d&apos;inscrit
                    </span>
                  )}

                  {c1Status !== 'unpublished' && !isReadOnly && !isPastLocked && onSetSlotCycle1Action && (
                    <button
                      type="button"
                      className="fbtn"
                      style={{
                        margin: 0,
                        padding: '5px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color:
                          confirmResetSlot?.date === selectedDate && confirmResetSlot.idx === idx
                            ? '#fff'
                            : '#475569',
                        background:
                          confirmResetSlot?.date === selectedDate && confirmResetSlot.idx === idx
                            ? '#475569'
                            : '#fff',
                        border: '1.5px solid #94a3b8',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        if (activeSlotReasonIdx === idx) setActiveSlotReasonIdx(null);
                        setConfirmResetSlot(prev =>
                          prev?.date === selectedDate && prev.idx === idx
                            ? null
                            : { date: selectedDate, idx }
                        );
                      }}
                      title="Annuler le choix actuel et remettre ce créneau en attente (confirmation demandée)"
                    >
                      ↩
                    </button>
                  )}

                  {onOpenObservationModal && (isPast || isReadOnly || Boolean(slotObs)) && (
                    <button
                      type="button"
                      className="fbtn"
                      style={{
                        margin: 0,
                        padding: '5px 8px',
                        fontSize: '0.72rem',
                        fontWeight: slotObs ? 800 : 700,
                        color: slotObs
                          ? slotObs.status === 'cancelled'
                            ? '#b91c1c'
                            : '#047857'
                          : '#0369a1',
                        background: slotObs
                          ? slotObs.status === 'cancelled'
                            ? '#fee2e2'
                            : '#dcfce7'
                          : '#f0f9ff',
                        border: slotObs
                          ? slotObs.status === 'cancelled'
                            ? '1.5px solid #f87171'
                            : '1.5px solid #34d399'
                          : '1px solid #bae6fd',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onClick={() =>
                        onOpenObservationModal({
                          dateStr: selectedDate,
                          slotKey,
                          slotStart: displayStart,
                          slotEnd: displayEnd,
                          isCustom: x.isCustom,
                          customTitle: x.title,
                          maxChars: slotMaxChars,
                          primaryInstructor,
                          secondaryInstructor,
                          defaultStatus:
                            c1Status === 'closed_no_bookings' ||
                            c1Status === 'not_published' ||
                            c2Status === 'cancelled_weather'
                              ? 'cancelled'
                              : 'realized',
                          defaultCancellationReason:
                            c1Status === 'closed_no_bookings'
                              ? 'no_clients'
                              : c1Status === 'not_published'
                              ? 'instructor'
                              : c2Status === 'cancelled_weather'
                              ? 'wind_low'
                              : undefined,
                          defaultCancellationNote: valItem?.nonPublishReason,
                          defaultMonoCount: effectiveMono,
                          defaultBiCount: effectiveBi,
                          defaultParticipantsCount: effectivePeople,
                        })
                      }
                      title={
                        slotObs
                          ? `Consulter / modifier le REX (${slotObs.status === 'cancelled' ? slotObsReasonInfo?.shortLabel || 'Annulé' : 'Réalisé'})`
                          : 'Saisir le REX terrain (chars sortis, météo réelle, annulation)'
                      }
                    >
                      <span>📝</span>
                      <span>{slotObs ? 'REX ✓' : 'REX'}</span>
                    </button>
                  )}
                </div>

                {/* Horaire Cycle 1 / Cycle 2 + Repositionnement direct */}
                <div style={{ minWidth: '145px', textAlign: 'right' }}>
                  {isShifted && (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', textDecoration: 'line-through', fontWeight: 700 }}>
                      C1 : {pubDisplayStart} - {pubDisplayEnd}
                    </div>
                  )}

                  {inlineEdit && inlineEdit.date === selectedDate && inlineEdit.idx === idx ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: '#fff',
                        border: '1.5px solid #0284c7',
                        borderRadius: '8px',
                        padding: '4px 6px',
                      }}
                    >
                      <input
                        type="time"
                        value={inlineEdit.start}
                        onChange={e => setInlineEdit({ ...inlineEdit, start: e.target.value })}
                        style={{ fontSize: '0.82rem', fontWeight: 800, padding: '2px 4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                      <span style={{ fontWeight: 800, color: '#64748b' }}>–</span>
                      <input
                        type="time"
                        value={inlineEdit.end}
                        onChange={e => setInlineEdit({ ...inlineEdit, end: e.target.value })}
                        style={{ fontSize: '0.82rem', fontWeight: 800, padding: '2px 4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveInlineSlotEdit(idx)}
                        style={{
                          background: '#16a34a',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '5px',
                          padding: '4px 7px',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                        title="Valider ce repositionnement Cycle 1"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInlineEdit(null);
                          setSlotAdjustError(null);
                        }}
                        style={{
                          background: '#f1f5f9',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          padding: '4px 7px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        title="Annuler"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          fontSize: '1.2rem',
                          fontWeight: 900,
                          letterSpacing: '-0.02em',
                          color:
                            c2Status === 'cancelled_weather' || c1Status === 'closed_no_bookings'
                              ? '#991b1b'
                              : c1Status === 'excluded'
                              ? '#94a3b8'
                              : c1Status === 'not_published'
                              ? '#475569'
                              : inCycle2
                              ? '#14532d'
                              : c1Status === 'published'
                              ? '#0369a1'
                              : '#0f172a',
                          textDecoration:
                            c2Status === 'cancelled_weather' ||
                            c1Status === 'not_published' ||
                            c1Status === 'excluded' ||
                            c1Status === 'closed_no_bookings'
                              ? 'line-through'
                              : 'none',
                        }}
                      >
                        {displayStart} - {displayEnd}
                      </div>

                      {(() => {
                        const hasC2Act = hasCycle2Activity(valItem, effectiveChars, slotObs);
                        const isWithin48h = x.a - Date.now() / 60000 < 48 * 60;
                        const isClosedOrExcluded =
                          c1Status === 'closed_no_bookings' ||
                          c1Status === 'not_published' ||
                          c1Status === 'excluded' ||
                          c2Status === 'cancelled_weather' ||
                          c2Status === 'merged' ||
                          c2Status === 'realized';
                        if (isReadOnly || isPastLocked || isClosedOrExcluded) return null;
                        const canAdjust = !hasC2Act && !isWithin48h;
                        if (canAdjust) {
                          return (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                              <button
                                type="button"
                                onClick={() => handleShiftSlotTime(idx, -15)}
                                style={{
                                  background: '#fff',
                                  color: '#334155',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '5px',
                                  padding: '2px 6px',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                                title="Avancer le créneau de 15 minutes (autorisé jusqu’à H−48h si 0 inscrit)"
                              >
                                −15m
                              </button>
                              <button
                                type="button"
                                onClick={() => handleShiftSlotTime(idx, 15)}
                                style={{
                                  background: '#fff',
                                  color: '#334155',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '5px',
                                  padding: '2px 6px',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                                title="Décaler le créneau de 15 minutes (autorisé jusqu’à H−48h si 0 inscrit)"
                              >
                                +15m
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSlotAdjustError(null);
                                  setInlineEdit({
                                    date: selectedDate,
                                    idx,
                                    start: displayStart.replace('h', ':'),
                                    end: displayEnd.replace('h', ':'),
                                  });
                                }}
                                style={{
                                  background: '#f8fafc',
                                  color: '#0369a1',
                                  border: '1px solid #bae6fd',
                                  borderRadius: '5px',
                                  padding: '2px 7px',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                                title="Saisir l'heure exacte début/fin (autorisé jusqu’à H−48h si 0 inscrit)"
                              >
                                🕒 Ajuster
                              </button>
                            </div>
                          );
                        }
                        const lockLabel =
                          effectiveChars > 0
                            ? `🔒 ≥ 1 inscrit (${effectiveChars})`
                            : hasC2Act
                            ? '🔒 Activité Cycle 2'
                            : '🔒 Verrouillé < 48h';
                        const lockTitle =
                          effectiveChars > 0
                            ? 'Ajustement horaire Cycle 1 bloqué : au moins 1 char est déjà inscrit sur ce créneau'
                            : hasC2Act
                            ? 'Ajustement horaire Cycle 1 bloqué : activité Cycle 2 enregistrée'
                            : 'Ajustement horaire Cycle 1 autorisé uniquement jusqu’à 48h avant le début de la séance';
                        return (
                          <div
                            style={{
                              marginTop: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 7px',
                              borderRadius: '5px',
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#64748b',
                              fontSize: '0.66rem',
                              fontWeight: 800,
                            }}
                            title={lockTitle}
                          >
                            {lockLabel}
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {slotAdjustError &&
                    slotAdjustError.date === selectedDate &&
                    slotAdjustError.idx === idx && (
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '3px 7px',
                          borderRadius: '5px',
                          background: '#fef2f2',
                          border: '1px solid #fca5a5',
                          color: '#b91c1c',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          textAlign: 'left',
                        }}
                      >
                        ⛔ {slotAdjustError.message}
                      </div>
                    )}
                </div>
              </div>
            </div>

              {confirmResetSlot?.date === selectedDate &&
                confirmResetSlot.idx === idx &&
                !isReadOnly &&
                !isPastLocked &&
                onSetSlotCycle1Action && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: hasC2Activity ? '#fef2f2' : '#fffbeb',
                      border: hasC2Activity ? '1.5px solid #fca5a5' : '1.5px solid #fcd34d',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {hasC2Activity ? (
                      <>
                        <span style={{ color: '#991b1b', fontWeight: 800 }}>
                          ⛔ Retour en attente impossible directement : ce créneau a déjà{' '}
                          {effectiveChars > 0
                            ? `${effectiveChars} char(s) inscrit(s)`
                            : slotObs
                            ? 'un REX enregistré'
                            : 'une décision Cycle 2 ou un 2ᵉ moniteur'}
                          . Modifiez ou annulez d’abord depuis Cycle 2.
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirmResetSlot(null)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid #fca5a5',
                            background: '#fff',
                            color: '#991b1b',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Compris
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ color: '#92400e', fontWeight: 800 }}>
                          ⚠️ Confirmer l’annulation de la décision «{' '}
                          {c1Status === 'published'
                            ? 'À publier'
                            : c1Status === 'excluded'
                            ? 'Hors offre'
                            : c1Status === 'not_published'
                            ? 'À ne pas publier'
                            : "Pas d'inscrit"}
                          {' » et remettre ce créneau en attente ?'}
                        </span>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmResetSlot(null);
                              onSetSlotCycle1Action(focusData, sessItem, 'reset');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              background: '#d97706',
                              color: '#fff',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            ✓ Confirmer le retour
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmResetSlot(null)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              background: '#fff',
                              color: '#475569',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            ✕ Garder
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

              {isPickingReason && onSetSlotCycle1Action && (
                <div
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#fff',
                    border: '1.5px solid #475569',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#0f172a' }}>
                      🚫 Pourquoi ne pas publier ce créneau ({displayStart} - {displayEnd}) ?
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveSlotReasonIdx(null)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#64748b',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ✕ Fermer
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {availableNonPublishReasons.map(reason => {
                      const isCurrent = c1Status === 'not_published' && valItem?.nonPublishReason === reason;
                      return (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => {
                            onSetSlotCycle1Action(focusData, sessItem, 'not_published', reason);
                            setActiveSlotReasonIdx(null);
                          }}
                          style={{
                            padding: '5px 9px',
                            borderRadius: '6px',
                            border: isCurrent ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                            background: isCurrent ? '#334155' : '#f8fafc',
                            color: isCurrent ? '#fff' : '#1e293b',
                            fontSize: '0.73rem',
                            fontWeight: isCurrent ? 800 : 700,
                            cursor: 'pointer',
                          }}
                        >
                          {reason}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setActiveSlotReasonIdx(null);
                        if (onOpenObservationModal) {
                          onOpenObservationModal({
                            dateStr: selectedDate,
                            slotKey,
                            slotStart: displayStart,
                            slotEnd: displayEnd,
                            isCustom: x.isCustom,
                            customTitle: x.title,
                            maxChars: slotMaxChars,
                            primaryInstructor,
                            secondaryInstructor,
                            forceIntent: true,
                            defaultStatus: 'cancelled',
                            defaultCancellationReason: 'no_clients',
                          });
                        } else {
                          onSetSlotCycle1Action(focusData, sessItem, 'close_no_bookings');
                        }
                      }}
                      style={{
                        padding: '5px 9px',
                        borderRadius: '6px',
                        border: c1Status === 'closed_no_bookings' ? '1.5px solid #991b1b' : '1px solid #fca5a5',
                        background: c1Status === 'closed_no_bookings' ? '#dc2626' : '#fef2f2',
                        color: c1Status === 'closed_no_bookings' ? '#fff' : '#b91c1c',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ⛔ Pas d&apos;inscrit (Vie 2)
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={customSlotReasonInput}
                      onChange={e => setCustomSlotReasonInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customSlotReasonInput.trim()) {
                          e.preventDefault();
                          const trimmed = customSlotReasonInput.trim();
                          onAddCustomNonPublishReason?.(trimmed);
                          onSetSlotCycle1Action(focusData, sessItem, 'not_published', trimmed);
                          setCustomSlotReasonInput('');
                          setActiveSlotReasonIdx(null);
                        }
                      }}
                      placeholder="Ajouter une autre raison (sauvegardée pour les stats)..."
                      style={{
                        flex: '1 1 200px',
                        padding: '5px 9px',
                        fontSize: '0.74rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                    <button
                      type="button"
                      disabled={!customSlotReasonInput.trim()}
                      onClick={() => {
                        const trimmed = customSlotReasonInput.trim();
                        if (!trimmed) return;
                        onAddCustomNonPublishReason?.(trimmed);
                        onSetSlotCycle1Action(focusData, sessItem, 'not_published', trimmed);
                        setCustomSlotReasonInput('');
                        setActiveSlotReasonIdx(null);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: 'none',
                        background: customSlotReasonInput.trim() ? '#0284c7' : '#cbd5e1',
                        color: '#fff',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: customSlotReasonInput.trim() ? 'pointer' : 'not-allowed',
                      }}
                    >
                      + Ajouter &amp; Appliquer
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        });

        const valRecord = validations[selectedDate];
        const unattachedArchivedItems = (valRecord?.items || []).filter(
          item => !matchedValKeys.has(item.k)
        );

        return (
          <>
            {renderedSlots}

            {unattachedArchivedItems.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                  📜 Autres séances enregistrées dans l&apos;archive :
                </div>
                {unattachedArchivedItems.map((archivedItem, aIdx) => {
                  const isArchValid = archivedItem.status !== 'rejected';
                  const archChars = getValidationItemChars(archivedItem).totalChars;
                  return (
                    <div
                      key={`archived-${aIdx}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        marginBottom: '6px',
                        backgroundColor: isArchValid ? '#f0fdf4' : '#fef2f2',
                        border: `1.5px solid ${isArchValid ? '#86efac' : '#fca5a5'}`,
                        borderLeft: `5px solid ${isArchValid ? '#16a34a' : '#dc2626'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            background: isArchValid ? '#16a34a' : '#dc2626',
                            color: '#fff',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: 900,
                            fontSize: '0.74rem',
                          }}
                        >
                          {isArchValid ? '✓ ARCHIVE' : '✕ ARCHIVE ANNULÉE'}
                        </span>
                        {archChars > 0 && (
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#166534' }}>
                            · {archChars} char{archChars > 1 ? 's' : ''}
                          </span>
                        )}
                        {archivedItem.rejectReason && (
                          <span style={{ fontSize: '0.72rem', color: '#991b1b', fontWeight: 700 }}>
                            ({archivedItem.rejectReason})
                          </span>
                        )}
                        {archivedItem.customTitle && (
                          <span style={{ fontSize: '0.72rem', color: '#0369a1', fontWeight: 700 }}>
                            {archivedItem.customTitle}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 900,
                          color: isArchValid ? '#14532d' : '#991b1b',
                          textDecoration: isArchValid ? 'none' : 'line-through',
                        }}
                      >
                        {archivedItem.actualStart || archivedItem.s} - {archivedItem.actualEnd || archivedItem.e}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeBookingSlot && (
              <SlotBookingsModal
                isOpen={Boolean(activeBookingSlot)}
                onClose={() => setActiveBookingSlot(null)}
                dateStr={selectedDate}
                slotKey={activeBookingSlot.slotKey}
                slotStart={activeBookingSlot.slotStart}
                slotEnd={activeBookingSlot.slotEnd}
                slotTitle={activeBookingSlot.slotTitle}
                bookings={bookingsMap[buildReservationKey(selectedDate, activeBookingSlot.slotKey)] || []}
                onSaveBookings={(sKey, list) => {
                  onSaveSlotBookings?.(
                    selectedDate,
                    sKey,
                    activeBookingSlot.slotStart,
                    activeBookingSlot.slotEnd,
                    list
                  );
                }}
                isReadOnly={isReadOnly || isPastLocked}
                maxChars={activeBookingSlot.maxChars}
                primaryInstructor={activeBookingSlot.primaryInstructor}
                secondaryInstructor={activeBookingSlot.secondaryInstructor}
                secondaryQualification={activeBookingSlot.secondaryQualification}
                secondaryActualEnd={activeBookingSlot.secondaryActualEnd}
                secondaryFormula={activeBookingSlot.secondaryFormula}
              />
            )}
          </>
        );
      })()}

      {!allSlots.length && (
        <div className="m">Aucune séance possible pour cette journée.</div>
      )}

      {/* Custom slots manager */}
      {(() => {
        const protectedSlotReasons: Array<{ start: string; end: string; reason: string }> = [];
        let hasAnyLockedSlot = false;
        allSlots.forEach((_, idx) => {
          const ctx = resolveSlotCycle2Context(idx);
          if (!ctx) return;
          const sHHMM = ctx.startTimeStr.replace('h', ':');
          const eHHMM = ctx.endTimeStr.replace('h', ':');
          if (ctx.effectiveChars > 0) {
            protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: `≥ 1 inscrit (${ctx.effectiveChars})` });
            hasAnyLockedSlot = true;
          } else if (ctx.slotObs) {
            protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: 'REX enregistré' });
            hasAnyLockedSlot = true;
          } else if (ctx.hasC2Act || ctx.isClosedOrExcluded) {
            protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: 'Décision C1/C2 enregistrée' });
            hasAnyLockedSlot = true;
          } else if (ctx.isWithin48h) {
            protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: '< 48h avant début' });
            hasAnyLockedSlot = true;
          }
        });
        return (
          <CustomSlotsManager
            dateStr={selectedDate}
            settings={settings}
            windList={windList}
            customSlotsMap={customSlotsMap}
            onUpdateCustomSlots={onUpdateCustomSlots}
            defaultSlots={calculatedDefaultSlots}
            isOpenControlled={isCustomSlotsOpen}
            onToggleOpen={() => setIsCustomSlotsOpen(!isCustomSlotsOpen)}
            isReadOnly={isReadOnly || isPastLocked}
            protectedSlotReasons={protectedSlotReasons}
            dayResetLockReason={hasAnyLockedSlot ? 'créneaux < 48h ou avec activité/décision' : null}
          />
        );
      })()}

      <div className="m" style={{ marginTop: '12px' }}>
        ☀ Lever {R.lev} · Coucher {R.cou} · lumière retenue {R.lum}
      </div>
      <div className="m">
        🌙 {R.ph} · Lever {R.lr} · Coucher {R.ls}
      </div>

      {ad.length > 0 && (
        <div className="m">
          🌡 Basse pression : +{Math.round(Math.max(...ad) * 100)} cm ajoutés aux hauteurs d'eau (correction automatique)
        </div>
      )}
    </div>
  );
};
