import React, { useMemo, useState } from 'react';
import {
  AppSettings,
  CancellationReason,
  CustomSlotsMap,
  SlotObservation,
  TidePoint,
  ValidationsMap,
  WindPoint,
  WindStat,
} from '../types';
import { AgendaBookingItem } from '../utils/firebaseSync';
import {
  COEF,
  dayFocus,
  kOf,
  lc,
  maxDs,
  minDs,
  tdy,
  toU,
  windAt,
} from '../utils/tides';
import {
  buildReservationKey,
  findMatchingValidationItem,
  getEffectiveCycle1Status,
  getEffectiveCycle2Status,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
} from '../utils/cycleHelpers';
import { classifyWindSector } from '../utils/beachOrientation';
import { computeTideCycleForSlot } from '../utils/waterlineGpsEngine';
import { WindsUpBaliseCard } from './WindsUpBaliseCard';
import { SlotBookingsModal } from './SlotBookingsModal';

interface TerrainBriefingViewProps {
  dateStr: string;
  onChangeDate: (ds: string) => void;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  validations: ValidationsMap;
  bookingsMap: Record<string, AgendaBookingItem[]>;
  customSlotsMap: CustomSlotsMap;
  observations: SlotObservation[];
  isReadOnly?: boolean;
  onSaveSlotBookings?: (
    ds: string,
    slotKey: string,
    slotStart: string,
    slotEnd: string,
    bookings: AgendaBookingItem[]
  ) => void;
  onOpenExpressRex: (ds: string) => void;
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
  }) => void;
  onOpenGpsTab: () => void;
  onSwitchToCockpit: () => void;
}

const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSO',
  'SO',
  'OSO',
  'O',
  'ONO',
  'NO',
  'NNO',
];

function degToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS_16[Math.round(normalized / 22.5) % 16];
}

function shiftDate(ds: string, delta: number): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const out = dt.toISOString().slice(0, 10);
  if (out < minDs) return minDs;
  if (out > maxDs) return maxDs;
  return out;
}

function formatDayTitle(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  const raw = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export const TerrainBriefingView: React.FC<TerrainBriefingViewProps> = ({
  dateStr,
  onChangeDate,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations,
  bookingsMap,
  customSlotsMap,
  observations,
  isReadOnly = false,
  onSaveSlotBookings,
  onOpenExpressRex,
  onOpenObservationModal,
  onOpenGpsTab,
  onSwitchToCockpit,
}) => {
  const [showHiddenSlots, setShowHiddenSlots] = useState(false);
  const [activeBookingSlot, setActiveBookingSlot] = useState<{
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    slotTitle?: string;
    maxChars: number;
    primaryInstructor: string;
    secondaryInstructor?: string;
    secondaryQualification?: 'CQP' | 'DE_BPJEPS';
    secondaryActualEnd?: string;
    secondaryFormula?: string;
  } | null>(null);

  const todayRaw = tdy();
  const todayDs = todayRaw < minDs ? minDs : todayRaw > maxDs ? maxDs : todayRaw;
  const tomorrowDs = shiftDate(todayDs, 1);
  const dayAfterDs = shiftDate(todayDs, 2);

  const focusData = useMemo(
    () =>
      dayFocus(
        dateStr,
        settings,
        tideW,
        first,
        last,
        windList,
        customSlotsMap
      ),
    [dateStr, settings, tideW, first, last, windList, customSlotsMap]
  );

  const dayValidation = validations[dateStr];
  const dayObservations = useMemo(
    () => observations.filter(o => o.ds === dateStr),
    [observations, dateStr]
  );

  const enrichedSlots = useMemo(() => {
    const usedKeys = new Set<string>();
    return focusData.list.map(slot => {
      const slotKey = kOf(slot);
      const slotStart = lc(slot.a, focusData.y, focusData.m, focusData.d);
      const slotEnd = lc(slot.b, focusData.y, focusData.m, focusData.d);
      const valItem = findMatchingValidationItem(
        dayValidation,
        slotKey,
        slotStart,
        slotEnd,
        usedKeys
      );
      if (valItem) usedKeys.add(valItem.k);

      const c1Status = getEffectiveCycle1Status(valItem);
      const isHiddenC1 = c1Status === 'excluded' || c1Status === 'not_published';

      const obs =
        dayObservations.find(o => o.slotKey === slotKey) ||
        dayObservations.find(o => o.slotStart === slotStart);

      const resKey = buildReservationKey(dateStr, valItem?.k || slotKey);
      const bookings =
        bookingsMap[resKey] ||
        bookingsMap[buildReservationKey(dateStr, slotKey)] ||
        [];
      const maxChars = getSlotMaxCapacity(valItem);
      const bookingSummary = getSlotBookingsSummary(bookings, maxChars);
      const c2Status = getEffectiveCycle2Status(valItem, bookingSummary.totalChars, obs);

      const displayStart = valItem?.actualStart || slotStart;
      const displayEnd = valItem?.actualEnd || slotEnd;

      const slotWind: WindStat | null = slot.st;
      const midWindPoint = windAt((slot.a + slot.b) / 2, windList);
      const windSector =
        slotWind != null ? classifyWindSector(slotWind.dir) : null;
      const tideCycle = computeTideCycleForSlot(dateStr, displayStart, settings.les);

      return {
        slot,
        slotKey,
        slotStart,
        slotEnd,
        displayStart,
        displayEnd,
        valItem,
        c1Status,
        c2Status,
        isHiddenC1,
        obs,
        bookings,
        bookingSummary,
        maxChars,
        slotWind,
        waveH: midWindPoint?.wvh ?? null,
        waveP: midWindPoint?.wvp ?? null,
        windSector,
        tideCycle,
        primaryInstructor: valItem?.instructor || 'Jérôme',
        secondaryInstructor: valItem?.secondaryInstructor,
      };
    });
  }, [focusData, dayValidation, dayObservations, dateStr, bookingsMap, windList, settings.les]);

  const activeSlots = useMemo(
    () => enrichedSlots.filter(s => !s.isHiddenC1),
    [enrichedSlots]
  );
  const hiddenCount = enrichedSlots.length - activeSlots.length;
  const visibleSlots = showHiddenSlots ? enrichedSlots : activeSlots;

  const pendingRexCount = useMemo(
    () => activeSlots.filter(s => !s.obs).length,
    [activeSlots]
  );

  const dayLowTides = useMemo(() => {
    const startU = toU(focusData.y, focusData.m, focusData.d, 0);
    const endU = startU + 1440;
    return EX.filter(p => p.pm === 0 && p.t >= startU && p.t < endU);
  }, [EX, focusData.y, focusData.m, focusData.d]);
  const coef = COEF[dateStr];

  const getFeuInfo = (
    ok: boolean | null,
    slotWind: WindStat | null,
    isOffshore: boolean
  ) => {
    if (!slotWind || ok === null) {
      return {
        emoji: '⚪',
        label: 'Sans prévision vent',
        bg: '#f1f5f9',
        border: '#cbd5e1',
        fg: '#475569',
        accent: '#64748b',
      };
    }
    const tooStrong = slotWind.hi > settings.vmax || slotWind.g > settings.gmax;
    const tooWeak = slotWind.hi < settings.vmin;
    if (ok === false && (tooStrong || tooWeak)) {
      const reason =
        slotWind.hi > settings.vmax
          ? `Vent fort (${Math.round(slotWind.hi)} nds)`
          : slotWind.g > settings.gmax
          ? `Rafales fortes (${Math.round(slotWind.g)} nds)`
          : `Vent trop faible (${Math.round(slotWind.lo)}–${Math.round(slotWind.hi)} nds)`;
      return {
        emoji: '🔴',
        label: reason,
        bg: '#fef2f2',
        border: '#fca5a5',
        fg: '#991b1b',
        accent: '#dc2626',
      };
    }
    if (ok === false || isOffshore) {
      const reason = isOffshore
        ? 'Vent de terre (rafaleux)'
        : slotWind.lo < settings.vmin
        ? `Vent limite (${Math.round(slotWind.lo)}–${Math.round(slotWind.hi)} nds)`
        : `Vigilance (${Math.round(slotWind.g)} nds raf.)`;
      return {
        emoji: '🟠',
        label: reason,
        bg: '#fff7ed',
        border: '#fdba74',
        fg: '#9a3412',
        accent: '#ea580c',
      };
    }
    return {
      emoji: '🟢',
      label: 'Roulage OK',
      bg: '#f0fdf4',
      border: '#86efac',
      fg: '#166534',
      accent: '#16a34a',
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* En-tête date + raccourcis Aujourd'hui / Demain / J+2 */}
      <section
        className="card"
        style={{
          margin: 0,
          padding: '14px',
          border: '1.5px solid #bae6fd',
          background: '#ffffff',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { label: "Aujourd'hui", ds: todayDs },
              { label: 'Demain', ds: tomorrowDs },
              { label: 'J+2', ds: dayAfterDs },
            ].map(item => {
              const active = dateStr === item.ds;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onChangeDate(item.ds)}
                  style={{
                    minHeight: '40px',
                    padding: '6px 13px',
                    borderRadius: '10px',
                    border: active ? '2px solid #0284c7' : '1px solid #cbd5e1',
                    background: active ? '#0284c7' : '#f8fafc',
                    color: active ? '#ffffff' : '#0f172a',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => onChangeDate(shiftDate(dateStr, -1))}
              disabled={dateStr <= minDs}
              aria-label="Jour précédent"
              style={{
                minWidth: '40px',
                minHeight: '40px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: dateStr <= minDs ? 'not-allowed' : 'pointer',
                opacity: dateStr <= minDs ? 0.45 : 1,
              }}
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => onChangeDate(shiftDate(dateStr, 1))}
              disabled={dateStr >= maxDs}
              aria-label="Jour suivant"
              style={{
                minWidth: '40px',
                minHeight: '40px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: dateStr >= maxDs ? 'not-allowed' : 'pointer',
                opacity: dateStr >= maxDs ? 0.45 : 1,
              }}
            >
              ▶
            </button>
          </div>
        </div>

        {/* Résumé Date + Marées du jour en 1 ligne */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '6px',
            marginBottom: '12px',
          }}
        >
          <div style={{ fontSize: '1.08rem', fontWeight: 900, color: '#0f172a' }}>
            {formatDayTitle(dateStr)}
          </div>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              color: '#334155',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {coef != null && (
              <span
                style={{
                  background: '#e0f2fe',
                  color: '#0369a1',
                  padding: '2px 7px',
                  borderRadius: '6px',
                  fontWeight: 800,
                  marginRight: '8px',
                }}
              >
                Coef {coef}
              </span>
            )}
            {dayLowTides
              .map(p => `BM ${lc(p.t, focusData.y, focusData.m, focusData.d)} (${p.h.toFixed(2)}m)`)
              .join(' · ')}
          </div>
        </div>

        {/* 2 gros boutons d'action terrain : Bilan Express (existant) + Point GPS */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => onOpenExpressRex(dateStr)}
            style={{
              minHeight: '48px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: 'none',
              background: pendingRexCount > 0 ? '#0f766e' : '#15803d',
              color: '#ffffff',
              fontSize: '0.88rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 2px 6px rgba(15, 118, 110, 0.28)',
            }}
          >
            <span>⚡</span>
            <span>
              Bilan Express
              {activeSlots.length > 0 &&
                (pendingRexCount > 0
                  ? ` (${pendingRexCount} à clôturer)`
                  : ' · ✓ Clôturé')}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenGpsTab}
            style={{
              minHeight: '48px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1.5px solid #0284c7',
              background: '#f0f9ff',
              color: '#0369a1',
              fontSize: '0.88rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <span>📍</span>
            <span>Point GPS Lestrevet</span>
          </button>
        </div>
      </section>

      {/* Balise Winds-Up en direct */}
      <WindsUpBaliseCard dateStr={dateStr} settings={settings} />

      {/* Cartes des créneaux du jour (format large lisible plein soleil) */}
      <section
        className="card"
        style={{
          margin: 0,
          padding: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '12px',
          }}
        >
          <div style={{ fontSize: '0.96rem', fontWeight: 900, color: '#0f172a' }}>
            Créneaux du jour ({activeSlots.length})
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHiddenSlots(v => !v)}
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#475569',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {showHiddenSlots
                ? 'Masquer hors offre'
                : `Voir hors offre (${hiddenCount})`}
            </button>
          )}
        </div>

        {visibleSlots.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: '#64748b',
              fontSize: '0.88rem',
              background: '#f8fafc',
              borderRadius: '10px',
              border: '1px dashed #cbd5e1',
            }}
          >
            Aucun créneau actif sur cette journée.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {visibleSlots.map(item => {
              const isOffshore = item.windSector?.sector === 'terre';
              const feu = getFeuInfo(item.slot.ok, item.slotWind, isOffshore);

              let statusBadge: { label: string; bg: string; fg: string } | null = null;
              if (item.obs?.status === 'realized') {
                statusBadge = { label: '✓ Réalisée', bg: '#dcfce7', fg: '#166534' };
              } else if (item.obs?.cancellationReason === 'no_clients') {
                statusBadge = { label: "👥 Pas d'inscrit", bg: '#ede9fe', fg: '#5b21b6' };
              } else if (item.obs?.status === 'cancelled' || item.c2Status === 'cancelled_weather') {
                statusBadge = { label: '⛔ Annulée météo', bg: '#fee2e2', fg: '#991b1b' };
              } else if (item.c2Status === 'shifted') {
                statusBadge = { label: '🕒 Décalé', bg: '#fef3c7', fg: '#92400e' };
              } else if (item.isHiddenC1) {
                statusBadge = { label: 'Hors offre', bg: '#f1f5f9', fg: '#64748b' };
              }

              return (
                <div
                  key={item.slotKey}
                  style={{
                    borderRadius: '12px',
                    border: `2px solid ${feu.border}`,
                    borderLeft: `6px solid ${feu.accent}`,
                    background: '#ffffff',
                    padding: '12px 14px',
                    opacity: item.isHiddenC1 ? 0.65 : 1,
                  }}
                >
                  {/* Ligne 1 : Horaire + Feu météo + Statut REX */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '1.12rem',
                          fontWeight: 900,
                          color: '#0f172a',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {item.displayStart} – {item.displayEnd}
                      </span>
                      {item.slot.customTitle && (
                        <span
                          style={{
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            color: '#475569',
                          }}
                        >
                          · {item.slot.customTitle}
                        </span>
                      )}
                      {statusBadge && (
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: statusBadge.bg,
                            color: statusBadge.fg,
                            fontSize: '0.73rem',
                            fontWeight: 800,
                          }}
                        >
                          {statusBadge.label}
                        </span>
                      )}
                    </div>

                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '8px',
                        background: feu.bg,
                        color: feu.fg,
                        border: `1px solid ${feu.border}`,
                        fontSize: '0.78rem',
                        fontWeight: 800,
                      }}
                    >
                      {feu.emoji} {feu.label}
                    </span>
                  </div>

                  {/* Ligne 2 : Vent + Secteur + Houle + Cycle marée */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '10px',
                      fontSize: '0.82rem',
                      color: '#334155',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      marginBottom: '10px',
                    }}
                  >
                    {item.slotWind ? (
                      <span>
                        💨{' '}
                        <strong>
                          {Math.round(item.slotWind.lo)}–{Math.round(item.slotWind.hi)} nds
                        </strong>
                        {item.slotWind.g > 0 ? ` (raf. ${Math.round(item.slotWind.g)})` : ''}{' '}
                        · {degToCompass(item.slotWind.dir)}
                      </span>
                    ) : (
                      <span>💨 Vent non disponible</span>
                    )}
                    {item.windSector && (
                      <span
                        style={{
                          padding: '1px 7px',
                          borderRadius: '5px',
                          background: item.windSector.bg,
                          color: item.windSector.fg,
                          border: `1px solid ${item.windSector.bd}`,
                          fontSize: '0.74rem',
                          fontWeight: 800,
                        }}
                      >
                        🧭 {item.windSector.label}
                      </span>
                    )}
                    {item.waveH != null && (
                      <span>
                        🌊 <strong>{item.waveH.toFixed(1)} m</strong>
                        {item.waveP != null ? ` (${Math.round(item.waveP)}s)` : ''}
                      </span>
                    )}
                    {item.tideCycle.label && (
                      <span style={{ color: '#0f766e', fontWeight: 700 }}>
                        🌊 {item.tideCycle.label}
                      </span>
                    )}
                  </div>

                  {/* Ligne 3 : Inscrits / Moniteurs + Boutons tactiles rapides */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      paddingTop: '8px',
                      borderTop: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ fontSize: '0.80rem', color: '#475569', fontWeight: 700 }}>
                      👤 {item.primaryInstructor}
                      {item.secondaryInstructor ? ` + ${item.secondaryInstructor}` : ''}
                      {' · '}
                      <span
                        style={{
                          color: item.bookingSummary.totalChars > 0 ? '#0369a1' : '#64748b',
                          fontWeight: 800,
                        }}
                      >
                        {item.bookingSummary.totalChars}/{item.maxChars} chars
                        {item.bookingSummary.totalPeople > 0
                          ? ` (${item.bookingSummary.totalPeople} pers.)`
                          : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveBookingSlot({
                            slotKey: item.valItem?.k || item.slotKey,
                            slotStart: item.displayStart,
                            slotEnd: item.displayEnd,
                            slotTitle: item.slot.customTitle,
                            maxChars: item.maxChars,
                            primaryInstructor: item.primaryInstructor,
                            secondaryInstructor: item.secondaryInstructor,
                            secondaryQualification: item.valItem?.secondaryQualification,
                            secondaryActualEnd: item.valItem?.secondaryActualEnd,
                            secondaryFormula: item.valItem?.secondaryFormula,
                          })
                        }
                        style={{
                          minHeight: '38px',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          background: '#f8fafc',
                          color: '#0f172a',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        👥 Inscrits
                      </button>

                      {onOpenObservationModal && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenObservationModal({
                              dateStr,
                              slotKey: item.slotKey,
                              slotStart: item.displayStart,
                              slotEnd: item.displayEnd,
                              isCustom: item.slot.isCustom,
                              customTitle: item.slot.customTitle,
                              maxChars: item.maxChars,
                              primaryInstructor: item.primaryInstructor,
                              secondaryInstructor: item.secondaryInstructor,
                            })
                          }
                          style={{
                            minHeight: '38px',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: 'none',
                            background: item.obs ? '#e0f2fe' : '#0f766e',
                            color: item.obs ? '#0369a1' : '#ffffff',
                            fontSize: '0.78rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {item.obs ? '✏️ Modifier REX' : '✓ Saisir REX'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Retour rapide vers le Cockpit complet */}
      <button
        type="button"
        onClick={onSwitchToCockpit}
        style={{
          width: '100%',
          minHeight: '46px',
          padding: '10px 16px',
          borderRadius: '10px',
          border: '1.5px solid #cbd5e1',
          background: '#f8fafc',
          color: '#334155',
          fontSize: '0.84rem',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        📊 Basculer sur le Cockpit complet (courbes, coupe plage &amp; calendrier)
      </button>

      {/* Modale Inscrits si ouverte depuis une carte Terrain */}
      {activeBookingSlot && (
        <SlotBookingsModal
          isOpen={true}
          onClose={() => setActiveBookingSlot(null)}
          dateStr={dateStr}
          slotKey={activeBookingSlot.slotKey}
          slotStart={activeBookingSlot.slotStart}
          slotEnd={activeBookingSlot.slotEnd}
          slotTitle={activeBookingSlot.slotTitle}
          bookings={
            bookingsMap[buildReservationKey(dateStr, activeBookingSlot.slotKey)] || []
          }
          onSaveBookings={(slotKey, list) => {
            if (onSaveSlotBookings) {
              onSaveSlotBookings(
                dateStr,
                slotKey,
                activeBookingSlot.slotStart,
                activeBookingSlot.slotEnd,
                list
              );
            }
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
