import React from 'react';
import { AppSettings, TidePoint } from '../types';
import { COEF, maxDs, minDs, p2, toU } from '../utils/tides';

interface MarnageChartProps {
  year: number;
  month: number;
  selectedDate: string;
  onSelectDate: (ds: string) => void;
  settings: AppSettings;
  EX: TidePoint[];
}

export const MarnageChart: React.FC<MarnageChartProps> = ({
  year,
  month,
  selectedDate,
  onSelectDate,
  settings,
  EX,
}) => {
  const nd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const W = 360;
  const H = 130;
  const ml = 24;
  const mr = 6;
  const mt = 8;
  const mb = 20;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const days: { d: number; ds: string; mar: number; c: number }[] = [];

  for (let d = 1; d <= nd; d++) {
    const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
    if (ds < minDs || ds > maxDs) continue;
    const a = toU(year, month, d, 0);
    const z = toU(year, month, d + 1, 0);
    const ex = EX.filter(p => p.t >= a && p.t < z);
    const pm = ex.filter(p => p.pm).map(p => (p.hd != null ? p.hd : p.h));
    const bm = ex.filter(p => !p.pm).map(p => (p.hd != null ? p.hd : p.h));
    if (pm.length && bm.length) {
      days.push({
        d,
        ds,
        mar: Math.max(...pm) - Math.min(...bm),
        c: COEF[ds],
      });
    }
  }

  if (!days.length) return null;

  const mx = Math.ceil(Math.max(...days.map(x => x.mar)) + 0.3);
  const bw = pw / nd;
  const sy = (v: number) => mt + ph - (v / mx) * ph;
  const f1 = (v: number) => v.toFixed(1);
  const low = settings.all ? settings.cmax : -1;

  const gridLines = [];
  for (let v = 0; v <= mx; v++) {
    gridLines.push(
      <g key={`gl-${v}`}>
        <line
          x1={ml}
          x2={W - mr}
          y1={f1(sy(v))}
          y2={f1(sy(v))}
          style={{ stroke: 'var(--bd)' }}
        />
        <text
          x={ml - 3}
          y={f1(sy(v) + 3)}
          textAnchor="end"
          style={{ fill: 'var(--mu)', fontSize: '9px' }}
        >
          {v}
        </text>
      </g>
    );
  }

  const bars = days.map((x) => {
    const sel = x.ds === selectedDate;
    const lo = x.c <= low;
    return (
      <rect
        key={x.ds}
        data-d={x.d}
        x={f1(ml + (x.d - 1) * bw + 0.6)}
        y={f1(sy(x.mar))}
        width={f1(Math.max(1, bw - 1.4))}
        height={f1(ph - (sy(x.mar) - mt))}
        rx="1.5"
        onClick={() => onSelectDate(x.ds)}
        style={{
          cursor: 'pointer',
          fill: lo ? 'var(--cl2)' : 'var(--cb)',
          fillOpacity: lo ? 1 : 0.85,
          stroke: sel ? 'var(--cn)' : 'none',
          strokeWidth: sel ? 1.8 : 0,
        }}
      >
        <title>{`${x.d}/${month + 1} : marnage ${x.mar.toFixed(2).replace('.', ',')} m, coef ${x.c}`}</title>
      </rect>
    );
  });

  const dayLabels = [];
  for (let d = 1; d <= nd; d += d === 1 ? 4 : 5) {
    dayLabels.push(
      <text
        key={`lbl-${d}`}
        x={f1(ml + (d - 0.5) * bw)}
        y={mt + ph + 12}
        textAnchor="middle"
        style={{ fill: 'var(--mu)', fontSize: '9px' }}
      >
        {d}
      </text>
    );
  }

  return (
    <div className="mar" style={{ marginTop: '12px' }}>
      <div className="sub" style={{ margin: '12px 0 4px' }}>
        Marnage du mois (m)
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {gridLines}
        {bars}
        {dayLabels}
      </svg>
      <div className="m" style={{ marginTop: '2px' }}>
        Écart pleine mer – basse mer, jour par jour. Bleu clair : coef ≤ {settings.cmax} (roulage toute la journée). Touche une barre pour ouvrir le jour.
      </div>
    </div>
  );
};
