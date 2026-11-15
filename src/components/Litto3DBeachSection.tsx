import React, { useEffect, useId, useMemo, useState } from 'react';
import { AppSettings, BeachCadreProfile, GpsWaterlineLog, TidePoint } from '../types';
import { computeCadreGeometry, evaluatePointAgainstCadre } from '../utils/beachCadreEngine';
import { build, hAt } from '../utils/tides';

interface Litto3DBeachSectionProps {
  settings: AppSettings;
  EX: TidePoint[];
  logs?: GpsWaterlineLog[];
  activeCadre?: BeachCadreProfile | null;
}

export const Litto3DBeachSection: React.FC<Litto3DBeachSectionProps> = ({
  settings,
  EX,
  logs = [],
  activeCadre = null,
}) => {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');

  // Heure actuelle en minute UTC
  const nowUtcMinute = Math.floor(Date.now() / 60000);

  // 1. Hauteur théorique SHOM pure (sans correction pression ni offset empirique)
  const rawEX = useMemo(() => build(settings.les, false, []), [settings.les]);
  const theoTideHeight = hAt(nowUtcMinute, rawEX) ?? hAt(nowUtcMinute, EX) ?? settings.L;

  // 2. Correction active du modèle (pression atm + décalage empirique Mode Réel)
  const correctedTideHeight = hAt(nowUtcMinute, EX) ?? theoTideHeight;
  const isRealMode = settings.calculationMode === 'reel';
  const empiricalOffsetM = isRealMode ? (settings.empiricalOffsetCm ?? 15) / 100 : 0;
  const modelDeltaCm = Math.round((correctedTideHeight + empiricalOffsetM - theoTideHeight) * 100);

  // Curseur libre de surcote (+) / sous-cote (−) simulée (-40 cm à +50 cm)
  const [simulatedSurcoteCm, setSimulatedSurcoteCm] = useState<number>(0);

  // Marge de sable sec/mou en haut de plage (synchronisée avec le Cadre de Roulage, fixée à 50 m par défaut)
  const [softSandMarginM, setSoftSandMarginM] = useState<number>(activeCadre?.softSandMarginM ?? 50);

  useEffect(() => {
    if (typeof activeCadre?.softSandMarginM === 'number') {
      setSoftSandMarginM(activeCadre.softSandMarginM);
    }
  }, [activeCadre?.softSandMarginM]);

  // Mode d'affichage visuel : 'aerial' (Vue du dessus / Piste de char) ou 'profile' (Coupe transversale)
  const [viewMode, setViewMode] = useState<'aerial' | 'profile'>('aerial');

  // Hauteurs d'eau : Théorique SHOM vs Réelle avec surcote/sous-cote appliquée
  const theoWaterHeightM = Number(theoTideHeight.toFixed(2));
  const appliedDeltaCm = modelDeltaCm + simulatedSurcoteCm;
  const realWaterHeightM = Number((theoWaterHeightM + appliedDeltaCm / 100).toFixed(2));

  /**
   * Modèle Altimétrique Litto3D Finistère (IGN / SHOM) pour Lestrevet / Pentrez
   */
  const beachProfile = useMemo(() => {
    return [
      { x: 0, z: 7.2, desc: 'Pied de dune' },
      { x: 40, z: 6.2, desc: 'Cordon galets / sable sec' },
      { x: 75, z: 5.3, desc: 'Laisse de haute mer (Pleine mer)' },
      { x: 120, z: 4.85, desc: 'Zone haute praticable' },
      { x: 160, z: 4.5, desc: 'Seuil École 4,50 m' },
      { x: 220, z: 3.9, desc: 'Plateau sable dur' },
      { x: 280, z: 3.25, desc: 'Cœur zone de roulage' },
      { x: 340, z: 2.65, desc: 'Bas estran' },
      { x: 400, z: 1.95, desc: 'Basse mer de vive-eau' },
      { x: 460, z: 1.25, desc: 'Zéro de basse mer exceptionnelle' },
    ];
  }, []);

  // Calcul exact (flottant) de la distance X depuis la dune selon la hauteur d'eau Z
  const calculateWaterLineXExact = (zWater: number): number => {
    if (zWater >= 7.2) return 0;
    if (zWater <= 1.25) return 460;

    for (let i = 0; i < beachProfile.length - 1; i++) {
      const p1 = beachProfile[i];
      const p2 = beachProfile[i + 1];
      if (zWater <= p1.z && zWater >= p2.z) {
        const ratio = (p1.z - zWater) / (p1.z - p2.z);
        return p1.x + ratio * (p2.x - p1.x);
      }
    }
    return 200;
  };

  const theoExactX = calculateWaterLineXExact(theoWaterHeightM);
  const realExactX = calculateWaterLineXExact(realWaterHeightM);

  const theoDiscoveredX = Math.round(theoExactX);
  const realDiscoveredX = Math.round(realExactX);
  const theoRollableWidthM = Math.max(0, theoDiscoveredX - softSandMarginM);
  const realRollableWidthM = Math.max(0, realDiscoveredX - softSandMarginM);
  const deltaBeachM = realDiscoveredX - theoDiscoveredX; // négatif = perte (surcote), positif = gain (sous-cote)

  // Position et largeur utile au seuil école nominal (ex: 4,50 m)
  const nominalThresholdX = Math.round(calculateWaterLineXExact(settings.L));
  const nominalWidthM = Math.max(0, nominalThresholdX - softSandMarginM);

  // Données issues du Cadre Terrain étalonné (Dune + Gauche/Droite)
  const cadreGeom = useMemo(() => computeCadreGeometry(activeCadre), [activeCadre]);
  const latestGpsDuneEval = useMemo(() => {
    if (!activeCadre || logs.length === 0) return null;
    return evaluatePointAgainstCadre(logs[0].latitude, logs[0].longitude, activeCadre);
  }, [activeCadre, logs]);

  // Dimensions SVG
  const svgW = 700;
  const svgH = 265;
  const padL = 54;
  const padR = 25;
  const padT = 25;
  const padB = 45;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const mapX = (x: number) => padL + (x / 460) * plotW;
  const mapY = (z: number) => padT + plotH - ((z - 0.5) / 7.5) * plotH;

  // Positions X/Y en coupe & en vue aérienne
  const theoXPos = mapX(theoExactX);
  const theoYPos = mapY(theoWaterHeightM);
  const realXPos = mapX(realExactX);
  const realYPos = mapY(realWaterHeightM);

  // Polygone du sol en coupe
  const sandPolygon = [
    `${mapX(0)},${mapY(0.5)}`,
    ...beachProfile.map(p => `${mapX(p.x)},${mapY(p.z)}`),
    `${mapX(460)},${mapY(0.5)}`,
  ].join(' ');

  // Polygone d'eau réelle en coupe
  const waterPolygon = [
    `${realXPos},${realYPos}`,
    `${mapX(460)},${realYPos}`,
    `${mapX(460)},${mapY(0.5)}`,
    `${realXPos},${mapY(0.5)}`,
  ].join(' ');

  const isSurcote = appliedDeltaCm > 0; // eau plus haute -> realXPos < theoXPos -> moins de plage
  const isSouscote = appliedDeltaCm < 0; // eau plus basse -> realXPos > theoXPos -> plus de plage
  const hasWaterDiff = Math.abs(realXPos - theoXPos) >= 0.8;

  const drySandPatternId = `drySandPattern-${uid}`;
  const tracksPatternId = `tracksPattern-${uid}`;
  const oceanGradId = `oceanGrad-${uid}`;
  const surcoteZonePatternId = `surcoteZone-${uid}`;
  const souscoteZonePatternId = `souscoteZone-${uid}`;

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

        {/* Sélecteur de représentation : Vue Aérienne (Piste) vs Coupe Altimétrique */}
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
              Théorique SHOM : <strong style={{ color: '#0f172a' }}>{theoWaterHeightM.toFixed(2).replace('.', ',')} m</strong> (X = {theoDiscoveredX} m)
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
              Réel ({appliedDeltaCm >= 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm) :{' '}
              <strong>{realWaterHeightM.toFixed(2).replace('.', ',')} m</strong> (X = {realDiscoveredX} m)
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
            ? `Sous-cote ${appliedDeltaCm} cm ➔ +${deltaBeachM} m de plage (${realRollableWidthM} m utiles vs ${theoRollableWidthM} m SHOM)`
            : 'Écart 0 cm : ligne réelle superposée au SHOM (utilisez le curseur Surcote / Sous-cote ci-dessous pour simuler)'}
        </span>
      </div>

      {/* REPRÉSENTATION 1 : VUE AÉRIENNE DE LA PISTE (VUE DU DESSUS) */}
      {viewMode === 'aerial' ? (
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.72rem', color: '#64748b' }}>
            <span>Vue plongeante orientée vers le large (Dune à gauche ➔ Mer à droite)</span>
            <span style={{ fontWeight: 700, color: '#0369a1' }}>Échelle réelle 1:1 en largeur</span>
          </div>

          <svg
            viewBox="0 0 700 245"
            style={{ width: '100%', minWidth: '560px', height: 'auto', display: 'block', borderRadius: '8px', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06)' }}
          >
            <defs>
              {/* Motif sable sec */}
              <pattern id={drySandPatternId} width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="#fef08a" />
                <circle cx="5" cy="5" r="1" fill="#facc15" />
                <circle cx="15" cy="15" r="1.2" fill="#eab308" />
              </pattern>
              {/* Motif traces de roues char à voile */}
              <pattern id={tracksPatternId} width="40" height="30" patternUnits="userSpaceOnUse">
                <line x1="0" y1="8" x2="40" y2="8" stroke="#ca8a04" strokeWidth="1" strokeDasharray="6 4" opacity="0.45" />
                <line x1="0" y1="22" x2="40" y2="22" stroke="#ca8a04" strokeWidth="1" strokeDasharray="6 4" opacity="0.45" />
              </pattern>
              {/* Dégradé vagues */}
              <linearGradient id={oceanGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="30%" stopColor="#0284c7" />
                <stop offset="100%" stopColor="#0369a1" />
              </linearGradient>
              {/* Hachures Surcote (plage submergée par rapport au SHOM) */}
              <pattern id={surcoteZonePatternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="rgba(249, 115, 22, 0.42)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255, 237, 213, 0.85)" strokeWidth="2.2" />
              </pattern>
              {/* Hachures Sous-cote (plage gagnée par rapport au SHOM) */}
              <pattern id={souscoteZonePatternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <rect width="8" height="8" fill="rgba(16, 185, 129, 0.32)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(209, 250, 229, 0.9)" strokeWidth="2.2" />
              </pattern>
            </defs>

            {/* 1. Zone Dune & Oyats */}
            <rect x="0" y="0" width="30" height="245" fill="#a3e635" />
            <line x1="30" y1="0" x2="30" y2="245" stroke="#4d7c0f" strokeWidth="2" strokeDasharray="3 3" />
            <text x="15" y="125" fill="#365314" fontSize="10" fontWeight="900" transform="rotate(-90 15,125)" textAnchor="middle">
              DUNE / HERBE
            </text>

            {/* 2. Zone de sable sec / haut de plage */}
            {softSandMarginM > 0 && (
              <g>
                <rect
                  x="30"
                  y="0"
                  width={Math.max(0, mapX(softSandMarginM) - 30)}
                  height="245"
                  fill="#fef9c3"
                />
                <rect
                  x="30"
                  y="0"
                  width={Math.max(0, mapX(softSandMarginM) - 30)}
                  height="245"
                  fill={`url(#${drySandPatternId})`}
                  opacity="0.35"
                />
                <line
                  x1={mapX(softSandMarginM)}
                  y1="0"
                  x2={mapX(softSandMarginM)}
                  y2="245"
                  stroke="#d97706"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                />
                {mapX(softSandMarginM) > 80 && (
                  <text
                    x={(30 + mapX(softSandMarginM)) / 2}
                    y="125"
                    fill="#b45309"
                    fontSize="9.5"
                    fontWeight="800"
                    transform={`rotate(-90 ${(30 + mapX(softSandMarginM)) / 2},125)`}
                    textAnchor="middle"
                  >
                    SABLE SEC / MOU ({softSandMarginM} m)
                  </text>
                )}
              </g>
            )}

            {/* 3. Piste de roulage en sable dur (De softSandMarginM à realXPos) */}
            {realXPos > mapX(softSandMarginM) && (
              <g>
                <rect
                  x={mapX(softSandMarginM)}
                  y="0"
                  width={Math.max(0, realXPos - mapX(softSandMarginM))}
                  height="245"
                  fill="#fde68a"
                />
                <rect
                  x={mapX(softSandMarginM)}
                  y="0"
                  width={Math.max(0, realXPos - mapX(softSandMarginM))}
                  height="245"
                  fill={`url(#${tracksPatternId})`}
                />

                {realRollableWidthM >= 80 && (
                  <g opacity="0.88">
                    <rect
                      x={mapX(softSandMarginM) + 15}
                      y="38"
                      width={Math.max(20, realXPos - mapX(softSandMarginM) - 30)}
                      height="165"
                      rx="30"
                      fill="none"
                      stroke="#ea580c"
                      strokeWidth="2"
                      strokeDasharray="8 6"
                    />
                    <circle cx={mapX(softSandMarginM) + 25} cy="72" r="5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
                    <circle cx={mapX(softSandMarginM) + 25} cy="168" r="5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
                    <circle cx={realXPos - 25} cy="72" r="5" fill="#eab308" stroke="#000" strokeWidth="1.5" />
                    <circle cx={realXPos - 25} cy="168" r="5" fill="#eab308" stroke="#000" strokeWidth="1.5" />

                    <g transform={`translate(${((mapX(softSandMarginM) + realXPos) / 2)}, 110)`}>
                      <line x1="0" y1="-12" x2="0" y2="12" stroke="#1e293b" strokeWidth="2.5" />
                      <line x1="-10" y1="10" x2="10" y2="10" stroke="#1e293b" strokeWidth="2.5" />
                      <rect x="-2" y="-15" width="4" height="6" rx="1" fill="#0f172a" />
                      <rect x="-12" y="7" width="4" height="6" rx="1" fill="#0f172a" />
                      <rect x="8" y="7" width="4" height="6" rx="1" fill="#0f172a" />
                      <path d="M 0,0 Q 8,-4 14,-2" fill="none" stroke="#2563eb" strokeWidth="3" />
                      <circle cx="0" cy="0" r="3" fill="#ef4444" />
                    </g>

                    <text
                      x={(mapX(softSandMarginM) + realXPos) / 2}
                      y="140"
                      fill="#9a3412"
                      fontSize="9"
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      Piste de cours {realRollableWidthM} m
                    </text>
                  </g>
                )}
              </g>
            )}

            {/* 4. Océan & Ligne d'eau RÉELLE (avec surcote / sous-cote) */}
            <rect
              x={realXPos}
              y="0"
              width={Math.max(0, 700 - realXPos)}
              height="245"
              fill={`url(#${oceanGradId})`}
            />

            {/* 4b. ZONE D'ÉCART ENTRE THÉORIQUE SHOM ET RÉEL (SURCOTE / SOUS-COTE) */}
            {hasWaterDiff && (
              <g>
                <rect
                  x={Math.min(realXPos, theoXPos)}
                  y="0"
                  width={Math.abs(theoXPos - realXPos)}
                  height="245"
                  fill={`url(#${isSurcote ? surcoteZonePatternId : souscoteZonePatternId})`}
                />
                {Math.abs(theoXPos - realXPos) >= 14 && (
                  <text
                    x={(realXPos + theoXPos) / 2}
                    y="125"
                    fill={isSurcote ? '#fff7ed' : '#065f46'}
                    fontSize="8.5"
                    fontWeight="900"
                    transform={`rotate(-90 ${(realXPos + theoXPos) / 2},125)`}
                    textAnchor="middle"
                    style={{
                      paintOrder: 'stroke',
                      stroke: isSurcote ? '#9a3412' : '#ecfdf5',
                      strokeWidth: '2px',
                    }}
                  >
                    {isSurcote ? `SURCOTE ${deltaBeachM} m` : `SOUS-COTE +${deltaBeachM} m`}
                  </text>
                )}
              </g>
            )}

            {/* Vaguelettes et trait d'eau RÉEL */}
            <path
              d={`M ${realXPos},0 Q ${realXPos + 4},30 ${realXPos},60 T ${realXPos},120 T ${realXPos},180 T ${realXPos},245`}
              fill="none"
              stroke={isSurcote ? '#ffedd5' : isSouscote ? '#d1fae5' : '#ffffff'}
              strokeWidth="3.5"
              opacity="0.95"
            />
            <text
              x={Math.min(682, Math.max(realXPos, theoXPos) + 26)}
              y="125"
              fill="#ffffff"
              fontSize="10.5"
              fontWeight="900"
              transform={`rotate(90 ${Math.min(682, Math.max(realXPos, theoXPos) + 26)},125)`}
              textAnchor="middle"
            >
              MER RÉELLE ({realWaterHeightM.toFixed(2).replace('.', ',')} m)
            </text>

            {/* 4c. LIGNE D'EAU THÉORIQUE SHOM (pointillés jaune/ambre très visibles) */}
            <line
              x1={theoXPos}
              y1="0"
              x2={theoXPos}
              y2="245"
              stroke="#0f172a"
              strokeWidth="3.2"
              strokeDasharray="6 4"
              opacity="0.45"
            />
            <line
              x1={theoXPos}
              y1="0"
              x2={theoXPos}
              y2="245"
              stroke="#fde047"
              strokeWidth="2.2"
              strokeDasharray="6 4"
            />
            <rect
              x={Math.min(605, Math.max(40, theoXPos - 54))}
              y="6"
              width="108"
              height="16"
              rx="4"
              fill="rgba(15, 23, 42, 0.85)"
              stroke="#fde047"
              strokeWidth="1"
            />
            <text
              x={Math.min(659, Math.max(94, theoXPos))}
              y="17"
              fill="#fef08a"
              fontSize="7.8"
              fontWeight="900"
              textAnchor="middle"
            >
              Théo SHOM {theoWaterHeightM.toFixed(2).replace('.', ',')} m
            </text>

            {/* Étiquette Ligne d'eau Réelle si distincte du SHOM */}
            {hasWaterDiff && (
              <g>
                <rect
                  x={Math.min(600, Math.max(36, realXPos - 58))}
                  y="25"
                  width="116"
                  height="16"
                  rx="4"
                  fill={isSurcote ? '#9a3412' : '#065f46'}
                  stroke="#ffffff"
                  strokeWidth="1"
                />
                <text
                  x={Math.min(658, Math.max(94, realXPos))}
                  y="36"
                  fill="#ffffff"
                  fontSize="7.8"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  Réel {realWaterHeightM.toFixed(2).replace('.', ',')} m ({appliedDeltaCm > 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm)
                </text>
              </g>
            )}

            {/* 5. Seuil nominal école (Ligne repère à 4,50 m) */}
            <line
              x1={mapX(nominalThresholdX)}
              y1="0"
              x2={mapX(nominalThresholdX)}
              y2="245"
              stroke="#b45309"
              strokeWidth="1.6"
              strokeDasharray="6 3"
            />
            <text
              x={mapX(nominalThresholdX) - 4}
              y="198"
              fill="#78350f"
              fontSize="8"
              fontWeight="900"
              textAnchor="end"
            >
              Seuil école {settings.L} m (X = {nominalThresholdX} m)
            </text>

            {/* 6. Points GPS réels de Jérôme projetés */}
            {logs.slice(0, 5).map((l, idx) => {
              const gpsX = calculateWaterLineXExact(l.theoreticalWaterHeightM);
              return (
                <g key={`log-aerial-${idx}`}>
                  <circle cx={mapX(gpsX)} cy={52 + idx * 32} r="4.5" fill="#f59e0b" stroke="#000" strokeWidth="1.5" />
                  <text x={mapX(gpsX) + 7} y={55 + idx * 32} fill="#0f172a" fontSize="7.5" fontWeight="800">
                    GPS {l.author} ({l.theoreticalWaterHeightM}m)
                  </text>
                </g>
              );
            })}

            {/* 7. Grandes cotations en bas */}
            <line x1="30" y1="216" x2={realXPos} y2="216" stroke="#475569" strokeWidth="1.2" />
            <circle cx="30" cy="216" r="2.5" fill="#475569" />
            <circle cx={realXPos} cy="216" r="2.5" fill="#475569" />
            <text x={(30 + realXPos) / 2} y="211" fill="#475569" fontSize="8.5" fontWeight="800" textAnchor="middle">
              Plage réelle découverte : {realDiscoveredX} m (Théo SHOM : {theoDiscoveredX} m)
            </text>

            {realRollableWidthM > 20 && (
              <g>
                <line x1={mapX(softSandMarginM)} y1="232" x2={realXPos} y2="232" stroke="#16a34a" strokeWidth="2.5" />
                <circle cx={mapX(softSandMarginM)} cy="232" r="3.5" fill="#16a34a" />
                <circle cx={realXPos} cy="232" r="3.5" fill="#16a34a" />
                <text x={(mapX(softSandMarginM) + realXPos) / 2} y="236" fill="#15803d" fontSize="10" fontWeight="900" textAnchor="middle">
                  🏁 LARGEUR ROULABLE RÉELLE : {realRollableWidthM} MÈTRES
                  {deltaBeachM !== 0 ? ` (${deltaBeachM > 0 ? `+${deltaBeachM}` : deltaBeachM} m vs SHOM)` : ''}
                </text>
              </g>
            )}
          </svg>
        </div>
      ) : (
        /* REPRÉSENTATION 2 : COUPE ALTIMÉTRIQUE EN SECTION */
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.72rem', color: '#64748b' }}>
            <span>Coupe transversale (Remarque : hauteur verticalement rehaussée pour distinguer les cotes)</span>
            <span style={{ fontWeight: 700, color: '#0369a1' }}>Pente réelle : 1,15 % (0,66° seulement)</span>
          </div>

          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            style={{ width: '100%', minWidth: '560px', height: 'auto', display: 'block' }}
          >
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="#f0f9ff" />

            {[1, 2, 3, 4, 5, 6, 7].map(alt => {
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
              y={padT - 8}
              fill="#0369a1"
              fontSize="8"
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

            <polygon points={waterPolygon} fill="rgba(14, 165, 233, 0.45)" />
            <polygon points={sandPolygon} fill="#fef3c7" stroke="#d97706" strokeWidth="2" />

            {/* Seuil 4,50 m */}
            <line
              x1={padL}
              x2={padL + plotW}
              y1={mapY(settings.L)}
              y2={mapY(settings.L)}
              stroke="#b45309"
              strokeWidth="1.5"
              strokeDasharray="5 3"
            />
            <text x={padL + 5} y={mapY(settings.L) - 4} fill="#b45309" fontSize="8.5" fontWeight="800">
              Seuil nominal école {settings.L} m (X = {nominalThresholdX} m · Utile : {nominalWidthM} m)
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
            <circle cx={theoXPos} cy={theoYPos} r="4.2" fill="#fde047" stroke="#0f172a" strokeWidth="1.4" />
            <text
              x={mapX(460) - 4}
              y={isSurcote ? theoYPos + 11 : theoYPos - 5}
              fill="#854d0e"
              fontSize="8.5"
              fontWeight="800"
              textAnchor="end"
            >
              Théo SHOM : {theoWaterHeightM.toFixed(2).replace('.', ',')} m (X = {theoDiscoveredX} m)
            </text>

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
            <text
              x={Math.min(mapX(460) - 20, Math.max(realXPos, mapX(95)))}
              y={Math.max(padT + 12, isSurcote ? realYPos - 7 : realYPos + 12)}
              fill={isSurcote ? '#c2410c' : isSouscote ? '#047857' : '#0369a1'}
              fontSize="9"
              fontWeight="900"
              textAnchor="middle"
            >
              Ligne réelle : {realWaterHeightM.toFixed(2).replace('.', ',')} m (X = {realDiscoveredX} m
              {appliedDeltaCm !== 0 ? ` · ${appliedDeltaCm > 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm` : ''})
            </text>

            {/* Cote utile */}
            {realRollableWidthM > 20 && (
              <g>
                <line x1={mapX(softSandMarginM)} x2={realXPos} y1={padT + plotH + 20} y2={padT + plotH + 20} stroke="#15803d" strokeWidth="2" />
                <circle cx={mapX(softSandMarginM)} cy={padT + plotH + 20} r="3" fill="#15803d" />
                <circle cx={realXPos} cy={padT + plotH + 20} r="3" fill="#15803d" />
                <text x={(mapX(softSandMarginM) + realXPos) / 2} y={padT + plotH + 33} fill="#15803d" fontSize="9.5" fontWeight="900" textAnchor="middle">
                  BANDE ROULABLE RÉELLE : {realRollableWidthM} MÈTRES (Théo SHOM : {theoRollableWidthM} m)
                </text>
              </g>
            )}

            {/* Repères d'axe X */}
            <text x={mapX(0)} y={padT + plotH + 10} fill="#64748b" fontSize="8" textAnchor="middle">Dune (0m)</text>
            <text x={mapX(softSandMarginM)} y={padT + plotH + 10} fill="#b45309" fontSize="8" textAnchor="middle">Sable mou ({softSandMarginM}m)</text>
            <text x={mapX(200)} y={padT + plotH + 10} fill="#64748b" fontSize="8" textAnchor="middle">200m</text>
            <text x={mapX(350)} y={padT + plotH + 10} fill="#64748b" fontSize="8" textAnchor="middle">350m</text>
            <text x={mapX(460)} y={padT + plotH + 10} fill="#64748b" fontSize="8" textAnchor="middle">Bas estran (460m)</text>
          </svg>
        </div>
      )}

      {/* PANNEAU DE CONTRÔLE INTERACTIF & RÉGLAGES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
        {/* KPI 1 : Largeur de roulage nette */}
        <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#166534' }}>
            🏎️ Largeur utile de roulage (Réel)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 900, color: '#15803d', fontFamily: 'monospace' }}>
              {realRollableWidthM}
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#166534' }}>mètres</span>
            {deltaBeachM !== 0 && (
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 900,
                  color: deltaBeachM < 0 ? '#c2410c' : '#047857',
                }}
              >
                ({deltaBeachM > 0 ? `+${deltaBeachM}` : deltaBeachM} m vs SHOM)
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#166534', marginTop: '2px' }}>
            Réel : <strong>{realDiscoveredX} m</strong> (SHOM : <strong>{theoDiscoveredX} m</strong>) · Marge haute : <strong>{softSandMarginM} m</strong>
          </div>
          {latestGpsDuneEval?.widthFromDuneM != null && (
            <div style={{ fontSize: '0.70rem', color: '#0369a1', fontWeight: 700, marginTop: '4px' }}>
              GPS Dune → Mer ({logs[0]?.timeStr}) : <strong>{latestGpsDuneEval.widthFromDuneM} m</strong>
              {cadreGeom.corridorLengthM != null && ` · Longueur zone : ${cadreGeom.corridorLengthM} m`}
            </div>
          )}
          <div style={{ fontSize: '0.70rem', color: '#15803d', fontWeight: 700, marginTop: '4px' }}>
            {realRollableWidthM >= 180 ? '✓ Idéal grand circuit (12 chars)' : realRollableWidthM >= 100 ? '⚡ Circuit compact' : '⛔ Trop étroit (< 100 m)'}
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
            max="100"
            step="5"
            value={softSandMarginM}
            onChange={e => setSoftSandMarginM(Number(e.target.value))}
            style={{ width: '100%', marginTop: '6px', cursor: 'pointer' }}
          />
          <div style={{ fontSize: '0.68rem', color: '#b45309', marginTop: '4px', lineHeight: 1.35 }}>
            <strong>Réglage acté : 50 m</strong> (synchronisé avec le Cadre de Roulage ci-dessus ; curseur libre si vous souhaitez tester un autre scénario).
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
                Modèle actif (pression / REX) : <strong>{modelDeltaCm > 0 ? `+${modelDeltaCm}` : modelDeltaCm} cm</strong>
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
