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

const LITTO3D_PROFILE = [
  { x: 0, z: 7.2 },
  { x: 40, z: 6.2 },
  { x: 75, z: 5.3 },
  { x: 120, z: 4.85 },
  { x: 160, z: 4.5 },
  { x: 220, z: 3.9 },
  { x: 280, z: 3.25 },
  { x: 340, z: 2.65 },
  { x: 400, z: 1.95 },
  { x: 460, z: 1.25 },
];

/**
 * Position horizontale exacte (en mètres depuis le pied de dune x = 0) de la ligne d'eau
 * selon le profil Litto3D de Lestrevet / Pentrez, sans arrondi intermédiaire.
 */
export function estimateLitto3dWaterlineXExactM(waterHeightM: number): number {
  if (waterHeightM >= 7.2) return 0;
  if (waterHeightM <= 1.25) return 460;
  for (let i = 0; i < LITTO3D_PROFILE.length - 1; i++) {
    const p1 = LITTO3D_PROFILE[i];
    const p2 = LITTO3D_PROFILE[i + 1];
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
export function estimateDeltaBeachMeters(hTheoM: number, hRealM: number): number {
  return estimateLitto3dWaterlineXExactM(hRealM) - estimateLitto3dWaterlineXExactM(hTheoM);
}

/**
 * Estime la largeur de bande exploitable (m) selon le modèle Litto3D à une hauteur d'eau donnée,
 * après déduction de la marge haute de sable sec/mou (50 m par défaut).
 */
export function estimateLitto3dUsableWidthM(
  waterHeightM: number,
  softSandMarginM: number = 50
): number {
  const totalX = Math.round(estimateLitto3dWaterlineXExactM(waterHeightM));
  return Math.max(0, totalX - softSandMarginM);
}
