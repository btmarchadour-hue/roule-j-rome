import { WindPoint } from '../types';
import { comp } from './tides';
import { latLonToLocalMeters } from './beachCadreEngine';

export type WindSectorId = 'travers_mer' | 'axe' | 'terre';

export interface WindSectorInfo {
  sector: WindSectorId;
  label: string;
  shortLabel: string;
  detail: string;
  bg: string;
  fg: string;
  bd: string;
}

export type BayZoneId = 'lestrevet' | 'lieue_de_greve' | 'pentrez';

export interface BayZoneInfo {
  zoneId: BayZoneId;
  label: string;
  shortLabel: string;
  bg: string;
  fg: string;
  bd: string;
}

export interface FrontalSwellAdvisory {
  maxHeightM: number;
  periodS: number | null;
  dirComp: string;
  recommendedMarginCm: number;
}

const COMPASS_DEG_MAP: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSO: 202.5,
  SSW: 202.5,
  SO: 225,
  SW: 225,
  OSO: 247.5,
  WSW: 247.5,
  O: 270,
  W: 270,
  ONO: 292.5,
  WNW: 292.5,
  NO: 315,
  NW: 315,
  NNO: 337.5,
  NNW: 337.5,
};

function normalizeDeg(degOrComp: number | string | null | undefined): number | null {
  if (typeof degOrComp === 'number' && Number.isFinite(degOrComp)) {
    return ((degOrComp % 360) + 360) % 360;
  }
  if (typeof degOrComp === 'string') {
    const key = degOrComp.trim().toUpperCase();
    if (key in COMPASS_DEG_MAP) {
      return COMPASS_DEG_MAP[key];
    }
    const parsed = Number(key.replace('°', ''));
    if (Number.isFinite(parsed)) {
      return ((parsed % 360) + 360) % 360;
    }
  }
  return null;
}

function angularDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Qualification de l'orientation du vent par rapport à l'axe de la plage de Lestrevet/Pentrez (~335° NNO / 155° SSE).
 * - Axe plage : 335° ± 30° (305°–5°) et 155° ± 30° (125°–185°) -> N, NNO, NO, S, SSE, SE
 * - Travers mer : centré sur 245° OSO (185°–305°) -> SSO, SO, OSO, O, ONO
 * - Vent de terre : centré sur 65° ENE Kervennec (5°–125°) -> NNE, NE, ENE, E, ESE
 */
export function classifyWindSector(
  degOrComp: number | string | null | undefined
): WindSectorInfo | null {
  const deg = normalizeDeg(degOrComp);
  if (deg == null) return null;

  const diffToAxis = Math.min(angularDiffDeg(deg, 335), angularDiffDeg(deg, 155));
  if (diffToAxis <= 30) {
    return {
      sector: 'axe',
      label: "Dans l'axe",
      shortLabel: "Dans l'axe",
      detail: 'Vent parallèle à la plage (~335° NNO / 155° SSE)',
      bg: '#e0f2fe',
      fg: '#0369a1',
      bd: '#7dd3fc',
    };
  }

  if (deg > 185 && deg < 305) {
    return {
      sector: 'travers_mer',
      label: 'Travers mer',
      shortLabel: 'Travers mer',
      detail: 'Vent travers mer optimal face à la baie (SSO / SO / OSO / O / ONO)',
      bg: '#dcfce7',
      fg: '#166534',
      bd: '#86efac',
    };
  }

  return {
    sector: 'terre',
    label: 'Vent de terre',
    shortLabel: 'Vent de terre',
    detail: "Vent de terre par-dessus Kervennec (NE–ESE) : déventes possibles devant l'école",
    bg: '#ffedd5',
    fg: '#c2410c',
    bd: '#fdba74',
  };
}

/**
 * Détecte une houle frontale (secteur SO / OSO / O : ~200° à 290°) >= 1,5 m
 * sur une fenêtre horaire donnée (en minutes UTC), afin de proposer une marge indicative (+10 à +15 cm sur L).
 */
export function evaluateFrontalSwell(
  windList: WindPoint[],
  startMin: number,
  endMin: number
): FrontalSwellAdvisory | null {
  if (!windList.length) return null;

  let bestPoint: WindPoint | null = null;
  for (const w of windList) {
    if (w.t < startMin - 60 || w.t > endMin + 60) continue;
    if (w.wvh == null || w.wvh < 1.5) continue;

    // Direction frontale baie : SO (225°) / OSO (247.5°) / O (270°) -> 195°..290°
    if (w.wvd != null) {
      const d = ((w.wvd % 360) + 360) % 360;
      if (d < 195 || d > 290) continue;
    }

    if (!bestPoint || w.wvh > (bestPoint.wvh ?? 0)) {
      bestPoint = w;
    }
  }

  if (!bestPoint || bestPoint.wvh == null) return null;

  const maxHeightM = Number(bestPoint.wvh.toFixed(1));
  const periodS = bestPoint.wvp != null ? Math.round(bestPoint.wvp) : null;
  const dirComp = bestPoint.wvd != null ? comp(bestPoint.wvd) : 'OSO';
  const recommendedMarginCm = maxHeightM >= 2.0 ? 15 : 10;

  return {
    maxHeightM,
    periodS,
    dirComp,
    recommendedMarginCm,
  };
}

/**
 * Classement automatique d'un point GPS dans les 3 zones de la baie (Lestrevet / Lieue de Grève / Pentrez).
 * Origine Sud (Lestrevet parking / pied de dune ~48.1765° N, -4.2905° O), axe NNO 335°.
 */
const BAY_SOUTH_ORIGIN = { lat: 48.1765, lon: -4.2905 };
const AXIS_E = -0.422618; // sin(335°)
const AXIS_N = 0.906308; // cos(335°)

export const BAY_ZONES_META: Record<BayZoneId, BayZoneInfo> = {
  lestrevet: {
    zoneId: 'lestrevet',
    label: 'Lestrevet (Sud · École)',
    shortLabel: 'Lestrevet',
    bg: '#dcfce7',
    fg: '#166534',
    bd: '#86efac',
  },
  lieue_de_greve: {
    zoneId: 'lieue_de_greve',
    label: 'Lieue de Grève (Centre)',
    shortLabel: 'Lieue de Grève',
    bg: '#e0f2fe',
    fg: '#0369a1',
    bd: '#7dd3fc',
  },
  pentrez: {
    zoneId: 'pentrez',
    label: 'Pentrez (Nord · Balise)',
    shortLabel: 'Pentrez',
    bg: '#f3e8ff',
    fg: '#6d28d9',
    bd: '#d8b4fe',
  },
};

export function classifyBayZone(
  lat: number,
  lon: number,
  lateralPosPct?: number | null
): BayZoneInfo {
  if (typeof lateralPosPct === 'number' && Number.isFinite(lateralPosPct)) {
    if (lateralPosPct < 33) return BAY_ZONES_META.lestrevet;
    if (lateralPosPct <= 67) return BAY_ZONES_META.lieue_de_greve;
    return BAY_ZONES_META.pentrez;
  }

  const p = latLonToLocalMeters(lat, lon, BAY_SOUTH_ORIGIN.lat, BAY_SOUTH_ORIGIN.lon);
  const sAlongM = p.e * AXIS_E + p.n * AXIS_N;

  if (sAlongM < 1050) return BAY_ZONES_META.lestrevet;
  if (sAlongM <= 2150) return BAY_ZONES_META.lieue_de_greve;
  return BAY_ZONES_META.pentrez;
}

export interface Litto3dProfilePoint {
  x: number;
  z: number;
}

/**
 * Profils altimétriques réels IGN RGE ALTI 1 m / Litto3D par secteur de la baie
 * (moyenne de 3 transects par secteur, cotes en m Zéro Hydrographique Douarnenez = IGN69 + 3,39 m,
 * origine x = 0 m alignée sur la ligne de pied de dune intégrée LESTREVET_PENTREZ_DUNE_LINE).
 */
export const LITTO3D_PROFILES_BY_ZONE: Record<BayZoneId, ReadonlyArray<Litto3dProfilePoint>> = {
  lestrevet: [
    { x: 0, z: 8.96 },
    { x: 15, z: 7.46 },
    { x: 30, z: 7.12 },
    { x: 50, z: 6.73 },
    { x: 75, z: 6.32 },
    { x: 100, z: 5.95 },
    { x: 130, z: 5.55 },
    { x: 160, z: 5.18 },
    { x: 200, z: 4.76 },
    { x: 240, z: 4.31 },
    { x: 280, z: 3.85 },
    { x: 320, z: 3.34 },
    { x: 360, z: 3.0 },
    { x: 400, z: 2.54 },
    { x: 460, z: 1.85 },
  ],
  lieue_de_greve: [
    { x: 0, z: 8.76 },
    { x: 15, z: 7.22 },
    { x: 30, z: 6.83 },
    { x: 50, z: 6.47 },
    { x: 75, z: 6.05 },
    { x: 100, z: 5.75 },
    { x: 130, z: 5.42 },
    { x: 160, z: 5.11 },
    { x: 200, z: 4.69 },
    { x: 240, z: 4.25 },
    { x: 280, z: 3.81 },
    { x: 320, z: 3.37 },
    { x: 360, z: 2.97 },
    { x: 400, z: 2.51 },
    { x: 460, z: 1.82 },
  ],
  pentrez: [
    { x: 0, z: 8.34 },
    { x: 15, z: 6.55 },
    { x: 30, z: 6.19 },
    { x: 50, z: 5.79 },
    { x: 75, z: 5.47 },
    { x: 100, z: 5.2 },
    { x: 130, z: 4.91 },
    { x: 160, z: 4.64 },
    { x: 200, z: 4.27 },
    { x: 240, z: 3.87 },
    { x: 280, z: 3.5 },
    { x: 320, z: 3.07 },
    { x: 360, z: 2.7 },
    { x: 400, z: 2.4 },
    { x: 460, z: 1.75 },
  ],
};

/**
 * Position horizontale exacte (en mètres depuis le pied de dune x = 0) de la ligne d'eau
 * selon le profil IGN RGE ALTI / Litto3D de la zone (Lestrevet par défaut), sans arrondi intermédiaire.
 */
export function estimateLitto3dWaterlineXExactM(
  waterHeightM: number,
  zoneId: BayZoneId = 'lestrevet'
): number {
  const profile = LITTO3D_PROFILES_BY_ZONE[zoneId] || LITTO3D_PROFILES_BY_ZONE.lestrevet;
  const top = profile[0];
  const bottom = profile[profile.length - 1];
  if (waterHeightM >= top.z) return top.x;
  if (waterHeightM <= bottom.z) return bottom.x;
  for (let i = 0; i < profile.length - 1; i++) {
    const p1 = profile[i];
    const p2 = profile[i + 1];
    if (waterHeightM <= p1.z && waterHeightM >= p2.z) {
      const ratio = (p1.z - waterHeightM) / (p1.z - p2.z);
      return p1.x + ratio * (p2.x - p1.x);
    }
  }
  return 200;
}

/**
 * Impact horizontal sur la plage roulable (en mètres gagnés ou perdus pour rouler)
 * entre la courbe réelle et la courbe théorique SHOM selon le profil Litto3D :
 * - Positif (+m) : sous-cote (eau plus basse -> mètres gagnés pour rouler)
 * - Négatif (-m) : surcote (eau plus haute -> mètres perdus pour rouler)
 */
export function estimateDeltaBeachMeters(
  hTheoM: number,
  hRealM: number,
  zoneId: BayZoneId = 'lestrevet'
): number {
  return (
    estimateLitto3dWaterlineXExactM(hRealM, zoneId) -
    estimateLitto3dWaterlineXExactM(hTheoM, zoneId)
  );
}

/**
 * Estime la largeur de bande exploitable (m) selon le modèle IGN / Litto3D de la zone
 * à une hauteur d'eau donnée, après déduction de la marge haute de sable sec/mou (50 m par défaut).
 */
export function estimateLitto3dUsableWidthM(
  waterHeightM: number,
  softSandMarginM: number = 50,
  zoneId: BayZoneId = 'lestrevet'
): number {
  const totalX = Math.round(estimateLitto3dWaterlineXExactM(waterHeightM, zoneId));
  return Math.max(0, totalX - softSandMarginM);
}

/**
 * Ligne de pied de dune réelle (Sud -> Nord) couvrant l'intégralité de la baie
 * Lestrevet -> Lieue de Grève -> Pentrez (~2,6 km de cordon dunaire).
 * Extraite de la bordure terre des plages OSM (ways 668046030 & 373179545)
 * et vérifiée point par point sur le MNT IGN RGE ALTI 1 m (talus dunaire 4,3–6,5 m IGN69).
 */
export const LESTREVET_PENTREZ_DUNE_LINE: ReadonlyArray<{ lat: number; lon: number }> = [
  // Lestrevet (Sud -> Ruisseau)
  { lat: 48.175459, lon: -4.291046 },
  { lat: 48.176124, lon: -4.291061 },
  { lat: 48.176348, lon: -4.291097 },
  { lat: 48.176679, lon: -4.291500 },
  { lat: 48.177187, lon: -4.292064 },
  { lat: 48.177877, lon: -4.292598 },
  { lat: 48.178654, lon: -4.293087 },
  { lat: 48.179276, lon: -4.293426 },
  { lat: 48.180034, lon: -4.293734 },
  { lat: 48.180702, lon: -4.294102 },
  { lat: 48.181603, lon: -4.294402 },
  { lat: 48.182344, lon: -4.294778 },
  { lat: 48.182829, lon: -4.294946 },
  { lat: 48.183270, lon: -4.295050 },
  { lat: 48.183833, lon: -4.294910 },
  { lat: 48.184138, lon: -4.294965 },
  { lat: 48.184402, lon: -4.295307 },
  // Lieue de Grève -> Pentrez (Nord)
  { lat: 48.184517, lon: -4.295466 },
  { lat: 48.184676, lon: -4.295932 },
  { lat: 48.184809, lon: -4.296191 },
  { lat: 48.185009, lon: -4.296424 },
  { lat: 48.185420, lon: -4.296835 },
  { lat: 48.186057, lon: -4.297285 },
  { lat: 48.187058, lon: -4.298053 },
  { lat: 48.187766, lon: -4.298633 },
  { lat: 48.189205, lon: -4.299558 },
  { lat: 48.190784, lon: -4.300594 },
  { lat: 48.191765, lon: -4.301222 },
  { lat: 48.193860, lon: -4.302549 },
  { lat: 48.195097, lon: -4.303313 },
  { lat: 48.195718, lon: -4.303152 },
  { lat: 48.195968, lon: -4.303352 },
];

const DUNE_REF_ORIGIN = { lat: 48.185, lon: -4.297 };

const DUNE_LINE_LOCAL_M = LESTREVET_PENTREZ_DUNE_LINE.map(pt =>
  latLonToLocalMeters(pt.lat, pt.lon, DUNE_REF_ORIGIN.lat, DUNE_REF_ORIGIN.lon)
);

const DUNE_SEG_NORMALS = DUNE_LINE_LOCAL_M.slice(0, -1).map((a, idx) => {
  const b = DUNE_LINE_LOCAL_M[idx + 1];
  const abE = b.e - a.e;
  const abN = b.n - a.n;
  const len = Math.hypot(abE, abN) || 1;
  // Polyligne orientée Sud -> Nord : la normale côté mer (OSO) est (-abN, +abE) / len
  return { e: -abN / len, n: abE / len };
});

export interface BuiltInDuneDistanceResult {
  /** Distance perpendiculaire vers la mer depuis le pied de dune (m, >= 0) */
  widthFromDuneM: number;
  /** Distance signée brute (négative si le point est côté terre derrière la dune) */
  rawSignedM: number;
  nearestDuneLat: number;
  nearestDuneLon: number;
}

/**
 * Calcule automatiquement la distance (m) entre une position GPS relevée sur la plage
 * et la ligne de pied de dune intégrée Lestrevet -> Lieue de Grève -> Pentrez,
 * sans nécessiter d'étalonnage manuel de points Dune A / B.
 * Retourne null si le point est hors de la baie (> 1,5 km ou > 200 m dans les terres).
 */
export function measureDistanceFromBuiltInDuneM(
  lat: number,
  lon: number
): BuiltInDuneDistanceResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const p = latLonToLocalMeters(lat, lon, DUNE_REF_ORIGIN.lat, DUNE_REF_ORIGIN.lon);
  let bestDist = Infinity;
  let bestSegIdx = -1;
  let bestT = 0;
  let bestQ = { e: 0, n: 0 };

  for (let i = 0; i < DUNE_LINE_LOCAL_M.length - 1; i++) {
    const a = DUNE_LINE_LOCAL_M[i];
    const b = DUNE_LINE_LOCAL_M[i + 1];
    const abE = b.e - a.e;
    const abN = b.n - a.n;
    const len2 = abE * abE + abN * abN;
    if (len2 < 1e-6) continue;

    const t = Math.max(0, Math.min(1, ((p.e - a.e) * abE + (p.n - a.n) * abN) / len2));
    const qE = a.e + t * abE;
    const qN = a.n + t * abN;
    const dist = Math.hypot(p.e - qE, p.n - qN);

    if (dist < bestDist) {
      bestDist = dist;
      bestSegIdx = i;
      bestT = t;
      bestQ = { e: qE, n: qN };
    }
  }

  if (bestSegIdx < 0 || bestDist > 1500) return null;

  // Normale côté mer moyennée aux sommets pour éviter toute inversion sur les angles de la baie
  let normE = DUNE_SEG_NORMALS[bestSegIdx].e;
  let normN = DUNE_SEG_NORMALS[bestSegIdx].n;
  if (bestT <= 0.001 && bestSegIdx > 0) {
    normE += DUNE_SEG_NORMALS[bestSegIdx - 1].e;
    normN += DUNE_SEG_NORMALS[bestSegIdx - 1].n;
  } else if (bestT >= 0.999 && bestSegIdx < DUNE_SEG_NORMALS.length - 1) {
    normE += DUNE_SEG_NORMALS[bestSegIdx + 1].e;
    normN += DUNE_SEG_NORMALS[bestSegIdx + 1].n;
  }
  const nLen = Math.hypot(normE, normN) || 1;
  const signedM = ((p.e - bestQ.e) * normE + (p.n - bestQ.n) * normN) / nLen;

  // Rejeter les points nettement à l'intérieur des terres (ex: test depuis la maison)
  if (signedM < -200) return null;

  const pA = LESTREVET_PENTREZ_DUNE_LINE[bestSegIdx];
  const pB = LESTREVET_PENTREZ_DUNE_LINE[bestSegIdx + 1];

  return {
    widthFromDuneM: signedM <= 0 ? 0 : Math.round(bestDist),
    rawSignedM: Math.round(signedM),
    nearestDuneLat: Number((pA.lat + bestT * (pB.lat - pA.lat)).toFixed(6)),
    nearestDuneLon: Number((pA.lon + bestT * (pB.lon - pA.lon)).toFixed(6)),
  };
}

export type TerrainDuneWidthSource = 'cadre' | 'builtin_dune' | 'stored' | null;

/**
 * Résout la largeur terrain (pied de dune -> point GPS) en donnant la priorité :
 * 1. au Cadre Terrain personnalisé si des repères Dune A/B ont été étalonnés,
 * 2. sinon automatiquement à la polyligne intégrée Lestrevet -> Pentrez (IGN/OSM),
 * 3. sinon à une mesure éventuellement déjà enregistrée sur le relevé.
 */
export function resolveTerrainDuneWidthM(
  lat: number,
  lon: number,
  customCadreWidthM?: number | null,
  storedWidthM?: number | null
): { widthFromDuneM: number | null; source: TerrainDuneWidthSource } {
  if (typeof customCadreWidthM === 'number' && Number.isFinite(customCadreWidthM)) {
    return { widthFromDuneM: Math.max(0, Math.round(customCadreWidthM)), source: 'cadre' };
  }
  const builtIn = measureDistanceFromBuiltInDuneM(lat, lon);
  if (builtIn) {
    return { widthFromDuneM: builtIn.widthFromDuneM, source: 'builtin_dune' };
  }
  if (typeof storedWidthM === 'number' && Number.isFinite(storedWidthM)) {
    return { widthFromDuneM: Math.max(0, Math.round(storedWidthM)), source: 'stored' };
  }
  return { widthFromDuneM: null, source: null };
}

