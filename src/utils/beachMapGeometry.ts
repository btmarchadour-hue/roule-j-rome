import { BeachCadreProfile } from '../types';
import {
  BayZoneId,
  classifyBayZone,
  LESTREVET_PENTREZ_DUNE_LINE,
} from './beachOrientation';
import { computeCadreGeometry, latLonToLocalMeters } from './beachCadreEngine';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface LatLngBoundsBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type MapFocusAreaId = 'lestrevet' | 'lieue_de_greve' | 'pentrez' | 'bay';

export interface CameraPreset {
  id: MapFocusAreaId;
  label: string;
  center: LatLngPoint;
  zoom: number;
  bounds: LatLngBoundsBox;
}

/** Emprise stricte maximale autorisée autour de la plage Lestrevet -> Pentrez */
export const BAY_STRICT_BOUNDS: LatLngBoundsBox = {
  south: 48.1725,
  north: 48.1985,
  west: -4.3165,
  east: -4.2865,
};

export const BAY_CAMERA_PRESETS: ReadonlyArray<CameraPreset> = [
  {
    id: 'lestrevet',
    label: 'Lestrevet (Zone principale)',
    center: { lat: 48.1803, lng: -4.2948 },
    zoom: 16,
    bounds: {
      south: 48.1749,
      north: 48.1859,
      west: -4.2994,
      east: -4.2896,
    },
  },
  {
    id: 'lieue_de_greve',
    label: 'Lieue de Grève',
    center: { lat: 48.1872, lng: -4.3000 },
    zoom: 16,
    bounds: {
      south: 48.1838,
      north: 48.1912,
      west: -4.3058,
      east: -4.2940,
    },
  },
  {
    id: 'pentrez',
    label: 'Pentrez (Nord)',
    center: { lat: 48.1936, lng: -4.3052 },
    zoom: 16,
    bounds: {
      south: 48.1902,
      north: 48.1968,
      west: -4.3108,
      east: -4.2998,
    },
  },
  {
    id: 'bay',
    label: 'Toute la plage',
    center: { lat: 48.1858, lng: -4.2995 },
    zoom: 15,
    bounds: {
      south: 48.1746,
      north: 48.1966,
      west: -4.3108,
      east: -4.2898,
    },
  },
];

export function computePointsBounds(
  points: ReadonlyArray<LatLngPoint>,
  padDegLat = 0.001,
  padDegLng = 0.0014
): LatLngBoundsBox | null {
  if (!points.length) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const pt of points) {
    if (pt.lat < south) south = pt.lat;
    if (pt.lat > north) north = pt.lat;
    if (pt.lng < west) west = pt.lng;
    if (pt.lng > east) east = pt.lng;
  }
  return {
    south: Math.max(BAY_STRICT_BOUNDS.south, south - padDegLat),
    north: Math.min(BAY_STRICT_BOUNDS.north, north + padDegLat),
    west: Math.max(BAY_STRICT_BOUNDS.west, west - padDegLng),
    east: Math.min(BAY_STRICT_BOUNDS.east, east + padDegLng),
  };
}

/**
 * Inverse métrique locale ENU (Est / Nord en mètres) -> coordonnées WGS84 (lat, lng).
 */
export function localMetersToLatLon(
  e: number,
  n: number,
  lat0: number,
  lon0: number
): LatLngPoint {
  const phi = (lat0 * Math.PI) / 180;
  const metersPerDegLat =
    111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const metersPerDegLon =
    111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

  return {
    lat: Number((lat0 + n / metersPerDegLat).toFixed(6)),
    lng: Number((lon0 + e / metersPerDegLon).toFixed(6)),
  };
}

// Axe global constant de la baie (335° NNO) et normale côté mer (245° OSO).
// Projeter les courbes d'eau parallèlement à cette normale constante garantit
// mathématiquement zéro croisement ni zig-zag dans les rentrants de dune (ex: ruisseau).
const BAY_TANGENT = { e: -0.422618, n: 0.906308 };
const BAY_SEA_NORMAL = { e: -0.906308, n: -0.422618 };
const DUNE_REF_ORIGIN = { lat: 48.185, lon: -4.297 };

interface DuneVertexMeta {
  lat: number;
  lng: number;
  /** Coordonnée le long de la plage (m, strictement croissante Sud -> Nord) */
  sM: number;
  /** Position cross-shore brute du pied de dune (m vers la mer) */
  wRawM: number;
  /** Position cross-shore lissée pour les courbes d'eau au large (évite les zig-zags) */
  wSmoothM: number;
  zoneId: BayZoneId;
}

const DUNE_VERTICES: ReadonlyArray<DuneVertexMeta> = (() => {
  const raw = LESTREVET_PENTREZ_DUNE_LINE.map(pt => {
    const p = latLonToLocalMeters(pt.lat, pt.lon, DUNE_REF_ORIGIN.lat, DUNE_REF_ORIGIN.lon);
    const sM = p.e * BAY_TANGENT.e + p.n * BAY_TANGENT.n;
    const wRawM = p.e * BAY_SEA_NORMAL.e + p.n * BAY_SEA_NORMAL.n;
    const zone = classifyBayZone(pt.lat, pt.lon);
    return {
      lat: pt.lat,
      lng: pt.lon,
      sM,
      wRawM,
      zoneId: zone.zoneId,
    };
  });

  // Lissage gaussien doux en coordonnées cross-shore (fenêtre ±120 m le long de la plage)
  // pour que les lignes d'eau au large épousent la courbe naturelle de la baie sans à-coups.
  return raw.map((v, i) => {
    let num = 0;
    let den = 0;
    for (let j = 0; j < raw.length; j++) {
      const ds = raw[j].sM - v.sM;
      if (Math.abs(ds) > 260) continue;
      const weight = Math.exp(-(ds * ds) / (2 * 95 * 95));
      num += raw[j].wRawM * weight;
      den += weight;
    }
    const wSmoothM = den > 0 ? num / den : v.wRawM;
    return {
      ...v,
      wSmoothM,
    };
  });
})();

function filterVerticesForFocus(focusArea: MapFocusAreaId): ReadonlyArray<DuneVertexMeta> {
  if (focusArea === 'lestrevet') {
    // Secteur Lestrevet complet : du parking Sud / restaurant jusqu'au Chemin des Dunes (au-delà de Sea Foot N' Sound)
    return DUNE_VERTICES.filter(v => v.lat <= 48.1862);
  }
  if (focusArea === 'lieue_de_greve') {
    return DUNE_VERTICES.filter(v => v.lat >= 48.1832 && v.lat <= 48.1918);
  }
  if (focusArea === 'pentrez') {
    return DUNE_VERTICES.filter(v => v.lat >= 48.1896);
  }
  return DUNE_VERTICES;
}

function vertexAtDistanceM(v: DuneVertexMeta, distanceM: number): LatLngPoint {
  const d = Math.max(0, distanceM);
  if (d <= 0.1) {
    return { lat: v.lat, lng: v.lng };
  }
  // À d = 0 m on colle exactement au pied de dune IGN ; au-delà de 80 m vers le large,
  // la ligne d'eau s'aligne sur le profil lissé de la baie (zéro indentation artificielle).
  const smoothBlend = Math.min(1, d / 90);
  const baseW = v.wRawM * (1 - smoothBlend) + v.wSmoothM * smoothBlend;
  const wTarget = baseW + d;
  const e = v.sM * BAY_TANGENT.e + wTarget * BAY_SEA_NORMAL.e;
  const n = v.sM * BAY_TANGENT.n + wTarget * BAY_SEA_NORMAL.n;
  return localMetersToLatLon(e, n, DUNE_REF_ORIGIN.lat, DUNE_REF_ORIGIN.lon);
}

export const DUNE_POLYLINE_PATH: ReadonlyArray<LatLngPoint> = DUNE_VERTICES.map(v => ({
  lat: v.lat,
  lng: v.lng,
}));

export function getDunePolylineForFocus(focusArea: MapFocusAreaId): LatLngPoint[] {
  return filterVerticesForFocus(focusArea).map(v => ({ lat: v.lat, lng: v.lng }));
}

/**
 * Projette une ligne parallèle au pied de dune IGN/OSM vers le large,
 * sans jamais créer de croisements ni de pointes dans les angles de la dune.
 */
export function projectShorelineAlongDune(
  distanceForZone: (zoneId: BayZoneId) => number,
  focusArea: MapFocusAreaId = 'bay'
): LatLngPoint[] {
  return filterVerticesForFocus(focusArea).map(v => vertexAtDistanceM(v, distanceForZone(v.zoneId)));
}

/**
 * Construit un polygone fermé propre entre deux distances depuis la dune
 * (bande de sable mou, piste roulable utile ou écart surcote/décote).
 */
export function buildBandPolygonBetweenDistances(
  innerForZone: (zoneId: BayZoneId) => number,
  outerForZone: (zoneId: BayZoneId) => number,
  focusArea: MapFocusAreaId = 'bay'
): LatLngPoint[] {
  const verts = filterVerticesForFocus(focusArea);
  if (verts.length < 2) return [];

  let hasPositiveArea = false;
  const innerLine: LatLngPoint[] = [];
  const outerLine: LatLngPoint[] = [];

  for (const v of verts) {
    const dIn = Math.max(0, innerForZone(v.zoneId));
    const dOut = Math.max(dIn, outerForZone(v.zoneId));
    if (dOut - dIn >= 1.5) {
      hasPositiveArea = true;
    }
    innerLine.push(vertexAtDistanceM(v, dIn));
    outerLine.push(vertexAtDistanceM(v, dOut));
  }

  if (!hasPositiveArea) return [];
  return [...innerLine, ...outerLine.reverse()];
}

export interface CadreMapOverlayGeometry {
  duneBaseline: LatLngPoint[];
  corridorPolygon: LatLngPoint[];
  leftBoundaryRay: LatLngPoint[];
  rightBoundaryRay: LatLngPoint[];
  corridorLengthM: number | null;
}

/**
 * Projette le Cadre Terrain étalonné (Dune A/B + Bornes Gauche/Droite) sur la carte.
 */
export function buildCadreOverlayGeometry(
  profile: BeachCadreProfile | null | undefined,
  seawardDepthM: number = 360
): CadreMapOverlayGeometry | null {
  if (!profile) return null;
  const geom = computeCadreGeometry(profile);
  const duneOrigin = profile.dunePointA || profile.dunePointB;

  const duneBaseline: LatLngPoint[] = [];
  if (profile.dunePointA && profile.dunePointB) {
    duneBaseline.push(
      { lat: profile.dunePointA.lat, lng: profile.dunePointA.lon },
      { lat: profile.dunePointB.lat, lng: profile.dunePointB.lon }
    );
  }

  let corridorPolygon: LatLngPoint[] = [];
  let leftBoundaryRay: LatLngPoint[] = [];
  let rightBoundaryRay: LatLngPoint[] = [];

  const depth = Math.max(80, Math.min(460, seawardDepthM));

  if (duneOrigin && profile.leftBoundary && profile.rightBoundary) {
    const pL = latLonToLocalMeters(
      profile.leftBoundary.lat,
      profile.leftBoundary.lon,
      duneOrigin.lat,
      duneOrigin.lon
    );
    const pR = latLonToLocalMeters(
      profile.rightBoundary.lat,
      profile.rightBoundary.lon,
      duneOrigin.lat,
      duneOrigin.lon
    );
    const sL = pL.e * geom.tangent.e + pL.n * geom.tangent.n;
    const sR = pR.e * geom.tangent.e + pR.n * geom.tangent.n;

    const leftDune = localMetersToLatLon(
      geom.tangent.e * sL,
      geom.tangent.n * sL,
      duneOrigin.lat,
      duneOrigin.lon
    );
    const rightDune = localMetersToLatLon(
      geom.tangent.e * sR,
      geom.tangent.n * sR,
      duneOrigin.lat,
      duneOrigin.lon
    );
    const leftSea = localMetersToLatLon(
      geom.tangent.e * sL + geom.seaNormal.e * depth,
      geom.tangent.n * sL + geom.seaNormal.n * depth,
      duneOrigin.lat,
      duneOrigin.lon
    );
    const rightSea = localMetersToLatLon(
      geom.tangent.e * sR + geom.seaNormal.e * depth,
      geom.tangent.n * sR + geom.seaNormal.n * depth,
      duneOrigin.lat,
      duneOrigin.lon
    );

    leftBoundaryRay = [leftDune, leftSea];
    rightBoundaryRay = [rightDune, rightSea];
    corridorPolygon = [leftDune, rightDune, rightSea, leftSea];
  } else if (profile.leftBoundary || profile.rightBoundary) {
    if (profile.leftBoundary) {
      const origin = profile.leftBoundary;
      leftBoundaryRay = [
        { lat: origin.lat, lng: origin.lon },
        localMetersToLatLon(
          geom.seaNormal.e * depth,
          geom.seaNormal.n * depth,
          origin.lat,
          origin.lon
        ),
      ];
    }
    if (profile.rightBoundary) {
      const origin = profile.rightBoundary;
      rightBoundaryRay = [
        { lat: origin.lat, lng: origin.lon },
        localMetersToLatLon(
          geom.seaNormal.e * depth,
          geom.seaNormal.n * depth,
          origin.lat,
          origin.lon
        ),
      ];
    }
  }

  if (
    !duneBaseline.length &&
    !corridorPolygon.length &&
    !leftBoundaryRay.length &&
    !rightBoundaryRay.length
  ) {
    return null;
  }

  return {
    duneBaseline,
    corridorPolygon,
    leftBoundaryRay,
    rightBoundaryRay,
    corridorLengthM: geom.corridorLengthM,
  };
}
