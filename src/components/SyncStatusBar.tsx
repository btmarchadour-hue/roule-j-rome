import React, { useState, useEffect } from 'react';
import { getActiveInstructor, setActiveInstructor } from '../utils/firebaseSync';

interface SyncStatusBarProps {
  isOnline?: boolean;
  onLock?: () => void;
}

export const SyncStatusBar: React.FC<SyncStatusBarProps> = ({ isOnline = true, onLock }) => {
  const [currentInstructor, setCurrentInstructor] = useState<string>(() => getActiveInstructor());
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [customNameInput, setCustomNameInput] = useState<string>('');

  useEffect(() => {
    const active = getActiveInstructor();
    setCurrentInstructor(active);
  }, []);

  const handleSelectInstructor = (name: string) => {
    setCurrentInstructor(name);
    setActiveInstructor(name);
    setIsCustomMode(false);
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customNameInput.trim()) {
      handleSelectInstructor(customNameInput.trim());
      setCustomNameInput('');
    }
  };

  return (
    <div
      className="noprint"
      style={{
        background: '#f8fafc',
        borderBottom: '1px solid var(--bd, #e2e8f0)',
        padding: '6px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        fontSize: '0.74rem',
      }}
    >
      {/* Statut de synchronisation Cloud Firestore */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: isOnline ? '#dcfce7' : '#fee2e2',
            color: isOnline ? '#166534' : '#991b1b',
            padding: '2px 8px',
            borderRadius: '999px',
            fontWeight: 800,
            fontSize: '0.68rem',
            border: `1px solid ${isOnline ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isOnline ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }}
          />
          {isOnline ? 'Cloud Synchro Temps Réel' : 'Hors ligne (Local)'}
        </span>

        <span style={{ color: 'var(--mu, #64748b)', fontSize: '0.72rem' }}>
          Données partagées téléphone & ordinateur (Jérôme & Benoît)
        </span>
      </div>

      {/* Sélecteur de profil moniteur */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontWeight: 800, color: 'var(--tx, #1e293b)', fontSize: '0.72rem' }}>
          👤 Saisie active :
        </span>

        <div style={{ display: 'inline-flex', background: '#fff', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '2px', gap: '2px' }}>
          <button
            type="button"
            onClick={() => handleSelectInstructor('Jérôme')}
            style={{
              border: 'none',
              background: currentInstructor === 'Jérôme' ? '#0284c7' : 'transparent',
              color: currentInstructor === 'Jérôme' ? '#fff' : '#475569',
              padding: '3px 9px',
              borderRadius: '4px',
              fontWeight: currentInstructor === 'Jérôme' ? 800 : 600,
              fontSize: '0.70rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Jérôme (par défaut)
          </button>

          <button
            type="button"
            onClick={() => handleSelectInstructor('Benoît')}
            style={{
              border: 'none',
              background: currentInstructor === 'Benoît' ? '#0284c7' : 'transparent',
              color: currentInstructor === 'Benoît' ? '#fff' : '#475569',
              padding: '3px 9px',
              borderRadius: '4px',
              fontWeight: currentInstructor === 'Benoît' ? 800 : 600,
              fontSize: '0.70rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Benoît
          </button>

          {currentInstructor !== 'Jérôme' && currentInstructor !== 'Benoît' && (
            <span
              style={{
                background: '#0284c7',
                color: '#fff',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: 800,
                fontSize: '0.70rem',
              }}
            >
              {currentInstructor}
            </span>
          )}
        </div>

        {isCustomMode ? (
          <form onSubmit={handleSaveCustom} style={{ display: 'inline-flex', gap: '4px' }}>
            <input
              type="text"
              placeholder="Prénom..."
              value={customNameInput}
              onChange={e => setCustomNameInput(e.target.value)}
              style={{
                padding: '2px 6px',
                fontSize: '0.70rem',
                borderRadius: '4px',
                border: '1px solid #94a3b8',
                width: '80px',
              }}
              autoFocus
            />
            <button
              type="submit"
              style={{
                padding: '2px 6px',
                fontSize: '0.68rem',
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => setIsCustomMode(false)}
              style={{
                padding: '2px 4px',
                fontSize: '0.68rem',
                background: '#e2e8f0',
                color: '#475569',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsCustomMode(true)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#64748b',
              fontSize: '0.68rem',
              cursor: 'pointer',
              padding: '2px 4px',
              textDecoration: 'underline',
            }}
            title="Saisir un autre nom de moniteur"
          >
            Autre
          </button>
        )}

        {onLock && (
          <button
            type="button"
            onClick={onLock}
            style={{
              background: '#fff',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '3px 8px',
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#475569',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginLeft: '4px',
            }}
            title="Verrouiller l'accès"
          >
            <span>🔒</span>
            <span>Verrouiller</span>
          </button>
        )}
      </div>
    </div>
  );
};
