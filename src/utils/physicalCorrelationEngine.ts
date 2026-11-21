import {
  BeachCadreProfile,
  GpsWaterlineLog,
  SlotObservation,
  TidePoint,
  WindPoint,
} from '../types';
import {
  classifyBayZone,
  estimateLitto3dUsableWidthM,
  estimateLitto3dWaterlineXExactM,
  resolveTerrainDuneWidthM,
} from './beachOrientation';
import { evaluatePointAgainstCadre } from './beachCadreEngine';
import { convertBrestHeightToDouarnenezM } from './waterlineGpsEngine';
import { comp, tdy, toU, windAt } from './tides';

/** Date de démarrage officielle de la base physique propre (exclusion des essais antérieurs) */
export const OBSERVATORY_START_DATE = '2026-11-20';

export type ObservatoryMetric = 'width_m' | 'surcote_cm';
export type WindSectorKind = 'sea' | 'land' | 'unknown';
export type WindFilterMode = 'all' | 'sea' | 'land';
export type TimeWindowFilter = 'all' | '30d' | '90d';

export type PressureBandId = 'high' | 'normal' | 'low';
export type SwellBandId = 'calm' | 'moderate' | 'strong';

export interface PhysicalObservationPoint {
  id: string;
  source: 'gps' | 'rex';
  dateStr: string;
  timeStr: string;
  timestamp: number;
  author: string;
  zoneLabel: string;
  /** Surcote constatée vs SHOM pur (cm : + = eau plus haute, - = décote) */
  surcoteCm: number | null;
  surcoteMethodLabel: string;
  /** Écart de largeur utile constatée vs Litto3D SHOM (m : - = plage mangée, + = gagnée) */
  widthDeltaM: number | null;
  terrainUsableM: number | null;
  theoUsableM: number | null;
  /** Pression atmosphérique (hPa) — priorité capteur réel METAR */
  pressureHpa: number | null;
  pressureIsReal: boolean;
  /** Houle (m, s) — priorité bouée réelle CANDHIS */
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveIsReal: boolean;
  /** Vent (nds, direction degrés & secteur) */
  windKts: number | null;
  windDirDeg: number | null;
  windDirComp: string | null;
  windSector: WindSectorKind;
  /** Composante onshore du vent (nds : + = Ouest mer vers dune, - = Est terre vers large) */
  onshoreWindKts: number | null;
  beachState?: string;
  note?: string;
  isConsolidated: boolean;
  rawRexObs?: SlotObservation;
}

export interface DayWeatherProfile {
  dateStr: string;
  isFallbackToday: boolean;
  pressureHpa: number | null;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  windKts: number | null;
  windDirDeg: number | null;
  windDirComp: string | null;
  windSector: WindSectorKind;
  pressureBand: PressureBandId | null;
  swellBand: SwellBandId | null;
}

export interface MatrixBandMeta<T extends string> {
  id: T;
  label: string;
  subLabel: string;
}

export const PRESSURE_BANDS: MatrixBandMeta<PressureBandId>[] = [
  { id: 'high', label: 'Anticyclone', subLabel: '> 1015 hPa' },
  { id: 'normal', label: 'Normale', subLabel: '1005 – 1015 hPa' },
  { id: 'low', label: 'Dépression', subLabel: '< 1005 hPa' },
];

export const SWELL_BANDS: MatrixBandMeta<SwellBandId>[] = [
  { id: 'calm', label: 'Houle faible', subLabel: '< 1,0 m' },
  { id: 'moderate', label: 'Houle modérée', subLabel: '1,0 – 1,8 m' },
  { id: 'strong', label: 'Grosse houle', subLabel: '> 1,8 m' },
];

export interface MatrixCellData {
  key: string;
  pressureBand: PressureBandId;
  swellBand: SwellBandId;
  count: number;
  avgWidthDeltaM: number | null;
  widthCount: number;
  avgSurcoteCm: number | null;
  surcoteCount: number;
  minValue: number | null;
  maxValue: number | null;
  displayValue: number | null;
  displayCount: number;
  tone: 'good' | 'warn' | 'danger' | 'empty';
  isTodayCell: boolean;
  points: PhysicalObservationPoint[];
}

export interface WeatherMatrix3x3 {
  cells: Record<string, MatrixCellData>;
  totalMatchedPoints: number;
  missingWeatherCount: number;
  avgDisplayValue: number | null;
  withinTolerancePct: number | null;
}

export interface EmpiricalTerrainModel {
  sampleCountSurcote: number;
  sampleCountWidth: number;
  /** Part du modèle issue des vraies données terrain vs physique de départ (0–99%) */
  terrainConfidencePct: number;
  /** Poids appris pour la surcote (cm) */
  surcoteCoefs: {
    baseOffsetCm: number;
    cmPerHpaDrop: number;
    cmPerWaveM: number;
    cmPer10KtsOnshore: number;
  };
  /** Erreur moyenne absolue : SHOM seul vs Modèle calibré */
  shomMaeCm: number | null;
  calibratedMaeCm: number | null;
  shomMaeM: number | null;
  calibratedMaeM: number | null;
  /** Poids appris pour la largeur plage (m) */
  widthCoefs: {
    baseOffsetM: number;
    mPerHpaDrop: number;
    mPerWaveM: number;
    mPer10KtsOnshore: number;
  };
}

export interface SimulationResult {
  estimatedWidthDeltaM: number;
  estimatedSurcoteCm: number;
  estimatedTimeDeltaMin: number;
  nearbyCount: number;
  nearbyMinM: number | null;
  nearbyMaxM: number | null;
  nearbyMinCm: number | null;
  nearbyMaxCm: number | null;
  nearbyPoints: Array<{ point: PhysicalObservationPoint; similarityPct: number }>;
  tone: 'good' | 'warn' | 'danger';
}

const COMP_TO_DEG: Record<string, number> = {
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

function resolveWindDeg(dirDeg?: number | null, dirComp?: string | null): number | null {
  if (dirDeg != null && Number.isFinite(dirDeg)) {
    return ((dirDeg % 360) + 360) % 360;
  }
  if (dirComp) {
    const key = dirComp.trim().toUpperCase();
    if (key in COMP_TO_DEG) return COMP_TO_DEG[key];
  }
  return null;
}

export function classifyWindDirection(
  dirDeg?: number | null,
  dirComp?: string | null
): WindSectorKind {
  const deg = resolveWindDeg(dirDeg, dirComp);
  if (deg != null) {
    if (deg >= 200 && deg <= 330) return 'sea';
    if (deg >= 20 && deg <= 150) return 'land';
  }
  if (dirComp) {
    const u = dirComp.trim().toUpperCase();
    if (u.includes('O') || u.includes('W')) return 'sea';
    if (u.includes('E')) return 'land';
  }
  return 'unknown';
}

function computeOnshoreWindKts(
  windKts: number | null,
  windDirDeg: number | null,
  windSector: WindSectorKind
): number | null {
  if (windKts == null || !Number.isFinite(windKts)) return null;
  if (windDirDeg != null) {
    // Normale plage de Lestrevet ~265° (Ouest / OSO)
    const rad = ((windDirDeg - 265) * Math.PI) / 180;
    return Number((windKts * Math.cos(rad)).toFixed(1));
  }
  if (windSector === 'sea') return Number((windKts * 0.85).toFixed(1));
  if (windSector === 'land') return Number((-windKts * 0.85).toFixed(1));
  return 0;
}

export function getPressureBand(pressureHpa: number | null): PressureBandId | null {
  if (pressureHpa == null || !Number.isFinite(pressureHpa)) return null;
  if (pressureHpa > 1015) return 'high';
  if (pressureHpa < 1005) return 'low';
  return 'normal';
}

export function getSwellBand(waveHeightM: number | null): SwellBandId | null {
  if (waveHeightM == null || !Number.isFinite(waveHeightM)) return null;
  if (waveHeightM < 1.0) return 'calm';
  if (waveHeightM > 1.8) return 'strong';
  return 'moderate';
}

/**
 * Inverse la courbe monotone Litto3D (x en mètres depuis la dune -> hauteur d'eau z en mètres)
 * par dichotomie afin de déduire la hauteur d'eau effective correspondant à un relevé GPS bord d'eau.
 */
export function invertLitto3dWaterHeightFromX(
  targetXM: number,
  zoneId: 'lestrevet' | 'lieue_de_greve' | 'pentrez' = 'lestrevet'
): number | null {
  if (!Number.isFinite(targetXM) || targetXM < 0) return null;
  let lo = 0.2;
  let hi = 7.8;
  const xAtHi = estimateLitto3dWaterlineXExactM(hi, zoneId);
  const xAtLo = estimateLitto3dWaterlineXExactM(lo, zoneId);
  if (targetXM <= xAtHi) return hi;
  if (targetXM >= xAtLo) return lo;

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const xMid = estimateLitto3dWaterlineXExactM(mid, zoneId);
    if (xMid > targetXM) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Number(((lo + hi) / 2).toFixed(2));
}

/**
 * Fusionne les relevés GPS bord d'eau et les REX terrain à partir du 20/11/2026
 * en privilégiant systématiquement les capteurs réels consolidés.
 */
export function buildPhysicalObservationPoints(
  gpsLogs: GpsWaterlineLog[],
  observations: SlotObservation[],
  activeCadre?: BeachCadreProfile | null,
  startDate: string = OBSERVATORY_START_DATE
): {
  points: PhysicalObservationPoint[];
  excludedPreStartCount: number;
} {
  const softMarginM = activeCadre?.softSandMarginM ?? 50;
  const points: PhysicalObservationPoint[] = [];
  let excludedPreStartCount = 0;

  // 1. Relevés GPS bord d'eau
  for (const log of gpsLogs) {
    if (!log || !log.dateStr) continue;
    if (log.dateStr < startDate) {
      excludedPreStartCount++;
      continue;
    }

    const dynEval = activeCadre
      ? evaluatePointAgainstCadre(log.latitude, log.longitude, activeCadre)
      : null;
    const resolvedDune = resolveTerrainDuneWidthM(
      log.latitude,
      log.longitude,
      dynEval?.widthFromDuneM,
      log.measuredWidthFromDuneM
    );
    const bayZone = classifyBayZone(
      log.latitude,
      log.longitude,
      dynEval?.lateralPosPct ?? log.lateralPosPct
    );

    const theoUsableM = estimateLitto3dUsableWidthM(
      log.theoreticalWaterHeightM,
      softMarginM,
      bayZone.zoneId
    );
    const terrainUsableM =
      resolvedDune.widthFromDuneM != null
        ? Math.max(0, Math.round(resolvedDune.widthFromDuneM - softMarginM))
        : null;
    const widthDeltaM =
      terrainUsableM != null ? Math.round(terrainUsableM - theoUsableM) : null;

    const rw = log.realWeatherSnapshot;

    let surcoteCm: number | null = null;
    let surcoteMethodLabel = 'Seuil école';

    if (resolvedDune.widthFromDuneM != null) {
      const effectiveWaterH = invertLitto3dWaterHeightFromX(
        resolvedDune.widthFromDuneM,
        bayZone.zoneId
      );
      if (effectiveWaterH != null) {
        const rawDelta = Math.round((effectiveWaterH - log.theoreticalWaterHeightM) * 100);
        if (rawDelta >= -120 && rawDelta <= 180) {
          surcoteCm = rawDelta;
          surcoteMethodLabel = 'GPS bord d’eau (Litto3D)';
        }
      }
    }
    if (surcoteCm == null && rw?.shomBrestHeightM != null) {
      const brestEqDz = convertBrestHeightToDouarnenezM(rw.shomBrestHeightM);
      surcoteCm = Math.round((brestEqDz - log.theoreticalWaterHeightM) * 100);
      surcoteMethodLabel = 'Marégraphe SHOM Brest';
    }
    if (surcoteCm == null && Number.isFinite(log.rawSurcoteCm)) {
      surcoteCm = log.rawSurcoteCm;
      surcoteMethodLabel = 'Seuil école';
    }

    const pressureHpa =
      rw?.pressureHpa != null
        ? Math.round(rw.pressureHpa)
        : log.weatherSnapshot?.pressureHpa != null
        ? Math.round(log.weatherSnapshot.pressureHpa)
        : null;
    const waveHeightM =
      rw?.waveHeightM != null
        ? Number(rw.waveHeightM.toFixed(2))
        : log.weatherSnapshot?.waveHeightM != null
        ? Number(log.weatherSnapshot.waveHeightM.toFixed(2))
        : null;
    const wavePeriodS =
      rw?.wavePeriodS != null
        ? Math.round(rw.wavePeriodS)
        : log.weatherSnapshot?.wavePeriodS != null
        ? Math.round(log.weatherSnapshot.wavePeriodS)
        : null;
    const windKts =
      rw?.windSpeedKts != null
        ? Math.round(rw.windSpeedKts)
        : log.weatherSnapshot?.windSpeedKts != null
        ? Math.round(log.weatherSnapshot.windSpeedKts)
        : null;
    const windDirComp =
      rw?.windDirectionComp || log.weatherSnapshot?.windDirectionComp || null;
    const windDirDeg = resolveWindDeg(
      rw?.windDirectionDeg ?? log.weatherSnapshot?.windDirectionDeg ?? null,
      windDirComp
    );
    const windSector = classifyWindDirection(windDirDeg, windDirComp);

    points.push({
      id: `gps-${log.id}`,
      source: 'gps',
      dateStr: log.dateStr,
      timeStr: log.timeStr || '—',
      timestamp: log.timestamp || Date.parse(`${log.dateStr}T12:00:00Z`),
      author: log.author || 'Terrain',
      zoneLabel: bayZone.shortLabel,
      surcoteCm,
      surcoteMethodLabel,
      widthDeltaM,
      terrainUsableM,
      theoUsableM,
      pressureHpa,
      pressureIsReal: rw?.pressureHpa != null,
      waveHeightM,
      wavePeriodS,
      waveIsReal: rw?.waveHeightM != null,
      windKts,
      windDirDeg,
      windDirComp,
      windSector,
      onshoreWindKts: computeOnshoreWindKts(windKts, windDirDeg, windSector),
      beachState: log.beachState,
      note: log.note,
      isConsolidated: log.consolidationStatus === 'consolidated',
    });
  }

  // 2. Observations REX terrain contenant une mesure physique
  for (const obs of observations) {
    if (!obs || !obs.ds) continue;
    const hasPhysicalData =
      obs.waterDeltaCm != null ||
      (obs.observedPressure != null && obs.actualWaterHeight != null);
    if (!hasPhysicalData) continue;

    if (obs.ds < startDate) {
      excludedPreStartCount++;
      continue;
    }

    const parsedTs =
      Date.parse(
        `${obs.ds}T${obs.slotStart && /^\d{2}:\d{2}/.test(obs.slotStart) ? obs.slotStart.slice(0, 5) : '12:00'}:00`
      ) ||
      obs.createdAt ||
      0;

    const pressureHpa = obs.observedPressure != null ? Math.round(obs.observedPressure) : null;
    const waveHeightM = obs.observedWaveH != null ? Number(obs.observedWaveH.toFixed(2)) : null;
    const wavePeriodS = obs.observedWavePeriod != null ? Math.round(obs.observedWavePeriod) : null;
    const windKts = obs.observedWindKts != null ? Math.round(obs.observedWindKts) : null;
    const windDirComp = obs.observedWindDir || null;
    const windDirDeg = resolveWindDeg(null, windDirComp);
    const windSector = classifyWindDirection(windDirDeg, windDirComp);

    points.push({
      id: `rex-${obs.id}`,
      source: 'rex',
      dateStr: obs.ds,
      timeStr: obs.slotStart || '—',
      timestamp: parsedTs,
      author: obs.author || 'REX',
      zoneLabel: 'Lestrevet',
      surcoteCm: obs.waterDeltaCm != null ? Math.round(obs.waterDeltaCm) : null,
      surcoteMethodLabel: 'REX terrain',
      widthDeltaM: null,
      terrainUsableM: null,
      theoUsableM: null,
      pressureHpa,
      pressureIsReal: true,
      waveHeightM,
      wavePeriodS,
      waveIsReal: true,
      windKts,
      windDirDeg,
      windDirComp,
      windSector,
      onshoreWindKts: computeOnshoreWindKts(windKts, windDirDeg, windSector),
      beachState: obs.beachCondition,
      note: obs.notes || obs.cancellationNote,
      isConsolidated: true,
      rawRexObs: obs,
    });
  }

  points.sort((a, b) => b.timestamp - a.timestamp);

  return { points, excludedPreStartCount };
}

export function filterPointsByWindow(
  points: PhysicalObservationPoint[],
  windowFilter: TimeWindowFilter
): PhysicalObservationPoint[] {
  if (windowFilter === 'all') return points;
  const days = windowFilter === '30d' ? 30 : 90;
  const cutoffTs = Date.now() - days * 24 * 3600 * 1000;
  return points.filter(p => p.timestamp >= cutoffTs);
}

/**
 * Construit la Matrice 3×3 (Pression × Houle), filtrée par secteur vent (Tous / Mer / Terre).
 */
export function buildWeatherMatrix3x3(
  points: PhysicalObservationPoint[],
  windFilter: WindFilterMode,
  metric: ObservatoryMetric,
  dayWeather: DayWeatherProfile | null
): WeatherMatrix3x3 {
  const windFiltered =
    windFilter === 'all'
      ? points
      : points.filter(p => p.windSector === windFilter);

  const cells: Record<string, MatrixCellData> = {};
  for (const pb of PRESSURE_BANDS) {
    for (const sb of SWELL_BANDS) {
      const key = `${pb.id}_${sb.id}`;
      cells[key] = {
        key,
        pressureBand: pb.id,
        swellBand: sb.id,
        count: 0,
        avgWidthDeltaM: null,
        widthCount: 0,
        avgSurcoteCm: null,
        surcoteCount: 0,
        minValue: null,
        maxValue: null,
        displayValue: null,
        displayCount: 0,
        tone: 'empty',
        isTodayCell:
          dayWeather?.pressureBand === pb.id && dayWeather?.swellBand === sb.id,
        points: [],
      };
    }
  }

  let totalMatchedPoints = 0;
  let missingWeatherCount = 0;
  let globalValSum = 0;
  let globalValCount = 0;
  let withinTolCount = 0;

  for (const pt of windFiltered) {
    const pb = getPressureBand(pt.pressureHpa);
    const sb = getSwellBand(pt.waveHeightM);
    if (!pb || !sb) {
      missingWeatherCount++;
      continue;
    }
    const cell = cells[`${pb}_${sb}`];
    if (!cell) continue;
    cell.points.push(pt);
    cell.count++;
    totalMatchedPoints++;

    const val = metric === 'width_m' ? pt.widthDeltaM : pt.surcoteCm;
    if (val != null) {
      globalValSum += val;
      globalValCount++;
      if (Math.abs(val) <= 15) withinTolCount++;
    }
  }

  for (const key of Object.keys(cells)) {
    const cell = cells[key];
    const widths = cell.points
      .map(p => p.widthDeltaM)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const surcotes = cell.points
      .map(p => p.surcoteCm)
      .filter((v): v is number => v != null && Number.isFinite(v));

    cell.widthCount = widths.length;
    cell.surcoteCount = surcotes.length;
    cell.avgWidthDeltaM =
      widths.length > 0
        ? Math.round(widths.reduce((s, v) => s + v, 0) / widths.length)
        : null;
    cell.avgSurcoteCm =
      surcotes.length > 0
        ? Math.round(surcotes.reduce((s, v) => s + v, 0) / surcotes.length)
        : null;

    const activeSeries = metric === 'width_m' ? widths : surcotes;
    cell.displayCount = activeSeries.length;
    cell.displayValue =
      metric === 'width_m' ? cell.avgWidthDeltaM : cell.avgSurcoteCm;
    if (activeSeries.length > 0) {
      cell.minValue = Math.min(...activeSeries);
      cell.maxValue = Math.max(...activeSeries);
    }

    if (cell.displayValue == null) {
      cell.tone = 'empty';
    } else if (metric === 'width_m') {
      if (cell.displayValue <= -16) cell.tone = 'danger';
      else if (cell.displayValue <= -7) cell.tone = 'warn';
      else cell.tone = 'good';
    } else {
      if (cell.displayValue >= 16) cell.tone = 'danger';
      else if (cell.displayValue >= 7) cell.tone = 'warn';
      else cell.tone = 'good';
    }
  }

  return {
    cells,
    totalMatchedPoints,
    missingWeatherCount,
    avgDisplayValue:
      globalValCount > 0 ? Math.round(globalValSum / globalValCount) : null,
    withinTolerancePct:
      globalValCount > 0 ? Math.round((withinTolCount / globalValCount) * 100) : null,
  };
}

/**
 * Résout un système linéaire 4×4 par élimination de Gauss avec pivot partiel.
 */
function solveLinear4x4(A: number[][], b: number[]): number[] | null {
  const n = 4;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxVal) {
        maxVal = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (maxVal < 1e-9) return null;
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const diag = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= diag;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }

  return M.map(row => row[n]);
}

/**
 * Régression multivariée avec régularisation Ridge centrée sur les prioris physiques côtiers :
 * y ≈ β0 + β1*(1013 - P) + β2*Hs + β3*(V_onshore / 10)
 * Converge en douceur de la physique côtière (N=0) vers 100 % terrain (N élevé), sans jamais diverger.
 */
function fitRidge4(
  samples: Array<{ x1: number; x2: number; x3: number; y: number }>,
  prior: [number, number, number, number],
  priorLambdas: [number, number, number, number]
): [number, number, number, number] {
  if (samples.length === 0) return prior;

  // On normalise légèrement les variables autour de leur échelle naturelle
  const XtX: number[][] = [
    [priorLambdas[0], 0, 0, 0],
    [0, priorLambdas[1], 0, 0],
    [0, 0, priorLambdas[2], 0],
    [0, 0, 0, priorLambdas[3]],
  ];
  const Xty: number[] = [
    priorLambdas[0] * prior[0],
    priorLambdas[1] * prior[1],
    priorLambdas[2] * prior[2],
    priorLambdas[3] * prior[3],
  ];

  for (const s of samples) {
    const v = [1, s.x1, s.x2, s.x3];
    for (let i = 0; i < 4; i++) {
      Xty[i] += v[i] * s.y;
      for (let j = 0; j < 4; j++) {
        XtX[i][j] += v[i] * v[j];
      }
    }
  }

  const solved = solveLinear4x4(XtX, Xty);
  if (!solved || solved.some(v => !Number.isFinite(v))) return prior;
  return [solved[0], solved[1], solved[2], solved[3]];
}

/**
 * Entraîne le modèle empirique Lestrevet (Pression + Houle + Vent onshore) sur tous les relevés >= 20/11.
 */
export function fitEmpiricalTerrainModel(
  points: PhysicalObservationPoint[]
): EmpiricalTerrainModel {
  const surcoteSamples: Array<{ x1: number; x2: number; x3: number; y: number }> = [];
  const widthSamples: Array<{ x1: number; x2: number; x3: number; y: number }> = [];

  for (const pt of points) {
    const x1 = pt.pressureHpa != null ? 1013 - pt.pressureHpa : 0;
    const x2 = pt.waveHeightM != null ? pt.waveHeightM : 0.8;
    const x3 = pt.onshoreWindKts != null ? pt.onshoreWindKts / 10 : 0;

    // On ne garde que les points qui ont au moins pression ou houle renseignée
    if (pt.pressureHpa == null && pt.waveHeightM == null) continue;

    if (pt.surcoteCm != null) {
      surcoteSamples.push({ x1, x2, x3, y: pt.surcoteCm });
    }
    if (pt.widthDeltaM != null) {
      widthSamples.push({ x1, x2, x3, y: pt.widthDeltaM });
    }
  }

  // Priors physiques réalistes Lestrevet (plage douce) :
  // À 1013 hPa, 0,8 m de houle et vent nul -> surcote = 0 cm (aligné SHOM)
  const surcotePrior: [number, number, number, number] = [-6, 1.0, 7.5, 4.0];
  const [sb0, sb1, sb2, sb3] = fitRidge4(surcoteSamples, surcotePrior, [8, 250, 8, 10]);

  // Largeur plage (m) : pente moyenne ~0,75 m/cm d'eau sur Lestrevet
  const widthPrior: [number, number, number, number] = [4.8, -0.75, -6.0, -3.0];
  const [wb0, wb1, wb2, wb3] = fitRidge4(widthSamples, widthPrior, [8, 250, 8, 10]);

  const evalMae = (
    samples: Array<{ x1: number; x2: number; x3: number; y: number }>,
    b: [number, number, number, number]
  ) => {
    if (samples.length === 0) return { shom: null, cal: null };
    let shomErr = 0;
    let calErr = 0;
    for (const s of samples) {
      shomErr += Math.abs(s.y);
      const pred = b[0] + b[1] * s.x1 + b[2] * s.x2 + b[3] * s.x3;
      calErr += Math.abs(s.y - pred);
    }
    return {
      shom: Math.round((shomErr / samples.length) * 10) / 10,
      cal: Math.round((calErr / samples.length) * 10) / 10,
    };
  };

  const surcoteMae = evalMae(surcoteSamples, [sb0, sb1, sb2, sb3]);
  const widthMae = evalMae(widthSamples, [wb0, wb1, wb2, wb3]);

  const effectiveN = Math.max(surcoteSamples.length, widthSamples.length);
  const terrainConfidencePct =
    effectiveN === 0 ? 0 : Math.min(98, Math.round((effectiveN / (effectiveN + 8)) * 100));

  return {
    sampleCountSurcote: surcoteSamples.length,
    sampleCountWidth: widthSamples.length,
    terrainConfidencePct,
    surcoteCoefs: {
      baseOffsetCm: Math.round(sb0 * 10) / 10,
      cmPerHpaDrop: Math.round(sb1 * 100) / 100,
      cmPerWaveM: Math.round(sb2 * 10) / 10,
      cmPer10KtsOnshore: Math.round(sb3 * 10) / 10,
    },
    shomMaeCm: surcoteMae.shom,
    calibratedMaeCm: surcoteMae.cal,
    shomMaeM: widthMae.shom,
    calibratedMaeM: widthMae.cal,
    widthCoefs: {
      baseOffsetM: Math.round(wb0 * 10) / 10,
      mPerHpaDrop: Math.round(wb1 * 100) / 100,
      mPerWaveM: Math.round(wb2 * 10) / 10,
      mPer10KtsOnshore: Math.round(wb3 * 10) / 10,
    },
  };
}

/**
 * Simule l'impact plage pour n'importe quelle combinaison Pression + Houle + Vent,
 * en combinant le modèle appris sur les relevés + la vérification directe des relevés proches.
 */
export function runTerrainSimulation(
  model: EmpiricalTerrainModel,
  points: PhysicalObservationPoint[],
  pressureHpa: number,
  waveHeightM: number,
  windKts: number,
  windSector: 'sea' | 'land'
): SimulationResult {
  const x1 = 1013 - pressureHpa;
  const x2 = waveHeightM;
  const x3 = (windSector === 'sea' ? windKts : -windKts) / 10;

  const predSurcote =
    model.surcoteCoefs.baseOffsetCm +
    model.surcoteCoefs.cmPerHpaDrop * x1 +
    model.surcoteCoefs.cmPerWaveM * x2 +
    model.surcoteCoefs.cmPer10KtsOnshore * x3;

  const predWidth =
    model.sampleCountWidth >= 3
      ? model.widthCoefs.baseOffsetM +
        model.widthCoefs.mPerHpaDrop * x1 +
        model.widthCoefs.mPerWaveM * x2 +
        model.widthCoefs.mPer10KtsOnshore * x3
      : -predSurcote * 0.78;

  const estimatedSurcoteCm = Math.round(predSurcote);
  const estimatedWidthDeltaM = Math.round(predWidth);
  // Sur Lestrevet, ~10 cm de surcote retirent env. 10 min de fenêtre praticable autour du seuil
  const estimatedTimeDeltaMin = Math.round(-estimatedSurcoteCm * 0.9);

  // Recherche des relevés réellement proches dans la base (>= 65 % de proximité)
  const scored: Array<{ point: PhysicalObservationPoint; similarityPct: number }> = [];
  for (const pt of points) {
    let sum = 0;
    let w = 0;
    if (pt.pressureHpa != null) {
      sum += Math.max(0, 1 - Math.abs(pressureHpa - pt.pressureHpa) / 18) * 0.38;
      w += 0.38;
    }
    if (pt.waveHeightM != null) {
      sum += Math.max(0, 1 - Math.abs(waveHeightM - pt.waveHeightM) / 1.4) * 0.38;
      w += 0.38;
    }
    if (pt.windKts != null) {
      const sp = Math.max(0, 1 - Math.abs(windKts - pt.windKts) / 18);
      const sec =
        pt.windSector === windSector ? 1 : pt.windSector === 'unknown' ? 0.5 : 0;
      sum += (sp * 0.55 + sec * 0.45) * 0.24;
      w += 0.24;
    }
    if (w < 0.3) continue;
    const pct = Math.round((sum / w) * 100);
    if (pct >= 62) {
      scored.push({ point: pt, similarityPct: pct });
    }
  }

  scored.sort((a, b) => b.similarityPct - a.similarityPct);

  const nearbyWidths = scored
    .map(s => s.point.widthDeltaM)
    .filter((v): v is number => v != null);
  const nearbySurcotes = scored
    .map(s => s.point.surcoteCm)
    .filter((v): v is number => v != null);

  let tone: SimulationResult['tone'] = 'good';
  if (estimatedWidthDeltaM <= -16 || estimatedSurcoteCm >= 16) tone = 'danger';
  else if (estimatedWidthDeltaM <= -7 || estimatedSurcoteCm >= 7) tone = 'warn';

  return {
    estimatedWidthDeltaM,
    estimatedSurcoteCm,
    estimatedTimeDeltaMin,
    nearbyCount: scored.length,
    nearbyMinM: nearbyWidths.length > 0 ? Math.min(...nearbyWidths) : null,
    nearbyMaxM: nearbyWidths.length > 0 ? Math.max(...nearbyWidths) : null,
    nearbyMinCm: nearbySurcotes.length > 0 ? Math.min(...nearbySurcotes) : null,
    nearbyMaxCm: nearbySurcotes.length > 0 ? Math.max(...nearbySurcotes) : null,
    nearbyPoints: scored.slice(0, 3),
    tone,
  };
}

function extractDayProfileRaw(
  dateStr: string,
  windList: WindPoint[]
): DayWeatherProfile | null {
  if (!dateStr || !windList || windList.length === 0) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  const [y, m0, d] = parts;
  const startU = toU(y, m0 - 1, d, 9 * 60);
  const endU = toU(y, m0 - 1, d, 18 * 60);

  const dayPts = windList.filter(w => w.t >= startU && w.t <= endU);
  if (dayPts.length === 0) return null;

  const pressures = dayPts
    .map(w => w.p)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const waves = dayPts
    .map(w => w.wvh)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const periods = dayPts
    .map(w => w.wvp)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const speeds = dayPts.map(w => w.v).filter(v => Number.isFinite(v));

  let sinSum = 0;
  let cosSum = 0;
  let dirCount = 0;
  for (const w of dayPts) {
    if (Number.isFinite(w.a)) {
      const rad = (w.a * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
      dirCount++;
    }
  }
  const windDirDeg =
    dirCount > 0
      ? Math.round(((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360)
      : null;
  const windDirComp = windDirDeg != null ? comp(windDirDeg) : null;

  const pressureHpa =
    pressures.length > 0
      ? Math.round(pressures.reduce((s, v) => s + v, 0) / pressures.length)
      : null;
  const waveHeightM =
    waves.length > 0
      ? Number((waves.reduce((s, v) => s + v, 0) / waves.length).toFixed(1))
      : null;
  const wavePeriodS =
    periods.length > 0
      ? Math.round(periods.reduce((s, v) => s + v, 0) / periods.length)
      : null;
  const windKts =
    speeds.length > 0
      ? Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length)
      : null;
  const windSector = classifyWindDirection(windDirDeg, windDirComp);

  return {
    dateStr,
    isFallbackToday: false,
    pressureHpa,
    waveHeightM,
    wavePeriodS,
    windKts,
    windDirDeg,
    windDirComp,
    windSector,
    pressureBand: getPressureBand(pressureHpa),
    swellBand: getSwellBand(waveHeightM),
  };
}

export function extractDayWeatherProfile(
  selectedDate: string,
  windList: WindPoint[]
): DayWeatherProfile | null {
  const exact = extractDayProfileRaw(selectedDate, windList);
  if (exact) return exact;

  const todayStr = tdy();
  if (todayStr !== selectedDate) {
    const todayProf = extractDayProfileRaw(todayStr, windList);
    if (todayProf) return { ...todayProf, isFallbackToday: true };
  }
  return null;
}

/**
 * Estime la surcote empirique (en cm vs SHOM brut) à un instant météo donné
 * en combinant Pression + Houle + Vent (modèle Ridge progressif dès le 20/11/2026).
 * Retourne 0 cm si aucune donnée météo n'est disponible à cette date (ex. > horizon prévision).
 */
export function predictEmpiricalAt(
  model: EmpiricalTerrainModel,
  windPoint: WindPoint | null
): { surcoteCm: number; hasWeather: boolean } {
  if (!windPoint || (windPoint.p == null && windPoint.wvh == null)) {
    return { surcoteCm: 0, hasWeather: false };
  }

  const x1 = windPoint.p != null && Number.isFinite(windPoint.p) ? 1013 - windPoint.p : 0;
  const x2 =
    windPoint.wvh != null && Number.isFinite(windPoint.wvh) ? windPoint.wvh : 0.8;
  const windDeg = Number.isFinite(windPoint.a) ? windPoint.a : null;
  const windKts = Number.isFinite(windPoint.v) ? windPoint.v : null;
  const sector = classifyWindDirection(windDeg, null);
  const onshore = computeOnshoreWindKts(windKts, windDeg, sector) ?? 0;
  const x3 = onshore / 10;

  const rawSurcote =
    model.surcoteCoefs.baseOffsetCm +
    model.surcoteCoefs.cmPerHpaDrop * x1 +
    model.surcoteCoefs.cmPerWaveM * x2 +
    model.surcoteCoefs.cmPer10KtsOnshore * x3;

  // Garde-fou physique raisonnable (-60 cm à +90 cm)
  const clamped = Math.max(-60, Math.min(90, Math.round(rawSurcote)));
  return { surcoteCm: clamped, hasWeather: true };
}

/**
 * Applique le modèle réel empirique (Pression + Houle + Vent) aux extrema de marée SHOM bruts.
 */
export function buildEmpiricalTidePoints(
  rawEX: TidePoint[],
  windList: WindPoint[],
  model: EmpiricalTerrainModel
): TidePoint[] {
  if (!windList || windList.length === 0) return rawEX;
  return rawEX.map(p => {
    const w = windAt(p.t, windList);
    const { surcoteCm, hasWeather } = predictEmpiricalAt(model, w);
    if (!hasWeather || surcoteCm === 0) {
      return { ...p, adj: 0 };
    }
    const adj = Number((surcoteCm / 100).toFixed(2));
    return {
      ...p,
      adj,
      h: Number((p.h + adj).toFixed(2)),
    };
  });
}

