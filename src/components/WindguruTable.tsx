import React, { useState } from 'react';
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
  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const hours =
    step === 1
      ? [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
      : [6, 8, 10, 12, 14, 16, 18, 20, 22];

  const colData = hours.map((h) => {
    const u = toU(y, m, d, h * 60);
    const closest = windList.find(p => Math.abs(p.t - u) < 35);
    const waterLevel = hAt(u, EX);
    const thr = settings.L - (settings.mg || 0) / 100;
    const isUnderThreshold = waterLevel != null && waterLevel <= thr;

    return {
      hour: h,
      u,
      point: closest,
      waterLevel,
      isUnderThreshold,
    };
  });

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

  return (
    <div className="card" style={{ padding: '14px', overflow: 'hidden' }}>
      {/* Header bar with spot info & step toggle */}
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
          <div className="fh" style={{ margin: 0, fontWeight: 900, color: 'var(--tx)', fontSize: '0.92rem' }}>
            Tableau Météo, Vent & Houle · <span style={{ textTransform: 'capitalize' }}>{formattedDate}</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--mu)', marginTop: '2px' }}>
            Modèle AROME (Météo-France) & Global HD + Modèle Vagues Marine Open-Meteo · Spot Lestrevet
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--mu)', fontWeight: 600 }}>Pas :</span>
          <button
            type="button"
            className="fbtn"
            style={{
              padding: '3px 8px',
              fontSize: '0.68rem',
              margin: 0,
              background: step === 2 ? 'var(--ac)' : 'var(--cell)',
              color: step === 2 ? '#111' : 'var(--tx)',
              border: '1px solid var(--bd)',
            }}
            onClick={() => setStep(2)}
            title="Affichage 2h (rapide et compact)"
          >
            2 heures
          </button>
          <button
            type="button"
            className="fbtn"
            style={{
              padding: '3px 8px',
              fontSize: '0.68rem',
              margin: 0,
              background: step === 1 ? 'var(--ac)' : 'var(--cell)',
              color: step === 1 ? '#111' : 'var(--tx)',
              border: '1px solid var(--bd)',
            }}
            onClick={() => setStep(1)}
            title="Affichage 1h (détaillé heure par heure)"
          >
            1 heure
          </button>
        </div>
      </div>

      <div className="wrapt" style={{ border: '1px solid var(--bd)', borderRadius: '8px', overflowX: 'auto' }}>
        <table
          style={{
            margin: 0,
            width: '100%',
            minWidth: step === 1 ? '720px' : '560px',
            textAlign: 'center',
            fontSize: '0.72rem',
            borderCollapse: 'collapse',
          }}
        >
          <tbody>
            {/* Heure locale */}
            <tr style={{ background: '#1e293b', color: '#f8fafc' }}>
              <td
                style={{
                  fontWeight: 900,
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: '#0f172a',
                  color: '#94a3b8',
                  fontSize: '0.68rem',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                Heure locale
              </td>
              {colData.map(({ hour }) => (
                <td key={`h-${hour}`} style={{ padding: '6px 3px', fontWeight: 800, minWidth: '34px' }}>
                  {hour}h
                </td>
              ))}
            </tr>

            {/* SECTEUR VENT */}
            {/* Vitesse du vent (nds) */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                💨 Vent (nds)
              </td>
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
                      fontSize: '0.84rem',
                      padding: '5px 2px',
                    }}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>

            {/* Rafales (nds) */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                ⚡ Rafales (nds)
              </td>
              {colData.map(({ hour, point }) => {
                if (!point || point.g == null) return <td key={`g-${hour}`}>—</td>;
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
                    }}
                  >
                    {g}
                  </td>
                );
              })}
            </tr>

            {/* Direction du vent */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                🧭 Dir. vent
              </td>
              {colData.map(({ hour, point }) => {
                if (!point) return <td key={`d-${hour}`}>—</td>;
                const deg = Math.round(point.a);
                return (
                  <td key={`d-${hour}`} style={{ padding: '4px 2px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        style={{
                          transform: `rotate(${deg + 180}deg)`,
                          display: 'block',
                        }}
                      >
                        <polygon points="12,2 18,18 12,14 6,18" fill="var(--tx)" />
                      </svg>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, marginTop: '2px' }}>
                        {comp(deg)}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>

            {/* SECTEUR HOULE & MER (Enrichissement Windguru) */}
            {/* Hauteur vagues / houle (m) */}
            <tr style={{ borderTop: '2px solid var(--bd)' }}>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: '#0284c7',
                  whiteSpace: 'nowrap',
                }}
              >
                🌊 Vagues / Houle (m)
              </td>
              {colData.map(({ hour, point }) => {
                const wvh = point?.wvh;
                if (wvh == null) return <td key={`wvh-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const c = getWaveBg(wvh);
                return (
                  <td
                    key={`wvh-${hour}`}
                    style={{
                      background: c.bg,
                      color: c.text,
                      fontWeight: 800,
                      fontSize: '0.8rem',
                      padding: '5px 2px',
                    }}
                  >
                    {wvh.toFixed(1).replace('.', ',')}
                  </td>
                );
              })}
            </tr>

            {/* Période des vagues (s) */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                ⏱️ Période vagues (s)
              </td>
              {colData.map(({ hour, point }) => {
                const wvp = point?.wvp;
                if (wvp == null) return <td key={`wvp-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const isGroundswell = wvp >= 9.5;
                return (
                  <td
                    key={`wvp-${hour}`}
                    style={{
                      padding: '4px 2px',
                      fontWeight: isGroundswell ? 800 : 600,
                      color: isGroundswell ? '#0284c7' : 'var(--tx)',
                    }}
                    title={isGroundswell ? 'Houle longue / puissante' : 'Période de houle'}
                  >
                    {Math.round(wvp)}s
                  </td>
                );
              })}
            </tr>

            {/* Direction des vagues */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                📐 Dir. vagues
              </td>
              {colData.map(({ hour, point }) => {
                const wvd = point?.wvd;
                if (wvd == null) return <td key={`wvd-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const deg = Math.round(wvd);
                return (
                  <td key={`wvd-${hour}`} style={{ padding: '4px 2px' }}>
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
                        <path
                          d="M12 2L4 14h5v8h6v-8h5z"
                          fill="#0284c7"
                        />
                      </svg>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, marginTop: '2px', color: '#0284c7' }}>
                        {comp(deg)}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>

            {/* SECTEUR NUAGEUX & LUMINOSITÉ (Signature Windguru) */}
            {/* Nuages hauts (%) */}
            <tr style={{ borderTop: '2px solid var(--bd)' }}>
              <td
                style={{
                  fontWeight: 700,
                  textAlign: 'left',
                  padding: '4px 8px',
                  background: 'var(--cell)',
                  color: 'var(--mu)',
                  fontSize: '0.67rem',
                  whiteSpace: 'nowrap',
                }}
              >
                ☁️ Nuages hauts (%)
              </td>
              {colData.map(({ hour, point }) => {
                const cch = point?.cch;
                if (cch == null) return <td key={`cch-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const style = getCloudBg(cch);
                return (
                  <td
                    key={`cch-${hour}`}
                    style={{
                      background: style.bg,
                      color: style.text,
                      fontSize: '0.67rem',
                      fontWeight: 600,
                      padding: '3px 2px',
                    }}
                  >
                    {Math.round(cch)}
                  </td>
                );
              })}
            </tr>

            {/* Nuages moyens (%) */}
            <tr>
              <td
                style={{
                  fontWeight: 700,
                  textAlign: 'left',
                  padding: '4px 8px',
                  background: 'var(--cell)',
                  color: 'var(--mu)',
                  fontSize: '0.67rem',
                  whiteSpace: 'nowrap',
                }}
              >
                ☁️ Nuages moyens (%)
              </td>
              {colData.map(({ hour, point }) => {
                const ccm = point?.ccm;
                if (ccm == null) return <td key={`ccm-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const style = getCloudBg(ccm);
                return (
                  <td
                    key={`ccm-${hour}`}
                    style={{
                      background: style.bg,
                      color: style.text,
                      fontSize: '0.67rem',
                      fontWeight: 600,
                      padding: '3px 2px',
                    }}
                  >
                    {Math.round(ccm)}
                  </td>
                );
              })}
            </tr>

            {/* Nuages bas (%) */}
            <tr>
              <td
                style={{
                  fontWeight: 700,
                  textAlign: 'left',
                  padding: '4px 8px',
                  background: 'var(--cell)',
                  color: 'var(--mu)',
                  fontSize: '0.67rem',
                  whiteSpace: 'nowrap',
                }}
              >
                ☁️ Nuages bas (%)
              </td>
              {colData.map(({ hour, point }) => {
                const ccl = point?.ccl;
                if (ccl == null) return <td key={`ccl-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const style = getCloudBg(ccl);
                return (
                  <td
                    key={`ccl-${hour}`}
                    style={{
                      background: style.bg,
                      color: style.text,
                      fontSize: '0.67rem',
                      fontWeight: 600,
                      padding: '3px 2px',
                    }}
                  >
                    {Math.round(ccl)}
                  </td>
                );
              })}
            </tr>

            {/* Ciel & Icône météo */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                🌤️ Ciel & Temps
              </td>
              {colData.map(({ hour, point }) => {
                if (!point) return <td key={`c-${hour}`}>—</td>;
                return (
                  <td key={`c-${hour}`} style={{ padding: '4px 2px' }}>
                    <div style={{ fontSize: '1.1rem', lineHeight: 1 }}>{WMO(point.wc)}</div>
                    {point.cc != null && (
                      <span style={{ fontSize: '0.58rem', color: 'var(--mu)', fontWeight: 600 }}>
                        {Math.round(point.cc)}%
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Luminosité / Rayonnement solaire (W/m²) */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: '#eab308',
                  whiteSpace: 'nowrap',
                }}
              >
                ☀️ Rayonnement (W/m²)
              </td>
              {colData.map(({ hour, point }) => {
                const rad = point?.rad;
                if (rad == null) return <td key={`rad-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const rVal = Math.round(rad);
                const isBright = rVal >= 300;
                return (
                  <td
                    key={`rad-${hour}`}
                    style={{
                      padding: '4px 2px',
                      fontSize: '0.68rem',
                      fontWeight: isBright ? 800 : 500,
                      color: rVal > 0 ? (isBright ? '#ca8a04' : 'var(--tx)') : 'var(--mu)',
                      background: isBright ? 'rgba(234, 179, 8, 0.12)' : 'transparent',
                    }}
                    title={`Rayonnement solaire instantané : ${rVal} W/m²`}
                  >
                    {rVal}
                  </td>
                );
              })}
            </tr>

            {/* Indice UV */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                🔆 Indice UV
              </td>
              {colData.map(({ hour, point }) => {
                const uv = point?.uv;
                if (uv == null) return <td key={`uv-${hour}`} style={{ color: 'var(--mu)' }}>—</td>;
                const uInfo = getUvBg(uv);
                return (
                  <td key={`uv-${hour}`} style={{ padding: '3px 2px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        background: uInfo.bg,
                        color: uInfo.text,
                      }}
                      title={`Indice UV ${uv.toFixed(1)} (${uInfo.label})`}
                    >
                      {uv >= 0.5 ? uv.toFixed(1).replace('.', ',') : '0'}
                    </span>
                  </td>
                );
              })}
            </tr>

            {/* SECTEUR MÉTÉO & TERRAIN */}
            {/* Précipitations (mm/1h) */}
            <tr style={{ borderTop: '2px solid var(--bd)' }}>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                🌧️ Pluie (mm)
              </td>
              {colData.map(({ hour, point }) => {
                if (!point) return <td key={`p-${hour}`}>—</td>;
                const pr = point.pr || 0;
                return (
                  <td
                    key={`p-${hour}`}
                    style={{
                      padding: '4px 2px',
                      fontWeight: pr > 0 ? 800 : 500,
                      background: pr > 0.5 ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                      color: pr > 0 ? 'var(--cb)' : 'var(--mu)',
                    }}
                  >
                    {pr > 0 ? pr.toFixed(1).replace('.', ',') : '0'}
                  </td>
                );
              })}
            </tr>

            {/* Température (°C) */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                🌡️ Temp. (°C)
              </td>
              {colData.map(({ hour, point }) => {
                if (!point || point.tp == null) return <td key={`t-${hour}`}>—</td>;
                return (
                  <td key={`t-${hour}`} style={{ padding: '4px 2px', fontWeight: 700 }}>
                    {Math.round(point.tp)}°
                    {point.ap != null && (
                      <span style={{ display: 'block', fontSize: '0.58rem', color: 'var(--mu)' }}>
                        ress. {Math.round(point.ap)}°
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Pression (hPa) */}
            <tr>
              <td
                style={{
                  fontWeight: 800,
                  textAlign: 'left',
                  padding: '5px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                Baromètre (hPa)
              </td>
              {colData.map(({ hour, point }) => {
                if (!point || point.p == null) return <td key={`pr-${hour}`}>—</td>;
                return (
                  <td
                    key={`pr-${hour}`}
                    style={{
                      padding: '4px 2px',
                      fontSize: '0.66rem',
                      color: 'var(--mu)',
                      fontWeight: 600,
                    }}
                  >
                    {Math.round(point.p)}
                  </td>
                );
              })}
            </tr>

            {/* Hauteur d'eau et roulabilité char à voile (Lestrevet) */}
            <tr style={{ borderTop: '2px solid var(--bd)' }}>
              <td
                style={{
                  fontWeight: 900,
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: 'var(--cell)',
                  color: 'var(--tx)',
                  whiteSpace: 'nowrap',
                }}
              >
                🏁 Eau & Plage
              </td>
              {colData.map(({ hour, waterLevel, isUnderThreshold }) => {
                if (waterLevel == null) return <td key={`wl-${hour}`}>—</td>;
                return (
                  <td
                    key={`wl-${hour}`}
                    style={{
                      padding: '5px 2px',
                      fontWeight: 800,
                      background: isUnderThreshold ? 'var(--okbg)' : 'transparent',
                      color: isUnderThreshold ? 'var(--ok)' : 'var(--mu)',
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
                        display: 'block',
                        fontSize: '0.55rem',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        marginTop: '1px',
                      }}
                    >
                      {isUnderThreshold ? 'Roulable' : 'Pleine mer'}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Légendes & repères Windguru */}
      <div
        className="note"
        style={{
          marginTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '0.67rem',
          lineHeight: 1.4,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <span>
            <b>Légende vent :</b>{' '}
            <span style={{ background: '#bbf7d0', padding: '1px 4px', borderRadius: '3px', color: '#14532d' }}>8–15 nds (idéal)</span>{' '}
            <span style={{ background: '#fef08a', padding: '1px 4px', borderRadius: '3px', color: '#713f12' }}>16–21 nds</span>{' '}
            <span style={{ background: '#fed7aa', padding: '1px 4px', borderRadius: '3px', color: '#7c2d12' }}>22–27 nds</span>{' '}
            <span style={{ background: '#fca5a5', padding: '1px 4px', borderRadius: '3px', color: '#7f1d1d' }}>28+ nds</span>
          </span>
          <span>
            <b>Houle :</b>{' '}
            <span style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px', color: '#0369a1' }}>&lt;1m (calme)</span>{' '}
            <span style={{ background: '#bae6fd', padding: '1px 4px', borderRadius: '3px', color: '#0284c7' }}>1–1.5m</span>{' '}
            <span style={{ background: '#7dd3fc', padding: '1px 4px', borderRadius: '3px', color: '#0369a1' }}>1.5–2m</span>{' '}
            <span style={{ background: '#38bdf8', padding: '1px 4px', borderRadius: '3px', color: '#0c4a6e' }}>2m+</span>
          </span>
        </div>
        <div style={{ color: 'var(--mu)' }}>
          * Vagues & houle : données marine Open-Meteo pour Lestrevet. Nuages (hauts/moyens/bas), rayonnement solaire (W/m²) et indice UV issus des prévisions AROME HD & Global.
        </div>
      </div>
    </div>
  );
};
