import React, { useEffect, useState } from 'react';
import { APP_VERSION_INFO } from '../version';

interface HeaderProps {
  onOpenExchange?: () => void;
  unreadExchangeCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenExchange,
  unreadExchangeCount = 0,
}) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Par défaut, l'application est toujours en thème clair avec fond blanc net
    const saved = localStorage.getItem('cvTheme');
    if (saved === 'dark_mode') {
      setTheme('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      setTheme('light');
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('cvTheme', 'light');
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('cvTheme', next === 'dark' ? 'dark_mode' : 'light');
    document.documentElement.setAttribute('data-theme', next);
  };

  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      setShowInstallGuide(true);
    }
  };

  return (
    <>
      <header className="brand">
        <img
          src="https://charavoileduboutdumonde.com/wp-content/uploads/2021/11/logo-web-noir-2.png"
          alt="Char à Voile du Bout du Monde"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }}
        />
        <div style={{ flex: 1 }}>
          <div className="bt" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>Char à Voile du Bout du Monde</span>
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 800,
                background: '#e0f2fe',
                color: '#0369a1',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid #bae6fd',
                letterSpacing: '0.02em',
              }}
              title={APP_VERSION_INFO.displayString}
            >
              {APP_VERSION_INFO.versionLabel}
            </span>
          </div>
          <div className="bs">École de char à voile · Plage de Lestrevet</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onOpenExchange && (
            <button
              type="button"
              onClick={onOpenExchange}
              title="Ouvrir le carnet de liaison et d'échange Ben ↔ Jérôme"
              style={{
                background: '#fef3c7',
                border: '1.5px solid #fde68a',
                borderRadius: '8px',
                padding: '6px 11px',
                color: '#92400e',
                fontSize: '0.74rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 2px rgba(217, 119, 6, 0.1)',
              }}
            >
              <span>💬</span>
              <span>Ben ↔ Jérôme</span>
              {unreadExchangeCount > 0 && (
                <span
                  style={{
                    background: '#dc2626',
                    color: '#ffffff',
                    borderRadius: '10px',
                    padding: '1px 6px',
                    fontSize: '0.65rem',
                    fontWeight: 900,
                  }}
                >
                  {unreadExchangeCount}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleInstallClick}
            title="Installer le raccourci « Ça roule ? » sur iPhone ou Android"
            style={{
              background: '#0284c7',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 11px',
              color: '#ffffff',
              fontSize: '0.74rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(2, 132, 199, 0.3)',
            }}
          >
            <span>📲</span>
            <span>Raccourci</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title={`Thème : ${theme === 'dark' ? 'sombre' : 'clair'}`}
            aria-label="Changer de thème"
            style={{
              background: 'var(--cell)',
              border: '1px solid var(--bd)',
              borderRadius: '8px',
              padding: '6px 10px',
              color: 'var(--tx)',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {/* Guide d'installation du raccourci écran d'accueil (Module 5) */}
      {showInstallGuide && (
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
          onClick={() => setShowInstallGuide(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <img
                src="/apple-touch-icon.png"
                alt="Icône Ça roule ?"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '13px',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)',
                  border: '1px solid #cbd5e1',
                }}
              />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                  Raccourci « Ça roule ? »
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Installer sur l'écran d'accueil de votre smartphone
                </p>
              </div>
            </div>

            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px', border: '1px solid #e2e8f0', marginBottom: '16px', fontSize: '0.83rem', lineHeight: 1.55 }}>
              <strong style={{ color: '#0284c7', display: 'block', marginBottom: '6px' }}>
                🍏 Sur iPhone / iPad (Safari) :
              </strong>
              <ol style={{ margin: '0 0 12px 18px', padding: 0 }}>
                <li>Appuyez sur le bouton <strong>Partager</strong> en bas de Safari (icône carré avec une flèche vers le haut ⬆️).</li>
                <li>Faites défiler vers le bas et touchez <strong>« Sur l'écran d'accueil »</strong>.</li>
                <li>Le nom <strong>« Ça roule ? »</strong> et l'icône apparaissent. Touchez <strong>Ajouter</strong> en haut à droite.</li>
              </ol>

              <strong style={{ color: '#0284c7', display: 'block', marginBottom: '6px' }}>
                🤖 Sur Android (Chrome) :
              </strong>
              <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
                <li>Appuyez sur les <strong>3 petits points ⋮</strong> en haut à droite.</li>
                <li>Touchez <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.</li>
              </ol>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowInstallGuide(false)}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '9px 18px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Compris !
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
