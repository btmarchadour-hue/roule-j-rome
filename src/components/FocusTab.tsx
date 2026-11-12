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
import { getStoredWaterlineLogs } from '../utils/waterlineGpsEngine';

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
    reason?: string,
    pilot?: string,
    pilotsCount?: number
  ) => void;
  onSelectDayInCalendar: (ds: string) => void;
  customSlotsMap?: CustomSlotsMap;
  onUpdateCustomSlots?: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  onOpenPrintAgenda?: () => void;
  onOpenObservationModal?: (slot: {
    dateStr: string;
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    isCustom?: boolean;
    customTitle?: string;
  }) => void;
  isReadOnly?: boolean;
  activeDay?: 'tomorrow' | 'today';
  onActiveDayChange?: (day: 'tomorrow' | 'today') => void;
}

export const FocusTab: React.FC<FocusTabProps> = ({
  settings,
  onUpdateSettings: rawOnUpdateSettings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations,
  onValidateDay: rawOnValidateDay,
  onClearValidation: rawOnClearValidation,
  onToggleSlotValidation: rawOnToggleSlotValidation,
  onSetSlotDecision: rawOnSetSlotDecision,
  onSelectDayInCalendar,
  customSlotsMap = {},
  onOpenPrintAgenda,
  onOpenObservationModal,
  isReadOnly = false,
  activeDay: propActiveDay,
  onActiveDayChange,
}) => {
  const onValidateDay = isReadOnly ? () => {} : rawOnValidateDay;
  const onClearValidation = isReadOnly ? undefined : rawOnClearValidation;
  const onToggleSlotValidation = isReadOnly ? undefined : rawOnToggleSlotValidation;
  const onSetSlotDecision = isReadOnly ? undefined : rawOnSetSlotDecision;
  const onUpdateSettings = (s: Partial<AppSettings>) => {
    if (isReadOnly) return;
    rawOnUpdateSettings(s);
  };
  const tdRaw = tdy();
  const td = tdRaw < minDs ? minDs : tdRaw;
  const tomorrowDs = shf(td, 1);
  const [internalActiveDay, setInternalActiveDay] = useState<'tomorrow' | 'today'>('tomorrow');
  const activeDay = propActiveDay ?? internalActiveDay;

  const handleDayChange = (day: 'tomorrow' | 'today') => {
    setInternalActiveDay(day);
    onActiveDayChange?.(day);
  };

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
    const startTimeStr = lc(x.a, f.y, f.m, f.d);
    const endTimeStr = lc(x.b, f.y, f.m, f.d);
    const t = `${startTimeStr} - ${endTimeStr}`;
    const slotKey = kOf(x);
    const valRecord = validations[f.ds];

    // Recherche multi-niveaux pour synchronisation absolue avec l'archive
    let valItem = valRecord?.items?.find(item => item.k === slotKey);
    if (!valItem && valRecord?.items) {
      valItem = valRecord.items.find(item => item.s === startTimeStr && item.e === endTimeStr);
    }
    if (!valItem && valRecord?.items) {
      valItem = valRecord.items.find(item => item.s === startTimeStr);
    }
    if (!valItem && valRecord?.items) {
      const [sh, sm] = startTimeStr.replace('h', ':').split(':').map(Number);
      const slotMin = sh * 60 + sm;
      let closest: (typeof valRecord.items)[0] | null = null;
      let minDiff = 45;
      for (const item of valRecord.items) {
        if (!item.s) continue;
        const [ih, im] = item.s.replace('h', ':').split(':').map(Number);
        const diff = Math.abs(slotMin - (ih * 60 + im));
        if (diff <= minDiff) {
          minDiff = diff;
          closest = item;
        }
      }
      if (closest) valItem = closest;
    }

    const decision: 'valid' | 'rejected' | 'pending' = valItem
      ? valItem.status === 'rejected'
        ? 'rejected'
        : 'valid'
      : 'pending';

    const cardBg =
      decision === 'valid'
        ? '#f0fdf4'
        : decision === 'rejected'
        ? '#fef2f2'
        : '#ffffff';

    const cardBorder =
      decision === 'valid'
        ? '2px solid #22c55e'
        : decision === 'rejected'
        ? '2px solid #ef4444'
        : '2px dashed #cbd5e1';

    const cardBarColor =
      decision === 'valid'
        ? '#16a34a'
        : decision === 'rejected'
        ? '#dc2626'
        : '#94a3b8';

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

    return (
      <div
        key={key}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '12px 16px',
          borderRadius: '10px',
          marginBottom: '10px',
          backgroundColor: cardBg,
          border: cardBorder,
          borderLeft: `6px solid ${cardBarColor}`,
          boxShadow:
            decision === 'valid'
              ? '0 2px 8px rgba(22, 163, 74, 0.12)'
              : decision === 'rejected'
              ? '0 2px 6px rgba(220, 38, 38, 0.08)'
              : '0 1px 3px rgba(0,0,0,0.04)',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {decision === 'valid' && (
            <>
              <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: '#16a34a',
                color: '#ffffff',
                padding: '4px 10px',
                borderRadius: '6px',
                fontWeight: 900,
                fontSize: '0.78rem',
                letterSpacing: '0.03em',
                boxShadow: '0 1px 2px rgba(22, 163, 74, 0.3)',
              }}
            >
              <span>✓</span>
              <span>SÉANCE VALIDÉE</span>
            </span>

            {/* BADGE MONITEUR ENCADRANT (Jérôme - Seul Moniteur Diplômé) */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: '#dcfce7',
                border: '1.5px solid #86efac',
                color: '#166534',
                padding: '3px 8px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}
            >
              <span>👨‍🏫 Moniteur :</span>
              <strong style={{ color: '#0f172a' }}>Jérôme (Moniteur diplômé)</strong>
            </span>

            {/* BADGE PILOTES / PARTICIPANTS (GARDE-FOU MÉTIER MIN. 1) */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: valItem?.pilotsCount ? '#e0f2fe' : '#ffedd5',
                border: valItem?.pilotsCount ? '1.5px solid #7dd3fc' : '1.5px solid #fdba74',
                color: valItem?.pilotsCount ? '#0369a1' : '#c2410c',
                padding: '3px 8px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}
            >
              <span>👥 Pilotes :</span>
              <strong style={{ color: valItem?.pilotsCount ? '#0c4a6e' : '#9a3412' }}>
                {valItem?.pilotsCount ? `${valItem.pilotsCount} inscrits` : '0 pilote !'}
              </strong>
              {!isReadOnly && onSetSlotDecision && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    const current = valItem?.pilotsCount || 8;
                    const ans = window.prompt("Nombre de participants / pilotes inscrits :", String(current));
                    if (ans === null) return;
                    const parsed = parseInt(ans.trim(), 10);
                    if (isNaN(parsed) || parsed <= 0) {
                      window.alert("⛔ Règle métier : Une séance validée doit avoir au moins 1 pilote. S'il n'y a aucun inscrit, classez-le en 'Refusé / Faute d'inscrits'.");
                      return;
                    }
                    onSetSlotDecision(f, x, 'valid', undefined, valItem?.instructor || valItem?.assignedPilot || 'Jérôme', parsed);
                  }}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #7dd3fc',
                    borderRadius: '4px',
                    padding: '1px 5px',
                    fontSize: '0.64rem',
                    fontWeight: 800,
                    color: '#0369a1',
                    cursor: 'pointer',
                    marginLeft: '3px',
                  }}
                  title="Modifier le nombre de pilotes inscrits"
                >
                  ✏️ Modifier
                </button>
              )}
            </span>
          </>
        )}

          {decision === 'rejected' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: '#dc2626',
                color: '#ffffff',
                padding: '4px 10px',
                borderRadius: '6px',
                fontWeight: 900,
                fontSize: '0.78rem',
                letterSpacing: '0.03em',
                boxShadow: '0 1px 2px rgba(220, 38, 38, 0.3)',
              }}
            >
              <span>✕</span>
              <span>SÉANCE REFUSÉE</span>
              {valItem?.rejectReason && (
                <span style={{ fontSize: '0.72rem', opacity: 0.9 }}>· {valItem.rejectReason}</span>
              )}
            </span>
          )}

          {decision === 'pending' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                padding: '4px 8px',
                borderRadius: '6px',
                fontWeight: 800,
                fontSize: '0.74rem',
              }}
            >
              <span>⏳</span>
              <span>À VALIDER</span>
            </span>
          )}

          {chip}

          {sub && (
            <small style={{ color: '#64748b', fontSize: '0.72rem' }}>
              {sub + (x.past ? ' · passée' : '')}
            </small>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {onSetSlotDecision ? (
            <div className="slot-decision-group" onClick={e => e.stopPropagation()}>
              {decision === 'valid' && (
                <>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '5px 9px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#dc2626',
                      background: '#fff',
                      border: '1px solid #fca5a5',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() => onSetSlotDecision(f, x, 'rejected', x.ok === false ? 'Vent hors plage' : 'Refusé')}
                    title="Refuser / annuler ce créneau"
                  >
                    ✕ Refuser
                  </button>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '5px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#64748b',
                      background: '#fff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() => onSetSlotDecision(f, x, 'pending')}
                    title="Remettre en attente"
                  >
                    ↩
                  </button>
                </>
              )}

              {decision === 'rejected' && (
                <>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '5px 9px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#16a34a',
                      background: '#fff',
                      border: '1px solid #86efac',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() => onSetSlotDecision(f, x, 'valid')}
                    title="Valider et maintenir ce créneau"
                  >
                    ✓ Re-valider
                  </button>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '5px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#64748b',
                      background: '#fff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
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
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '6px 12px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      color: '#fff',
                      background: '#16a34a',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(22, 163, 74, 0.25)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    onClick={() => onSetSlotDecision(f, x, 'valid')}
                    title="Valider ce créneau"
                  >
                    <span>✓</span>
                    <span>Valider</span>
                  </button>
                  <button
                    type="button"
                    className="fbtn"
                    style={{
                      margin: 0,
                      padding: '6px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      color: '#dc2626',
                      background: '#fff',
                      border: '1px solid #fca5a5',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    onClick={() => onSetSlotDecision(f, x, 'rejected', x.ok === false ? 'Vent hors plage' : 'Refusé')}
                    title="Refuser ce créneau"
                  >
                    <span>✕</span>
                    <span>Refuser</span>
                  </button>
                </>
              )}

              {onOpenObservationModal && (
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '5px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#0369a1',
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenObservationModal({
                      dateStr: currentDs,
                      slotKey,
                      slotStart: startTimeStr,
                      slotEnd: endTimeStr,
                      isCustom: x.isCustom,
                      customTitle: x.customTitle,
                    });
                  }}
                  title="Noter un relevé terrain ou une cause d'annulation pour les statistiques"
                >
                  <span>📝</span>
                  <span>Relevé</span>
                </button>
              )}
            </div>
          ) : onToggleSlotValidation ? (
            <button
              type="button"
              className={`slot-toggle-btn ${decision === 'valid' ? 'val-on' : 'val-off'}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSlotValidation(f, x);
              }}
            >
              {decision === 'valid' ? '✓ Validé' : '+ Valider'}
            </button>
          ) : null}

          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              color:
                decision === 'valid'
                  ? '#14532d'
                  : decision === 'rejected'
                  ? '#991b1b'
                  : '#0f172a',
              textDecoration: decision === 'rejected' ? 'line-through' : 'none',
              minWidth: '125px',
              textAlign: 'right',
            }}
          >
            {t}
          </div>
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
  alerts.push('📡 Balise Winds Up Pentrez (Spot 66) : relais AROME HD Météo-France (1,3 km) actif sur la plage.');

  return (
    <div id="tab2">
      {/* Header with Mode toggle restricted to tomorrow by default */}
      <div
        className="card"
        style={{
          borderLeft: '4px solid var(--ac)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
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
              onClick={() => handleDayChange('tomorrow')}
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
              onClick={() => handleDayChange('today')}
            >
              Aujourd'hui
            </button>
          </div>
        </div>

        {/* ÉTAPE 3 : SÉLECTEUR DE MODE DE PLANIFICATION (THÉORIQUE VS RÉEL) */}
        {(() => {
          const logsCount = getStoredWaterlineLogs().length;
          const isDemo = typeof window !== 'undefined' && localStorage.getItem('cv_demo_mode_reel_unlocked') === 'true';
          const isUnlocked = logsCount >= 300 || isDemo;
          const currentMode = settings.calculationMode || 'theorique';

          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                paddingTop: '10px',
                borderTop: '1px solid var(--bd)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase' }}>
                  Modèle de calcul :
                </span>
                <div style={{ display: 'inline-flex', background: 'var(--cell)', padding: '2px', borderRadius: '8px', border: '1px solid var(--bd)' }}>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ calculationMode: 'theorique' })}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: currentMode === 'theorique' ? '#0f172a' : 'transparent',
                      color: currentMode === 'theorique' ? '#fff' : 'var(--tx)',
                      fontSize: '0.72rem',
                      fontWeight: currentMode === 'theorique' ? 800 : 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    📐 Mode Théorique (SHOM)
                  </button>

                  <button
                    type="button"
                    disabled={!isUnlocked}
                    onClick={() => {
                      if (!isUnlocked) {
                        alert(
                          `🔒 Le Mode Réel est verrouillé (${logsCount}/300 mesures).\n\nEnregistrez 300 relevés GPS terrain dans l'onglet « Étalonnage GPS » pour débloquer le Modèle Empirique.`
                        );
                        return;
                      }
                      onUpdateSettings({ calculationMode: 'reel' });
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: currentMode === 'reel' ? '#16a34a' : 'transparent',
                      color: !isUnlocked ? '#94a3b8' : currentMode === 'reel' ? '#fff' : 'var(--tx)',
                      fontSize: '0.72rem',
                      fontWeight: currentMode === 'reel' ? 800 : 600,
                      cursor: isUnlocked ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      opacity: isUnlocked ? 1 : 0.65,
                    }}
                    title={
                      isUnlocked
                        ? 'Activer le Mode Réel calibré sur la plage de Pentrez / Lestrevet'
                        : `Verrouillé (${logsCount}/300 mesures GPS requises)`
                    }
                  >
                    <span>{isUnlocked ? '✨' : '🔒'}</span>
                    <span>Mode Réel {isUnlocked ? '(Empirique)' : `(bloqué ${logsCount}/300)`}</span>
                  </button>
                </div>
              </div>

              {/* Statut descriptif du mode actif */}
              <div style={{ fontSize: '0.68rem', color: currentMode === 'reel' ? '#15803d' : '#0369a1', fontWeight: 700 }}>
                {currentMode === 'reel'
                  ? `✨ Créneaux adaptés selon le modèle empirique (+${settings.empiricalOffsetCm ?? 15} cm de surcote constatée)`
                  : `Seuil nominal SHOM : ${settings.L} m`}
              </div>
            </div>
          );
        })()}
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
