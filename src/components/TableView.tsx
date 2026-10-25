import React, { useState } from 'react';
import { AppSettings, TidePoint, WindPoint } from '../types';
import {
  dayRow,
  exportMonthCsv,
  exportSlotsCsv,
  maxDs,
  minDs,
  MOIS,
  p2,
} from '../utils/tides';

interface TableViewProps {
  year: number;
  month: number;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
}

export const TableView: React.FC<TableViewProps> = ({
  year,
  month,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const numDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rows = [];
  for (let d = 1; d <= numDays; d++) {
    const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
    if (ds < minDs || ds > maxDs) continue;
    rows.push(dayRow(year, month, d, settings, EX, tideW, first, last, windList));
  }

  const handlePrint = () => {
    setIsOpen(true);
    setTimeout(() => {
      try {
        window.focus();
        window.print();
      } catch (e) {
        console.warn('Native window.print() error in TableView:', e);
      }
    }, 100);
  };

  return (
    <>
      <div className="card nop">
        <div className="top">
          <b>Export</b>
          <div className="ex">
            <button type="button" onClick={() => setIsOpen(!isOpen)}>
              {isOpen ? 'Masquer le tableau' : 'Voir le tableau'}
            </button>
            <button type="button" onClick={handlePrint}>
              Imprimer / PDF
            </button>
            <button
              type="button"
              onClick={() =>
                exportMonthCsv(false, year, month, settings, EX, tideW, first, last, windList)
              }
            >
              CSV du mois
            </button>
            <button
              type="button"
              onClick={() =>
                exportMonthCsv(true, year, month, settings, EX, tideW, first, last, windList)
              }
            >
              CSV complet
            </button>
            <button
              type="button"
              onClick={() =>
                exportSlotsCsv(false, year, month, settings, tideW, first, last, windList)
              }
            >
              Créneaux CSV (mois)
            </button>
            <button
              type="button"
              onClick={() =>
                exportSlotsCsv(true, year, month, settings, tideW, first, last, windList)
              }
            >
              Créneaux CSV (tout)
            </button>
          </div>
        </div>
      </div>

      <div className={`card tvc ${isOpen ? 'on' : ''}`}>
        <div className="wrapt">
          <table>
            <caption
              style={{
                textAlign: 'left',
                fontWeight: 700,
                padding: '6px 0',
                color: 'var(--tx)',
              }}
            >
              Plages de roulage – {MOIS[month]} {year} · seuil {settings.L.toFixed(2)} m
            </caption>
            <thead>
              <tr>
                <th>Jour</th>
                <th>Coef</th>
                <th>Marées (h · m)</th>
                <th>Roulage (marée + jour)</th>
                <th>Séances</th>
                <th>Vent</th>
                <th>Soleil ↑</th>
                <th>Soleil ↓</th>
                <th>Lumière retenue</th>
                <th>Lune ↑</th>
                <th>Lune ↓</th>
                <th>Phase</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const roulageContent =
                  (r.all ? `(coef ≤ ${settings.cmax}) ` : '') +
                  (r.pl.join('\n') || 'aucune');
                const seancesContent = r.ses.concat(r.ext).join('\n') || '—';

                return (
                  <tr key={r.ds}>
                    <td>
                      {r.w} {r.ds.split('-')[2]}
                    </td>
                    <td>{r.coef ?? '—'}</td>
                    <td>{r.tides.join('\n')}</td>
                    <td className={r.pl.length ? 'o' : 'n'}>{roulageContent}</td>
                    <td className={r.ses.length ? 'o' : 'n'}>{seancesContent}</td>
                    <td>{r.vent.join('\n') || '—'}</td>
                    <td>{r.lev}</td>
                    <td>{r.cou}</td>
                    <td>{r.lum}</td>
                    <td>{r.lr}</td>
                    <td>{r.ls}</td>
                    <td>{r.ph}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
