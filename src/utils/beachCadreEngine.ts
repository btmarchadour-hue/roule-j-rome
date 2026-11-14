import {
  BeachCadreConfig,
  BeachCadreProfile,
  BeachCadreProfileKey,
  BeachReferencePoint,
} from '../types';

function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CADRE_STORAGE_KEY = 'cv_beach_cadre_roulage_v1';

// Axe théorique par défaut de la plage de Lestrevet -> Pentrez (SSE 155° -> NNW 335°, mer face WSW 245°)
const DEFAULT_TANGENT_E = -0.422618; // sin(335°)
const DEFAULT_TANGENT_N = 0.906308;  // cos(335°)

export function createDefaultBeachCadreConfig(): BeachCadreConfig {
  return {
    activeProfile: 'jerome',
    profiles: {
      jerome: {
        profileKey: 'jerome',
        name: 'Zone Jérôme (Roulage réel école)',
        dunePointA: null,
        dunePointB: null,
        leftBoundary: null,
        rightBoundary: null,
        softSandMarginM: 50,
        notes: '',
      },
      mairie: {
        profileKey: 'mairie',
        name: 'Zone Mairie (Arrêté / AOT autorisé)',
        dunePointA: null,
        dunePointB: null,
        leftBoundary: null,
        rightBoundary: null,
        softSandMarginM: 50,
        notes: '',
      },
    },
  };
}

export function getStoredBeachCadreConfig(): BeachCadreConfig {
  try {
    const raw = localStorage.getItem(CADRE_STORAGE_KEY);
    if (!raw) return createDefaultBeachCadreConfig();
    const parsed = JSON.parse(raw);
    const def = createDefaultBeachCadreConfig();
    return {
      activeProfile: parsed.activeProfile === 'mairie' ? 'mairie' : 'jerome',
      profiles: {
        jerome: { ...def.profiles.jerome, ...(parsed.profiles?.jerome || {}) },
        mairie: { ...def.profiles.mairie, ...(parsed.profiles?.mairie || {}) },
      },
      updatedAt: parsed.updatedAt,
      updatedBy: parsed.updatedBy,
    };
  } catch {
    return createDefaultBeachCadreConfig();
  }
}

export function saveStoredBeachCadreConfig(config: BeachCadreConfig): void {
  try {
    localStorage.setItem(CADRE_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Erreur sauvegarde locale cadre plage:', err);
  }
}

/**
 * Projection métrique locale ENU (Est / Nord en mètres) par rapport à un point d'origine (lat0, lon0).
 * Précision centimétrique à l'échelle d'une plage de 4 km.
 */
export function latLonToLocalMeters(
  lat: number,
  lon: number,
  lat0: number,
  lon0: number
): { e: number; n: number } {
  const phi = (lat0 * Math.PI) / 180;
  const metersPerDegLat =
    111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const metersPerDegLon =
    111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

  return {
    e: (lon - lon0) * metersPerDegLon,
    n: (lat - lat0) * metersPerDegLat,
  };
}

function vectorToCompassDeg(e: number, n: number): number {
  const rad = Math.atan2(e, n);
  return Math.round((((rad * 180) / Math.PI) + 360) % 360);
}

export interface CadreGeometrySummary {
  hasDuneOrigin: boolean;
  hasFullDuneLine: boolean;
  hasLeftBoundary: boolean;
  hasRightBoundary: boolean;
  isCorridorComplete: boolean;
  originLat: number | null;
  originLon: number | null;
  /** Vecteur unitaire tangent le long de la dune (sens Gauche/Sud -> Droite/Nord) */
  tangent: { e: number; n: number };
  /** Vecteur unitaire normal pointant vers la mer (large / WSW) */
  seaNormal: { e: number; n: number };
  /** Azimut de la plage (Gauche -> Droite) en degrés */
  beachAzimuthDeg: number;
  /** Direction face à la mer en degrés */
  seawardAzimuthDeg: number;
  /** Distance directe entre Dune A et Dune B (m) */
  duneBaselineLengthM: number | null;
  /** Longueur utile de roulage Gauche <-> Droite le long du couloir (m) */
  corridorLengthM: number | null;
  /** Coordonnée projetée s de la borne gauche et droite le long de la tangente */
  sLeftM: number | null;
  sRightM: number | null;
  /** Avertissement si les bornes Gauche et Droite semblent inversées Nord/Sud */
  boundariesSwappedWarning: boolean;
}

export function computeCadreGeometry(profile: BeachCadreProfile | null | undefined): CadreGeometrySummary {
  if (!profile) {
    return {
      hasDuneOrigin: false,
      hasFullDuneLine: false,
      hasLeftBoundary: false,
      hasRightBoundary: false,
      isCorridorComplete: false,
      originLat: null,
      originLon: null,
      tangent: { e: DEFAULT_TANGENT_E, n: DEFAULT_TANGENT_N },
      seaNormal: { e: -DEFAULT_TANGENT_N, n: DEFAULT_TANGENT_E },
      beachAzimuthDeg: 335,
      seawardAzimuthDeg: 245,
      duneBaselineLengthM: null,
      corridorLengthM: null,
      sLeftM: null,
      sRightM: null,
      boundariesSwappedWarning: false,
    };
  }

  const dA = profile.dunePointA;
  const dB = profile.dunePointB;
  const originPoint = dA || dB || profile.leftBoundary || profile.rightBoundary;
  const hasDuneOrigin = Boolean(dA || dB);
  const hasLeftBoundary = Boolean(profile.leftBoundary);
  const hasRightBoundary = Boolean(profile.rightBoundary);

  let tangent = { e: DEFAULT_TANGENT_E, n: DEFAULT_TANGENT_N };
  let hasFullDuneLine = false;
  let duneBaselineLengthM: number | null = null;

  if (dA && dB) {
    const pB = latLonToLocalMeters(dB.lat, dB.lon, dA.lat, dA.lon);
    const len = Math.hypot(pB.e, pB.n);
    if (len >= 10) {
      hasFullDuneLine = true;
      duneBaselineLengthM = Math.round(len);
      // Orienter toujours Gauche (SSE) -> Droite (NNW)
      const dotDefault = pB.e * DEFAULT_TANGENT_E + pB.n * DEFAULT_TANGENT_N;
      const sign = dotDefault >= 0 ? 1 : -1;
      tangent = {
        e: (sign * pB.e) / len,
        n: (sign * pB.n) / len,
      };
    }
  }

  // Rotation horaire de -90° en repère (E, N) : vers le large OSO (~245°)
  const seaNormal = { e: -tangent.n, n: tangent.e };

  let sLeftM: number | null = null;
  let sRightM: number | null = null;
  let corridorLengthM: number | null = null;
  let boundariesSwappedWarning = false;

  if (originPoint) {
    if (profile.leftBoundary) {
      const pL = latLonToLocalMeters(
        profile.leftBoundary.lat,
        profile.leftBoundary.lon,
        originPoint.lat,
        originPoint.lon
      );
      sLeftM = Math.round(pL.e * tangent.e + pL.n * tangent.n);
    }
    if (profile.rightBoundary) {
      const pR = latLonToLocalMeters(
        profile.rightBoundary.lat,
        profile.rightBoundary.lon,
        originPoint.lat,
        originPoint.lon
      );
      sRightM = Math.round(pR.e * tangent.e + pR.n * tangent.n);
    }

    if (profile.leftBoundary && profile.rightBoundary && sLeftM != null && sRightM != null) {
      if (hasDuneOrigin) {
        corridorLengthM = Math.abs(sRightM - sLeftM);
      } else {
        corridorLengthM = Math.round(
          haversineDistanceM(
            profile.leftBoundary.lat,
            profile.leftBoundary.lon,
            profile.rightBoundary.lat,
            profile.rightBoundary.lon
          )
        );
      }
      if (sLeftM > sRightM + 20) {
        boundariesSwappedWarning = true;
      }
    }
  }

  return {
    hasDuneOrigin,
    hasFullDuneLine,
    hasLeftBoundary,
    hasRightBoundary,
    isCorridorComplete: hasDuneOrigin && hasLeftBoundary && hasRightBoundary,
    originLat: originPoint ? originPoint.lat : null,
    originLon: originPoint ? originPoint.lon : null,
    tangent,
    seaNormal,
    beachAzimuthDeg: vectorToCompassDeg(tangent.e, tangent.n),
    seawardAzimuthDeg: vectorToCompassDeg(seaNormal.e, seaNormal.n),
    duneBaselineLengthM,
    corridorLengthM,
    sLeftM,
    sRightM,
    boundariesSwappedWarning,
  };
}

export interface PointCadreEvaluation {
  widthFromDuneM: number | null;
  lateralPosFromLeftM: number | null;
  lateralPosPct: number | null;
  isInsideZone: boolean | null;
  overflowSide: 'left' | 'right' | null;
  overflowM: number;
  profileKey: BeachCadreProfileKey;
}

/**
 * Calcule la largeur exacte depuis la ligne de dune et la position entre côté Gauche et côté Droit
 * pour n'importe quel point GPS mesuré sur la plage ou au front d'eau.
 */
export function evaluatePointAgainstCadre(
  lat: number,
  lon: number,
  profile: BeachCadreProfile | null | undefined
): PointCadreEvaluation {
  const profileKey: BeachCadreProfileKey = profile?.profileKey || 'jerome';
  const geom = computeCadreGeometry(profile);

  if (!profile || !geom.hasDuneOrigin || geom.originLat == null || geom.originLon == null) {
    return {
      widthFromDuneM: null,
      lateralPosFromLeftM: null,
      lateralPosPct: null,
      isInsideZone: null,
      overflowSide: null,
      overflowM: 0,
      profileKey,
    };
  }

  const duneOrigin = profile.dunePointA || profile.dunePointB!;
  const p = latLonToLocalMeters(lat, lon, duneOrigin.lat, duneOrigin.lon);

  // Distance perpendiculaire vers la mer depuis la ligne de dune
  const widthFromDuneM = Math.round(p.e * geom.seaNormal.e + p.n * geom.seaNormal.n);

  let lateralPosFromLeftM: number | null = null;
  let lateralPosPct: number | null = null;
  let isInsideZone: boolean | null = null;
  let overflowSide: 'left' | 'right' | null = null;
  let overflowM = 0;

  if (profile.leftBoundary && profile.rightBoundary) {
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
    const sMin = Math.min(sL, sR);
    const sMax = Math.max(sL, sR);
    const span = sMax - sMin;
    const sP = p.e * geom.tangent.e + p.n * geom.tangent.n;

    lateralPosFromLeftM = Math.round(sP - sMin);
    if (span >= 10) {
      lateralPosPct = Math.round(((sP - sMin) / span) * 100);
      if (sP < sMin - 5) {
        isInsideZone = false;
        overflowSide = 'left';
        overflowM = Math.round(sMin - sP);
      } else if (sP > sMax + 5) {
        isInsideZone = false;
        overflowSide = 'right';
        overflowM = Math.round(sP - sMax);
      } else {
        isInsideZone = true;
      }
    }
  }

  return {
    widthFromDuneM,
    lateralPosFromLeftM,
    lateralPosPct,
    isInsideZone,
    overflowSide,
    overflowM,
    profileKey,
  };
}

/**
 * Analyse une chaîne de coordonnées copiée depuis Google Maps / Géoportail (ex: "48.18372, -4.29441")
 */
export function parseLatLonInput(
  raw: string
): { lat: number; lon: number; warning?: string } | { error: string } {
  const cleaned = raw.trim().replace(/°/g, '').replace(/\s+/g, ' ');
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean);
  if (parts.length < 2) {
    return { error: 'Format attendu : latitude, longitude (ex: 48.18372, -4.29441)' };
  }

  const lat = Number(parts[0].replace(',', '.'));
  const lon = Number(parts[1].replace(',', '.'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: 'Coordonnées numériques invalides.' };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: 'Latitude ou longitude hors plage terrestre valide.' };
  }

  let warning: string | undefined;
  if (lat < 48.0 || lat > 48.4 || lon < -4.6 || lon > -4.0) {
    warning = 'Attention : ce point semble éloigné de la Baie de Douarnenez (Pentrez / Lestrevet ≈ 48.18° N, -4.29° O).';
  }

  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    warning,
  };
}

export function formatCoordsShort(pt: BeachReferencePoint | null | undefined): string {
  if (!pt) return 'Non défini';
  return `${pt.lat.toFixed(5)}°, ${pt.lon.toFixed(5)}°`;
}
