import React, { useId } from 'react';

export function estimateSvgPillWidth(text: string, charW = 5.4, pad = 22): number {
  return Math.ceil(text.length * charW + pad);
}

export interface BeachPisteDiagramProps {
  softSandMarginM: number;
  theoWaterHeightM: number;
  /** Hauteur d'eau issue du Modèle Réel Empirique (+ éventuel curseur simulation) */
  realWaterHeightM: number;
  appliedDeltaCm: number;
  theoExactX: number;
  /** Distance dune -> bord d'eau selon le Modèle Réel Empirique (m) */
  realExactX: number;
  theoRollableWidthM: number;
  /** Largeur roulable utile selon le Modèle Réel Empirique (m) */
  realRollableWidthM: number;
  deltaBeachM: number;
  thresholdHeightM: number;
  thresholdExactX: number;
  thresholdLabelPrefix?: string;
  thresholdTone?: 'amber' | 'red';
  isWithinThreshold?: boolean;
  /** Libellé synthétique de calibration empirique (ex: "45% terrain dès 20/11") */
  empiricalBasisLabel?: string;
  minWidth?: string;
}

export const BeachPisteDiagram: React.FC<BeachPisteDiagramProps> = ({
  softSandMarginM,
  theoWaterHeightM,
  realWaterHeightM,
  appliedDeltaCm,
  theoExactX,
  realExactX,
  theoRollableWidthM,
  realRollableWidthM,
  deltaBeachM,
  thresholdHeightM,
  thresholdExactX,
  thresholdLabelPrefix = 'Seuil',
  thresholdTone = 'amber',
  isWithinThreshold = true,
  empiricalBasisLabel,
  minWidth = '540px',
}) => {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');

  const aerialDuneW = 34;
  const aerialMaxX = 690;
  const aerialPlotW = aerialMaxX - aerialDuneW;
  const mapAerialX = (m: number) =>
    aerialDuneW + (Math.max(0, Math.min(460, m)) / 460) * aerialPlotW;

  const aSoftX = mapAerialX(softSandMarginM);
  const aTheoX = mapAerialX(theoExactX);
  const aRealX = mapAerialX(realExactX);
  const aSeuilX = mapAerialX(thresholdExactX);
  const aWaterDiffPx = Math.abs(aRealX - aTheoX);
  const aHasWaterDiff = aWaterDiffPx >= 1.2;

  const isSurcote = appliedDeltaCm > 0;
  const isSouscote = appliedDeltaCm < 0;

  const realHeightLabel = realWaterHeightM.toFixed(2).replace('.', ',');
  const theoHeightLabel = theoWaterHeightM.toFixed(2).replace('.', ',');
  const thresholdHeightLabel = thresholdHeightM.toFixed(2).replace('.', ',').replace(/,00$/, '');

  // Placement anti-collision des 2 badges d'en-tête (Mer empirique vs Seuil)
  const waterBadgeText =
    appliedDeltaCm !== 0
      ? `Mer empirique ${realHeightLabel} m (SHOM ${theoHeightLabel} m · ${appliedDeltaCm > 0 ? `+${appliedDeltaCm}` : appliedDeltaCm} cm)`
      : `Mer ${realHeightLabel} m (SHOM = Empirique)`;
  const waterBadgeW = estimateSvgPillWidth(waterBadgeText, 5.2, 20);
  const waterBadgeCx = Math.max(
    aerialDuneW + waterBadgeW / 2,
    Math.min(694 - waterBadgeW / 2, aRealX)
  );
  const waterBadgeLeft = waterBadgeCx - waterBadgeW / 2;
  const waterBadgeRight = waterBadgeCx + waterBadgeW / 2;

  const seuilBadgeText = `${thresholdLabelPrefix} ${thresholdHeightLabel} m (${Math.round(thresholdExactX)} m)`;
  const seuilBadgeW = estimateSvgPillWidth(seuilBadgeText, 5.2, 20);
  let seuilBadgeCx = Math.max(
    aerialDuneW + seuilBadgeW / 2,
    Math.min(694 - seuilBadgeW / 2, aSeuilX)
  );
  const gapMin = 10;
  if (
    seuilBadgeCx - seuilBadgeW / 2 < waterBadgeRight + gapMin &&
    seuilBadgeCx + seuilBadgeW / 2 > waterBadgeLeft - gapMin
  ) {
    const rightCandidate = waterBadgeRight + gapMin + seuilBadgeW / 2;
    const leftCandidate = waterBadgeLeft - gapMin - seuilBadgeW / 2;
    const preferRight = aSeuilX >= aRealX;
    if (preferRight && rightCandidate + seuilBadgeW / 2 <= 694) {
      seuilBadgeCx = rightCandidate;
    } else if (!preferRight && leftCandidate - seuilBadgeW / 2 >= aerialDuneW) {
      seuilBadgeCx = leftCandidate;
    } else if (rightCandidate + seuilBadgeW / 2 <= 694) {
      seuilBadgeCx = rightCandidate;
    } else {
      seuilBadgeCx = Math.max(aerialDuneW + seuilBadgeW / 2, leftCandidate);
    }
  }

  // Couleurs du repère seuil / limite Jérôme
  const thrStroke = thresholdTone === 'red' ? '#dc2626' : '#b45309';
  const thrFill =
    thresholdTone === 'red'
      ? isWithinThreshold
        ? '#fef2f2'
        : '#991b1b'
      : '#fef3c7';
  const thrTextFill =
    thresholdTone === 'red'
      ? isWithinThreshold
        ? '#991b1b'
        : '#ffffff'
      : '#92400e';
  const thrBorder = thresholdTone === 'red' ? '#dc2626' : '#d97706';

  // Placement optimal du label "MER" dans le plus grand espace océan dégagé
  const oceanStartX = Math.max(aRealX, aTheoX);
  const oceanLabelPlacement = (() => {
    const spans: Array<{ x1: number; x2: number }> =
      aSeuilX > oceanStartX + 8 && aSeuilX < 692
        ? [
            { x1: oceanStartX, x2: aSeuilX },
            { x1: aSeuilX, x2: 700 },
          ]
        : [{ x1: oceanStartX, x2: 700 }];
    const best = spans.reduce((acc, s) => (s.x2 - s.x1 > acc.x2 - acc.x1 ? s : acc), spans[0]);
    return { cx: (best.x1 + best.x2) / 2, width: best.x2 - best.x1 };
  })();

  // Cotation 1 (y = 248) : Bande roulable SHOM brut
  const shomBarText = `SHOM brut : ${theoRollableWidthM} m utiles`;
  const shomPillW = estimateSvgPillWidth(shomBarText, 5.4, 22);
  const shomPutRight = 694 - aTheoX >= shomPillW + 12;
  const shomCenterX = Math.max(
    aerialDuneW + shomPillW / 2,
    Math.min(694 - shomPillW / 2, (aSoftX + aTheoX) / 2)
  );

  // Cotation 2 (y = 284) : Bande roulable Modèle Réel Empirique
  const diffRollableM = realRollableWidthM - theoRollableWidthM;
  const diffLabel =
    diffRollableM > 0 ? `+${diffRollableM} m` : diffRollableM < 0 ? `${diffRollableM} m` : 'identique';
  const empBarText = `Modèle réel empirique : ${realRollableWidthM} m (${diffLabel}${
    empiricalBasisLabel ? ` · ${empiricalBasisLabel}` : ''
  })`;
  const empPillW = Math.min(395, estimateSvgPillWidth(empBarText, 5.25, 22));
  const empPutRight = 694 - aRealX >= empPillW + 12;
  const empCenterX = Math.max(
    aerialDuneW + empPillW / 2,
    Math.min(694 - empPillW / 2, (aSoftX + aRealX) / 2)
  );

  const empStroke = isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7';
  const empFill = isSurcote ? '#fff7ed' : isSouscote ? '#ecfdf5' : '#e0f2fe';
  const empText = isSurcote ? '#9a3412' : isSouscote ? '#065f46' : '#0c4a6e';

  const drySandPatternId = `bp-dry-${uid}`;
  const tracksPatternId = `bp-tracks-${uid}`;
  const oceanGradId = `bp-ocean-${uid}`;
  const surcoteZonePatternId = `bp-surcote-${uid}`;
  const souscoteZonePatternId = `bp-souscote-${uid}`;
  const aerialClipId = `bp-clip-${uid}`;

  return (
    <svg
      viewBox="0 0 700 310"
      style={{ width: '100%', minWidth, height: 'auto', display: 'block' }}
    >
      <defs>
        <clipPath id={aerialClipId}>
          <rect x="0" y="42" width="700" height="162" rx="8" />
        </clipPath>
        <pattern id={drySandPatternId} width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="#fef08a" />
          <circle cx="5" cy="5" r="1" fill="#facc15" />
          <circle cx="15" cy="15" r="1.2" fill="#eab308" />
        </pattern>
        <pattern id={tracksPatternId} width="40" height="30" patternUnits="userSpaceOnUse">
          <line x1="0" y1="8" x2="40" y2="8" stroke="#ca8a04" strokeWidth="1" strokeDasharray="6 4" opacity="0.38" />
          <line x1="0" y1="22" x2="40" y2="22" stroke="#ca8a04" strokeWidth="1" strokeDasharray="6 4" opacity="0.38" />
        </pattern>
        <linearGradient id={oceanGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="30%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
        <pattern id={surcoteZonePatternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(249, 115, 22, 0.42)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255, 237, 213, 0.85)" strokeWidth="2.2" />
        </pattern>
        <pattern id={souscoteZonePatternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width="8" height="8" fill="rgba(16, 185, 129, 0.32)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(209, 250, 229, 0.9)" strokeWidth="2.2" />
        </pattern>
      </defs>

      {/* ================================================================= */}
      {/* BANDE 1 (y = 0..42) : REPÈRES D'EN-TÊTE ANTI-COLLISION            */}
      {/* ================================================================= */}
      <path
        d={`M ${aRealX},42 L ${aRealX},34 L ${waterBadgeCx},34 L ${waterBadgeCx},28`}
        fill="none"
        stroke={isSurcote ? '#c2410c' : isSouscote ? '#047857' : '#0369a1'}
        strokeWidth="1.6"
      />
      <circle
        cx={aRealX}
        cy="42"
        r="3"
        fill={isSurcote ? '#ea580c' : isSouscote ? '#059669' : '#0284c7'}
      />
      <rect
        x={waterBadgeLeft}
        y="6"
        width={waterBadgeW}
        height="22"
        rx="6"
        fill={isSurcote ? '#9a3412' : isSouscote ? '#065f46' : '#0f172a'}
        stroke={isSurcote ? '#fb923c' : isSouscote ? '#34d399' : '#38bdf8'}
        strokeWidth="1.2"
      />
      <text
        x={waterBadgeCx}
        y="20.5"
        fill="#ffffff"
        fontSize="9"
        fontWeight="800"
        textAnchor="middle"
      >
        {waterBadgeText}
      </text>

      <path
        d={`M ${aSeuilX},42 L ${aSeuilX},34 L ${seuilBadgeCx},34 L ${seuilBadgeCx},28`}
        fill="none"
        stroke={thrStroke}
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
      <circle cx={aSeuilX} cy="42" r="2.8" fill={thrStroke} />
      <rect
        x={seuilBadgeCx - seuilBadgeW / 2}
        y="6"
        width={seuilBadgeW}
        height="22"
        rx="6"
        fill={thrFill}
        stroke={thrBorder}
        strokeWidth="1.2"
      />
      <text
        x={seuilBadgeCx}
        y="20.5"
        fill={thrTextFill}
        fontSize="9"
        fontWeight="800"
        textAnchor="middle"
      >
        {seuilBadgeText}
      </text>

      {/* ================================================================= */}
      {/* BANDE 2 (y = 42..204) : PLAN DE PLAGE (SHOM vs EMPIRIQUE)         */}
      {/* ================================================================= */}
      <g clipPath={`url(#${aerialClipId})`}>
        {/* 1. Dune & Oyats */}
        <rect x="0" y="42" width={aerialDuneW} height="162" fill="#a3e635" />
        <line x1={aerialDuneW} y1="42" x2={aerialDuneW} y2="204" stroke="#4d7c0f" strokeWidth="2" strokeDasharray="3 3" />
        <text x="17" y="123" fill="#365314" fontSize="9.5" fontWeight="900" transform="rotate(-90 17,123)" textAnchor="middle">
          DUNE
        </text>

        {/* 2. Sable sec / mou */}
        {softSandMarginM > 0 && (
          <g>
            <rect
              x={aerialDuneW}
              y="42"
              width={Math.max(0, aSoftX - aerialDuneW)}
              height="162"
              fill="#fef9c3"
            />
            <rect
              x={aerialDuneW}
              y="42"
              width={Math.max(0, aSoftX - aerialDuneW)}
              height="162"
              fill={`url(#${drySandPatternId})`}
              opacity="0.35"
            />
            <line
              x1={aSoftX}
              y1="42"
              x2={aSoftX}
              y2="204"
              stroke="#d97706"
              strokeWidth="1.8"
              strokeDasharray="4 2"
            />
            {aSoftX - aerialDuneW >= 110 ? (
              <g>
                <text
                  x={(aerialDuneW + aSoftX) / 2}
                  y="118"
                  fill="#92400e"
                  fontSize="9.5"
                  fontWeight="800"
                  textAnchor="middle"
                >
                  SABLE MOU
                </text>
                <text
                  x={(aerialDuneW + aSoftX) / 2}
                  y="132"
                  fill="#b45309"
                  fontSize="9.5"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  {softSandMarginM} m
                </text>
              </g>
            ) : aSoftX - aerialDuneW >= 34 ? (
              <text
                x={(aerialDuneW + aSoftX) / 2}
                y="123"
                fill="#92400e"
                fontSize="9"
                fontWeight="800"
                transform={`rotate(-90 ${(aerialDuneW + aSoftX) / 2},123)`}
                textAnchor="middle"
              >
                SABLE MOU ({softSandMarginM} m)
              </text>
            ) : null}
          </g>
        )}

        {/* 3. Sable dur / Piste de roulage (selon Modèle Réel Empirique) */}
        {aRealX > aSoftX && (
          <g>
            <rect
              x={aSoftX}
              y="42"
              width={Math.max(0, aRealX - aSoftX)}
              height="162"
              fill="#fde68a"
            />
            <rect
              x={aSoftX}
              y="42"
              width={Math.max(0, aRealX - aSoftX)}
              height="162"
              fill={`url(#${tracksPatternId})`}
            />

            {realRollableWidthM >= 60 && aRealX - aSoftX >= 64 && (
              <g>
                <rect
                  x={aSoftX + 10}
                  y="56"
                  width={Math.max(24, aRealX - aSoftX - 20)}
                  height="134"
                  rx="22"
                  fill="none"
                  stroke={isWithinThreshold ? '#ea580c' : '#dc2626'}
                  strokeWidth="2"
                  strokeDasharray="8 6"
                  opacity="0.88"
                />
                <circle cx={aSoftX + 20} cy="78" r="4.5" fill="#dc2626" stroke="#fff" strokeWidth="1.4" />
                <circle cx={aSoftX + 20} cy="168" r="4.5" fill="#dc2626" stroke="#fff" strokeWidth="1.4" />
                <circle cx={aRealX - 20} cy="78" r="4.5" fill="#eab308" stroke="#0f172a" strokeWidth="1.4" />
                <circle cx={aRealX - 20} cy="168" r="4.5" fill="#eab308" stroke="#0f172a" strokeWidth="1.4" />

                <g transform={`translate(${(aSoftX + aRealX) / 2}, 110)`}>
                  <line x1="0" y1="-12" x2="0" y2="12" stroke="#1e293b" strokeWidth="2.5" />
                  <line x1="-10" y1="10" x2="10" y2="10" stroke="#1e293b" strokeWidth="2.5" />
                  <rect x="-2" y="-15" width="4" height="6" rx="1" fill="#0f172a" />
                  <rect x="-12" y="7" width="4" height="6" rx="1" fill="#0f172a" />
                  <rect x="8" y="7" width="4" height="6" rx="1" fill="#0f172a" />
                  <path d="M 0,0 Q 8,-4 14,-2" fill="none" stroke="#2563eb" strokeWidth="3" />
                  <circle cx="0" cy="0" r="3" fill="#ef4444" />
                </g>

                {aRealX - aSoftX >= 96 && (
                  <g>
                    <rect
                      x={(aSoftX + aRealX) / 2 - 42}
                      y="134"
                      width="84"
                      height="18"
                      rx="9"
                      fill="rgba(255, 255, 255, 0.92)"
                      stroke={isWithinThreshold ? '#fb923c' : '#f87171'}
                      strokeWidth="1"
                    />
                    <text
                      x={(aSoftX + aRealX) / 2}
                      y="146"
                      fill={isWithinThreshold ? '#9a3412' : '#991b1b'}
                      fontSize="8.8"
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      Piste {realRollableWidthM} m
                    </text>
                  </g>
                )}
              </g>
            )}
          </g>
        )}

        {/* 4. Océan */}
        <rect
          x={aRealX}
          y="42"
          width={Math.max(0, 700 - aRealX)}
          height="162"
          fill={`url(#${oceanGradId})`}
        />

        {/* 4b. Zone Surcote / Sous-cote entre SHOM brut et Modèle Réel Empirique */}
        {aHasWaterDiff && (
          <g>
            <rect
              x={Math.min(aRealX, aTheoX)}
              y="42"
              width={aWaterDiffPx}
              height="162"
              fill={`url(#${isSurcote ? surcoteZonePatternId : souscoteZonePatternId})`}
            />
            {aWaterDiffPx >= 24 && (
              <text
                x={(aRealX + aTheoX) / 2}
                y="123"
                fill={isSurcote ? '#fff7ed' : '#065f46'}
                fontSize="8.5"
                fontWeight="900"
                transform={`rotate(-90 ${(aRealX + aTheoX) / 2},123)`}
                textAnchor="middle"
                style={{
                  paintOrder: 'stroke',
                  stroke: isSurcote ? '#9a3412' : '#ecfdf5',
                  strokeWidth: '2.2px',
                }}
              >
                {isSurcote ? `SURCOTE ${deltaBeachM} m` : `DÉCOTE +${deltaBeachM} m`}
              </text>
            )}
          </g>
        )}

        {/* Trait d'eau empirique ondulé */}
        <path
          d={`M ${aRealX},42 Q ${aRealX + 4},69 ${aRealX},96 T ${aRealX},150 T ${aRealX},204`}
          fill="none"
          stroke={isSurcote ? '#ffedd5' : isSouscote ? '#d1fae5' : '#ffffff'}
          strokeWidth="3.2"
          opacity="0.96"
        />

        {/* Ligne d'eau SHOM brut (si distincte) */}
        {aHasWaterDiff && (
          <g>
            <line x1={aTheoX} y1="42" x2={aTheoX} y2="204" stroke="#0f172a" strokeWidth="3" strokeDasharray="6 4" opacity="0.45" />
            <line x1={aTheoX} y1="42" x2={aTheoX} y2="204" stroke="#fde047" strokeWidth="2" strokeDasharray="6 4" />
          </g>
        )}

        {/* Ligne repère Seuil / Limite Jérôme */}
        <line x1={aSeuilX} y1="42" x2={aSeuilX} y2="204" stroke="rgba(255, 255, 255, 0.72)" strokeWidth="3.4" strokeDasharray="6 3" />
        <line x1={aSeuilX} y1="42" x2={aSeuilX} y2="204" stroke={thrStroke} strokeWidth="1.8" strokeDasharray="6 3" />

        {/* Mention MER dans le plus grand espace libre de l'océan */}
        {oceanLabelPlacement.width >= 115 ? (
          <text
            x={oceanLabelPlacement.cx}
            y="126"
            fill="rgba(255, 255, 255, 0.92)"
            fontSize="12"
            fontWeight="900"
            letterSpacing="0.06em"
            textAnchor="middle"
          >
            MER · {realHeightLabel} m
          </text>
        ) : oceanLabelPlacement.width >= 42 ? (
          <text
            x={oceanLabelPlacement.cx}
            y="123"
            fill="rgba(255, 255, 255, 0.92)"
            fontSize="10"
            fontWeight="900"
            transform={`rotate(90 ${oceanLabelPlacement.cx},123)`}
            textAnchor="middle"
          >
            MER ({realHeightLabel} m)
          </text>
        ) : null}
      </g>

      <rect x="0" y="42" width="700" height="162" rx="8" fill="none" stroke="#cbd5e1" strokeWidth="1" />

      {/* ================================================================= */}
      {/* BANDE 3 (y = 204..310) : RÈGLE GRADUÉE & 2 BANDES NETTES          */}
      {/* ================================================================= */}
      <line x1={aerialDuneW} y1="208" x2={aerialMaxX} y2="208" stroke="#cbd5e1" strokeWidth="1" />
      {[0, 100, 200, 300, 400].map(m => {
        const tx = mapAerialX(m);
        return (
          <g key={`bp-tick-${m}`}>
            <line x1={tx} y1="204" x2={tx} y2="212" stroke="#94a3b8" strokeWidth="1.2" />
            <text x={tx} y="223" fill="#64748b" fontSize="8.5" fontWeight="700" textAnchor="middle">
              {m} m
            </text>
          </g>
        );
      })}
      {softSandMarginM >= 18 &&
        softSandMarginM <= 240 &&
        [0, 100, 200, 300, 400].every(t => Math.abs(t - softSandMarginM) >= 16) && (
        <g>
          <line x1={aSoftX} y1="204" x2={aSoftX} y2="211" stroke="#d97706" strokeWidth="1.4" />
          <text x={aSoftX} y="223" fill="#b45309" fontSize="8" fontWeight="800" textAnchor="middle">
            {softSandMarginM} m
          </text>
        </g>
      )}

      {/* COTATION 1 (y = 248) : BANDE SHOM BRUT */}
      {theoRollableWidthM > 0 ? (
        <g>
          <rect x={aSoftX} y="244" width={Math.max(2, aTheoX - aSoftX)} height="8" rx="2" fill="#fef9c3" />
          <line x1={aSoftX} y1="248" x2={aTheoX} y2="248" stroke="#ca8a04" strokeWidth="2.4" strokeDasharray="5 3" />
          <line x1={aSoftX} y1="241" x2={aSoftX} y2="255" stroke="#a16207" strokeWidth="2" />
          <line x1={aTheoX} y1="241" x2={aTheoX} y2="255" stroke="#a16207" strokeWidth="2" />
          {shomPutRight ? (
            <g>
              <rect x={aTheoX + 10} y="236" width={shomPillW} height="24" rx="6" fill="#fefce8" stroke="#eab308" strokeWidth="1.2" />
              <text x={aTheoX + 10 + shomPillW / 2} y="251.5" fill="#854d0e" fontSize="9.2" fontWeight="900" textAnchor="middle">
                {shomBarText}
              </text>
            </g>
          ) : (
            <g>
              <rect x={shomCenterX - shomPillW / 2} y="236" width={shomPillW} height="24" rx="6" fill="#fefce8" stroke="#eab308" strokeWidth="1.2" />
              <text x={shomCenterX} y="251.5" fill="#854d0e" fontSize="9.2" fontWeight="900" textAnchor="middle">
                {shomBarText}
              </text>
            </g>
          )}
        </g>
      ) : (
        <g>
          <rect x={aerialDuneW} y="236" width="236" height="24" rx="6" fill="#fefce8" stroke="#eab308" strokeWidth="1.2" />
          <text x={aerialDuneW + 118} y="251.5" fill="#854d0e" fontSize="9.2" fontWeight="900" textAnchor="middle">
            SHOM brut : 0 m (mer dans le sable mou)
          </text>
        </g>
      )}

      {/* COTATION 2 (y = 284) : BANDE MODÈLE RÉEL EMPIRIQUE */}
      {realRollableWidthM > 0 ? (
        <g>
          <rect x={aSoftX} y="280" width={Math.max(2, aRealX - aSoftX)} height="8" rx="2" fill={empFill} />
          <line x1={aSoftX} y1="284" x2={aRealX} y2="284" stroke={empStroke} strokeWidth="2.8" />
          <line x1={aSoftX} y1="277" x2={aSoftX} y2="291" stroke={empStroke} strokeWidth="2.4" />
          <line x1={aRealX} y1="277" x2={aRealX} y2="291" stroke={empStroke} strokeWidth="2.4" />
          {empPutRight ? (
            <g>
              <rect x={aRealX + 10} y="272" width={empPillW} height="24" rx="6" fill={empFill} stroke={empStroke} strokeWidth="1.4" />
              <text x={aRealX + 10 + empPillW / 2} y="287.5" fill={empText} fontSize="9.2" fontWeight="900" textAnchor="middle">
                {empBarText}
              </text>
            </g>
          ) : (
            <g>
              <rect x={empCenterX - empPillW / 2} y="272" width={empPillW} height="24" rx="6" fill={empFill} stroke={empStroke} strokeWidth="1.4" />
              <text x={empCenterX} y="287.5" fill={empText} fontSize="9.2" fontWeight="900" textAnchor="middle">
                {empBarText}
              </text>
            </g>
          )}
        </g>
      ) : (
        <g>
          <rect x={aerialDuneW} y="272" width="290" height="24" rx="6" fill="#fef2f2" stroke="#f87171" strokeWidth="1.3" />
          <text x={aerialDuneW + 145} y="287.5" fill="#991b1b" fontSize="9.2" fontWeight="900" textAnchor="middle">
            Modèle réel empirique : 0 m (mer dans le sable mou)
          </text>
        </g>
      )}
    </svg>
  );
};
