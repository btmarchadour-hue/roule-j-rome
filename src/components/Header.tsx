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
  const [selectedGuideTab, setSelectedGuideTab] = useState<'android' | 'ios' | 'desktop'>('android');
  const [isIOSNonSafari, setIsIOSNonSafari] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
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
    const detectedIOS =
      /iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && 'ontouchend' in document);
    const detectedAndroid = /android/.test(ua);
    const detectedPlatform: 'ios' | 'android' | 'desktop' = detectedIOS
      ? 'ios'
      : detectedAndroid
      ? 'android'
      : 'desktop';
    setPlatform(detectedPlatform);
    setSelectedGuideTab(detectedPlatform);

    // Détection navigateur intégré (WhatsApp, Facebook, Instagram, Gmail/Google App...) ou Chrome/Firefox sur iOS
    const inApp = /fban|fbav|instagram|whatsapp|line|wv\)|gsa\/|mail|snapchat|linkedin/.test(ua);
    setIsInAppBrowser(inApp);
    if (detectedIOS) {
      const nonSafari = /crios|fxios|edgios|opios/.test(ua) || inApp || !/safari/.test(ua);
      setIsIOSNonSafari(nonSafari);
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
    setSelectedGuideTab(platform);
    setShowInstallGuide(true);
  };

  const getAppBaseUrl = (): string => {
    if (typeof window === 'undefined') return '';
    const { origin, pathname } = window.location;
    const cleanPath = pathname.replace(/\/index\.html$/i, '/');
    const normalizedPath = cleanPath.endsWith('/') ? cleanPath : `${cleanPath}/`;
    return `${origin}${normalizedPath}`;
  };

  const handleCopyAppUrl = async () => {
    const url = getAppBaseUrl();
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

  const handleShareAppUrl = async () => {
    const url = getAppBaseUrl();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Ça roule ? – Horaires de roulage',
          text: 'Lien direct pour installer le raccourci Ça roule ? sur écran d’accueil :',
          url,
        });
      } catch {
        // Annulé par l'utilisateur
      }
    }
  };

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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
            padding: '12px',
          }}
          onClick={() => setShowInstallGuide(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              maxWidth: '480px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <img
                src="./apple-touch-icon.png"
                alt="Icône Ça roule ?"
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)',
                  border: '1px solid #cbd5e1',
                  flexShrink: 0,
                }}
              />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.04rem', fontWeight: 800, color: '#0f172a' }}>
                  Installer « Ça roule ? » sur l&apos;écran d&apos;accueil
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: '#64748b' }}>
                  Accès direct plein écran depuis votre téléphone ou ordinateur
                </p>
              </div>
            </div>

            {deferredPrompt && (
              <button
                type="button"
                onClick={handleInstallClick}
                style={{
                  width: '100%',
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '11px 16px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  marginBottom: '12px',
                  boxShadow: '0 2px 6px rgba(15, 118, 110, 0.3)',
                }}
              >
                📲 Installer l&apos;application directement (1 clic)
              </button>
            )}

            {isInIframe && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1.5px solid #fcd34d',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  fontSize: '0.77rem',
                  color: '#92400e',
                  lineHeight: 1.45,
                }}
              >
                <strong>⚠️ Vous êtes dans un aperçu intégré :</strong> l&apos;installation ne fonctionne pas ici. Copiez le lien direct ci-dessous puis ouvrez-le directement dans <strong>Chrome</strong> (Android) ou <strong>Safari</strong> (iPhone).
              </div>
            )}

            {!isInIframe && isInAppBrowser && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1.5px solid #fcd34d',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  fontSize: '0.77rem',
                  color: '#92400e',
                  lineHeight: 1.45,
                }}
              >
                <strong>⚠️ Navigateur intégré détecté (WhatsApp / Mail / appli) :</strong> l&apos;option d&apos;installation est bloquée ici. Copiez le lien ci-dessous et collez-le directement dans <strong>{platform === 'ios' ? 'Safari' : 'Google Chrome'}</strong>.
              </div>
            )}

            {!isInIframe && !isInAppBrowser && isIOSNonSafari && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1.5px solid #fca5a5',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  fontSize: '0.77rem',
                  color: '#991b1b',
                  lineHeight: 1.45,
                }}
              >
                <strong>⚠️ Vous n&apos;êtes pas dans Safari sur iPhone :</strong> copiez le lien ci-dessous et ouvrez-le dans <strong>Safari</strong> (icône boussole bleue) pour créer un vrai raccourci plein écran.
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '7px 9px',
                marginBottom: '12px',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: '0.71rem',
                  fontFamily: 'monospace',
                  color: '#334155',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getAppBaseUrl()}
              </span>
              <button
                type="button"
                onClick={handleCopyAppUrl}
                style={{
                  background: linkCopied ? '#16a34a' : '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 9px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {linkCopied ? '✓ Copié !' : '📋 Copier'}
              </button>
              {canNativeShare && (
                <button
                  type="button"
                  onClick={handleShareAppUrl}
                  style={{
                    background: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '5px 9px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  📤 Partager
                </button>
              )}
            </div>

            {/* Sélecteur d'appareil */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '6px',
                marginBottom: '12px',
              }}
            >
              {(
                [
                  { id: 'android', label: '🤖 Android' },
                  { id: 'ios', label: '🍏 iPhone / iPad' },
                  { id: 'desktop', label: '💻 PC / Mac' },
                ] as const
              ).map(tab => {
                const active = selectedGuideTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedGuideTab(tab.id)}
                    style={{
                      padding: '8px 6px',
                      borderRadius: '8px',
                      border: active ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      background: active ? '#e0f2fe' : '#f8fafc',
                      color: active ? '#0369a1' : '#475569',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                background: '#f8fafc',
                borderRadius: '10px',
                padding: '14px',
                border: '1px solid #e2e8f0',
                marginBottom: '14px',
                fontSize: '0.80rem',
                lineHeight: 1.55,
              }}
            >
              {selectedGuideTab === 'android' && (
                <div>
                  <strong style={{ color: '#0284c7', display: 'block', marginBottom: '6px' }}>
                    🤖 Sur Samsung / Android (Google Chrome) :
                  </strong>
                  <ol style={{ margin: '0 0 10px 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <li>
                      Ouvrez le lien direct dans <strong>Google Chrome</strong>.
                    </li>
                    <li>
                      Touchez les <strong>3 points ⋮</strong> tout en haut à droite.
                    </li>
                    <li>
                      <strong>⬇️ Faites défiler ce menu vers le bas avec le doigt</strong> <em>(il est long : descendez sous « Traduire », « Écouter cette page » et « Mode Lecture »)</em>.
                    </li>
                    <li>
                      Touchez <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong> <em>(ou <strong>« Installer l&apos;application »</strong>)</em> → puis <strong>Installer</strong> <em>(ou <strong>Créer un raccourci</strong>)</em>.
                    </li>
                  </ol>
                  <div
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      fontSize: '0.74rem',
                      color: '#1e3a8a',
                    }}
                  >
                    <strong>💡 Si vous aviez déjà un ancien raccourci :</strong> supprimez l&apos;ancienne icône sur votre écran d&apos;accueil, rechargez la page dans Chrome, puis recommencez.
                    <br />
                    <strong>Samsung Internet</strong> (planète violette) : menu <strong>≡</strong> en bas à droite → <strong>+ Ajouter la page à</strong> → <strong>Écran d&apos;accueil</strong>.
                  </div>
                </div>
              )}

              {selectedGuideTab === 'ios' && (
                <div>
                  <strong style={{ color: '#0284c7', display: 'block', marginBottom: '6px' }}>
                    🍏 Sur iPhone / iPad (obligatoirement dans Safari) :
                  </strong>
                  <ol style={{ margin: '0 0 10px 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <li>
                      Copiez le lien ci-dessus et ouvrez-le dans <strong>Safari</strong> <em>(boussole bleue — pas depuis l&apos;aperçu WhatsApp, SMS ou Mail)</em>.
                    </li>
                    <li>
                      Touchez le bouton <strong>Partager</strong> (carré avec une flèche vers le haut <strong>⬆️</strong> en bas de l&apos;écran). <em>Sur iOS récent, s&apos;il n&apos;est pas visible directement, touchez d&apos;abord les <strong>3 points ⋯</strong> en bas à droite puis <strong>Partager</strong>.</em>
                    </li>
                    <li>
                      <strong>⬇️ Faites défiler la liste vers le bas</strong> <em>(sous AirDrop et les contacts, puis touchez <strong>Plus</strong> si nécessaire)</em> et choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong> (icône <strong>+</strong>).
                    </li>
                    <li>
                      Laissez <strong>« Ouvrir en tant qu&apos;app web »</strong> activé (si proposé), puis touchez <strong>Ajouter</strong> en haut à droite.
                    </li>
                  </ol>
                  <div
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      fontSize: '0.74rem',
                      color: '#1e3a8a',
                    }}
                  >
                    <strong>💡 Astuce Chrome sur iPhone :</strong> si vous êtes dans Chrome iOS, l&apos;icône <strong>Partager ⬆️</strong> est <strong>en haut à droite dans la barre d&apos;adresse</strong> (puis descendre sur <strong>« Sur l&apos;écran d&apos;accueil »</strong>). Safari reste cependant recommandé pour l&apos;affichage plein écran.
                  </div>
                </div>
              )}

              {selectedGuideTab === 'desktop' && (
                <div>
                  <strong style={{ color: '#0284c7', display: 'block', marginBottom: '6px' }}>
                    💻 Sur ordinateur (Chrome, Edge ou Safari Mac) :
                  </strong>
                  <ol style={{ margin: '0 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <li>
                      Ouvrez le lien direct dans un onglet <strong>Chrome</strong> ou <strong>Edge</strong>.
                    </li>
                    <li>
                      Cliquez sur l&apos;icône <strong>Installer</strong> (écran avec flèche ⬇️) à droite de la barre d&apos;adresse, ou ouvrez le menu <strong>⋮ → Caster, enregistrer et partager → Installer la page en tant qu&apos;application</strong>.
                    </li>
                    <li>
                      <em>Sur Mac (Safari) :</em> menu <strong>Fichier → Ajouter au Dock…</strong>.
                    </li>
                  </ol>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
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
