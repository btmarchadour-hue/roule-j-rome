import React, { useEffect, useState } from 'react';
import { APP_VERSION_INFO } from '../version';

export const Header: React.FC = () => {
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

  return (
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
        {theme === 'dark' ? '🌙 Sombre' : '☀️ Clair'}
      </button>
    </header>
  );
};
