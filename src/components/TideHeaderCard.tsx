import React from 'react';
import { TidePoint } from '../types';
import { getNextTideInfo, lc, tdy } from '../utils/tides';

interface TideHeaderCardProps {
  selectedDate: string;
  EX: TidePoint[];
}

export const TideHeaderCard: React.FC<TideHeaderCardProps> = ({ selectedDate, EX }) => {
  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;
  const isToday = selectedDate === tdy();

  const { pmList, bmList, nextTide, coef, pmCoefs } = getNextTideInfo(EX, selectedDate);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🌊</span>
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
