import React from 'react';
import { TidePoint, WindPoint } from '../types';
import { getNextTideInfo, lc, tdy, toU, wstat, wtxt } from '../utils/tides';

interface TideHeaderCardProps {
  selectedDate: string;
  EX: TidePoint[];
  windList?: WindPoint[];
}

export const TideHeaderCard: React.FC<TideHeaderCardProps> = ({ selectedDate, EX, windList = [] }) => {
  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;
  const isToday = selectedDate === tdy();

  const { pmList, bmList, nextTide, coef, pmCoefs } = getNextTideInfo(EX, selectedDate);

  // Vent prévu sur la plage horaire de roulage (09h00 – 18h00 heure locale)
  const dayWindStat = windList.length > 0
    ? wstat(toU(y, m, d, 9 * 60), toU(y, m, d, 18 * 60), windList)
    : null;
  const dayWindMean = dayWindStat ? (dayWindStat.lo + dayWindStat.hi) / 2 : null;

  type WindVisual = {
    tier: 'none' | 'light' | 'ideal' | 'strong';
    sailColor: string;
    hullColor: string;
    bgColor: string;
    borderColor: string;
    streaks: number;
    tooltip: string;
  };

  const windVisual: WindVisual = (() => {
    if (dayWindStat == null || dayWindMean == null) {
      return {
        tier: 'none',
        sailColor: '#0284c7',
        hullColor: '#0f172a',
        bgColor: '#f0f9ff',
        borderColor: '#bae6fd',
        streaks: 0,
        tooltip: 'Char à voile · Prévision vent non disponible pour cette date',
      };
    }
    const detail = wtxt(dayWindStat);
    if (dayWindMean < 8) {
      return {
        tier: 'light',
        sailColor: '#64748b',
        hullColor: '#334155',
        bgColor: '#f1f5f9',
        borderColor: '#cbd5e1',
        streaks: 0,
        tooltip: `Vent faible (0–8 nds) · ${detail}`,
      };
    }
    if (dayWindMean <= 20) {
      return {
        tier: 'ideal',
        sailColor: '#16a34a',
        hullColor: '#14532d',
        bgColor: '#dcfce7',
        borderColor: '#86efac',
        streaks: 1,
        tooltip: `Vent idéal (8–20 nds) · ${detail}`,
      };
    }
    return {
      tier: 'strong',
      sailColor: '#ea580c',
      hullColor: '#7c2d12',
      bgColor: '#ffedd5',
      borderColor: '#fdba74',
      streaks: 2,
      tooltip: `Vent soutenu (> 20 nds) · ${detail}`,
    };
  })();

  const fr2 = (v: number) => v.toFixed(2).replace('.', ',');

  const pmHeights = pmList.map(p => (p.hd != null ? p.hd : p.h));
  const bmHeights = bmList.map(p => (p.hd != null ? p.hd : p.h));
  const marnage =
    pmHeights.length && bmHeights.length
      ? Math.max(...pmHeights) - Math.min(...bmHeights)
      : null;

  const dateFormatted = new Date(Date.UTC(y, m, d)).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      className="card tide-header-card print-hide nop noprint"
      style={{
        borderLeft: '6px solid var(--ac)',
        background: 'var(--card)',
        marginBottom: '12px',
        padding: '14px 18px',
      }}
    >
      {/* Ligne 1 : Date + Prochaine marée */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
          <span
            title={windVisual.tooltip}
            aria-label={windVisual.tooltip}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              background: windVisual.bgColor,
              border: `1.5px solid ${windVisual.borderColor}`,
              flexShrink: 0,
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 28 28"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Filets de vent selon la force */}
              {windVisual.streaks >= 1 && (
                <path
                  d="M2.5 9.5H7.5"
                  stroke={windVisual.sailColor}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  opacity="0.75"
                />
              )}
              {windVisual.streaks >= 2 && (
                <path
                  d="M1.5 13.5H6.5"
                  stroke={windVisual.sailColor}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              )}
              {/* Voile de char à voile */}
              <path
                d="M12.5 3.2C17.8 6.8 20.6 12.6 20.8 18.6L10.8 18.6C11.4 13.5 11.9 8.2 12.5 3.2Z"
                fill={windVisual.sailColor}
              />
              {/* Lattes de voile */}
              <path
                d="M12 10.5L17.4 10.2M11.5 14.5L19.4 14.2"
                stroke="#ffffff"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.65"
              />
              {/* Mât */}
              <path
                d="M12.5 3L10.6 20.5"
                stroke={windVisual.hullColor}
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              {/* Châssis du char à voile */}
              <path
                d="M6.5 21H22.2"
                stroke={windVisual.hullColor}
                strokeWidth="2.1"
                strokeLinecap="round"
              />
              {/* Roue arrière + roue avant */}
              <circle cx="9.2" cy="22.4" r="2.7" fill={windVisual.hullColor} />
              <circle cx="9.2" cy="22.4" r="1.1" fill="#ffffff" />
              <circle cx="20.6" cy="23.1" r="2" fill={windVisual.hullColor} />
              <circle cx="20.6" cy="23.1" r="0.8" fill="#ffffff" />
            </svg>
          </span>
          <span
            style={{
              fontSize: '1.18rem',
              fontWeight: 900,
              textTransform: 'capitalize',
              lineHeight: 1.2,
            }}
          >
            {dateFormatted}
          </span>
          <span style={{ fontSize: '0.92rem', color: 'var(--mu)', fontWeight: 700 }}>
            · Lestrevet
          </span>
          {isToday && (
            <span
              style={{
                fontSize: '0.76rem',
                fontWeight: 900,
                background: 'var(--ac)',
                color: '#111',
                padding: '3px 10px',
                borderRadius: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
              }}
            >
              Aujourd&apos;hui
            </span>
          )}
        </div>

        {isToday && nextTide && (
          <div
            style={{
              fontSize: '1.02rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: nextTide.type === 'BM' ? 'var(--cb)' : 'var(--cn)', fontWeight: 800 }}>
              Prochaine {nextTide.type} :
            </span>
            <b style={{ fontSize: '1.12rem', fontWeight: 900 }}>{nextTide.timeStr}</b>
            <span style={{ color: 'var(--mu)', fontSize: '0.96rem' }}>({fr2(nextTide.height)} m)</span>
            <span style={{ color: 'var(--mu)', fontSize: '0.92rem', fontWeight: 700 }}>
              {nextTide.diffMin > 0
                ? `dans ${Math.floor(nextTide.diffMin / 60)}h${String(nextTide.diffMin % 60).padStart(2, '0')}`
                : 'en cours'}
            </span>
          </div>
        )}
      </div>

      {/* Ligne 2 : Coef · PM · BM · Marnage */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          fontSize: '0.95rem',
        }}
      >
        <div
          style={{
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '7px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
          }}
        >
          <span
            style={{
              color: 'var(--mu)',
              fontWeight: 800,
              fontSize: '0.82rem',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            Coef
          </span>
          <strong style={{ fontSize: '1.08rem', fontWeight: 900 }}>
            {pmCoefs && pmCoefs.length > 1
              ? pmCoefs.join(' / ')
              : coef != null
              ? coef
              : '—'}
          </strong>
        </div>

        <div
          style={{
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '7px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              color: 'var(--cn)',
              fontWeight: 900,
              fontSize: '0.82rem',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            PM
          </span>
          {pmList.length > 0 ? (
            pmList.map((p, idx) => (
              <span key={`pm-${idx}`} style={{ fontWeight: 800, fontSize: '0.98rem' }}>
                {idx > 0 ? '· ' : ''}
                {lc(p.t, y, m, d)}{' '}
                <span style={{ color: 'var(--mu)', fontWeight: 600, fontSize: '0.92rem' }}>
                  ({fr2(p.hd != null ? p.hd : p.h)} m)
                </span>
              </span>
            ))
          ) : (
            <span style={{ color: 'var(--mu)' }}>—</span>
          )}
        </div>

        <div
          style={{
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '7px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              color: 'var(--cb)',
              fontWeight: 900,
              fontSize: '0.82rem',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            BM
          </span>
          {bmList.length > 0 ? (
            bmList.map((p, idx) => (
              <span key={`bm-${idx}`} style={{ fontWeight: 800, fontSize: '0.98rem' }}>
                {idx > 0 ? '· ' : ''}
                {lc(p.t, y, m, d)}{' '}
                <span style={{ color: 'var(--mu)', fontWeight: 600, fontSize: '0.92rem' }}>
                  ({fr2(p.hd != null ? p.hd : p.h)} m)
                </span>
              </span>
            ))
          ) : (
            <span style={{ color: 'var(--mu)' }}>—</span>
          )}
        </div>

        <div
          style={{
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '7px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
          }}
        >
          <span
            style={{
              color: 'var(--mu)',
              fontWeight: 800,
              fontSize: '0.82rem',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            Marnage
          </span>
          <strong style={{ fontSize: '1.02rem', fontWeight: 900 }}>
            {marnage != null ? `${fr2(marnage)} m` : '—'}
          </strong>
        </div>
      </div>
    </div>
  );
};
