import React from 'react';
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
  allDay,
  COEF,
  dayFocus,
  dayInfo,
  dayRow,
  dayWind,
  exportValidCsv,
  lc,
  p2,
  plan,
  sw,
  toU,
  VC,
  vstat,
  wtxt,
} from '../utils/tides';
import { CurveChart } from './CurveChart';
import { CustomSlotsManager } from './CustomSlotsManager';
import { getFrenchHolidayInfo } from '../utils/frenchHolidays';
import { WindPanel } from './WindPanel';

interface DayDetailPanelProps {
  selectedDate: string;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  onUpdateCustomSlots: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  validations?: ValidationsMap;
  onValidateDay?: (ds: string, record: DayFocusData, mode?: 'all' | 'wind_only') => void;
  onClearValidation?: (ds: string) => void;
  onToggleSlotValidation?: (record: DayFocusData, slot: SessionItem) => void;
  onSetSlotDecision?: (
    record: DayFocusData,
    slot: SessionItem,
    decision: 'valid' | 'rejected' | 'pending',
    reason?: string
  ) => void;
  onOpenPrintAgenda?: () => void;
}

export const DayDetailPanel: React.FC<DayDetailPanelProps> = ({
  selectedDate,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  customSlotsMap,
  onUpdateCustomSlots,
  validations = {},
  onValidateDay,
  onClearValidation,
  onToggleSlotValidation,
  onSetSlotDecision,
  onOpenPrintAgenda,
}) => {
  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;

  const P = dayInfo(y, m, d, settings, tideW, first, last);
  const coef = COEF[selectedDate];
  const pl = plan(y, m, d, settings, tideW, first, last);
  const SS = pl.full;
  const XS = pl.extra;
  const DW = dayWind(y, m, d, settings, tideW, first, last, windList);

  const a = toU(y, m, d, 0);
  const z = toU(y, m, d + 1, 0);
  const R = dayRow(y, m, d, settings, EX, tideW, first, last, windList);

  const ad = EX.filter(p => p.t >= a && p.t < z && p.adj).map(p => p.adj as number);

  const customCfg = customSlotsMap[selectedDate];
  const hasCustom = customCfg && customCfg.slots.length > 0;
  const replaceDefault = hasCustom && customCfg.replaceDefault;

  type SlotItem = {
    a: number;
    b: number;
    isOpt: boolean;
    isCustom?: boolean;
    title?: string;
    lim: string;
    over: number;
    side: string;
  };

  let allSlots: SlotItem[] = [];

  if (replaceDefault) {
    allSlots = customCfg.slots.map(cs => {
      const [sh, sm] = cs.start.split(':').map(Number);
      const [eh, em] = cs.end.split(':').map(Number);
      return {
        a: toU(y, m, d, sh * 60 + sm),
        b: toU(y, m, d, eh * 60 + em),
        isOpt: false,
        isCustom: true,
        title: cs.title,
        lim: '',
        over: 0,
        side: '',
      };
    });
  } else {
    const defaultSlots: SlotItem[] = (
      SS.map(x => ({
        a: x[0],
        b: x[1],
        isOpt: false,
        lim: '',
        over: 0,
        side: '',
      })) as SlotItem[]
    ).concat(
      XS.map(x => ({
        a: x[0],
        b: x[1],
        isOpt: true,
        lim: x[2],
        over: x[3],
        side: x[4],
      }))
    );

    if (hasCustom) {
      const customItems: SlotItem[] = customCfg.slots.map(cs => {
        const [sh, sm] = cs.start.split(':').map(Number);
        const [eh, em] = cs.end.split(':').map(Number);
        return {
          a: toU(y, m, d, sh * 60 + sm),
          b: toU(y, m, d, eh * 60 + em),
          isOpt: false,
          isCustom: true,
          title: cs.title,
          lim: '',
          over: 0,
          side: '',
        };
      });
      allSlots = defaultSlots.concat(customItems).sort((p, q) => p.a - q.a);
    } else {
      allSlots = defaultSlots.sort((p, q) => p.a - q.a);
    }
  }

  const focusData = dayFocus(selectedDate, settings, tideW, first, last, windList, customSlotsMap);
  const valInfo = validations ? vstat(focusData, validations) : { st: 'none' as const };

  const holiday = getFrenchHolidayInfo(selectedDate);

  return (
    <div className="pan card cal" id="pan">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div className="pt">Plage de roulage</div>
          <div className="ps" style={{ marginBottom: 0 }}>
            Date : {p2(d)}/{p2(m0)}/{y} · seuil :{' '}
            {settings.L.toFixed(2).replace('.', 'm')}
            {settings.mg ? ` − ${settings.mg} cm` : ''} · {settings.h0}h–{settings.h1}h
          </div>
        </div>

        {holiday.isHoliday && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#fef2f2',
              border: '1.5px solid #fca5a5',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.74rem',
            }}
          >
            <span>🎒 {holiday.holidayName}</span>
            <span style={{ fontWeight: 800, color: '#b91c1c' }}>({holiday.zonesLabel})</span>
            <span style={{ display: 'inline-flex', gap: '3px' }}>
              <span
                style={{
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  color: '#fff',
                  background: holiday.isZoneA ? '#0284c7' : '#cbd5e1',
                  opacity: holiday.isZoneA ? 1 : 0.45,
                }}
              >
                A
              </span>
              <span
                style={{
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  color: '#fff',
                  background: holiday.isZoneB ? '#dc2626' : '#cbd5e1',
                  opacity: holiday.isZoneB ? 1 : 0.45,
                }}
              >
                B
              </span>
              <span
                style={{
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  color: '#fff',
                  background: holiday.isZoneC ? '#d97706' : '#cbd5e1',
                  opacity: holiday.isZoneC ? 1 : 0.45,
                }}
              >
                C
              </span>
            </span>
          </div>
        )}
      </div>

      <CurveChart
        dateStr={selectedDate}
        settings={settings}
        EX={EX}
        W={tideW}
        first={first}
        last={last}
      />

      <WindPanel
        dateStr={selectedDate}
        settings={settings}
        W={tideW}
        first={first}
        last={last}
        windList={windList}
      />

      {!P.length && (
        <div className="w">
          <span className="chip k">AUCUNE PLAGE</span>
          <span className="chip k">COEF : {coef}</span>
        </div>
      )}

      {P.map((p, idx) => (
        <div key={`pract-${idx}`} className="w">
          <span className="chip">● PRATICABLE</span>
          <span className="chip k">COEF : {coef}</span>
          <span className="hr">
            {lc(p[0], y, m, d)} - {lc(p[1], y, m, d)}
          </span>
        </div>
      ))}

      {allDay(y, m, d, settings) && (
        <div className="m">
          Coef ≤ {settings.cmax} : roulage toute la journée, sans contrainte de marée.
        </div>
      )}

      {/* Bloc Validation des créneaux sur l'onglet calendrier */}
      <div
        style={{
          marginTop: '16px',
          marginBottom: '14px',
          padding: '12px 14px',
          borderRadius: '10px',
          background:
            valInfo.st === 'ok'
              ? 'var(--okbg, #f0fdf4)'
              : valInfo.st === 'chg'
              ? '#fffbeb'
              : 'var(--card, #fff)',
          border:
            valInfo.st === 'ok'
              ? '2px solid var(--ok, #16a34a)'
              : valInfo.st === 'chg'
              ? '2px solid #f59e0b'
              : '1px solid var(--bd, #e5e7eb)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>
              {valInfo.st === 'ok' ? '✅' : valInfo.st === 'chg' ? '⚠️' : '📋'}
            </span>
            <div>
              <div
                style={{
                  fontWeight: 900,
                  fontSize: '0.88rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {valInfo.st === 'ok'
                  ? `${valInfo.valCount} validé${valInfo.valCount > 1 ? 's' : ''}${
                      valInfo.rejCount ? ` · ${valInfo.rejCount} refusé${valInfo.rejCount > 1 ? 's' : ''}` : ''
                    } (sur ${valInfo.totalCount} créneau${valInfo.totalCount > 1 ? 'x' : ''})`
                  : valInfo.st === 'chg'
                  ? `Prévisions modifiées (${valInfo.valCount} validé${valInfo.valCount > 1 ? 's' : ''}${
                      valInfo.rejCount ? `, ${valInfo.rejCount} refusé` : ''
                    })`
                  : 'Validation & Décision des créneaux'}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--mu, #666)' }}>
                {valInfo.st === 'ok'
                  ? `Enregistré le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}${valInfo.isPartial ? ' · Sélection partielle' : ' · Décision complète'}`
                  : valInfo.st === 'chg'
                  ? `Enregistré le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })} · Nouvelles prévisions détectées`
                  : `${allSlots.length} créneau${allSlots.length > 1 ? 'x' : ''} disponible${
                      allSlots.length > 1 ? 's' : ''
                    } · Validez ou refusez un à un ci-dessous ou appliquez le filtre vent`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {onValidateDay && (
              <>
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    background: '#0284c7',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    padding: '7px 11px',
                    borderRadius: '6px',
                  }}
                  onClick={() => onValidateDay(selectedDate, focusData, 'wind_only')}
                  title="Valider automatiquement les créneaux praticables et refuser les créneaux hors vent"
                >
                  ⚡ Valider si Vent OK
                </button>

                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    background:
                      valInfo.st === 'ok'
                        ? '#16a34a'
                        : valInfo.st === 'chg'
                        ? '#f59e0b'
                        : 'var(--ac, #ffc40d)',
                    color: valInfo.st === 'ok' || valInfo.st === 'chg' ? '#fff' : '#111',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    padding: '7px 11px',
                    borderRadius: '6px',
                  }}
                  onClick={() => onValidateDay(selectedDate, focusData, 'all')}
                  title="Valider tous les créneaux de cette journée sans exception"
                >
                  ✓ Tout valider
                </button>
              </>
            )}

            {valInfo.st !== 'none' && onClearValidation && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: 'transparent',
                  color: '#dc2626',
                  border: '1px solid #fca5a5',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  padding: '7px 9px',
                  borderRadius: '6px',
                }}
                onClick={() => onClearValidation(selectedDate)}
                title="Réinitialiser toutes les décisions pour cette journée"
              >
                ✕ Réinitialiser
              </button>
            )}

            {validations && Object.keys(validations).length > 0 && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: 'var(--cell, #f3f4f6)',
                  color: 'var(--tx, #111)',
                  border: '1px solid var(--bd, #e5e7eb)',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  padding: '7px 9px',
                  borderRadius: '6px',
                }}
                onClick={() => exportValidCsv(validations, settings.cap)}
                title="Exporter toutes les séances validées (CSV)"
              >
                📥 Exporter CSV
              </button>
            )}

            {onOpenPrintAgenda && (
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background: 'var(--cell, #f3f4f6)',
                  color: 'var(--tx, #111)',
                  border: '1px solid var(--bd, #e5e7eb)',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  padding: '7px 9px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                onClick={onOpenPrintAgenda}
                title="Imprimer la fiche agenda papier (horaires, hauteurs d'eau, météo)"
              >
                📋 Fiche Agenda
              </button>
            )}
          </div>
        </div>

        {/* Changes alert if st === 'chg' */}
        {valInfo.st === 'chg' && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 10px',
              background: '#fef3c7',
              borderRadius: '6px',
              fontSize: '0.76rem',
              color: '#92400e',
              lineHeight: 1.4,
            }}
          >
            <b>Alerte modifications météo / créneaux :</b>
            {valInfo.add.length > 0 && (
              <div>
                ➕ Ajout :{' '}
                {valInfo.add.map(x => `${lc(x.a, y, m, d)} - ${lc(x.b, y, m, d)}`).join(' ; ')}
              </div>
            )}
            {valInfo.rem.length > 0 && (
              <div>
                ➖ Retiré : {valInfo.rem.map(x => `${x.s} - ${x.e}`).join(' ; ')}
              </div>
            )}
            {valInfo.kchg && (
              <div>
                Verdict météo : {VC[valInfo.V.k][1]} → {VC[focusData.k][1]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sessions list */}
      <div className="ps" style={{ marginTop: '12px' }}>
        {replaceDefault
          ? `Séances sur mesure (${allSlots.length})`
          : `Séances proposées (${SS.length}${
              XS.length ? ` + ${XS.length} optionnel${XS.length > 1 ? 's' : ''}` : ''
            }${hasCustom ? ` + ${customCfg.slots.length} sur-mesure` : ''})`}
        {settings.cap > 1 && !replaceDefault ? ` · ${settings.cap} places par créneau` : ''}
      </div>

      {allSlots.map((x, idx) => {
        const ok = sw(x.a, x.b, settings, windList);
        const slotKey = Math.round(x.a) + (x.isOpt ? 'o' : '') + (x.isCustom ? 'c' : '');
        const valRecord = validations[selectedDate];
        const valItem = valRecord?.items?.find(item => item.k === slotKey);
        const decision: 'valid' | 'rejected' | 'pending' = valItem
          ? valItem.status === 'rejected'
            ? 'rejected'
            : 'valid'
          : 'pending';

        const sessItem =
          focusData.list.find(
            s =>
              Math.round(s.a) === Math.round(x.a) &&
              Boolean(s.opt) === Boolean(x.isOpt) &&
              Boolean(s.isCustom) === Boolean(x.isCustom)
          ) || focusData.list[idx];

        const renderDecisionButtons = () => {
          if (!sessItem) return null;
          if (!onSetSlotDecision) {
            if (!onToggleSlotValidation) return null;
            return (
              <button
                type="button"
                className={`slot-toggle-btn ${decision === 'valid' ? 'val-on' : 'val-off'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSlotValidation(focusData, sessItem);
                }}
              >
                {decision === 'valid' ? '✓ Validé' : '+ Valider'}
              </button>
            );
          }

          return (
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
                    onClick={() => onSetSlotDecision(focusData, sessItem, 'rejected', ok === false ? 'Vent hors plage' : 'Refusé')}
                    title="Refuser ce créneau (annulation / hors vent)"
                  >
                    ✕ Refuser
                  </button>
                  <button
                    type="button"
                    className="slot-toggle-btn neutral"
                    onClick={() => onSetSlotDecision(focusData, sessItem, 'pending')}
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
                    onClick={() => onSetSlotDecision(focusData, sessItem, 'valid')}
                    title="Valider et maintenir ce créneau"
                  >
                    ✓ Valider
                  </button>
                  <button
                    type="button"
                    className="slot-toggle-btn neutral"
                    onClick={() => onSetSlotDecision(focusData, sessItem, 'pending')}
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
                    onClick={() => onSetSlotDecision(focusData, sessItem, 'valid')}
                    title="Valider ce créneau"
                  >
                    ✓ Valider
                  </button>
                  <button
                    type="button"
                    className="slot-toggle-btn"
                    style={{ background: '#fef2f2', color: '#b91c1c', borderColor: '#fca5a5' }}
                    onClick={() => onSetSlotDecision(focusData, sessItem, 'rejected', ok === false ? 'Vent hors plage' : 'Refusé')}
                    title="Refuser ce créneau"
                  >
                    ✕ Refuser
                  </button>
                </>
              )}
            </div>
          );
        };

        if (x.isCustom) {
          return (
            <div
              key={`slot-c-${idx}`}
              className="w"
              style={{
                borderLeft: '3px solid var(--ac)',
                opacity: decision === 'rejected' ? 0.7 : 1,
                background: decision === 'rejected' ? '#fafafa' : undefined,
              }}
            >
              <span className="chip i">● SUR MESURE · {x.title}</span>
              <span className={ok === true ? 'chip fg' : ok === false ? 'chip fr' : 'chip k'}>
                {ok === true ? 'VENT OK' : ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
              </span>
              {renderDecisionButtons()}
              <span className="hr" style={{ textDecoration: decision === 'rejected' ? 'line-through' : 'none' }}>
                {lc(x.a, y, m, d)} - {lc(x.b, y, m, d)}
              </span>
            </div>
          );
        }

        if (x.isOpt) {
          return (
            <React.Fragment key={`slot-${idx}`}>
              <div
                className="w"
                style={{
                  opacity: decision === 'rejected' ? 0.7 : 1,
                  background: decision === 'rejected' ? '#fafafa' : undefined,
                }}
              >
                <span className="chip i">● OPTIONNEL · DÉPASSE DE {x.over} MIN</span>
                {renderDecisionButtons()}
                <span className="hr" style={{ textDecoration: decision === 'rejected' ? 'line-through' : 'none' }}>
                  {lc(x.a, y, m, d)} - {lc(x.b, y, m, d)}
                </span>
              </div>
              <div className="m">
                Au moins {Math.round(x.b - x.a - x.over)} min de roulage ; dépasse la contrainte{' '}
                {x.lim === 'marée'
                  ? "de marée (l'eau reste au-dessus du seuil)"
                  : "d'heure du jour"}{' '}
                au {x.side} · à la discrétion du moniteur
                {ok === true ? ' · vent OK' : ok === false ? ' · vent hors plage' : ''}
              </div>
            </React.Fragment>
          );
        }

        return (
          <div
            key={`slot-${idx}`}
            className="w"
            style={{
              opacity: decision === 'rejected' ? 0.7 : 1,
              background: decision === 'rejected' ? '#fafafa' : undefined,
            }}
          >
            <span className={ok === true ? 'chip' : 'chip k'}>
              {ok === true ? '● VENT OK' : ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
            </span>
            {renderDecisionButtons()}
            <span className="hr" style={{ textDecoration: decision === 'rejected' ? 'line-through' : 'none' }}>
              {lc(x.a, y, m, d)} - {lc(x.b, y, m, d)}
            </span>
          </div>
        );
      })}

      {!allSlots.length && (
        <div className="m">Aucune séance possible pour cette journée.</div>
      )}

      {/* Custom slots manager */}
      <CustomSlotsManager
        dateStr={selectedDate}
        settings={settings}
        windList={windList}
        customSlotsMap={customSlotsMap}
        onUpdateCustomSlots={onUpdateCustomSlots}
      />

      {/* Wind conditions */}
      {DW.P.length > 0 && (
        <>
          {DW.lvl === -1 ? (
            <div className="m">💨 Vent indisponible (hors ligne ou au-delà de 16 jours)</div>
          ) : (
            <>
              {DW.ws.map((x, i) => (
                <div key={`dw-${i}`} className="m">
                  💨 {lc(DW.P[i][0], y, m, d)}–{lc(DW.P[i][1], y, m, d)} :{' '}
                  {wtxt(x) || 'pas de donnée'}
                </div>
              ))}

              {DW.ws.some(x => x && x.src === 'G') && (
                <div className="m">
                  Au-delà d'environ 2 jours, le vent vient d'un modèle global (moins précis) : indicatif
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="m" style={{ marginTop: '12px' }}>
        ☀ Lever {R.lev} · Coucher {R.cou} · lumière retenue {R.lum}
      </div>
      <div className="m">
        🌙 {R.ph} · Lever {R.lr} · Coucher {R.ls}
      </div>

      {ad.length > 0 && (
        <div className="m">
          🌡 Basse pression : +{Math.round(Math.max(...ad) * 100)} cm ajoutés aux hauteurs d'eau (correction automatique)
        </div>
      )}

      <div className="m">
        {EX.filter(p => p.t >= a && p.t < z)
          .map(
            p =>
              (p.pm ? 'PM ' : 'BM ') +
              lc(p.t, y, m, d) +
              ' ' +
              (p.hd != null ? p.hd : p.h).toFixed(2).replace('.', ',') +
              ' m'
          )
          .join('   ·   ')}
      </div>
    </div>
  );
};
