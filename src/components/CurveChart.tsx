import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AppSettings, GpsWaterlineLog, TidePoint, WindPoint } from '../types';
import { COEF, build, dayInfo, dayLight, hAt, lc, p2, plan, toU, windAt } from '../utils/tides';
import {
  BAY_ZONES_META,
  BayZoneId,
  estimateLitto3dWaterlineXExactM,
} from '../utils/beachOrientation';
import { getStoredBeachCadreConfig } from '../utils/beachCadreEngine';
import {
  getOfflineGpsQueue,
  getStoredWaterlineLogs,
  mergeOfflineQueueWithLogs,
} from '../utils/waterlineGpsEngine';
import { subscribeToWaterlineGpsLogs } from '../utils/firebaseSync';
import { BeachPisteDiagram } from './BeachPisteDiagram';
import {
  buildPhysicalObservationPoints,
  fitEmpiricalTerrainModel,
  OBSERVATORY_START_DATE,
  predictEmpiricalAt,
} from '../utils/physicalCorrelationEngine';
import { getStoredObservations } from '../utils/statisticsEngine';

interface CurveChartProps {
  dateStr: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList?: WindPoint[];
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
  windList = [],
}) => {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');

  const [selectedZone, setSelectedZone] = useState<BayZoneId>('lestrevet');
  const [gpsLogs, setGpsLogs] = useState<GpsWaterlineLog[]>(() =>
    mergeOfflineQueueWithLogs(getStoredWaterlineLogs(), getOfflineGpsQueue())
  );

  useEffect(() => {
    const unsub = subscribeToWaterlineGpsLogs(
      remoteLogs => {
        setGpsLogs(mergeOfflineQueueWithLogs(remoteLogs, getOfflineGpsQueue()));
      },
      () => {
        // Fallback silencieux sur le cache local si hors-ligne
      }
    );
    return () => unsub();
  }, []);

  const activeCadre = useMemo(() => {
    const cfg = getStoredBeachCadreConfig();
    return cfg.profiles[cfg.activeProfile] ?? null;
  }, []);

  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);

  const thr = settings.L - (settings.mg || 0) / 100;
  const jeromeRawLimitH = settings.L;

  // 1. Modèle théorique pur SHOM (sans correction météo)
  const rawEX = useMemo(() => build(settings.les, false, []), [settings.les]);

  // 2. Modèle Réel Empirique unifié (Pression + Houle + Vent · calibration progressive dès le 20/11/2026)
  const empiricalTerrainModel = useMemo(() => {
    const rexObs = getStoredObservations().filter(
      o => o && o.id && !o.id.startsWith('sample-obs-')
    );
    const { points } = buildPhysicalObservationPoints(
      gpsLogs,
      rexObs,
      activeCadre,
      OBSERVATORY_START_DATE
    );
    return fitEmpiricalTerrainModel(points);
  }, [gpsLogs, activeCadre]);

  const empiricalBasisLabel =
    empiricalTerrainModel.sampleCountSurcote > 0
      ? `${empiricalTerrainModel.terrainConfidencePct}% terrain · ${empiricalTerrainModel.sampleCountSurcote} rel. dès 20/11`
      : 'Pression + Houle + Vent';

  // 3. Échantillonnage synchrone SHOM brut vs Modèle Réel Empirique (pas de 10 min sur 24h)
  const pts: SamplePoint[] = useMemo(() => {
    const arr: SamplePoint[] = [];
    for (let u = t0; u <= t1; u += 10) {
      const ht = hAt(u, rawEX);
      const w = windList.length > 0 ? windAt(u, windList) : null;
      const pred = predictEmpiricalAt(empiricalTerrainModel, w);
      const hEmp = ht != null ? Number((ht + pred.surcoteCm / 100).toFixed(2)) : null;
      arr.push({ u, hTheo: ht, hReal: hEmp });
    }
    return arr;
  }, [t0, t1, rawEX, windList, empiricalTerrainModel]);

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
        minNegCm: 0,
        avgCm: 0,
        peakAbsCm: 0,
        peakU: t0,
        peakSignedCm: 0,
        avgBeachM: 0,
        peakSignedM: 0,
        peakMU: t0,
      };
    }
    let maxPosCm = 0;
    let minNegCm = 0;
    let sumCm = 0;
    let peakAbsCm = 0;
    let peakSignedCm = 0;
    let peakU = validDeltaPts[0].u;

    let sumM = 0;
    let peakAbsM = 0;
    let peakSignedM = 0;
    let peakMU = validDeltaPts[0].u;

    for (const p of validDeltaPts) {
      const dCm = (p.hReal - p.hTheo) * 100;
      const dM =
        estimateLitto3dWaterlineXExactM(p.hReal) -
        estimateLitto3dWaterlineXExactM(p.hTheo);

      sumCm += dCm;
      if (dCm > maxPosCm) maxPosCm = dCm;
      if (dCm < minNegCm) minNegCm = dCm;
      if (Math.abs(dCm) > peakAbsCm) {
        peakAbsCm = Math.abs(dCm);
        peakSignedCm = dCm;
        peakU = p.u;
      }

      sumM += dM;
      if (Math.abs(dM) > peakAbsM) {
        peakAbsM = Math.abs(dM);
        peakSignedM = dM;
        peakMU = p.u;
      }
    }
    return {
      hasOffset: peakAbsCm >= 1.5,
      maxPosCm: Math.round(maxPosCm),
      minNegCm: Math.round(minNegCm),
      avgCm: Math.round(sumCm / validDeltaPts.length),
      peakAbsCm: Math.round(peakAbsCm),
      peakSignedCm: Math.round(peakSignedCm),
      peakU,
      avgBeachM: Math.round(sumM / validDeltaPts.length),
      peakSignedM: Math.round(peakSignedM),
      peakMU,
    };
  }, [validDeltaPts, t0]);

  const [showFill, setShowFill] = useState(true);
  const [showPisteView, setShowPisteView] = useState(true);

  const l = useMemo(
    () => dayLight(y, m, d, settings.lum, settings.lmg),
    [y, m, d, settings.lum, settings.lmg]
  );

  const dayP = useMemo(
    () => dayInfo(y, m, d, settings, tideW, first, last),
    [y, m, d, settings, tideW, first, last]
  );
  const pl = useMemo(
    () => plan(y, m, d, settings, tideW, first, last),
    [y, m, d, settings, tideW, first, last]
  );

  const practicableDiffMin = useMemo(() => {
    if (!deltaStats.hasOffset) return 0;
    const winStart = l ? Math.max(l[0], t0) : t0;
    const winEnd = l ? Math.min(l[1], t1) : t1;
    const mTheo = measurePracticableMinutes(pts, p => p.hTheo, thr, winStart, winEnd);
    const mReal = measurePracticableMinutes(pts, p => p.hReal, thr, winStart, winEnd);
    return Math.round(mReal - mTheo);
  }, [deltaStats.hasOffset, l, t0, t1, pts, thr]);

  const signedSegments = useMemo(() => splitSignedSegments(pts), [pts]);

  const computeDefaultTimeU = () => {
    const nowMin = Date.now() / 6e4;
    if (nowMin >= t0 && nowMin < t1) {
      return Math.min(t1, Math.max(t0, Math.round(nowMin / 10) * 10));
    }
    const firstSlot = pl.full[0] || pl.extra[0];
    if (firstSlot) {
      return Math.min(t1, Math.max(t0, Math.round(((firstSlot[0] + firstSlot[1]) / 2) / 10) * 10));
    }
    if (dayP[0]) {
      return Math.min(t1, Math.max(t0, Math.round(((dayP[0][0] + dayP[0][1]) / 2) / 10) * 10));
    }
    return toU(y, m, d, 14 * 60);
  };

  const [pinnedU, setPinnedU] = useState<number>(() => computeDefaultTimeU());
  const [hoverU, setHoverU] = useState<number | null>(null);

  useEffect(() => {
    setPinnedU(computeDefaultTimeU());
    setHoverU(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr]);

  const activeU = Math.min(t1, Math.max(t0, hoverU ?? pinnedU));

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [crosshair, setCrosshair] = useState<{
    visible: boolean;
    x: number;
    yReal: number;
    yTheo: number | null;
    deltaCm: number;
    deltaBeachM: number;
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
    timeLabel: '',
    hReal: 0,
    hTheo: null,
    underThr: false,
  });

  const allHeights = pts
    .flatMap(p => [p.hTheo, p.hReal])
    .filter((v): v is number => v != null);
  if (!allHeights.length) return null;

  const W = 360;
  const ml = 28;
  const mr = 8;
  const mt = 14;
  const ph = 156;
  const pw = W - ml - mr;

  const barsTop = mt + ph + 18;
  const H = barsTop + 22;

  const ymin = Math.floor(Math.min(...allHeights) - 0.3);
  const ymax = Math.ceil(Math.max(Math.max(...allHeights), thr, jeromeRawLimitH) + 0.4);

  const X = (u: number) => ml + ((u - t0) / (t1 - t0)) * pw;
  const Y = (h: number) => mt + ph - ((h - ymin) / (ymax - ymin)) * ph;
  const f1 = (v: number) => v.toFixed(1);

  // Daylight window
  const dayStartX = l ? X(Math.max(l[0], t0)) : null;
  const dayEndX = l ? X(Math.min(l[1], t1)) : null;

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

  // Courbe théorique SHOM
  const theoPointsStr = pts
    .filter(p => p.hTheo != null)
    .map(p => `${f1(X(p.u))},${f1(Y(p.hTheo!))}`)
    .join(' ');

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

  // PM / BM markers (marée astronomique SHOM brute)
  const ex = rawEX.filter(p => p.t >= t0 && p.t < t1);
  const pmBmMarks = ex.map((p, idx) => {
    const x = X(p.t);
    const hDisplayed = p.h;
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
            (p.hd != null ? p.hd : p.h).toFixed(2).replace('.', ',')}
        </text>
      </g>
    );
  });

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
  const isToday = nw >= t0 && nw < t1;
  let nowLine = null;
  if (isToday) {
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

  const handlePointer = (ev: React.PointerEvent<SVGSVGElement>, pinOnTap = false) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const fx = ((ev.clientX - r.left) / r.width) * W;
    if (fx < ml || fx > W - mr) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      setHoverU(null);
      return;
    }
    const u = Math.min(t1, Math.max(t0, t0 + ((fx - ml) / pw) * (t1 - t0)));
    const ht = hAt(u, rawEX);
    const wAtU = windList.length > 0 ? windAt(u, windList) : null;
    const predAtU = predictEmpiricalAt(empiricalTerrainModel, wAtU);
    const hr = ht != null ? Number((ht + predAtU.surcoteCm / 100).toFixed(2)) : null;
    if (hr == null) {
      setCrosshair(prev => ({ ...prev, visible: false }));
      setHoverU(null);
      return;
    }
    const deltaCm = ht != null ? Math.round((hr - ht) * 100) : 0;
    const deltaBeachM =
      ht != null
        ? Math.round(estimateLitto3dWaterlineXExactM(hr) - estimateLitto3dWaterlineXExactM(ht))
        : 0;
    setHoverU(u);
    if (pinOnTap) {
      setPinnedU(Math.round(u / 10) * 10);
    }
    setCrosshair({
      visible: true,
      x: X(u),
      yReal: Y(hr),
      yTheo: ht != null ? Y(ht) : null,
      deltaCm,
      deltaBeachM,
      timeLabel: lc(u, y, m, d),
      hReal: hr,
      hTheo: ht,
      underThr: hr <= thr,
    });
  };

  const handlePointerLeave = () => {
    setCrosshair(prev => ({ ...prev, visible: false }));
    setHoverU(null);
  };

  const pmx = ex.filter(p => p.pm).map(p => (p.hd != null ? p.hd : p.h));
  const bmn = ex.filter(p => !p.pm).map(p => (p.hd != null ? p.hd : p.h));
  const mar = pmx.length && bmn.length ? Math.max(...pmx) - Math.min(...bmn) : null;

  const activeModeParts: string[] = [empiricalBasisLabel];

  const anchorRight = crosshair.x > ml + pw * 0.54;
  const crosshairDeltaText =
    crosshair.deltaBeachM > 0
      ? `+${crosshair.deltaBeachM} m gagnés`
      : crosshair.deltaBeachM < 0
        ? `${Math.abs(crosshair.deltaBeachM)} m perdus`
        : crosshair.deltaCm !== 0
          ? `0 m (${crosshair.deltaCm > 0 ? '+' : ''}${crosshair.deltaCm} cm)`
          : '0 m';
  const crosshairText = `${crosshair.timeLabel} · Empirique ${crosshair.hReal.toFixed(2).replace('.', ',')} m · SHOM ${
    crosshair.hTheo != null ? crosshair.hTheo.toFixed(2).replace('.', ',') : '-'
  } m · ${crosshairDeltaText}${crosshair.underThr ? ' · praticable' : ''}`;

  // Calculs temps réel synchronisés à `activeU` pour la Vue Piste Interactive
  const softSandMarginM = activeCadre?.softSandMarginM ?? 50;
  const activeWind = useMemo(
    () => (windList.length > 0 ? windAt(activeU, windList) : null),
    [activeU, windList]
  );
  const activeWaveHeightM =
    activeWind?.wvh != null && Number.isFinite(activeWind.wvh)
      ? Number(activeWind.wvh.toFixed(2))
      : null;

  const activeHt = hAt(activeU, rawEX);
  const activeEmpPred = useMemo(
    () => predictEmpiricalAt(empiricalTerrainModel, activeWind),
    [empiricalTerrainModel, activeWind]
  );
  const activeHr =
    activeHt != null ? Number((activeHt + activeEmpPred.surcoteCm / 100).toFixed(2)) : null;

  const theoWaterHeightM = Number((activeHt ?? jeromeRawLimitH).toFixed(2));
  const realWaterHeightM = Number((activeHr ?? activeHt ?? jeromeRawLimitH).toFixed(2));
  const activeDeltaCm = Math.round((realWaterHeightM - theoWaterHeightM) * 100);

  const theoExactX = estimateLitto3dWaterlineXExactM(theoWaterHeightM, selectedZone);
  const realExactX = estimateLitto3dWaterlineXExactM(realWaterHeightM, selectedZone);
  const theoDiscoveredX = Math.round(theoExactX);
  const realDiscoveredX = Math.round(realExactX);
  const theoRollableWidthM = Math.max(0, theoDiscoveredX - softSandMarginM);
  const realRollableWidthM = Math.max(0, realDiscoveredX - softSandMarginM);
  const activeDeltaBeachM = realDiscoveredX - theoDiscoveredX; // négatif = perte (surcote), positif = gain (décote)

  // Limite brute fixée par Jérôme (settings.L, ex: 4,50 m)
  const jeromeLimitExactX = estimateLitto3dWaterlineXExactM(jeromeRawLimitH, selectedZone);
  const jeromeLimitDiscoveredX = Math.round(jeromeLimitExactX);
  const jeromeLimitRollableM = Math.max(0, jeromeLimitDiscoveredX - softSandMarginM);
  const isWithinJeromeLimit = realWaterHeightM <= jeromeRawLimitH;

  const isSurcoteAtU = activeDeltaCm > 0;
  const isSouscoteAtU = activeDeltaCm < 0;

  // Marqueur synchronisé sur la courbe de marée lorsque l'utilisateur n'est pas en survol actif
  const pinnedMarkerX = X(activeU);
  const pinnedMarkerY = activeHr != null ? Y(activeHr) : null;
  const firstBm = ex.find(p => !p.pm);
  const firstSlot = pl.full[0] || pl.extra[0];

  return (
    <div className="crv">
      {/* Barre compacte de comparaison SHOM brut vs Modèle Réel Empirique */}
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
            Empirique vs SHOM
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {deltaStats.hasOffset && (
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
          )}
          <button
            type="button"
            onClick={() => setShowPisteView(v => !v)}
            style={{
              border: showPisteView
                ? '1px solid #0284c7'
                : '1px solid rgba(100, 116, 139, 0.35)',
              background: showPisteView ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: showPisteView ? '#0369a1' : '#475569',
              borderRadius: '6px',
              padding: '2px 7px',
              fontSize: '0.69rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Afficher ou masquer la vue aérienne interactive de la piste selon l'heure"
          >
            {showPisteView ? '✓ ' : ''}Vue Piste
          </button>
        </div>
      </div>

      {/* Courbe de marée 24h */}
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
        onPointerMove={ev => handlePointer(ev, false)}
        onPointerDown={ev => handlePointer(ev, true)}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
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

        {/* Limite brute Jérôme (settings.L) si distincte du seuil effectif */}
        {Math.abs(jeromeRawLimitH - thr) >= 0.02 && (
          <g>
            <line
              x1={ml}
              x2={W - mr}
              y1={f1(Y(jeromeRawLimitH))}
              y2={f1(Y(jeromeRawLimitH))}
              style={{ stroke: 'rgba(248, 113, 113, 0.85)', strokeWidth: 1.1, strokeDasharray: '3 3' }}
            />
            <text
              x={ml + 3}
              y={f1(Y(jeromeRawLimitH) - 2.5)}
              style={{
                fill: '#fca5a5',
                fontSize: '7.8px',
                fontWeight: 800,
                paintOrder: 'stroke',
                stroke: '#0a0d0b',
                strokeWidth: '2px',
              }}
            >
              limite Jérôme {jeromeRawLimitH.toFixed(2).replace('.', ',')} m
            </text>
          </g>
        )}

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
        {nowLine}

        {/* Repère de l'heure affichée sur la Vue Piste (quand on ne survole pas la courbe) */}
        {showPisteView && !crosshair.visible && pinnedMarkerY != null && (
          <g>
            <line
              x1={f1(pinnedMarkerX)}
              x2={f1(pinnedMarkerX)}
              y1={mt}
              y2={mt + ph}
              style={{ stroke: 'rgba(248, 250, 252, 0.65)', strokeWidth: 1.2, strokeDasharray: '4 2' }}
            />
            <circle
              cx={f1(pinnedMarkerX)}
              cy={f1(pinnedMarkerY)}
              r={3.5}
              style={{
                fill: isWithinJeromeLimit ? '#38bdf8' : '#f97316',
                stroke: '#ffffff',
                strokeWidth: 1.3,
              }}
            />
          </g>
        )}

        {/* Double curseur interactif + pont vertical Δ */}
        {crosshair.visible && (
          <g>
            <line
              x1={crosshair.x}
              x2={crosshair.x}
              y1={mt}
              y2={mt + ph}
              style={{ stroke: 'rgba(255, 255, 255, 0.85)', strokeWidth: 1.2 }}
            />

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

            {/* Point Théorique */}
            {crosshair.yTheo != null && (
              <circle
                cx={crosshair.x}
                cy={crosshair.yTheo}
                r={3.2}
                style={{ fill: '#0f172a', stroke: '#fef08a', strokeWidth: 1.4 }}
              />
            )}

            {/* Point Réel */}
            <circle
              cx={crosshair.x}
              cy={crosshair.yReal}
              r={3.8}
              style={{ fill: '#ffc40d', stroke: '#000', strokeWidth: 1.2 }}
            />

            {/* Étiquette de lecture auto-alignée */}
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

      {/* VUE AÉRIENNE INTERACTIVE DE LA PISTE DE ROULAGE (COHÉRENTE AVEC LITTO3D) */}
      {showPisteView && (
        <div
          style={{
            marginTop: '8px',
            padding: '10px 11px',
            borderRadius: '10px',
            background: '#ffffff',
            border: isWithinJeromeLimit
              ? '1.5px solid #bae6fd'
              : '1.5px solid #fdba74',
          }}
        >
          {/* En-tête heure active + sélecteur secteur IGN + statut vs Limite Jérôme */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '6px',
              marginBottom: '6px',
              fontSize: '0.73rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontWeight: 900,
                  fontSize: '0.72rem',
                }}
              >
                🕒 {lc(activeU, y, m, d)}
              </span>
              <span style={{ fontWeight: 800, color: '#0369a1' }}>
                Vue Piste Litto3D
              </span>
              <span style={{ color: '#64748b', fontSize: '0.67rem' }}>
                {hoverU != null
                  ? '(survol courbe)'
                  : isToday && Math.abs(activeU - nw) <= 12
                    ? '(maintenant)'
                    : '(heure sélectionnée)'}
              </span>
              <div
                style={{
                  display: 'inline-flex',
                  background: '#f8fafc',
                  padding: '2px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  gap: '2px',
                }}
              >
                {(['lestrevet', 'lieue_de_greve', 'pentrez'] as const).map(zId => {
                  const meta = BAY_ZONES_META[zId];
                  const active = selectedZone === zId;
                  return (
                    <button
                      key={zId}
                      type="button"
                      onClick={() => setSelectedZone(zId)}
                      style={{
                        border: active ? `1px solid ${meta.bd}` : '1px solid transparent',
                        background: active ? meta.bg : 'transparent',
                        color: active ? meta.fg : '#64748b',
                        fontWeight: active ? 800 : 700,
                        fontSize: '0.64rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {meta.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <span
              style={{
                padding: '2px 8px',
                borderRadius: '5px',
                fontWeight: 800,
                fontSize: '0.70rem',
                background: isWithinJeromeLimit ? '#dcfce7' : '#fee2e2',
                color: isWithinJeromeLimit ? '#166534' : '#991b1b',
                border: isWithinJeromeLimit
                  ? '1px solid #86efac'
                  : '1px solid #fca5a5',
              }}
            >
              {isWithinJeromeLimit
                ? `✓ Roulage OK · ${realRollableWidthM} m théo. corr. (seuil ≥ ${jeromeLimitRollableM} m)`
                : `✕ Sous limite Jérôme · ${realRollableWidthM} m (< ${jeromeLimitRollableM} m à ${jeromeRawLimitH.toFixed(2).replace('.', ',')} m)`}
            </span>
          </div>

          {/* Bandeau comparatif SHOM vs Théo. Corrigée vs Modèle Empirique à l'heure active */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '7px',
              padding: '5px 8px',
              borderRadius: '7px',
              background: isSurcoteAtU ? '#fff7ed' : isSouscoteAtU ? '#ecfdf5' : '#f0f9ff',
              border: isSurcoteAtU
                ? '1px solid #fdba74'
                : isSouscoteAtU
                  ? '1px solid #6ee7b7'
                  : '1px solid #bae6fd',
              fontSize: '0.70rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', color: '#334155' }}>
              <span>
                SHOM brut : <b>{theoWaterHeightM.toFixed(2).replace('.', ',')} m</b> ({theoRollableWidthM} m utiles)
              </span>
              <span style={{ color: isSurcoteAtU ? '#c2410c' : isSouscoteAtU ? '#047857' : '#0369a1' }}>
                Modèle empirique ({activeDeltaCm >= 0 ? `+${activeDeltaCm}` : activeDeltaCm} cm) :{' '}
                <b>{realRollableWidthM} m utiles</b> ({empiricalBasisLabel})
              </span>
            </div>
            <span
              style={{
                fontWeight: 800,
                color: isSurcoteAtU ? '#c2410c' : isSouscoteAtU ? '#047857' : '#0369a1',
              }}
            >
              {activeDeltaBeachM < 0
                ? `${Math.abs(activeDeltaBeachM)} m perdus vs SHOM`
                : activeDeltaBeachM > 0
                  ? `+${activeDeltaBeachM} m gagnés vs SHOM`
                  : '0 m d’écart vs SHOM'}
            </span>
          </div>

          {/* Schéma unifié 2 bandes nettes (SHOM brut vs Modèle Réel Empirique) */}
          <div style={{ overflowX: 'auto' }}>
            <BeachPisteDiagram
              softSandMarginM={softSandMarginM}
              theoWaterHeightM={theoWaterHeightM}
              realWaterHeightM={realWaterHeightM}
              appliedDeltaCm={activeDeltaCm}
              theoExactX={theoExactX}
              realExactX={realExactX}
              theoRollableWidthM={theoRollableWidthM}
              realRollableWidthM={realRollableWidthM}
              deltaBeachM={activeDeltaBeachM}
              thresholdHeightM={jeromeRawLimitH}
              thresholdExactX={jeromeLimitExactX}
              thresholdLabelPrefix="Limite Jérôme"
              thresholdTone="red"
              isWithinThreshold={isWithinJeromeLimit}
              empiricalBasisLabel={empiricalBasisLabel}
              minWidth="500px"
            />
          </div>

          {/* Curseur horaire interactif 0h-24h + accès rapides */}
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#475569', whiteSpace: 'nowrap' }}>
                Heure :
              </span>
              <input
                type="range"
                min={t0}
                max={t1}
                step={10}
                value={Math.round(activeU)}
                onChange={e => {
                  setHoverU(null);
                  setPinnedU(Number(e.target.value));
                }}
                aria-label="Choisir l'heure pour visualiser la piste de roulage"
                style={{ flex: 1, cursor: 'pointer', accentColor: '#0284c7' }}
              />
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 900,
                  color: '#0f172a',
                  minWidth: '42px',
                  textAlign: 'right',
                }}
              >
                {lc(activeU, y, m, d)}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '6px',
                marginTop: '4px',
                fontSize: '0.66rem',
                color: '#64748b',
              }}
            >
              <span>
                Marge sable mou : <b>{softSandMarginM} m</b> · Profil IGN {BAY_ZONES_META[selectedZone].shortLabel}
                {activeWaveHeightM != null ? ` · Houle ${activeWaveHeightM.toFixed(1).replace('.', ',')} m` : ''}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                {isToday && (
                  <button
                    type="button"
                    onClick={() => {
                      setHoverU(null);
                      setPinnedU(Math.min(t1, Math.max(t0, Math.round(nw / 10) * 10)));
                    }}
                    style={{
                      padding: '1px 6px',
                      fontSize: '0.64rem',
                      fontWeight: 800,
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      cursor: 'pointer',
                    }}
                  >
                    Maintenant
                  </button>
                )}
                {firstSlot && (
                  <button
                    type="button"
                    onClick={() => {
                      setHoverU(null);
                      setPinnedU(
                        Math.min(t1, Math.max(t0, Math.round(((firstSlot[0] + firstSlot[1]) / 2) / 10) * 10))
                      );
                    }}
                    style={{
                      padding: '1px 6px',
                      fontSize: '0.64rem',
                      fontWeight: 800,
                      borderRadius: '4px',
                      border: '1px solid #93c5fd',
                      background: '#eff6ff',
                      color: '#1d4ed8',
                      cursor: 'pointer',
                    }}
                  >
                    Séance {lc(firstSlot[0], y, m, d)}
                  </button>
                )}
                {firstBm && (
                  <button
                    type="button"
                    onClick={() => {
                      setHoverU(null);
                      setPinnedU(Math.min(t1, Math.max(t0, Math.round(firstBm.t / 10) * 10)));
                    }}
                    style={{
                      padding: '1px 6px',
                      fontSize: '0.64rem',
                      fontWeight: 800,
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0369a1',
                      cursor: 'pointer',
                    }}
                  >
                    BM {lc(firstBm.t, y, m, d)}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Légende enrichie & impact concret sur la plage praticable */}
      <div className="m" style={{ marginTop: '6px', fontSize: '0.72rem', lineHeight: '1.45' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '3px', background: '#38bdf8', display: 'inline-block' }} />
            <strong>Courbe réelle empirique</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '2px', borderTop: '2px dashed #eab308', display: 'inline-block' }} />
            <span>Courbe SHOM brut</span>
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
        Survole/touche la courbe ou glisse le curseur pour animer la largeur de piste en direct.
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
