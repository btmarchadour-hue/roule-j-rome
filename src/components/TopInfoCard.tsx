import React from 'react';
import { AppSettings, TidePoint, WindPoint } from '../types';
import {
  COEF,
  dayFocus,
  lc,
  p2,
  phase,
  sunInfo,
  tdy,
  toU,
  VC,
} from '../utils/tides';
import { WeatherBlock } from './WeatherBlock';

interface TopInfoCardProps {
  selectedDate: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
}

export const TopInfoCard: React.FC<TopInfoCardProps> = ({
  selectedDate,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
}) => {
  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;
  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);
  const td = tdy();
  const f = dayFocus(selectedDate, settings, tideW, first, last, windList);
  const sn = sunInfo(y, m, d, settings.lum, settings.lmg);

  const ex = EX.filter(p => p.t >= t0 && p.t < t1);
  const hv = (p: TidePoint) => (p.hd != null ? p.hd : p.h);
  const pm = ex.filter(p => p.pm).map(hv);
  const bm = ex.filter(p => !p.pm).map(hv);
  const mar = pm.length && bm.length ? Math.max(...pm) - Math.min(...bm) : null;
  const c = COEF[selectedDate];
  const cn = c == null ? '' : c < 45 ? 'Faible' : c < 70 ? 'Moyen' : c < 95 ? 'Fort' : 'Très fort';

  const wd = new Date(Date.UTC(y, m, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const fr2 = (v: number) => v.toFixed(2).replace('.', ',');

  return (
    <div id="topinfo">
      <WeatherBlock
        dateStr={selectedDate}
        settings={settings}
        W={tideW}
        first={first}
        last={last}
        windList={windList}
        showDayToggle={false}
      />

      <div className="card">
        <div className="fh">
          Indications générales · {selectedDate === td ? "aujourd'hui, " : ''}
          {wd}
        </div>
        <div className="gt">
          <div>
            <b>Coefficient</b>
            <span>{c != null ? c : '—'}</span>
            <small>{cn}</small>
          </div>
          <div>
            <b>Marnage</b>
            <span>{mar != null ? fr2(mar) + ' m' : '—'}</span>
            <small>pleine mer – basse mer</small>
          </div>
          <div>
            <b>Soleil</b>
            <span>{sn.lev} → {sn.cou}</span>
            <small>lumière retenue {sn.lum}</small>
          </div>
          <div>
            <b>Séances</b>
            <span>
              {f.pl.full.length}
              {f.pl.extra.length ? ` + ${f.pl.extra.length} opt.` : ''}
            </span>
            <small>
              <span className="dot" style={{ background: VC[f.k][0] }} />
              {VC[f.k][1].toLowerCase()}
              {f.glob ? ' (indicatif)' : ''}
            </small>
          </div>

          <div className="w2">
            <b>Marées</b>
            <span style={{ fontSize: '.95rem' }}>
              {ex
                .map(
                  p =>
                    (p.pm ? 'PM ' : 'BM ') +
                    lc(p.t, y, m, d) +
                    ' · ' +
                    fr2(hv(p)) +
                    ' m'
                )
                .join('   ·   ') || '—'}
            </span>
          </div>

          {f.rng && (
            <div className="w2">
              <b>Vent prévu pendant les séances</b>
              <span style={{ fontSize: '.95rem' }}>{f.rng}</span>
              <small>{f.glob ? 'modèle global, indicatif' : 'AROME'}</small>
            </div>
          )}

          <div className="w2">
            <b>Lune</b>
            <span style={{ fontSize: '.95rem' }}>{phase(t0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
