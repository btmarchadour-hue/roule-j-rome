import React from 'react';
import { AppSettings } from '../types';

interface SettingsCardProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  windStatusText: string;
  onRefreshWind: () => void;
  isLoadingWind: boolean;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
  settings,
  onUpdateSettings,
  windStatusText,
  onRefreshWind,
  isLoadingWind,
}) => {
  const parseNum = (val: string, fallback: number) => {
    const n = parseFloat(val.replace(',', '.'));
    return isNaN(n) ? fallback : n;
  };

  return (
    <>
      <div className="card ctl nop">
        <b style={{ gridColumn: '1/-1', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Séances
        </b>

        <label>
          Durée d'une séance (min)
          <input
            type="text"
            inputMode="decimal"
            value={settings.sdur}
            onChange={e => onUpdateSettings({ sdur: parseNum(e.target.value, 60) })}
          />
        </label>

        <label>
          Pause été (min)
          <input
            type="text"
            inputMode="decimal"
            value={settings.gs}
            onChange={e => onUpdateSettings({ gs: parseNum(e.target.value, 15) })}
          />
        </label>

        <label>
          Pause hors été (min)
          <input
            type="text"
            inputMode="decimal"
            value={settings.gw}
            onChange={e => onUpdateSettings({ gw: parseNum(e.target.value, 30) })}
          />
        </label>

        <label>
          Été : début (MM-JJ)
          <input
            type="text"
            value={settings.s0}
            onChange={e => onUpdateSettings({ s0: e.target.value })}
          />
        </label>

        <label>
          Été : fin (MM-JJ)
          <input
            type="text"
            value={settings.s1}
            onChange={e => onUpdateSettings({ s1: e.target.value })}
          />
        </label>

        <label>
          1re séance : min. après le lever
          <input
            type="text"
            inputMode="decimal"
            value={settings.pre}
            onChange={e => onUpdateSettings({ pre: parseNum(e.target.value, 60) })}
          />
        </label>

        <label>
          Fin de séance : min. avant le coucher
          <input
            type="text"
            inputMode="decimal"
            value={settings.post}
            onChange={e => onUpdateSettings({ post: parseNum(e.target.value, 30) })}
          />
        </label>

        <label>
          Débuts arrondis à (min)
          <input
            type="text"
            inputMode="decimal"
            value={settings.rnd}
            onChange={e => onUpdateSettings({ rnd: parseNum(e.target.value, 15) })}
          />
        </label>

        <label className="ck">
          <input
            type="checkbox"
            checked={settings.xon}
            onChange={e => onUpdateSettings({ xon: e.target.checked })}
          />{' '}
          Créneau optionnel autorisé (plage un peu trop courte)
        </label>

        <label>
          Dépassement toléré (min)
          <input
            type="text"
            inputMode="decimal"
            value={settings.xtol}
            onChange={e => onUpdateSettings({ xtol: parseNum(e.target.value, 20) })}
          />
        </label>

        <label>
          Placement des séances
          <select
            value={settings.xpl}
            onChange={e => onUpdateSettings({ xpl: e.target.value as 'fin' | 'debut' })}
          >
            <option value="fin">À partir de la dernière séance (méthode du moniteur)</option>
            <option value="debut">À partir de la première séance</option>
          </select>
        </label>

        <span className="note" style={{ gridColumn: '1/-1' }}>
          Créneau optionnel : une séance complète qui déborde d'au plus {settings.xtol} min de la plage
          (côté marée ou côté heure du jour), donc avec au moins {settings.sdur - settings.xtol} min de
          roulage dans la plage.
        </span>

        <label>
          Places par créneau (moniteurs en parallèle)
          <input
            type="text"
            inputMode="decimal"
            value={settings.cap}
            onChange={e => onUpdateSettings({ cap: parseNum(e.target.value, 1) })}
          />
        </label>

        <label className="ck">
          <input
            type="checkbox"
            checked={settings.all}
            onChange={e => onUpdateSettings({ all: e.target.checked })}
          />{' '}
          Coef ≤{' '}
          <input
            type="text"
            inputMode="decimal"
            value={settings.cmax}
            style={{ width: '56px' }}
            onChange={e => onUpdateSettings({ cmax: parseNum(e.target.value, 50) })}
          />{' '}
          : roulage toute la journée (sans contrainte de marée)
        </label>

        <label className="ck">
          <input
            type="checkbox"
            checked={settings.pcor}
            onChange={e => onUpdateSettings({ pcor: e.target.checked })}
          />{' '}
          Correction de pression (+1 cm par hPa sous 1013)
        </label>
      </div>

      <div className="card ctl nop">
        <label>
          Seuil (m)
          <input
            type="text"
            inputMode="decimal"
            value={settings.L}
            onChange={e => onUpdateSettings({ L: parseNum(e.target.value, 4.5) })}
          />
        </label>

        <label>
          Marge (cm)
          <input
            type="text"
            inputMode="decimal"
            value={settings.mg}
            onChange={e => onUpdateSettings({ mg: parseNum(e.target.value, 0) })}
          />
        </label>

        <label>
          Lumière
          <select
            value={settings.lum}
            onChange={e => onUpdateSettings({ lum: parseFloat(e.target.value) })}
          >
            <option value="-1.1">Soleil (lever–coucher)</option>
            <option value="-6">Crépuscule civil</option>
          </select>
        </label>

        <label>
          Marge lumière (min)
          <input
            type="text"
            inputMode="decimal"
            value={settings.lmg}
            onChange={e => onUpdateSettings({ lmg: parseNum(e.target.value, 0) })}
          />
        </label>

        <label>
          Limite : pas avant (h)
          <input
            type="text"
            inputMode="decimal"
            value={settings.h0}
            onChange={e => onUpdateSettings({ h0: parseNum(e.target.value, 0) })}
          />
        </label>

        <label>
          Limite : pas après (h)
          <input
            type="text"
            inputMode="decimal"
            value={settings.h1}
            onChange={e => onUpdateSettings({ h1: parseNum(e.target.value, 24) })}
          />
        </label>

        <label className="ck">
          <input
            type="checkbox"
            checked={settings.les}
            onChange={e => onUpdateSettings({ les: e.target.checked })}
          />{' '}
          Décalage Lestrevet estimé
        </label>

        <label>
          Vent min (nœuds)
          <input
            type="text"
            inputMode="decimal"
            value={settings.vmin}
            onChange={e => onUpdateSettings({ vmin: parseNum(e.target.value, 8) })}
          />
        </label>

        <label>
          Vent max (nœuds)
          <input
            type="text"
            inputMode="decimal"
            value={settings.vmax}
            onChange={e => onUpdateSettings({ vmax: parseNum(e.target.value, 25) })}
          />
        </label>

        <label>
          Rafales max (nœuds)
          <input
            type="text"
            inputMode="decimal"
            value={settings.gmax}
            onChange={e => onUpdateSettings({ gmax: parseNum(e.target.value, 35) })}
          />
        </label>

        <button
          type="button"
          className="wbtn"
          disabled={isLoadingWind}
          onClick={onRefreshWind}
        >
          {isLoadingWind ? 'Chargement…' : 'Actualiser le vent'}
        </button>

        <a
          className="note"
          href="https://www.windguru.cz/48456"
          target="_blank"
          rel="noopener noreferrer"
        >
          Windguru Pentrez
        </a>
        <a
          className="note"
          href="https://www.winds-up.com/spot/66"
          target="_blank"
          rel="noopener noreferrer"
        >
          Winds Up Pentrez (balise de la plage, en panne)
        </a>

        {windStatusText && <span className="note">{windStatusText}</span>}
      </div>
    </>
  );
};
