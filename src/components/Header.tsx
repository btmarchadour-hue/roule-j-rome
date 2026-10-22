import React, { useEffect, useState } from 'react';

export const Header: React.FC = () => {
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');

  useEffect(() => {
    const saved = localStorage.getItem('cvTheme') as 'auto' | 'light' | 'dark' | null;
    if (saved) {
      setTheme(saved);
      if (saved === 'auto') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', saved);
      }
    }
  }, []);

  const toggleTheme = () => {
    let next: 'auto' | 'light' | 'dark' = 'auto';
    if (theme === 'auto') next = 'light';
    else if (theme === 'light') next = 'dark';
    else next = 'auto';

    setTheme(next);
    localStorage.setItem('cvTheme', next);
    if (next === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', next);
    }
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
        <div className="bt">Char à Voile du Bout du Monde</div>
        <div className="bs">École de char à voile · Plage de Lestrevet</div>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        title={`Thème : ${theme === 'auto' ? 'système' : theme === 'dark' ? 'sombre' : 'clair'}`}
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
        {theme === 'auto' ? '🌓 Auto' : theme === 'dark' ? '🌙 Sombre' : '☀️ Clair'}
      </button>
    </header>
  );
};
