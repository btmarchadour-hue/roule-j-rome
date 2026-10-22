import React, { useRef, useState } from 'react';
import { AppSettings, TidePoint } from '../types';
import { COEF, dayInfo, dayLight, hAt, lc, p2, plan, toU } from '../utils/tides';

interface CurveChartProps {
  dateStr: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
}

export const CurveChart: React.FC<CurveChartProps> = ({
  dateStr,
  settings,
  EX,
  W: tideW,
  first,
  last,
}) => {
  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);

  const W = 360;
  const H = 222;
  const ml = 28;
  const mr = 8;
  const mt = 14;
  const mb = 52;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const thr = settings.L - (settings.mg || 0) / 100;

  const X = (u: number) => ml + ((u - t0) / (t1 - t0)) * pw;
  const f1 = (v: number) => v.toFixed(1);

  const pts: [number, number | null][] = [];
  for (let u = t0; u <= t1; u += 10) {
    pts.push([u, hAt(u, EX)]);
  }

  const hs = pts.map(p => p[1]).filter((v): v is number => v != null);
  if (!hs.length) return null;

  const ymin = Math.floor(Math.min(...hs) - 0.3);
  const ymax = Math.ceil(Math.max(Math.max(...hs), thr) + 0.4);
  const Y = (h: number) => mt + ph - ((h - ymin) / (ymax - ymin)) * ph;

  // Daylight rectangle (Vert pour la journée, noir pour la nuit)
  const l = dayLight(y, m, d, settings.lum, settings.lmg);
  let daylightRect = null;
  if (l) {
    const a = X(Math.max(l[0], t0));
    const b = X(Math.min(l[1], t1));
    daylightRect = (
      <rect
        x={f1(a)}
        y={mt}
        width={f1(Math.max(0, b - a))}
        height={ph}
        style={{ fill: '#1b8f4e', fillOpacity: 0.95 }}
      />
    );
  }

  // Grid lines
  const horizGrid = [];
  for (let v = ymin; v <= ymax; v++) {
    horizGrid.push(
      <g key={`h-${v}`}>
        <line
          x1={ml}
          x2={W - mr}
          y1={f1(Y(v))}
          y2={f1(Y(v))}
          style={{ stroke: 'rgba(255, 255, 255, 0.22)' }}
        />
        <text
          x={ml - 4}
          y={f1(Y(v) + 3)}
          textAnchor="end"
          style={{ fill: '#e2e8f0', fontSize: '9px', fontWeight: 600 }}
        >
          {v}
        </text>
      </g>
    );
  }

  const vertGrid = [];
  for (let h = 0; h <= 24; h += 3) {
    const x = f1(X(toU(y, m, d, h * 60)));
    vertGrid.push(
      <g key={`v-${h}`}>
        <line
          x1={x}
          x2={x}
          y1={mt}
          y2={mt + ph}
          style={{ stroke: 'rgba(255, 255, 255, 0.18)' }}
        />
        <text
          x={x}
          y={mt + ph + 11}
          textAnchor="middle"
          style={{ fill: 'var(--mu)', fontSize: '9px', fontWeight: 600 }}
        >
          {h}h
        </text>
      </g>
    );
  }

  // Curve polylines
  const polylines: React.ReactNode[] = [];
  let run: string[] = [];
  let col: string | null = null;
  const flush = (key: number) => {
    if (run.length > 1) {
      polylines.push(
        <polyline
          key={`poly-${key}`}
          points={run.join(' ')}
          style={{
            fill: 'none',
            stroke: col || '#1d4ed8',
            strokeWidth: 2.6,
            strokeLinejoin: 'round',
          }}
        />
      );
    }
    run = [];
  };

  let polyIdx = 0;
  for (const [u, h] of pts) {
    if (h == null) {
      flush(polyIdx++);
      col = null;
      continue;
    }
    // High contrast on green day & black night:
    // Bright cyan/sky blue when under threshold, deep blue when above threshold
    const c = h <= thr ? '#38bdf8' : '#60a5fa';
    if (c !== col) {
      const lastPt = run.length ? run[run.length - 1] : null;
      flush(polyIdx++);
      col = c;
      if (lastPt) run = [lastPt];
    }
    run.push(f1(X(u)) + ',' + f1(Y(h)));
  }
  flush(polyIdx++);

  // PM / BM points
  const ex = EX.filter(p => p.t >= t0 && p.t < t1);
  const pmBmMarks = ex.map((p, idx) => {
    const x = X(p.t);
    const yy = Y(p.h);
    const tx = Math.min(W - mr - 26, Math.max(ml + 26, x));
    return (
      <g key={`pmbm-${idx}`}>
        <circle
          cx={f1(x)}
          cy={f1(yy)}
          r={3}
          style={{ fill: '#ffc40d', stroke: '#000', strokeWidth: 1 }}
        />
        <text
          x={f1(tx)}
          y={f1(p.pm ? yy - 7 : yy + 14)}
          textAnchor="middle"
          style={{
            fill: '#ffffff',
            fontSize: '8.5px',
            fontWeight: 800,
            paintOrder: 'stroke',
            stroke: '#0c100e',
            strokeWidth: '2.5px',
          }}
        >
          {(p.pm ? 'PM ' : 'BM ') +
            lc(p.t, y, m, d) +
            ' · ' +
            (p.hd != null ? p.hd : p.h).toFixed(2).replace('.', ',')}
        </text>
      </g>
    );
  });

  // Windows and Sessions lanes
  const lane = mt + ph + 18;
  const dayP = dayInfo(y, m, d, settings, tideW, first, last);
  const pl = plan(y, m, d, settings, tideW, first, last);

  const windowBars = dayP.map((p, idx) => (
    <rect
      key={`wbar-${idx}`}
      x={f1(X(p[0]))}
      y={lane}
      width={f1(Math.max(1, X(p[1]) - X(p[0])))}
      height={7}
      rx={2}
      style={{ fill: '#38bdf8', fillOpacity: 0.85 }}
    />
  ));

  const sessionBars = pl.full.map((p, idx) => (
    <rect
      key={`sbar-${idx}`}
      x={f1(X(p[0]))}
      y={lane + 10}
      width={f1(Math.max(1, X(p[1]) - X(p[0]) - 1))}
      height={7}
      rx={2}
      style={{ fill: 'var(--cn)' }}
    />
  ));

  const extraBars = pl.extra.map((p, idx) => (
    <rect
      key={`exbar-${idx}`}
      x={f1(X(p[0]))}
      y={lane + 10}
      width={f1(Math.max(1, X(p[1]) - X(p[0]) - 1))}
      height={7}
      rx={2}
      style={{ fill: 'var(--cl2)' }}
    />
  ));

  const nw = Date.now() / 6e4;
  let nowLine = null;
  if (nw >= t0 && nw < t1) {
    nowLine = (
      <g>
        <line
          x1={f1(X(nw))}
          x2={f1(X(nw))}
          y1={mt}
          y2={mt + ph}
          style={{ stroke: '#ffc40d', strokeWidth: 1.5, strokeDasharray: '2 2' }}
        />
        <text
          x={f1(X(nw))}
          y={mt - 3}
          textAnchor="middle"
          style={{ fill: '#ffc40d', fontSize: '8px', fontWeight: 800 }}
        >
          maintenant
        </text>
      </g>
    );
  }

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
    const h = hAt(u, EX);
    if (h == null) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      return;
    }
    const px = X(u);
    const text = `${lc(u, y, m, d)} · ${h.toFixed(2).replace('.', ',')} m${h <= thr ? ' · sous le seuil' : ''}`;
    const textX = Math.min(W - mr - 70, Math.max(ml + 2, px + 6));
    setCrosshair({
      visible: true,
      x: px,
      y: Y(h),
      text,
      textX,
    });
  };

  const handlePointerLeave = () => {
    setCrosshair(prev => ({ ...prev, visible: false }));
  };

  const pmx = ex.filter(p => p.pm).map(p => (p.hd != null ? p.hd : p.h));
  const bmn = ex.filter(p => !p.pm).map(p => (p.hd != null ? p.hd : p.h));
  const mar = pmx.length && bmn.length ? Math.max(...pmx) - Math.min(...bmn) : null;

  return (
    <div className="crv">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          touchAction: 'pan-y',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={handlePointerLeave}
      >
        {/* Night background is black */}
        <rect x={ml} y={mt} width={pw} height={ph} style={{ fill: '#000000' }} />
        {/* Daylight background is green */}
        {daylightRect}

        {horizGrid}
        {vertGrid}

        {/* Threshold dashed line */}
        <line
          x1={ml}
          x2={W - mr}
          y1={f1(Y(thr))}
          y2={f1(Y(thr))}
          style={{ stroke: '#fbbf24', strokeWidth: 1.5, strokeDasharray: '5 3' }}
        />
        <text
          x={W - mr - 2}
          y={f1(Y(thr) - 3)}
          textAnchor="end"
          style={{
            fill: '#fbbf24',
            fontSize: '9px',
            fontWeight: 800,
            paintOrder: 'stroke',
            stroke: '#0a0d0b',
            strokeWidth: '2px',
          }}
        >
          seuil {thr.toFixed(2).replace('.', ',')} m
        </text>

        {polylines}
        {pmBmMarks}
        {windowBars}
        {sessionBars}
        {extraBars}
        {nowLine}

        {crosshair.visible && (
          <g>
            <line
              x1={crosshair.x}
              x2={crosshair.x}
              y1={mt}
              y2={mt + ph}
              style={{ stroke: '#ffffff', strokeWidth: 1.2 }}
            />
            <circle
              cx={crosshair.x}
              cy={crosshair.y}
              r={3.8}
              style={{ fill: '#ffc40d', stroke: '#000', strokeWidth: 1.2 }}
            />
            <text
              x={crosshair.textX}
              y={mt + 10}
              style={{
                fill: '#ffffff',
                fontSize: '9.5px',
                fontWeight: 800,
                paintOrder: 'stroke',
                stroke: '#0a0d0b',
                strokeWidth: '3.5px',
              }}
            >
              {crosshair.text}
            </text>
          </g>
        )}
      </svg>
      <div className="m" style={{ marginTop: '4px' }}>
        Courbe de marée (heures locales, hauteur en m). <b>Fond vert : journée</b> · <b>fond noir : nuit</b> · courbe cyan/bleu vif : sous le seuil · seuil jaune en pointillés · barre bleue : plage praticable · barres marine : séances. Touche ou survole la courbe pour lire l'heure et la hauteur.
        {mar != null && (
          <span>
            {' '}
            <b>Marnage du jour : {mar.toFixed(2).replace('.', ',')} m</b> (coef {COEF[`${y}-${p2(m + 1)}-${p2(d)}`]}).
          </span>
        )}
      </div>
    </div>
  );
};
