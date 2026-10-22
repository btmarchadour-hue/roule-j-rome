import React from 'react';
import { AppSettings, TidePoint, WindPoint } from '../types';
import { dayWind, getDayKeyTide, maxDs, minDs, MOIS, p2, plan } from '../utils/tides';

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
}) => {
  const dayNames = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const firstDayOffset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const numDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const emptyCells = [];
  for (let i = 0; i < firstDayOffset; i++) {
    emptyCells.push(<div key={`empty-${i}`} />);
  }

  const dayCells = [];
  for (let d = 1; d <= numDays; d++) {
    const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
    const inRange = ds >= minDs && ds <= maxDs;
    const isSelected = ds === selectedDate;

    let dotClass = '';
    let badgeText = '';
    let keyTideLabel = '';

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

      const kt = getDayKeyTide(EX, ds);
      if (kt) {
        keyTideLabel = kt.label;
        dayTooltip = `${d} ${MOIS[month]} ${year} · ${kt.label}${kt.coef ? ` · Coef ${kt.coef}` : ''}`;
      } else {
        dayTooltip = `${d} ${MOIS[month]} ${year}`;
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
          <h1>Horaires de roulage</h1>
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
