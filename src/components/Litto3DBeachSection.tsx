import React, { useEffect, useMemo, useState } from 'react';
import { AppSettings, BeachCadreProfile, GpsWaterlineLog, TidePoint, WindPoint } from '../types';
import { computeCadreGeometry } from '../utils/beachCadreEngine';
import {
  BAY_ZONES_META,
  BayZoneId,
  estimateLitto3dWaterlineXExactM,
  LITTO3D_PROFILES_BY_ZONE,
} from '../utils/beachOrientation';
import { build, hAt, windAt } from '../utils/tides';
import {
  BeachPisteDiagram,
  estimateSvgPillWidth,
} from './BeachPisteDiagram';
import {
  buildPhysicalObservationPoints,
  fitEmpiricalTerrainModel,
  OBSERVATORY_START_DATE,
  predictEmpiricalAt,
} from '../utils/physicalCorrelationEngine';
import { getStoredObservations } from '../utils/statisticsEngine';

interface Litto3DBeachSectionProps {
  settings: AppSettings;
  EX: TidePoint[];
  windList?: WindPoint[];
  logs?: GpsWaterlineLog[];
  activeCadre?: BeachCadreProfile | null;
  dailyUpperMarginM?: number;
  dailyUpperLabel?: string;
}

export const Litto3DBeachSection: React.FC<Litto3DBeachSectionProps> = ({
  settings,
  EX,
  windList = [],
  logs = [],
  activeCadre = null,
  dailyUpperMarginM,
  dailyUpperLabel,
}) => {

  // Heure actuelle en minute UTC
  const nowUtcMinute = Math.floor(Date.now() / 60000);

  // 1. Hauteur théorique SHOM pure (sans correction météo)
  const rawEX = useMemo(() => build(settings.les, false, []), [settings.les]);
  const theoTideHeight = hAt(nowUtcMinute, rawEX) ?? hAt(nowUtcMinute, EX) ?? settings.L;

  // Curseur libre de surcote (+) / sous-cote (−) simulée (-40 cm à +50 cm)
  const [simulatedSurcoteCm, setSimulatedSurcoteCm] = useState<number>(0);

  // Marge de sable sec/mou en haut de plage (synchronisée avec la limite haute du jour : PM veille / GPS / terrain)
  const effectiveDefaultMarginM =
    typeof dailyUpperMarginM === 'number'
      ? dailyUpperMarginM
      : activeCadre?.softSandMarginM ?? 50;
  const [softSandMarginM, setSoftSandMarginM] = useState<number>(effectiveDefaultMarginM);

  useEffect(() => {
    setSoftSandMarginM(effectiveDefaultMarginM);
  }, [effectiveDefaultMarginM]);

  // Mode d'affichage visuel : 'aerial' (Vue du dessus / Piste de char) ou 'profile' (Coupe transversale)
  const [viewMode, setViewMode] = useState<'aerial' | 'profile'>('aerial');
  // Secteur de baie sélectionné pour le profil altimétrique IGN RGE ALTI 1 m (Lestrevet par défaut)
  const [selectedZone, setSelectedZone] = useState<BayZoneId>('lestrevet');

  // Données issues du Cadre Terrain étalonné (Dune + Gauche/Droite)
  const cadreGeom = useMemo(() => computeCadreGeometry(activeCadre), [activeCadre]);

  // Météo en direct & Modèle Réel Empirique unifié (Pression + Houle + Vent dès le 20/11/2026)
  const liveWind = useMemo(() => windAt(nowUtcMinute, windList), [nowUtcMinute, windList]);
  const empiricalTerrainModel = useMemo(() => {
    const rexObs = getStoredObservations().filter(
      o => o && o.id && !o.id.startsWith('sample-obs-')
    );
    const { points } = buildPhysicalObservationPoints(
      logs,
      rexObs,
      activeCadre,
      OBSERVATORY_START_DATE
    );
    return fitEmpiricalTerrainModel(points);
  }, [logs, activeCadre]);

  const empiricalPred = useMemo(
    () => predictEmpiricalAt(empiricalTerrainModel, liveWind),
    [empiricalTerrainModel, liveWind]
  );
  const modelDeltaCm = empiricalPred.surcoteCm;
  const empiricalBasisLabel =
    empiricalTerrainModel.sampleCountSurcote > 0
      ? `${empiricalTerrainModel.terrainConfidencePct}% terrain · ${empiricalTerrainModel.sampleCountSurcote} rel. dès 20/11`
      : 'Pression + Houle + Vent';

  // Hauteurs d'eau : SHOM brut vs Modèle Réel Empirique (+ curseur simulation)
  const theoWaterHeightM = Number(theoTideHeight.toFixed(2));
  const appliedDeltaCm = modelDeltaCm + simulatedSurcoteCm;
  const realWaterHeightM = Number((theoWaterHeightM + appliedDeltaCm / 100).toFixed(2));

  /**
   * Profil Altimétrique réel IGN RGE ALTI 1 m / Litto3D du secteur sélectionné (Lestrevet / Lieue de Grève / Pentrez)
   */
  const beachProfile = useMemo(
    () => LITTO3D_PROFILES_BY_ZONE[selectedZone],
    [selectedZone]
  );

  // Calcul exact (flottant) de la distance X depuis la dune selon la hauteur d'eau Z et la zone
  const calculateWaterLineXExact = (zWater: number): number =>
    estimateLitto3dWaterlineXExactM(zWater, selectedZone);

  const theoExactX = calculateWaterLineXExact(theoWaterHeightM);
  const realExactX = calculateWaterLineXExact(realWaterHeightM);

  const theoDiscoveredX = Math.round(theoExactX);
  const realDiscoveredX = Math.round(realExactX);
  const theoRollableWidthM = Math.max(0, theoDiscoveredX - softSandMarginM);
  const realRollableWidthM = Math.max(0, realDiscoveredX - softSandMarginM);
  const deltaBeachM = realDiscoveredX - theoDiscoveredX; // négatif = perte (surcote), positif = gain (décote)

  // Position et largeur utile au seuil école nominal (ex: 4,50 m)
  const nominalThresholdX = Math.round(calculateWaterLineXExact(settings.L));
  const nominalWidthM = Math.max(0, nominalThresholdX - softSandMarginM);

  // Dimensions SVG (Coupe Altimétrique)
  const svgW = 700;
  const svgH = 318;
  const padL = 54;
  const padR = 25;
  const padT = 28;
  const padB = 94;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const mapX = (x: number) => padL + (x / 460) * plotW;
  const mapY = (z: number) => padT + plotH - ((z - 1.0) / 8.2) * plotH;

  // Positions X/Y en coupe
  const theoXPos = mapX(theoExactX);
  const theoYPos = mapY(theoWaterHeightM);
  const realXPos = mapX(realExactX);
  const realYPos = mapY(realWaterHeightM);

  // Polygone du sol en coupe
  const sandPolygon = [
    `${mapX(0)},${mapY(1.0)}`,
    ...beachProfile.map(p => `${mapX(p.x)},${mapY(p.z)}`),
    `${mapX(460)},${mapY(1.0)}`,
  ].join(' ');

  // Polygone d'eau réelle en coupe
  const waterPolygon = [
    `${realXPos},${realYPos}`,
    `${mapX(460)},${realYPos}`,
    `${mapX(460)},${mapY(1.0)}`,
    `${realXPos},${mapY(1.0)}`,
  ].join(' ');

  const isSurcote = appliedDeltaCm > 0;
  const isSouscote = appliedDeltaCm < 0;
  const hasWaterDiff = Math.abs(realXPos - theoXPos) >= 0.8;

  const realHeightLabel = realWaterHeightM.toFixed(2).replace('.', ',');
  const theoHeightLabel = theoWaterHeightM.toFixed(2).replace('.', ',');

  const shomBarText = `SHOM brut : ${theoRollableWidthM} m utiles`;
  const shomPillW = estimateSvgPillWidth(shomBarText, 5.4, 22);
  const diffRollM = realRollableWidthM - theoRollableWidthM;
  const diffRollStr = diffRollM > 0 ? `+${diffRollM} m` : diffRollM < 0 ? `${diffRollM} m` : 'identique';
  const empBarText = `Modèle réel empirique : ${realRollableWidthM} m (${diffRollStr} · ${empiricalBasisLabel})`;
  const empPillW = Math.min(395, estimateSvgPillWidth(empBarText, 5.25, 22));

  return (
    <div
      className="card"
      style={{
        background: '#ffffff',
        border: '1.5px solid #0284c7',
        borderRadius: '14px',
        padding: '18px 20px',
        marginTop: '20px',
        boxShadow: '0 4px 16px rgba(2, 132, 199, 0.08)',
      }}
    >
      {/* En-tête avec bascule de vue */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.70rem', textTransform: 'uppercase', fontWeight: 900, color: '#0369a1', letterSpacing: '0.04em' }}>
              Topographie Littorale &amp; Modèle Litto3D (IGN / SHOM)
            </span>
            <span style={{ fontSize: '0.64rem', background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>
              Open Data Lidar
            </span>
          </div>
          <h3 style={{ margin: '3px 0 0', fontSize: '1.20rem', fontWeight: 900, color: '#0f172a' }}>
            Largeur de Plage &amp; Piste de Roulage en Direct
          </h3>
        </div>

        {/* Sélecteur secteur IGN + bascule Vue Piste / Coupe Altimétrique */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'inline-flex', background: '#f8fafc', padding: '3px', borderRadius: '8px', border: '1px solid #cbd5e1', gap: '2px' }}>
            {(['lestrevet', 'lieue_de_greve', 'pentrez'] as const).map(zId => {
              const meta = BAY_ZONES_META[zId];
              const active = selectedZone === zId;
              return (
                <button
                  key={zId}
                  type="button"
                  onClick={() => setSelectedZone(zId)}
                  style={{
                    border: active ? `1px solid ${meta.bd}` : '1px solid transparent',
                    background: active ? meta.bg : 'transparent',
                    color: active ? meta.fg : '#64748b',
                    fontWeight: active ? 800 : 700,
                    fontSize: '0.70rem',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {meta.shortLabel}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
            <button
              type="button"
              onClick={() => setViewMode('aerial')}
              style={{
                border: 'none',
                background: viewMode === 'aerial' ? '#0284c7' : 'transparent',
                color: viewMode === 'aerial' ? '#ffffff' : '#475569',
                fontWeight: 800,
                fontSize: '0.74rem',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease',
              }}
            >
              <span>🛰️</span>
              <span>Vue Piste (Du dessus)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('profile')}
              style={{
                border: 'none',
                background: viewMode === 'profile' ? '#0284c7' : 'transparent',
                color: viewMode === 'profile' ? '#ffffff' : '#475569',
                fontWeight: 800,
                fontSize: '0.74rem',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease',
              }}
            >
              <span>📐</span>
              <span>Coupe Altimétrique</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bandeau comparatif permanent : Ligne d'eau Théorique SHOM vs Réelle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '10px',
          padding: '8px 12px',
          borderRadius: '8px',
          background: isSurcote ? '#fff7ed' : isSouscote ? '#ecfdf5' : '#f0f9ff',
          border: isSurcote
            ? '1px solid #fdba74'
            : isSouscote
            ? '1px solid #6ee7b7'
            : '1px solid #bae6fd',
          fontSize: '0.74rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '14px',
                height: '0',
                borderTop: '2.5px dashed #eab308',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#475569' }}>
              SHOM brut : <strong style={{ color: '#0f172a' }}>{theoHeightLabel} m</strong> (bord d&apos;eau {theoDiscoveredX} m)
            </span>
          </span>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '14px',
                height: '3px',
                background: isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7',
                borderRadius: '2px',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#0f172a' }}>
              Modèle empirique ({appliedDeltaCm >= 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm) :{' '}
              <strong>{realHeightLabel} m</strong> (bord d&apos;eau {realDiscoveredX} m)
            </span>
          </span>
        </div>

        <span
          style={{
            fontWeight: 800,
            color: isSurcote ? '#c2410c' : isSouscote ? '#047857' : '#0369a1',
          }}
        >
          {appliedDeltaCm > 0
            ? `Surcote +${appliedDeltaCm} cm ➔ ${deltaBeachM} m de plage (${realRollableWidthM} m utiles vs ${theoRollableWidthM} m SHOM)`
            : appliedDeltaCm < 0
            ? `Décote ${appliedDeltaCm} cm ➔ +${deltaBeachM} m de plage (${realRollableWidthM} m utiles vs ${theoRollableWidthM} m SHOM)`
            : 'Écart 0 cm : modèle empirique aligné sur le SHOM (utilisez le curseur ci-dessous pour simuler)'}
        </span>
      </div>

      {/* REPRÉSENTATION 1 : VUE AÉRIENNE DE LA PISTE (SHOM vs MODÈLE RÉEL EMPIRIQUE) */}
      {viewMode === 'aerial' ? (
        <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '12px 14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.72rem', color: '#64748b' }}>
            <span>Vue plongeante orientée vers le large (Dune à gauche ➔ Mer à droite)</span>
            <span style={{ fontWeight: 700, color: '#0369a1' }}>Échelle réelle 1:1 en largeur (0 – 460 m)</span>
          </div>

          <BeachPisteDiagram
            softSandMarginM={softSandMarginM}
            theoWaterHeightM={theoWaterHeightM}
            realWaterHeightM={realWaterHeightM}
            appliedDeltaCm={appliedDeltaCm}
            theoExactX={theoExactX}
            realExactX={realExactX}
            theoRollableWidthM={theoRollableWidthM}
            realRollableWidthM={realRollableWidthM}
            deltaBeachM={deltaBeachM}
            thresholdHeightM={settings.L}
            thresholdExactX={nominalThresholdX}
            thresholdLabelPrefix="Seuil"
            thresholdTone="amber"
            isWithinThreshold={realWaterHeightM <= settings.L}
            empiricalBasisLabel={empiricalBasisLabel}
            minWidth="560px"
          />
        </div>
      ) : (
        /* REPRÉSENTATION 2 : COUPE ALTIMÉTRIQUE EN SECTION */
        <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '12px 14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.72rem', color: '#64748b' }}>
            <span>Coupe transversale (Remarque : hauteur verticalement rehaussée pour distinguer les cotes)</span>
            <span style={{ fontWeight: 700, color: '#0369a1' }}>Pente réelle : 1,15 % (0,66° seulement)</span>
          </div>

          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            style={{ width: '100%', minWidth: '560px', height: 'auto', display: 'block' }}
          >
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="#f0f9ff" />

            {[2, 3, 4, 5, 6, 7, 8].map(alt => {
              const yPos = mapY(alt);
              return (
                <g key={`y-grid-${alt}`}>
                  <line
                    x1={padL}
                    x2={padL + plotW}
                    y1={yPos}
                    y2={yPos}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <line
                    x1={padL - 4}
                    x2={padL}
                    y1={yPos}
                    y2={yPos}
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                  />
                  <text
                    x={padL - 8}
                    y={yPos + 3}
                    fill="#475569"
                    fontSize="8.5"
                    fontWeight="700"
                    textAnchor="end"
                  >
                    {alt} m
                  </text>
                </g>
              );
            })}
            <line
              x1={padL}
              x2={padL}
              y1={padT}
              y2={padT + plotH}
              stroke="#64748b"
              strokeWidth="1.5"
            />
            <text
              x={padL - 10}
              y={padT - 10}
              fill="#0369a1"
              fontSize="8.5"
              fontWeight="900"
              textAnchor="start"
            >
              ▲ Altitude (Z)
            </text>

            {/* Zone d'écart verticale Surcote / Sous-cote en coupe */}
            {hasWaterDiff && (
              <rect
                x={Math.min(realXPos, theoXPos)}
                y={Math.min(realYPos, theoYPos)}
                width={mapX(460) - Math.min(realXPos, theoXPos)}
                height={Math.max(2, Math.abs(realYPos - theoYPos))}
                fill={isSurcote ? 'rgba(249, 115, 22, 0.28)' : 'rgba(16, 185, 129, 0.28)'}
              />
            )}

            <polygon points={waterPolygon} fill="rgba(14, 165, 233, 0.42)" />
            <polygon points={sandPolygon} fill="#fef3c7" stroke="#d97706" strokeWidth="2" />

            {/* Seuil nominal école */}
            <line
              x1={padL}
              x2={padL + plotW}
              y1={mapY(settings.L)}
              y2={mapY(settings.L)}
              stroke="#b45309"
              strokeWidth="1.5"
              strokeDasharray="5 3"
            />
            <rect
              x={padL + 6}
              y={Math.abs(mapY(settings.L) - realYPos) < 18 ? mapY(settings.L) + 4 : mapY(settings.L) - 18}
              width="216"
              height="15"
              rx="4"
              fill="rgba(254, 243, 199, 0.94)"
              stroke="#f59e0b"
              strokeWidth="0.9"
            />
            <text
              x={padL + 114}
              y={Math.abs(mapY(settings.L) - realYPos) < 18 ? mapY(settings.L) + 14.5 : mapY(settings.L) - 7.5}
              fill="#92400e"
              fontSize="8.2"
              fontWeight="800"
              textAnchor="middle"
            >
              Seuil école {settings.L} m (X = {nominalThresholdX} m · Utile {nominalWidthM} m)
            </text>

            {/* LIGNE D'EAU THÉORIQUE SHOM */}
            <line
              x1={theoXPos}
              x2={mapX(460)}
              y1={theoYPos}
              y2={theoYPos}
              stroke="#ca8a04"
              strokeWidth="2.2"
              strokeDasharray="6 3"
            />
            <line
              x1={theoXPos}
              x2={theoXPos}
              y1={theoYPos}
              y2={padT + plotH}
              stroke="#ca8a04"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <circle cx={theoXPos} cy={theoYPos} r="4" fill="#fde047" stroke="#0f172a" strokeWidth="1.3" />
            {Math.abs(realYPos - theoYPos) >= 18 && (
              <g>
                <rect
                  x={mapX(460) - 178}
                  y={isSurcote ? theoYPos + 4 : theoYPos - 19}
                  width="174"
                  height="15"
                  rx="4"
                  fill="rgba(255, 255, 255, 0.92)"
                  stroke="#eab308"
                  strokeWidth="0.9"
                />
                <text
                  x={mapX(460) - 91}
                  y={isSurcote ? theoYPos + 14.5 : theoYPos - 8.5}
                  fill="#854d0e"
                  fontSize="8.2"
                  fontWeight="800"
                  textAnchor="middle"
                >
                  Théo SHOM : {theoHeightLabel} m (X = {theoDiscoveredX} m)
                </text>
              </g>
            )}

            {/* LIGNE D'EAU RÉELLE (avec surcote / sous-cote) */}
            <line
              x1={realXPos}
              x2={mapX(460)}
              y1={realYPos}
              y2={realYPos}
              stroke={isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7'}
              strokeWidth="2.6"
            />
            <circle
              cx={realXPos}
              cy={realYPos}
              r="4.5"
              fill={isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#dc2626'}
              stroke="#fff"
              strokeWidth="1.5"
            />
            {(() => {
              const pillW = appliedDeltaCm !== 0 ? 228 : 168;
              const pillX = Math.max(padL + 8, Math.min(mapX(460) - pillW - 4, realXPos + 10));
              const pillY = Math.max(padT + 4, realYPos - 21);
              return (
                <g>
                  <rect
                    x={pillX}
                    y={pillY}
                    width={pillW}
                    height="16"
                    rx="4"
                    fill="rgba(255, 255, 255, 0.95)"
                    stroke={isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7'}
                    strokeWidth="1"
                  />
                  <text
                    x={pillX + pillW / 2}
                    y={pillY + 11}
                    fill={isSurcote ? '#c2410c' : isSouscote ? '#047857' : '#0369a1'}
                    fontSize="8.5"
                    fontWeight="900"
                    textAnchor="middle"
                  >
                    Empirique : {realHeightLabel} m ({realDiscoveredX} m
                    {appliedDeltaCm !== 0 ? ` · ${appliedDeltaCm > 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm` : ''})
                  </text>
                </g>
              );
            })()}

            {/* Repères d'axe X */}
            <text x={mapX(0)} y={padT + plotH + 13} fill="#64748b" fontSize="8" textAnchor="middle">Dune (0 m)</text>
            {softSandMarginM >= 45 ? (
              <text x={mapX(softSandMarginM)} y={padT + plotH + 13} fill="#b45309" fontSize="8" fontWeight="700" textAnchor="middle">
                Sable mou ({softSandMarginM} m)
              </text>
            ) : softSandMarginM >= 25 ? (
              <text x={mapX(softSandMarginM)} y={padT + plotH + 13} fill="#b45309" fontSize="8" fontWeight="700" textAnchor="middle">
                {softSandMarginM} m
              </text>
            ) : null}
            <text x={mapX(200)} y={padT + plotH + 13} fill="#64748b" fontSize="8" textAnchor="middle">200 m</text>
            <text x={mapX(350)} y={padT + plotH + 13} fill="#64748b" fontSize="8" textAnchor="middle">350 m</text>
            <text x={mapX(460)} y={padT + plotH + 13} fill="#64748b" fontSize="8" textAnchor="middle">460 m</text>

            {/* Cote 1 : Bande roulable SHOM brut */}
            {theoRollableWidthM > 0 ? (
              <g>
                <line x1={mapX(softSandMarginM)} x2={theoXPos} y1={padT + plotH + 34} y2={padT + plotH + 34} stroke="#ca8a04" strokeWidth="2.4" strokeDasharray="5 3" />
                <line x1={mapX(softSandMarginM)} x2={mapX(softSandMarginM)} y1={padT + plotH + 28} y2={padT + plotH + 40} stroke="#a16207" strokeWidth="2" />
                <line x1={theoXPos} x2={theoXPos} y1={padT + plotH + 28} y2={padT + plotH + 40} stroke="#a16207" strokeWidth="2" />
                {(() => {
                  const pW = shomPillW;
                  const putRight = mapX(460) - theoXPos >= pW + 12;
                  const boxX = putRight
                    ? theoXPos + 10
                    : Math.max(padL, Math.min(mapX(460) - pW, (mapX(softSandMarginM) + theoXPos) / 2 - pW / 2));
                  return (
                    <g>
                      <rect
                        x={boxX}
                        y={padT + plotH + 23}
                        width={pW}
                        height="22"
                        rx="6"
                        fill="#fefce8"
                        stroke="#eab308"
                        strokeWidth="1.2"
                      />
                      <text
                        x={boxX + pW / 2}
                        y={padT + plotH + 37.5}
                        fill="#854d0e"
                        fontSize="9"
                        fontWeight="900"
                        textAnchor="middle"
                      >
                        {shomBarText}
                      </text>
                    </g>
                  );
                })()}
              </g>
            ) : (
              <g>
                <rect x={padL} y={padT + plotH + 23} width="228" height="22" rx="6" fill="#fefce8" stroke="#eab308" strokeWidth="1.2" />
                <text x={padL + 114} y={padT + plotH + 37.5} fill="#854d0e" fontSize="9" fontWeight="900" textAnchor="middle">
                  SHOM brut : 0 m roulable
                </text>
              </g>
            )}

            {/* Cote 2 : Bande roulable Modèle Réel Empirique */}
            {realRollableWidthM > 0 ? (
              <g>
                <line x1={mapX(softSandMarginM)} x2={realXPos} y1={padT + plotH + 68} y2={padT + plotH + 68} stroke={isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7'} strokeWidth="2.6" />
                <line x1={mapX(softSandMarginM)} x2={mapX(softSandMarginM)} y1={padT + plotH + 62} y2={padT + plotH + 74} stroke={isSurcote ? '#c2410c' : isSouscote ? '#047857' : '#0369a1'} strokeWidth="2" />
                <line x1={realXPos} x2={realXPos} y1={padT + plotH + 62} y2={padT + plotH + 74} stroke={isSurcote ? '#c2410c' : isSouscote ? '#047857' : '#0369a1'} strokeWidth="2" />
                {(() => {
                  const pW = empPillW;
                  const putRight = mapX(460) - realXPos >= pW + 12;
                  const boxX = putRight
                    ? realXPos + 10
                    : Math.max(padL, Math.min(mapX(460) - pW, (mapX(softSandMarginM) + realXPos) / 2 - pW / 2));
                  return (
                    <g>
                      <rect
                        x={boxX}
                        y={padT + plotH + 57}
                        width={pW}
                        height="22"
                        rx="6"
                        fill={isSurcote ? '#fff7ed' : isSouscote ? '#ecfdf5' : '#e0f2fe'}
                        stroke={isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7'}
                        strokeWidth="1.2"
                      />
                      <text
                        x={boxX + pW / 2}
                        y={padT + plotH + 71.5}
                        fill={isSurcote ? '#9a3412' : isSouscote ? '#065f46' : '#0c4a6e'}
                        fontSize="9"
                        fontWeight="900"
                        textAnchor="middle"
                      >
                        {empBarText}
                      </text>
                    </g>
                  );
                })()}
              </g>
            ) : (
              <g>
                <rect x={padL} y={padT + plotH + 57} width="268" height="22" rx="6" fill="#fef2f2" stroke="#f87171" strokeWidth="1.2" />
                <text x={padL + 134} y={padT + plotH + 71.5} fill="#991b1b" fontSize="9" fontWeight="900" textAnchor="middle">
                  Modèle réel empirique : 0 m roulable
                </text>
              </g>
            )}
          </svg>
        </div>
      )}

      {/* PANNEAU DE CONTRÔLE INTERACTIF & RÉGLAGES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
        {/* KPI 1 : Comparatif Bande Roulable — Modèle Réel Empirique vs SHOM brut */}
        <div style={{ background: '#f0f9ff', border: '1.5px solid #7dd3fc', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1' }}>
            🏎️ Bande roulable · Modèle empirique
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px', marginTop: '3px' }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0c4a6e', fontFamily: 'monospace' }}>
              {realRollableWidthM}
            </span>
            <span style={{ fontSize: '0.80rem', fontWeight: 800, color: '#0369a1' }}>m</span>
            {theoRollableWidthM !== realRollableWidthM && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: deltaBeachM < 0 ? '#c2410c' : '#047857',
                }}
              >
                ({deltaBeachM > 0 ? `+${deltaBeachM}` : deltaBeachM} m vs SHOM {theoRollableWidthM} m)
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: '6px',
              padding: '5px 8px',
              borderRadius: '7px',
              background: '#f3e8ff',
              border: '1px solid #c4b5fd',
              fontSize: '0.68rem',
              fontWeight: 800,
              color: '#5b21b6',
            }}
          >
            🎯 SHOM brut : {theoRollableWidthM} m · Empirique : {empiricalBasisLabel}
          </div>

          <div style={{ fontSize: '0.69rem', color: '#0369a1', fontWeight: 700, marginTop: '6px' }}>
            {realRollableWidthM >= 180
              ? '✓ Idéal grand circuit (12 chars)'
              : realRollableWidthM >= 100
              ? '⚡ Circuit compact'
              : '⛔ Trop étroit (< 100 m)'}
            {cadreGeom.corridorLengthM != null && ` · Longueur : ${cadreGeom.corridorLengthM} m`}
          </div>
        </div>

        {/* CONTRÔLE 2 : Curseur de marge sable sec / mou */}
        <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', fontWeight: 900, textTransform: 'uppercase', color: '#92400e' }}>
            <span>🏖️ Marge sable sec haut de plage</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.80rem' }}>{softSandMarginM} m</span>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="5"
            value={softSandMarginM}
            onChange={e => setSoftSandMarginM(Number(e.target.value))}
            style={{ width: '100%', marginTop: '6px', cursor: 'pointer' }}
          />
          <div style={{ fontSize: '0.68rem', color: '#b45309', marginTop: '4px', lineHeight: 1.35 }}>
            <strong>Limite haute du jour : {effectiveDefaultMarginM} m</strong>
            {dailyUpperLabel ? ` (${dailyUpperLabel})` : ''} · curseur libre pour simuler un autre niveau de laisse PM.
          </div>
        </div>

        {/* CONTRÔLE 3 : Surcote (+) / Sous-cote (−) appliquée */}
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', fontWeight: 900, textTransform: 'uppercase', color: '#475569' }}>
            <span>🌊 Surcote (+) / Sous-cote (−)</span>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.80rem',
                color: appliedDeltaCm > 0 ? '#c2410c' : appliedDeltaCm < 0 ? '#047857' : '#64748b',
              }}
            >
              {appliedDeltaCm >= 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm
            </span>
          </div>
          <input
            type="range"
            min="-40"
            max="50"
            step="1"
            value={simulatedSurcoteCm}
            onChange={e => setSimulatedSurcoteCm(Number(e.target.value))}
            style={{ width: '100%', marginTop: '6px', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '4px' }}>
            {[-20, -10, 0, 10, 20, 30].map(val => (
              <button
                key={val}
                type="button"
                onClick={() => setSimulatedSurcoteCm(val)}
                style={{
                  padding: '1px 6px',
                  fontSize: '0.64rem',
                  fontWeight: 800,
                  borderRadius: '4px',
                  border: simulatedSurcoteCm === val ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: simulatedSurcoteCm === val ? '#e0f2fe' : '#fff',
                  color: simulatedSurcoteCm === val ? '#0369a1' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {val > 0 ? `+${val}` : val}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.67rem', color: '#64748b', lineHeight: 1.35 }}>
            {modelDeltaCm !== 0 && (
              <div>
                Modèle réel empirique : <strong>{modelDeltaCm > 0 ? `+${modelDeltaCm}` : modelDeltaCm} cm</strong>
                {simulatedSurcoteCm !== 0 ? ` + simulation ${simulatedSurcoteCm > 0 ? `+${simulatedSurcoteCm}` : simulatedSurcoteCm} cm` : ''}.
              </div>
            )}
            {appliedDeltaCm !== 0
              ? `Déplace la ligne d'eau de ${deltaBeachM > 0 ? `+${deltaBeachM}` : deltaBeachM} m sur le sable (pente 1,15 %).`
              : 'Pente 1,15 % : 1 cm d\'eau vertical = ~87 cm de plage.'}
          </div>
        </div>
      </div>
    </div>
  );
};
