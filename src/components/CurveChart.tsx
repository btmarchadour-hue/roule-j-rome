import React, { useId, useMemo, useRef, useState } from 'react';
import { AppSettings, TidePoint } from '../types';
import { COEF, build, dayInfo, dayLight, hAt, lc, p2, plan, toU } from '../utils/tides';
import { estimateDeltaBeachMeters } from '../utils/beachOrientation';

interface CurveChartProps {
  dateStr: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
}

interface SamplePoint {
  u: number;
  hTheo: number | null;
  hReal: number | null;
}

interface SignedSegment {
  sign: 'pos' | 'neg';
  points: { u: number; hReal: number; hTheo: number }[];
}

function splitSignedSegments(samples: SamplePoint[]): SignedSegment[] {
  const valid = samples.filter(
    (p): p is { u: number; hReal: number; hTheo: number } =>
      p.hReal != null && p.hTheo != null
  );
  if (valid.length < 2) return [];

  const segments: SignedSegment[] = [];
  let currentSign: 'pos' | 'neg' | null = null;
  let currentPts: { u: number; hReal: number; hTheo: number }[] = [];

  const flush = () => {
    if (currentSign && currentPts.length >= 2) {
      const maxAbs = Math.max(
        ...currentPts.map(pt => Math.abs(pt.hReal - pt.hTheo))
      );
      if (maxAbs >= 0.01) {
        segments.push({ sign: currentSign, points: currentPts });
      }
    }
    currentPts = [];
  };

  for (let i = 0; i < valid.length - 1; i++) {
    const a = valid[i];
    const b = valid[i + 1];
    const da = a.hReal - a.hTheo;
    const db = b.hReal - b.hTheo;

    const sa: 'pos' | 'neg' | null = da > 0.0005 ? 'pos' : da < -0.0005 ? 'neg' : null;
    const sb: 'pos' | 'neg' | null = db > 0.0005 ? 'pos' : db < -0.0005 ? 'neg' : null;

    if (sa && sb && sa !== sb) {
      // Zero crossing inside [a, b]
      const ratio = Math.abs(da) / (Math.abs(da) + Math.abs(db));
      const uCross = a.u + ratio * (b.u - a.u);
      const hCross = a.hTheo + ratio * (b.hTheo - a.hTheo);
      const crossPt = { u: uCross, hReal: hCross, hTheo: hCross };

      if (currentSign !== sa) {
        flush();
        currentSign = sa;
        currentPts = [a];
      } else if (currentPts.length === 0) {
        currentPts = [a];
      }
      currentPts.push(crossPt);
      flush();

      currentSign = sb;
      currentPts = [crossPt, b];
      continue;
    }

    const segSign = sa || sb;
    if (!segSign) {
      flush();
      currentSign = null;
      continue;
    }

    if (currentSign !== segSign) {
      flush();
      currentSign = segSign;
      currentPts = [a, b];
    } else {
      if (currentPts.length === 0) currentPts.push(a);
      currentPts.push(b);
    }
  }
  flush();
  return segments;
}

function measurePracticableMinutes(
  samples: SamplePoint[],
  getH: (p: SamplePoint) => number | null,
  thr: number,
  winStart: number,
  winEnd: number
): number {
  let total = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const u0 = samples[i].u;
    const u1 = samples[i + 1].u;
    const clip0 = Math.max(u0, winStart);
    const clip1 = Math.min(u1, winEnd);
    if (clip1 <= clip0) continue;

    const h0 = getH(samples[i]);
    const h1 = getH(samples[i + 1]);
    if (h0 == null || h1 == null) continue;

    const dt = u1 - u0;
    const hc0 = h0 + ((clip0 - u0) / dt) * (h1 - h0);
    const hc1 = h0 + ((clip1 - u0) / dt) * (h1 - h0);
    const cdt = clip1 - clip0;

    if (hc0 <= thr && hc1 <= thr) {
      total += cdt;
    } else if (hc0 <= thr || hc1 <= thr) {
      const t = (thr - hc0) / (hc1 - hc0);
      total += hc0 <= thr ? cdt * t : cdt * (1 - t);
    }
  }
  return total;
}

export const CurveChart: React.FC<CurveChartProps> = ({
  dateStr,
  settings,
  EX,
  W: tideW,
  first,
  last,
}) => {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');

  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);

  const isRealMode = settings.calculationMode === 'reel';
  const empiricalOffsetM = (settings.empiricalOffsetCm ?? 15) / 100;

  // 1. Modèle théorique pur SHOM (sans surcote pression ni offset empirique)
  const rawEX = useMemo(() => build(settings.les, false, []), [settings.les]);

  // 2. Échantillonnage synchrone des deux courbes (pas de 10 min sur 24h)
  const pts: SamplePoint[] = useMemo(() => {
    const arr: SamplePoint[] = [];
    for (let u = t0; u <= t1; u += 10) {
      const ht = hAt(u, rawEX);
      const hr = hAt(u, EX);
      const hAdjusted = hr != null ? (isRealMode ? hr + empiricalOffsetM : hr) : null;
      arr.push({ u, hTheo: ht, hReal: hAdjusted });
    }
    return arr;
  }, [t0, t1, rawEX, EX, isRealMode, empiricalOffsetM]);

  const validDeltaPts = useMemo(
    () =>
      pts.filter(
        (p): p is { u: number; hReal: number; hTheo: number } =>
          p.hReal != null && p.hTheo != null
      ),
    [pts]
  );

  const deltaStats = useMemo(() => {
    if (!validDeltaPts.length) {
      return {
        hasOffset: false,
        maxPosCm: 0,
        maxPosU: t0,
        minNegCm: 0,
        minNegU: t0,
        avgCm: 0,
        peakAbsCm: 0,
        peakU: t0,
        peakSignedCm: 0,
        maxGainM: 0,
        maxGainU: t0,
        minLossM: 0,
        minLossU: t0,
        avgBeachM: 0,
        peakAbsM: 0,
        peakSignedM: 0,
        peakMU: t0,
      };
    }
    let maxPosCm = 0;
    let maxPosU = validDeltaPts[0].u;
    let minNegCm = 0;
    let minNegU = validDeltaPts[0].u;
    let sumCm = 0;
    let peakAbsCm = 0;
    let peakSignedCm = 0;
    let peakU = validDeltaPts[0].u;

    let maxGainM = 0;
    let maxGainU = validDeltaPts[0].u;
    let minLossM = 0;
    let minLossU = validDeltaPts[0].u;
    let sumM = 0;
    let peakAbsM = 0;
    let peakSignedM = 0;
    let peakMU = validDeltaPts[0].u;

    for (const p of validDeltaPts) {
      const dCm = (p.hReal - p.hTheo) * 100;
      const dM = estimateDeltaBeachMeters(p.hTheo, p.hReal);

      sumCm += dCm;
      if (dCm > maxPosCm) {
        maxPosCm = dCm;
        maxPosU = p.u;
      }
      if (dCm < minNegCm) {
        minNegCm = dCm;
        minNegU = p.u;
      }
      if (Math.abs(dCm) > peakAbsCm) {
        peakAbsCm = Math.abs(dCm);
        peakSignedCm = dCm;
        peakU = p.u;
      }

      sumM += dM;
      if (dM > maxGainM) {
        maxGainM = dM;
        maxGainU = p.u;
      }
      if (dM < minLossM) {
        minLossM = dM;
        minLossU = p.u;
      }
      if (Math.abs(dM) > peakAbsM) {
        peakAbsM = Math.abs(dM);
        peakSignedM = dM;
        peakMU = p.u;
      }
    }
    return {
      hasOffset: peakAbsCm >= 1.5,
      maxPosCm: Math.round(maxPosCm),
      maxPosU,
      minNegCm: Math.round(minNegCm),
      minNegU,
      avgCm: Math.round(sumCm / validDeltaPts.length),
      peakAbsCm: Math.round(peakAbsCm),
      peakSignedCm: Math.round(peakSignedCm),
      peakU,
      maxGainM: Math.round(maxGainM),
      maxGainU,
      minLossM: Math.round(minLossM),
      minLossU,
      avgBeachM: Math.round(sumM / validDeltaPts.length),
      peakAbsM: Math.round(peakAbsM),
      peakSignedM: Math.round(peakSignedM),
      peakMU,
    };
  }, [validDeltaPts, t0]);

  const [showFill, setShowFill] = useState(true);
  const [showDeltaLoupe, setShowDeltaLoupe] = useState(true);

  const allHeights = pts
    .flatMap(p => [p.hTheo, p.hReal])
    .filter((v): v is number => v != null);
  if (!allHeights.length) return null;

  const thr = settings.L - (settings.mg || 0) / 100;

  const W = 360;
  const ml = 28;
  const mr = 8;
  const mt = 14;
  const ph = 156;
  const pw = W - ml - mr;

  const stripActive = showDeltaLoupe && deltaStats.hasOffset;
  const barsTop = mt + ph + 18;
  const stripTop = barsTop + 26;
  const stripHeaderH = 12;
  const plotStripTop = stripTop + stripHeaderH;
  const plotStripH = 46;
  const stripH = stripHeaderH + plotStripH;
  const H = stripActive ? stripTop + stripH + 10 : barsTop + 22;

  const ymin = Math.floor(Math.min(...allHeights) - 0.3);
  const ymax = Math.ceil(Math.max(Math.max(...allHeights), thr) + 0.4);

  const X = (u: number) => ml + ((u - t0) / (t1 - t0)) * pw;
  const Y = (h: number) => mt + ph - ((h - ymin) / (ymax - ymin)) * ph;
  const f1 = (v: number) => v.toFixed(1);

  // Daylight window
  const l = dayLight(y, m, d, settings.lum, settings.lmg);
  const dayStartX = l ? X(Math.max(l[0], t0)) : null;
  const dayEndX = l ? X(Math.min(l[1], t1)) : null;

  const practicableDiffMin = useMemo(() => {
    if (!deltaStats.hasOffset) return 0;
    const winStart = l ? Math.max(l[0], t0) : t0;
    const winEnd = l ? Math.min(l[1], t1) : t1;
    const mTheo = measurePracticableMinutes(pts, p => p.hTheo, thr, winStart, winEnd);
    const mReal = measurePracticableMinutes(pts, p => p.hReal, thr, winStart, winEnd);
    return Math.round(mReal - mTheo);
  }, [deltaStats.hasOffset, l, t0, t1, pts, thr]);

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
        {stripActive && (
          <line
            x1={x}
            x2={x}
            y1={plotStripTop}
            y2={stripTop + stripH}
            style={{ stroke: 'rgba(255, 255, 255, 0.12)' }}
          />
        )}
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

  // Courbe théorique SHOM
  const theoPointsStr = pts
    .filter(p => p.hTheo != null)
    .map(p => `${f1(X(p.u))},${f1(Y(p.hTheo!))}`)
    .join(' ');

  // Polygones signés haute visibilité entre Réel et Théorique
  const signedSegments = useMemo(() => splitSignedSegments(pts), [pts]);
  const surcotePatternId = `hatch-surcote-${uid}`;
  const souscotePatternId = `hatch-souscote-${uid}`;

  // Courbe réelle continue (Cyan sous seuil, Bleu au-dessus)
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
            stroke: col || '#38bdf8',
            strokeWidth: 2.5,
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
          }}
        />
      );
    }
    run = [];
  };

  let polyIdx = 0;
  for (const p of pts) {
    const h = p.hReal;
    if (h == null) {
      flush(polyIdx++);
      col = null;
      continue;
    }
    const c = h <= thr ? '#38bdf8' : '#60a5fa';
    if (c !== col) {
      const lastPt = run.length ? run[run.length - 1] : null;
      flush(polyIdx++);
      col = c;
      if (lastPt) run = [lastPt];
    }
    run.push(`${f1(X(p.u))},${f1(Y(h))}`);
  }
  flush(polyIdx++);

  // PM / BM markers positioned directly on the real curve
  const ex = EX.filter(p => p.t >= t0 && p.t < t1);
  const pmBmMarks = ex.map((p, idx) => {
    const x = X(p.t);
    const hDisplayed = isRealMode ? p.h + empiricalOffsetM : p.h;
    const yy = Y(hDisplayed);
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
            (isRealMode
              ? hDisplayed
              : p.hd != null
                ? p.hd
                : p.h
            )
              .toFixed(2)
              .replace('.', ',')}
        </text>
      </g>
    );
  });

  // Windows & Sessions lanes
  const dayP = dayInfo(y, m, d, settings, tideW, first, last);
  const pl = plan(y, m, d, settings, tideW, first, last);

  const windowBars = dayP.map((p, idx) => (
    <rect
      key={`wbar-${idx}`}
      x={f1(X(p[0]))}
      y={barsTop}
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
      y={barsTop + 10}
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
      y={barsTop + 10}
      width={f1(Math.max(1, X(p[1]) - X(p[0]) - 1))}
      height={7}
      rx={2}
      style={{ fill: 'var(--cl2)' }}
    />
  ));

  // Ligne "maintenant"
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
        {stripActive && (
          <line
            x1={f1(X(nw))}
            x2={f1(X(nw))}
            y1={plotStripTop}
            y2={stripTop + stripH}
            style={{ stroke: '#ffc40d', strokeWidth: 1.2, strokeDasharray: '2 2', strokeOpacity: 0.75 }}
          />
        )}
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

  // Synchronized Loupe Plage (±m gagnés / perdus pour rouler) calculations
  const stripBounds = useMemo(() => {
    const rawMin = Math.min(0, deltaStats.minLossM);
    const rawMax = Math.max(0, deltaStats.maxGainM);
    const maxAbs = Math.max(rawMax, Math.abs(rawMin));
    const step = maxAbs > 40 ? 20 : maxAbs > 20 ? 10 : 5;

    if (rawMin < 0 && rawMax === 0) {
      return {
        sMin: Math.floor((rawMin - 2) / step) * step,
        sMax: 0,
      };
    }
    if (rawMax > 0 && rawMin === 0) {
      return {
        sMin: 0,
        sMax: Math.ceil((rawMax + 2) / step) * step,
      };
    }
    if (rawMin < 0 && rawMax > 0) {
      return {
        sMin: Math.floor((rawMin - 2) / step) * step,
        sMax: Math.ceil((rawMax + 2) / step) * step,
      };
    }
    return { sMin: -5, sMax: 5 };
  }, [deltaStats.minLossM, deltaStats.maxGainM]);

  const Yd = (meters: number) =>
    plotStripTop +
    plotStripH -
    ((meters - stripBounds.sMin) / (stripBounds.sMax - stripBounds.sMin)) * plotStripH;
  const zeroY = Yd(0);

  // Interactive crosshair state
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [crosshair, setCrosshair] = useState<{
    visible: boolean;
    x: number;
    yReal: number;
    yTheo: number | null;
    deltaCm: number;
    deltaBeachM: number;
    deltaBeachExactM: number;
    timeLabel: string;
    hReal: number;
    hTheo: number | null;
    underThr: boolean;
  }>({
    visible: false,
    x: 0,
    yReal: 0,
    yTheo: null,
    deltaCm: 0,
    deltaBeachM: 0,
    deltaBeachExactM: 0,
    timeLabel: '',
    hReal: 0,
    hTheo: null,
    underThr: false,
  });

  const handlePointer = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const fx = ((ev.clientX - r.left) / r.width) * W;
    if (fx < ml || fx > W - mr) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      return;
    }
    const u = t0 + ((fx - ml) / pw) * (t1 - t0);
    const ht = hAt(u, rawEX);
    const hrRaw = hAt(u, EX);
    const hr = hrRaw != null ? (isRealMode ? hrRaw + empiricalOffsetM : hrRaw) : null;
    if (hr == null) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      return;
    }
    const deltaCm = ht != null ? Math.round((hr - ht) * 100) : 0;
    const deltaBeachExactM = ht != null ? estimateDeltaBeachMeters(ht, hr) : 0;
    const deltaBeachM = Math.round(deltaBeachExactM);
    setCrosshair({
      visible: true,
      x: X(u),
      yReal: Y(hr),
      yTheo: ht != null ? Y(ht) : null,
      deltaCm,
      deltaBeachM,
      deltaBeachExactM,
      timeLabel: lc(u, y, m, d),
      hReal: hr,
      hTheo: ht,
      underThr: hr <= thr,
    });
  };

  const handlePointerLeave = () => {
    setCrosshair(prev => ({ ...prev, visible: false }));
  };

  const pmx = ex.filter(p => p.pm).map(p => (p.hd != null ? p.hd : p.h));
  const bmn = ex.filter(p => !p.pm).map(p => (p.hd != null ? p.hd : p.h));
  const mar = pmx.length && bmn.length ? Math.max(...pmx) - Math.min(...bmn) : null;

  const hasPressureCorrection = Boolean(settings.pcor);
  const activeModeParts: string[] = [];
  if (isRealMode) activeModeParts.push(`REX ${empiricalOffsetM >= 0 ? '+' : ''}${Math.round(empiricalOffsetM * 100)} cm`);
  if (hasPressureCorrection) activeModeParts.push('Pression atm.');

  const anchorRight = crosshair.x > ml + pw * 0.54;
  const crosshairDeltaText =
    crosshair.deltaBeachM > 0
      ? `+${crosshair.deltaBeachM} m gagnés`
      : crosshair.deltaBeachM < 0
        ? `${Math.abs(crosshair.deltaBeachM)} m perdus`
        : crosshair.deltaCm !== 0
          ? `0 m (${crosshair.deltaCm > 0 ? '+' : ''}${crosshair.deltaCm} cm)`
          : '0 m';
  const crosshairText = `${crosshair.timeLabel} · Réel ${crosshair.hReal.toFixed(2).replace('.', ',')} m · Théo ${
    crosshair.hTheo != null ? crosshair.hTheo.toFixed(2).replace('.', ',') : '-'
  } m · ${crosshairDeltaText}${crosshair.underThr ? ' · praticable' : ''}`;

  return (
    <div className="crv">
      {/* Barre compacte de comparaison Théorique vs Réel & contrôles visuels */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '6px',
          padding: '6px 9px',
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.06)',
          border: '1px solid rgba(15, 23, 42, 0.1)',
          fontSize: '0.72rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: '#0f172a' }}>
            Écart Réel vs SHOM
          </span>
          {deltaStats.hasOffset ? (
            <span
              style={{
                fontWeight: 700,
                color:
                  deltaStats.peakSignedM < 0 || (deltaStats.peakSignedM === 0 && deltaStats.peakSignedCm >= 0)
                    ? '#c2410c'
                    : '#047857',
                background:
                  deltaStats.peakSignedM < 0 || (deltaStats.peakSignedM === 0 && deltaStats.peakSignedCm >= 0)
                    ? 'rgba(249, 115, 22, 0.14)'
                    : 'rgba(16, 185, 129, 0.14)',
                border:
                  deltaStats.peakSignedM < 0 || (deltaStats.peakSignedM === 0 && deltaStats.peakSignedCm >= 0)
                    ? '1px solid rgba(249, 115, 22, 0.35)'
                    : '1px solid rgba(16, 185, 129, 0.35)',
                padding: '1px 6px',
                borderRadius: '5px',
              }}
            >
              {deltaStats.peakSignedM < 0
                ? `Max ${Math.abs(deltaStats.peakSignedM)} m perdus pour rouler (${lc(deltaStats.peakMU, y, m, d)} · ${deltaStats.peakSignedCm > 0 ? '+' : ''}${deltaStats.peakSignedCm} cm)`
                : deltaStats.peakSignedM > 0
                  ? `Max +${deltaStats.peakSignedM} m gagnés pour rouler (${lc(deltaStats.peakMU, y, m, d)} · ${deltaStats.peakSignedCm > 0 ? '+' : ''}${deltaStats.peakSignedCm} cm)`
                  : `Pic ${deltaStats.peakSignedCm > 0 ? '+' : ''}${deltaStats.peakSignedCm} cm (${lc(deltaStats.peakU, y, m, d)} · 0 m plage)`}
              {activeModeParts.length > 0 ? ` · ${activeModeParts.join(' + ')}` : ''}
            </span>
          ) : (
            <span style={{ color: 'var(--mu)' }}>
              Courbes superposées (aucune correction active aujourd&apos;hui)
            </span>
          )}
        </div>

        {deltaStats.hasOffset && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <button
              type="button"
              onClick={() => setShowFill(v => !v)}
              style={{
                border: showFill
                  ? '1px solid #ea580c'
                  : '1px solid rgba(100, 116, 139, 0.35)',
                background: showFill ? 'rgba(249, 115, 22, 0.14)' : 'transparent',
                color: showFill ? '#9a3412' : '#475569',
                borderRadius: '6px',
                padding: '2px 7px',
                fontSize: '0.69rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Afficher ou masquer le remplissage hachuré entre les deux courbes"
            >
              {showFill ? '✓ ' : ''}Remplissage Δ
            </button>
            <button
              type="button"
              onClick={() => setShowDeltaLoupe(v => !v)}
              style={{
                border: showDeltaLoupe
                  ? '1px solid #0284c7'
                  : '1px solid rgba(100, 116, 139, 0.35)',
                background: showDeltaLoupe ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: showDeltaLoupe ? '#0369a1' : '#475569',
                borderRadius: '6px',
                padding: '2px 7px',
                fontSize: '0.69rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Zoomer les mètres de plage gagnés ou perdus pour rouler (profil Litto3D)"
            >
              {showDeltaLoupe ? '✓ ' : ''}Loupe ±m plage
            </button>
          </div>
        )}
      </div>

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
        <defs>
          {/* Hachures corail-orange vives : Surcote (hReal > hTheo, eau plus haute) */}
          <pattern
            id={surcotePatternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="rgba(249, 115, 22, 0.42)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="rgba(255, 237, 213, 0.78)"
              strokeWidth="2"
            />
          </pattern>

          {/* Hachures menthe-émeraude vives : Sous-cote (hReal < hTheo, eau plus basse) */}
          <pattern
            id={souscotePatternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="6" height="6" fill="rgba(16, 185, 129, 0.4)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="rgba(209, 250, 229, 0.8)"
              strokeWidth="2"
            />
          </pattern>
        </defs>

        {/* Night background is black */}
        <rect x={ml} y={mt} width={pw} height={ph} style={{ fill: '#000000' }} />
        {/* Daylight background is green */}
        {dayStartX != null && dayEndX != null && (
          <rect
            x={f1(dayStartX)}
            y={mt}
            width={f1(Math.max(0, dayEndX - dayStartX))}
            height={ph}
            style={{ fill: '#1b8f4e', fillOpacity: 0.92 }}
          />
        )}

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

        {/* Remplissage signé hachuré entre Courbe Réelle et Courbe SHOM */}
        {showFill &&
          deltaStats.hasOffset &&
          signedSegments.map((seg, idx) => {
            const forwardReal = seg.points.map(
              p => `${f1(X(p.u))},${f1(Y(p.hReal))}`
            );
            const backwardTheo = [...seg.points]
              .reverse()
              .map(p => `${f1(X(p.u))},${f1(Y(p.hTheo))}`);
            const polyPts = [...forwardReal, ...backwardTheo].join(' ');
            return (
              <polygon
                key={`delta-seg-${idx}`}
                points={polyPts}
                fill={`url(#${seg.sign === 'pos' ? surcotePatternId : souscotePatternId})`}
                stroke={seg.sign === 'pos' ? 'rgba(251, 146, 60, 0.7)' : 'rgba(52, 211, 153, 0.7)'}
                strokeWidth={0.6}
              />
            );
          })}

        {/* Halo sombre + Courbe théorique SHOM en pointillés nets */}
        {theoPointsStr && (
          <g>
            <polyline
              points={theoPointsStr}
              style={{
                fill: 'none',
                stroke: '#020617',
                strokeWidth: 2.6,
                strokeDasharray: '4 3',
                strokeOpacity: 0.55,
              }}
            />
            <polyline
              points={theoPointsStr}
              style={{
                fill: 'none',
                stroke: '#fef08a',
                strokeWidth: 1.5,
                strokeDasharray: '4 3',
                strokeOpacity: 0.95,
              }}
            />
          </g>
        )}

        {/* Courbe réelle continue */}
        {polylines}

        {pmBmMarks}
        {windowBars}
        {sessionBars}
        {extraBars}

        {/* LOUPE PLAGE (±m gagnés / perdus pour rouler) synchronisée pixel par pixel sur 0h–24h */}
        {stripActive && (
          <g>
            {/* Fond nuit / jour subtil */}
            <rect
              x={ml}
              y={stripTop}
              width={pw}
              height={stripH}
              rx={3}
              style={{ fill: '#0b1117' }}
            />
            {dayStartX != null && dayEndX != null && (
              <rect
                x={f1(dayStartX)}
                y={plotStripTop}
                width={f1(Math.max(0, dayEndX - dayStartX))}
                height={plotStripH}
                style={{ fill: '#103b25', fillOpacity: 0.85 }}
              />
            )}
            <rect
              x={ml}
              y={stripTop}
              width={pw}
              height={stripHeaderH}
              style={{ fill: 'rgba(15, 23, 42, 0.85)' }}
            />

            {/* Ligne de référence 0 m */}
            <line
              x1={ml}
              x2={W - mr}
              y1={f1(zeroY)}
              y2={f1(zeroY)}
              style={{
                stroke: 'rgba(248, 250, 252, 0.55)',
                strokeWidth: 1,
                strokeDasharray: '3 2',
              }}
            />
            {stripBounds.sMax > 0 && (
              <text
                x={ml - 4}
                y={f1(plotStripTop + 6)}
                textAnchor="end"
                style={{ fill: '#34d399', fontSize: '7.2px', fontWeight: 700 }}
              >
                +{stripBounds.sMax}m
              </text>
            )}
            {(stripBounds.sMax === 0 ||
              stripBounds.sMin === 0 ||
              (zeroY - plotStripTop >= 8 && plotStripTop + plotStripH - zeroY >= 8)) && (
              <text
                x={ml - 4}
                y={f1(
                  stripBounds.sMax === 0
                    ? plotStripTop + 6
                    : stripBounds.sMin === 0
                      ? plotStripTop + plotStripH - 1
                      : zeroY + 2.5
                )}
                textAnchor="end"
                style={{ fill: '#cbd5e1', fontSize: '7.2px', fontWeight: 700 }}
              >
                0m
              </text>
            )}
            {stripBounds.sMin < 0 && (
              <text
                x={ml - 4}
                y={f1(plotStripTop + plotStripH - 1)}
                textAnchor="end"
                style={{ fill: '#fb923c', fontSize: '7.2px', fontWeight: 700 }}
              >
                {stripBounds.sMin}m
              </text>
            )}

            {/* Aires signées en mètres de plage gagnés (+ vert) / perdus (− orange) */}
            {signedSegments.map((seg, idx) => {
              const linePts = seg.points.map(
                p => `${f1(X(p.u))},${f1(Yd(estimateDeltaBeachMeters(p.hTheo, p.hReal)))}`
              );
              const firstX = f1(X(seg.points[0].u));
              const lastX = f1(X(seg.points[seg.points.length - 1].u));
              const zy = f1(zeroY);
              const polyPts = `${firstX},${zy} ${linePts.join(' ')} ${lastX},${zy}`;
              const isLoss = seg.sign === 'pos';
              const color = isLoss ? '#fb923c' : '#34d399';
              return (
                <g key={`strip-seg-${idx}`}>
                  <polygon
                    points={polyPts}
                    style={{
                      fill: isLoss ? '#f97316' : '#10b981',
                      fillOpacity: 0.44,
                    }}
                  />
                  <polyline
                    points={linePts.join(' ')}
                    style={{
                      fill: 'none',
                      stroke: color,
                      strokeWidth: 1.8,
                      strokeLinejoin: 'round',
                    }}
                  />
                </g>
              );
            })}

            {/* Titre interne + pic mètres calé à droite */}
            <text
              x={ml + 4}
              y={stripTop + 8.5}
              style={{
                fill: 'rgba(226, 232, 240, 0.9)',
                fontSize: '7.3px',
                fontWeight: 700,
                letterSpacing: '0.02em',
              }}
            >
              LOUPE PLAGE (±m) · gagnés / perdus pour rouler
            </text>
            <circle
              cx={f1(X(deltaStats.peakMU))}
              cy={f1(Yd(deltaStats.peakSignedM))}
              r={2.6}
              style={{
                fill:
                  deltaStats.peakSignedM < 0
                    ? '#fb923c'
                    : deltaStats.peakSignedM > 0
                      ? '#34d399'
                      : '#cbd5e1',
                stroke: '#000',
                strokeWidth: 0.9,
              }}
            />
            <text
              x={W - mr - 4}
              y={stripTop + 8.5}
              textAnchor="end"
              style={{
                fill:
                  deltaStats.peakSignedM < 0
                    ? '#fdba74'
                    : deltaStats.peakSignedM > 0
                      ? '#6ee7b7'
                      : '#cbd5e1',
                fontSize: '7.3px',
                fontWeight: 800,
              }}
            >
              {deltaStats.peakSignedM < 0
                ? `pire ${deltaStats.peakSignedM} m (${lc(deltaStats.peakMU, y, m, d)})`
                : deltaStats.peakSignedM > 0
                  ? `max +${deltaStats.peakSignedM} m (${lc(deltaStats.peakMU, y, m, d)})`
                  : `0 m (${lc(deltaStats.peakU, y, m, d)})`}
            </text>

            {/* Cadre net de la bande Loupe */}
            <rect
              x={ml}
              y={stripTop}
              width={pw}
              height={stripH}
              rx={3}
              style={{
                fill: 'none',
                stroke: 'rgba(148, 163, 184, 0.35)',
                strokeWidth: 0.8,
              }}
            />
          </g>
        )}

        {nowLine}

        {/* Double curseur interactif + pont vertical Δ */}
        {crosshair.visible && (
          <g>
            <line
              x1={crosshair.x}
              x2={crosshair.x}
              y1={mt}
              y2={mt + ph}
              style={{ stroke: 'rgba(255, 255, 255, 0.82)', strokeWidth: 1.1 }}
            />
            {stripActive && (
              <>
                <line
                  x1={crosshair.x}
                  x2={crosshair.x}
                  y1={plotStripTop}
                  y2={stripTop + stripH}
                  style={{ stroke: 'rgba(255, 255, 255, 0.78)', strokeWidth: 1.1 }}
                />
                <circle
                  cx={crosshair.x}
                  cy={Yd(crosshair.deltaBeachExactM)}
                  r={3.2}
                  style={{
                    fill:
                      crosshair.deltaBeachExactM < -0.25
                        ? '#fb923c'
                        : crosshair.deltaBeachExactM > 0.25
                          ? '#34d399'
                          : '#cbd5e1',
                    stroke: '#000',
                    strokeWidth: 1,
                  }}
                />
              </>
            )}

            {/* Pont vertical entre Théorique et Réel */}
            {crosshair.yTheo != null && Math.abs(crosshair.yReal - crosshair.yTheo) >= 1 && (
              <line
                x1={crosshair.x}
                x2={crosshair.x}
                y1={crosshair.yTheo}
                y2={crosshair.yReal}
                style={{
                  stroke: crosshair.deltaCm >= 0 ? '#fb923c' : '#34d399',
                  strokeWidth: 2.8,
                  strokeLinecap: 'round',
                }}
              />
            )}

            {/* Point Théorique (anneau blanc) */}
            {crosshair.yTheo != null && (
              <circle
                cx={crosshair.x}
                cy={crosshair.yTheo}
                r={3.2}
                style={{ fill: '#0f172a', stroke: '#fef08a', strokeWidth: 1.4 }}
              />
            )}

            {/* Point Réel (jaune plein) */}
            <circle
              cx={crosshair.x}
              cy={crosshair.yReal}
              r={3.8}
              style={{ fill: '#ffc40d', stroke: '#000', strokeWidth: 1.2 }}
            />

            {/* Étiquette de lecture auto-alignée (ne déborde pas à droite) */}
            <text
              x={anchorRight ? crosshair.x - 6 : crosshair.x + 6}
              y={mt + 10}
              textAnchor={anchorRight ? 'end' : 'start'}
              style={{
                fill: '#ffffff',
                fontSize: '9px',
                fontWeight: 800,
                paintOrder: 'stroke',
                stroke: '#0a0d0b',
                strokeWidth: '3.5px',
              }}
            >
              {crosshairText}
            </text>
          </g>
        )}
      </svg>

      {/* Légende enrichie & impact concret sur la plage praticable */}
      <div className="m" style={{ marginTop: '6px', fontSize: '0.72rem', lineHeight: '1.45' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '3px', background: '#38bdf8', display: 'inline-block' }} />
            <strong>Courbe réelle (modèle corrigé)</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '2px', borderTop: '2px dashed #eab308', display: 'inline-block' }} />
            <span>Courbe théorique SHOM</span>
          </span>
          {deltaStats.hasOffset && deltaStats.maxPosCm >= 2 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{
                  width: '11px',
                  height: '11px',
                  background:
                    'repeating-linear-gradient(45deg, rgba(249,115,22,0.55), rgba(249,115,22,0.55) 2px, rgba(255,237,213,0.9) 2px, rgba(255,237,213,0.9) 3.5px)',
                  border: '1px solid #ea580c',
                  borderRadius: '2px',
                  display: 'inline-block',
                }}
              />
              <strong style={{ color: '#c2410c' }}>Surcote (+cm, plage perdue)</strong>
            </span>
          )}
          {deltaStats.hasOffset && deltaStats.minNegCm <= -2 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{
                  width: '11px',
                  height: '11px',
                  background:
                    'repeating-linear-gradient(-45deg, rgba(16,185,129,0.55), rgba(16,185,129,0.55) 2px, rgba(209,250,229,0.9) 2px, rgba(209,250,229,0.9) 3.5px)',
                  border: '1px solid #059669',
                  borderRadius: '2px',
                  display: 'inline-block',
                }}
              />
              <strong style={{ color: '#047857' }}>Sous-cote (−cm, plage gagnée)</strong>
            </span>
          )}
        </div>

        {deltaStats.hasOffset && (
          <div
            style={{
              marginBottom: '4px',
              padding: '4px 8px',
              borderRadius: '6px',
              background:
                practicableDiffMin < 0
                  ? 'rgba(249, 115, 22, 0.09)'
                  : practicableDiffMin > 0
                    ? 'rgba(16, 185, 129, 0.09)'
                    : 'rgba(100, 116, 139, 0.08)',
              color: '#1e293b',
            }}
          >
            <strong>Impact plage (jour) :</strong>{' '}
            {practicableDiffMin < 0 ? (
              <span style={{ color: '#c2410c', fontWeight: 700 }}>
                {practicableDiffMin} min de roulage praticable par rapport au SHOM
              </span>
            ) : practicableDiffMin > 0 ? (
              <span style={{ color: '#047857', fontWeight: 700 }}>
                +{practicableDiffMin} min de roulage praticable par rapport au SHOM
              </span>
            ) : (
              <span>aucun impact sur la durée praticable du jour</span>
            )}
            {' · '}impact moyen{' '}
            <b>
              {deltaStats.avgBeachM > 0
                ? `+${deltaStats.avgBeachM} m gagnés`
                : deltaStats.avgBeachM < 0
                  ? `${Math.abs(deltaStats.avgBeachM)} m perdus`
                  : '0 m'}
            </b>{' '}
            ({deltaStats.avgCm > 0 ? '+' : ''}
            {deltaStats.avgCm} cm).
          </div>
        )}

        Courbe de marée (heures locales, hauteur en m). <b>Fond vert : journée</b> ·{' '}
        <b>fond noir : nuit</b> · barre bleue : plage praticable · barres marine : séances.
        Touche ou survole la courbe pour lire les deux hauteurs et les mètres gagnés ou perdus pour rouler (profil Litto3D).
        {mar != null && (
          <span>
            {' '}
            <b>Marnage du jour : {mar.toFixed(2).replace('.', ',')} m</b> (coef{' '}
            {COEF[`${y}-${p2(m + 1)}-${p2(d)}`]}).
          </span>
        )}
      </div>
    </div>
  );
};
