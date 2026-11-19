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

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  }

  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && 'ontouchend' in document)) {
      setPlatform('ios');
    } else if (/android/.test(ua)) {
      setPlatform('android');
    } else {
      setPlatform('desktop');
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowInstallGuide(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        return;
      }
    }
    setLinkCopied(false);
    setShowInstallGuide(true);
  };

  const handleCopyAppUrl = async () => {
    const url = window.location.origin + '/';
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch {
      // Fallback textarea si clipboard API bloquée dans un iframe
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 3000);
      } catch {
        // ignore
      }
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
              <span className="header-btn-text">Ben ↔ Jérôme</span>
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

          {!isInstalled && (
            <button
              type="button"
              onClick={handleInstallClick}
              title={
                deferredPrompt
                  ? 'Installer directement l’application « Ça roule ? » en 1 clic'
                  : 'Installer le raccourci « Ça roule ? » sur iPhone, Android ou PC'
              }
              style={{
                background: deferredPrompt ? '#0f766e' : '#0284c7',
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
              <span className="header-btn-text">{deferredPrompt ? 'Installer l’app' : 'Raccourci'}</span>
            </button>
          )}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
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
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: '#0f172a' }}>
                  Installer « Ça roule ? »
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  Accès plein écran depuis l&apos;écran d&apos;accueil (smartphone ou ordinateur)
                </p>
              </div>
            </div>

            {isInIframe && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1.5px solid #fcd34d',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  fontSize: '0.78rem',
                  color: '#92400e',
                  lineHeight: 1.45,
                }}
              >
                <strong>⚠️ Vous êtes actuellement dans un aperçu intégré :</strong> le bouton d&apos;installation du navigateur ne peut pas apparaître ici. Copiez le lien direct ci-dessous et ouvrez-le directement dans <strong>Safari</strong> (iPhone) ou <strong>Chrome / Edge</strong> (Android / PC).
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px 10px',
                marginBottom: '14px',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: '0.73rem',
                  fontFamily: 'monospace',
                  color: '#334155',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {typeof window !== 'undefined' ? `${window.location.origin}/` : ''}
              </span>
              <button
                type="button"
                onClick={handleCopyAppUrl}
                style={{
                  background: linkCopied ? '#16a34a' : '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.73rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {linkCopied ? '✓ Lien copié !' : '📋 Copier le lien'}
              </button>
            </div>

            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px', border: '1px solid #e2e8f0', marginBottom: '16px', fontSize: '0.80rem', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ order: platform === 'ios' ? 0 : 1 }}>
                <strong style={{ color: '#0284c7', display: 'block', marginBottom: '4px' }}>
                  🍏 Sur iPhone / iPad (obligatoirement dans Safari) :
                </strong>
                <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
                  <li>Ouvrez le lien direct dans <strong>Safari</strong> (pas dans Chrome ni dans un aperçu mail/WhatsApp).</li>
                  <li>Touchez le bouton <strong>Partager</strong> (carré avec une flèche vers le haut ⬆️, en bas de l&apos;écran).</li>
                  <li>Descendez (ou touchez <em>Plus</em>) puis choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong> → <strong>Ajouter</strong>.</li>
                </ol>
              </div>

              <div style={{ order: platform === 'android' ? 0 : 2 }}>
                <strong style={{ color: '#0284c7', display: 'block', marginBottom: '4px' }}>
                  🤖 Sur Android (Chrome) :
                </strong>
                <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
                  <li>Ouvrez le lien direct dans <strong>Google Chrome</strong>.</li>
                  <li>Touchez les <strong>3 points ⋮</strong> en haut à droite → <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong> → <strong>Installer</strong>.</li>
                </ol>
              </div>

              <div style={{ order: platform === 'desktop' ? 0 : 3 }}>
                <strong style={{ color: '#0284c7', display: 'block', marginBottom: '4px' }}>
                  💻 Sur ordinateur (Chrome ou Edge) :
                </strong>
                <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
                  <li>Ouvrez le lien direct dans un onglet <strong>Chrome</strong> ou <strong>Edge</strong>.</li>
                  <li>Cliquez sur l&apos;icône <strong>Installer</strong> (écran avec une flèche ⬇️) à droite de la barre d&apos;adresse, ou menu <strong>⋮ → Enregistrer et partager → Installer la page en tant qu&apos;application</strong>.</li>
                </ol>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  style={{
                    background: '#0f766e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '9px 16px',
                    fontWeight: 800,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  📲 Installer maintenant
                </button>
              )}
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
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
