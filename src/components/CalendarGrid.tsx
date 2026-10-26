import React from 'react';
import { AppSettings, CustomSlotsMap, TidePoint, ValidationsMap, WindPoint } from '../types';
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
    let totalCount = 0;
    let isPartial = false;

    let dayTooltip = '';

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

      if (validations && validations[ds]) {
        const fDay = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        const vInfo = vstat(fDay, validations);
        valStatus = isPast && vInfo.st === 'chg' ? 'ok' : vInfo.st;
        valCount = vInfo.valCount;
        rejCount = vInfo.rejCount;
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

      if (valStatus === 'ok') {
        dayTooltip += ` · ✓ ${valCount} validé${valCount > 1 ? 's' : ''}${
          rejCount ? `, ${rejCount} refusé${rejCount > 1 ? 's' : ''}` : ''
        }${isPast ? ' (passé)' : ''}`;
      } else if (!isPast && valStatus === 'chg') {
        dayTooltip += ' · ⚠️ À revalider (météo modifiée)';
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
            title={isPartial ? `${valCount}/${totalCount} créneaux validés` : 'Créneaux validés'}
          >
            {isPartial ? `${valCount}/${totalCount}` : '✓'}
          </span>
        )}
        {valStatus === 'ok' && valCount === 0 && rejCount > 0 && (
          <span
            className="cal-val-tag rej"
            title={`${rejCount} créneau${rejCount > 1 ? 'x' : ''} refusé${rejCount > 1 ? 's' : ''}`}
          >
            ✕
          </span>
        )}
        {!isPast && valStatus === 'chg' && (
          <span className="cal-val-tag warn" title="Prévisions modifiées depuis validation">
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
          <button type="button" onClick={onPrevMonth} aria-label="Mois précédent">
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
    </div>
  );
};
