import React from 'react';
import { AppSettings, CustomSlotsMap, TidePoint, ValidationsMap, WindPoint } from '../types';
import { AgendaBookingItem } from '../utils/firebaseSync';
import { getSlotBookingsSummary } from '../utils/cycleHelpers';
import { getFrenchHolidayInfo, HOLIDAY_ZONE_COLORS } from '../utils/frenchHolidays';
import { dayFocus, dayWind, getDayKeyTide, maxDs, minDs, MOIS, p2, plan, tdy, vstat } from '../utils/tides';

interface CalendarGridProps {
  year: number;
  month: number;
  selectedDate: string;
  onSelectDate: (ds: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  validations?: ValidationsMap;
  customSlotsMap?: CustomSlotsMap;
  bookingsMap?: Record<string, AgendaBookingItem[]>;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  year,
  month,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations = {},
  customSlotsMap = {},
  bookingsMap = {},
}) => {
  const dayNames = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const firstDayOffset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const numDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const emptyCells = [];
  for (let i = 0; i < firstDayOffset; i++) {
    emptyCells.push(<div key={`empty-${i}`} />);
  }

  const validatedThisMonth = Object.keys(validations || {}).filter(ds => {
    const [y, m] = ds.split('-').map(Number);
    return y === year && m === month + 1;
  }).length;
  const [minY, minM] = minDs.split('-').map(Number);
  const isAtMinMonth = year === minY && month <= minM - 1;

  const dayCells = [];
  for (let d = 1; d <= numDays; d++) {
    const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
    const inRange = ds >= minDs && ds <= maxDs;
    const isSelected = ds === selectedDate;
    const isPast = ds < tdy();

    let dotClass = '';
    let badgeText = '';
    let keyTideLabel = '';
    let valStatus: 'none' | 'ok' | 'chg' = 'none';
    let valCount = 0;
    let rejCount = 0;
    let notPublishedCount = 0;
    let cycle2Count = 0;
    let totalCount = 0;
    let isPartial = false;
    let dayBookedChars = 0;

    let dayTooltip = '';

    const holiday = getFrenchHolidayInfo(ds);

    if (inRange) {
      const dw = dayWind(year, month, d, settings, tideW, first, last, windList);
      if (dw.lvl === 2 || dw.lvl === -1) {
        dotClass = 'ok';
      } else if (dw.lvl === 1) {
        dotClass = 'mid';
      }

      const pl = plan(year, month, d, settings, tideW, first, last);
      const n = pl.full.length;
      const e = pl.extra.length;
      if (n || e) {
        badgeText = (n ? String(n) : '') + (e ? `+${e}` : '');
      }

      // Compter les chars réservés dans bookingsMap pour ce jour
      for (const [bKey, bItems] of Object.entries(bookingsMap)) {
        if (bKey.startsWith(`${ds}_`) && Array.isArray(bItems) && bItems.length > 0) {
          dayBookedChars += getSlotBookingsSummary(bItems).totalChars;
        }
      }

      if (validations && validations[ds]) {
        const fDay = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        const vInfo = vstat(fDay, validations);
        valStatus = isPast && vInfo.st === 'chg' ? 'ok' : vInfo.st;
        valCount = vInfo.valCount;
        rejCount = vInfo.rejCount;
        notPublishedCount = vInfo.notPublishedCount || 0;
        cycle2Count = vInfo.cycle2Count;
        totalCount = vInfo.totalCount;
        isPartial = vInfo.isPartial;
      }

      const kt = getDayKeyTide(EX, ds);
      if (kt) {
        keyTideLabel = kt.label;
        dayTooltip = `${d} ${MOIS[month]} ${year} · ${kt.label}${kt.coef ? ` · Coef ${kt.coef}` : ''}`;
      } else {
        dayTooltip = `${d} ${MOIS[month]} ${year}`;
      }

      if (holiday.isHoliday) {
        dayTooltip += ` · 🎒 ${holiday.holidayName} (${holiday.zonesLabel})`;
      }
      if (holiday.publicHolidayName) {
        dayTooltip += ` · ⭐ Férié : ${holiday.publicHolidayName}`;
      }

      if (dayBookedChars > 0) {
        dayTooltip += ` · ⚡ Cycle 2 actif (${dayBookedChars} char${dayBookedChars > 1 ? 's' : ''} inscrit${dayBookedChars > 1 ? 's' : ''})`;
      }

      if (valStatus === 'ok') {
        dayTooltip += ` · ${cycle2Count > 0 ? '✓' : '📅'} ${valCount} ouvert${valCount > 1 ? 's' : ''}${
          rejCount ? `, ${rejCount} fermé${rejCount > 1 ? 's' : ''}` : ''
        }${isPast ? ' (passé)' : ''}`;
      } else if (!isPast && valStatus === 'chg') {
        dayTooltip += ' · ⚠️ Cycle 2 : météo/créneaux modifiés depuis validation';
      }
    }

    const cellClass = [
      'c',
      inRange ? '' : 'na',
      isSelected ? 'sel' : '',
      dotClass,
    ]
      .filter(Boolean)
      .join(' ');

    const hasCycle2 = dayBookedChars > 0 || cycle2Count > 0;

    dayCells.push(
      <button
        key={ds}
        type="button"
        className={cellClass}
        onClick={() => {
          if (inRange) onSelectDate(ds);
        }}
        disabled={!inRange}
        title={inRange ? dayTooltip : undefined}
      >
        {valStatus === 'ok' && valCount > 0 && (
          <span
            className="cal-val-tag ok"
            style={!hasCycle2 && !isPast ? { background: '#0284c7' } : undefined}
            title={
              hasCycle2
                ? `${cycle2Count} créneau(x) en Cycle 2${dayBookedChars > 0 ? ` (${dayBookedChars} chars)` : ''}`
                : isPartial
                ? `Cycle 1 : ${valCount}/${totalCount} créneau(x) publié(s)`
                : 'Cycle 1 : journée publiée à la vente'
            }
          >
            {hasCycle2 ? (isPartial ? `${valCount}/${totalCount}` : '⚡') : isPartial ? `${valCount}/${totalCount}` : 'C1'}
          </span>
        )}
        {valStatus === 'none' && dayBookedChars > 0 && (
          <span
            className="cal-val-tag ok"
            style={{ background: '#7c3aed' }}
            title={`Cycle 2 déclenché (${dayBookedChars} char${dayBookedChars > 1 ? 's' : ''})`}
          >
            ⚡
          </span>
        )}
        {valStatus === 'ok' && valCount === 0 && rejCount > 0 && (
          <span
            className="cal-val-tag rej"
            style={notPublishedCount > 0 ? { background: '#475569' } : undefined}
            title={
              notPublishedCount > 0
                ? `${notPublishedCount} créneau${notPublishedCount > 1 ? 'x' : ''} non publié${notPublishedCount > 1 ? 's' : ''} en Cycle 1`
                : `${rejCount} créneau${rejCount > 1 ? 'x' : ''} fermé${rejCount > 1 ? 's' : ''}`
            }
          >
            {notPublishedCount > 0 ? '🚫' : '✕'}
          </span>
        )}
        {!isPast && valStatus === 'chg' && (
          <span className="cal-val-tag warn" title="Cycle 2 : prévisions modifiées sur journée engagée">
            ⚠️
          </span>
        )}
        <span style={{ lineHeight: 1 }}>{d}</span>
        <i />
        {badgeText && <small>{badgeText}</small>}
        {keyTideLabel && (
          <span
            style={{
              fontSize: '0.52rem',
              fontWeight: 700,
              lineHeight: 1,
              marginTop: '1px',
              opacity: 0.85,
              whiteSpace: 'nowrap',
              letterSpacing: '-0.02em',
            }}
          >
            {keyTideLabel}
          </span>
        )}
        {holiday.isHoliday && (
          <span
            className="cal-holiday-corner"
            aria-label={`Vacances scolaires : ${holiday.zonesLabel}`}
          >
            {holiday.zones.map(z => {
              const zoneStyle = HOLIDAY_ZONE_COLORS[z];
              return (
                <span
                  key={z}
                  className="cal-holiday-zone"
                  style={{
                    backgroundColor: zoneStyle.bg,
                    color: zoneStyle.text,
                  }}
                >
                  {z}
                </span>
              );
            })}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="card cal">
      <div className="top">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1>Horaires de roulage</h1>
            {validatedThisMonth > 0 && (
              <span
                style={{
                  fontSize: '0.62rem',
                  background: 'var(--okbg, #e2f4e8)',
                  color: 'var(--ok, #166534)',
                  padding: '2px 7px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  border: '1px solid currentColor',
                }}
                title={`${validatedThisMonth} jour(s) validé(s) ce mois`}
              >
                ✓ {validatedThisMonth} validé{validatedThisMonth > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="sub">Plage de Lestrevet · Plomodiern</div>
        </div>
        <div className="nav">
          <button
            type="button"
            onClick={onPrevMonth}
            disabled={isAtMinMonth}
            aria-label="Mois précédent"
            style={isAtMinMonth ? { opacity: 0.25, cursor: 'not-allowed' } : undefined}
            title={isAtMinMonth ? 'Début du calendrier au 1er novembre 2026' : 'Mois précédent'}
          >
            ‹
          </button>
          <b>
            {MOIS[month]} {year}
          </b>
          <button type="button" onClick={onNextMonth} aria-label="Mois suivant">
            ›
          </button>
        </div>
      </div>

      <div className="g">
        {dayNames.map(dn => (
          <div key={dn} className="dn">
            {dn}
          </div>
        ))}
        {emptyCells}
        {dayCells}
      </div>

      <div className="cal-holiday-legend">
        <span style={{ fontWeight: 700 }}>Vacances (bas droit) :</span>
        {(['B', 'C', 'A'] as const).map(z => {
          const zoneStyle = HOLIDAY_ZONE_COLORS[z];
          return (
            <span key={z} className="cal-holiday-legend-item">
              <span
                className="cal-holiday-swatch"
                style={{
                  backgroundColor: zoneStyle.bg,
                  color: zoneStyle.text,
                }}
              >
                {z}
              </span>
              <span>
                {zoneStyle.colorName} · {zoneStyle.cities} (Zone {z})
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
