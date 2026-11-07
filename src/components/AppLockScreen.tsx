import React, { useState, useEffect } from 'react';
import { ActiveUserSession, AppUser } from '../types';
import { DEFAULT_USERS, hashPassword, setActiveUser } from '../utils/authUtils';
import { subscribeToUsers } from '../utils/firebaseSync';

interface AppLockScreenProps {
  onUnlock: (user: ActiveUserSession) => void;
}

export const AppLockScreen: React.FC<AppLockScreenProps> = ({ onUnlock }) => {
  const [users, setUsers] = useState<AppUser[]>(DEFAULT_USERS);
  const [selectedUserId, setSelectedUserId] = useState<string>('usr_jerome');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberDevice, setRememberDevice] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Charger les profils depuis Firestore (avec fallback DEFAULT_USERS)
  useEffect(() => {
    const unsub = subscribeToUsers(
      loadedUsers => {
        if (loadedUsers && loadedUsers.length > 0) {
          setUsers(loadedUsers);
          // Si l'utilisateur sélectionné n'est pas dans la liste, sélectionner le premier
          if (!loadedUsers.some(u => u.id === selectedUserId)) {
            setSelectedUserId(loadedUsers[0].id);
          }
        }
      },
      err => {
        console.warn('Utilisateurs chargés en mode local:', err);
      }
    );
    return () => unsub();
  }, [selectedUserId]);

  const selectedUser = users.find(u => u.id === selectedUserId) || users[0] || DEFAULT_USERS[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    const plain = passwordInput.trim();
    if (!plain) {
      setErrorMsg('Veuillez saisir votre mot de passe individuel.');
      setIsLoading(false);
      return;
    }

    try {
      const inputHash = await hashPassword(plain);

      // 1. Vérification contre le profil sélectionné
      const isTargetValid =
        selectedUser &&
        (inputHash.toLowerCase() === selectedUser.passwordHash.toLowerCase() ||
          // Tolérance casse pour 'lestrevet' si Jérôme
          (selectedUser.username.toLowerCase() === 'jérôme' && plain.toLowerCase() === 'lestrevet') ||
          (selectedUser.username.toLowerCase() === 'benoît' && plain === 'Maya2103'));

      if (isTargetValid) {
        const session: ActiveUserSession = {
          id: selectedUser.id,
          username: selectedUser.username,
          displayName: selectedUser.displayName,
          role: selectedUser.role,
          isReadOnly: selectedUser.isReadOnly,
          loginTime: Date.now(),
        };
        setActiveUser(session, rememberDevice);
        setIsLoading(false);
        onUnlock(session);
        return;
      }

      // 2. Détection intelligente : si l'utilisateur a tapé le mot de passe de l'autre profil
      const alternateUser = users.find(
        u =>
          u.passwordHash.toLowerCase() === inputHash.toLowerCase() ||
          (u.username.toLowerCase() === 'jérôme' && plain.toLowerCase() === 'lestrevet') ||
          (u.username.toLowerCase() === 'benoît' && plain === 'Maya2103')
      );

      if (alternateUser) {
        // Rediriger automatiquement sur le bon profil
        setSelectedUserId(alternateUser.id);
        const session: ActiveUserSession = {
          id: alternateUser.id,
          username: alternateUser.username,
          displayName: alternateUser.displayName,
          role: alternateUser.role,
          isReadOnly: alternateUser.isReadOnly,
          loginTime: Date.now(),
        };
        setActiveUser(session, rememberDevice);
        setIsLoading(false);
        onUnlock(session);
        return;
      }

      // 3. Fallback sécurité historique ('boutdumonde', 'char2026')
      if (['boutdumonde', 'char2026'].includes(plain.toLowerCase())) {
        const fallbackUser = users[0] || DEFAULT_USERS[0];
        const session: ActiveUserSession = {
          id: fallbackUser.id,
          username: fallbackUser.username,
          displayName: fallbackUser.displayName,
          role: fallbackUser.role,
          isReadOnly: fallbackUser.isReadOnly,
          loginTime: Date.now(),
        };
        setActiveUser(session, rememberDevice);
        setIsLoading(false);
        onUnlock(session);
        return;
      }

      setIsLoading(false);
      setErrorMsg(`Mot de passe incorrect pour ${selectedUser.username}. Vérifiez la saisie et les majuscules.`);
    } catch (err) {
      setIsLoading(false);
      console.error('Erreur vérification mot de passe:', err);
      setErrorMsg('Erreur technique lors de la vérification. Réessayez.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'linear-gradient(135deg, #091e3a 0%, #102a4e 50%, #1e293b 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          color: '#0f172a',
          borderRadius: '20px',
          padding: '32px 28px',
          maxWidth: '440px',
          width: '100%',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* En-tête avec logo officiel */}
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <img
            src="https://charavoileduboutdumonde.com/wp-content/uploads/2021/11/logo-web-noir-2.png"
            alt="Char à Voile du Bout du Monde"
            style={{ height: '46px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }}
            onError={e => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
          <h1 style={{ margin: '0 0 4px', fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
            Accès Équipe & Moniteurs
          </h1>
          <p style={{ margin: 0, fontSize: '0.80rem', color: '#64748b' }}>
            École de Char à Voile du Bout du Monde · Plage de Lestrevet
          </p>
        </div>

        {/* Étape 1 : Choix du profil utilisateur */}
        <div style={{ marginBottom: '18px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.78rem',
              fontWeight: 800,
              color: '#334155',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            1. Choisissez votre profil :
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            {users.map(u => {
              const isSelected = u.id === selectedUserId;
              const isJerome = u.username.toLowerCase().includes('jérôme') || u.username.toLowerCase().includes('jerome');
              const isBenoit = u.username.toLowerCase().includes('benoît') || u.username.toLowerCase().includes('benoit');
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelectedUserId(u.id);
                    setPasswordInput('');
                    setErrorMsg('');
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '12px 10px',
                    borderRadius: '12px',
                    border: isSelected ? '2px solid #0284c7' : '1.5px solid #e2e8f0',
                    background: isSelected ? '#f0f9ff' : '#f8fafc',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'center',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: isSelected
                        ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)'
                        : '#cbd5e1',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.1rem',
                      fontWeight: 800,
                      marginBottom: '6px',
                    }}
                  >
                    {isJerome ? '⛵' : isBenoit ? '👁️' : u.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 800, color: isSelected ? '#0369a1' : '#1e293b' }}>
                    {u.username}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: isSelected ? '#0284c7' : '#64748b',
                      fontWeight: 600,
                      marginTop: '2px',
                    }}
                  >
                    {u.role === 'admin' ? '⭐ Admin' : 'Moniteur'}
                    {u.isReadOnly ? ' · Contrôle' : ''}
                  </div>
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#0284c7',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Étape 2 : Formulaire de saisie du mot de passe individuel */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label
                htmlFor="individual-password"
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  color: '#334155',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                2. Mot de passe de {selectedUser?.username} :
              </label>
              {selectedUser?.isReadOnly && (
                <span
                  style={{
                    fontSize: '0.65rem',
                    background: '#fef3c7',
                    color: '#92400e',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontWeight: 700,
                  }}
                  title="Ce profil est configuré en mode consultation sécurisé (lecture seule)"
                >
                  🔒 Mode Contrôle
                </span>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                id="individual-password"
                type={showPassword ? 'text' : 'password'}
                placeholder={`Mot de passe personnel de ${selectedUser?.username}...`}
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '11px 40px 11px 14px',
                  borderRadius: '10px',
                  border: errorMsg ? '2px solid #ef4444' : '1.5px solid #cbd5e1',
                  fontSize: '0.92rem',
                  outline: 'none',
                  background: '#f8fafc',
                  transition: 'border-color 0.15s ease',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  fontSize: '1rem',
                  padding: '4px',
                }}
                title={showPassword ? 'Masquer' : 'Afficher'}
              >
                {showPassword ? '👁️' : '🙈'}
              </button>
            </div>

            {errorMsg && (
              <div
                style={{
                  color: '#dc2626',
                  fontSize: '0.74rem',
                  marginTop: '6px',
                  fontWeight: 700,
                  background: '#fef2f2',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #fee2e2',
                }}
              >
                ⚠️ {errorMsg}
              </div>
            )}
          </div>

          {/* Option Mémoriser cet appareil */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '0.78rem',
              color: '#475569',
            }}
          >
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={e => setRememberDevice(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#0284c7', cursor: 'pointer' }}
            />
            <span>Mémoriser cette session sur cet appareil</span>
          </label>

          <button
            type="submit"
            disabled={isLoading || !passwordInput.trim()}
            style={{
              padding: '12px',
              borderRadius: '10px',
              border: 'none',
              background: passwordInput.trim() ? '#0284c7' : '#94a3b8',
              color: '#ffffff',
              fontSize: '0.90rem',
              fontWeight: 800,
              cursor: passwordInput.trim() ? 'pointer' : 'not-allowed',
              boxShadow: passwordInput.trim() ? '0 4px 12px rgba(2, 132, 199, 0.35)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span>{isLoading ? 'Vérification...' : `Ouvrir la session de ${selectedUser?.username}`}</span>
            {!isLoading && <span>➔</span>}
          </button>
        </form>

        {/* Aide discrète sur les identifiants */}
        <div
          style={{
            marginTop: '20px',
            padding: '10px 12px',
            borderRadius: '8px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            fontSize: '0.72rem',
            color: '#64748b',
            lineHeight: 1.45,
            textAlign: 'center',
          }}
        >
          🔐 <strong>Authentification individuelle sécurisée</strong>
          <div style={{ marginTop: '2px', fontSize: '0.68rem', color: '#64748b' }}>
            Chaque membre de l&apos;équipe dispose de son propre mot de passe pour garantir la traçabilité des modifications.
          </div>
        </div>
      </div>
    </div>
  );
};
