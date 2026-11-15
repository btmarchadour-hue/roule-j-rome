import React, { useState } from 'react';
import {
  AppSettings,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  MAX_CHARS_PER_INSTRUCTOR,
  SessionItem,
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
  tdy,
  toU,
  VC,
  vstat,
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
  getSlotFleetAlerts,
  getSlotMaxCapacity,
  getValidationItemChars,
  hasCycle2Trigger,
  SECONDARY_INSTRUCTOR_PRESETS,
  shiftTimeString,
} from '../utils/cycleHelpers';
import { CalendarGrid } from './CalendarGrid';
import { CurveChart } from './CurveChart';
import { MarnageChart } from './MarnageChart';
import { TableView } from './TableView';
import { WindPanel } from './WindPanel';
import { WindguruTable } from './WindguruTable';
import { WindsUpBaliseCard } from './WindsUpBaliseCard';
import { SlotBookingsModal } from './SlotBookingsModal';
import { CustomSlotsManager } from './CustomSlotsManager';
import { DayCycle1Banner } from './DayCycle1Banner';
import { getStoredWaterlineLogs } from '../utils/waterlineGpsEngine';
import {
  classifyWindSector,
  evaluateFrontalSwell,
  WindSectorInfo,
} from '../utils/beachOrientation';
import { CALENDAR_INDICATOR_COLORS, getFrenchHolidayInfo, HOLIDAY_ZONE_COLORS } from '../utils/frenchHolidays';

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
  onCreateAndPublishCustomSlot?: (dateStr: string, slot: CustomSlot) => void;
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
  }) => void;
  isReadOnly?: boolean;
  focusDate?: string;
  onFocusDateChange?: (ds: string) => void;
}

const C2_WEATHER_REASONS = [
  'Vent insuffisant (< 8 nds)',
  'Vent trop fort / rafales',
  'Vent mauvais secteur',
  'État de plage / bâches',
  'Météo extrême / orage',
];

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
  onValidateDay,
  onClearValidation,
  onAddCustomNonPublishReason,
  onOpenObservationModal,
  isReadOnly = false,
  focusDate: propFocusDate,
  onFocusDateChange,
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
    mode: 'confirm_chars' | 'shift' | 'merge' | 'cancel_weather' | 'double_instructor';
  } | null>(null);
  const [confirmMono, setConfirmMono] = useState<number>(1);
  const [confirmBi, setConfirmBi] = useState<number>(0);
  const [cancelReason, setCancelReason] = useState<string>(C2_WEATHER_REASONS[0]);
  const [cancelRescheduled, setCancelRescheduled] = useState<number>(0);
  const [cancelLost, setCancelLost] = useState<number>(0);
  const [doubleName, setDoubleName] = useState<string>('Youenn');
  const [doubleQual, setDoubleQual] = useState<'CQP' | 'DE_BPJEPS'>('CQP');
  const [doubleAddChars, setDoubleAddChars] = useState<number>(8);
  const [doubleEnd, setDoubleEnd] = useState<string>('');
  const [doubleFormula, setDoubleFormula] = useState<string>('');
  const [isCustomSlotsOpen, setIsCustomSlotsOpen] = useState<boolean>(false);
  const [adjustMenuSlotKey, setAdjustMenuSlotKey] = useState<string | null>(null);

  const handleSelectCustomDate = (ds: string) => {
    setInternalFocusDate(ds);
    onFocusDateChange?.(ds);
    setOpenTool(null);
    setAdjustMenuSlotKey(null);
  };

  const targetDs = propFocusDate || internalFocusDate;
  const currentFocus = dayFocus(targetDs, settings, tideW, first, last, windList, customSlotsMap);
  const currentDs = currentFocus.ds;

  const shiftFocusDate = (deltaDays: number) => {
    const [sy, sm0, sd] = currentDs.split('-').map(Number);
    const next = new Date(Date.UTC(sy, sm0 - 1, sd + deltaDays));
    const nextDs = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
      next.getUTCDate()
    ).padStart(2, '0')}`;
    if (nextDs < minDs || nextDs > maxDs) return;
    handleSelectCustomDate(nextDs);
  };

  const [cy, cm0, cd] = currentDs.split('-').map(Number);
  const cm = cm0 - 1;
  const P = dayInfo(cy, cm, cd, settings, tideW, first, last);
  const coef = COEF[currentDs];
  const dayStartU = toU(cy, cm, cd, 0);
  const dayEndU = toU(cy, cm, cd + 1, 0);
  const R = dayRow(cy, cm, cd, settings, EX, tideW, first, last, windList);
  const ad = EX.filter(p => p.t >= dayStartU && p.t < dayEndU && p.adj).map(p => p.adj as number);
  const holiday = getFrenchHolidayInfo(currentDs);

  const dayWindSectors: WindSectorInfo[] = (() => {
    const seen = new Map<string, WindSectorInfo>();
    for (const s of currentFocus.list) {
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
  const frontalSwellAdvisory = evaluateFrontalSwell(windList, dayStartU + 480, dayStartU + 1200);

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
    validatedMergeKeys?: Set<string>
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
    const fleetAlerts = getSlotFleetAlerts(
      effectiveMono,
      effectiveBi,
      settings.parkMaxMono,
      settings.parkMaxBi
    );

    const c1Status = getEffectiveCycle1Status(valItem);
    const inCycle2 = hasCycle2Trigger(valItem, bookingSummary.totalChars);
    const c2Status = getEffectiveCycle2Status(valItem, bookingSummary.totalChars);

    const displayStart = valItem?.actualStart || startTimeStr;
    const displayEnd = valItem?.actualEnd || endTimeStr;
    const isShifted =
      c2Status === 'shifted' &&
      Boolean(valItem?.actualStart) &&
      (valItem?.actualStart !== startTimeStr || valItem?.actualEnd !== endTimeStr);

    const isToolOpen = (
      mode: 'confirm_chars' | 'shift' | 'merge' | 'cancel_weather' | 'double_instructor'
    ) => openTool?.slotKey === slotKey && openTool.mode === mode;

    // Créneaux candidats pour le regroupement / fusion sur la même journée (uniquement parmi les créneaux validés Cycle 1)
    const mergeTargets = f.list
      .filter(other => {
        const oKey = kOf(other);
        if (oKey === slotKey) return false;
        if (validatedMergeKeys) return validatedMergeKeys.has(oKey);
        const oStart = lc(other.a, f.y, f.m, f.d);
        const oEnd = lc(other.b, f.y, f.m, f.d);
        const oVal = findMatchingValidationItem(valRecord, oKey, oStart, oEnd);
        const oBook = getSlotBookingsSummary(bookingsMap[buildReservationKey(f.ds, oKey)] || []);
        return getEffectiveCycle1Status(oVal) === 'published' || hasCycle2Trigger(oVal, oBook.totalChars);
      })
      .map(other => {
        const oKey = kOf(other);
        const oStart = lc(other.a, f.y, f.m, f.d);
        const oEnd = lc(other.b, f.y, f.m, f.d);
        const oVal = findMatchingValidationItem(valRecord, oKey, oStart, oEnd);
        const oBook = getSlotBookingsSummary(bookingsMap[buildReservationKey(f.ds, oKey)] || []);
        const oChars = Math.max(oBook.totalChars, getValidationItemChars(oVal).totalChars);
        const maxTargetChars = getSlotMaxCapacity(oVal);
        const combined = effectiveChars + oChars;
        return {
          slotKey: oKey,
          label: `${oVal?.actualStart || oStart} - ${oVal?.actualEnd || oEnd}`,
          oChars,
          combined,
          maxTargetChars,
          overMax: combined > maxTargetChars,
        };
      });

    const cardBg =
      c2Status === 'cancelled_weather'
        ? '#fef2f2'
        : c2Status === 'merged'
        ? '#faf5ff'
        : c2Status === 'shifted'
        ? '#fffbeb'
        : c1Status === 'not_published'
        ? '#f1f5f9'
        : c1Status === 'closed_no_bookings'
        ? '#f8fafc'
        : inCycle2
        ? '#f0fdf4'
        : c1Status === 'published'
        ? '#f0f9ff'
        : '#ffffff';

    const cardBorder =
      c2Status === 'cancelled_weather'
        ? '2px solid #ef4444'
        : c2Status === 'merged'
        ? '2px solid #a855f7'
        : c2Status === 'shifted'
        ? '2px solid #f59e0b'
        : c1Status === 'not_published'
        ? '2px solid #64748b'
        : c1Status === 'closed_no_bookings'
        ? '1.5px solid #cbd5e1'
        : inCycle2
        ? '2px solid #22c55e'
        : c1Status === 'published'
        ? '2px solid #0284c7'
        : '2px dashed #cbd5e1';

    const cardBarColor =
      c2Status === 'cancelled_weather'
        ? '#dc2626'
        : c2Status === 'merged'
        ? '#7c3aed'
        : c2Status === 'shifted'
        ? '#d97706'
        : c1Status === 'not_published'
        ? '#475569'
        : c1Status === 'closed_no_bookings'
        ? '#64748b'
        : inCycle2
        ? '#16a34a'
        : c1Status === 'published'
        ? '#0284c7'
        : '#94a3b8';

    let chip = <span className="fchip">VENT ?</span>;
    if (x.isCustom) {
      chip = (
        <span className={`fchip ${x.ok === true ? 'fg' : x.ok === false ? 'fr' : 'fo'}`}>
          SUR MESURE · {x.ok === true ? 'VENT OK' : x.ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
        </span>
      );
    } else if (x.opt) {
      chip = <span className="fchip fo">OPTIONNEL +{x.over} MIN</span>;
    } else if (x.ok === true) {
      chip = <span className="fchip fg">VENT OK</span>;
    } else if (x.ok === false) {
      chip = <span className="fchip fr">VENT HORS PLAGE</span>;
    }

    const sub = x.isCustom
      ? x.customTitle || 'Créneau personnalisé'
      : x.opt
      ? `dépasse la contrainte ${
          x.lim === 'marée' ? 'de marée' : "d'heure du jour"
        } au ${x.side} · à ta discrétion`
      : x.txt || '';
    const slotWindSector = x.st ? classifyWindSector(x.st.dir) : null;

    const isAdjustOpen =
      adjustMenuSlotKey === slotKey ||
      isToolOpen('shift') ||
      isToolOpen('merge') ||
      isToolOpen('cancel_weather');

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
          backgroundColor: cardBg,
          border: cardBorder,
          borderLeft: `6px solid ${cardBarColor}`,
          boxShadow: inCycle2
            ? '0 2px 8px rgba(22, 163, 74, 0.10)'
            : '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
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
                      ? 'CYCLE 2 · RÉALISÉ'
                      : 'CYCLE 2 · MAINTENU'}
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
                <span>📅</span>
                <span>CYCLE 1 PUBLIÉ · 0 inscrit (En attente 1er char)</span>
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
                  background: '#475569',
                  color: '#ffffff',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontWeight: 900,
                  fontSize: '0.74rem',
                }}
              >
                <span>🌑</span>
                <span>CLÔTURÉ · FAUTE D&apos;INSCRITS (VIE 1)</span>
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

            {sub && (
              <small style={{ color: '#64748b', fontSize: '0.72rem' }}>
                {sub + (x.past ? ' · passée' : '')}
              </small>
            )}
          </div>

          {/* DROITE : Boutons Tactiques Cycle 2 + Horaire */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
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
                onClick={() =>
                  setActiveBookingSlot({
                    slotKey: effectiveBookingKey,
                    slotStart: startTimeStr,
                    slotEnd: endTimeStr,
                    slotTitle: x.customTitle,
                    maxChars: slotMaxChars,
                    primaryInstructor,
                    secondaryInstructor,
                    secondaryQualification: valItem?.secondaryQualification,
                    secondaryActualEnd: valItem?.secondaryActualEnd,
                    secondaryFormula: valItem?.secondaryFormula,
                  })
                }
                title="Ouvrir la fiche numérique des réservations (déclenche Cycle 2 dès 1 char)"
              >
                👥 Inscriptions ({effectiveChars}/{slotMaxChars})
              </button>

              {!isReadOnly && onCycle2Action && (
                <>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '5px 9px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      color: '#fff',
                      background: '#16a34a',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      if (effectiveChars >= 1) {
                        onCycle2Action(f, x, {
                          type: 'confirm',
                          monoCount: effectiveMono > 0 || effectiveBi > 0 ? effectiveMono : effectiveChars,
                          biCount: effectiveBi,
                          pilotsCount: effectivePeople || effectiveChars,
                          instructor: 'Jérôme',
                        });
                        setOpenTool(null);
                      } else {
                        setConfirmMono(1);
                        setConfirmBi(0);
                        setOpenTool(
                          isToolOpen('confirm_chars') ? null : { slotKey, mode: 'confirm_chars' }
                        );
                      }
                    }}
                    title="Maintenir la séance (exige au moins 1 char inscrit)"
                  >
                    ✓ Maintenir
                  </button>

                  {(c1Status === 'published' || inCycle2) && (
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

                  {inCycle2 && (
                    <button
                      type="button"
                      className="fbtn"
                      style={{
                        margin: 0,
                        padding: '5px 9px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: isAdjustOpen ? '#fff' : '#334155',
                        background: isAdjustOpen ? '#334155' : '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        if (isAdjustOpen) {
                          setAdjustMenuSlotKey(null);
                          if (openTool?.slotKey === slotKey && openTool.mode !== 'confirm_chars') {
                            setOpenTool(null);
                          }
                        } else {
                          setAdjustMenuSlotKey(slotKey);
                        }
                      }}
                      title="Décaler l'horaire, regrouper, annuler (Vie 2) ou revenir en Cycle 1"
                    >
                      ⚙️ Ajuster {isAdjustOpen ? '▲' : '▼'}
                    </button>
                  )}
                </>
              )}

              {onOpenObservationModal && (
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '5px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#0369a1',
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
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
                  title="Saisir le REX complet de la séance (hauteurs d'eau, chars, météo)"
                >
                  📝 REX
                </button>
              )}
            </div>

            {/* Horaire Cycle 1 / Cycle 2 */}
            <div style={{ minWidth: '130px', textAlign: 'right' }}>
              {isShifted && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', textDecoration: 'line-through', fontWeight: 700 }}>
                  C1 : {startTimeStr} - {endTimeStr}
                </div>
              )}
              <div
                style={{
                  fontSize: '1.2rem',
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  color:
                    c2Status === 'cancelled_weather'
                      ? '#991b1b'
                      : c2Status === 'merged'
                      ? '#6d28d9'
                      : c2Status === 'shifted'
                      ? '#b45309'
                      : inCycle2
                      ? '#14532d'
                      : '#0f172a',
                  textDecoration:
                    c2Status === 'cancelled_weather' || c1Status === 'closed_no_bookings'
                      ? 'line-through'
                      : 'none',
                }}
              >
                {displayStart} - {displayEnd}
              </div>
            </div>
          </div>
        </div>

        {/* MENU DÉPLIANT ⚙️ AJUSTER : Décaler / Regrouper / Annuler (Vie 2) / Revenir C1 */}
        {inCycle2 && isAdjustOpen && !isReadOnly && onCycle2Action && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
              padding: '8px 10px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
            }}
          >
            <span style={{ fontSize: '0.70rem', fontWeight: 800, color: '#475569', marginRight: '4px' }}>
              Actions Cycle 2 :
            </span>
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                padding: '5px 9px',
                fontSize: '0.72rem',
                fontWeight: 800,
                color: isToolOpen('shift') ? '#fff' : '#b45309',
                background: isToolOpen('shift') ? '#d97706' : '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              onClick={() =>
                setOpenTool(isToolOpen('shift') ? null : { slotKey, mode: 'shift' })
              }
              title="Décaler l'horaire en conservant l'heure Cycle 1 d'origine"
            >
              🕒 Décaler
            </button>

            {mergeTargets.length > 0 && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  padding: '5px 9px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: isToolOpen('merge') ? '#fff' : '#6d28d9',
                  background: isToolOpen('merge') ? '#7c3aed' : '#f3e8ff',
                  border: '1px solid #d8b4fe',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
                onClick={() =>
                  setOpenTool(isToolOpen('merge') ? null : { slotKey, mode: 'merge' })
                }
                title="Regrouper les inscrits sur un autre créneau (max 12 chars)"
              >
                🔗 Regrouper
              </button>
            )}

            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                padding: '5px 9px',
                fontSize: '0.72rem',
                fontWeight: 800,
                color: isToolOpen('cancel_weather') ? '#fff' : '#dc2626',
                background: isToolOpen('cancel_weather') ? '#dc2626' : '#fff',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              onClick={() => {
                setCancelReason(
                  x.ok === false ? 'Vent trop fort / rafales' : C2_WEATHER_REASONS[0]
                );
                setCancelRescheduled(effectiveChars);
                setCancelLost(0);
                setOpenTool(
                  isToolOpen('cancel_weather')
                    ? null
                    : { slotKey, mode: 'cancel_weather' }
                );
              }}
              title="Annuler la séance pour météo ou terrain (Vie 2)"
            >
              ⛔ Annuler (Vie 2)
            </button>

            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                padding: '5px 9px',
                fontSize: '0.70rem',
                fontWeight: 700,
                color: '#64748b',
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              onClick={() => {
                onCycle2Action(f, x, { type: 'reset_to_cycle1' });
                setOpenTool(null);
                setAdjustMenuSlotKey(null);
              }}
              title="Revenir à l'état Cycle 1 (sans décision tactique)"
            >
              ↩ Revenir C1
            </button>
          </div>
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
            ⚠️ Attention : {effectiveChars} chars engagés sur ce créneau, au-dessus du plafond de{' '}
            {slotMaxChars} chars max
            {secondaryInstructor
              ? ` (${primaryInstructor} + ${secondaryInstructor})`
              : ' (1 moniteur — utilisez « + Doubler » si un 2e moniteur encadre)'}
            .
          </div>
        )}

        {/* ALERTE PARC MATÉRIEL DISTINCTE MONOPLACES / BIPLACES (Q3 opt_b) */}
        {(fleetAlerts.monoOver || fleetAlerts.biOver) && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background: '#fff7ed',
              border: '1px solid #fdba74',
              color: '#9a3412',
              fontSize: '0.74rem',
              fontWeight: 800,
            }}
          >
            ⚠️ Parc matériel dépassé :{' '}
            {fleetAlerts.monoOver
              ? `${effectiveMono} monoplaces réservés > ${fleetAlerts.parkMaxMono} max utilisables`
              : ''}
            {fleetAlerts.monoOver && fleetAlerts.biOver ? ' · ' : ''}
            {fleetAlerts.biOver
              ? `${effectiveBi} biplaces réservés > ${fleetAlerts.parkMaxBi} max utilisables`
              : ''}
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
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => {
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
                        border: `1.5px solid ${pSt.bd}`,
                        background: pSt.bg,
                        color: pSt.fg,
                        fontWeight: 900,
                        fontSize: '0.73rem',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ {preset.label}
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
                {secondaryInstructor && (
                  <button
                    type="button"
                    onClick={() => {
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
                      cursor: 'pointer',
                    }}
                  >
                    🗑️ Retirer {secondaryInstructor}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!doubleName.trim()}
                  onClick={() => {
                    if (!doubleName.trim()) return;
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
                    background: doubleName.trim() ? '#7c3aed' : '#94a3b8',
                    color: '#fff',
                    fontWeight: 800,
                    cursor: doubleName.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  ✓ Valider doublement ({MAX_CHARS_PER_INSTRUCTOR + doubleAddChars} chars)
                </button>
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

        {/* PANNEAU INLINE 1 : SAISIE RAPIDE MONO/BI SI MAINTENU SANS FICHE CLIENT */}
        {isToolOpen('confirm_chars') && !isReadOnly && onCycle2Action && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#f0fdf4',
              border: '1.5px solid #86efac',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              fontSize: '0.76rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <strong style={{ color: '#166534' }}>
                ⚡ Déclencher Cycle 2 (≥ 1 char requis, max {MAX_CHARS_PER_INSTRUCTOR}) :
              </strong>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                Mono :
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={confirmMono}
                  onChange={e => setConfirmMono(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '54px', padding: '4px', borderRadius: '4px', border: '1px solid #86efac', fontWeight: 800 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                Bi :
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={confirmBi}
                  onChange={e => setConfirmBi(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '54px', padding: '4px', borderRadius: '4px', border: '1px solid #86efac', fontWeight: 800 }}
                />
              </label>
              <span style={{ fontWeight: 800, color: confirmMono + confirmBi > 12 ? '#dc2626' : '#15803d' }}>
                = {confirmMono + confirmBi} / {MAX_CHARS_PER_INSTRUCTOR} chars ({confirmMono + confirmBi * 2} pers.)
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                disabled={confirmMono + confirmBi < 1}
                onClick={() => {
                  const total = confirmMono + confirmBi;
                  if (total < 1) return;
                  onCycle2Action(f, x, {
                    type: 'confirm',
                    monoCount: confirmMono,
                    biCount: confirmBi,
                    pilotsCount: confirmMono + confirmBi * 2,
                    instructor: 'Jérôme',
                  });
                  setOpenTool(null);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: confirmMono + confirmBi >= 1 ? '#16a34a' : '#94a3b8',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: confirmMono + confirmBi >= 1 ? 'pointer' : 'not-allowed',
                }}
              >
                ✓ Confirmer en Cycle 2
              </button>
              <button
                type="button"
                onClick={() => setOpenTool(null)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* PANNEAU INLINE 2 : DÉCALAGE HORAIRE */}
        {isToolOpen('shift') && !isReadOnly && onCycle2Action && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#fffbeb',
              border: '1.5px solid #fcd34d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '0.76rem',
            }}
          >
            <div>
              <strong style={{ color: '#92400e' }}>
                🕒 Décaler depuis Cycle 1 ({startTimeStr} – {endTimeStr}) :
              </strong>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[-30, -15, 0, 15, 30, 45].map(delta => (
                <button
                  key={delta}
                  type="button"
                  onClick={() => {
                    onCycle2Action(f, x, {
                      type: 'shift',
                      shiftMinutes: delta,
                      newStart: shiftTimeString(startTimeStr, delta),
                      newEnd: shiftTimeString(endTimeStr, delta),
                    });
                    setOpenTool(null);
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid #f59e0b',
                    background: delta === 0 ? '#fff' : '#fef3c7',
                    color: '#92400e',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {delta === 0 ? 'Heure C1 d’origine' : delta > 0 ? `+${delta} min` : `${delta} min`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOpenTool(null)}
                style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* PANNEAU INLINE 3 : REGROUPEMENT / FUSION */}
        {isToolOpen('merge') && !isReadOnly && onCycle2Action && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#faf5ff',
              border: '1.5px solid #d8b4fe',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '0.76rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#6d28d9' }}>
                🔗 Regrouper ces {effectiveChars} char(s) sur un autre créneau de la journée :
              </strong>
              <button
                type="button"
                onClick={() => setOpenTool(null)}
                style={{ padding: '3px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                Fermer
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {mergeTargets.map(tgt => (
                <button
                  key={tgt.slotKey}
                  type="button"
                  onClick={() => {
                    onCycle2Action(f, x, {
                      type: 'merge',
                      targetSlotKey: tgt.slotKey,
                      targetLabel: tgt.label,
                    });
                    setOpenTool(null);
                  }}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: tgt.overMax ? '1.5px solid #ef4444' : '1.5px solid #a855f7',
                    background: tgt.overMax ? '#fef2f2' : '#ffffff',
                    color: tgt.overMax ? '#991b1b' : '#581c87',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ➔ {tgt.label} ({effectiveChars} + {tgt.oChars} = {tgt.combined}/{tgt.maxTargetChars} chars{tgt.overMax ? ' ⚠️' : ''})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PANNEAU INLINE 4 : ANNULATION MÉTÉO / TERRAIN (VIE 2) */}
        {isToolOpen('cancel_weather') && !isReadOnly && onCycle2Action && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1.5px solid #fca5a5',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '0.76rem',
            }}
          >
            <strong style={{ color: '#991b1b' }}>
              ⛔ Annulation Météo / Terrain (Vie 2) · Bilan commercial des {effectiveChars} char(s) inscrits :
            </strong>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #fca5a5', fontWeight: 700, background: '#fff' }}
              >
                {C2_WEATHER_REASONS.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#166534' }}>
                Chars replacés :
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={cancelRescheduled}
                  onChange={e => setCancelRescheduled(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '52px', padding: '4px', borderRadius: '4px', border: '1px solid #86efac', fontWeight: 800 }}
                />
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#991b1b' }}>
                Chars perdus :
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={cancelLost}
                  onChange={e => setCancelLost(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '52px', padding: '4px', borderRadius: '4px', border: '1px solid #fca5a5', fontWeight: 800 }}
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  onCycle2Action(f, x, {
                    type: 'cancel_weather',
                    reason: cancelReason,
                    rescheduledChars: cancelRescheduled,
                    lostChars: cancelLost,
                  });
                  setOpenTool(null);
                }}
                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
              >
                Confirmer Vie 2
              </button>

              <button
                type="button"
                onClick={() => setOpenTool(null)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderVBox = (f: DayFocusData) => {
    const v = vstat(f, validations);
    let msg: React.ReactNode = null;

    if (v.st === 'none') {
      msg = (
        <>
          ⏳ En attente de validation Cycle 1 pour cette journée ({f.list.length} créneau
          {f.list.length > 1 ? 'x' : ''} proposé{f.list.length > 1 ? 's' : ''}). La validation s&apos;effectue dans l&apos;onglet <b>Validation des créneaux de roulage</b>.
        </>
      );
    } else if (v.st === 'ok') {
      msg = (
        <>
          ✅ <b>{v.valCount} à publier (C1)</b>
          {v.notPublishedCount ? ` · 🚫 ${v.notPublishedCount} non publié${v.notPublishedCount > 1 ? 's' : ''}` : ''}
          {v.cycle2Count > 0 ? ` · ⚡ ${v.cycle2Count} en Cycle 2` : ''}
          {v.closedNoBookingsCount > 0 ? ` · 🌑 ${v.closedNoBookingsCount} Vie 1` : ''} (sur {v.totalCount}) le{' '}
          {new Date(v.V.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
        </>
      );
    } else {
      msg = (
        <>
          ⚠️ <b>Cycle 2 impacté : prévisions / marées modifiées</b> depuis l&apos;enregistrement du{' '}
          {new Date(v.V.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
          {v.add.length > 0 && (
            <>
              <br />
              Ajouté :{' '}
              {v.add
                .map(x => `${lc(x.a, f.y, f.m, f.d)} - ${lc(x.b, f.y, f.m, f.d)}`)
                .join(' ; ')}
            </>
          )}
          {v.rem.length > 0 && (
            <>
              <br />
              Retiré : {v.rem.map(x => `${x.s} - ${x.e}`).join(' ; ')}
            </>
          )}
          {v.kchg && (
            <>
              <br />
              Verdict : {VC[v.V.k][1].toLowerCase()} → {VC[f.k][1].toLowerCase()}
            </>
          )}
        </>
      );
    }

    return (
      <div className="note" style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>{msg}</div>
        <button
          type="button"
          className="fbtn"
          style={{
            margin: 0,
            background: '#f8fafc',
            color: '#0369a1',
            border: '1px solid #bae6fd',
            fontWeight: 800,
          }}
          onClick={() => onSelectDayInCalendar(f.ds)}
          title="Ouvrir cette journée dans l'onglet Validation des créneaux de roulage (Cycle 1)"
        >
          📅 Ouvrir en Validation C1
        </button>
      </div>
    );
  };

  return (
    <div id="tab2">
      {onValidateDay && onClearValidation && (
        <DayCycle1Banner
          selectedDate={currentDs}
          settings={settings}
          W={tideW}
          first={first}
          last={last}
          windList={windList}
          customSlotsMap={customSlotsMap}
          validations={validations}
          onValidateDay={onValidateDay}
          onClearValidation={onClearValidation}
          onAddCustomNonPublishReason={reason => onAddCustomNonPublishReason?.(reason)}
          onNavigateDay={shiftFocusDate}
          canPrevDay={currentDs > minDs}
          canNextDay={currentDs < maxDs}
          hideOpenCycle2Button={true}
          onOpenCycle1Detail={onSelectDayInCalendar}
          isReadOnly={isReadOnly}
        />
      )}

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
              const logsCount = getStoredWaterlineLogs().length;
              const isDemo =
                typeof window !== 'undefined' &&
                localStorage.getItem('cv_demo_mode_reel_unlocked') === 'true';
              const isUnlocked = logsCount >= 300 || isDemo;
              if (!isUnlocked) return null;
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
                    📐 Théorique
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
                    ✨ Mode Réel
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

        <div className="vd" style={{ background: VC[currentFocus.k][0] }}>
          <b>{VC[currentFocus.k][1]}</b>
          <span>
            {currentFocus.why}
            {currentFocus.glob ? ' (modèle global, indicatif)' : ''}
          </span>
        </div>

        <div className="note" style={{ marginTop: '10px', marginBottom: '10px', lineHeight: 1.4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            {currentFocus.rng ? (
              <>
                💨 <b>Vent prévu sur les créneaux :</b> {currentFocus.rng}{' '}
                {currentFocus.glob ? '(modèle global)' : '(AROME Météo-France)'}
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

        {frontalSwellAdvisory && (
          <div
            style={{
              padding: '7px 11px',
              borderRadius: '8px',
              background: '#eff6ff',
              border: '1.5px solid #93c5fd',
              color: '#1e40af',
              fontSize: '0.74rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              marginBottom: '10px',
            }}
          >
            <span>🌊</span>
            <span>
              Houle frontale ({frontalSwellAdvisory.dirComp} {frontalSwellAdvisory.maxHeightM.toFixed(1).replace('.', ',')} m
              {frontalSwellAdvisory.periodS != null ? ` · ${frontalSwellAdvisory.periodS}s` : ''}) ≥ 1,5 m : prévoir une marge indicative de{' '}
              <b>+10 à +15 cm</b> sur le seuil L ({settings.L.toFixed(2).replace('.', ',')} m ➔{' '}
              {(settings.L - frontalSwellAdvisory.recommendedMarginCm / 100).toFixed(2).replace('.', ',')} m effectifs).
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
        />

        {/* Courbe / Timeline Vent & Rafales heure par heure (identique Cycle 1) */}
        <WindPanel
          dateStr={currentDs}
          settings={settings}
          W={tideW}
          first={first}
          last={last}
          windList={windList}
        />

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
          const valRecordForDay = validations[currentFocus.ds];
          const matchedValKeys = new Set<string>();
          const cycle1ValidatedSlots: Array<{
            x: SessionItem;
            slotKey: string;
            valItem: ReturnType<typeof findMatchingValidationItem>;
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
              cycle1ValidatedSlots.push({ x, slotKey, valItem });
            }
          }

          const validatedKeySet = new Set(cycle1ValidatedSlots.map(item => item.slotKey));
          const hiddenSlotsCount = currentFocus.list.length - cycle1ValidatedSlots.length;
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
                {hiddenSlotsCount > 0 ? ` / ${currentFocus.list.length}` : ''}) · Jauge max{' '}
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
                  {cycle1ValidatedSlots.map((item, idx) =>
                    renderSessRow(currentFocus, item.x, `f-${idx}`, item.valItem, validatedKeySet)
                  )}
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
                    📅 Valider les créneaux en Cycle 1
                  </button>
                </div>
              ) : (
                <div className="fs">
                  <div>
                    <b>Aucune séance possible</b>
                    <small>Marée haute ou hors plage d&apos;ouverture</small>
                  </div>
                </div>
              )}
              {(cycle1ValidatedSlots.length > 0 || Boolean(validations[currentFocus.ds])) && renderVBox(currentFocus)}
            </>
          );
        })()}

        {onUpdateCustomSlots && (
          <CustomSlotsManager
            dateStr={currentDs}
            settings={settings}
            windList={windList}
            customSlotsMap={customSlotsMap}
            onUpdateCustomSlots={onUpdateCustomSlots}
            onCreateAndPublishSlot={
              onCreateAndPublishCustomSlot
                ? (ds, slot) => {
                    onCreateAndPublishCustomSlot(ds, slot);
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
          />
        )}

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

      {/* Tableau mensuel et courbe de marnage cliquable */}
      <TableView
        year={year}
        month={month}
        settings={settings}
        EX={EX}
        W={tideW}
        first={first}
        last={last}
        windList={windList}
      />

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
        <label>
          Séances minimum pour « ouvrir » la journée
          <input
            type="text"
            inputMode="decimal"
            value={settings.fmin}
            onChange={(e) => {
              const val = parseFloat(e.target.value.replace(',', '.'));
              onUpdateSettings({ fmin: isNaN(val) || val < 1 ? 3 : val });
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
          parkMaxMono={settings.parkMaxMono}
          parkMaxBi={settings.parkMaxBi}
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
