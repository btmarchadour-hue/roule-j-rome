import React, { useState, useEffect } from 'react';
import { ActiveUserSession } from '../types';
import { getActiveUser } from '../utils/authUtils';
import { syncLocalDataWithFirestore } from '../utils/firebaseSync';

interface SyncStatusBarProps {
  isOnline?: boolean;
  currentUser?: ActiveUserSession | null;
  onLock?: () => void;
}

export const SyncStatusBar: React.FC<SyncStatusBarProps> = ({
  isOnline = true,
  currentUser: propUser,
  onLock,
}) => {
  const [currentUser, setCurrentUser] = useState<ActiveUserSession | null>(
    () => propUser || getActiveUser()
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string>('');

  useEffect(() => {
    if (propUser) {
      setCurrentUser(propUser);
    } else {
      setCurrentUser(getActiveUser());
    }

    const handleSyncEvent = (e: any) => {
      if (e.detail?.msg) {
        setSyncFeedback(e.detail.msg);
        setTimeout(() => setSyncFeedback(''), 4000);
      }
    };
    window.addEventListener('cv_sync_status', handleSyncEvent);
    return () => window.removeEventListener('cv_sync_status', handleSyncEvent);
  }, [propUser]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback('');
    try {
      await syncLocalDataWithFirestore();
      setSyncFeedback('✓ Synchronisé avec le Cloud');
      setTimeout(() => setSyncFeedback(''), 4000);
    } catch {
      setSyncFeedback('⚠️ Erreur de synchronisation');
      setTimeout(() => setSyncFeedback(''), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  const username = currentUser?.username || 'Jérôme';
  const role = currentUser?.role || 'admin';
  const isReadOnly = Boolean(currentUser?.isReadOnly);

  return (
    <div
      className="noprint"
      style={{
        background: isReadOnly ? '#fffbeb' : '#f8fafc',
        borderBottom: isReadOnly ? '1px solid #fde68a' : '1px solid var(--bd, #e2e8f0)',
        padding: '6px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        fontSize: '0.74rem',
        transition: 'background-color 0.2s ease',
      }}
    >
      {/* Statut de synchronisation Cloud Firestore */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
          {isOnline ? 'Cloud Synchro En Direct' : 'Hors ligne (Local)'}
        </span>

        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          style={{
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '2px 8px',
            fontSize: '0.68rem',
            fontWeight: 700,
            color: '#0369a1',
            cursor: isSyncing ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Forcer la synchronisation entre téléphone et ordinateur"
        >
          <span>{isSyncing ? '⏳' : '🔄'}</span>
          <span>{isSyncing ? 'Synchronisation…' : 'Synchroniser'}</span>
        </button>

        {syncFeedback && (
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 800,
              color: syncFeedback.startsWith('✓') ? '#166534' : '#b91c1c',
            }}
          >
            {syncFeedback}
          </span>
        )}

        <span style={{ color: 'var(--mu, #64748b)', fontSize: '0.72rem' }}>
          Spot : Plage de Lestrevet · Plomodiern
        </span>
      </div>

      {/* Profil connecté & changement de compte */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#ffffff',
            padding: '3px 10px',
            borderRadius: '8px',
            border: isReadOnly ? '1.5px solid #f59e0b' : '1px solid #cbd5e1',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          <span style={{ fontSize: '0.85rem' }}>
            {username.toLowerCase().includes('jérôme') || username.toLowerCase().includes('jerome')
              ? '⛵'
              : username.toLowerCase().includes('benoît') || username.toLowerCase().includes('benoit')
              ? '👁️'
              : '👤'}
          </span>

          <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.74rem' }}>
            {username}
          </span>

          <span
            style={{
              fontSize: '0.64rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '4px',
              background: role === 'admin' ? '#e0f2fe' : '#f1f5f9',
              color: role === 'admin' ? '#0369a1' : '#475569',
            }}
          >
            {role === 'admin' ? '⭐ Admin' : 'Moniteur'}
          </span>

          {isReadOnly && (
            <span
              style={{
                fontSize: '0.64rem',
                fontWeight: 800,
                padding: '1px 6px',
                borderRadius: '4px',
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
              }}
              title="Version verrouillée en écriture : vous pouvez consulter toutes les données en toute sécurité sans risque d'erreur"
            >
              🔒 Mode Contrôle (Lecture seule)
            </span>
          )}
        </div>

        {onLock && (
          <button
            type="button"
            onClick={onLock}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '3px 9px',
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#475569',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Changer d'utilisateur ou verrouiller la session"
          >
            <span>🔒</span>
            <span>Changer de profil</span>
          </button>
        )}
      </div>
    </div>
  );
};
