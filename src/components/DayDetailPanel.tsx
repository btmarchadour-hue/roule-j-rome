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
  tdy,
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
  onOpenObservationModal?: (slot: {
    dateStr: string;
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    isCustom?: boolean;
    customTitle?: string;
  }) => void;
  isReadOnly?: boolean;
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
  onUpdateCustomSlots: rawOnUpdateCustomSlots,
  validations = {},
  onValidateDay: rawOnValidateDay,
  onClearValidation: rawOnClearValidation,
  onToggleSlotValidation: rawOnToggleSlotValidation,
  onSetSlotDecision: rawOnSetSlotDecision,
  onOpenPrintAgenda,
  onOpenObservationModal,
  isReadOnly = false,
}) => {
  const onValidateDay = isReadOnly ? undefined : rawOnValidateDay;
  const onClearValidation = isReadOnly ? undefined : rawOnClearValidation;
  const onToggleSlotValidation = isReadOnly ? undefined : rawOnToggleSlotValidation;
  const onSetSlotDecision = isReadOnly ? undefined : rawOnSetSlotDecision;
  const onUpdateCustomSlots = (ds: string, rep: boolean, slots: CustomSlot[]) => {
    if (isReadOnly) return;
    rawOnUpdateCustomSlots(ds, rep, slots);
  };
  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;

  const P = dayInfo(y, m, d, settings, tideW, first, last);
  const coef = COEF[selectedDate];
  const pl = plan(y, m, d, settings, tideW, first, last);
  const SS = pl.full;
  const XS = pl.extra;
  const DW = dayWind(y, m, d, settings, tideW, first, last, windList);

  const [isCustomSlotsOpen, setIsCustomSlotsOpen] = useState(false);

  const calculatedDefaultSlots = SS.map((x, idx) => ({
    start: lc(x[0], y, m, d),
    end: lc(x[1], y, m, d),
    title: `Séance ${idx + 1}`,
  })).concat(
    XS.map(x => ({
      start: lc(x[0], y, m, d),
      end: lc(x[1], y, m, d),
      title: `Optionnel (+${x[3]} min)`,
    }))
  );

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
  const isPast = selectedDate < tdy();

  const holiday = getFrenchHolidayInfo(selectedDate);

  return (
    <div className="pan card cal" id="pan">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
        <div>
          <div className="pt">Plage de roulage</div>
          <div className="ps" style={{ marginBottom: 0 }}>
            Date : {p2(d)}/{p2(m0)}/{y} · seuil :{' '}
            {settings.L.toFixed(2).replace('.', 'm')}
            {settings.mg ? ` − ${settings.mg} cm` : ''} · min. 09h00–{settings.h1}h
          </div>
        </div>

        {/* 2 boutons d'action principaux : + NOTER UN RELEVÉ & ✏️ MODIFIER LES CRÉNEAUX */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {onOpenObservationModal && (
            <button
              type="button"
              onClick={() => {
                onOpenObservationModal({
                  dateStr: selectedDate,
                  slotKey: allSlots[0] ? `s0` : 'general',
                  slotStart: allSlots[0] ? lc(allSlots[0].a, y, m, d) : '09:00',
                  slotEnd: allSlots[0] ? lc(allSlots[0].b, y, m, d) : '10:00',
                  isCustom: allSlots[0]?.isCustom,
                  customTitle: allSlots[0]?.title,
                });
              }}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 14px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              title="Noter un relevé terrain (hauteurs d'eau, surcote, météo) ou une cause d'annulation"
            >
              <span style={{ fontSize: '0.95rem', fontWeight: 900 }}>+</span>
              <span>NOTER UN RELEVÉ</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsCustomSlotsOpen(true);
              const el = document.getElementById('custom-slots-section');
              el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
            style={{
              background: '#ffffff',
              color: '#0f172a',
              border: '1.5px solid #0284c7',
              borderRadius: '8px',
              padding: '7px 13px',
              fontWeight: 800,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.15s ease',
            }}
            title="Redéfinir manuellement les créneaux prédéfinis pour une souplesse totale"
          >
            <span>✏️</span>
            <span>MODIFIER LES CRÉNEAUX</span>
          </button>
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
            marginBottom: '8px',
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
              : !isPast && valInfo.st === 'chg'
              ? '#fffbeb'
              : 'var(--card, #fff)',
          border:
            valInfo.st === 'ok'
              ? '2px solid var(--ok, #16a34a)'
              : !isPast && valInfo.st === 'chg'
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
              {isPast
                ? valInfo.st === 'ok'
                  ? '📜'
                  : '⏳'
                : valInfo.st === 'ok'
                ? '✅'
                : valInfo.st === 'chg'
                ? '⚠️'
                : '📋'}
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
                {isPast
                  ? valInfo.st === 'ok'
                    ? `Archive : ${valInfo.valCount} validé${valInfo.valCount > 1 ? 's' : ''}${
                        valInfo.rejCount ? ` · ${valInfo.rejCount} refusé${valInfo.rejCount > 1 ? 's' : ''}` : ''
                      } (sur ${valInfo.totalCount} créneau${valInfo.totalCount > 1 ? 'x' : ''})`
                    : 'Journée passée'
                  : valInfo.st === 'ok'
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
                {isPast
                  ? valInfo.st === 'ok'
                    ? `Journée passée · Enregistré le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`
                    : 'Séances terminées pour cette date'
                  : valInfo.st === 'ok'
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
            {isReadOnly && (
              <span
                style={{
                  background: '#fffbeb',
                  border: '1.5px solid #fde68a',
                  color: '#92400e',
                  padding: '5px 11px',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>🔒</span>
                <span>Mode Contrôle (Benoît) : Validations verrouillées</span>
              </span>
            )}

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

        {/* Changes alert if st === 'chg' (interdit sur les jours passés) */}
        {!isPast && valInfo.st === 'chg' && (
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

      {/* Ensemble des créneaux de la journée avec affichage clair et sans équivoque du statut */}
      {(() => {
        const matchedValKeys = new Set<string>();

        const renderedSlots = allSlots.map((x, idx) => {
          const ok = sw(x.a, x.b, settings, windList);
          const slotKey = Math.round(x.a) + (x.isOpt ? 'o' : '') + (x.isCustom ? 'c' : '');
          const startTimeStr = lc(x.a, y, m, d);
          const endTimeStr = lc(x.b, y, m, d);
          const valRecord = validations[selectedDate];

          // Recherche multi-niveaux pour garantir la parfaite concordance avec l'archive
          // 1. Par clé exacte
          let valItem = valRecord?.items?.find(item => item.k === slotKey);

          // 2. Par heure exacte de début et fin
          if (!valItem && valRecord?.items) {
            valItem = valRecord.items.find(item => item.s === startTimeStr && item.e === endTimeStr);
          }

          // 3. Par heure de début exacte
          if (!valItem && valRecord?.items) {
            valItem = valRecord.items.find(item => item.s === startTimeStr);
          }

          // 4. Par proximité horaire (si le calcul théorique a légèrement glissé de 15 à 45 min)
          if (!valItem && valRecord?.items) {
            const [sh, sm] = startTimeStr.replace('h', ':').split(':').map(Number);
            const slotMin = sh * 60 + sm;
            let closest: (typeof valRecord.items)[0] | null = null;
            let minDiff = 45;
            for (const item of valRecord.items) {
              if (!item.s || matchedValKeys.has(item.k)) continue;
              const [ih, im] = item.s.replace('h', ':').split(':').map(Number);
              const diff = Math.abs(slotMin - (ih * 60 + im));
              if (diff <= minDiff) {
                minDiff = diff;
                closest = item;
              }
            }
            if (closest) {
              valItem = closest;
            }
          }

          if (valItem) {
            matchedValKeys.add(valItem.k);
          }

          const decision: 'valid' | 'rejected' | 'pending' = valItem
            ? valItem.status === 'rejected'
              ? 'rejected'
              : 'valid'
            : 'pending';

          const sessItem: SessionItem =
            focusData.list.find(
              s =>
                Math.round(s.a) === Math.round(x.a) &&
                Boolean(s.opt) === Boolean(x.isOpt) &&
                Boolean(s.isCustom) === Boolean(x.isCustom)
            ) || {
              a: x.a,
              b: x.b,
              opt: Boolean(x.isOpt),
              isCustom: Boolean(x.isCustom),
              customTitle: x.title,
              ok: ok,
              st: null,
              txt: '',
              over: x.over || 0,
              lim: x.lim || '',
              side: x.side || '',
              past: isPast,
            };

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

          return (
            <div
              key={`slot-${idx}`}
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
              {/* SECTION GAUCHE : STATUT PRINCIPAL & INFORMATIONS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {decision === 'valid' && (
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

                {/* Mention Sur-mesure ou Optionnel */}
                {x.isCustom ? (
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '0.72rem' }}>
                    ● SUR MESURE · {x.title}
                  </span>
                ) : x.isOpt ? (
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '0.72rem' }}>
                    ● OPTIONNEL (+{x.over} MIN)
                  </span>
                ) : null}

                {/* Puce Vent */}
                <span
                  className={ok === true ? 'chip fg' : ok === false ? 'chip fr' : 'chip k'}
                  style={{ margin: 0 }}
                >
                  {ok === true ? '● VENT OK' : ok === false ? 'VENT HORS PLAGE' : 'VENT ?'}
                </span>
              </div>

              {/* SECTION DROITE : HEURE TRÈS VISIBLE + ACTIONS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {/* Actions de décision */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
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
                        onClick={() => onSetSlotDecision?.(focusData, sessItem, 'rejected', ok === false ? 'Vent hors plage' : 'Refusé')}
                        title="Passer en séance refusée / annulée"
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
                        onClick={() => onSetSlotDecision?.(focusData, sessItem, 'pending')}
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
                        onClick={() => onSetSlotDecision?.(focusData, sessItem, 'valid')}
                        title="Valider et maintenir cette séance"
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
                        onClick={() => onSetSlotDecision?.(focusData, sessItem, 'pending')}
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
                        onClick={() => onSetSlotDecision?.(focusData, sessItem, 'valid')}
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
                        onClick={() => onSetSlotDecision?.(focusData, sessItem, 'rejected', ok === false ? 'Vent hors plage' : 'Refusé')}
                        title="Refuser ce créneau"
                      >
                        <span>✕</span>
                        <span>Refuser</span>
                      </button>
                    </>
                  )}

                  {/* Bouton Relevé terrain */}
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
                      onClick={() =>
                        onOpenObservationModal({
                          dateStr: selectedDate,
                          slotKey,
                          slotStart: startTimeStr,
                          slotEnd: endTimeStr,
                          isCustom: x.isCustom,
                          customTitle: x.title,
                        })
                      }
                      title="Noter un relevé terrain ou une cause d'annulation pour les statistiques"
                    >
                      <span>📝</span>
                      <span>Relevé</span>
                    </button>
                  )}
                </div>

                {/* Horaire de la séance bien affirmé */}
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
                  {startTimeStr} - {endTimeStr}
                </div>
              </div>
            </div>
          );
        });

        // 5. Créneaux de l'archive historique non rattachés (pour que TOUT ce qui est dans l'archive apparaisse)
        const valRecord = validations[selectedDate];
        const unattachedArchivedItems = (valRecord?.items || []).filter(
          item => !matchedValKeys.has(item.k)
        );

        return (
          <>
            {renderedSlots}

            {unattachedArchivedItems.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                  📜 Autres séances enregistrées dans l'archive :
                </div>
                {unattachedArchivedItems.map((archivedItem, aIdx) => {
                  const isArchValid = archivedItem.status !== 'rejected';
                  return (
                    <div
                      key={`archived-${aIdx}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        marginBottom: '6px',
                        backgroundColor: isArchValid ? '#f0fdf4' : '#fef2f2',
                        border: `1.5px solid ${isArchValid ? '#86efac' : '#fca5a5'}`,
                        borderLeft: `5px solid ${isArchValid ? '#16a34a' : '#dc2626'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            background: isArchValid ? '#16a34a' : '#dc2626',
                            color: '#fff',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: 900,
                            fontSize: '0.74rem',
                          }}
                        >
                          {isArchValid ? '✓ ARCHIVE VALIDÉE' : '✕ ARCHIVE REFUSÉE'}
                        </span>
                        {archivedItem.rejectReason && (
                          <span style={{ fontSize: '0.72rem', color: '#991b1b', fontWeight: 700 }}>
                            ({archivedItem.rejectReason})
                          </span>
                        )}
                        {archivedItem.customTitle && (
                          <span style={{ fontSize: '0.72rem', color: '#0369a1', fontWeight: 700 }}>
                            {archivedItem.customTitle}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 900,
                          color: isArchValid ? '#14532d' : '#991b1b',
                          textDecoration: isArchValid ? 'none' : 'line-through',
                        }}
                      >
                        {archivedItem.s} - {archivedItem.e}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

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
        defaultSlots={calculatedDefaultSlots}
        isOpenControlled={isCustomSlotsOpen}
        onToggleOpen={() => setIsCustomSlotsOpen(!isCustomSlotsOpen)}
        isReadOnly={isReadOnly}
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
