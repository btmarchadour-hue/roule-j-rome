import React, { useEffect, useRef, useState } from 'react';
import { AppSettings, TidePoint, WindPoint } from '../types';
import {
  comp,
  getWindguruBg,
  getWindguruGustBg,
  hAt,
  toU,
  WMO,
} from '../utils/tides';

interface WindguruTableProps {
  dateStr: string;
  settings: AppSettings;
  EX: TidePoint[];
  windList: WindPoint[];
}

// Wave height color palette
const getWaveBg = (h: number | null | undefined): { bg: string; text: string } => {
  if (h == null) return { bg: 'transparent', text: 'var(--tx)' };
  if (h < 0.5) return { bg: '#f0fdf4', text: '#166534' }; // Calme (< 0.5m)
  if (h < 1.0) return { bg: '#e0f2fe', text: '#0369a1' }; // Faible (0.5 - 1m)
  if (h < 1.5) return { bg: '#bae6fd', text: '#0284c7' }; // Modéré (1 - 1.5m)
  if (h < 2.0) return { bg: '#7dd3fc', text: '#0369a1' }; // Formé (1.5 - 2m)
  if (h < 2.8) return { bg: '#38bdf8', text: '#0c4a6e' }; // Grosse houle (2 - 2.8m)
  return { bg: '#0284c7', text: '#ffffff' };              // Très forte (> 2.8m)
};

// UV index color palette
const getUvBg = (uv: number | null | undefined): { bg: string; text: string; label: string } => {
  if (uv == null || uv < 0.5) return { bg: 'transparent', text: 'var(--mu)', label: '0' };
  if (uv < 3) return { bg: '#dcfce7', text: '#15803d', label: 'Faible' };
  if (uv < 6) return { bg: '#fef08a', text: '#854d0e', label: 'Modéré' };
  if (uv < 8) return { bg: '#fed7aa', text: '#9a3412', label: 'Fort' };
  if (uv < 11) return { bg: '#fca5a5', text: '#991b1b', label: 'Très fort' };
  return { bg: '#e9d5ff', text: '#6b21a8', label: 'Extrême' };
};

// Cloud layer shading
const getCloudBg = (pct: number | null | undefined): { bg: string; text: string } => {
  if (pct == null) return { bg: 'transparent', text: 'var(--mu)' };
  if (pct < 10) return { bg: 'transparent', text: 'var(--mu)' };
  if (pct < 40) return { bg: 'rgba(148, 163, 184, 0.22)', text: 'var(--tx)' };
  if (pct < 75) return { bg: 'rgba(148, 163, 184, 0.50)', text: 'var(--tx)' };
  return { bg: 'rgba(100, 116, 139, 0.85)', text: '#ffffff' };
};

export const WindguruTable: React.FC<WindguruTableProps> = ({
  dateStr,
  settings,
  EX,
  windList,
}) => {
  const [step, setStep] = useState<1 | 2>(2);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [showExpert, setShowExpert] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const hours =
    step === 1
      ? [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
      : [6, 8, 10, 12, 14, 16, 18, 20, 22];

  const colData = hours.map((h, idx) => {
    const u = toU(y, m, d, h * 60);
    const closest = windList.find(p => Math.abs(p.t - u) < 35);
    const waterLevel = hAt(u, EX);
    const thr = settings.L - (settings.mg || 0) / 100;
    const isUnderThreshold = waterLevel != null && waterLevel <= thr;

    return {
      index: idx,
      hour: h,
      u,
      point: closest,
      waterLevel,
      isUnderThreshold,
    };
  });

  // First hour where sand is uncovered / rolling is possible
  const firstRollingIndex = colData.findIndex(c => c.isUnderThreshold && c.hour >= 8 && c.hour <= 20);

  const scrollToRolling = () => {
    if (!scrollContainerRef.current) return;
    if (firstRollingIndex > 0) {
      // Each column is roughly 50px wide, sticky col is ~115px
      const targetScroll = Math.max(0, (firstRollingIndex - 1) * 52);
      scrollContainerRef.current.scrollTo({ left: targetScroll, behavior: 'smooth' });
    } else {
      scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  };

  // Center on rolling window on date change if on mobile screen
  useEffect(() => {
    if (window.innerWidth < 768 && firstRollingIndex > 0) {
      const timer = setTimeout(() => {
        scrollToRolling();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [dateStr, firstRollingIndex]);

  const hasAnyData = colData.some(c => c.point != null);
  if (!hasAnyData) {
    return (
      <div className="card" style={{ padding: '14px' }}>
        <div className="fh">Tableau météo, vent & houle (modèle Windguru)</div>
        <div className="note">
          Données horaires indisponibles pour cette date (au-delà des 16 jours de prévision ou hors-ligne).
        </div>
      </div>
    );
  }

  const formattedDate = new Date(Date.UTC(y, m, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  // Style for the sticky first column
  const stickyStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    background: 'var(--card)',
    boxShadow: '2px 0 5px rgba(0,0,0,0.08)',
    fontWeight: 800,
    textAlign: 'left',
    padding: '6px 8px',
    whiteSpace: 'nowrap',
    borderRight: '1px solid var(--bd)',
    fontSize: '0.72rem',
    color: 'var(--tx)',
  };

  return (
    <div className="card" style={{ padding: '12px', overflow: 'hidden' }}>
      {/* Top Header Bar with spot info & controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '10px',
        }}
      >
        <div>
          <div className="fh" style={{ margin: 0, fontWeight: 900, color: 'var(--tx)', fontSize: '0.94rem' }}>
            Météo, Vent & Houle · <span style={{ textTransform: 'capitalize' }}>{formattedDate}</span>
          </div>
          <div style={{ fontSize: '0.67rem', color: 'var(--mu)', marginTop: '2px' }}>
            Spot Lestrevet · Modèles AROME & Vagues Marine
          </div>
        </div>

        {/* Toolbar controls */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          {/* View mode toggle: Table vs Mobile Cards */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--cell)',
              borderRadius: '6px',
              padding: '2px',
              border: '1px solid var(--bd)',
            }}
          >
            <button
              type="button"
              style={{
                border: 0,
                background: viewMode === 'table' ? 'var(--card)' : 'transparent',
                color: viewMode === 'table' ? 'var(--tx)' : 'var(--mu)',
                boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                fontWeight: viewMode === 'table' ? 800 : 600,
                fontSize: '0.68rem',
                padding: '4px 8px',
                borderRadius: '5px',
                cursor: 'pointer',
              }}
              onClick={() => setViewMode('table')}
              title="Vue tableau horizontal classique façon Windguru"
            >
              📊 Grille
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: viewMode === 'cards' ? 'var(--card)' : 'transparent',
                color: viewMode === 'cards' ? 'var(--tx)' : 'var(--mu)',
                boxShadow: viewMode === 'cards' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                fontWeight: viewMode === 'cards' ? 800 : 600,
                fontSize: '0.68rem',
                padding: '4px 8px',
                borderRadius: '5px',
                cursor: 'pointer',
              }}
              onClick={() => setViewMode('cards')}
              title="Vue fiches tactiles défilantes optimisée smartphone"
            >
              📱 Fiches
            </button>
          </div>

          {/* Step toggle 2h / 1h */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              className="fbtn"
              style={{
                padding: '3px 7px',
                fontSize: '0.67rem',
                margin: 0,
                background: step === 2 ? 'var(--ac)' : 'var(--cell)',
                color: step === 2 ? '#111' : 'var(--tx)',
                border: '1px solid var(--bd)',
              }}
              onClick={() => setStep(2)}
              title="Affichage par pas de 2h"
            >
              2h
            </button>
            <button
              type="button"
              className="fbtn"
              style={{
                padding: '3px 7px',
                fontSize: '0.67rem',
                margin: 0,
                background: step === 1 ? 'var(--ac)' : 'var(--cell)',
                color: step === 1 ? '#111' : 'var(--tx)',
                border: '1px solid var(--bd)',
              }}
              onClick={() => setStep(1)}
              title="Affichage par pas de 1h"
            >
              1h
            </button>
          </div>

          {/* Quick jump to low tide / rolling button */}
          {firstRollingIndex >= 0 && viewMode === 'table' && (
            <button
              type="button"
              className="fbtn"
              style={{
                padding: '3px 8px',
                fontSize: '0.67rem',
                margin: 0,
                background: 'var(--okbg)',
                color: 'var(--ok)',
                border: '1px solid var(--ok)',
                fontWeight: 800,
              }}
              onClick={scrollToRolling}
              title="Faire défiler le tableau jusqu'au créneau roulable de la basse mer"
            >
              🎯 Roulage ({colData[firstRollingIndex].hour}h)
            </button>
          )}

          {/* Detail level toggle: Essentiel vs Expert */}
          <button
            type="button"
            className="fbtn"
            style={{
              padding: '3px 8px',
              fontSize: '0.67rem',
              margin: 0,
              background: showExpert ? 'var(--ac)' : 'var(--cell)',
              color: showExpert ? '#111' : 'var(--tx)',
              border: '1px solid var(--bd)',
              fontWeight: 700,
            }}
            onClick={() => setShowExpert(!showExpert)}
            title="Afficher/masquer les détails météo avancés (nuages, UV, baromètre)"
          >
            {showExpert ? 'Masquer détails' : '+ Détails experts'}
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODE 1 : VUE TABLEAU AVEC COLONNE DE GAUCHE FIGÉE (STICKY) */}
      {/* ======================================================== */}
      {viewMode === 'table' && (
        <div
          ref={scrollContainerRef}
          className="wrapt"
          style={{
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            position: 'relative',
          }}
        >
          <table
            style={{
              margin: 0,
              width: '100%',
              minWidth: step === 1 ? '740px' : '540px',
              textAlign: 'center',
              fontSize: '0.72rem',
              borderCollapse: 'separate',
              borderSpacing: 0,
            }}
          >
            <tbody>
              {/* LIGNE 1 : HEURE LOCALE */}
              <tr style={{ background: '#0f172a', color: '#f8fafc' }}>
                <td
                  style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 4,
                    background: '#0f172a',
                    color: '#cbd5e1',
                    fontWeight: 900,
                    textAlign: 'left',
                    padding: '7px 8px',
                    fontSize: '0.68rem',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '2px 0 5px rgba(0,0,0,0.25)',
                  }}
                >
                  Heure locale
                </td>
                {colData.map(({ hour, isUnderThreshold }) => (
                  <td
                    key={`h-${hour}`}
                    style={{
                      padding: '7px 3px',
                      fontWeight: 800,
                      minWidth: '38px',
                      background: isUnderThreshold ? 'rgba(34, 197, 94, 0.22)' : 'transparent',
                      color: isUnderThreshold ? '#4ade80' : '#f8fafc',
                      borderBottom: isUnderThreshold ? '2px solid #22c55e' : 'none',
                    }}
                  >
                    {hour}h
                  </td>
                ))}
              </tr>

              {/* LIGNE 2 : VENT (nds) */}
              <tr>
                <td style={stickyStyle}>💨 Vent (nds)</td>
                {colData.map(({ hour, point }) => {
                  if (!point) return <td key={`v-${hour}`}>—</td>;
                  const v = Math.round(point.v);
                  const colors = getWindguruBg(v);
                  return (
                    <td
                      key={`v-${hour}`}
                      style={{
                        background: colors.bg,
                        color: colors.text,
                        fontWeight: 900,
                        fontSize: '0.86rem',
                        padding: '5px 2px',
                        borderBottom: '1px solid var(--bd)',
                      }}
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>

              {/* LIGNE 3 : RAFALES (nds) */}
              <tr>
                <td style={stickyStyle}>⚡ Rafales (nds)</td>
                {colData.map(({ hour, point }) => {
                  if (!point || point.g == null) return <td key={`g-${hour}`} style={{ borderBottom: '1px solid var(--bd)' }}>—</td>;
                  const g = Math.round(point.g);
                  const colors = getWindguruGustBg(g);
                  return (
                    <td
                      key={`g-${hour}`}
                      style={{
                        background: colors.bg,
                        color: colors.text,
                        fontWeight: 800,
                        padding: '4px 2px',
                        borderBottom: '1px solid var(--bd)',
                      }}
                    >
                      {g}
                    </td>
                  );
                })}
              </tr>

              {/* LIGNE 4 : DIRECTION VENT */}
              <tr>
                <td style={stickyStyle}>🧭 Dir. vent</td>
                {colData.map(({ hour, point }) => {
                  if (!point) return <td key={`d-${hour}`} style={{ borderBottom: '1px solid var(--bd)' }}>—</td>;
                  const deg = Math.round(point.a);
                  return (
                    <td key={`d-${hour}`} style={{ padding: '4px 2px', borderBottom: '1px solid var(--bd)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          style={{
                            transform: `rotate(${deg + 180}deg)`,
                            display: 'block',
                          }}
                        >
                          <polygon points="12,2 18,18 12,14 6,18" fill="var(--tx)" />
                        </svg>
                        <span style={{ fontSize: '0.62rem', fontWeight: 800, marginTop: '1px' }}>
                          {comp(deg)}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* LIGNE 5 : HOULE & VAGUES (m) */}
              <tr style={{ borderTop: '2px solid var(--bd)' }}>
                <td style={{ ...stickyStyle, color: '#0284c7' }}>🌊 Houle & Mer</td>
                {colData.map(({ hour, point }) => {
                  const wvh = point?.wvh;
                  const wvp = point?.wvp;
                  if (wvh == null) return <td key={`wvh-${hour}`} style={{ color: 'var(--mu)', borderBottom: '1px solid var(--bd)' }}>—</td>;
                  const c = getWaveBg(wvh);
                  return (
                    <td
                      key={`wvh-${hour}`}
                      style={{
                        background: c.bg,
                        color: c.text,
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        padding: '4px 2px',
                        borderBottom: '1px solid var(--bd)',
                      }}
                    >
                      <div>{wvh.toFixed(1).replace('.', ',')}m</div>
                      {wvp != null && (
                        <span style={{ display: 'block', fontSize: '0.58rem', fontWeight: 700, opacity: 0.9 }}>
                          {Math.round(wvp)}s
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* LIGNE 6 : CIEL & PLUIE */}
              <tr>
                <td style={stickyStyle}>🌤️ Ciel & Pluie</td>
                {colData.map(({ hour, point }) => {
                  if (!point) return <td key={`c-${hour}`} style={{ borderBottom: '1px solid var(--bd)' }}>—</td>;
                  const pr = point.pr || 0;
                  return (
                    <td key={`c-${hour}`} style={{ padding: '3px 2px', borderBottom: '1px solid var(--bd)' }}>
                      <div style={{ fontSize: '1.05rem', lineHeight: 1 }}>{WMO(point.wc)}</div>
                      {pr > 0 ? (
                        <span
                          style={{
                            display: 'inline-block',
                            fontSize: '0.6rem',
                            fontWeight: 800,
                            color: '#0284c7',
                            background: 'rgba(2, 132, 199, 0.14)',
                            padding: '1px 3px',
                            borderRadius: '3px',
                            marginTop: '2px',
                          }}
                        >
                          {pr.toFixed(1).replace('.', ',')}mm
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.58rem', color: 'var(--mu)' }}>
                          {point.cc != null ? `${Math.round(point.cc)}%` : '0 mm'}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* LIGNE 7 : TEMPÉRATURE (°C) */}
              <tr>
                <td style={stickyStyle}>🌡️ Temp. (°C)</td>
                {colData.map(({ hour, point }) => {
                  if (!point || point.tp == null) return <td key={`t-${hour}`} style={{ borderBottom: '1px solid var(--bd)' }}>—</td>;
                  return (
                    <td key={`t-${hour}`} style={{ padding: '4px 2px', fontWeight: 700, borderBottom: '1px solid var(--bd)' }}>
                      {Math.round(point.tp)}°
                    </td>
                  );
                })}
              </tr>

              {/* LIGNE 8 : MARÉE & ROULABILITÉ CHAR À VOILE */}
              <tr style={{ borderTop: '2px solid var(--bd)' }}>
                <td style={{ ...stickyStyle, color: 'var(--tx)', fontWeight: 900 }}>🏁 Roulage Plage</td>
                {colData.map(({ hour, waterLevel, isUnderThreshold }) => {
                  if (waterLevel == null) return <td key={`wl-${hour}`} style={{ borderBottom: '1px solid var(--bd)' }}>—</td>;
                  return (
                    <td
                      key={`wl-${hour}`}
                      style={{
                        padding: '4px 2px',
                        fontWeight: 800,
                        background: isUnderThreshold ? 'var(--okbg)' : 'transparent',
                        color: isUnderThreshold ? 'var(--ok)' : 'var(--mu)',
                        borderBottom: '1px solid var(--bd)',
                      }}
                      title={
                        isUnderThreshold
                          ? 'Sous le seuil (plage praticable char à voile)'
                          : 'Au-dessus du seuil (marée haute)'
                      }
                    >
                      <div style={{ fontSize: '0.74rem' }}>{waterLevel.toFixed(2).replace('.', ',')}m</div>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.56rem',
                          fontWeight: 900,
                          textTransform: 'uppercase',
                          marginTop: '2px',
                          padding: '1px 3px',
                          borderRadius: '3px',
                          background: isUnderThreshold ? 'var(--ok)' : 'transparent',
                          color: isUnderThreshold ? '#fff' : 'var(--mu)',
                        }}
                      >
                        {isUnderThreshold ? 'Roulable' : 'Pleine mer'}
                      </span>
                    </td>
                  );
                })}
              </tr>

              {/* ============================================== */}
              {/* LIGNES EXPERTES (Dépliables pour ne pas surcharger) */}
              {/* ============================================== */}
              {showExpert && (
                <>
                  {/* Période précise houle */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={stickyStyle}>⏱️ Période vagues</td>
                    {colData.map(({ hour, point }) => {
                      const wvp = point?.wvp;
                      if (wvp == null) return <td key={`wvp2-${hour}`}>—</td>;
                      return (
                        <td key={`wvp2-${hour}`} style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 2px' }}>
                          {Math.round(wvp)}s
                        </td>
                      );
                    })}
                  </tr>

                  {/* Direction houle */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={stickyStyle}>📐 Dir. vagues</td>
                    {colData.map(({ hour, point }) => {
                      const wvd = point?.wvd;
                      if (wvd == null) return <td key={`wvd2-${hour}`}>—</td>;
                      const deg = Math.round(wvd);
                      return (
                        <td key={`wvd2-${hour}`} style={{ padding: '3px 2px' }}>
                          <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#0284c7' }}>
                            {comp(deg)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Nuages hauts */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={{ ...stickyStyle, fontSize: '0.67rem', color: 'var(--mu)' }}>☁️ Nuages hauts (%)</td>
                    {colData.map(({ hour, point }) => {
                      const cch = point?.cch;
                      if (cch == null) return <td key={`cch-${hour}`}>—</td>;
                      const st = getCloudBg(cch);
                      return (
                        <td key={`cch-${hour}`} style={{ background: st.bg, color: st.text, fontSize: '0.65rem', padding: '2px' }}>
                          {Math.round(cch)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Nuages moyens */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={{ ...stickyStyle, fontSize: '0.67rem', color: 'var(--mu)' }}>☁️ Nuages moyens (%)</td>
                    {colData.map(({ hour, point }) => {
                      const ccm = point?.ccm;
                      if (ccm == null) return <td key={`ccm-${hour}`}>—</td>;
                      const st = getCloudBg(ccm);
                      return (
                        <td key={`ccm-${hour}`} style={{ background: st.bg, color: st.text, fontSize: '0.65rem', padding: '2px' }}>
                          {Math.round(ccm)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Nuages bas */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={{ ...stickyStyle, fontSize: '0.67rem', color: 'var(--mu)' }}>☁️ Nuages bas (%)</td>
                    {colData.map(({ hour, point }) => {
                      const ccl = point?.ccl;
                      if (ccl == null) return <td key={`ccl-${hour}`}>—</td>;
                      const st = getCloudBg(ccl);
                      return (
                        <td key={`ccl-${hour}`} style={{ background: st.bg, color: st.text, fontSize: '0.65rem', padding: '2px' }}>
                          {Math.round(ccl)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Rayonnement solaire W/m² */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={{ ...stickyStyle, color: '#ca8a04' }}>☀️ Rayonnement W/m²</td>
                    {colData.map(({ hour, point }) => {
                      const rad = point?.rad;
                      if (rad == null) return <td key={`rad-${hour}`}>—</td>;
                      const r = Math.round(rad);
                      return (
                        <td key={`rad-${hour}`} style={{ fontSize: '0.66rem', fontWeight: r > 250 ? 800 : 500, padding: '2px' }}>
                          {r}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Indice UV */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={stickyStyle}>🔆 Indice UV</td>
                    {colData.map(({ hour, point }) => {
                      const uv = point?.uv;
                      if (uv == null) return <td key={`uv-${hour}`}>—</td>;
                      const uInfo = getUvBg(uv);
                      return (
                        <td key={`uv-${hour}`} style={{ padding: '2px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontSize: '0.6rem',
                              fontWeight: 800,
                              background: uInfo.bg,
                              color: uInfo.text,
                            }}
                          >
                            {uv >= 0.5 ? uv.toFixed(1).replace('.', ',') : '0'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Pression Barométrique */}
                  <tr style={{ background: 'var(--cell)' }}>
                    <td style={stickyStyle}>Baromètre (hPa)</td>
                    {colData.map(({ hour, point }) => {
                      if (!point || point.p == null) return <td key={`p-${hour}`}>—</td>;
                      return (
                        <td key={`p-${hour}`} style={{ fontSize: '0.64rem', color: 'var(--mu)', padding: '2px' }}>
                          {Math.round(point.p)}
                        </td>
                      );
                    })}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODE 2 : VUE FICHES TACTILES HORAIRES (Spécial Smartphone) */}
      {/* ======================================================== */}
      {viewMode === 'cards' && (
        <div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
              paddingBottom: '8px',
              WebkitOverflowScrolling: 'touch',
              scrollSnapType: 'x mandatory',
            }}
          >
            {colData.map(({ hour, point, waterLevel, isUnderThreshold }) => {
              const v = point ? Math.round(point.v) : null;
              const g = point?.g ? Math.round(point.g) : null;
              const deg = point ? Math.round(point.a) : null;
              const wvh = point?.wvh;
              const vColors = v != null ? getWindguruBg(v) : { bg: '#f1f5f9', text: '#334155' };

              return (
                <div
                  key={`card-${hour}`}
                  style={{
                    flex: '0 0 115px',
                    scrollSnapAlign: 'start',
                    background: isUnderThreshold ? 'var(--okbg)' : 'var(--cell)',
                    border: `1.5px solid ${isUnderThreshold ? 'var(--ok)' : 'var(--bd)'}`,
                    borderRadius: '10px',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    textAlign: 'center',
                    boxShadow: isUnderThreshold ? '0 2px 6px rgba(34, 197, 94, 0.15)' : 'none',
                  }}
                >
                  {/* Heure & Roulabilité */}
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid var(--bd)',
                      paddingBottom: '4px',
                    }}
                  >
                    <span style={{ fontWeight: 900, fontSize: '0.86rem', color: 'var(--tx)' }}>
                      {hour}h00
                    </span>
                    <span
                      style={{
                        fontSize: '0.54rem',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        background: isUnderThreshold ? 'var(--ok)' : 'var(--mu)',
                        color: '#fff',
                      }}
                    >
                      {isUnderThreshold ? 'Roulable' : 'Pleine mer'}
                    </span>
                  </div>

                  {/* Grand bloc vent Windguru */}
                  <div
                    style={{
                      width: '100%',
                      background: vColors.bg,
                      color: vColors.text,
                      borderRadius: '6px',
                      padding: '4px 2px',
                      margin: '2px 0',
                    }}
                  >
                    <div style={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1 }}>
                      {v != null ? v : '—'}
                    </div>
                    <div style={{ fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase' }}>
                      noeuds
                    </div>
                  </div>

                  {/* Rafales */}
                  {g != null && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--tx)' }}>
                      Rafales : <b style={{ color: '#dc2626' }}>{g} nds</b>
                    </div>
                  )}

                  {/* Direction vent */}
                  {deg != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.66rem', fontWeight: 800 }}>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        style={{ transform: `rotate(${deg + 180}deg)` }}
                      >
                        <polygon points="12,2 18,18 12,14 6,18" fill="var(--tx)" />
                      </svg>
                      <span>{comp(deg)}</span>
                    </div>
                  )}

                  {/* Houle / Vagues */}
                  {wvh != null && (
                    <div
                      style={{
                        width: '100%',
                        background: 'rgba(2, 132, 199, 0.1)',
                        color: '#0284c7',
                        borderRadius: '5px',
                        padding: '2px 4px',
                        fontSize: '0.65rem',
                        fontWeight: 800,
                      }}
                    >
                      🌊 {wvh.toFixed(1).replace('.', ',')}m {point?.wvp ? `(${Math.round(point.wvp)}s)` : ''}
                    </div>
                  )}

                  {/* Temps & Pluie */}
                  {point && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem' }}>
                      <span>{WMO(point.wc)}</span>
                      <span style={{ fontWeight: 700 }}>{point.tp != null ? `${Math.round(point.tp)}°` : ''}</span>
                      {point.pr && point.pr > 0 ? (
                        <span style={{ color: '#0284c7', fontWeight: 800, fontSize: '0.6rem' }}>
                          💧{point.pr.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                  )}

                  {/* Hauteur d'eau */}
                  {waterLevel != null && (
                    <div style={{ fontSize: '0.62rem', color: isUnderThreshold ? 'var(--ok)' : 'var(--mu)', fontWeight: 700 }}>
                      Marée : {waterLevel.toFixed(2).replace('.', ',')}m
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--mu)', marginTop: '4px' }}>
            👈 Faites glisser horizontalement pour voir toutes les heures de la journée 👉
          </div>
        </div>
      )}

      {/* Légendes & repères discrets */}
      <div
        className="note"
        style={{
          marginTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          fontSize: '0.66rem',
          lineHeight: 1.35,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <span>
            <b>Vent :</b>{' '}
            <span style={{ background: '#bbf7d0', padding: '1px 4px', borderRadius: '3px', color: '#14532d' }}>8–15 nds (top)</span>{' '}
            <span style={{ background: '#fef08a', padding: '1px 4px', borderRadius: '3px', color: '#713f12' }}>16–21 nds</span>{' '}
            <span style={{ background: '#fed7aa', padding: '1px 4px', borderRadius: '3px', color: '#7c2d12' }}>22–27 nds</span>{' '}
            <span style={{ background: '#fca5a5', padding: '1px 4px', borderRadius: '3px', color: '#7f1d1d' }}>28+ nds</span>
          </span>
          <span>
            <b>Houle :</b>{' '}
            <span style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px', color: '#0369a1' }}>&lt;1m (calme)</span>{' '}
            <span style={{ background: '#bae6fd', padding: '1px 4px', borderRadius: '3px', color: '#0284c7' }}>1–1.5m</span>{' '}
            <span style={{ background: '#38bdf8', padding: '1px 4px', borderRadius: '3px', color: '#0c4a6e' }}>2m+</span>
          </span>
        </div>
      </div>
    </div>
  );
};
