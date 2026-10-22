import React, { useRef, useState } from 'react';
import { AppSettings, WindPoint } from '../types';
import { comp, dayInfo, dayLight, lc, plan, toU, windAt } from '../utils/tides';

interface WindPanelProps {
  dateStr: string;
  settings: AppSettings;
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
}

export const WindPanel: React.FC<WindPanelProps> = ({
  dateStr,
  settings,
  W: tideW,
  first,
  last,
  windList,
}) => {
  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);

  const W = 360;
  const ml = 28;
  const mr = 8;
  const H = 160;
  const mt = 26;
  const mb = 36;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const X = (u: number) => ml + ((u - t0) / (t1 - t0)) * pw;
  const f1 = (v: number) => v.toFixed(1);

  const pts: [number, WindPoint | null][] = [];
  for (let u = t0; u <= t1; u += 10) {
    pts.push([u, windAt(u, windList)]);
  }

  const ws = pts.filter((p): p is [number, WindPoint] => p[1] != null);
  if (!ws.length) return null;

  const q = {
    a: settings.vmin,
    b: settings.vmax,
    g: settings.gmax,
  };

  const gmx = Math.max(q.b, ...ws.map(p => (p[1].g != null ? p[1].g : p[1].v)));
  const ymax = Math.max(10, Math.ceil((gmx + 2) / 5) * 5);
  const Y = (v: number) => mt + ph - (v / ymax) * ph;

  const okw = (w: WindPoint) => w.v >= q.a && w.v <= q.b && (w.g == null || w.g <= q.g);

  // Daylight rectangle
  const l = dayLight(y, m, d, settings.lum, settings.lmg);
  let daylightRect = null;
  if (l) {
    const a = X(Math.max(l[0], t0));
    const b = X(Math.min(l[1], t1));
    daylightRect = (
      <rect
        x={f1(a)}
        y={mt}
        width={f1(Math.max(1, b - a))}
        height={ph}
        style={{ fill: 'var(--cday)' }}
      />
    );
  }

  // Tide window bands
  const P = dayInfo(y, m, d, settings, tideW, first, last);
  const tideWindowBands = P.map((p, idx) => (
    <rect
      key={`twb-${idx}`}
      x={f1(X(p[0]))}
      y={mt}
      width={f1(Math.max(1, X(p[1]) - X(p[0])))}
      height={ph}
      style={{ fill: 'var(--cb)', fillOpacity: 0.14 }}
    />
  ));

  // Ideal wind range band
  const idealBand = (
    <rect
      x={ml}
      y={f1(Y(q.b))}
      width={pw}
      height={f1(Y(q.a) - Y(q.b))}
      style={{ fill: 'var(--ccy)', fillOpacity: 0.28 }}
    />
  );

  // Horizontal grid lines
  const horizLines = [];
  for (let v = 0; v <= ymax; v += 5) {
    horizLines.push(
      <g key={`wgl-${v}`}>
        <line
          x1={ml}
          x2={W - mr}
          y1={f1(Y(v))}
          y2={f1(Y(v))}
          style={{ stroke: 'var(--bd)' }}
        />
        <text
          x={ml - 4}
          y={f1(Y(v) + 3)}
          textAnchor="end"
          style={{ fill: 'var(--mu)', fontSize: '9px' }}
        >
          {v}
        </text>
      </g>
    );
  }

  // Vertical time grid & compass direction
  const vertLines = [];
  for (let h = 0; h <= 24; h += 3) {
    const u = toU(y, m, d, h * 60);
    const x = f1(X(u));
    const w = windAt(u, windList);
    vertLines.push(
      <g key={`wvl-${h}`}>
        <line
          x1={x}
          x2={x}
          y1={mt}
          y2={mt + ph}
          style={{ stroke: 'var(--bd)' }}
        />
        <text
          x={x}
          y={mt + ph + 11}
          textAnchor="middle"
          style={{ fill: 'var(--mu)', fontSize: '9px' }}
        >
          {h}h
        </text>
        {w && h < 24 && (
          <text
            x={x}
            y={mt - 6}
            textAnchor="middle"
            style={{ fill: 'var(--tx)', fontSize: '8px', fontWeight: 700 }}
          >
            {comp(w.a)}
          </text>
        )}
      </g>
    );
  }

  // Stop limit line
  let stopLimitLine = null;
  if (q.g <= ymax) {
    stopLimitLine = (
      <g>
        <line
          x1={ml}
          x2={W - mr}
          y1={f1(Y(q.g))}
          y2={f1(Y(q.g))}
          style={{ stroke: 'var(--cn)', strokeWidth: 1.2, strokeDasharray: '5 3' }}
        />
        <text
          x={W - mr - 2}
          y={f1(Y(q.g) - mt < 14 ? Y(q.g) + 10 : Y(q.g) - 3)}
          textAnchor="end"
          style={{ fill: 'var(--cn)', fontSize: '9px', fontWeight: 700 }}
        >
          arrêt {q.g} nds
        </text>
      </g>
    );
  }

  // Gusts dashed line
  const gustPolylines: React.ReactNode[] = [];
  let gp: string[] = [];
  const flushGusts = (key: number) => {
    if (gp.length > 1) {
      gustPolylines.push(
        <polyline
          key={`gp-${key}`}
          points={gp.join(' ')}
          style={{
            fill: 'none',
            stroke: 'var(--mu)',
            strokeWidth: 1.2,
            strokeDasharray: '3 2',
          }}
        />
      );
    }
    gp = [];
  };

  let gKey = 0;
  for (const [u, w] of pts) {
    if (!w || w.g == null) {
      flushGusts(gKey++);
      continue;
    }
    gp.push(f1(X(u)) + ',' + f1(Y(w.g)));
  }
  flushGusts(gKey++);

  // Wind speed line
  const windPolylines: React.ReactNode[] = [];
  let run: string[] = [];
  let col: string | null = null;
  const flushSpeed = (key: number) => {
    if (run.length > 1) {
      windPolylines.push(
        <polyline
          key={`wp-${key}`}
          points={run.join(' ')}
          style={{
            fill: 'none',
            stroke: col || 'var(--cn)',
            strokeWidth: 2.2,
            strokeLinejoin: 'round',
          }}
        />
      );
    }
    run = [];
  };

  let wKey = 0;
  for (const [u, w] of pts) {
    if (!w) {
      flushSpeed(wKey++);
      col = null;
      continue;
    }
    const c = okw(w) ? 'var(--cb)' : 'var(--cn)';
    if (c !== col) {
      const lastPt = run.length ? run[run.length - 1] : null;
      flushSpeed(wKey++);
      col = c;
      if (lastPt) run = [lastPt];
    }
    run.push(f1(X(u)) + ',' + f1(Y(w.v)));
  }
  flushSpeed(wKey++);

  // Sessions and extra markers
  const pl = plan(y, m, d, settings, tideW, first, last);
  const sessionMarks = pl.full.map((p, idx) => (
    <rect
      key={`sm-${idx}`}
      x={f1(X(p[0]))}
      y={mt + ph + 17}
      width={f1(Math.max(1, X(p[1]) - X(p[0]) - 1))}
      height={6}
      style={{ fill: 'var(--cn)' }}
    />
  ));

  const extraMarks = pl.extra.map((p, idx) => (
    <rect
      key={`xm-${idx}`}
      x={f1(X(p[0]))}
      y={mt + ph + 17}
      width={f1(Math.max(1, X(p[1]) - X(p[0]) - 1))}
      height={6}
      style={{ fill: 'var(--cl2)' }}
    />
  ));

  const glob = ws.some(p => p[1].s === 'G');

  // Crosshair state
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [crosshair, setCrosshair] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    textX: number;
  }>({ visible: false, x: 0, y: 0, text: '', textX: 0 });

  const handlePointer = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const fx = ((ev.clientX - r.left) / r.width) * W;
    if (fx < ml || fx > W - mr) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      return;
    }
    const u = t0 + ((fx - ml) / pw) * (t1 - t0);
    const x = windAt(u, windList);
    if (!x) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      return;
    }
    const px = X(u);
    const text = `${lc(u, y, m, d)} · ${f1(x.v).replace('.', ',')} nds${
      x.g != null ? ' · raf. ' + Math.round(x.g) : ''
    } · ${comp(x.a)}`;
    const textX = Math.min(W - mr - 96, Math.max(ml + 2, px + 6));
    setCrosshair({
      visible: true,
      x: px,
      y: Y(x.v),
      text,
      textX,
    });
  };

  const handlePointerLeave = () => {
    setCrosshair(prev => ({ ...prev, visible: false }));
  };

  return (
    <div className="crv" style={{ marginTop: '6px' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }}
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={handlePointerLeave}
      >
        <rect x={ml} y={mt} width={pw} height={ph} style={{ fill: 'var(--cbg)' }} />
        {daylightRect}
        {tideWindowBands}
        {idealBand}
        {horizLines}
        {vertLines}
        {stopLimitLine}
        {gustPolylines}
        {windPolylines}
        {sessionMarks}
        {extraMarks}

        <text x={ml} y={9} style={{ fill: 'var(--mu)', fontSize: '9px' }}>
          Vent à 10 m (nds) · {glob ? 'AROME puis modèle global (indicatif)' : 'AROME'}
        </text>

        {crosshair.visible && (
          <g>
            <line
              x1={crosshair.x}
              x2={crosshair.x}
              y1={mt}
              y2={mt + ph}
              style={{ stroke: 'var(--tx)', strokeWidth: 1 }}
            />
            <circle
              cx={crosshair.x}
              cy={crosshair.y}
              r={3.4}
              style={{ fill: 'var(--cb)', stroke: 'var(--cn)' }}
            />
            <text
              x={crosshair.textX}
              y={mt + 10}
              style={{
                fill: 'var(--tx)',
                fontSize: '9.5px',
                fontWeight: 800,
                paintOrder: 'stroke',
                stroke: 'var(--card)',
                strokeWidth: '3px',
              }}
            >
              {crosshair.text}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
