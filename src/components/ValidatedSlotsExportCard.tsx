import React, { useMemo, useState } from 'react';
import { ValidationsMap } from '../types';
import { AgendaBookingItem } from '../utils/firebaseSync';
import { MOIS } from '../utils/tides';
import {
  collectValidatedExportSlots,
  downloadValidatedSlotsAnnyBlockerIcs,
  downloadValidatedSlotsCsvFr,
  downloadValidatedSlotsCsvUniversal,
  downloadValidatedSlotsIcs,
  downloadValidatedSlotsJson,
  ExportScope,
  getScopeLabel,
} from '../utils/validatedSlotsExport';

interface ValidatedSlotsExportCardProps {
  year: number;
  month: number;
  validations: ValidationsMap;
  bookingsMap: Record<string, AgendaBookingItem[]>;
}

export const ValidatedSlotsExportCard: React.FC<ValidatedSlotsExportCardProps> = ({
  year,
  month,
  validations,
  bookingsMap,
}) => {
  const [scope, setScope] = useState<ExportScope>('upcoming');
  const [onlyWithAvailability, setOnlyWithAvailability] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [lastExportMsg, setLastExportMsg] = useState<string | null>(null);

  const exportSlots = useMemo(
    () =>
      collectValidatedExportSlots({
        validations,
        bookingsMap,
        scope,
        year,
        month,
        onlyWithAvailability,
      }),
    [validations, bookingsMap, scope, year, month, onlyWithAvailability]
  );

  const totalCapacity = useMemo(
    () => exportSlots.reduce((sum, s) => sum + s.maxCapacityChars, 0),
    [exportSlots]
  );
  const totalAvailable = useMemo(
    () => exportSlots.reduce((sum, s) => sum + s.availableChars, 0),
    [exportSlots]
  );

  const isEmpty = exportSlots.length === 0;

  const notifyExport = (formatLabel: string) => {
    setLastExportMsg(
      `✓ Export ${formatLabel} généré (${exportSlots.length} créneau${exportSlots.length > 1 ? 'x' : ''} · ${getScopeLabel(scope, year, month)})`
    );
    setTimeout(() => setLastExportMsg(null), 5000);
  };

  return (
    <div
      className="card nop"
      style={{
        border: '1.5px solid #bae6fd',
        background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* En-tête + Sélecteur de périmètre */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.92rem', color: '#0f172a' }}>
              🚀 Export Réservation · Créneaux validés par Jérôme uniquement
            </strong>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 900,
                background: isEmpty ? '#f1f5f9' : '#dcfce7',
                color: isEmpty ? '#64748b' : '#166534',
                border: isEmpty ? '1px solid #cbd5e1' : '1px solid #86efac',
              }}
            >
              {exportSlots.length} créneau{exportSlots.length > 1 ? 'x' : ''} validé{exportSlots.length > 1 ? 's' : ''} ·{' '}
              {totalAvailable}/{totalCapacity} chars dispos
            </span>
          </div>
          <div style={{ fontSize: '0.73rem', color: '#475569', marginTop: '3px', lineHeight: 1.4 }}>
            Exporte strictement les créneaux publiés en Cycle 1 (exclut automatiquement les créneaux en attente,{' '}
            <em>À ne pas publier</em>, <em>Hors offre</em>, <em>Pas d&apos;inscrits</em>, <em>Annulés</em> et{' '}
            <em>Regroupés</em>).
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'upcoming', label: '📅 À venir (≥ aujourd’hui)' },
                { id: 'month', label: `🗓️ ${MOIS[month]} ${year}` },
                { id: 'all', label: '📦 Tout le calendrier' },
              ] as const
            ).map(opt => {
              const active = scope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setScope(opt.id)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: active ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background: active ? '#0284c7' : '#ffffff',
                    color: active ? '#ffffff' : '#334155',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.71rem',
              fontWeight: 700,
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={onlyWithAvailability}
              onChange={e => setOnlyWithAvailability(e.target.checked)}
            />
            <span>Uniquement avec places disponibles (&gt; 0 char libre)</span>
          </label>
        </div>
      </div>

      {/* Grille des formats d'importation adaptés à anny et aux outils de réservation */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '8px',
        }}
      >
        <button
          type="button"
          disabled={isEmpty}
          onClick={() => {
            downloadValidatedSlotsAnnyBlockerIcs(exportSlots, scope, year, month);
            notifyExport('iCal Bloquant anny (.ics)');
          }}
          style={{
            textAlign: 'left',
            padding: '10px 12px',
            borderRadius: '8px',
            border: isEmpty ? '1px solid #e2e8f0' : '2px solid #0f766e',
            background: isEmpty ? '#f8fafc' : '#f0fdfa',
            color: isEmpty ? '#94a3b8' : '#0f172a',
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <span style={{ fontWeight: 900, fontSize: '0.8rem', color: isEmpty ? '#94a3b8' : '#0f766e' }}>
            ⭐ Spécial anny · iCal Bloquant (.ics)
          </span>
          <span style={{ fontSize: '0.69rem', color: isEmpty ? '#94a3b8' : '#334155', lineHeight: 1.35 }}>
            Génère les blocages hors créneaux validés : dans anny (Google/Outlook/ICS), seuls les créneaux validés par Jérôme restent réservables.
          </span>
        </button>

        <button
          type="button"
          disabled={isEmpty}
          onClick={() => {
            downloadValidatedSlotsJson(exportSlots, scope, year, month);
            notifyExport('JSON API anny / Make / n8n');
          }}
          style={{
            textAlign: 'left',
            padding: '10px 12px',
            borderRadius: '8px',
            border: isEmpty ? '1px solid #e2e8f0' : '1.5px solid #7c3aed',
            background: isEmpty ? '#f8fafc' : '#f5f3ff',
            color: isEmpty ? '#94a3b8' : '#0f172a',
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <span style={{ fontWeight: 900, fontSize: '0.8rem', color: isEmpty ? '#94a3b8' : '#6d28d9' }}>
            🔌 JSON Structuré · API anny / Make / n8n
          </span>
          <span style={{ fontSize: '0.69rem', color: isEmpty ? '#94a3b8' : '#334155', lineHeight: 1.35 }}>
            Plages journalières + capacités 12/20/24 prêtes pour l&apos;Admin API anny ou scénario Make / n8n.
          </span>
        </button>

        <button
          type="button"
          disabled={isEmpty}
          onClick={() => {
            downloadValidatedSlotsIcs(exportSlots, scope, year, month);
            notifyExport('iCal Créneaux validés (.ics)');
          }}
          style={{
            textAlign: 'left',
            padding: '10px 12px',
            borderRadius: '8px',
            border: isEmpty ? '1px solid #e2e8f0' : '1.5px solid #0284c7',
            background: isEmpty ? '#f8fafc' : '#f0f9ff',
            color: isEmpty ? '#94a3b8' : '#0f172a',
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <span style={{ fontWeight: 900, fontSize: '0.8rem', color: isEmpty ? '#94a3b8' : '#0369a1' }}>
            📅 Agenda iCal · Créneaux ouverts (.ics)
          </span>
          <span style={{ fontSize: '0.69rem', color: isEmpty ? '#94a3b8' : '#334155', lineHeight: 1.35 }}>
            Uniquement les créneaux validés (agenda moniteur Google/Apple, vérification ou autre outil).
          </span>
        </button>

        <button
          type="button"
          disabled={isEmpty}
          onClick={() => {
            downloadValidatedSlotsCsvFr(exportSlots, scope, year, month);
            notifyExport('CSV Réservation FR');
          }}
          style={{
            textAlign: 'left',
            padding: '10px 12px',
            borderRadius: '8px',
            border: isEmpty ? '1px solid #e2e8f0' : '1.5px solid #16a34a',
            background: isEmpty ? '#f8fafc' : '#f0fdf4',
            color: isEmpty ? '#94a3b8' : '#0f172a',
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <span style={{ fontWeight: 900, fontSize: '0.8rem', color: isEmpty ? '#94a3b8' : '#15803d' }}>
            📊 CSV Réservation FR (.csv)
          </span>
          <span style={{ fontSize: '0.69rem', color: isEmpty ? '#94a3b8' : '#334155', lineHeight: 1.35 }}>
            Séparateur « ; » UTF-8 BOM : saisie guidée dans anny (horaires, capacité 12/20/24, dispo) &amp; Excel.
          </span>
        </button>

        <button
          type="button"
          disabled={isEmpty}
          onClick={() => {
            downloadValidatedSlotsCsvUniversal(exportSlots, scope, year, month);
            notifyExport('CSV Universel ISO');
          }}
          style={{
            textAlign: 'left',
            padding: '10px 12px',
            borderRadius: '8px',
            border: isEmpty ? '1px solid #e2e8f0' : '1.5px solid #d97706',
            background: isEmpty ? '#f8fafc' : '#fffbeb',
            color: isEmpty ? '#94a3b8' : '#0f172a',
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <span style={{ fontWeight: 900, fontSize: '0.8rem', color: isEmpty ? '#94a3b8' : '#b45309' }}>
            🌐 CSV Universel / Make / n8n (.csv)
          </span>
          <span style={{ fontSize: '0.69rem', color: isEmpty ? '#94a3b8' : '#334155', lineHeight: 1.35 }}>
            Séparateur « , » + ISO 8601 : idéal pour Google Sheets, Make ou n8n vers l&apos;API anny.
          </span>
        </button>
      </div>

      {/* Confirmation ou message si aucun créneau validé dans ce périmètre */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {lastExportMsg ? (
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#15803d' }}>
            {lastExportMsg}
          </span>
        ) : isEmpty ? (
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#b45309' }}>
            ⚠️ Aucun créneau validé sur la période « {getScopeLabel(scope, year, month)} ». Validez d&apos;abord au moins un créneau ou changez la période.
          </span>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
            Périmètre actif : <strong>{getScopeLabel(scope, year, month)}</strong>
          </span>
        )}

        {!isEmpty && (
          <button
            type="button"
            onClick={() => setShowPreview(prev => !prev)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showPreview
              ? 'Masquer l’aperçu'
              : `👁️ Aperçu des créneaux exportés (${exportSlots.length})`}
          </button>
        )}
      </div>

      {/* Aperçu rapide dépliable */}
      {showPreview && !isEmpty && (
        <div
          style={{
            maxHeight: '260px',
            overflowY: 'auto',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            background: '#ffffff',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', color: '#334155', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Horaire</th>
                <th style={{ padding: '6px 8px' }}>Séance</th>
                <th style={{ padding: '6px 8px' }}>Moniteur(s)</th>
                <th style={{ padding: '6px 8px' }}>Capacité</th>
                <th style={{ padding: '6px 8px' }}>Dispo</th>
              </tr>
            </thead>
            <tbody>
              {exportSlots.map(s => (
                <tr key={`${s.ds}_${s.slotKey}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {s.dayName} {s.dateFr}
                  </td>
                  <td style={{ padding: '5px 8px', fontWeight: 800, color: '#0369a1', whiteSpace: 'nowrap' }}>
                    {s.startTime} – {s.endTime}
                  </td>
                  <td style={{ padding: '5px 8px' }}>{s.title}</td>
                  <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{s.instructorsLabel}</td>
                  <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                    {s.bookedChars}/{s.maxCapacityChars} chars
                  </td>
                  <td
                    style={{
                      padding: '5px 8px',
                      fontWeight: 800,
                      color: s.availableChars > 0 ? '#15803d' : '#b91c1c',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.availableChars} dispo
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
