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
  kOf,
  lc,
  maxDs,
  minDs,
  plan,
  summarizeSlotsWind,
  sw,
  tdy,
  toU,
  VC,
  wstat,
  wtxt,
} from '../utils/tides';
import { AgendaBookingItem } from '../utils/firebaseSync';
import {
  buildReservationKey,
  Cycle2ActionPayload,
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
  parseTimeMinutes,
  SECONDARY_INSTRUCTOR_PRESETS,
} from '../utils/cycleHelpers';
import { CalendarGrid } from './CalendarGrid';
import { CurveChart } from './CurveChart';
import { MarnageChart } from './MarnageChart';
import { WindguruTable } from './WindguruTable';
import { WindsUpBaliseCard } from './WindsUpBaliseCard';
import { SlotBookingsModal } from './SlotBookingsModal';
import {
  CreateCustomSlotOptions,
  CustomSlotsManager,
  SlotActivityConflict,
} from './CustomSlotsManager';
import {
  classifyWindSector,
  WindSectorInfo,
} from '../utils/beachOrientation';
import { CALENDAR_INDICATOR_COLORS, getFrenchHolidayInfo, HOLIDAY_ZONE_COLORS } from '../utils/frenchHolidays';
import { CANCELLATION_REASONS_INFO } from '../utils/statisticsEngine';

interface FocusTabProps {
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  validations: ValidationsMap;
  bookingsMap?: Record<string, AgendaBookingItem[]>;
  onSaveSlotBookings?: (
    ds: string,
    slotKey: string,
    slotStart: string,
    slotEnd: string,
    bookings: AgendaBookingItem[]
  ) => void;
  onCycle2Action?: (record: DayFocusData, slot: SessionItem, payload: Cycle2ActionPayload) => void;
  onSelectDayInCalendar: (ds: string) => void;
  customSlotsMap?: CustomSlotsMap;
  onUpdateCustomSlots?: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  onCreateAndPublishCustomSlot?: (
    dateStr: string,
    slot: CustomSlot,
    options?: CreateCustomSlotOptions
  ) => void;
  onValidateDay?: (
    dateStr: string,
    focusData: DayFocusData,
    mode: 'all' | 'not_published',
    reason?: string
  ) => void;
  onClearValidation?: (dateStr: string) => void;
  onAddCustomNonPublishReason?: (reason: string) => void;
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
  isReadOnly?: boolean;
  focusDate?: string;
  onFocusDateChange?: (ds: string) => void;
  observations?: SlotObservation[];
}

export const FocusTab: React.FC<FocusTabProps> = ({
  year,
  month,
  onPrevMonth,
  onNextMonth,
  settings,
  onUpdateSettings: rawOnUpdateSettings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations,
  bookingsMap = {},
  onSaveSlotBookings: rawOnSaveSlotBookings,
  onCycle2Action: rawOnCycle2Action,
  onSelectDayInCalendar,
  customSlotsMap = {},
  onUpdateCustomSlots,
  onCreateAndPublishCustomSlot,
  onOpenObservationModal,
  onOpenExpressRex,
  isReadOnly = false,
  focusDate: propFocusDate,
  onFocusDateChange,
  observations = [],
}) => {
  const onCycle2Action = isReadOnly ? undefined : rawOnCycle2Action;
  const onSaveSlotBookings = isReadOnly ? undefined : rawOnSaveSlotBookings;
  const onUpdateSettings = (s: Partial<AppSettings>) => {
    if (isReadOnly) return;
    rawOnUpdateSettings(s);
  };

  const tdRaw = tdy();
  const td = tdRaw < minDs ? minDs : tdRaw > maxDs ? maxDs : tdRaw;
  const [internalFocusDate, setInternalFocusDate] = useState<string>(td);

  // États UI inline pour les actions tactiques Cycle 2 (zéro window.prompt/window.alert)
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
  const [openTool, setOpenTool] = useState<{
    slotKey: string;
    mode: 'double_instructor';
  } | null>(null);
  const [doubleName, setDoubleName] = useState<string>('Youenn');
  const [doubleQual, setDoubleQual] = useState<'CQP' | 'DE_BPJEPS'>('CQP');
  const [doubleAddChars, setDoubleAddChars] = useState<number>(8);
  const [doubleEnd, setDoubleEnd] = useState<string>('');
  const [doubleFormula, setDoubleFormula] = useState<string>('');
  const [isCustomSlotsOpen, setIsCustomSlotsOpen] = useState<boolean>(false);
  const [confirmResetC2SlotKey, setConfirmResetC2SlotKey] = useState<string | null>(null);
  const [confirmPurgeOrphanKey, setConfirmPurgeOrphanKey] = useState<string | null>(null);

  const handleSelectCustomDate = (ds: string) => {
    setInternalFocusDate(ds);
    onFocusDateChange?.(ds);
    setOpenTool(null);
    setConfirmResetC2SlotKey(null);
    setConfirmPurgeOrphanKey(null);
  };

  const targetDs = propFocusDate || internalFocusDate;
  const currentFocus = dayFocus(targetDs, settings, tideW, first, last, windList, customSlotsMap);
  const currentDs = currentFocus.ds;

  const [cy, cm0, cd] = currentDs.split('-').map(Number);
  const cm = cm0 - 1;
  const P = dayInfo(cy, cm, cd, settings, tideW, first, last);
  const coef = COEF[currentDs];
  const dayStartU = toU(cy, cm, cd, 0);
  const dayEndU = toU(cy, cm, cd + 1, 0);
  const R = dayRow(cy, cm, cd, settings, EX, tideW, first, last, windList);
  const ad = EX.filter(p => p.t >= dayStartU && p.t < dayEndU && p.adj).map(p => p.adj as number);
  const holiday = getFrenchHolidayInfo(currentDs);

  const valRecordForDay = validations[currentFocus.ds];
  const cycle1ValidatedSlots = (() => {
    const matchedValKeys = new Set<string>();
    const out: Array<{
      x: SessionItem;
      slotKey: string;
      valItem: ReturnType<typeof findMatchingValidationItem>;
      isFromCurrentList: boolean;
    }> = [];
    for (const x of currentFocus.list) {
      const startTimeStr = lc(x.a, currentFocus.y, currentFocus.m, currentFocus.d);
      const endTimeStr = lc(x.b, currentFocus.y, currentFocus.m, currentFocus.d);
      const slotKey = kOf(x);
      const valItem = findMatchingValidationItem(
        valRecordForDay,
        slotKey,
        startTimeStr,
        endTimeStr,
        matchedValKeys
      );
      if (valItem) {
        matchedValKeys.add(valItem.k);
      }
      const effectiveBookingKey =
        valItem && (bookingsMap[buildReservationKey(currentFocus.ds, valItem.k)]?.length ?? 0) > 0
          ? valItem.k
          : slotKey;
      const bookingSummary = getSlotBookingsSummary(
        bookingsMap[buildReservationKey(currentFocus.ds, effectiveBookingKey)] || []
      );
      const c1Status = getEffectiveCycle1Status(valItem);
      const inCycle2 = hasCycle2Trigger(valItem, bookingSummary.totalChars);

      if (c1Status === 'published' || inCycle2) {
        out.push({ x, slotKey, valItem, isFromCurrentList: true });
      }
    }

    // Conserver aussi les séances déjà validées en Cycle 1 / engagées en Cycle 2
    // même si un recalcul barométrique/marée ultérieur les a sorties de la liste auto du jour
    const nowMin = Date.now() / 6e4;
    for (const valItem of valRecordForDay?.items || []) {
      if (matchedValKeys.has(valItem.k)) continue;
      const bookingSummary = getSlotBookingsSummary(
        bookingsMap[buildReservationKey(currentFocus.ds, valItem.k)] || []
      );
      const c1Status = getEffectiveCycle1Status(valItem);
      const inCycle2 = hasCycle2Trigger(valItem, bookingSummary.totalChars);
      if (c1Status !== 'published' && !inCycle2) continue;

      const startMin = parseTimeMinutes(valItem.actualStart || valItem.publishedStart || valItem.s);
      const endMin = parseTimeMinutes(valItem.actualEnd || valItem.publishedEnd || valItem.e);
      if (startMin === null || endMin === null) continue;

      const a = toU(cy, cm, cd, startMin);
      const b = toU(cy, cm, cd, endMin);
      const ok = sw(a, b, settings, windList);
      const st = wstat(a, b, windList);
      const synthItem: SessionItem = {
        a,
        b,
        opt: valItem.k.endsWith('o') || valItem.k.endsWith('oc'),
        isCustom: valItem.k.endsWith('c'),
        customTitle: valItem.customTitle || 'Validé C1 · hors recalcul auto (marée/pression)',
        ok,
        st,
        txt: st ? wtxt(st) : '',
        over: 0,
        lim: '',
        side: '',
        past: currentFocus.ds === tdRaw && b < nowMin,
      };
      out.push({ x: synthItem, slotKey: valItem.k, valItem, isFromCurrentList: false });
    }

    out.sort((p, q) => p.x.a - q.x.a);
    return out;
  })();

  const activeOpenSlots = cycle1ValidatedSlots
    .filter(({ valItem }) => valItem?.status !== 'rejected' && valItem?.cycle2Status !== 'cancelled_weather')
    .map(item => item.x);

  const verdictDisplay = (() => {
    // Si la journée est déjà gérée en Cycle 1 / Cycle 2, le verdict porte sur les vrais créneaux ouverts
    if (valRecordForDay || cycle1ValidatedSlots.length > 0) {
      if (activeOpenSlots.length === 0) {
        const hasWeatherCancel = (valRecordForDay?.items || []).some(
          it => it.cycle2Status === 'cancelled_weather'
        );
        return {
          bg: hasWeatherCancel ? VC.r[0] : '#64748b',
          title: hasWeatherCancel ? 'JOURNÉE ANNULÉE' : 'AUCUNE SÉANCE OUVERTE',
          why: hasWeatherCancel
            ? 'Séances annulées pour raison météo'
            : currentFocus.list.length > 0
            ? `Aucun créneau ouvert (${currentFocus.list.length} créneau${currentFocus.list.length > 1 ? 'x' : ''} fermé${currentFocus.list.length > 1 ? 's' : ''} / hors offre)`
            : 'Aucune séance prévue ce jour-là',
          rng: currentFocus.rng,
          glob: currentFocus.glob,
        };
      }

      const isTodayFocus = currentFocus.ds === tdy();
      const liveOpen = isTodayFocus ? activeOpenSlots.filter(x => !x.past) : activeOpenSlots;

      if (isTodayFocus && liveOpen.length === 0) {
        const { rng, glob } = summarizeSlotsWind(activeOpenSlots);
        return {
          bg: VC.x[0],
          title: VC.x[1],
          why: `Plus de séance à venir aujourd'hui (${activeOpenSlots.length} séance${activeOpenSlots.length > 1 ? 's' : ''} ouverte${activeOpenSlots.length > 1 ? 's' : ''} ce jour)`,
          rng,
          glob,
        };
      }

      const nOK = liveOpen.filter(x => x.ok === true).length;
      const nBad = liveOpen.filter(x => x.ok === false).length;
      const hasW = liveOpen.some(x => x.ok !== null);
      const { rng, glob } = summarizeSlotsWind(liveOpen);
      const countLabel =
        isTodayFocus && liveOpen.length < activeOpenSlots.length
          ? `${liveOpen.length} séance${liveOpen.length > 1 ? 's' : ''} restante${liveOpen.length > 1 ? 's' : ''} (sur ${activeOpenSlots.length})`
          : `${liveOpen.length} séance${liveOpen.length > 1 ? 's' : ''}`;

      let k: 'g' | 'o' | 'r' = 'g';
      let why = '';
      if (!hasW) {
        k = 'o';
        why = `${countLabel} · météo indisponible, vent non vérifié`;
      } else if (nOK === 0) {
        k = 'r';
        why = `Vent hors plage sur ${liveOpen.length > 1 ? `les ${liveOpen.length} séances` : 'la séance'} (${rng})`;
      } else if (nOK >= settings.fmin && nBad === 0) {
        k = 'g';
        why = `${countLabel} · vent ${rng}`;
      } else {
        k = 'o';
        why = `${nOK} séance${nOK > 1 ? 's' : ''} avec vent OK sur ${liveOpen.length}${nBad ? ` · vent hors plage sur ${nBad}` : ''} (${rng})`;
      }

      return { bg: VC[k][0], title: VC[k][1], why, rng, glob };
    }

    // Journée non encore validée en Cycle 1 : verdict théorique habituel
    return {
      bg: VC[currentFocus.k][0],
      title: VC[currentFocus.k][1],
      why: currentFocus.why,
      rng: currentFocus.rng,
      glob: currentFocus.glob,
    };
  })();

  const dayWindSectors: WindSectorInfo[] = (() => {
    const seen = new Map<string, WindSectorInfo>();
    const sectorSource = activeOpenSlots.length > 0 ? activeOpenSlots : currentFocus.list;
    for (const s of sectorSource) {
      if (s.st) {
        const info = classifyWindSector(s.st.dir);
        if (info && !seen.has(info.sector)) seen.set(info.sector, info);
      }
    }
    if (seen.size === 0) {
      for (const wp of windList) {
        if (wp.t >= dayStartU + 480 && wp.t <= dayStartU + 1200) {
          const info = classifyWindSector(wp.a);
          if (info && !seen.has(info.sector)) seen.set(info.sector, info);
        }
      }
    }
    return [...seen.values()];
  })();
  const hasVentDeTerre = dayWindSectors.some(s => s.sector === 'terre');

  const formatWd = (ds: string) => {
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  const renderSessRow = (
    f: DayFocusData,
    x: SessionItem,
    key: string,
    preMatchedValItem?: ReturnType<typeof findMatchingValidationItem>,
    validatedMergeKeys?: Set<string>,
    isOrphan = false,
    overlapsActiveSlot = false
  ) => {
    const startTimeStr = lc(x.a, f.y, f.m, f.d);
    const endTimeStr = lc(x.b, f.y, f.m, f.d);
    const slotKey = kOf(x);
    const valRecord = validations[f.ds];

    const valItem =
      preMatchedValItem !== undefined
        ? preMatchedValItem
        : findMatchingValidationItem(valRecord, slotKey, startTimeStr, endTimeStr);
    const effectiveBookingKey =
      valItem && (bookingsMap[buildReservationKey(f.ds, valItem.k)]?.length ?? 0) > 0
        ? valItem.k
        : slotKey;
    const resKey = buildReservationKey(f.ds, effectiveBookingKey);
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

    const displayStart = normalizeSlotTimeHHhMM(valItem?.actualStart || startTimeStr);
    const displayEnd = normalizeSlotTimeHHhMM(valItem?.actualEnd || endTimeStr);
    const pubDisplayStart = normalizeSlotTimeHHhMM(valItem?.publishedStart || startTimeStr);
    const pubDisplayEnd = normalizeSlotTimeHHhMM(valItem?.publishedEnd || endTimeStr);
    const normT = (v?: string) => (v || '').replace('h', ':');
    const slotObs = observations
      .filter(
        o =>
          o.ds === f.ds &&
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

    const isToolOpen = (
      mode: 'double_instructor'
    ) => openTool?.slotKey === slotKey && openTool.mode === mode;

    const cardBg =
      c2Status === 'cancelled_weather' || c1Status === 'closed_no_bookings'
        ? '#fef2f2'
        : c2Status === 'merged'
        ? '#faf5ff'
        : c2Status === 'shifted'
        ? '#fffbeb'
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
        : c2Status === 'merged'
        ? '2px solid #a855f7'
        : c2Status === 'shifted'
        ? '2px solid #f59e0b'
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
        : c2Status === 'merged'
        ? '#7c3aed'
        : c2Status === 'shifted'
        ? '#d97706'
        : c1Status === 'excluded'
        ? '#94a3b8'
        : c1Status === 'not_published'
        ? '#475569'
        : inCycle2
        ? '#16a34a'
        : c1Status === 'published'
        ? '#0284c7'
        : '#94a3b8';

    const isPastDay = f.ds < tdRaw;
    const isTrueCustom = Boolean(x.isCustom && !x.isAdapted && !x.isUnchangedTide);
    const isAdapted = Boolean(x.isAdapted);

    let chip: React.ReactNode = isPastDay ? null : <span className="fchip">VENT ?</span>;
    if (isPastDay) {
      if (isTrueCustom) {
        chip = <span className="fchip">SUR MESURE</span>;
      } else if (isAdapted) {
        chip = <span className="fchip">ADAPTÉ</span>;
      }
    } else if (isTrueCustom) {
      chip = (
        <span className={`fchip ${x.ok === true ? 'fg' : x.ok === false ? 'fr' : 'fo'}`}>
          SUR MESURE · {x.ok === true ? 'VENT OK' : x.ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
        </span>
      );
    } else if (isAdapted) {
      chip = (
        <span className={`fchip ${x.ok === true ? 'fg' : x.ok === false ? 'fr' : 'fo'}`}>
          ADAPTÉ · {x.ok === true ? 'VENT OK' : x.ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
        </span>
      );
    } else if (x.opt) {
      chip = <span className="fchip fo">OPTIONNEL +{x.over} MIN</span>;
    } else if (x.ok === true) {
      chip = <span className="fchip fg">VENT OK</span>;
    } else if (x.ok === false) {
      chip = <span className="fchip fr">VENT HORS PLAGE</span>;
    }

    const sub = isTrueCustom
      ? x.customTitle || 'Créneau personnalisé'
      : isAdapted
      ? x.txt || 'Horaire adapté en Cycle 1'
      : x.opt
      ? `dépasse la contrainte ${
          x.lim === 'marée' ? 'de marée' : "d'heure du jour"
        } au ${x.side} · à ta discrétion`
      : x.txt || '';
    const slotWindSector = !isPastDay && x.st ? classifyWindSector(x.st.dir) : null;

    const orphanTargetKey = valItem?.k || slotKey;

    return (
      <div
        key={key}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '12px 16px',
          borderRadius: '10px',
          marginBottom: '10px',
          backgroundColor: isOrphan ? '#fffbeb' : cardBg,
          border: isOrphan ? '2px dashed #f59e0b' : cardBorder,
          borderLeft: `6px solid ${isOrphan ? '#d97706' : cardBarColor}`,
          boxShadow: inCycle2
            ? '0 2px 8px rgba(22, 163, 74, 0.10)'
            : '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        {isOrphan && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '7px 10px',
              borderRadius: '8px',
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              color: '#92400e',
              fontSize: '0.73rem',
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            <div>
              ⚠️ <strong>Ancien créneau orphelin (hors planning adapté actuel)</strong>
              {overlapsActiveSlot ? ' · chevauche un créneau adapté du jour' : ''} — conservé en base car il contenait encore des inscriptions.
            </div>
            {!isReadOnly && onCycle2Action && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {confirmPurgeOrphanKey === orphanTargetKey ? (
                  <>
                    <span style={{ color: '#991b1b', fontWeight: 800 }}>
                      Supprimer ce doublon{effectiveChars > 0 ? ` (${effectiveChars} ch.)` : ''} ?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onCycle2Action(f, x, { type: 'purge_orphan', valItemKey: orphanTargetKey });
                        setConfirmPurgeOrphanKey(null);
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: 'none',
                        background: '#dc2626',
                        color: '#fff',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Oui, supprimer
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPurgeOrphanKey(null)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                        color: '#334155',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeOrphanKey(orphanTargetKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: '1.5px solid #dc2626',
                      background: '#fff',
                      color: '#dc2626',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title="Retirer cet ancien créneau orphelin du planning et nettoyer ses inscriptions associées"
                  >
                    🗑️ Supprimer ce reliquat
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {/* GAUCHE : Statut Cycle 2, Jauge 12 chars, Moniteur */}
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
                      ? `REGROUPÉ ➔ ${valItem?.mergedLabel || 'autre créneau'}`
                      : c2Status === 'shifted'
                      ? `DÉCALÉ ${valItem?.shiftMinutes ? (valItem.shiftMinutes > 0 ? `+${valItem.shiftMinutes}` : valItem.shiftMinutes) + ' MIN' : ''}`
                      : c2Status === 'realized'
                      ? isShifted && valItem?.shiftMinutes
                        ? `🏁 CYCLE 2 · EFFECTUÉE (DÉCALÉE ${valItem.shiftMinutes > 0 ? `+${valItem.shiftMinutes}` : valItem.shiftMinutes} MIN)`
                        : isShifted
                        ? '🏁 CYCLE 2 · EFFECTUÉE (DÉCALÉE)'
                        : '🏁 CYCLE 2 · SÉANCE EFFECTUÉE'
                      : isShifted && valItem?.shiftMinutes
                      ? `CYCLE 2 · ACTIF (DÉCALÉ ${valItem.shiftMinutes > 0 ? `+${valItem.shiftMinutes}` : valItem.shiftMinutes} MIN)`
                      : c2Status === 'confirmed'
                      ? 'CYCLE 2 · CONFIRMÉ'
                      : 'CYCLE 2 · ACTIF'}
                  </span>
                </span>

                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: isOverCapacity ? '#fee2e2' : '#dcfce7',
                    border: isOverCapacity ? '1.5px solid #ef4444' : '1.5px solid #86efac',
                    color: isOverCapacity ? '#991b1b' : '#166534',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 900,
                  }}
                >
                  <span>🚗</span>
                  <span>
                    {effectiveChars} / {slotMaxChars} chars
                  </span>
                  {(effectiveMono > 0 || effectiveBi > 0) && (
                    <span style={{ fontWeight: 700, opacity: 0.85 }}>
                      ({effectiveMono} mono + {effectiveBi} bi · {effectivePeople} pilotes/pers.)
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
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.70rem',
                          fontWeight: 800,
                        }}
                      >
                        <span>👤</span>
                        <strong>{primaryInstructor}</strong>
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
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.70rem',
                            fontWeight: 800,
                          }}
                          title="2e moniteur affecté à ce créneau multi-moniteurs"
                        >
                          <span>👤</span>
                          <strong>
                            {secondaryInstructor}
                            {valItem?.secondaryQualification === 'CQP'
                              ? ` (CQP · +${valItem?.secondaryMaxChars ?? 8})`
                              : ` (+${valItem?.secondaryMaxChars ?? MAX_CHARS_PER_INSTRUCTOR})`}
                          </strong>
                          {valItem?.secondaryActualEnd && valItem.secondaryActualEnd !== displayEnd && (
                            <span style={{ opacity: 0.9 }}>· fin {valItem.secondaryActualEnd}</span>
                          )}
                          {valItem?.secondaryFormula && (
                            <span style={{ opacity: 0.9 }}>· {valItem.secondaryFormula}</span>
                          )}
                        </span>
                      )}
                    </>
                  );
                })()}
              </>
            ) : c1Status === 'published' ? (
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
                  fontSize: '0.74rem',
                }}
              >
                <span>⏳</span>
                <span>CYCLE 1 PUBLIÉ · Prêt pour Cycle 2</span>
              </span>
            ) : c1Status === 'excluded' ? (
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
                  fontSize: '0.74rem',
                }}
              >
                <span>➖</span>
                <span>HORS OFFRE (CYCLE 1) · EXCLU DES STATS</span>
              </span>
            ) : c1Status === 'not_published' ? (
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
                  fontSize: '0.74rem',
                }}
              >
                <span>🚫</span>
                <span>
                  À NE PAS PUBLIER (CYCLE 1){valItem?.nonPublishReason ? ` · ${valItem.nonPublishReason}` : ''}
                </span>
              </span>
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

            {chip}

            {slotWindSector && (
              <span
                title={slotWindSector.detail}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  background: slotWindSector.bg,
                  color: slotWindSector.fg,
                  border: `1px solid ${slotWindSector.bd}`,
                }}
              >
                🧭 {slotWindSector.label}
              </span>
            )}

            {slotObs && (
              <button
                type="button"
                onClick={() =>
                  onOpenObservationModal?.({
                    dateStr: currentDs,
                    slotKey,
                    slotStart: displayStart,
                    slotEnd: displayEnd,
                    isCustom: x.isCustom,
                    customTitle: x.customTitle,
                    maxChars: slotMaxChars,
                    primaryInstructor,
                    secondaryInstructor,
                  })
                }
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
                  cursor: onOpenObservationModal ? 'pointer' : 'default',
                }}
                title={`Cliquer pour consulter / modifier le REX${slotObs.author ? ` (${slotObs.author})` : ''}${slotObs.cancellationNote ? ` · ${slotObs.cancellationNote}` : slotObs.notes ? ` · ${slotObs.notes}` : ''}`}
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
              </button>
            )}

            {sub && (
              <small style={{ color: '#64748b', fontSize: '0.72rem' }}>
                {sub + (x.past ? ' · passée' : '')}
              </small>
            )}
          </div>

          {/* DROITE : Boutons Tactiques Cycle 2 + Horaire */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
              {(() => {
                const canEditSlotBookings = c1Status === 'published' || inCycle2;
                const hasTerminalC2Decision =
                  c2Status === 'realized' ||
                  c2Status === 'cancelled_weather' ||
                  c1Status === 'closed_no_bookings' ||
                  c2Status === 'merged';
                const showBookingsBtn =
                  c1Status !== 'excluded' &&
                  c1Status !== 'not_published' &&
                  (!hasTerminalC2Decision || c2Status === 'realized');
                if (!showBookingsBtn) return null;
                return (
                  <button
                    type="button"
                    className="fbtn"
                    disabled={!canEditSlotBookings}
                    style={{
                      margin: 0,
                      padding: '5px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      color: !canEditSlotBookings
                        ? '#94a3b8'
                        : effectiveChars > 0
                        ? '#166534'
                        : '#0369a1',
                      background: !canEditSlotBookings
                        ? '#f1f5f9'
                        : effectiveChars > 0
                        ? '#dcfce7'
                        : '#e0f2fe',
                      border: !canEditSlotBookings
                        ? '1px solid #cbd5e1'
                        : effectiveChars > 0
                        ? '1px solid #86efac'
                        : '1px solid #7dd3fc',
                      borderRadius: '6px',
                      cursor: canEditSlotBookings ? 'pointer' : 'not-allowed',
                      opacity: canEditSlotBookings ? 1 : 0.7,
                    }}
                    onClick={() => {
                      if (!canEditSlotBookings) return;
                      const bookingTitle = isShifted
                        ? `${x.customTitle ? `${x.customTitle} · ` : ''}C1 : ${pubDisplayStart}–${pubDisplayEnd}`
                        : x.customTitle;
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
                    title={
                      canEditSlotBookings
                        ? 'Ouvrir la fiche des inscriptions (facultatif)'
                        : 'Validez d’abord ce créneau « À publier » en Cycle 1 pour y saisir des inscriptions'
                    }
                  >
                    👥 Inscriptions ({effectiveChars}/{slotMaxChars})
                  </button>
                );
              })()}

              {!isReadOnly && onCycle2Action && (() => {
                const hasTerminalC2Decision =
                  c2Status === 'realized' ||
                  c2Status === 'cancelled_weather' ||
                  c1Status === 'closed_no_bookings' ||
                  c2Status === 'merged';
                return (
                  <>
                    {((!hasTerminalC2Decision &&
                      c1Status !== 'not_published' &&
                      c1Status !== 'excluded') ||
                      c2Status === 'realized') && (
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: c2Status === 'realized' ? '#166534' : '#fff',
                          background: c2Status === 'realized' ? '#dcfce7' : '#16a34a',
                          border: c2Status === 'realized' ? '1.5px solid #22c55e' : 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setOpenTool(null);
                          if (onOpenObservationModal) {
                            onOpenObservationModal({
                              dateStr: currentDs,
                              slotKey,
                              slotStart: displayStart,
                              slotEnd: displayEnd,
                              isCustom: x.isCustom,
                              customTitle: x.customTitle,
                              maxChars: slotMaxChars,
                              primaryInstructor,
                              secondaryInstructor,
                              forceIntent: true,
                              defaultStatus: 'realized',
                              defaultMonoCount:
                                effectiveMono > 0 || effectiveBi > 0 ? effectiveMono : effectiveChars,
                              defaultBiCount: effectiveBi,
                              defaultParticipantsCount: effectivePeople || effectiveChars,
                            });
                          } else {
                            onCycle2Action(f, x, {
                              type: 'realized',
                              monoCount:
                                effectiveMono > 0 || effectiveBi > 0 ? effectiveMono : effectiveChars,
                              biCount: effectiveBi,
                              pilotsCount: effectivePeople || effectiveChars,
                              instructor: 'Jérôme',
                            });
                          }
                        }}
                        title="Valider la séance effectuée et compléter le REX en un seul écran (chars, météo, marée)"
                      >
                        {c2Status === 'realized' ? '🏁 Séance effectuée ✓' : '✓ Séance effectuée'}
                      </button>
                    )}

                    {((!hasTerminalC2Decision && (c1Status === 'published' || inCycle2)) ||
                      c2Status === 'cancelled_weather') && (
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: c2Status === 'cancelled_weather' ? '#fff' : '#dc2626',
                          background: c2Status === 'cancelled_weather' ? '#dc2626' : '#fef2f2',
                          border: '1.5px solid #fca5a5',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setOpenTool(null);
                          if (onOpenObservationModal) {
                            const keptWeatherReason =
                              slotObs?.status === 'cancelled' &&
                              slotObs.cancellationReason &&
                              slotObs.cancellationReason !== 'no_clients' &&
                              slotObs.cancellationReason !== 'instructor'
                                ? slotObs.cancellationReason
                                : x.ok === false
                                ? 'wind_high'
                                : 'wind_low';
                            onOpenObservationModal({
                              dateStr: currentDs,
                              slotKey,
                              slotStart: displayStart,
                              slotEnd: displayEnd,
                              isCustom: x.isCustom,
                              customTitle: x.customTitle,
                              maxChars: slotMaxChars,
                              primaryInstructor,
                              secondaryInstructor,
                              forceIntent: true,
                              defaultStatus: 'cancelled',
                              defaultCancellationReason: keptWeatherReason,
                              defaultBookedParticipantsCount:
                                effectivePeople > 0 ? effectivePeople : undefined,
                            });
                          } else {
                            onCycle2Action(f, x, {
                              type: 'cancel_weather',
                              reason:
                                x.ok === false
                                  ? 'Vent trop fort / rafales'
                                  : 'Vent insuffisant (< 8 nds)',
                              rescheduledChars: 0,
                              lostChars: effectiveChars,
                            });
                          }
                        }}
                        title="Annuler en Vie 2 (météo, terrain...) et compléter le REX en un seul écran"
                      >
                        ⛔ Annuler (Vie 2)
                      </button>
                    )}

                    {((!hasTerminalC2Decision &&
                      (c1Status === 'published' || inCycle2) &&
                      effectiveChars === 0) ||
                      c1Status === 'closed_no_bookings') && (
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: c1Status === 'closed_no_bookings' ? '#fff' : '#991b1b',
                          background: c1Status === 'closed_no_bookings' ? '#dc2626' : '#fee2e2',
                          border: '1.5px solid #fca5a5',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setOpenTool(null);
                          if (onOpenObservationModal) {
                            onOpenObservationModal({
                              dateStr: currentDs,
                              slotKey,
                              slotStart: displayStart,
                              slotEnd: displayEnd,
                              isCustom: x.isCustom,
                              customTitle: x.customTitle,
                              maxChars: slotMaxChars,
                              primaryInstructor,
                              secondaryInstructor,
                              forceIntent: true,
                              defaultStatus: 'cancelled',
                              defaultCancellationReason: 'no_clients',
                            });
                          } else {
                            onCycle2Action(f, x, {
                              type: 'cancel_weather',
                              reason: "Pas d'inscrits (Vie 2)",
                              rescheduledChars: 0,
                              lostChars: 0,
                            });
                          }
                        }}
                        title="Annuler faute d'inscrits (Vie 2) et compléter la météo / notes REX en un seul écran"
                      >
                        👥 Pas d&apos;inscrit
                      </button>
                    )}

                    {!hasTerminalC2Decision && (c1Status === 'published' || inCycle2) && (
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: secondaryInstructor ? '#047857' : '#6d28d9',
                          background: secondaryInstructor ? '#ecfdf5' : '#f5f3ff',
                          border: secondaryInstructor ? '1.5px solid #34d399' : '1.5px solid #c4b5fd',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setDoubleName(valItem?.secondaryInstructor || 'Youenn');
                          setDoubleQual(valItem?.secondaryQualification || 'CQP');
                          setDoubleAddChars(
                            valItem?.secondaryMaxChars ??
                              (valItem?.secondaryQualification === 'DE_BPJEPS' ? 12 : 8)
                          );
                          setDoubleEnd(valItem?.secondaryActualEnd || '');
                          setDoubleFormula(valItem?.secondaryFormula || '');
                          setOpenTool(
                            isToolOpen('double_instructor')
                              ? null
                              : { slotKey, mode: 'double_instructor' }
                          );
                        }}
                        title="Doubler ce créneau en haute saison (ex. Jérôme + Youenn CQP = 20 chars max)"
                      >
                        {secondaryInstructor ? `👥 +${secondaryInstructor}` : '+ Doubler (2e moniteur)'}
                      </button>
                    )}

                    {!isPastDay && (hasTerminalC2Decision || c2Status === 'shifted') && (
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: confirmResetC2SlotKey === slotKey ? '#fff' : '#475569',
                          background: confirmResetC2SlotKey === slotKey ? '#475569' : '#fff',
                          border: '1px solid #94a3b8',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setOpenTool(null);
                          setConfirmResetC2SlotKey(prev => (prev === slotKey ? null : slotKey));
                        }}
                        title="Annuler la décision terrain Cycle 2 et remettre la séance en attente (confirmation demandée)"
                      >
                        ↩ Annuler décision C2
                      </button>
                    )}
                  </>
                );
              })()}

              {isReadOnly && slotObs && onOpenObservationModal && (
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '5px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: slotObs.status === 'cancelled' ? '#b91c1c' : '#047857',
                    background: slotObs.status === 'cancelled' ? '#fee2e2' : '#dcfce7',
                    border:
                      slotObs.status === 'cancelled'
                        ? '1.5px solid #f87171'
                        : '1.5px solid #34d399',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                  onClick={() =>
                    onOpenObservationModal({
                      dateStr: currentDs,
                      slotKey,
                      slotStart: displayStart,
                      slotEnd: displayEnd,
                      isCustom: x.isCustom,
                      customTitle: x.customTitle,
                      maxChars: slotMaxChars,
                      primaryInstructor,
                      secondaryInstructor,
                    })
                  }
                  title="Consulter le REX enregistré (lecture seule)"
                >
                  📝 Voir REX
                </button>
              )}
            </div>

            {/* Horaire Cycle 1 / Cycle 2 */}
            <div style={{ minWidth: '130px', textAlign: 'right' }}>
              {isShifted && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', textDecoration: 'line-through', fontWeight: 700 }}>
                  C1 : {pubDisplayStart} - {pubDisplayEnd}
                </div>
              )}
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
                      ? '#64748b'
                      : c2Status === 'merged'
                      ? '#6d28d9'
                      : c2Status === 'shifted'
                      ? '#b45309'
                      : inCycle2
                      ? '#14532d'
                      : '#0f172a',
                  textDecoration:
                    c2Status === 'cancelled_weather' ||
                    c1Status === 'closed_no_bookings' ||
                    c1Status === 'not_published' ||
                    c1Status === 'excluded'
                      ? 'line-through'
                      : 'none',
                }}
              >
                {displayStart} - {displayEnd}
              </div>
            </div>
          </div>
        </div>

        {/* Options Décalage horaire et Regroupement différées vers Axes d'Amélioration (QCM Jérôme) */}

        {/* CONFIRMATION INLINE ANNULATION DÉCISION CYCLE 2 */}
        {confirmResetC2SlotKey === slotKey && !isReadOnly && onCycle2Action && (
          slotObs ? (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                background: '#fef2f2',
                border: '1.5px solid #fca5a5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '0.75rem',
              }}
            >
              <span style={{ color: '#991b1b', fontWeight: 800 }}>
                ⛔ Un REX est enregistré sur cette séance : ouvrez d&apos;abord la fiche REX pour le modifier ou le supprimer avant d&apos;annuler la décision Cycle 2.
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {onOpenObservationModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmResetC2SlotKey(null);
                      onOpenObservationModal({
                        dateStr: currentDs,
                        slotKey,
                        slotStart: displayStart,
                        slotEnd: displayEnd,
                        isCustom: x.isCustom,
                        customTitle: x.customTitle,
                        maxChars: slotMaxChars,
                        primaryInstructor,
                        secondaryInstructor,
                      });
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#dc2626',
                      color: '#fff',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    📝 Ouvrir le REX
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmResetC2SlotKey(null)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid #fca5a5',
                    background: '#fff',
                    color: '#991b1b',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Compris
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                background: '#fffbeb',
                border: '1.5px solid #fcd34d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '0.75rem',
              }}
            >
              <span style={{ color: '#92400e', fontWeight: 800 }}>
                ⚠️ Confirmer l’annulation de la décision Cycle 2 («{' '}
                {c1Status === 'closed_no_bookings'
                  ? "Pas d'inscrit"
                  : c2Status === 'cancelled_weather'
                  ? 'Annulé météo'
                  : c2Status === 'realized'
                  ? 'Séance effectuée'
                  : c2Status === 'merged'
                  ? 'Regroupé'
                  : 'Décalé'}
                {' ») et remettre cette séance en attente ?'}
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmResetC2SlotKey(null);
                    onCycle2Action(f, x, { type: 'reset_to_cycle1' });
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
                  ✓ Confirmer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResetC2SlotKey(null)}
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
            </div>
          )
        )}

        {/* ALERTE DÉPASSEMENT CAPACITÉ MONITEUR(S) */}
        {isOverCapacity && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background: '#fee2e2',
              border: '1px solid #fca5a5',
              color: '#991b1b',
              fontSize: '0.74rem',
              fontWeight: 800,
            }}
          >
            ⛔ Plafond encadrement dépassé : {effectiveChars} chars engagés sur ce créneau pour un maximum de{' '}
            {slotMaxChars} chars
            {secondaryInstructor
              ? ` (${primaryInstructor} + ${secondaryInstructor})`
              : ' (1 moniteur — utilisez « + Doubler » pour passer à 20 ou 24 chars)'}
            .
          </div>
        )}

        {/* PANNEAU INLINE 0 : DOUBLEMENT 2E MONITEUR (NOTE 2 : Q1/Q2/Q3/Q5/Q6) */}
        {isToolOpen('double_instructor') && !isReadOnly && onCycle2Action && (
          <div
            style={{
              padding: '11px 12px',
              borderRadius: '8px',
              background: '#f5f3ff',
              border: '1.5px solid #c4b5fd',
              display: 'flex',
              flexDirection: 'column',
              gap: '9px',
              fontSize: '0.76rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <strong style={{ color: '#5b21b6' }}>
                👥 Créneau multi-moniteurs · Ajouter ou ajuster le 2e moniteur (1 clic) :
              </strong>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {SECONDARY_INSTRUCTOR_PRESETS.map(preset => {
                  const pSt = getMonitorBadgeStyle(preset.name);
                  const presetTotalCap = MAX_CHARS_PER_INSTRUCTOR + preset.addChars;
                  const presetTooSmall = effectiveChars > presetTotalCap;
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      disabled={presetTooSmall}
                      title={
                        presetTooSmall
                          ? `Bloqué : ${effectiveChars} chars déjà engagés > plafond ${presetTotalCap}`
                          : undefined
                      }
                      onClick={() => {
                        if (presetTooSmall) return;
                        onCycle2Action(f, x, {
                          type: 'double_instructor',
                          secondaryInstructor: preset.name,
                          secondaryQualification: preset.qualification,
                          secondaryMaxChars: preset.addChars,
                          secondaryActualEnd: doubleEnd.trim() || undefined,
                          secondaryFormula: doubleFormula.trim() || undefined,
                        });
                        setOpenTool(null);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: `1.5px solid ${presetTooSmall ? '#fca5a5' : pSt.bd}`,
                        background: presetTooSmall ? '#fef2f2' : pSt.bg,
                        color: presetTooSmall ? '#991b1b' : pSt.fg,
                        fontWeight: 900,
                        fontSize: '0.73rem',
                        opacity: presetTooSmall ? 0.6 : 1,
                        cursor: presetTooSmall ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ⚡ {preset.label}{presetTooSmall ? ' ⛔' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 700, color: '#334155', fontSize: '0.70rem' }}>
                Prénom 2e moniteur :
                <input
                  type="text"
                  value={doubleName}
                  onChange={e => setDoubleName(e.target.value)}
                  placeholder="ex: Youenn, Katleen..."
                  style={{ padding: '4px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.76rem', width: '130px' }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 700, color: '#334155', fontSize: '0.70rem' }}>
                Diplôme / Plafond :
                <select
                  value={doubleQual}
                  onChange={e => {
                    const q = e.target.value as 'CQP' | 'DE_BPJEPS';
                    setDoubleQual(q);
                    setDoubleAddChars(q === 'CQP' ? 8 : 12);
                  }}
                  style={{ padding: '4px 6px', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.76rem', background: '#fff' }}
                >
                  <option value="CQP">CQP (+8 chars → 20 max)</option>
                  <option value="DE_BPJEPS">DE / BPJEPS (+12 chars → 24 max)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 700, color: '#334155', fontSize: '0.70rem' }}>
                +Chars ajoutés :
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={doubleAddChars}
                  onChange={e => setDoubleAddChars(Math.max(1, Math.min(12, Number(e.target.value) || 8)))}
                  style={{ padding: '4px 6px', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.76rem', width: '64px', fontWeight: 800 }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 700, color: '#334155', fontSize: '0.70rem' }}>
                Fin 2e groupe (optionnel, Q2) :
                <input
                  type="time"
                  value={doubleEnd}
                  onChange={e => setDoubleEnd(e.target.value)}
                  style={{ padding: '4px 6px', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.76rem' }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 700, color: '#334155', fontSize: '0.70rem' }}>
                Formule / note 2e groupe (Q2) :
                <input
                  type="text"
                  value={doubleFormula}
                  onChange={e => setDoubleFormula(e.target.value)}
                  placeholder="ex: Perfectionnement, Stage..."
                  style={{ padding: '4px 7px', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.76rem', width: '170px' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#5b21b6' }}>
                Plafond créneau combiné : {MAX_CHARS_PER_INSTRUCTOR} ({primaryInstructor}) + {doubleAddChars} ({doubleName || '2e'}) ={' '}
                <strong>{MAX_CHARS_PER_INSTRUCTOR + doubleAddChars} chars max</strong>
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {secondaryInstructor && (() => {
                  const cannotRemoveSec = effectiveChars > MAX_CHARS_PER_INSTRUCTOR;
                  return (
                    <button
                      type="button"
                      disabled={cannotRemoveSec}
                      title={
                        cannotRemoveSec
                          ? `Impossible de retirer ${secondaryInstructor} tant que ${effectiveChars} chars (> ${MAX_CHARS_PER_INSTRUCTOR}) sont engagés`
                          : undefined
                      }
                      onClick={() => {
                        if (cannotRemoveSec) return;
                        onCycle2Action(f, x, {
                          type: 'double_instructor',
                          secondaryInstructor: undefined,
                        });
                        setOpenTool(null);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: '1px solid #fca5a5',
                        background: '#fee2e2',
                        color: '#991b1b',
                        fontWeight: 800,
                        opacity: cannotRemoveSec ? 0.55 : 1,
                        cursor: cannotRemoveSec ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {cannotRemoveSec ? `⛔ Garder ${secondaryInstructor} (${effectiveChars} chars)` : `🗑️ Retirer ${secondaryInstructor}`}
                    </button>
                  );
                })()}
                {(() => {
                  const newCap = MAX_CHARS_PER_INSTRUCTOR + doubleAddChars;
                  const capTooLow = effectiveChars > newCap;
                  const canConfirm = Boolean(doubleName.trim()) && !capTooLow;
                  return (
                    <button
                      type="button"
                      disabled={!canConfirm}
                      title={
                        capTooLow
                          ? `Plafond ${newCap} chars insuffisant pour les ${effectiveChars} chars déjà engagés`
                          : undefined
                      }
                      onClick={() => {
                        if (!canConfirm) return;
                        onCycle2Action(f, x, {
                          type: 'double_instructor',
                          secondaryInstructor: doubleName.trim(),
                          secondaryQualification: doubleQual,
                          secondaryMaxChars: doubleAddChars,
                          secondaryActualEnd: doubleEnd.trim() || undefined,
                          secondaryFormula: doubleFormula.trim() || undefined,
                        });
                        setOpenTool(null);
                      }}
                      style={{
                        padding: '5px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: canConfirm ? '#7c3aed' : '#94a3b8',
                        color: '#fff',
                        fontWeight: 800,
                        cursor: canConfirm ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {capTooLow
                        ? `⛔ Bloqué (${effectiveChars}/${newCap} chars)`
                        : `✓ Valider doublement (${newCap} chars)`}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setOpenTool(null)}
                  style={{ padding: '5px 9px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}



        {/* Panneau Décalage horaire retiré en Cycle 2 pour sécuriser la synchro réservation (voir Axes d'Amélioration) */}




      </div>
    );
  };

  return (
    <div id="tab2">
      {/* Calendrier en haut du Cycle 2 (exigence Jérôme) */}
      <CalendarGrid
        year={year}
        month={month}
        selectedDate={currentDs}
        onSelectDate={handleSelectCustomDate}
        onPrevMonth={onPrevMonth}
        onNextMonth={onNextMonth}
        settings={settings}
        EX={EX}
        W={tideW}
        first={first}
        last={last}
        windList={windList}
        validations={validations}
        bookingsMap={bookingsMap}
        customSlotsMap={customSlotsMap}
      />

      {/* Balise Winds-Up Douarnenez Pentrez (Spot 66) : affichée uniquement à la date du jour (modèle de relevé temps réel) */}
      {currentDs === tdRaw && (
        <WindsUpBaliseCard dateStr={currentDs} settings={settings} />
      )}

      {/* Tableau Windguru directement sous la balise */}
      <WindguruTable
        dateStr={currentDs}
        settings={settings}
        EX={EX}
        windList={windList}
      />

      {/* Main Focus Verdict Card + Graphiques Marée & Vent complets */}
      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '10px',
          }}
        >
          <div>
            <div className="fh" style={{ margin: 0, color: '#6d28d9' }}>
              Cycle 2 · Verdict &amp; Analyse Décisionnelle
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, textTransform: 'capitalize', marginTop: '2px' }}>
              {formatWd(currentDs)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {(() => {
              const currentMode = settings.calculationMode || 'theorique';
              return (
                <div
                  style={{
                    display: 'inline-flex',
                    background: 'var(--cell)',
                    padding: '2px',
                    borderRadius: '8px',
                    border: '1px solid var(--bd)',
                  }}
                  title="Choisir la base de calcul des créneaux : marée SHOM brute (défaut) ou Modèle réel empirique (Pression + Houle + Vent, dès le 20/11/2026)"
                >
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ calculationMode: 'theorique' })}
                    style={{
                      padding: '4px 9px',
                      borderRadius: '6px',
                      border: 'none',
                      background: currentMode === 'theorique' ? '#0f172a' : 'transparent',
                      color: currentMode === 'theorique' ? '#fff' : 'var(--tx)',
                      fontSize: '0.72rem',
                      fontWeight: currentMode === 'theorique' ? 800 : 600,
                      cursor: 'pointer',
                    }}
                  >
                    📐 SHOM brut
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ calculationMode: 'reel' })}
                    style={{
                      padding: '4px 9px',
                      borderRadius: '6px',
                      border: 'none',
                      background: currentMode === 'reel' ? '#16a34a' : 'transparent',
                      color: currentMode === 'reel' ? '#fff' : 'var(--tx)',
                      fontSize: '0.72rem',
                      fontWeight: currentMode === 'reel' ? 800 : 600,
                      cursor: 'pointer',
                    }}
                  >
                    ✨ Modèle empirique
                  </button>
                </div>
              );
            })()}

            {!isReadOnly && currentDs >= tdRaw && onUpdateCustomSlots && (
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
                  padding: '5px 10px',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                title="Créer un créneau sur mesure ou modifier manuellement les créneaux du jour"
              >
                <span>✏️</span>
                <span>Créneaux sur mesure</span>
              </button>
            )}

            {onOpenExpressRex && (
              <button
                type="button"
                onClick={() => onOpenExpressRex(currentDs)}
                style={{
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(15, 118, 110, 0.28)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                }}
                title="Valider tous les créneaux de la journée en une seule vue avec météo pré-remplie"
              >
                <span>⚡</span>
                <span>Bilan Express</span>
              </button>
            )}

            {onOpenObservationModal && (
              <button
                type="button"
                onClick={() => {
                  const s0 = currentFocus.list[0];
                  onOpenObservationModal({
                    dateStr: currentDs,
                    slotKey: s0 ? kOf(s0) : 'general',
                    slotStart: s0 ? lc(s0.a, cy, cm, cd) : '09:00',
                    slotEnd: s0 ? lc(s0.b, cy, cm, cd) : '10:00',
                    isCustom: s0?.isCustom,
                    customTitle: s0?.customTitle,
                  });
                }}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 11px',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.28)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                title="Noter un relevé terrain (hauteurs d'eau, surcote, météo)"
              >
                <span style={{ fontWeight: 900 }}>+</span>
                <span>Noter un relevé</span>
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
              marginBottom: '10px',
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

        <div className="vd" style={{ background: verdictDisplay.bg }}>
          <b>{verdictDisplay.title}</b>
          <span>
            {verdictDisplay.why}
            {verdictDisplay.glob ? ' (modèle global, indicatif)' : ''}
          </span>
        </div>

        <div className="note" style={{ marginTop: '10px', marginBottom: '10px', lineHeight: 1.4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            {verdictDisplay.rng ? (
              <>
                💨 <b>Vent prévu sur les créneaux :</b> {verdictDisplay.rng}{' '}
                {verdictDisplay.glob ? '(modèle global)' : '(AROME Météo-France)'}
              </>
            ) : (
              'Pas de données de vent prévues sur cette plage horaire.'
            )}
          </div>
          {dayWindSectors.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {dayWindSectors.map(sec => (
                <span
                  key={sec.sector}
                  title={sec.detail}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '5px',
                    fontSize: '0.70rem',
                    fontWeight: 800,
                    background: sec.bg,
                    color: sec.fg,
                    border: `1px solid ${sec.bd}`,
                  }}
                >
                  🧭 {sec.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {hasVentDeTerre && (
          <div
            style={{
              padding: '7px 11px',
              borderRadius: '8px',
              background: '#fff7ed',
              border: '1.5px solid #fdba74',
              color: '#9a3412',
              fontSize: '0.74rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              marginBottom: '10px',
            }}
          >
            <span>⚠️</span>
            <span>
              Vent de terre (secteur NE–ESE via Kervennec) : déventes et irrégularités possibles devant l&apos;école (verdict auto inchangé).
            </span>
          </div>
        )}

        {/* Courbe de hauteur d'eau & plage praticable (identique Cycle 1) */}
        <CurveChart
          dateStr={currentDs}
          settings={settings}
          EX={EX}
          W={tideW}
          first={first}
          last={last}
          windList={windList}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            margin: '12px 0 8px 0',
            padding: '7px 12px',
            borderRadius: '8px',
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderLeft: '4px solid var(--ac)',
          }}
        >
          <span
            style={{
              fontSize: '0.95rem',
              fontWeight: 900,
              textTransform: 'capitalize',
              color: 'var(--tx)',
            }}
          >
            {new Date(Date.UTC(cy, cm, cd)).toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </span>
          {currentDs === tdy() && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 900,
                background: 'var(--ac)',
                color: '#111',
                padding: '2px 8px',
                borderRadius: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
              }}
            >
              Aujourd&apos;hui
            </span>
          )}
        </div>

        {/* Plages praticables & coefficient */}
        {!P.length && (
          <div className="w">
            <span className="chip k">AUCUNE PLAGE</span>
            <span className="chip k">COEF : {coef}</span>
          </div>
        )}

        {P.map((p, idx) => (
          <div key={`c2-pract-${idx}`} className="w">
            <span className="chip">● PRATICABLE</span>
            <span className="chip k">COEF : {coef}</span>
            <span className="hr">
              {lc(p[0], cy, cm, cd)} - {lc(p[1], cy, cm, cd)}
            </span>
          </div>
        ))}

        {allDay(cy, cm, cd, settings) && (
          <div className="m">
            Coef ≤ {settings.cmax} : roulage toute la journée, sans contrainte de marée.
          </div>
        )}

        {(() => {
          const validatedKeySet = new Set(cycle1ValidatedSlots.map(item => item.slotKey));
          const matchedCurrentCount = cycle1ValidatedSlots.filter(item => item.isFromCurrentList).length;
          const hiddenSlotsCount = Math.max(0, currentFocus.list.length - matchedCurrentCount);
          const displayTotalCount = Math.max(currentFocus.list.length, cycle1ValidatedSlots.length);
          const anySlotNeedsSmsNotice = cycle1ValidatedSlots.some(({ valItem, slotKey }) => {
            const effectiveBKey =
              valItem && (bookingsMap[buildReservationKey(currentFocus.ds, valItem.k)]?.length ?? 0) > 0
                ? valItem.k
                : slotKey;
            const bChars = getSlotBookingsSummary(
              bookingsMap[buildReservationKey(currentFocus.ds, effectiveBKey)] || []
            ).totalChars;
            const st = getEffectiveCycle2Status(valItem, bChars);
            return st === 'shifted' || st === 'merged' || st === 'cancelled_weather';
          });

          return (
            <>
              <div className="fh" style={{ marginTop: '14px', marginBottom: '6px' }}>
                Créneaux validés Cycle 1 ({cycle1ValidatedSlots.length}
                {hiddenSlotsCount > 0 ? ` / ${displayTotalCount}` : ''}) · Jauge max{' '}
                {MAX_CHARS_PER_INSTRUCTOR} chars / moniteur
              </div>

              {anySlotNeedsSmsNotice && (
                <div
                  style={{
                    padding: '7px 11px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px dashed #94a3b8',
                    color: '#475569',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '10px',
                  }}
                >
                  <span>📲</span>
                  <span>
                    SMS clients : En attente de connexion avec le futur outil de réservation (prévenir les inscrits des créneaux modifiés manuellement si besoin).
                  </span>
                </div>
              )}

              {cycle1ValidatedSlots.length > 0 ? (
                <>
                  {cycle1ValidatedSlots.map((item, idx) => {
                    const isOrphan = !item.isFromCurrentList;
                    const overlapsActive =
                      isOrphan &&
                      cycle1ValidatedSlots.some(
                        other =>
                          other.isFromCurrentList &&
                          item.x.a < other.x.b &&
                          item.x.b > other.x.a
                      );
                    return renderSessRow(
                      currentFocus,
                      item.x,
                      `f-${idx}`,
                      item.valItem,
                      validatedKeySet,
                      isOrphan,
                      overlapsActive
                    );
                  })}
                  {hiddenSlotsCount > 0 && (
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: '#64748b',
                        background: '#f8fafc',
                        border: '1px dashed #cbd5e1',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        marginTop: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <span>
                        ℹ️ {hiddenSlotsCount} créneau{hiddenSlotsCount > 1 ? 'x' : ''} non validé
                        {hiddenSlotsCount > 1 ? 's' : ''} ou non publié
                        {hiddenSlotsCount > 1 ? 's' : ''} en Cycle 1 masqué
                        {hiddenSlotsCount > 1 ? 's' : ''}.
                      </span>
                      {currentDs >= tdRaw && (
                        <button
                          type="button"
                          onClick={() => onSelectDayInCalendar(currentDs)}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            color: '#0369a1',
                            borderRadius: '6px',
                            padding: '3px 9px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Gérer en Cycle 1 ➔
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : currentFocus.list.length > 0 ? (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1.5px dashed #f59e0b',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900, fontSize: '0.88rem', color: '#92400e' }}>
                      ⏳ Aucun créneau validé en Cycle 1 pour cette journée
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#78350f', marginTop: '3px', lineHeight: 1.4 }}>
                      Seuls les créneaux préalablement publiés/validés en Cycle 1 apparaissent en Cycle 2 ({currentFocus.list.length} créneau{currentFocus.list.length > 1 ? 'x' : ''} non validé{currentFocus.list.length > 1 ? 's' : ''} ou fermé{currentFocus.list.length > 1 ? 's' : ''} ce jour).
                    </div>
                  </div>
                  {currentDs >= tdRaw && (
                    <button
                      type="button"
                      className="fbtn"
                      style={{
                        margin: 0,
                        background: '#0284c7',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 14px',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                      }}
                      onClick={() => onSelectDayInCalendar(currentDs)}
                    >
                      ⏳ Valider les créneaux en Cycle 1
                    </button>
                  )}
                </div>
              ) : (
                <div className="fs">
                  <div>
                    <b>Aucune séance possible</b>
                    <small>Marée haute ou hors plage d&apos;ouverture</small>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {onUpdateCustomSlots && (() => {
          const protectedSlotReasons: Array<{ start: string; end: string; reason: string }> = [];
          const slotActivityList: SlotActivityConflict[] = [];
          let hasAnyLockedSlot = false;
          const valRec = validations[currentDs];
          const dayObs = observations.filter(o => o.ds === currentDs);
          const normT = (v?: string) => (v || '').replace('h', ':');
          currentFocus.list.forEach(s => {
            const sKey = kOf(s);
            const sStart = lc(s.a, cy, cm, cd);
            const sEnd = lc(s.b, cy, cm, cd);
            const sVal = findMatchingValidationItem(valRec, sKey, sStart, sEnd);
            const bKey =
              sVal && (bookingsMap[buildReservationKey(currentDs, sVal.k)]?.length ?? 0) > 0
                ? sVal.k
                : sKey;
            const bChars = getSlotBookingsSummary(
              bookingsMap[buildReservationKey(currentDs, bKey)] || []
            ).totalChars;
            const eChars = bChars > 0 ? bChars : getValidationItemChars(sVal).totalChars;
            const sObs = dayObs.find(
              o =>
                o.slotKey === sKey ||
                (sVal && o.slotKey === sVal.k) ||
                (Boolean(o.slotStart) &&
                  Boolean(o.slotEnd) &&
                  normT(o.slotStart) === normT(sStart) &&
                  normT(o.slotEnd) === normT(sEnd))
            );
            const sHHMM = sStart.replace('h', ':');
            const eHHMM = sEnd.replace('h', ':');
            const c1 = getEffectiveCycle1Status(sVal);
            const isClassic = !s.isCustom || Boolean(s.isAdapted) || Boolean(s.isUnchangedTide);
            slotActivityList.push({
              start: sHHMM,
              end: eHHMM,
              chars: eChars,
              hasRex: Boolean(sObs),
              hasC2Decision: hasCycle2Activity(sVal, eChars, sObs),
              isClassic,
              label: s.customTitle,
            });
            if (eChars > 0) {
              protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: `≥ 1 inscrit (${eChars})` });
              hasAnyLockedSlot = true;
            } else if (sObs) {
              protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: 'REX enregistré' });
              hasAnyLockedSlot = true;
            } else if (
              hasCycle2Activity(sVal, eChars, sObs) ||
              c1 === 'excluded' ||
              c1 === 'not_published' ||
              c1 === 'closed_no_bookings'
            ) {
              protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: 'Décision C1/C2 enregistrée' });
              hasAnyLockedSlot = true;
            } else if (s.a - Date.now() / 60000 < 48 * 60) {
              protectedSlotReasons.push({ start: sHHMM, end: eHHMM, reason: '< 48h avant début' });
              hasAnyLockedSlot = true;
            }
          });
          return (
            <CustomSlotsManager
              dateStr={currentDs}
              settings={settings}
              windList={windList}
              customSlotsMap={customSlotsMap}
              onUpdateCustomSlots={onUpdateCustomSlots}
              onCreateAndPublishSlot={
                onCreateAndPublishCustomSlot
                  ? (ds, slot, options) => {
                      onCreateAndPublishCustomSlot(ds, slot, options);
                      setIsCustomSlotsOpen(false);
                    }
                  : undefined
              }
              defaultSlots={(() => {
                const pl = plan(cy, cm, cd, settings, tideW, first, last);
                return pl.full
                  .map((x, idx) => ({
                    start: lc(x[0], cy, cm, cd),
                    end: lc(x[1], cy, cm, cd),
                    title: `Séance ${idx + 1}`,
                  }))
                  .concat(
                    pl.extra.map(x => ({
                      start: lc(x[0], cy, cm, cd),
                      end: lc(x[1], cy, cm, cd),
                      title: `Optionnel (+${x[3]} min)`,
                    }))
                  );
              })()}
              isOpenControlled={isCustomSlotsOpen}
              onToggleOpen={() => setIsCustomSlotsOpen(prev => !prev)}
              isReadOnly={isReadOnly || currentDs < tdRaw}
              protectedSlotReasons={protectedSlotReasons}
              slotActivityList={slotActivityList}
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
            🌡 Basse pression : +{Math.round(Math.max(...ad) * 100)} cm ajoutés aux hauteurs d&apos;eau (correction automatique)
          </div>
        )}
      </div>

      {/* Courbe de marnage cliquable */}
      <div className="card nop">
        <MarnageChart
          year={year}
          month={month}
          selectedDate={currentDs}
          onSelectDate={handleSelectCustomDate}
          settings={settings}
          EX={EX}
        />
      </div>

      {/* Minimum sessions setting */}
      <div className="card ctl">
        <label title="Nombre minimal de créneaux favorables pour classer la journée en OUVRIR (défaut : 1)">
          Séances minimum pour « ouvrir » la journée (défaut : 1)
          <input
            type="text"
            inputMode="decimal"
            value={settings.fmin}
            onChange={(e) => {
              const val = parseFloat(e.target.value.replace(',', '.'));
              onUpdateSettings({ fmin: isNaN(val) || val < 1 ? 1 : val, fminCustomized: true });
            }}
          />
        </label>
      </div>

      {activeBookingSlot && (
        <SlotBookingsModal
          isOpen={Boolean(activeBookingSlot)}
          onClose={() => setActiveBookingSlot(null)}
          dateStr={currentDs}
          slotKey={activeBookingSlot.slotKey}
          slotStart={activeBookingSlot.slotStart}
          slotEnd={activeBookingSlot.slotEnd}
          slotTitle={activeBookingSlot.slotTitle}
          bookings={bookingsMap[buildReservationKey(currentDs, activeBookingSlot.slotKey)] || []}
          onSaveBookings={(sKey, list) => {
            onSaveSlotBookings?.(
              currentDs,
              sKey,
              activeBookingSlot.slotStart,
              activeBookingSlot.slotEnd,
              list
            );
          }}
          isReadOnly={isReadOnly}
          maxChars={activeBookingSlot.maxChars}
          primaryInstructor={activeBookingSlot.primaryInstructor}
          secondaryInstructor={activeBookingSlot.secondaryInstructor}
          secondaryQualification={activeBookingSlot.secondaryQualification}
          secondaryActualEnd={activeBookingSlot.secondaryActualEnd}
          secondaryFormula={activeBookingSlot.secondaryFormula}
        />
      )}
    </div>
  );
};
