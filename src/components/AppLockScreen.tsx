import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ensureAuth } from '../firebase';

interface AppLockScreenProps {
  onUnlock: () => void;
}

export const AppLockScreen: React.FC<AppLockScreenProps> = ({ onUnlock }) => {
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cloudPassword, setCloudPassword] = useState<string | null>(null);

  // Charger le mot de passe cloud s'il a été personnalisé
  useEffect(() => {
    let isMounted = true;
    const fetchConfig = async () => {
      try {
        await ensureAuth();
        const docRef = doc(db, 'app_config', 'security');
        const snap = await getDoc(docRef);
        if (snap.exists() && isMounted) {
          const data = snap.data();
          if (data && data.clubPassword) {
            setCloudPassword(data.clubPassword);
          }
        }
      } catch {
        // En cas de réseau faible, fallback immédiat sur les mots de passe par défaut
      }
    };
    fetchConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    const trimmed = passwordInput.trim().toLowerCase();

    // Mots de passe valides :
    // 1. Mot de passe personnalisé dans le cloud
    // 2. Mots de passe d'origine : 'lestrevet', 'boutdumonde', 'char2026'
    const isCloudValid = cloudPassword ? trimmed === cloudPassword.toLowerCase().trim() : false;
    const isDefaultValid = ['lestrevet', 'boutdumonde', 'char2026'].includes(trimmed);

    if (isCloudValid || isDefaultValid) {
      if (rememberDevice) {
        try {
          localStorage.setItem('cv_app_unlocked', 'true');
        } catch {
          // ignore
        }
      } else {
        try {
          sessionStorage.setItem('cv_app_unlocked', 'true');
        } catch {
          // ignore
        }
      }
      setIsLoading(false);
      onUnlock();
    } else {
      setIsLoading(false);
      setErrorMsg('Mot de passe incorrect. Réessayez ou vérifiez la casse.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          color: '#0f172a',
          borderRadius: '16px',
          padding: '32px 28px',
          maxWidth: '420px',
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* En-tête avec logo */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <img
            src="https://charavoileduboutdumonde.com/wp-content/uploads/2021/11/logo-web-noir-2.png"
            alt="Char à Voile du Bout du Monde"
            style={{ height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }}
            onError={e => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
          <h1 style={{ margin: '0 0 6px', fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
            Accès Moniteurs & Planning
          </h1>
          <p style={{ margin: 0, fontSize: '0.80rem', color: '#64748b' }}>
            École de Char à Voile du Bout du Monde · Lestrevet
          </p>
        </div>

        {/* Formulaire de saisie du mot de passe */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label
              htmlFor="app-password"
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '6px' }}
            >
              🔒 Mot de passe d'accès :
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="app-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Entrez le mot de passe..."
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
                title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? '👁️' : '🙈'}
              </button>
            </div>
            {errorMsg && (
              <div style={{ color: '#dc2626', fontSize: '0.74rem', marginTop: '6px', fontWeight: 700 }}>
                ⚠️ {errorMsg}
              </div>
            )}
          </div>

          {/* Option Mémoriser cet appareil */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', color: '#475569' }}>
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={e => setRememberDevice(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#0284c7', cursor: 'pointer' }}
            />
            <span>Mémoriser cet appareil (rester connecté)</span>
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
              fontSize: '0.88rem',
              fontWeight: 800,
              cursor: passwordInput.trim() ? 'pointer' : 'not-allowed',
              boxShadow: passwordInput.trim() ? '0 4px 12px rgba(2, 132, 199, 0.35)' : 'none',
              transition: 'background-color 0.15s ease, transform 0.05s ease',
            }}
          >
            {isLoading ? 'Vérification...' : 'Déverrouiller le planning ➔'}
          </button>
        </form>

        {/* Note de confidentialité & redirection clients */}
        <div
          style={{
            marginTop: '22px',
            padding: '12px 14px',
            borderRadius: '10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            fontSize: '0.74rem',
            color: '#64748b',
            lineHeight: 1.45,
            textAlign: 'center',
          }}
        >
          🔒 <strong>Espace Privé Équipe & Moniteurs</strong>
          <div style={{ marginTop: '4px', fontSize: '0.70rem', color: '#64748b' }}>
            Accès strictement protégé. Les plannings, créneaux et données de réservation sont confidentiels.
          </div>
          <div style={{ marginTop: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '8px', fontSize: '0.68rem' }}>
            Vous êtes client ? Visitez notre site officiel :{' '}
            <a
              href="https://charavoileduboutdumonde.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#0284c7', fontWeight: 700, textDecoration: 'underline' }}
            >
              charavoileduboutdumonde.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
