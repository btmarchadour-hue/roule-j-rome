import React, { useRef, useState } from 'react';
import { AppSettings, WindPoint } from '../types';
import { comp, dayLight, lc, plan, tdy, toU, windAt, WMO, WMON } from '../utils/tides';

interface WeatherBlockProps {
  dateStr: string;
  settings: AppSettings;
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  showDayToggle?: boolean;
  forwardOffset?: number;
  onForwardOffsetChange?: (offset: number) => void;
}

export const WeatherBlock: React.FC<WeatherBlockProps> = ({
  dateStr,
  settings,
  W: tideW,
  first,
  last,
  windList,
  showDayToggle = false,
  forwardOffset = 0,
  onForwardOffsetChange,
}) => {
  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const t0 = toU(y, m, d, 6 * 60);
  const t1 = toU(y, m, d, 22 * 60);
  const T0 = toU(y, m, d, 0);
  const T1 = toU(y, m, d + 1, 0);

  const rec = windList.filter(p => p.t >= T0 && p.t < T1 && p.tp != null);

  const toggleHeader = showDayToggle && onForwardOffsetChange ? (
    <div className="tabs" style={{ marginBottom: '10px' }}>
      <button
        type="button"
        className={forwardOffset === 0 ? 'on' : ''}
        onClick={() => onForwardOffsetChange(0)}
      >
        Aujourd'hui
      </button>
      <button
        type="button"
        className={forwardOffset === 1 ? 'on' : ''}
        onClick={() => onForwardOffsetChange(1)}
      >
        Demain
      </button>
    </div>
  ) : null;

  if (!rec.length) {
    return (
      <div className="card">
        <div className="fh">Météo et température</div>
        {toggleHeader}
        <div className="note">
          Pas de prévision météo pour ce jour (hors ligne ou au-delà de 16 jours).
        </div>
      </div>
    );
  }

  const tps = rec.map(p => p.tp as number);
  const aps = rec.map(p => (p.ap != null ? p.ap : p.tp) as number);
  const rn = rec.reduce((acc, p) => acc + (p.pr || 0), 0);
  const nw = Date.now() / 6e4;
  const isT = dateStr === tdy() && nw >= T0 && nw < T1;
  const refPoint = (isT ? windAt(nw, windList) : null) || windAt(toU(y, m, d, 14 * 60), windList) || rec[0];
  const qStr = (v: number) => v.toFixed(1);

  const W = 360;
  const H = 240;
  const ml = 30;
  const mr = 30;
  const mt = 46;
  const mb = 70;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const X = (u: number) => ml + ((u - t0) / (t1 - t0)) * pw;
  const lo = Math.floor(Math.min(...tps, ...aps) - 1);
  const hi = Math.ceil(Math.max(...tps) + 1);
  const Yt = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;
  const rmx = Math.max(2, ...rec.map(p => p.pr || 0));

  // Daylight rect
  const l = dayLight(y, m, d, settings.lum, settings.lmg);
  let daylightRect = null;
  if (l) {
    const a = X(Math.max(l[0], t0));
    const b = X(Math.min(l[1], t1));
    daylightRect = (
      <rect
        x={qStr(a)}
        y={mt}
        width={qStr(Math.max(1, b - a))}
        height={ph}
        style={{ fill: 'var(--cday)' }}
      />
    );
  }

  // Session bands
  const pl = plan(y, m, d, settings, tideW, first, last);
  const sessionBands = pl.full.map((x, idx) => (
    <rect
      key={`sb-${idx}`}
      x={qStr(X(Math.max(x[0], t0)))}
      y={mt}
      width={qStr(Math.max(1, X(Math.min(x[1], t1)) - X(Math.max(x[0], t0))))}
      height={ph}
      style={{ fill: 'var(--cb)', fillOpacity: 0.16 }}
    />
  ));

  const extraBands = pl.extra.map((x, idx) => (
    <rect
      key={`xb-${idx}`}
      x={qStr(X(x[0]))}
      y={mt}
      width={qStr(X(x[1]) - X(x[0]))}
      height={ph}
      style={{ fill: 'none', stroke: 'var(--cb)', strokeWidth: 1.2, strokeDasharray: '3 2' }}
    />
  ));

  // Temperature grid lines
  const st = hi - lo > 14 ? 5 : hi - lo > 6 ? 2 : 1;
  const tempGrid = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    tempGrid.push(
      <g key={`tgl-${v}`}>
        <line
          x1={ml}
          x2={W - mr}
          y1={qStr(Yt(v))}
          y2={qStr(Yt(v))}
          style={{ stroke: 'var(--bd)' }}
        />
        <text
          x={ml - 4}
          y={qStr(Yt(v) + 3)}
          textAnchor="end"
          style={{ fill: 'var(--mu)', fontSize: '9px' }}
        >
          {v}°
        </text>
      </g>
    );
  }

  // Rain bars
  const rainBars = rec.map((p, idx) => {
    if (!(p.pr && p.pr > 0) || p.t < t0 || p.t >= t1) return null;
    const bh = (p.pr / rmx) * ph * 0.4;
    return (
      <rect
        key={`rain-${idx}`}
        x={qStr(X(p.t) + 2)}
        y={qStr(mt + ph - bh)}
        width={qStr(pw / 16 - 4)}
        height={qStr(bh)}
        rx={2}
        style={{ fill: 'var(--cn)', fillOpacity: 0.7 }}
      />
    );
  });

  // Temperature polylines
  const P1: string[] = [];
  const P2: string[] = [];
  for (let u = t0; u <= t1; u += 30) {
    const w = windAt(u, windList);
    if (w && w.tp != null) {
      P1.push(`${qStr(X(u))},${qStr(Yt(w.tp))}`);
      P2.push(`${qStr(X(u))},${qStr(Yt(w.ap != null ? w.ap : w.tp))}`);
    }
  }

  // Hourly markers (weather icon, temp, wind arrow, wind speed)
  const hourlyMarkers = [];
  for (let hh = 7; hh <= 21; hh += 2) {
    const u = toU(y, m, d, hh * 60);
    const w = windAt(u, windList);
    const x = qStr(X(u));
    hourlyMarkers.push(
      <g key={`hour-${hh}`}>
        <line x1={x} x2={x} y1={mt} y2={mt + ph} style={{ stroke: 'var(--bd)' }} />
        <text x={x} y={mt + ph + 12} textAnchor="middle" style={{ fill: 'var(--mu)', fontSize: '9px' }}>
          {hh}h
        </text>
        {w && w.tp != null && (
          <g>
            <text x={x} y={mt - 24} textAnchor="middle" style={{ fontSize: '16px' }}>
              {WMO(w.wc)}
            </text>
            <text x={x} y={mt - 8} textAnchor="middle" style={{ fill: 'var(--tx)', fontSize: '10px', fontWeight: 800 }}>
              {Math.round(w.tp)}°
            </text>
            <g transform={`translate(${x},${mt + ph + 30}) rotate(${Math.round(w.a + 180)})`}>
              <path d="M0,-7 L4.5,5 L0,2.5 L-4.5,5 Z" style={{ fill: 'var(--tx)' }} />
            </g>
            <text x={x} y={mt + ph + 53} textAnchor="middle" style={{ fill: 'var(--tx)', fontSize: '10px', fontWeight: 800 }}>
              {Math.round(w.v)}
            </text>
          </g>
        )}
      </g>
    );
  }

  // Crosshair tracking state
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
    const w = windAt(u, windList);
    if (!w || w.tp == null) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      return;
    }
    const px = X(u);
    const text = `${lc(u, y, m, d)} · ${Math.round(w.tp)}° (ressenti ${Math.round(w.ap != null ? w.ap : w.tp)}°) · ${Math.round(w.v)} nds ${comp(w.a)}${
      w.pr && w.pr > 0 ? ' · pluie ' + w.pr.toFixed(1).replace('.', ',') + ' mm/h' : ''
    }`;
    const textX = Math.min(W - mr - 200, Math.max(ml + 2, px + 6));
    setCrosshair({
      visible: true,
      x: px,
      y: Yt(w.tp),
      text,
      textX,
    });
  };

  const handlePointerLeave = () => {
    setCrosshair(prev => ({ ...prev, visible: false }));
  };

  return (
    <div className="card">
      <div className="fh">Météo et température</div>
      {toggleHeader}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
        <span style={{ fontSize: '2.4rem', lineHeight: 1 }}>{WMO(refPoint.wc)}</span>
        <div>
          <b style={{ fontSize: '1.7rem' }}>{Math.round(refPoint.tp ?? 0)} °C</b>
          <div className="note">
            {isT ? 'maintenant' : 'à 14 h'} · ressenti {Math.round(refPoint.ap ?? refPoint.tp ?? 0)} °C ·{' '}
            {WMON(refPoint.wc)}
          </div>
        </div>
      </div>

      <div className="note" style={{ marginBottom: '8px' }}>
        Min {Math.round(Math.min(...tps))} °C · max {Math.round(Math.max(...tps))} °C · pluie{' '}
        {rn >= 0.1 ? qStr(rn).replace('.', ',') + ' mm' : 'aucune'} · vent max{' '}
        {Math.round(Math.max(...rec.map(p => p.v)))} nds
      </div>

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
        {sessionBands}
        {extraBands}
        {tempGrid}
        {rainBars}

        {/* Rain scale */}
        <text x={W - mr + 3} y={mt + 9} style={{ fill: 'var(--cb)', fontSize: '8.5px', fontWeight: 700 }}>
          mm/h
        </text>
        <text x={W - mr + 3} y={mt + ph + 3} style={{ fill: 'var(--cb)', fontSize: '8.5px' }}>
          0
        </text>
        <text x={W - mr + 3} y={qStr(mt + ph - ph * 0.4 + 3)} style={{ fill: 'var(--cb)', fontSize: '8.5px' }}>
          {qStr(rmx)}
        </text>

        {P1.length > 1 && (
          <g>
            <polygon
              points={`${P1[0].split(',')[0]},${mt + ph} ${P1.join(' ')} ${P1[P1.length - 1].split(',')[0]},${mt + ph}`}
              style={{ fill: 'var(--cb)', fillOpacity: 0.14 }}
            />
            <polyline
              points={P2.join(' ')}
              style={{ fill: 'none', stroke: 'var(--cl3)', strokeWidth: 1.5, strokeDasharray: '4 3' }}
            />
            <polyline
              points={P1.join(' ')}
              style={{ fill: 'none', stroke: 'var(--cb)', strokeWidth: 2.8, strokeLinejoin: 'round' }}
            />
          </g>
        )}

        {hourlyMarkers}

        <text x={ml - 4} y={mt + ph + 53} textAnchor="end" style={{ fill: 'var(--mu)', fontSize: '8px' }}>
          nds
        </text>

        {isT && nw >= t0 && nw <= t1 && (
          <line
            x1={qStr(X(nw))}
            x2={qStr(X(nw))}
            y1={mt}
            y2={mt + ph}
            style={{ stroke: 'var(--cn)', strokeWidth: 1.3 }}
          />
        )}

        {crosshair.visible && (
          <g>
            <line x1={crosshair.x} x2={crosshair.x} y1={mt} y2={mt + ph} style={{ stroke: 'var(--tx)' }} />
            <circle cx={crosshair.x} cy={crosshair.y} r={3.6} style={{ fill: 'var(--cb)', stroke: 'var(--cn)' }} />
            <text
              x={crosshair.textX}
              y={mt + 11}
              style={{
                fill: 'var(--tx)',
                fontSize: '8.5px',
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
      <div className="note" style={{ marginTop: '4px' }}>
        Courbe bleue : température · pointillés bleu clair : ressenti · barres marine : pluie (mm/h) · bande pâle : jour · bandes bleues : séances · flèches : sens où va le vent, avec sa force en nœuds. Touche ou survole le graphique pour le détail.
      </div>
    </div>
  );
};
