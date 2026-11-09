import React, { useState } from 'react';
import { AppSettings } from '../types';

interface SettingsCardProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onResetToDefaults: () => void;
  canUndoReset?: boolean;
  onUndoReset?: () => void;
  windStatusText: string;
  onRefreshWind: () => void;
  isLoadingWind: boolean;
  isReadOnly?: boolean;
  userRole?: 'admin' | 'moniteur';
  userName?: string;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
  settings,
  onUpdateSettings: rawOnUpdateSettings,
  onResetToDefaults,
  canUndoReset = false,
  onUndoReset,
  windStatusText,
  onRefreshWind,
  isLoadingWind,
  isReadOnly = false,
  userRole = 'admin',
  userName = 'Jérôme',
}) => {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const isLocked = isReadOnly || userRole === 'moniteur';

  const onUpdateSettings = (newSettings: Partial<AppSettings>) => {
    if (isLocked) return;
    rawOnUpdateSettings(newSettings);
  };

  const parseNum = (val: string, fallback: number) => {
    const n = parseFloat(val.replace(',', '.'));
    return isNaN(n) ? fallback : n;
  };

  return (
    <>
      <div className="card ctl nop" style={{ opacity: isLocked ? 0.88 : 1 }}>
        {isReadOnly || userRole === 'moniteur' ? (
          <div
            style={{
              gridColumn: '1/-1',
              background: '#f8fafc',
              border: '1.5px solid #cbd5e1',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#334155',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontWeight: 600,
              marginBottom: '6px',
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>🔒</span>
            <div>
              <strong style={{ color: '#0f172a' }}>Mode Moniteur (Consultation seule)</strong>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                Les paramètres de l'école sont consultables pour votre travail sur la plage mais verrouillés en écriture pour préserver la configuration opérationnelle.
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              gridColumn: '1/-1',
              background: '#f0fdf4',
              border: '1.5px solid #86efac',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#166534',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontWeight: 600,
              marginBottom: '6px',
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>👑</span>
            <div>
              <strong style={{ color: '#14532d' }}>Mode Administrateur ({userName})</strong>
              <div style={{ fontSize: '0.74rem', color: '#15803d', fontWeight: 400, marginTop: '2px' }}>
                Modifications en direct et réinitialisation autorisées pour l'école.
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            gridColumn: '1/-1',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '2px',
          }}
        >
          <b style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Séances
          </b>

          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              color: '#0369a1',
              background: '#e0f2fe',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid #bae6fd',
            }}
            title="Toute modification apportée ici par un administrateur est transmise instantanément à tous les moniteurs connectés sans bouton Enregistrer"
          >
            <span>🔄</span>
            <span>Synchro automatique Cloud en direct</span>
          </span>
        </div>

        <div style={{ gridColumn: '1/-1', fontSize: '0.70rem', color: 'var(--mu, #64748b)', marginTop: '-4px', marginBottom: '8px' }}>
          Les réglages modifiés ici s&apos;enregistrent automatiquement dans le Cloud et se propagent en temps réel sur les téléphones et ordinateurs de toute l&apos;équipe.
        </div>

        <label style={{ opacity: isLocked ? 0.8 : 1 }}>
          Durée d'une séance (min)
          <input
            type="text"
            inputMode="decimal"
            disabled={isReadOnly}
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
            onChange={e => onUpdateSettings({ xpl: e.target.value as 'fin' | 'debut', xplCustomized: true })}
          >
            <option value="debut">Dès la 1re plage disponible (1h après lever de soleil, min. 09h00)</option>
            <option value="fin">À partir de la fin de plage (dernière séance)</option>
          </select>
        </label>

        <span className="note" style={{ gridColumn: '1/-1', color: '#0369a1', fontWeight: 600 }}>
          🕒 Règle de l'école : aucune séance automatique avant 09h00 (séances sur mesure possibles plus tôt).
        </span>

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

        <label className="ck" title="Surcote barométrique : ajoute +1 cm d'eau par hPa sous 1013 hPa selon la prévision AROME/GFS. Voir explications détaillées en bas de page.">
          <input
            type="checkbox"
            checked={settings.pcor}
            onChange={e => onUpdateSettings({ pcor: e.target.checked })}
          />{' '}
          Correction de pression (+1 cm par hPa sous 1013)
        </label>
      </div>

      <div className="card ctl nop" style={{ opacity: isLocked ? 0.88 : 1 }}>
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

        {/* MODULE 6 : BALISE WINDS UP SPOT 66 & OBSERVATIONS */}
        <div
          style={{
            gridColumn: '1/-1',
            background: 'var(--cbg, #f8fafc)',
            border: '1.5px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            marginTop: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>📡</span>
              <div>
                <b style={{ fontSize: '0.85rem', color: 'var(--tx, #0f172a)' }}>
                  Balise Winds Up Pentrez (Spot 66)
                </b>
                <span
                  style={{
                    marginLeft: '8px',
                    fontSize: '0.70rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '5px',
                    background: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                  }}
                >
                  🛰️ Relais AROME HD actif
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <a
                href="https://www.winds-up.com/spot/66"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 10px',
                  background: '#0284c7',
                  color: '#ffffff',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                <span>Winds Up Spot 66 ↗</span>
              </a>
              <a
                href="https://www.windguru.cz/48456"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 10px',
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                <span>Windguru Pentrez ↗</span>
              </a>
            </div>
          </div>

          <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', lineHeight: 1.45 }}>
            {windStatusText ? (
              <span><strong>Flux météo en cours :</strong> {windStatusText}</span>
            ) : (
              <span>Modèle Météo-France AROME HD (maille 1,3 km) interpolé sur la plage de Lestrevet.</span>
            )}
          </div>
        </div>

        {/* MODULE 2 : ZONE RÉINITIALISATION AUX VALEURS PAR DÉFAUT */}
        <div
          style={{
            gridColumn: '1/-1',
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
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
            <div>
              <b style={{ fontSize: '0.86rem', color: '#334155', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                ⚙️ Réinitialisation
              </b>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.74rem', color: '#64748b' }}>
                Remet les 24 réglages (séances, seuils, marées, météo) aux valeurs d'origine de l'école.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isReadOnly}
              style={{
                padding: '8px 14px',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: '1.5px solid #cbd5e1',
                background: isReadOnly ? '#f1f5f9' : '#fff',
                color: isReadOnly ? '#94a3b8' : '#b91c1c',
                cursor: isReadOnly ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: isReadOnly ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.15s ease',
              }}
              title={
                isReadOnly
                  ? 'Action réservée aux administrateurs (verrouillée pour les moniteurs)'
                  : 'Remettre tous les réglages par défaut'
              }
            >
              <span>{isReadOnly ? '🔒' : '↺'}</span>
              <span>Revenir aux paramètres par défaut</span>
            </button>
          </div>

          {canUndoReset && onUndoReset && (
            <div
              style={{
                background: '#ecfdf5',
                border: '1.5px solid #6ee7b7',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                boxShadow: '0 1px 3px rgba(16, 185, 129, 0.15)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#065f46' }}>
                <span style={{ fontSize: '1rem' }}>✓</span>
                <span>
                  <strong>Tous les réglages ont été réinitialisés aux valeurs d'usine.</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={onUndoReset}
                style={{
                  background: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                }}
              >
                <span>↩</span>
                <span>Annuler / Restaurer mes réglages</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODALE DE CONFIRMATION AVANT RÉINITIALISATION */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '16px' }}>
              <div
                style={{
                  background: '#fee2e2',
                  color: '#dc2626',
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.3rem',
                  flexShrink: 0,
                }}
              >
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a', fontWeight: 700 }}>
                  Réinitialiser tous les paramètres ?
                </h3>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
                  Cette action va remettre <strong>l'ensemble des 24 réglages</strong> (durée des séances à 60 min, pauses à 15 min, seuil d'eau à 4m50, vent, horaires) à leurs valeurs d'origine de l'école.
                </p>
                <div
                  style={{
                    marginTop: '12px',
                    padding: '8px 12px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    color: '#991b1b',
                    fontWeight: 600,
                  }}
                >
                  📢 Impact immédiat : la nouvelle configuration sera transmise instantanément à tous les moniteurs connectés.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmModal(false);
                  onResetToDefaults();
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)',
                }}
              >
                Oui, réinitialiser tout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
