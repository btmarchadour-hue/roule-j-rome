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

  const coefRating =
    coef == null
      ? '—'
      : coef < 45
      ? 'Faible (roulage facile)'
      : coef < 70
      ? 'Moyen'
      : coef < 95
      ? 'Fort'
      : 'Très fort (vive-eau)';

  const dateFormatted = new Date(Date.UTC(y, m, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      className="card tide-header-card print-hide nop noprint"
      style={{
        borderLeft: '5px solid var(--ac)',
        background: 'var(--card)',
        marginBottom: '12px',
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>🌊</span>
          <div>
            <div
              style={{
                fontSize: '0.95rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '.04em',
                lineHeight: 1.1,
              }}
            >
              Marées du jour · {dateFormatted}
            </div>
            <div
              style={{
                fontSize: '0.7rem',
                color: 'var(--mu)',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                marginTop: '2px',
              }}
            >
              Plage de Lestrevet · Plomodiern
            </div>
          </div>
        </div>

        {isToday && (
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 800,
              background: 'var(--ac)',
              color: '#111',
              padding: '3px 8px',
              borderRadius: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Aujourd'hui
          </span>
        )}
      </div>

      {/* Prochaine marée alert (if today) */}
      {isToday && nextTide && (
        <div
          style={{
            background: 'var(--cell)',
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '6px',
          }}
        >
          <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>
            <span style={{ color: nextTide.type === 'BM' ? 'var(--cb)' : 'var(--cn)' }}>
              Prochaine {nextTide.type === 'BM' ? 'Basse Mer (BM)' : 'Pleine Mer (PM)'} :
            </span>{' '}
            <b>{nextTide.timeStr}</b> ({fr2(nextTide.height)} m)
            {nextTide.coef != null && (
              <span
                style={{
                  marginLeft: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  background: 'var(--card)',
                  border: '1px solid var(--bd)',
                  padding: '1px 5px',
                  borderRadius: '6px',
                }}
              >
                Coef {nextTide.coef}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', fontWeight: 600 }}>
            {nextTide.diffMin > 0
              ? `dans ${Math.floor(nextTide.diffMin / 60)}h${String(nextTide.diffMin % 60).padStart(2, '0')}`
              : 'en ce moment'}
          </div>
        </div>
      )}

      {/* Grid: Coef / Pleine Mer / Basse Mer / Marnage */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '8px',
        }}
      >
        {/* Coefficient */}
        <div
          style={{
            background: 'var(--cell)',
            borderRadius: '10px',
            padding: '10px',
            border: '1px solid var(--bd)',
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: '0.65rem',
              color: 'var(--mu)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 800,
            }}
          >
            Coefficient
          </span>
          <div style={{ fontSize: '1.35rem', fontWeight: 900, lineHeight: 1.1, marginTop: '2px' }}>
            {pmCoefs && pmCoefs.length > 1
              ? pmCoefs.join(' · ')
              : coef != null
              ? coef
              : '—'}
          </div>
          <small style={{ display: 'block', color: 'var(--mu)', fontSize: '0.72rem', marginTop: '2px' }}>
            {pmCoefs && pmCoefs.length > 1
              ? `Matin ${pmCoefs[0]} · Soir ${pmCoefs[1]}`
              : coefRating}
          </small>
        </div>

        {/* Pleine Mer (PM) avec coefficients */}
        <div
          style={{
            background: 'var(--cell)',
            borderRadius: '10px',
            padding: '10px',
            border: '1px solid var(--bd)',
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: '0.65rem',
              color: 'var(--cn)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 800,
            }}
          >
            Pleine Mer (PM)
          </span>
          <div style={{ marginTop: '4px' }}>
            {pmList.length > 0 ? (
              pmList.map((p, idx) => (
                <div
                  key={`pm-${idx}`}
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '4px',
                  }}
                >
                  <div>
                    {lc(p.t, y, m, d)}{' '}
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--mu)' }}>
                      ({fr2(p.hd != null ? p.hd : p.h)} m)
                    </span>
                  </div>
                  {p.coef != null && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        background: 'var(--card)',
                        border: '1px solid var(--bd)',
                        color: 'var(--tx)',
                        padding: '1px 5px',
                        borderRadius: '6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Coef {p.coef}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <span style={{ fontSize: '0.85rem', color: 'var(--mu)' }}>—</span>
            )}
          </div>
        </div>

        {/* Basse Mer (BM) */}
        <div
          style={{
            background: 'var(--cell)',
            borderRadius: '10px',
            padding: '10px',
            border: '1px solid var(--bd)',
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: '0.65rem',
              color: 'var(--cb)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 800,
            }}
          >
            Basse Mer (BM)
          </span>
          <div style={{ marginTop: '4px' }}>
            {bmList.length > 0 ? (
              bmList.map((p, idx) => (
                <div
                  key={`bm-${idx}`}
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '4px',
                  }}
                >
                  <div>
                    {lc(p.t, y, m, d)}{' '}
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--mu)' }}>
                      ({fr2(p.hd != null ? p.hd : p.h)} m)
                    </span>
                  </div>
                  {p.coef != null && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        background: 'var(--card)',
                        border: '1px solid var(--bd)',
                        color: 'var(--tx)',
                        padding: '1px 5px',
                        borderRadius: '6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Coef {p.coef}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <span style={{ fontSize: '0.85rem', color: 'var(--mu)' }}>—</span>
            )}
          </div>
        </div>

        {/* Marnage */}
        <div
          style={{
            background: 'var(--cell)',
            borderRadius: '10px',
            padding: '10px',
            border: '1px solid var(--bd)',
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: '0.65rem',
              color: 'var(--mu)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 800,
            }}
          >
            Marnage du jour
          </span>
          <div style={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1.1, marginTop: '2px' }}>
            {marnage != null ? `${fr2(marnage)} m` : '—'}
          </div>
          <small style={{ display: 'block', color: 'var(--mu)', fontSize: '0.72rem', marginTop: '2px' }}>
            Écart PM − BM
          </small>
        </div>
      </div>
    </div>
  );
};
