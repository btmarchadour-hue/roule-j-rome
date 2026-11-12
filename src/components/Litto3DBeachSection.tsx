import React, { useState, useMemo } from 'react';
import { AppSettings, GpsWaterlineLog, TidePoint } from '../types';
import { hAt } from '../utils/tides';

interface Litto3DBeachSectionProps {
  settings: AppSettings;
  EX: TidePoint[];
  logs?: GpsWaterlineLog[];
}

export const Litto3DBeachSection: React.FC<Litto3DBeachSectionProps> = ({
  settings,
  EX,
  logs = [],
}) => {
  // Heure actuelle en minute UTC
  const nowUtcMinute = Math.floor(Date.now() / 60000);
  const currentTideHeight = hAt(nowUtcMinute, EX) ?? settings.L;

  // Curseur de surcote simulée (-30 cm à +50 cm)
  const [simulatedSurcoteCm, setSimulatedSurcoteCm] = useState<number>(0);
  // Hauteur d'eau interactive (par défaut la marée actuelle)
  const [testWaterHeightM, setTestWaterHeightM] = useState<number>(
    Number(currentTideHeight.toFixed(2))
  );

  // Marge de sable sec/mou en haut de plage (paramétrable, PAS de décision figée imposée !)
  const [softSandMarginM, setSoftSandMarginM] = useState<number>(50);

  // Mode d'affichage visuel : 'aerial' (Vue du dessus / Piste de char) ou 'profile' (Coupe transversale)
  const [viewMode, setViewMode] = useState<'aerial' | 'profile'>('aerial');

  // Hauteur effective avec surcote simulée
  const effectiveWaterHeightM = testWaterHeightM + simulatedSurcoteCm / 100;

  /**
   * Modèle Altimétrique Litto3D Finistère (IGN / SHOM) pour Lestrevet / Pentrez :
   * X = 0 m : Pied de dune / ganivelles (Z = 7.20 m)
   * X = 40 m : Cordon supérieur galets / sable sec (Z = 6.20 m)
   * X = 75 m : Laisse des pleines mers (Z = 5.30 m)
   * X = 160 m : Seuil nominal école 4,50 m
   * X = 220 m : Plateau sable dur (Z = 3.90 m)
   * X = 280 m : Cœur zone de roulage (Z = 3.25 m)
   * X = 340 m : Bas estran (Z = 2.65 m)
   * X = 400 m : Basse mer de vive-eau (Z = 1.95 m)
   * X = 460 m : Zéro hydrographique / basse mer exceptionnelle (Z = 1.25 m)
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

  // Calcul de la distance totale découverte X (depuis la dune) selon la hauteur d'eau Z
  const calculateWaterLineX = (zWater: number): number => {
    if (zWater >= 7.2) return 0;
    if (zWater <= 1.25) return 460;

    for (let i = 0; i < beachProfile.length - 1; i++) {
      const p1 = beachProfile[i];
      const p2 = beachProfile[i + 1];
      if (zWater <= p1.z && zWater >= p2.z) {
        const ratio = (p1.z - zWater) / (p1.z - p2.z);
        return Math.round(p1.x + ratio * (p2.x - p1.x));
      }
    }
    return 200;
  };

  const totalDiscoveredX = calculateWaterLineX(effectiveWaterHeightM);
  // Largeur utile = distance totale - marge de sable mou choisie
  const usefulRollableWidthM = Math.max(0, totalDiscoveredX - softSandMarginM);

  // Position et largeur utile au seuil école nominal (ex: 4,50 m)
  const nominalThresholdX = calculateWaterLineX(settings.L);
  const nominalWidthM = Math.max(0, nominalThresholdX - softSandMarginM);

  // Dimensions SVG
  const svgW = 700;
  const svgH = 260;
  const padL = 54;
  const padR = 25;
  const padT = 25;
  const padB = 45;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const mapX = (x: number) => padL + (x / 460) * plotW;
  const mapY = (z: number) => padT + plotH - ((z - 0.5) / 7.5) * plotH;

  // Polygone du sol en coupe
  const sandPolygon = [
    `${mapX(0)},${mapY(0.5)}`,
    ...beachProfile.map(p => `${mapX(p.x)},${mapY(p.z)}`),
    `${mapX(460)},${mapY(0.5)}`,
  ].join(' ');

  // Polygone d'eau en coupe
  const waterXPos = mapX(totalDiscoveredX);
  const waterYPos = mapY(effectiveWaterHeightM);
  const waterPolygon = [
    `${waterXPos},${waterYPos}`,
    `${mapX(460)},${waterYPos}`,
    `${mapX(460)},${mapY(0.5)}`,
    `${waterXPos},${mapY(0.5)}`,
  ].join(' ');

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
              Topographie Littorale & Modèle Litto3D (IGN / SHOM)
            </span>
            <span style={{ fontSize: '0.64rem', background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>
              Open Data Lidar
            </span>
          </div>
          <h3 style={{ margin: '3px 0 0', fontSize: '1.20rem', fontWeight: 900, color: '#0f172a' }}>
            Largeur de Plage & Piste de Roulage en Direct
          </h3>
        </div>

        {/* Sélecteur de représentation : Vue Aérienne (Piste) vs Coupe Géologique */}
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

      {/* REPRÉSENTATION 1 : VUE AÉRIENNE DE LA PISTE (VUE DU DESSUS) - HYPER INTUITIVE */}
      {viewMode === 'aerial' ? (
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.72rem', color: '#64748b' }}>
            <span>Vue plongeante orientée vers le large (Dune à gauche ➔ Mer à droite)</span>
            <span style={{ fontWeight: 700, color: '#0369a1' }}>Échelle réelle 1:1 en largeur</span>
          </div>

          <svg
            viewBox="0 0 700 240"
            style={{ width: '100%', minWidth: '560px', height: 'auto', display: 'block', borderRadius: '8px', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06)' }}
          >
            <defs>
              {/* Motif sable sec */}
              <pattern id="drySandPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="#fef08a" />
                <circle cx="5" cy="5" r="1" fill="#facc15" />
                <circle cx="15" cy="15" r="1.2" fill="#eab308" />
              </pattern>
              {/* Motif traces de roues char à voile */}
              <pattern id="tracksPattern" width="40" height="30" patternUnits="userSpaceOnUse">
                <line x1="0" y1="8" x2="40" y2="8" stroke="#ca8a04" strokeWidth="1" strokeDasharray="6 4" opacity="0.45" />
                <line x1="0" y1="22" x2="40" y2="22" stroke="#ca8a04" strokeWidth="1" strokeDasharray="6 4" opacity="0.45" />
              </pattern>
              {/* Dégradé vagues */}
              <linearGradient id="oceanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="30%" stopColor="#0284c7" />
                <stop offset="100%" stopColor="#0369a1" />
              </linearGradient>
            </defs>

            {/* 1. Zone Dune & Oyats (0 m à 15 m) */}
            <rect x="0" y="0" width="30" height="240" fill="#a3e635" />
            <line x1="30" y1="0" x2="30" y2="240" stroke="#4d7c0f" strokeWidth="2" strokeDasharray="3 3" />
            <text x="15" y="125" fill="#365314" fontSize="10" fontWeight="900" transform="rotate(-90 15,125)" textAnchor="middle">
              DUNE / HERBE
            </text>

            {/* 2. Zone de sable sec / haut de plage (15 m à X_marge) */}
            {softSandMarginM > 0 && (
              <g>
                <rect
                  x="30"
                  y="0"
                  width={Math.max(0, mapX(softSandMarginM) - 30)}
                  height="240"
                  fill="#fef9c3"
                />
                {/* Hachures de mise en garde sable mou */}
                <rect
                  x="30"
                  y="0"
                  width={Math.max(0, mapX(softSandMarginM) - 30)}
                  height="240"
                  fill="url(#drySandPattern)"
                  opacity="0.35"
                />
                <line
                  x1={mapX(softSandMarginM)}
                  y1="0"
                  x2={mapX(softSandMarginM)}
                  y2="240"
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

            {/* 3. Piste de roulage en sable dur mouillé (De softSandMarginM à waterXPos) */}
            {waterXPos > mapX(softSandMarginM) && (
              <g>
                {/* Fond sable dur compacté */}
                <rect
                  x={mapX(softSandMarginM)}
                  y="0"
                  width={Math.max(0, waterXPos - mapX(softSandMarginM))}
                  height="240"
                  fill="#fde68a"
                />
                {/* Traces de roulage */}
                <rect
                  x={mapX(softSandMarginM)}
                  y="0"
                  width={Math.max(0, waterXPos - mapX(softSandMarginM))}
                  height="240"
                  fill="url(#tracksPattern)"
                />

                {/* Circuit de char à voile matérialisé si la plage est assez large */}
                {usefulRollableWidthM >= 80 && (
                  <g opacity="0.85">
                    {/* Trajectoire ovale de cours */}
                    <rect
                      x={mapX(softSandMarginM) + 15}
                      y="35"
                      width={Math.max(20, waterXPos - mapX(softSandMarginM) - 30)}
                      height="170"
                      rx="30"
                      fill="none"
                      stroke="#ea580c"
                      strokeWidth="2"
                      strokeDasharray="8 6"
                    />

                    {/* Bouée / Balise d'empannage Haute */}
                    <circle cx={mapX(softSandMarginM) + 25} cy="70" r="5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
                    <circle cx={mapX(softSandMarginM) + 25} cy="170" r="5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />

                    {/* Bouée / Balise d'empannage Basse (près de l'eau) */}
                    <circle cx={waterXPos - 25} cy="70" r="5" fill="#eab308" stroke="#000" strokeWidth="1.5" />
                    <circle cx={waterXPos - 25} cy="170" r="5" fill="#eab308" stroke="#000" strokeWidth="1.5" />

                    {/* Dessin d'un char à voile stylisé vu du dessus */}
                    <g transform={`translate(${((mapX(softSandMarginM) + waterXPos) / 2)}, 110)`}>
                      {/* Châssis */}
                      <line x1="0" y1="-12" x2="0" y2="12" stroke="#1e293b" strokeWidth="2.5" />
                      <line x1="-10" y1="10" x2="10" y2="10" stroke="#1e293b" strokeWidth="2.5" />
                      {/* 3 Roues */}
                      <rect x="-2" y="-15" width="4" height="6" rx="1" fill="#0f172a" />
                      <rect x="-12" y="7" width="4" height="6" rx="1" fill="#0f172a" />
                      <rect x="8" y="7" width="4" height="6" rx="1" fill="#0f172a" />
                      {/* Bôme & Voile gonflée par le vent */}
                      <path d="M 0,0 Q 8,-4 14,-2" fill="none" stroke="#2563eb" strokeWidth="3" />
                      <circle cx="0" cy="0" r="3" fill="#ef4444" />
                    </g>

                    <text
                      x={(mapX(softSandMarginM) + waterXPos) / 2}
                      y="140"
                      fill="#9a3412"
                      fontSize="9"
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      Piste de cours {usefulRollableWidthM} m
                    </text>
                  </g>
                )}
              </g>
            )}

            {/* 4. Océan & Ligne d'eau */}
            <rect
              x={waterXPos}
              y="0"
              width={Math.max(0, 700 - waterXPos)}
              height="240"
              fill="url(#oceanGrad)"
            />

            {/* Vaguelettes et écume */}
            <path
              d={`M ${waterXPos},0 Q ${waterXPos + 4},30 ${waterXPos},60 T ${waterXPos},120 T ${waterXPos},180 T ${waterXPos},240`}
              fill="none"
              stroke="#ffffff"
              strokeWidth="3.5"
              opacity="0.9"
            />
            <text
              x={Math.min(680, waterXPos + 35)}
              y="125"
              fill="#ffffff"
              fontSize="11"
              fontWeight="900"
              transform={`rotate(90 ${Math.min(680, waterXPos + 35)},125)`}
              textAnchor="middle"
            >
              MER ({effectiveWaterHeightM.toFixed(2)} m)
            </text>

            {/* 5. Seuil nominal école (Ligne repère à 4,50 m) */}
            <line
              x1={mapX(nominalThresholdX)}
              y1="0"
              x2={mapX(nominalThresholdX)}
              y2="240"
              stroke="#b45309"
              strokeWidth="1.8"
              strokeDasharray="6 3"
            />
            <text
              x={mapX(nominalThresholdX) - 4}
              y="20"
              fill="#78350f"
              fontSize="8"
              fontWeight="900"
              textAnchor="end"
            >
              Seuil école {settings.L} m (X = {nominalThresholdX} m)
            </text>

            {/* 6. Points GPS réels de Jérôme projetés */}
            {logs.slice(0, 5).map((l, idx) => {
              const gpsX = calculateWaterLineX(l.theoreticalWaterHeightM);
              return (
                <g key={`log-aerial-${idx}`}>
                  <circle cx={mapX(gpsX)} cy={45 + idx * 35} r="4.5" fill="#f59e0b" stroke="#000" strokeWidth="1.5" />
                  <text x={mapX(gpsX) + 7} y={48 + idx * 35} fill="#0f172a" fontSize="7.5" fontWeight="800">
                    GPS {l.author} ({l.theoreticalWaterHeightM}m)
                  </text>
                </g>
              );
            })}

            {/* 7. Grandes cotations en bas */}
            {/* Cote 1 : Distance totale découverte */}
            <line x1="30" y1="218" x2={waterXPos} y2="218" stroke="#475569" strokeWidth="1.2" />
            <circle cx="30" cy="218" r="2.5" fill="#475569" />
            <circle cx={waterXPos} cy="218" r="2.5" fill="#475569" />
            <text x={(30 + waterXPos) / 2} y="214" fill="#475569" fontSize="8.5" fontWeight="800" textAnchor="middle">
              Plage totale découverte : {totalDiscoveredX} mètres
            </text>

            {/* Cote 2 : Bande utile de roulage */}
            {usefulRollableWidthM > 20 && (
              <g>
                <line x1={mapX(softSandMarginM)} y1="230" x2={waterXPos} y2="230" stroke="#16a34a" strokeWidth="2.5" />
                <circle cx={mapX(softSandMarginM)} cy="230" r="3.5" fill="#16a34a" />
                <circle cx={waterXPos} cy="230" r="3.5" fill="#16a34a" />
                <text x={(mapX(softSandMarginM) + waterXPos) / 2} y="234" fill="#15803d" fontSize="10.5" fontWeight="900" textAnchor="middle">
                  🏁 LARGEUR ROULABLE PISTE : {usefulRollableWidthM} MÈTRES
                </text>
              </g>
            )}
          </svg>
        </div>
      ) : (
        /* REPRÉSENTATION 2 : COUPE ALTIMÉTRIQUE EN SECTION (GÉOMÉTRIE RECTIFIÉE) */
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

            {/* ÉCHELLE EN ORDONNÉE (AXE Y : ALTITUDE Z EN MÈTRES - DEMANDE BENOÎT) */}
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

            <polygon points={waterPolygon} fill="rgba(14, 165, 233, 0.45)" />
            <polygon points={sandPolygon} fill="#fef3c7" stroke="#d97706" strokeWidth="2" />

            {/* Ligne d'eau */}
            <line
              x1={waterXPos}
              x2={mapX(460)}
              y1={waterYPos}
              y2={waterYPos}
              stroke="#0284c7"
              strokeWidth="2.5"
              strokeDasharray="4 2"
            />

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

            {/* Trait d'eau actuel */}
            <circle cx={waterXPos} cy={waterYPos} r="4.5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
            <text x={Math.min(mapX(460) - 20, Math.max(waterXPos, mapX(60)))} y={Math.max(padT + 12, waterYPos - 8)} fill="#0369a1" fontSize="9" fontWeight="800" textAnchor="middle">
              Ligne d'eau : {effectiveWaterHeightM.toFixed(2)} m (X = {totalDiscoveredX} m)
            </text>

            {/* Cote utile */}
            {usefulRollableWidthM > 20 && (
              <g>
                <line x1={mapX(softSandMarginM)} x2={waterXPos} y1={padT + plotH + 18} y2={padT + plotH + 18} stroke="#15803d" strokeWidth="2" />
                <circle cx={mapX(softSandMarginM)} cy={padT + plotH + 18} r="3" fill="#15803d" />
                <circle cx={waterXPos} cy={padT + plotH + 18} r="3" fill="#15803d" />
                <text x={(mapX(softSandMarginM) + waterXPos) / 2} y={padT + plotH + 30} fill="#15803d" fontSize="10" fontWeight="900" textAnchor="middle">
                  BANDE ROULABLE UTILE : {usefulRollableWidthM} MÈTRES (Marge sable mou : {softSandMarginM} m)
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

      {/* PANNEAU DE CONTRÔLE INTERACTIF & RÉGLAGE DE LA MARGE SABLE MOU */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '14px' }}>
        {/* KPI 1 : Largeur de roulage nette */}
        <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#166534' }}>
            🏎️ Largeur utile de roulage
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 900, color: '#15803d', fontFamily: 'monospace' }}>
              {usefulRollableWidthM}
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#166534' }}>mètres</span>
          </div>
          <div style={{ fontSize: '0.70rem', color: '#166534', marginTop: '2px' }}>
            (Plage découverte : <strong>{totalDiscoveredX} m</strong> · Marge haute : <strong>{softSandMarginM} m</strong>)
          </div>
          <div style={{ fontSize: '0.70rem', color: '#15803d', fontWeight: 700, marginTop: '4px' }}>
            {usefulRollableWidthM >= 180 ? '✓ Idéal grand circuit (12 chars)' : usefulRollableWidthM >= 100 ? '⚡ Circuit compact' : '⛔ Trop étroit (< 100 m)'}
          </div>
        </div>

        {/* CONTRÔLE 2 : Curseur de marge sable sec / mou (NON FIGÉ - LAISSÉ À L'ARBITRAGE) */}
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
            <strong>Curseur ajustable :</strong> Ne pas figer cette valeur arbitrairement. À arbitrer avec Jérôme selon l'état du haut de plage.
          </div>
        </div>

        {/* CONTRÔLE 3 : Curseur de surcote simulée */}
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', fontWeight: 900, textTransform: 'uppercase', color: '#475569' }}>
            <span>🌪️ Simuler une surcote vent</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.80rem', color: simulatedSurcoteCm !== 0 ? '#0284c7' : '#64748b' }}>
              {simulatedSurcoteCm >= 0 ? `+${simulatedSurcoteCm}` : simulatedSurcoteCm} cm
            </span>
          </div>
          <input
            type="range"
            min="-30"
            max="50"
            step="5"
            value={simulatedSurcoteCm}
            onChange={e => setSimulatedSurcoteCm(Number(e.target.value))}
            style={{ width: '100%', marginTop: '6px', cursor: 'pointer' }}
          />
          <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '4px' }}>
            {simulatedSurcoteCm !== 0
              ? `Déplace la ligne d'eau de ~${Math.round(Math.abs(simulatedSurcoteCm) * 0.87)} m sur le sable.`
              : 'Pente 1,15 % : 1 cm d\'eau vertical = ~87 cm de plage.'}
          </div>
        </div>
      </div>
    </div>
  );
};
