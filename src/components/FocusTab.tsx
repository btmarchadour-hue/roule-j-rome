import React, { useState } from 'react';
import {
  AppSettings,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  SessionItem,
  TidePoint,
  ValidationsMap,
  WindPoint,
} from '../types';
import {
  dayFocus,
  exportValidCsv,
  kOf,
  lc,
  maxDs,
  minDs,
  shf,
  sigOf,
  tdy,
  VC,
  vstat,
} from '../utils/tides';
import { WindguruTable } from './WindguruTable';

interface FocusTabProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  validations: ValidationsMap;
  onValidateDay: (ds: string, record: DayFocusData, mode?: 'all' | 'wind_only') => void;
  onClearValidation?: (ds: string) => void;
  onToggleSlotValidation?: (record: DayFocusData, slot: SessionItem) => void;
  onSetSlotDecision?: (
    record: DayFocusData,
    slot: SessionItem,
    decision: 'valid' | 'rejected' | 'pending',
    reason?: string
  ) => void;
  onSelectDayInCalendar: (ds: string) => void;
  customSlotsMap?: CustomSlotsMap;
  onUpdateCustomSlots?: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  onOpenPrintAgenda?: () => void;
}

export const FocusTab: React.FC<FocusTabProps> = ({
  settings,
  onUpdateSettings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations,
  onValidateDay,
  onClearValidation,
  onToggleSlotValidation,
  onSetSlotDecision,
  onSelectDayInCalendar,
  customSlotsMap = {},
  onOpenPrintAgenda,
}) => {
  const td = tdy();
  const tomorrowDs = shf(td, 1);
  const [activeDay, setActiveDay] = useState<'tomorrow' | 'today'>('tomorrow');

  const fTomorrow = dayFocus(tomorrowDs, settings, tideW, first, last, windList, customSlotsMap);
  const fToday = dayFocus(td, settings, tideW, first, last, windList, customSlotsMap);

  const currentFocus = activeDay === 'tomorrow' ? fTomorrow : fToday;
  const currentDs = currentFocus.ds;

  const formatWd = (ds: string) => {
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  const renderSessRow = (f: DayFocusData, x: SessionItem, key: string) => {
    const t = `${lc(x.a, f.y, f.m, f.d)} - ${lc(x.b, f.y, f.m, f.d)}`;
    const slotKey = kOf(x);
    const valRecord = validations[f.ds];
    const valItem = valRecord?.items?.find(item => item.k === slotKey);
    const decision: 'valid' | 'rejected' | 'pending' = valItem
      ? valItem.status === 'rejected'
        ? 'rejected'
        : 'valid'
      : 'pending';

    let chip = <span className="fchip">VENT ?</span>;
    if (x.isCustom) {
      chip = (
        <span className={`fchip ${x.ok === true ? 'fg' : x.ok === false ? 'fr' : 'fo'}`}>
          SUR MESURE · {x.ok === true ? 'VENT OK' : x.ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
        </span>
      );
    } else if (x.opt) {
      chip = <span className="fchip fo">OPTIONNEL +{x.over} MIN</span>;
    } else if (x.ok === true) {
      chip = <span className="fchip fg">VENT OK</span>;
    } else if (x.ok === false) {
      chip = <span className="fchip fr">VENT HORS PLAGE</span>;
    }

    const sub = x.isCustom
      ? x.customTitle || 'Créneau personnalisé'
      : x.opt
      ? `dépasse la contrainte ${
          x.lim === 'marée' ? 'de marée' : "d'heure du jour"
        } au ${x.side} · à ta discrétion`
      : x.txt || '';

    const rowClass = [
      'fs',
      x.opt ? 'fo' : '',
      x.past ? 'fp' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        key={key}
        className={rowClass}
        style={{
          opacity: decision === 'rejected' ? 0.7 : 1,
          background: decision === 'rejected' ? '#fafafa' : undefined,
        }}
      >
        <div>
          <b style={{ textDecoration: decision === 'rejected' ? 'line-through' : 'none' }}>{t}</b>
          <small>{sub + (x.past ? ' · passée' : '')}</small>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {chip}

          {onSetSlotDecision ? (
            <div className="slot-decision-group" onClick={e => e.stopPropagation()}>
              {decision === 'valid' && (
                <>
                  <span style={{ fontSize: '0.68rem', fontWeight: 900, color: '#16a34a', background: '#dcfce7', padding: '3px 7px', borderRadius: '4px' }}>
                    ✓ VALIDÉ
                  </span>
                  <button
                    type="button"
                    className="slot-toggle-btn"
                    style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                    onClick={() => onSetSlotDecision(f, x, 'rejected', x.ok === false ? 'Vent hors plage' : 'Refusé')}
                    title="Refuser / annuler ce créneau"
                  >
                    ✕ Refuser
                  </button>
                  <button
                    type="button"
                    className="slot-toggle-btn neutral"
                    onClick={() => onSetSlotDecision(f, x, 'pending')}
                    title="Remettre en attente"
                  >
                    ↩
                  </button>
                </>
              )}

              {decision === 'rejected' && (
                <>
                  <span style={{ fontSize: '0.68rem', fontWeight: 900, color: '#dc2626', background: '#fee2e2', padding: '3px 7px', borderRadius: '4px' }}>
                    ✕ REFUSÉ {valItem?.rejectReason ? `· ${valItem.rejectReason}` : ''}
                  </span>
                  <button
                    type="button"
                    className="slot-toggle-btn"
                    style={{ color: '#16a34a', borderColor: '#86efac' }}
                    onClick={() => onSetSlotDecision(f, x, 'valid')}
                    title="Valider et maintenir ce créneau"
                  >
                    ✓ Valider
                  </button>
                  <button
                    type="button"
                    className="slot-toggle-btn neutral"
                    onClick={() => onSetSlotDecision(f, x, 'pending')}
                    title="Remettre en attente"
                  >
                    ↩
                  </button>
                </>
              )}

              {decision === 'pending' && (
                <>
                  <button
                    type="button"
                    className="slot-toggle-btn"
                    style={{ background: '#f0fdf4', color: '#15803d', borderColor: '#86efac' }}
                    onClick={() => onSetSlotDecision(f, x, 'valid')}
                    title="Valider ce créneau"
                  >
                    ✓ Valider
                  </button>
                  <button
                    type="button"
                    className="slot-toggle-btn"
                    style={{ background: '#fef2f2', color: '#b91c1c', borderColor: '#fca5a5' }}
                    onClick={() => onSetSlotDecision(f, x, 'rejected', x.ok === false ? 'Vent hors plage' : 'Refusé')}
                    title="Refuser ce créneau"
                  >
                    ✕ Refuser
                  </button>
                </>
              )}
            </div>
          ) : (
            onToggleSlotValidation && (
              <button
                type="button"
                className={`slot-toggle-btn ${decision === 'valid' ? 'val-on' : 'val-off'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSlotValidation(f, x);
                }}
                title={decision === 'valid' ? 'Cliquer pour retirer' : 'Cliquer pour valider'}
              >
                {decision === 'valid' ? '✓ Validé' : '+ Valider'}
              </button>
            )
          )}
        </div>
      </div>
    );
  };

  const renderVBox = (f: DayFocusData) => {
    const v = vstat(f, validations);
    let msg: React.ReactNode = null;

    if (v.st === 'none') {
      msg = <>Proposition non encore validée pour cette journée ({f.list.length} créneau{f.list.length > 1 ? 'x' : ''} disponibles).</>;
    } else if (v.st === 'ok') {
      msg = (
        <>
          ✅ <b>{v.valCount} validé{v.valCount > 1 ? 's' : ''}{v.rejCount ? ` · ${v.rejCount} refusé${v.rejCount > 1 ? 's' : ''}` : ''}</b> (sur {v.totalCount}) le {new Date(v.V.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
          {v.isPartial && <span style={{ opacity: 0.9 }}> (sélection partielle)</span>}
        </>
      );
    } else {
      msg = (
        <>
          ⚠️ <b>Prévisions modifiées depuis ton enregistrement</b> du{' '}
          {new Date(v.V.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
          {v.add.length > 0 && (
            <>
              <br />
              Ajouté :{' '}
              {v.add
                .map(x => `${lc(x.a, f.y, f.m, f.d)} - ${lc(x.b, f.y, f.m, f.d)}`)
                .join(' ; ')}
            </>
          )}
          {v.rem.length > 0 && (
            <>
              <br />
              Retiré : {v.rem.map(x => `${x.s} - ${x.e}`).join(' ; ')}
            </>
          )}
          {v.kchg && (
            <>
              <br />
              Verdict : {VC[v.V.k][1].toLowerCase()} → {VC[f.k][1].toLowerCase()}
            </>
          )}
        </>
      );
    }

    return (
      <>
        <div className="note" style={{ marginTop: '10px' }}>
          {msg}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          <button
            className="fbtn"
            type="button"
            style={{ background: '#0284c7', color: '#fff' }}
            onClick={() => onValidateDay(f.ds, f, 'wind_only')}
            title="Valider uniquement les créneaux vent OK et refuser les hors vent"
          >
            ⚡ Valider si Vent OK
          </button>
          <button
            className="fbtn"
            type="button"
            onClick={() => onValidateDay(f.ds, f, 'all')}
            title="Valider l'ensemble des créneaux de cette journée sans exception"
          >
            ✓ Tout valider
          </button>
          {v.st !== 'none' && onClearValidation && (
            <button
              className="fbtn"
              type="button"
              style={{
                background: 'transparent',
                color: '#dc2626',
                border: '1px solid #fca5a5',
              }}
              onClick={() => onClearValidation(f.ds)}
              title="Supprimer la validation pour cette journée"
            >
              ✕ Réinitialiser
            </button>
          )}
        </div>
      </>
    );
  };

  // Active alerts
  const alerts: string[] = [];
  if (!windList.length) {
    alerts.push(
      "Météo indisponible (hors ligne ou chargement en cours) : le vent n'est pas vérifié."
    );
  }
  if (currentFocus.glob) {
    alerts.push("Le vent provient d'un modèle global (indicatif).");
  }
  alerts.push('Balise Winds Up (spot 66) hors service : pas de mesure en temps réel du vent.');

  return (
    <div id="tab2">
      {/* Header with Mode toggle restricted to tomorrow by default */}
      <div
        className="card"
        style={{
          borderLeft: '4px solid var(--ac)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <div className="fh" style={{ margin: 0, fontWeight: 900, fontSize: '0.9rem' }}>
            {activeDay === 'tomorrow' ? 'Focus Lendemain (Demain)' : "Focus Aujourd'hui"}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, textTransform: 'capitalize' }}>
            {formatWd(currentDs)}
          </div>
        </div>

        {/* View toggle (limited to tomorrow by default, option to view today) */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="fbtn"
            style={{
              background: activeDay === 'tomorrow' ? 'var(--ac)' : 'var(--cell)',
              color: activeDay === 'tomorrow' ? '#111' : 'var(--tx)',
              border: '1px solid var(--bd)',
              margin: 0,
            }}
            onClick={() => setActiveDay('tomorrow')}
          >
            Demain (recommandé)
          </button>
          <button
            type="button"
            className="fbtn"
            style={{
              background: activeDay === 'today' ? 'var(--ac)' : 'var(--cell)',
              color: activeDay === 'today' ? '#111' : 'var(--tx)',
              border: '1px solid var(--bd)',
              margin: 0,
            }}
            onClick={() => setActiveDay('today')}
          >
            Aujourd'hui
          </button>
        </div>
      </div>

      {/* Main Focus Verdict Card */}
      <div className="card">
        <div className="fh">Verdict & Décision de roulage</div>
        <div className="vd" style={{ background: VC[currentFocus.k][0] }}>
          <b>{VC[currentFocus.k][1]}</b>
          <span>
            {currentFocus.why}
            {currentFocus.glob ? ' (modèle global, indicatif)' : ''}
          </span>
        </div>

        <div className="note" style={{ marginTop: '10px', lineHeight: 1.4 }}>
          {currentFocus.rng ? (
            <>
              💨 <b>Vent prévu sur les créneaux :</b> {currentFocus.rng}{' '}
              {currentFocus.glob ? '(modèle global)' : '(AROME Météo-France)'}
            </>
          ) : (
            'Pas de données de vent prévues sur cette plage horaire.'
          )}
        </div>

        <div className="fh" style={{ marginTop: '14px', marginBottom: '6px' }}>
          Séances proposées ({currentFocus.list.length})
        </div>

        {currentFocus.list.length > 0 ? (
          currentFocus.list.map((x, idx) => renderSessRow(currentFocus, x, `f-${idx}`))
        ) : (
          <div className="fs">
            <div>
              <b>Aucune séance possible</b>
              <small>Marée haute ou hors plage d'ouverture</small>
            </div>
          </div>
        )}

        {renderVBox(currentFocus)}
      </div>

      {/* Windguru-style summary forecast table (Requirement 8) */}
      <WindguruTable
        dateStr={currentDs}
        settings={settings}
        EX={EX}
        windList={windList}
      />

      {/* Active Alerts */}
      <div className="card">
        <div className="fh">Alertes & Conditions</div>
        {alerts.map((al, idx) => (
          <div key={`al-${idx}`} className="fal">
            {al}
          </div>
        ))}
      </div>

      {/* Export valid days */}
      <div className="card">
        <div className="fh">Export du planning validé</div>
        <div className="note">
          L'export ne contient que les journées que vous avez validées sur cet appareil.
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="fbtn"
            type="button"
            onClick={() => exportValidCsv(validations, settings.cap)}
          >
            Exporter les jours validés (CSV)
          </button>
          {onOpenPrintAgenda && (
            <button
              className="fbtn"
              type="button"
              style={{ background: '#16a34a', color: '#fff' }}
              onClick={onOpenPrintAgenda}
            >
              📋 Imprimer la fiche agenda papier
            </button>
          )}
        </div>
      </div>

      {/* Minimum sessions setting */}
      <div className="card ctl">
        <label>
          Séances minimum pour « ouvrir » la journée
          <input
            type="text"
            inputMode="decimal"
            value={settings.fmin}
            onChange={(e) => {
              const val = parseFloat(e.target.value.replace(',', '.'));
              onUpdateSettings({ fmin: isNaN(val) || val < 1 ? 3 : val });
            }}
          />
        </label>
      </div>

      {/* Verdict rules explanation */}
      <div className="card hyp">
        <b>Règles du verdict</b>
        <ul>
          <li>
            <b>Ouvrir</b> : au moins {settings.fmin} séances praticables avec un vent favorable (8 à 25 nds, rafales ≤ 35 nds) et aucune séance hors plage.
          </li>
          <li>
            <b>Ouvrir avec réserves</b> : séances possibles mais moins de {settings.fmin} séances vent OK, ou rafales limites, ou météo incertaine.
          </li>
          <li>
            <b>Ne pas rouler</b> : aucune séance complète, ou vent trop faible/fort sur tous les créneaux.
          </li>
        </ul>
      </div>
    </div>
  );
};
