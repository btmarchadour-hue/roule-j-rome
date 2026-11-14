import React, { useEffect, useState } from 'react';
import {
  AppSettings,
  CustomSlotsMap,
  DayFocusData,
  ValidationsMap,
  WindPoint,
} from '../types';
import { dayFocus, lc, tdy, VC, vstat } from '../utils/tides';
import { DEFAULT_NON_PUBLISH_REASONS } from '../utils/cycleHelpers';

interface DayCycle1BannerProps {
  selectedDate: string;
  settings: AppSettings;
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  customSlotsMap?: CustomSlotsMap;
  validations: ValidationsMap;
  onValidateDay: (
    dateStr: string,
    focusData: DayFocusData,
    mode: 'all' | 'not_published',
    reason?: string
  ) => void;
  onClearValidation: (dateStr: string) => void;
  onAddCustomNonPublishReason: (reason: string) => void;
  onNavigateDay?: (deltaDays: number) => void;
  canPrevDay?: boolean;
  canNextDay?: boolean;
  onOpenCycle2?: (dateStr: string) => void;
  hideOpenCycle2Button?: boolean;
  onOpenCycle1Detail?: (dateStr: string) => void;
  embedded?: boolean;
  isReadOnly?: boolean;
}

export const DayCycle1Banner: React.FC<DayCycle1BannerProps> = ({
  selectedDate,
  settings,
  W: tideW,
  first,
  last,
  windList,
  customSlotsMap = {},
  validations,
  onValidateDay,
  onClearValidation,
  onAddCustomNonPublishReason,
  onNavigateDay,
  canPrevDay = false,
  canNextDay = false,
  onOpenCycle2,
  hideOpenCycle2Button = false,
  onOpenCycle1Detail,
  embedded = false,
  isReadOnly = false,
}) => {
  const [dayNonPublishOpen, setDayNonPublishOpen] = useState(false);
  const [selectedDayReason, setSelectedDayReason] = useState<string>(DEFAULT_NON_PUBLISH_REASONS[0]);
  const [customDayReasonInput, setCustomDayReasonInput] = useState('');

  useEffect(() => {
    setDayNonPublishOpen(false);
  }, [selectedDate]);

  const availableNonPublishReasons = React.useMemo(() => {
    const base = [...DEFAULT_NON_PUBLISH_REASONS];
    const custom = settings.customNonPublishReasons || [];
    const seen = new Set(base.map(r => r.toLowerCase()));
    const result: string[] = [...base];
    for (const c of custom) {
      const trimmed = c.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        result.push(trimmed);
      }
    }
    return result;
  }, [settings.customNonPublishReasons]);

  const [y, m0, d] = selectedDate.split('-').map(Number);
  const m = m0 - 1;
  const focusData = dayFocus(selectedDate, settings, tideW, first, last, windList, customSlotsMap);
  const valInfo = vstat(focusData, validations);
  const isPast = selectedDate < tdy();
  const hasSlots = focusData.list.length > 0;

  const formattedDate = new Date(Date.UTC(y, m, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const isZeroPublishedOk =
    valInfo.st === 'ok' && valInfo.valCount === 0 && valInfo.cycle2Count === 0;
  const boxBg = isZeroPublishedOk
    ? '#f1f5f9'
    : valInfo.st === 'ok'
    ? 'var(--okbg, #f0fdf4)'
    : !isPast && valInfo.st === 'chg'
    ? '#fffbeb'
    : 'var(--card, #fff)';
  const boxBorder = isZeroPublishedOk
    ? '1.5px solid #94a3b8'
    : valInfo.st === 'ok'
    ? '2px solid var(--ok, #16a34a)'
    : !isPast && valInfo.st === 'chg'
    ? '2px solid #f59e0b'
    : '1px solid var(--bd, #e5e7eb)';

  return (
    <div
      style={{
        marginTop: embedded ? '16px' : 0,
        marginBottom: embedded ? '14px' : '12px',
        padding: '12px 14px',
        borderRadius: '10px',
        background: boxBg,
        border: boxBorder,
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
              : valInfo.cycle2Count > 0
              ? '⚡'
              : isZeroPublishedOk
              ? valInfo.notPublishedCount > 0
                ? '🚫'
                : '🌑'
              : valInfo.st === 'ok'
              ? '📅'
              : valInfo.st === 'chg'
              ? '⚠️'
              : '📋'}
          </span>
          <div>
            {!embedded && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '2px' }}>
                <span
                  style={{
                    fontSize: '0.80rem',
                    fontWeight: 900,
                    color: '#0369a1',
                    textTransform: 'capitalize',
                  }}
                >
                  {formattedDate}
                </span>
                {onNavigateDay && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '1px 3px',
                    }}
                  >
                    <button
                      type="button"
                      disabled={!canPrevDay}
                      onClick={() => onNavigateDay(-1)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: canPrevDay ? '#0f172a' : '#94a3b8',
                        padding: '2px 6px',
                        fontSize: '0.70rem',
                        fontWeight: 800,
                        cursor: canPrevDay ? 'pointer' : 'not-allowed',
                      }}
                      title="Jour précédent"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      disabled={!canNextDay}
                      onClick={() => onNavigateDay(1)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: canNextDay ? '#0284c7' : '#94a3b8',
                        padding: '2px 6px',
                        fontSize: '0.70rem',
                        fontWeight: 800,
                        cursor: canNextDay ? 'pointer' : 'not-allowed',
                      }}
                      title="Jour suivant"
                    >
                      ▶
                    </button>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                fontWeight: 900,
                fontSize: '0.88rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: isZeroPublishedOk ? '#334155' : undefined,
              }}
            >
              {isPast
                ? valInfo.st === 'ok'
                  ? `Archive · ${valInfo.valCount} publié${valInfo.valCount > 1 ? 's' : ''}${
                      valInfo.notPublishedCount
                        ? ` · 🚫 ${valInfo.notPublishedCount} non publié${valInfo.notPublishedCount > 1 ? 's' : ''}`
                        : ''
                    }${
                      valInfo.closedNoBookingsCount ? ` · ${valInfo.closedNoBookingsCount} Vie 1` : ''
                    } (sur ${valInfo.totalCount})`
                  : 'Journée passée'
                : valInfo.st === 'chg'
                ? `Cycle 2 impacté : Prévisions / marées modifiées (${valInfo.cycle2Count} créneau${valInfo.cycle2Count > 1 ? 'x' : ''} inscrit${valInfo.cycle2Count > 1 ? 's' : ''})`
                : isZeroPublishedOk
                ? valInfo.notPublishedCount > 0
                  ? `Cycle 1 · Journée non publiée (${valInfo.notPublishedCount} créneau${valInfo.notPublishedCount > 1 ? 'x' : ''})`
                  : `Cycle 1 · Journée clôturée (${valInfo.closedNoBookingsCount} Vie 1)`
                : valInfo.st === 'ok'
                ? `Cycle 1 · ${valInfo.valCount} à publier${
                    valInfo.notPublishedCount
                      ? ` · 🚫 ${valInfo.notPublishedCount} non publié${valInfo.notPublishedCount > 1 ? 's' : ''}`
                      : ''
                  }${valInfo.cycle2Count ? ` · ⚡ ${valInfo.cycle2Count} en Cycle 2` : ''}${
                    valInfo.closedNoBookingsCount ? ` · 🌑 ${valInfo.closedNoBookingsCount} Vie 1` : ''
                  }`
                : 'Cycle 1 · En attente de validation (C1)'}
            </div>

            {!isPast && valInfo.st === 'none' && (
              <div style={{ marginTop: '4px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: '#fffbeb',
                    color: '#92400e',
                    border: '1px solid #fcd34d',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontWeight: 800,
                    fontSize: '0.72rem',
                  }}
                >
                  <span>⏳</span>
                  <span>EN ATTENTE DE VALIDATION (C1)</span>
                </span>
              </div>
            )}

            <div style={{ fontSize: '0.74rem', color: 'var(--mu, #666)', marginTop: '2px' }}>
              {isPast
                ? valInfo.st === 'ok'
                  ? `Journée passée (verrouillée) · Enregistré le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}`
                  : 'Journée passée · Archive non modifiable en Cycle 1'
                : valInfo.st === 'ok'
                ? `Publié le ${new Date(valInfo.V.ts).toLocaleString('fr-FR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })} · Repositionnable tant qu'il y a 0 inscrit · Bascule Cycle 2 dès 1 char`
                : valInfo.st === 'chg'
                ? `Créneaux engagés (Cycle 2) modifiés · Basculez vers Adaptation météo & décisions pour ajuster`
                : `${focusData.list.length} créneau${focusData.list.length > 1 ? 'x' : ''} calculé${
                    focusData.list.length > 1 ? 's' : ''
                  } selon la marée · Ajustable pendant toute la vie du Cycle 1 (0 inscrit)`}
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
              <span>Mode Moniteur : Lecture seule</span>
            </span>
          )}

          {isPast && (
            <span
              style={{
                background: '#f1f5f9',
                border: '1.5px solid #cbd5e1',
                color: '#475569',
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
              <span>Journée passée · Verrouillée en Cycle 1</span>
            </span>
          )}

          {!isPast && !isReadOnly && hasSlots && (
            <>
              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background:
                    valInfo.st === 'ok' && valInfo.valCount > 0 && valInfo.notPublishedCount === 0
                      ? '#16a34a'
                      : valInfo.st === 'chg'
                      ? '#f59e0b'
                      : 'var(--ac, #ffc40d)',
                  color:
                    (valInfo.st === 'ok' && valInfo.valCount > 0 && valInfo.notPublishedCount === 0) ||
                    valInfo.st === 'chg'
                      ? '#fff'
                      : '#111',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  padding: '7px 11px',
                  borderRadius: '6px',
                }}
                onClick={() => {
                  setDayNonPublishOpen(false);
                  onValidateDay(selectedDate, focusData, 'all');
                }}
                title="Marquer tous les créneaux de cette journée « À publier » en Cycle 1"
              >
                ✅ Tout à publier (C1)
              </button>

              <button
                type="button"
                className="fbtn"
                style={{
                  margin: 0,
                  background:
                    dayNonPublishOpen || (valInfo.notPublishedCount > 0 && valInfo.valCount === 0)
                      ? '#334155'
                      : '#fff',
                  color:
                    dayNonPublishOpen || (valInfo.notPublishedCount > 0 && valInfo.valCount === 0)
                      ? '#fff'
                      : '#334155',
                  border: '1.5px solid #475569',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  padding: '7px 11px',
                  borderRadius: '6px',
                }}
                onClick={() => setDayNonPublishOpen(prev => !prev)}
                title="Marquer cette journée « À ne pas publier » et choisir la raison (Réunion, Vacances...) pour vos statistiques d'absentéisme"
              >
                🚫 À ne pas publier
              </button>
            </>
          )}

          {!hideOpenCycle2Button && valInfo.cycle2Count > 0 && onOpenCycle2 && (
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                background: '#7c3aed',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.74rem',
                padding: '7px 11px',
                borderRadius: '6px',
              }}
              onClick={() => onOpenCycle2(selectedDate)}
              title="Basculer vers Adaptation météo & décisions (Cycle 2)"
            >
              ⚡ Ouvrir en Cycle 2
            </button>
          )}

          {onOpenCycle1Detail && (
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                background: '#f0f9ff',
                color: '#0369a1',
                border: '1px solid #bae6fd',
                fontWeight: 800,
                fontSize: '0.72rem',
                padding: '7px 10px',
                borderRadius: '6px',
              }}
              onClick={() => onOpenCycle1Detail(selectedDate)}
              title="Ouvrir cette journée dans Validation des créneaux de roulage (Cycle 1)"
            >
              📅 Créneaux (C1)
            </button>
          )}

          {!isPast && !isReadOnly && valInfo.st !== 'none' && (
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                background: '#fff',
                color: '#dc2626',
                border: '1px solid #fca5a5',
                fontWeight: 700,
                fontSize: '0.72rem',
                padding: '7px 9px',
                borderRadius: '6px',
              }}
              onClick={() => onClearValidation(selectedDate)}
              title="Réinitialiser toutes les publications et décisions de cette journée"
            >
              ✕ Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* Sélecteur de raison de non-publication sur toute la journée */}
      {!isPast && !isReadOnly && dayNonPublishOpen && hasSlots && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px 14px',
            background: '#f8fafc',
            border: '1.5px solid #475569',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 900, color: '#0f172a', marginBottom: '8px' }}>
            🚫 Raison de non-publication pour la journée (comptabilisée en absentéisme plage hors météo/clients/plage) :
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
            {availableNonPublishReasons.map(reason => {
              const isSel = selectedDayReason === reason;
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setSelectedDayReason(reason)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: isSel ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                    background: isSel ? '#334155' : '#fff',
                    color: isSel ? '#fff' : '#334155',
                    fontSize: '0.74rem',
                    fontWeight: isSel ? 800 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {reason}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
            <input
              type="text"
              value={customDayReasonInput}
              onChange={e => setCustomDayReasonInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && customDayReasonInput.trim()) {
                  e.preventDefault();
                  const trimmed = customDayReasonInput.trim();
                  onAddCustomNonPublishReason(trimmed);
                  setSelectedDayReason(trimmed);
                  setCustomDayReasonInput('');
                }
              }}
              placeholder="Ajouter une nouvelle raison (ex: Formation BPJEPS, RDV pro...)"
              style={{
                flex: '1 1 220px',
                padding: '6px 10px',
                fontSize: '0.76rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
              }}
            />
            <button
              type="button"
              disabled={!customDayReasonInput.trim()}
              onClick={() => {
                const trimmed = customDayReasonInput.trim();
                if (!trimmed) return;
                onAddCustomNonPublishReason(trimmed);
                setSelectedDayReason(trimmed);
                setCustomDayReasonInput('');
              }}
              style={{
                padding: '6px 11px',
                borderRadius: '6px',
                border: 'none',
                background: customDayReasonInput.trim() ? '#0284c7' : '#cbd5e1',
                color: '#fff',
                fontSize: '0.74rem',
                fontWeight: 800,
                cursor: customDayReasonInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              + Ajouter raison
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                onValidateDay(selectedDate, focusData, 'not_published', selectedDayReason);
                setDayNonPublishOpen(false);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: '#334155',
                color: '#fff',
                fontSize: '0.76rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🚫 Confirmer « À ne pas publier » ({selectedDayReason})
            </button>

            <button
              type="button"
              onClick={() => setDayNonPublishOpen(false)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#475569',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Alerte uniquement si Cycle 2 actif ou dérive horaire de marée */}
      {!isPast && valInfo.st === 'chg' && (valInfo.cycle2Count > 0 || valInfo.rem.length > 0) && (
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
          <b>Alerte Cycle 2 (créneaux avec inscrits ou horaires modifiés) :</b>
          {valInfo.add.length > 0 && (
            <div>
              ➕ Ajout : {valInfo.add.map(x => `${lc(x.a, y, m, d)} - ${lc(x.b, y, m, d)}`).join(' ; ')}
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
  );
};
