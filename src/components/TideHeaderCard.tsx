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
        borderLeft: '5px solid var(--ac)',
        background: 'var(--card)',
        marginBottom: '10px',
        padding: '9px 12px',
      }}
    >
      {/* Ligne 1 : Date + Prochaine marée */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '6px',
          marginBottom: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.95rem' }}>🌊</span>
          <span
            style={{
              fontSize: '0.82rem',
              fontWeight: 900,
              textTransform: 'capitalize',
            }}
          >
            {dateFormatted}
          </span>
          <span style={{ fontSize: '0.70rem', color: 'var(--mu)', fontWeight: 600 }}>
            · Lestrevet
          </span>
          {isToday && (
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 800,
                background: 'var(--ac)',
                color: '#111',
                padding: '2px 7px',
                borderRadius: '10px',
                textTransform: 'uppercase',
              }}
            >
              Aujourd&apos;hui
            </span>
          )}
        </div>

        {isToday && nextTide && (
          <div style={{ fontSize: '0.74rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ color: nextTide.type === 'BM' ? 'var(--cb)' : 'var(--cn)' }}>
              Prochaine {nextTide.type} :
            </span>
            <b>{nextTide.timeStr}</b>
            <span style={{ color: 'var(--mu)' }}>({fr2(nextTide.height)} m)</span>
            <span style={{ color: 'var(--mu)', fontSize: '0.70rem' }}>
              {nextTide.diffMin > 0
                ? `dans ${Math.floor(nextTide.diffMin / 60)}h${String(nextTide.diffMin % 60).padStart(2, '0')}`
                : 'en cours'}
            </span>
          </div>
        )}
      </div>

      {/* Ligne 2 : Coef · PM · BM · Marnage sur une bande compacte */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          alignItems: 'center',
          fontSize: '0.74rem',
        }}
      >
        <div
          style={{
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderRadius: '6px',
            padding: '4px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span style={{ color: 'var(--mu)', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>
            Coef
          </span>
          <strong style={{ fontSize: '0.82rem' }}>
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
            borderRadius: '6px',
            padding: '4px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: 'var(--cn)', fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase' }}>
            PM
          </span>
          {pmList.length > 0 ? (
            pmList.map((p, idx) => (
              <span key={`pm-${idx}`} style={{ fontWeight: 700 }}>
                {idx > 0 ? '· ' : ''}
                {lc(p.t, y, m, d)}{' '}
                <span style={{ color: 'var(--mu)', fontWeight: 600 }}>
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
            borderRadius: '6px',
            padding: '4px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: 'var(--cb)', fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase' }}>
            BM
          </span>
          {bmList.length > 0 ? (
            bmList.map((p, idx) => (
              <span key={`bm-${idx}`} style={{ fontWeight: 700 }}>
                {idx > 0 ? '· ' : ''}
                {lc(p.t, y, m, d)}{' '}
                <span style={{ color: 'var(--mu)', fontWeight: 600 }}>
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
            borderRadius: '6px',
            padding: '4px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span style={{ color: 'var(--mu)', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>
            Marnage
          </span>
          <strong>{marnage != null ? `${fr2(marnage)} m` : '—'}</strong>
        </div>
      </div>
    </div>
  );
};
