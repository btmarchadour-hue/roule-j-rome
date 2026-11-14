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
  dayWind,
  exportValidCsv,
  lc,
  p2,
  plan,
  sw,
  toU,
  VC,
  vstat,
  tdy,
  wtxt,
} from '../utils/tides';
import { AgendaBookingItem } from '../utils/firebaseSync';
import {
  buildReservationKey,
  Cycle1SlotAction,
  DEFAULT_NON_PUBLISH_REASONS,
  findMatchingValidationItem,
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getSlotBookingsSummary,
  getValidationItemChars,
  hasCycle2Trigger,
} from '../utils/cycleHelpers';
import { CurveChart } from './CurveChart';
import { CustomSlotsManager } from './CustomSlotsManager';
import { SlotBookingsModal } from './SlotBookingsModal';
import { CALENDAR_INDICATOR_COLORS, getFrenchHolidayInfo, HOLIDAY_ZONE_COLORS } from '../utils/frenchHolidays';
import { WindPanel } from './WindPanel';

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
  }) => void;
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
  onClearValidation: rawOnClearValidation,
  onSetSlotCycle1Action: rawOnSetSlotCycle1Action,
  onAddCustomNonPublishReason,
  onNavigateDay,
  canPrevDay = false,
  canNextDay = false,
  onOpenCycle2,
  onOpenObservationModal,
  isReadOnly = false,
}) => {
  const onValidateDay = isReadOnly ? undefined : rawOnValidateDay;
  const onClearValidation = isReadOnly ? undefined : rawOnClearValidation;
  const onSetSlotCycle1Action = isReadOnly ? undefined : rawOnSetSlotCycle1Action;
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
  const DW = dayWind(y, m, d, settings, tideW, first, last, windList);

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
  } | null>(null);
  const [dayNonPublishOpen, setDayNonPublishOpen] = useState(false);
  const [selectedDayReason, setSelectedDayReason] = useState<string>(DEFAULT_NON_PUBLISH_REASONS[0]);
  const [customDayReasonInput, setCustomDayReasonInput] = useState('');
  const [activeSlotReasonIdx, setActiveSlotReasonIdx] = useState<number | null>(null);
  const [customSlotReasonInput, setCustomSlotReasonInput] = useState('');

  const availableNonPublishReasons = React.useMemo(() => {
    const base = [...DEFAULT_NON_PUBLISH_REASONS];
    const custom = settings.customNonPublishReasons || [];
    const seen = new Set(base.map(r => r.toLowerCase()));
    const result: string[] = [...base];
    for (const c of custom) {
      const trimmed = c.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
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
    title?: string;
    lim: string;
    over: number;
    side: string;
  };

  let allSlots: SlotItem[] = [];

  if (replaceDefault) {
    allSlots = customCfg.slots.map(cs => {
      const [sh, sm] = cs.start.split(':').map(Number);
      const [eh, em] = cs.end.split(':').map(Number);
      return {
        a: toU(y, m, d, sh * 60 + sm),
        b: toU(y, m, d, eh * 60 + em),
        isOpt: false,
        isCustom: true,
        title: cs.title,
        lim: '',
        over: 0,
        side: '',
      };
    });
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
      const customItems: SlotItem[] = customCfg.slots.map(cs => {
        const [sh, sm] = cs.start.split(':').map(Number);
        const [eh, em] = cs.end.split(':').map(Number);
        return {
          a: toU(y, m, d, sh * 60 + sm),
          b: toU(y, m, d, eh * 60 + em),
          isOpt: false,
          isCustom: true,
          title: cs.title,
          lim: '',
          over: 0,
          side: '',
        };
      });
      allSlots = defaultSlots.concat(customItems).sort((p, q) => p.a - q.a);
    } else {
      allSlots = defaultSlots.sort((p, q) => p.a - q.a);
    }
  }

  const focusData = dayFocus(selectedDate, settings, tideW, first, last, windList, customSlotsMap);
  const valInfo = vstat(focusData, validations);
  const isPast = selectedDate < tdy();

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
      return customCfg.slots.map(cs => ({ ...cs }));
    }
    return allSlots.map((s, i) => ({
      id: `c1-${selectedDate}-${i}-${Math.round(s.a)}`,
      start: lc(s.a, y, m, d).replace('h', ':'),
      end: lc(s.b, y, m, d).replace('h', ':'),
      title: s.title || (s.isOpt ? `Optionnel (+${s.over} min)` : `Séance ${i + 1}`),
      places: MAX_CHARS_PER_INSTRUCTOR,
    }));
  };

  const handleShiftSlotTime = (idx: number, deltaMinutes: number) => {
    if (isReadOnly) return;
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

    nextList[idx] = {
      ...target,
      start: formatHHMM(nextStart),
      end: formatHHMM(nextEnd),
    };
    onUpdateCustomSlots(selectedDate, true, nextList);
  };

  const handleSaveInlineSlotEdit = (idx: number) => {
    if (isReadOnly || !inlineEdit || inlineEdit.date !== selectedDate || inlineEdit.idx !== idx) {
      return;
    }
    const sMin = parseHHMM(inlineEdit.start);
    const eMin = parseHHMM(inlineEdit.end);
    if (eMin <= sMin) return;

    const nextList = buildEditableSlotsList();
    if (!nextList[idx]) return;
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

          {!isReadOnly && !isPast && (
            <button
              type="button"
              onClick={() => {
                setIsCustomSlotsOpen(true);
                const el = document.getElementById('custom-slots-section');
                el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
              title="Redéfinir manuellement les créneaux prédéfinis pour une souplesse totale"
            >
              <span>✏️</span>
              <span>MODIFIER LES CRÉNEAUX</span>
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

      <WindPanel
        dateStr={selectedDate}
        settings={settings}
        W={tideW}
        first={first}
        last={last}
        windList={windList}
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

      {/* Bloc Cycle 1 : Offre Commerciale Jour par Jour */}
      <div
        style={{
          marginTop: '16px',
          marginBottom: '14px',
          padding: '12px 14px',
          borderRadius: '10px',
          background:
            valInfo.st === 'ok'
              ? 'var(--okbg, #f0fdf4)'
              : !isPast && valInfo.st === 'chg'
              ? '#fffbeb'
              : 'var(--card, #fff)',
          border:
            valInfo.st === 'ok'
              ? '2px solid var(--ok, #16a34a)'
              : !isPast && valInfo.st === 'chg'
              ? '2px solid #f59e0b'
              : '1px solid var(--bd, #e5e7eb)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>
              {isPast
                ? valInfo.st === 'ok'
                  ? '📜'
                  : '⏳'
                : valInfo.cycle2Count > 0
                ? '⚡'
                : valInfo.st === 'ok'
                ? '📅'
                : valInfo.st === 'chg'
                ? '⚠️'
                : '📋'}
            </span>
            <div>
              <div
                style={{
                  fontWeight: 900,
                  fontSize: '0.88rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {isPast
                  ? valInfo.st === 'ok'
                    ? `Archive · ${valInfo.valCount} publié${valInfo.valCount > 1 ? 's' : ''}${
                        valInfo.notPublishedCount ? ` · 🚫 ${valInfo.notPublishedCount} non publié${valInfo.notPublishedCount > 1 ? 's' : ''}` : ''
                      }${
                        valInfo.closedNoBookingsCount ? ` · ${valInfo.closedNoBookingsCount} Vie 1` : ''
                      } (sur ${valInfo.totalCount})`
                    : 'Journée passée'
                  : valInfo.st === 'chg'
                  ? `Cycle 2 impacté : Prévisions / marées modifiées (${valInfo.cycle2Count} créneau${valInfo.cycle2Count > 1 ? 'x' : ''} inscrit${valInfo.cycle2Count > 1 ? 's' : ''})`
                  : valInfo.st === 'ok'
                  ? `Cycle 1 · ${valInfo.valCount} à publier${
                      valInfo.notPublishedCount ? ` · 🚫 ${valInfo.notPublishedCount} non publié${valInfo.notPublishedCount > 1 ? 's' : ''}` : ''
                    }${
                      valInfo.cycle2Count ? ` · ⚡ ${valInfo.cycle2Count} en Cycle 2` : ''
                    }${valInfo.closedNoBookingsCount ? ` · 🌑 ${valInfo.closedNoBookingsCount} Vie 1` : ''}`
                  : 'Cycle 1 · En attente de validation (C1)'}
              </div>
              {!isPast && valInfo.st === 'none' && (
                <div style={{ marginTop: '4px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: '#fffbeb',
                      color: '#92400e',
                      border: '1px solid #fcd34d',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      fontWeight: 800,
                      fontSize: '0.72rem',
                    }}
                  >
                    <span>⏳</span>
                    <span>EN ATTENTE DE VALIDATION (C1)</span>
                  </span>
                </div>
              )}
              <div style={{ fontSize: '0.74rem', color: 'var(--mu, #666)' }}>
                {isPast
                  ? valInfo.st === 'ok'
                    ? `Journée passée (verrouillée) · Enregistré le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`
                    : 'Journée passée · Archive non modifiable en Cycle 1'
                  : valInfo.st === 'ok'
                  ? `Publié le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })} · Repositionnable tant qu'il y a 0 inscrit · Bascule Cycle 2 dès 1 char`
                  : valInfo.st === 'chg'
                  ? `Créneaux engagés (Cycle 2) modifiés · Basculez vers Adaptation météo & décisions pour ajuster`
                  : `${allSlots.length} créneau${allSlots.length > 1 ? 'x' : ''} calculé${
                      allSlots.length > 1 ? 's' : ''
                    } selon la marée · Ajustable pendant toute la vie du Cycle 1 (0 inscrit)`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {isReadOnly && (
              <span
                style={{
                  background: '#fffbeb',
                  border: '1.5px solid #fde68a',
                  color: '#92400e',
                  padding: '5px 11px',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>🔒</span>
                <span>Mode Moniteur : Lecture seule</span>
              </span>
            )}

            {isPast && (
              <span
                style={{
                  background: '#f1f5f9',
                  border: '1.5px solid #cbd5e1',
                  color: '#475569',
                  padding: '5px 11px',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>🔒</span>
                <span>Journée passée · Verrouillée en Cycle 1</span>
              </span>
            )}

            {!isPast && onValidateDay && allSlots.length > 0 && (
              <>
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    background:
                      valInfo.st === 'ok' && valInfo.valCount > 0 && valInfo.notPublishedCount === 0
                        ? '#16a34a'
                        : valInfo.st === 'chg'
                        ? '#f59e0b'
                        : 'var(--ac, #ffc40d)',
                    color:
                      (valInfo.st === 'ok' && valInfo.valCount > 0 && valInfo.notPublishedCount === 0) || valInfo.st === 'chg'
                        ? '#fff'
                        : '#111',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    padding: '7px 11px',
                    borderRadius: '6px',
                  }}
                  onClick={() => {
                    setDayNonPublishOpen(false);
                    onValidateDay(selectedDate, focusData, 'all');
                  }}
                  title="Marquer tous les créneaux de cette journée « À publier » en Cycle 1"
                >
                  ✅ Tout à publier (C1)
                </button>

                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    background: dayNonPublishOpen || (valInfo.notPublishedCount > 0 && valInfo.valCount === 0) ? '#334155' : '#fff',
                    color: dayNonPublishOpen || (valInfo.notPublishedCount > 0 && valInfo.valCount === 0) ? '#fff' : '#334155',
                    border: '1.5px solid #475569',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    padding: '7px 11px',
                    borderRadius: '6px',
                  }}
                  onClick={() => setDayNonPublishOpen(prev => !prev)}
                  title="Marquer cette journée « À ne pas publier » et choisir la raison (Réunion, Vacances...) pour vos statistiques d'absentéisme"
                >
                  🚫 À ne pas publier
                </button>

                {onNavigateDay && canNextDay && (
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      background: '#0284c7',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      padding: '7px 12px',
                      borderRadius: '6px',
                    }}
                    onClick={() => {
                      setDayNonPublishOpen(false);
                      onValidateDay(selectedDate, focusData, 'all');
                      onNavigateDay(1);
                    }}
                    title="Publier toute cette journée en Cycle 1 puis passer immédiatement au jour suivant"
                  >
                    ✅ À publier &amp; Jour suiv. ➔
                  </button>
                )}
              </>
            )}

            {(allSlots.length === 0 || isPast) && onNavigateDay && canNextDay && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  padding: '7px 12px',
                  borderRadius: '6px',
                }}
                onClick={() => onNavigateDay(1)}
                title="Passer directement au jour suivant"
              >
                {allSlots.length === 0 ? 'Jour suiv. (aucun créneau) ▶' : 'Jour suiv. ▶'}
              </button>
            )}

            {valInfo.cycle2Count > 0 && onOpenCycle2 && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: '#7c3aed',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  padding: '7px 11px',
                  borderRadius: '6px',
                }}
                onClick={() => onOpenCycle2(selectedDate)}
                title="Basculer vers Adaptation météo & décisions (Cycle 2)"
              >
                ⚡ Ouvrir en Cycle 2
              </button>
            )}

            {!isPast && valInfo.st !== 'none' && onClearValidation && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: 'transparent',
                  color: '#dc2626',
                  border: '1px solid #fca5a5',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  padding: '7px 9px',
                  borderRadius: '6px',
                }}
                onClick={() => onClearValidation(selectedDate)}
                title="Réinitialiser toutes les publications et décisions de cette journée"
              >
                ✕ Réinitialiser
              </button>
            )}

            {validations && Object.keys(validations).length > 0 && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: 'var(--cell, #f3f4f6)',
                  color: 'var(--tx, #111)',
                  border: '1px solid var(--bd, #e5e7eb)',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  padding: '7px 9px',
                  borderRadius: '6px',
                }}
                onClick={() => exportValidCsv(validations, MAX_CHARS_PER_INSTRUCTOR)}
                title="Exporter toutes les séances enregistrées (CSV)"
              >
                📥 Exporter CSV
              </button>
            )}
          </div>
        </div>

        {/* Sélecteur de raison de non-publication sur toute la journée */}
        {!isPast && dayNonPublishOpen && onValidateDay && allSlots.length > 0 && (
          <div
            style={{
              marginTop: '12px',
              padding: '12px 14px',
              background: '#f8fafc',
              border: '1.5px solid #475569',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 900, color: '#0f172a', marginBottom: '8px' }}>
              🚫 Raison de non-publication pour la journée (comptabilisée en absentéisme plage hors météo/clients/plage) :
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {availableNonPublishReasons.map(reason => {
                const isSel = selectedDayReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setSelectedDayReason(reason)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: isSel ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                      background: isSel ? '#334155' : '#fff',
                      color: isSel ? '#fff' : '#334155',
                      fontSize: '0.74rem',
                      fontWeight: isSel ? 800 : 600,
                      cursor: 'pointer',
                    }}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
              <input
                type="text"
                value={customDayReasonInput}
                onChange={e => setCustomDayReasonInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && customDayReasonInput.trim()) {
                    e.preventDefault();
                    const trimmed = customDayReasonInput.trim();
                    onAddCustomNonPublishReason?.(trimmed);
                    setSelectedDayReason(trimmed);
                    setCustomDayReasonInput('');
                  }
                }}
                placeholder="Ajouter une nouvelle raison (ex: Formation BPJEPS, RDV pro...)"
                style={{
                  flex: '1 1 220px',
                  padding: '6px 10px',
                  fontSize: '0.76rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                }}
              />
              <button
                type="button"
                disabled={!customDayReasonInput.trim()}
                onClick={() => {
                  const trimmed = customDayReasonInput.trim();
                  if (!trimmed) return;
                  onAddCustomNonPublishReason?.(trimmed);
                  setSelectedDayReason(trimmed);
                  setCustomDayReasonInput('');
                }}
                style={{
                  padding: '6px 11px',
                  borderRadius: '6px',
                  border: 'none',
                  background: customDayReasonInput.trim() ? '#0284c7' : '#cbd5e1',
                  color: '#fff',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  cursor: customDayReasonInput.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                + Ajouter raison
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  onValidateDay(selectedDate, focusData, 'not_published', selectedDayReason);
                  setDayNonPublishOpen(false);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#334155',
                  color: '#fff',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🚫 Confirmer « À ne pas publier » ({selectedDayReason})
              </button>

              {onNavigateDay && canNextDay && (
                <button
                  type="button"
                  onClick={() => {
                    onValidateDay(selectedDate, focusData, 'not_published', selectedDayReason);
                    setDayNonPublishOpen(false);
                    onNavigateDay(1);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0f172a',
                    color: '#fff',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🚫 Appliquer &amp; Jour suiv. ➔
                </button>
              )}

              <button
                type="button"
                onClick={() => setDayNonPublishOpen(false)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#475569',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Alerte uniquement si Cycle 2 actif ou dérive horaire de marée (Cycle 1 pur reste immunisé) */}
        {!isPast && valInfo.st === 'chg' && (valInfo.cycle2Count > 0 || valInfo.rem.length > 0) && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 10px',
              background: '#fef3c7',
              borderRadius: '6px',
              fontSize: '0.76rem',
              color: '#92400e',
              lineHeight: 1.4,
            }}
          >
            <b>Alerte Cycle 2 (créneaux avec inscrits ou horaires modifiés) :</b>
            {valInfo.add.length > 0 && (
              <div>
                ➕ Ajout :{' '}
                {valInfo.add.map(x => `${lc(x.a, y, m, d)} - ${lc(x.b, y, m, d)}`).join(' ; ')}
              </div>
            )}
            {valInfo.rem.length > 0 && (
              <div>
                ➖ Retiré : {valInfo.rem.map(x => `${x.s} - ${x.e}`).join(' ; ')}
              </div>
            )}
            {valInfo.kchg && (
              <div>
                Verdict météo : {VC[valInfo.V.k][1]} → {VC[focusData.k][1]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sessions list */}
      <div className="ps" style={{ marginTop: '12px' }}>
        {replaceDefault
          ? `Séances sur mesure (${allSlots.length})`
          : `Séances proposées (${SS.length}${
              XS.length ? ` + ${XS.length} optionnel${XS.length > 1 ? 's' : ''}` : ''
            }${hasCustom ? ` + ${customCfg.slots.length} sur-mesure` : ''})`}
        {` · jauge max ${MAX_CHARS_PER_INSTRUCTOR} chars / moniteur (Mono + Bi)`}
      </div>

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
          const bookingSummary = getSlotBookingsSummary(slotBookings);
          const itemChars = getValidationItemChars(valItem);
          const effectiveChars =
            bookingSummary.totalChars > 0 ? bookingSummary.totalChars : itemChars.totalChars;
          const effectiveMono =
            bookingSummary.totalChars > 0 ? bookingSummary.monoCount : itemChars.mono;
          const effectiveBi =
            bookingSummary.totalChars > 0 ? bookingSummary.biCount : itemChars.bi;
          const effectivePeople =
            bookingSummary.totalChars > 0 ? bookingSummary.totalPeople : itemChars.people;
          const isOverCapacity = effectiveChars > MAX_CHARS_PER_INSTRUCTOR;

          const c1Status = getEffectiveCycle1Status(valItem);
          const inCycle2 = hasCycle2Trigger(valItem, bookingSummary.totalChars);
          const c2Status = getEffectiveCycle2Status(valItem, bookingSummary.totalChars);

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

          const displayStart = valItem?.actualStart || startTimeStr;
          const displayEnd = valItem?.actualEnd || endTimeStr;
          const isShifted =
            c2Status === 'shifted' &&
            Boolean(valItem?.actualStart) &&
            (valItem?.actualStart !== startTimeStr || valItem?.actualEnd !== endTimeStr);

          const cardBg =
            c2Status === 'cancelled_weather'
              ? '#fef2f2'
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
              : c1Status === 'not_published'
              ? '#475569'
              : c1Status === 'closed_no_bookings'
              ? '#64748b'
              : inCycle2
              ? '#16a34a'
              : c1Status === 'published'
              ? '#0284c7'
              : '#94a3b8';

          const isPickingReason = activeSlotReasonIdx === idx && !isReadOnly && !isPast && !inCycle2;

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
                          ? 'CYCLE 2 · RÉALISÉ'
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
                        {effectiveChars} / {MAX_CHARS_PER_INSTRUCTOR} chars
                      </span>
                      {(effectiveMono > 0 || effectiveBi > 0) && (
                        <span style={{ fontWeight: 700, opacity: 0.85 }}>
                          ({effectiveMono}M+{effectiveBi}B · {effectivePeople}p)
                        </span>
                      )}
                    </span>

                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        padding: '2px 7px',
                        borderRadius: '5px',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                      }}
                    >
                      <span>👨‍🏫</span>
                      <span>Jérôme</span>
                    </span>
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
                      <span>🚗 0 / {MAX_CHARS_PER_INSTRUCTOR} chars · En attente 1ère résa</span>
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
                      <span>Motif : {valItem?.nonPublishReason || 'Indisponibilité personnelle'}</span>
                    </span>
                  </>
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
                      fontSize: '0.76rem',
                    }}
                  >
                    <span>🌑</span>
                    <span>FERMÉ · FAUTE D&apos;INSCRITS (VIE 1)</span>
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

                {x.isCustom ? (
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '0.72rem' }}>
                    ● SUR MESURE · {x.title}
                  </span>
                ) : x.isOpt ? (
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '0.72rem' }}>
                    ● OPTIONNEL (+{x.over} MIN)
                  </span>
                ) : null}

                <span
                  className={ok === true ? 'chip fg' : ok === false ? 'chip fr' : 'chip k'}
                  style={{ margin: 0 }}
                >
                  {ok === true ? '● VENT OK' : ok === false ? 'VENT HORS PLAGE' : '🌊 Marée seule'}
                </span>
              </div>

              {/* SECTION DROITE : ACTIONS NUMÉRIQUES + REPOSITIONNEMENT C1 + HORAIRE */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
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
                        slotTitle: x.title,
                      })
                    }
                    title="Gérer les réservations et chars sur ce créneau (déclenche Cycle 2 dès 1 char)"
                  >
                    👥 Inscriptions ({effectiveChars}/{MAX_CHARS_PER_INSTRUCTOR})
                  </button>

                  {!isReadOnly && !isPast && onSetSlotCycle1Action && !inCycle2 && (
                    <>
                      <button
                        type="button"
                        className="fbtn"
                        style={{
                          margin: 0,
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: c1Status === 'published' ? '#fff' : '#0369a1',
                          background: c1Status === 'published' ? '#16a34a' : '#fff',
                          border: c1Status === 'published' ? '1px solid #16a34a' : '1.5px solid #0284c7',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          if (activeSlotReasonIdx === idx) setActiveSlotReasonIdx(null);
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
                          color: c1Status === 'not_published' || isPickingReason ? '#fff' : '#334155',
                          background: c1Status === 'not_published' || isPickingReason ? '#334155' : '#fff',
                          border: '1.5px solid #475569',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setActiveSlotReasonIdx(prev => (prev === idx ? null : idx));
                          setCustomSlotReasonInput('');
                        }}
                        title="Marquer « À ne pas publier » et choisir la raison (Réunion, Vacances, etc.) pour les stats"
                      >
                        🚫 À ne pas publier
                      </button>

                      {c1Status === 'published' && (
                        <button
                          type="button"
                          className="fbtn"
                          style={{
                            margin: 0,
                            padding: '5px 8px',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            color: '#475569',
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                          onClick={() => onSetSlotCycle1Action(focusData, sessItem, 'close_no_bookings')}
                          title="Clôturer faute d'inscrits (Vie 1)"
                        >
                          🌑 Vie 1
                        </button>
                      )}

                      {c1Status !== 'unpublished' && (
                        <button
                          type="button"
                          className="fbtn"
                          style={{
                            margin: 0,
                            padding: '5px 7px',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            color: '#64748b',
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            if (activeSlotReasonIdx === idx) setActiveSlotReasonIdx(null);
                            onSetSlotCycle1Action(focusData, sessItem, 'reset');
                          }}
                          title="Remettre ce créneau en attente de décision"
                        >
                          ↩
                        </button>
                      )}
                    </>
                  )}

                  {inCycle2 && onOpenCycle2 && (
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
                      onClick={() => onOpenCycle2(selectedDate)}
                      title="Gérer décalage, regroupement ou météo dans Cycle 2"
                    >
                      ⚡ Gérer Cycle 2
                    </button>
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
                        })
                      }
                      title="Saisir le REX terrain (chars sortis, météo réelle, annulation)"
                    >
                      <span>📝</span>
                      <span>REX</span>
                    </button>
                  )}
                </div>

                {/* Horaire Cycle 1 / Cycle 2 + Repositionnement direct pendant la vie du Cycle 1 */}
                <div style={{ minWidth: '145px', textAlign: 'right' }}>
                  {isShifted && (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', textDecoration: 'line-through', fontWeight: 700 }}>
                      C1 : {startTimeStr} - {endTimeStr}
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
                        onClick={() => setInlineEdit(null)}
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
                            c2Status === 'cancelled_weather'
                              ? '#991b1b'
                              : c1Status === 'not_published'
                              ? '#475569'
                              : c1Status === 'closed_no_bookings'
                              ? '#64748b'
                              : inCycle2
                              ? '#14532d'
                              : c1Status === 'published'
                              ? '#0369a1'
                              : '#0f172a',
                          textDecoration:
                            c2Status === 'cancelled_weather' ||
                            c1Status === 'not_published' ||
                            c1Status === 'closed_no_bookings'
                              ? 'line-through'
                              : 'none',
                        }}
                      >
                        {displayStart} - {displayEnd}
                      </div>

                      {!isReadOnly &&
                        !inCycle2 &&
                        !isPast &&
                        c1Status !== 'closed_no_bookings' &&
                        c1Status !== 'not_published' && (
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
                            title="Avancer le créneau de 15 minutes (Cycle 1, 0 inscrit)"
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
                            title="Décaler le créneau de 15 minutes (Cycle 1, 0 inscrit)"
                          >
                            +15m
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setInlineEdit({
                                date: selectedDate,
                                idx,
                                start: startTimeStr.replace('h', ':'),
                                end: endTimeStr.replace('h', ':'),
                              })
                            }
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
                            title="Saisir l'heure exacte début/fin directement sur ce créneau"
                          >
                            🕒 Ajuster
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

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
                isReadOnly={isReadOnly || isPast}
              />
            )}
          </>
        );
      })()}

      {!allSlots.length && (
        <div className="m">Aucune séance possible pour cette journée.</div>
      )}

      {/* Custom slots manager */}
      <CustomSlotsManager
        dateStr={selectedDate}
        settings={settings}
        windList={windList}
        customSlotsMap={customSlotsMap}
        onUpdateCustomSlots={onUpdateCustomSlots}
        defaultSlots={calculatedDefaultSlots}
        isOpenControlled={isCustomSlotsOpen}
        onToggleOpen={() => setIsCustomSlotsOpen(!isCustomSlotsOpen)}
        isReadOnly={isReadOnly || isPast}
      />

      {/* Wind conditions */}
      {DW.P.length > 0 && (
        <>
          {DW.lvl === -1 ? (
            <div className="m">💨 Vent indisponible (hors ligne ou au-delà de 16 jours)</div>
          ) : (
            <>
              {DW.ws.map((x, i) => (
                <div key={`dw-${i}`} className="m">
                  💨 {lc(DW.P[i][0], y, m, d)}–{lc(DW.P[i][1], y, m, d)} :{' '}
                  {wtxt(x) || 'pas de donnée'}
                </div>
              ))}

              {DW.ws.some(x => x && x.src === 'G') && (
                <div className="m">
                  Au-delà d'environ 2 jours, le vent vient d'un modèle global (moins précis) : indicatif
                </div>
              )}
            </>
          )}
        </>
      )}

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

      <div className="m">
        {EX.filter(p => p.t >= a && p.t < z)
          .map(
            p =>
              (p.pm ? 'PM ' : 'BM ') +
              lc(p.t, y, m, d) +
              ' ' +
              (p.hd != null ? p.hd : p.h).toFixed(2).replace('.', ',') +
              ' m'
          )
          .join('   ·   ')}
      </div>
    </div>
  );
};
