import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppSettings, WindsUpSpotData } from '../types';
import { fetchPublicWindsUpSpot66Fallback } from '../utils/windsUpFallback';

interface WindsUpBaliseCardProps {
  dateStr: string;
  settings: AppSettings;
}

const WINDSUP_LEGEND = [
  { v: 0, c: '#1246ED', txt: '#fff' },
  { v: 2, c: '#1270ED', txt: '#fff' },
  { v: 4, c: '#129AED', txt: '#fff' },
  { v: 6, c: '#12BFED', txt: '#0f172a' },
  { v: 8, c: '#11E2E7', txt: '#0f172a' },
  { v: 10, c: '#11E6AD', txt: '#0f172a' },
  { v: 12, c: '#11EA77', txt: '#0f172a' },
  { v: 14, c: '#1DEE44', txt: '#0f172a' },
  { v: 16, c: '#59EE34', txt: '#0f172a' },
  { v: 18, c: '#9BEF22', txt: '#0f172a' },
  { v: 20, c: '#D7EF12', txt: '#0f172a' },
  { v: 22, c: '#E5D90F', txt: '#0f172a' },
  { v: 24, c: '#E7BE0F', txt: '#0f172a' },
  { v: 26, c: '#E9A50F', txt: '#0f172a' },
  { v: 28, c: '#EA890F', txt: '#fff' },
  { v: 30, c: '#EC6E0F', txt: '#fff' },
  { v: 32, c: '#EE550F', txt: '#fff' },
  { v: 34, c: '#EE3B10', txt: '#fff' },
  { v: 36, c: '#DB3A23', txt: '#fff' },
  { v: 38, c: '#C73937', txt: '#fff' },
  { v: 40, c: '#B53849', txt: '#fff' },
  { v: 44, c: '#8E3570', txt: '#fff' },
  { v: 48, c: '#663399', txt: '#fff' },
  { v: 50, c: '#552B80', txt: '#fff' },
];

const COMPASS_DEG: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSO: 202.5,
  SSW: 202.5,
  SO: 225,
  SW: 225,
  OSO: 247.5,
  WSW: 247.5,
  O: 270,
  W: 270,
  ONO: 292.5,
  WNW: 292.5,
  NO: 315,
  NW: 315,
  NNO: 337.5,
  NNW: 337.5,
};

function getWindFlowRotation(dir: string, deg: number | null): number {
  const originDeg = deg != null ? deg : COMPASS_DEG[dir.toUpperCase()] ?? 0;
  // Wind arrow points where the wind blows TO (meteorological origin + 180°)
  return (originDeg + 180) % 360;
}

function getSpeedTextColor(bgColor: string | null): string {
  if (!bgColor) return '#0f172a';
  const c = bgColor.toLowerCase();
  if (
    c === '#1246ed' ||
    c === '#1270ed' ||
    c === '#129aed' ||
    c === '#ea890f' ||
    c === '#ec6e0f' ||
    c === '#ee550f' ||
    c === '#ee3b10' ||
    c === '#db3a23' ||
    c === '#c73937' ||
    c === '#b53849' ||
    c === '#a0365e' ||
    c === '#8e3570' ||
    c === '#7a3484' ||
    c === '#663399' ||
    c === '#552b80'
  ) {
    return '#ffffff';
  }
  return '#0f172a';
}

function formatParisHM(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export const WindsUpBaliseCard: React.FC<WindsUpBaliseCardProps> = ({
  dateStr,
  settings,
}) => {
  const [data, setData] = useState<WindsUpSpotData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllRows, setShowAllRows] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    label: string;
    detail: string;
  } | null>(null);

  const loadData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      const query = `?date=${encodeURIComponent(dateStr)}${forceRefresh ? '&refresh=1' : ''}`;
      try {
        const res = await fetch(`./api/windsup/spot66${query}`);
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const json: WindsUpSpotData = await res.json();
          setData(json);
          return;
        }
        // Fallback vers le flux public Winds-Up (CORS autorisé) si le relais serveur est absent (ex. hébergement statique)
        const fallbackData = await fetchPublicWindsUpSpot66Fallback(dateStr);
        setData(fallbackData);
      } catch (err) {
        try {
          const fallbackData = await fetchPublicWindsUpSpot66Fallback(dateStr);
          setData(fallbackData);
        } catch {
          setError(err instanceof Error ? err.message : 'Balise indisponible');
        }
      } finally {
        setLoading(false);
      }
    },
    [dateStr]
  );

  useEffect(() => {
    setShowAllRows(false);
    setHoverInfo(null);
    loadData(false);
  }, [loadData]);

  // Auto-refresh every 3 minutes when viewing today's live telemetry
  useEffect(() => {
    if (!data?.isToday) return;
    const timer = setInterval(() => {
      loadData(true);
    }, 180_000);
    return () => clearInterval(timer);
  }, [data?.isToday, loadData]);

  const latestSpeed = data?.latest.speed;
  const latestMax = data?.latest.max;
  const latestOk =
    latestSpeed != null &&
    latestSpeed >= settings.vmin &&
    latestSpeed <= settings.vmax &&
    (latestMax == null || latestMax <= settings.gmax);

  const windJudgment = (() => {
    if (latestSpeed == null) return null;
    if (latestMax != null && latestMax > settings.gmax) {
      return { label: `Rafales > ${settings.gmax} nds`, bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' };
    }
    if (latestSpeed < settings.vmin) {
      return { label: `Vent faible (< ${settings.vmin} nds)`, bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' };
    }
    if (latestSpeed > settings.vmax) {
      return { label: `Vent fort (> ${settings.vmax} nds)`, bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' };
    }
    return {
      label: `Roulage OK (${settings.vmin}–${settings.vmax} nds)`,
      bg: '#dcfce7',
      fg: '#166534',
      bd: '#86efac',
    };
  })();

  // Build unified SVG chart (Relevés barres + Min/Max + Courbe Prévisions Orange + Actuellement)
  const renderChart = () => {
    if (!data) return null;
    const obsPoints = data.series.moy.filter(p => !p.locked);
    const prevPoints = data.series.previs;
    const allTs = [...obsPoints.map(p => p.t), ...prevPoints.map(p => p.t)];
    if (!allTs.length) {
      return (
        <div
          style={{
            padding: '18px',
            borderRadius: '8px',
            background: 'var(--cell, #f8fafc)',
            color: 'var(--mu, #64748b)',
            fontSize: '0.78rem',
            textAlign: 'center',
          }}
        >
          Pas de relevés balise disponibles pour cette date (date future ou hors historique Winds-Up).
        </div>
      );
    }

    const minT = Math.min(...allTs);
    const maxT = Math.max(...allTs);
    const spanT = Math.max(3600_000, maxT - minT);

    const maxSpeedRaw = Math.max(
      20,
      ...obsPoints.map(p => p.y),
      ...data.series.minmax.map(p => p.high),
      ...prevPoints.map(p => p.y)
    );
    const yMax = Math.min(60, Math.ceil((maxSpeedRaw + 5) / 10) * 10);

    const W = 720;
    const H = 195;
    const ml = 34;
    const mr = 14;
    const mt = 22;
    const mb = 36;
    const pw = W - ml - mr;
    const ph = H - mt - mb;

    const X = (t: number) => ml + ((t - minT) / spanT) * pw;
    const Y = (v: number) => mt + ph - (Math.min(yMax, Math.max(0, v)) / yMax) * ph;

    // Hour grid ticks
    const firstHourMs = Math.ceil(minT / 3600_000) * 3600_000;
    const hourTicks: number[] = [];
    for (let t = firstHourMs; t <= maxT; t += 3600_000) {
      hourTicks.push(t);
    }
    const stepHour = hourTicks.length > 10 ? 2 : 1;

    // Now marker ("Actuellement")
    const nowMs = Date.now();
    const showNowLine = data.isToday && nowMs >= minT && nowMs <= maxT;
    const nowX = X(nowMs);

    // Build minmax lookup map by timestamp
    const minmaxByT = new Map<number, { low: number; high: number }>();
    for (const mm of data.series.minmax) {
      minmaxByT.set(mm.t, { low: mm.low, high: mm.high });
    }

    // Smooth polyline path for forecasts ("previs")
    const previsPath = prevPoints.map(p => `${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');

    // Direction arrows spaced horizontally so they never overlap
    const arrowMarkers: Array<{ x: number; dir: string }> = [];
    let lastArrowX = -999;
    for (const p of obsPoints) {
      const px = X(p.t);
      if (px - lastArrowX >= 52 && p.o) {
        arrowMarkers.push({ x: px, dir: p.o });
        lastArrowX = px;
      }
    }
    for (const p of prevPoints) {
      const px = X(p.t);
      if (px - lastArrowX >= 52 && p.o) {
        arrowMarkers.push({ x: px, dir: p.o });
        lastArrowX = px;
      }
    }

    const handlePointer = (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const fx = ((ev.clientX - rect.left) / rect.width) * W;
      if (fx < ml || fx > W - mr) {
        setHoverInfo(null);
        return;
      }
      const targetT = minT + ((fx - ml) / pw) * spanT;

      // Nearest observation within 25 min, or forecast
      let bestObs = null as typeof obsPoints[number] | null;
      let bestObsDist = 25 * 60_000;
      for (const p of obsPoints) {
        const dist = Math.abs(p.t - targetT);
        if (dist < bestObsDist) {
          bestObsDist = dist;
          bestObs = p;
        }
      }

      let bestPrev = null as typeof prevPoints[number] | null;
      let bestPrevDist = 45 * 60_000;
      for (const p of prevPoints) {
        const dist = Math.abs(p.t - targetT);
        if (dist < bestPrevDist) {
          bestPrevDist = dist;
          bestPrev = p;
        }
      }

      if (bestObs) {
        const mm = minmaxByT.get(bestObs.t);
        const mmStr = mm && mm.high > 0 ? ` (Min ${mm.low} · Max ${mm.high})` : '';
        setHoverInfo({
          x: X(bestObs.t),
          label: formatParisHM(bestObs.t),
          detail: `Relevé : ${bestObs.y} nds ${bestObs.o}${mmStr}${
            bestPrev ? ` · Prévi : ${bestPrev.y} nds` : ''
          }`,
        });
      } else if (bestPrev) {
        setHoverInfo({
          x: X(bestPrev.t),
          label: formatParisHM(bestPrev.t),
          detail: `Prévision Winds-Up : ${bestPrev.y} nds ${bestPrev.o}`,
        });
      } else {
        setHoverInfo(null);
      }
    };

    const yGridStep = yMax <= 30 ? 10 : 20;
    const yTicks: number[] = [];
    for (let v = 0; v <= yMax; v += yGridStep) {
      yTicks.push(v);
    }

    return (
      <div style={{ marginTop: '8px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.72rem',
            fontWeight: 700,
            marginBottom: '2px',
          }}
        >
          <span style={{ color: 'var(--mu, #64748b)' }}>Relevés vent (nd)</span>
          <span style={{ color: '#f97316' }}>Prévisions vent (nd)</span>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }}
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => setHoverInfo(null)}
        >
          {/* Horizontal grid lines */}
          {yTicks.map(v => (
            <g key={`wu-y-${v}`}>
              <line
                x1={ml}
                x2={W - mr}
                y1={Y(v)}
                y2={Y(v)}
                stroke="var(--bd, #e2e8f0)"
                strokeWidth={1}
              />
              <text
                x={ml - 6}
                y={Y(v) + 3.5}
                textAnchor="end"
                fill="var(--mu, #64748b)"
                fontSize={10}
              >
                {v}
              </text>
            </g>
          ))}

          {/* X-axis hour labels */}
          {hourTicks.map((t, i) => {
            if (i % stepHour !== 0) return null;
            const px = X(t);
            return (
              <g key={`wu-x-${t}`}>
                <line
                  x1={px}
                  x2={px}
                  y1={mt + ph}
                  y2={mt + ph + 4}
                  stroke="var(--mu, #94a3b8)"
                  strokeWidth={1}
                />
                <text
                  x={px}
                  y={mt + ph + 16}
                  textAnchor="middle"
                  fill="var(--mu, #64748b)"
                  fontSize={10}
                >
                  {formatParisHM(t)}
                </text>
              </g>
            );
          })}

          {/* Min-Max light grey range bars */}
          {obsPoints.map(p => {
            const mm = minmaxByT.get(p.t);
            if (!mm || mm.high <= 0) return null;
            const px = X(p.t);
            const topY = Y(mm.high);
            const botY = Y(mm.low);
            return (
              <rect
                key={`wu-mm-${p.t}`}
                x={px - 2.5}
                y={topY}
                width={5}
                height={Math.max(2, botY - topY)}
                fill="#cbd5e1"
                fillOpacity={0.55}
                rx={1}
              />
            );
          })}

          {/* Observed Moy vertical bars (color-coded) */}
          {obsPoints.map(p => {
            const px = X(p.t);
            const topY = Y(p.y);
            const baseY = Y(0);
            return (
              <rect
                key={`wu-bar-${p.t}`}
                x={px - 2}
                y={topY}
                width={4}
                height={Math.max(2, baseY - topY)}
                fill={p.color || '#129AED'}
                rx={1}
              />
            );
          })}

          {/* Forecast orange spline */}
          {prevPoints.length > 1 && (
            <polyline
              points={previsPath}
              fill="none"
              stroke="#f97316"
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Actuellement vertical dashed line */}
          {showNowLine && (
            <g>
              <line
                x1={nowX}
                x2={nowX}
                y1={mt}
                y2={mt + ph}
                stroke="#f97316"
                strokeWidth={1.6}
                strokeDasharray="6 3"
              />
              <text
                x={Math.min(W - mr - 68, nowX + 4)}
                y={mt + 12}
                fill="#f97316"
                fontSize={10}
                fontWeight={800}
              >
                Actuellement
              </text>
            </g>
          )}

          {/* Wind direction arrows along baseline */}
          {arrowMarkers.map((am, idx) => {
            const rot = getWindFlowRotation(am.dir, null);
            return (
              <g
                key={`wu-arr-${idx}`}
                transform={`translate(${am.x.toFixed(1)}, ${(mt + ph - 2).toFixed(1)}) rotate(${rot})`}
              >
                <path
                  d="M0,-6 L4,4 L0,2 L-4,4 Z"
                  fill="var(--tx, #0f172a)"
                  stroke="var(--card, #fff)"
                  strokeWidth={0.8}
                />
              </g>
            );
          })}

          {/* Interactive hover marker */}
          {hoverInfo && (
            <g>
              <line
                x1={hoverInfo.x}
                x2={hoverInfo.x}
                y1={mt}
                y2={mt + ph}
                stroke="var(--tx, #0f172a)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <rect
                x={Math.min(W - 255, Math.max(ml, hoverInfo.x - 115))}
                y={2}
                width={245}
                height={18}
                rx={4}
                fill="var(--tx, #0f172a)"
                fillOpacity={0.9}
              />
              <text
                x={Math.min(W - 255, Math.max(ml, hoverInfo.x - 115)) + 8}
                y={14}
                fill="var(--card, #ffffff)"
                fontSize={9.8}
                fontWeight={700}
              >
                {hoverInfo.label} · {hoverInfo.detail}
              </text>
            </g>
          )}
        </svg>

        {/* Color Scale Legend matching Winds-Up */}
        <div style={{ marginTop: '6px' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--mu, #64748b)', marginBottom: '3px' }}>
            <b>Légende :</b> correspondance des teintes (nds)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${WINDSUP_LEGEND.length}, minmax(0, 1fr))`,
              borderRadius: '4px',
              overflow: 'hidden',
              border: '1px solid var(--bd, #e2e8f0)',
            }}
          >
            {WINDSUP_LEGEND.map(item => (
              <div
                key={item.v}
                title={`${item.v} nds`}
                style={{
                  backgroundColor: item.c,
                  color: item.txt,
                  fontSize: '0.58rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  padding: '2px 0',
                  lineHeight: 1.1,
                }}
              >
                {item.v}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const unlockedRows = data?.rows.filter(r => !r.locked) || [];
  const rowsToDisplay = data
    ? showAllRows
      ? unlockedRows
      : unlockedRows.slice(0, 6)
    : [];

  return (
    <div
      className="card"
      style={{
        borderLeft: '4px solid #0284c7',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* En-tête Balise Winds-Up */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.1rem' }}>📡</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span className="fh" style={{ margin: 0, fontSize: '0.92rem' }}>
                Balise Winds-Up · {data?.spotName || 'Douarnenez Pentrez'} (Spot 66)
              </span>

              {data && (
                <span
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 900,
                    padding: '2px 7px',
                    borderRadius: '5px',
                    background: data.sensorOffline
                      ? '#fee2e2'
                      : data.isDelayed
                      ? '#fef3c7'
                      : data.isToday
                      ? '#dcfce7'
                      : '#e2e8f0',
                    color: data.sensorOffline
                      ? '#991b1b'
                      : data.isDelayed
                      ? '#92400e'
                      : data.isToday
                      ? '#166534'
                      : '#334155',
                    border: `1px solid ${
                      data.sensorOffline
                        ? '#fca5a5'
                        : data.isDelayed
                        ? '#fcd34d'
                        : data.isToday
                        ? '#86efac'
                        : '#cbd5e1'
                    }`,
                  }}
                >
                  {data.sensorOffline
                    ? 'BALISE HORS LIGNE'
                    : data.isDelayed
                    ? 'APERÇU PUBLIC (-2H)'
                    : data.isToday
                    ? 'EN DIRECT ABONNÉ'
                    : `HISTORIQUE ${data.date}`}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.70rem', color: 'var(--mu, #64748b)' }}>
              Anémomètre réel sur la plage de Pentrez / Lestrevet
              {data?.fetchedAt
                ? ` · Synchro ${new Date(data.fetchedAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="fbtn"
            style={{
              margin: 0,
              padding: '4px 9px',
              fontSize: '0.72rem',
              fontWeight: 700,
            }}
            onClick={() => loadData(true)}
            disabled={loading}
            title="Rafraîchir les relevés en direct de la balise Winds-Up"
          >
            {loading ? '⏳ Chargement…' : '↻ Actualiser'}
          </button>

          <a
            href={data?.sourceUrl || 'https://www.winds-up.com/spot/66'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#0284c7',
              textDecoration: 'none',
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid #bae6fd',
              background: '#f0f9ff',
            }}
          >
            Ouvrir Winds-Up ↗
          </a>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: '6px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            fontSize: '0.74rem',
            fontWeight: 700,
          }}
        >
          ⚠️ Impossible de joindre la balise Winds-Up ({error}). Réessayez ou consultez le tableau AROME ci-dessous.
        </div>
      )}

      {data && (
        <>
          {/* Bloc principal : Vitesse actuelle, Min/Max, Orientation & Heure du relevé */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'var(--cell, #f8fafc)',
              border: '1px solid var(--bd, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Pastille flèche directionnelle Winds-Up */}
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '999px',
                  background: data.latest.color || '#129AED',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.14)',
                  flexShrink: 0,
                }}
                title={
                  data.latest.deg != null
                    ? `Provenance : ${data.latest.dir} (${data.latest.deg}°)`
                    : `Direction : ${data.latest.dir || '—'}`
                }
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  style={{
                    transform: `rotate(${getWindFlowRotation(
                      data.latest.dir,
                      data.latest.deg
                    )}deg)`,
                  }}
                >
                  <path
                    d="M12 3 L18 19 L12 15.5 L6 19 Z"
                    fill="#0f172a"
                    stroke="#ffffff"
                    strokeWidth="1.2"
                  />
                </svg>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.55rem', fontWeight: 900, lineHeight: 1 }}>
                    {data.latest.speed != null ? `${data.latest.speed} nd` : '—'}
                  </span>
                  <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0369a1' }}>
                    {data.latest.dir || '—'}
                    {data.latest.deg != null ? ` (${data.latest.deg}°)` : ''}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--mu, #64748b)', marginTop: '2px' }}>
                  {data.latest.time ? `Relevé de ${data.latest.time}` : 'Dernier relevé disponible'}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  fontSize: '0.78rem',
                  paddingLeft: '10px',
                  borderLeft: '1px solid var(--bd, #cbd5e1)',
                }}
              >
                <div>
                  <b>Min :</b> {data.latest.min != null ? `${data.latest.min} nd` : '—'}
                </div>
                <div>
                  <b>Max :</b> {data.latest.max != null ? `${data.latest.max} nd` : '—'}
                </div>
              </div>
            </div>

            {windJudgment && (
              <div
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  background: windJudgment.bg,
                  color: windJudgment.fg,
                  border: `1.5px solid ${windJudgment.bd}`,
                  fontSize: '0.74rem',
                  fontWeight: 900,
                }}
              >
                {latestOk ? '✅ ' : '⚠️ '}
                {windJudgment.label}
              </div>
            )}
          </div>

          {/* Graphique combiné Relevés (barres) + Prévisions (courbe orange) + Légende */}
          {renderChart()}

          {/* Tableau chronologique des relevés (Heure / Min / Moy / Max / Dir / Bar) */}
          {unlockedRows.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px 52px 60px 52px 52px 46px 1fr',
                  gap: '6px',
                  alignItems: 'center',
                  fontSize: '0.70rem',
                  fontWeight: 800,
                  color: 'var(--mu, #64748b)',
                  padding: '4px 6px',
                  borderBottom: '1.5px solid var(--bd, #cbd5e1)',
                }}
              >
                <div>Heure</div>
                <div style={{ textAlign: 'center' }}>Min nd</div>
                <div style={{ textAlign: 'center' }}>Moy nd</div>
                <div style={{ textAlign: 'center' }}>Max nd</div>
                <div style={{ textAlign: 'center' }}>Dir</div>
                <div style={{ textAlign: 'center' }}>°</div>
                <div>Intensité</div>
              </div>

              <div>
                {rowsToDisplay.map((row, idx) => (
                  <div
                    key={`${row.time}-${idx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '64px 52px 60px 52px 52px 46px 1fr',
                      gap: '6px',
                      alignItems: 'center',
                      fontSize: '0.74rem',
                      padding: '4px 6px',
                      borderBottom: '1px solid var(--bd, #f1f5f9)',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{row.time}</div>
                    <div style={{ textAlign: 'center', color: 'var(--mu, #64748b)' }}>
                      {row.min ?? '—'}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          minWidth: '34px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 900,
                          background: row.color || '#e2e8f0',
                          color: getSpeedTextColor(row.color),
                        }}
                      >
                        {row.moy ?? '—'}
                      </span>
                    </div>
                    <div style={{ textAlign: 'center', color: 'var(--mu, #64748b)' }}>
                      {row.max ?? '—'}
                    </div>
                    <div style={{ textAlign: 'center', fontWeight: 700 }}>{row.dir || '—'}</div>
                    <div style={{ textAlign: 'center', color: 'var(--mu, #64748b)' }}>
                      {row.deg ?? '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(4, row.barPct || (row.moy || 0) * 2.2))}%`,
                          height: '6px',
                          borderRadius: '3px',
                          background: row.color || '#129AED',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {unlockedRows.length > 6 && (
                <div style={{ marginTop: '6px', textAlign: 'center' }}>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '4px 12px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                    }}
                    onClick={() => setShowAllRows(prev => !prev)}
                  >
                    {showAllRows
                      ? '▲ Réduire le tableau Winds-Up'
                      : `▼ Voir les ${unlockedRows.length} relevés Winds-Up`}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
