import { AppSettings, BeachCadreProfile, GpsWaterlineLog, TidePoint, WindPoint } from '../types';
import { evaluatePointAgainstCadre } from './beachCadreEngine';
import { classifyBayZone, estimateLitto3dUsableWidthM } from './beachOrientation';
import { build, comp, hAt, windAt } from './tides';

const STORAGE_KEY = 'cv_waterline_gps_logs_v1';
const OFFLINE_QUEUE_KEY = 'cv_waterline_offline_queue_v1';

export function getStoredWaterlineLogs(): GpsWaterlineLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredWaterlineLogs(logs: GpsWaterlineLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (err) {
    console.error('Erreur sauvegarde locale logs GPS:', err);
  }
}

export function getOfflineGpsQueue(): GpsWaterlineLog[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineGpsQueue(queue: GpsWaterlineLog[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Erreur sauvegarde file hors-ligne GPS:', err);
  }
}

export function enqueueOfflineGpsLog(
  snapshot: Omit<GpsWaterlineLog, 'id'>,
  existingOfflineId?: string
): GpsWaterlineLog {
  const queue = getOfflineGpsQueue();
  const id =
    existingOfflineId ||
    `offline_${snapshot.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const entry: GpsWaterlineLog = {
    ...snapshot,
    id,
    offlineQueued: true,
    consolidationStatus: 'pending_offline',
  };
  const next = [entry, ...queue.filter(q => q.id !== id)];
  next.sort((a, b) => b.timestamp - a.timestamp);
  saveOfflineGpsQueue(next);
  return entry;
}

export function removeOfflineGpsLog(offlineId: string): GpsWaterlineLog[] {
  const next = getOfflineGpsQueue().filter(q => q.id !== offlineId);
  saveOfflineGpsQueue(next);
  return next;
}

export function mergeOfflineQueueWithLogs(
  remoteLogs: GpsWaterlineLog[],
  queue: GpsWaterlineLog[]
): GpsWaterlineLog[] {
  if (queue.length === 0) return remoteLogs;
  const existingKeys = new Set(
    remoteLogs.map(l => `${l.timestamp}_${l.author}_${l.latitude.toFixed(5)}`)
  );
  const pending = queue
    .filter(q => !existingKeys.has(`${q.timestamp}_${q.author}_${q.latitude.toFixed(5)}`))
    .map(q => ({ ...q, offlineQueued: true }));
  return [...pending, ...remoteLogs].sort((a, b) => b.timestamp - a.timestamp);
}

export interface RealConditionsApiResponse {
  requestedTs: number;
  requestedDate: string;
  windsUp: {
    status: 'ok' | 'delayed_locked' | 'offline' | 'unavailable';
    windKts?: number;
    minKts?: number;
    maxKts?: number;
    dir?: string;
    deg?: number;
    time?: string;
    deltaMin?: number;
  };
  metar: {
    station: string;
    pressureHpa?: number;
    windKts?: number;
    gustKts?: number;
    windDirDeg?: number;
    obsTimeIso?: string;
    deltaMin?: number;
  } | null;
  shomBrest: {
    station: string;
    waterHeightM?: number;
    obsTimeIso?: string;
    deltaMin?: number;
  } | null;
  candhis: {
    buoy: string;
    waveHeightM?: number;
    wavePeriodS?: number;
    waveDirDeg?: number;
    obsTimeIso?: string;
    deltaMin?: number;
  } | null;
  fetchedAt: string;
}

export async function fetchRealConditionsAt(
  timestampMs: number,
  forceRefresh = false
): Promise<RealConditionsApiResponse | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = `./api/real-conditions?ts=${encodeURIComponent(String(timestampMs))}${
      forceRefresh ? '&refresh=1' : ''
    }`;
    const res = await fetch(url, {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) return null;
    return (await res.json()) as RealConditionsApiResponse;
  } catch {
    return null;
  }
}

export function applyRealConditionsToLog(
  log: GpsWaterlineLog,
  realData: RealConditionsApiResponse | null
): { updatedLog: GpsWaterlineLog; changed: boolean } {
  if (!realData) return { updatedLog: log, changed: false };

  const prev = log.realWeatherSnapshot || {};
  const nextReal: NonNullable<GpsWaterlineLog['realWeatherSnapshot']> = { ...prev };

  if (realData.windsUp?.status === 'ok' && realData.windsUp.windKts != null) {
    nextReal.windSpeedKts = realData.windsUp.windKts;
    nextReal.windGustKts = realData.windsUp.maxKts ?? realData.windsUp.windKts;
    if (realData.windsUp.dir) nextReal.windDirectionComp = realData.windsUp.dir;
    if (realData.windsUp.deg != null) nextReal.windDirectionDeg = realData.windsUp.deg;
    nextReal.windSource = 'windsup_spot66';
    if (realData.windsUp.time) nextReal.windTime = realData.windsUp.time;
  } else if (nextReal.windSpeedKts == null && realData.metar?.windKts != null) {
    nextReal.windSpeedKts = realData.metar.windKts;
    if (realData.metar.gustKts != null) nextReal.windGustKts = realData.metar.gustKts;
    if (realData.metar.windDirDeg != null) {
      nextReal.windDirectionDeg = realData.metar.windDirDeg;
      nextReal.windDirectionComp = comp(realData.metar.windDirDeg);
    }
    nextReal.windSource = 'metar';
  }

  if (realData.metar?.pressureHpa != null) {
    nextReal.pressureHpa = realData.metar.pressureHpa;
    nextReal.pressureStation = realData.metar.station;
  }

  if (realData.shomBrest?.waterHeightM != null) {
    nextReal.shomBrestHeightM = realData.shomBrest.waterHeightM;
  }

  if (realData.candhis?.waveHeightM != null) {
    nextReal.waveHeightM = realData.candhis.waveHeightM;
    if (realData.candhis.wavePeriodS != null) nextReal.wavePeriodS = realData.candhis.wavePeriodS;
    nextReal.waveSource = realData.candhis.buoy;
  }

  const hasWindsUp = nextReal.windSource === 'windsup_spot66' && nextReal.windSpeedKts != null;
  const ageHours = (Date.now() - log.timestamp) / (3600 * 1000);
  const hasAnyReal =
    nextReal.windSpeedKts != null ||
    nextReal.pressureHpa != null ||
    nextReal.shomBrestHeightM != null ||
    nextReal.waveHeightM != null;

  // Consolidé si Winds-Up Spot 66 est présent, ou si > 3h et qu'on a déjà le meilleur relevé réel disponible
  const isConsolidated =
    hasWindsUp ||
    (ageHours >= 3 && realData.windsUp?.status !== 'delayed_locked' && hasAnyReal);

  if (hasAnyReal) {
    nextReal.consolidatedAt = Date.now();
  }

  const nextStatus: GpsWaterlineLog['consolidationStatus'] = isConsolidated
    ? 'consolidated'
    : 'pending_real';

  const prevSerialized = JSON.stringify(log.realWeatherSnapshot || {});
  const nextSerialized = JSON.stringify(nextReal);
  const changed =
    prevSerialized !== nextSerialized || log.consolidationStatus !== nextStatus;

  return {
    updatedLog: {
      ...log,
      realWeatherSnapshot: hasAnyReal ? nextReal : log.realWeatherSnapshot,
      consolidationStatus: nextStatus,
      updatedAt: Date.now(),
    },
    changed,
  };
}

export async function consolidateGpsLogWithRealData(
  log: GpsWaterlineLog,
  forceRefresh = false
): Promise<{ updatedLog: GpsWaterlineLog; changed: boolean }> {
  const realData = await fetchRealConditionsAt(log.timestamp, forceRefresh);
  return applyRealConditionsToLog(log, realData);
}

export interface GpsCaptureResult {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracyM: number;
  accuracyQuality: 'high' | 'medium' | 'low';
  samplesUsed?: number;
  rawSamples?: number;
  spreadM?: number;
  bestAccM?: number;
  worstAccM?: number;
  durationSec?: number;
  trajectoryAcc?: number[];
  timestamp: number;
}

export interface GpsLiveProgress {
  elapsedSec: number;
  maxDurationSec: number;
  rawCount: number;
  validCount: number;
  targetValidCount: number;
  lastAccM: number | null;
  bestAccM: number | null;
  phase: 'warming' | 'acquiring' | 'converged';
  trajectoryAcc: number[];
}

export interface ContinuousGpsOptions {
  targetValidCount?: number;
  maxDurationMs?: number;
  minDurationMs?: number;
  warmupMs?: number;
  maxAccuracyM?: number;
  fallbackMaxAccuracyM?: number;
  allowLowAccuracy?: boolean;
  signal?: AbortSignal;
  onLiveProgress?: (progress: GpsLiveProgress) => void;
  onSampleProgress?: (sampleIndex: number, total: number, lastAcc: number) => void;
}

/**
 * Capture unique haute précision (conservée pour compatibilité)
 */
export function requestHighAccuracyGps(): Promise<GpsCaptureResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("La géolocalisation GPS n'est pas supportée par ce navigateur."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        const acc = Math.round(pos.coords.accuracy * 10) / 10;
        let quality: 'high' | 'medium' | 'low' = 'high';
        if (acc > 15) quality = 'low';
        else if (acc > 5) quality = 'medium';

        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          altitude: pos.coords.altitude != null ? Number(pos.coords.altitude.toFixed(1)) : null,
          accuracyM: acc,
          accuracyQuality: quality,
          timestamp: pos.timestamp || Date.now(),
        });
      },
      err => {
        let msg = 'Impossible de récupérer la position GPS.';
        if (err.code === 1) {
          msg =
            "Autorisation GPS refusée. Autorisez la localisation (et « Position exacte » sur iPhone) dans les réglages de votre smartphone.";
        } else if (err.code === 2) {
          msg = 'Signal GPS indisponible. Vérifiez que la localisation est activée sur votre téléphone.';
        } else if (err.code === 3) {
          msg = "Délai d'attente GPS dépassé. Réessayez à ciel ouvert face à la mer.";
        }
        reject(new Error(msg));
      },
      {
        enableHighAccuracy: true,
        timeout: 14000,
        maximumAge: 0,
      }
    );
  });
}

interface RawFix {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracyM: number;
  timestamp: number;
  elapsedMs: number;
}

function buildWeightedResult(
  pool: RawFix[],
  allReadings: RawFix[],
  durationSec: number,
  trajectoryAcc: number[]
): GpsCaptureResult {
  // Médiane robuste des coordonnées pour éliminer d'éventuels rebonds multi-trajets
  const sortedLats = [...pool].map(r => r.latitude).sort((a, b) => a - b);
  const sortedLons = [...pool].map(r => r.longitude).sort((a, b) => a - b);
  const medLat = sortedLats[Math.floor(sortedLats.length / 2)];
  const medLon = sortedLons[Math.floor(sortedLons.length / 2)];

  let refined = pool;
  if (pool.length >= 5) {
    const withDist = pool
      .map(r => ({ r, dist: calculateGpsDistanceM(r.latitude, r.longitude, medLat, medLon) }))
      .sort((a, b) => a.dist - b.dist);
    const keepCount = Math.max(3, Math.floor(pool.length * 0.8));
    refined = withDist.slice(0, keepCount).map(x => x.r);
  }

  // Moyenne pondérée par variance inverse (1 / σ²) : les fixes ±3 m pèsent bien plus que ±14 m
  let sumWeight = 0;
  let weightedLat = 0;
  let weightedLon = 0;
  let weightedAcc = 0;
  for (const r of refined) {
    const sigma = Math.max(1.5, r.accuracyM);
    const w = 1 / (sigma * sigma);
    sumWeight += w;
    weightedLat += r.latitude * w;
    weightedLon += r.longitude * w;
    weightedAcc += r.accuracyM * w;
  }

  const avgLat = Number((weightedLat / sumWeight).toFixed(6));
  const avgLon = Number((weightedLon / sumWeight).toFixed(6));
  const avgAcc = Number((weightedAcc / sumWeight).toFixed(1));

  const spreadM = Number(
    Math.max(
      0,
      ...refined.map(r => calculateGpsDistanceM(r.latitude, r.longitude, avgLat, avgLon))
    ).toFixed(1)
  );

  const altitudes = refined.map(r => r.altitude).filter((a): a is number => a != null);
  const avgAlt =
    altitudes.length > 0
      ? Number((altitudes.reduce((sum, a) => sum + a, 0) / altitudes.length).toFixed(1))
      : null;

  const allAccs = allReadings.map(r => r.accuracyM);
  const bestAccM = allAccs.length > 0 ? Math.min(...allAccs) : avgAcc;
  const worstAccM = allAccs.length > 0 ? Math.max(...allAccs) : avgAcc;

  let quality: 'high' | 'medium' | 'low' = 'high';
  if (avgAcc > 15) quality = 'low';
  else if (avgAcc > 5) quality = 'medium';

  return {
    latitude: avgLat,
    longitude: avgLon,
    altitude: avgAlt,
    accuracyM: avgAcc,
    accuracyQuality: quality,
    samplesUsed: refined.length,
    rawSamples: allReadings.length,
    spreadM,
    bestAccM,
    worstAccM,
    durationSec: Number(durationSec.toFixed(1)),
    trajectoryAcc,
    timestamp: Date.now(),
  };
}

/**
 * Moteur de capture GNSS continu (watchPosition + pondération 1/σ² + chauffe iPhone/Android).
 * Maintient la puce GPS active en continu pour laisser le temps au fix satellites de converger
 * (évite le piège iOS du fix Wi-Fi/4G à ~40 m renvoyé par getCurrentPosition à froid).
 */
export function acquireContinuousWeightedGps(
  options: ContinuousGpsOptions = {}
): Promise<GpsCaptureResult> {
  const {
    targetValidCount = 4,
    maxDurationMs = 15000,
    minDurationMs = 3500,
    warmupMs = 1800,
    maxAccuracyM = 15,
    fallbackMaxAccuracyM,
    allowLowAccuracy = false,
    signal,
    onLiveProgress,
    onSampleProgress,
  } = options;

  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error("La géolocalisation GPS n'est pas supportée par ce navigateur."));
      return;
    }

    if (signal?.aborted) {
      reject(new Error('Mesure GPS annulée.'));
      return;
    }

    const startTime = Date.now();
    const maxDurationSec = Math.round(maxDurationMs / 1000);
    const allReadings: RawFix[] = [];
    const validReadings: RawFix[] = [];
    const trajectoryAcc: number[] = [];

    let watchId: number | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let lastSig = '';
    let lastAccM: number | null = null;
    let bestAccM: number | null = null;

    const cleanup = () => {
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          // ignore
        }
        watchId = null;
      }
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      if (hardTimeout !== null) {
        clearTimeout(hardTimeout);
        hardTimeout = null;
      }
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const emitProgress = (phaseOverride?: GpsLiveProgress['phase']) => {
      const elapsedSec = Math.min(maxDurationSec, Number(((Date.now() - startTime) / 1000).toFixed(1)));
      const phase: GpsLiveProgress['phase'] =
        phaseOverride ??
        (validReadings.length >= targetValidCount
          ? 'converged'
          : Date.now() - startTime < warmupMs && validReadings.length === 0
          ? 'warming'
          : 'acquiring');

      onLiveProgress?.({
        elapsedSec,
        maxDurationSec,
        rawCount: allReadings.length,
        validCount: validReadings.length,
        targetValidCount,
        lastAccM,
        bestAccM,
        phase,
        trajectoryAcc: trajectoryAcc.slice(-6),
      });
    };

    const finalize = () => {
      if (finished) return;
      finished = true;
      cleanup();

      const durationSec = (Date.now() - startTime) / 1000;
      let pool = validReadings;

      if (pool.length === 0) {
        // Repli : vérifier si une lecture valide (<= maxAccuracyM) était arrivée pendant la chauffe
        pool = allReadings.filter(r => r.accuracyM <= maxAccuracyM);
      }
      if (pool.length === 0 && fallbackMaxAccuracyM != null) {
        pool = allReadings.filter(r => r.accuracyM <= fallbackMaxAccuracyM);
      }
      if (pool.length === 0 && allowLowAccuracy && allReadings.length > 0) {
        // Mode diagnostic : retourner tout de même les meilleures lectures mesurées
        const sortedByAcc = [...allReadings].sort((a, b) => a.accuracyM - b.accuracyM);
        pool = sortedByAcc.slice(0, Math.max(1, Math.min(4, sortedByAcc.length)));
      }

      if (pool.length === 0) {
        if (allReadings.length === 0) {
          reject(
            new Error(
              "Aucun signal satellite reçu en " +
                maxDurationSec +
                " s. Placez-vous à ciel ouvert et vérifiez que la localisation est activée."
            )
          );
          return;
        }
        const best = Math.min(...allReadings.map(r => r.accuracyM));
        const likelyIndoorOrCoarse = best >= 25;
        reject(
          new Error(
            `Signal GPS insuffisant après ${Math.round(durationSec)} s : meilleure précision mesurée ±${best} m (seuil requis ≤ ${maxAccuracyM} m). ` +
              (likelyIndoorOrCoarse
                ? 'En intérieur ou avec « Position exacte » désactivée sur iPhone, le téléphone reste bloqué sur un repère Wi-Fi/4G (~30–65 m). Refaites le test à ciel ouvert.'
                : 'Restez immobile à découvert quelques secondes de plus face à la mer.')
          )
        );
        return;
      }

      emitProgress('converged');
      resolve(buildWeightedResult(pool, allReadings, durationSec, trajectoryAcc));
    };

    const handleAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('Mesure GPS annulée.'));
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    emitProgress('warming');

    tickTimer = setInterval(() => {
      if (finished) return;
      emitProgress();
      const elapsedMs = Date.now() - startTime;
      if (validReadings.length >= targetValidCount && elapsedMs >= minDurationMs) {
        finalize();
      }
    }, 500);

    hardTimeout = setTimeout(() => {
      finalize();
    }, maxDurationMs);

    watchId = navigator.geolocation.watchPosition(
      pos => {
        if (finished) return;
        const now = Date.now();
        const elapsedMs = now - startTime;
        const acc = Math.round(pos.coords.accuracy * 10) / 10;
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        const alt = pos.coords.altitude != null ? Number(pos.coords.altitude.toFixed(1)) : null;

        // Ignorer les doublons strictement identiques mis en cache par iOS
        const sig = `${lat}_${lon}_${acc}_${pos.timestamp}`;
        if (sig === lastSig && allReadings.length > 0) return;
        lastSig = sig;

        const fix: RawFix = {
          latitude: lat,
          longitude: lon,
          altitude: alt,
          accuracyM: acc,
          timestamp: pos.timestamp || now,
          elapsedMs,
        };

        allReadings.push(fix);
        lastAccM = acc;
        bestAccM = bestAccM == null ? acc : Math.min(bestAccM, acc);
        if (trajectoryAcc.length === 0 || trajectoryAcc[trajectoryAcc.length - 1] !== acc) {
          trajectoryAcc.push(acc);
        }

        // Pendant la chauffe initiale, accepter uniquement les fixes déjà très propres (<= 8 m)
        const isWarmup = elapsedMs < warmupMs;
        if (acc <= maxAccuracyM && (!isWarmup || acc <= 8)) {
          validReadings.push(fix);
          onSampleProgress?.(Math.min(validReadings.length, targetValidCount), targetValidCount, acc);
        } else if (validReadings.length === 0) {
          onSampleProgress?.(0, targetValidCount, acc);
        }

        emitProgress();

        // Arrêt anticipé dès que la cible de lectures stables est atteinte après le temps mini
        if (validReadings.length >= targetValidCount && elapsedMs >= minDurationMs) {
          finalize();
        }
      },
      err => {
        if (finished) return;
        // Sur erreur permission (1), arrêter immédiatement ; sur timeout temporaire (3), laisser le watch tourner
        if (err.code === 1) {
          finished = true;
          cleanup();
          reject(
            new Error(
              "Autorisation GPS refusée. Activez la localisation (et « Position exacte » sur iPhone) dans les réglages de votre navigateur."
            )
          );
        } else if (err.code === 2 && allReadings.length === 0 && Date.now() - startTime > 5000) {
          finished = true;
          cleanup();
          reject(new Error('Signal GPS indisponible. Vérifiez que la localisation est activée sur votre smartphone.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: maxDurationMs,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Capture bord de l'eau (Modèle Empirique) : flux continu watchPosition pondéré 1/σ²
 * (jusqu'à 15 s max pour laisser chauffer la puce GPS iPhone/Android, arrêt dès 4 mesures stables ≤ 15 m).
 */
export function requestSmoothedHighAccuracyGps(
  samplesCount: number = 4,
  _sampleDelayMs: number = 600,
  onSampleProgress?: (sampleIndex: number, total: number, lastAcc: number) => void,
  extraOptions?: Pick<ContinuousGpsOptions, 'onLiveProgress' | 'signal' | 'maxDurationMs'>
): Promise<GpsCaptureResult> {
  return acquireContinuousWeightedGps({
    targetValidCount: samplesCount,
    maxDurationMs: extraOptions?.maxDurationMs ?? 15000,
    minDurationMs: 3500,
    warmupMs: 1800,
    maxAccuracyM: 15,
    onSampleProgress,
    onLiveProgress: extraOptions?.onLiveProgress,
    signal: extraOptions?.signal,
  });
}

/**
 * Étalonnage statique haute précision pour les points fixes du Cadre Terrain (Dune, Gauche, Droite) :
 * flux continu watchPosition sur 18 s max, pondération 1/σ² et élagage des 20 % extrêmes.
 */
export function requestCalibratedStationaryGps(
  samplesCount: number = 8,
  _sampleDelayMs: number = 1600,
  onSampleProgress?: (sampleIndex: number, total: number, lastAcc: number) => void,
  extraOptions?: Pick<ContinuousGpsOptions, 'onLiveProgress' | 'signal' | 'maxDurationMs'>
): Promise<GpsCaptureResult> {
  return acquireContinuousWeightedGps({
    targetValidCount: samplesCount,
    maxDurationMs: extraOptions?.maxDurationMs ?? 20000,
    minDurationMs: 6000,
    warmupMs: 2500,
    maxAccuracyM: 15,
    fallbackMaxAccuracyM: 25,
    onSampleProgress,
    onLiveProgress: extraOptions?.onLiveProgress,
    signal: extraOptions?.signal,
  });
}

/**
 * Test de précision GPS sans aucune écriture en base :
 * retourne toujours un diagnostic complet (même si la précision reste > 15 m) pour vérifier son smartphone.
 */
export function runGpsPrecisionDiagnostic(
  onLiveProgress?: (progress: GpsLiveProgress) => void,
  signal?: AbortSignal
): Promise<GpsCaptureResult> {
  return acquireContinuousWeightedGps({
    targetValidCount: 5,
    maxDurationMs: 15000,
    minDurationMs: 4500,
    warmupMs: 1800,
    maxAccuracyM: 15,
    allowLowAccuracy: true,
    onLiveProgress,
    signal,
  });
}

/**
 * Calcule instantanément l'ensemble des métriques hydrodynamiques, météo et largeur depuis la dune à l'instant T
 */
export function buildWaterlineSnapshot(
  gps: GpsCaptureResult,
  author: string,
  settings: AppSettings,
  EX: TidePoint[],
  windList: WindPoint[],
  beachState?: GpsWaterlineLog['beachState'],
  note?: string,
  activeCadre?: BeachCadreProfile | null
): Omit<GpsWaterlineLog, 'id'> {
  const d = new Date(gps.timestamp);
  const dateStr = d.toISOString().slice(0, 10);
  const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Minute UTC pour les calculs de marée
  const utcMinute = Math.floor(gps.timestamp / 60000);

  // 1. Modèle théorique SHOM brut (sans correction barométrique ni vent)
  const rawEX = build(settings.les, false, []);
  const rawH = hAt(utcMinute, rawEX);
  const theoreticalWaterHeightM = rawH != null ? Number(rawH.toFixed(2)) : settings.L;

  // 2. Modèle école corrigé (avec surcote barométrique +1cm/hPa et vent si activé)
  const corrH = hAt(utcMinute, EX);
  const correctedWaterHeightM = corrH != null ? Number(corrH.toFixed(2)) : settings.L;

  // 3. Météo instantanée issue d'AROME à cette minute
  const w = windAt(utcMinute, windList);
  const weatherSnapshot: GpsWaterlineLog['weatherSnapshot'] = {
    windSpeedKts: w ? Math.round(w.v) : 0,
    windGustKts: w && w.g != null ? Math.round(w.g) : (w ? Math.round(w.v) : 0),
    windDirectionDeg: w ? w.a : 270,
    windDirectionComp: w ? comp(w.a) : 'O',
    pressureHpa: w && w.p != null ? Math.round(w.p) : 1013,
    waveHeightM: w?.wvh != null ? Number(w.wvh.toFixed(2)) : undefined,
    wavePeriodS: w?.wvp != null ? Math.round(w.wvp) : undefined,
  };

  // 4. Écarts hydrodynamiques (en cm)
  const rawSurcoteCm = Math.round((settings.L - theoreticalWaterHeightM) * 100);
  const correctedSurcoteCm = Math.round((settings.L - correctedWaterHeightM) * 100);

  // 5. Mesures géométriques par rapport au Cadre Terrain (Largeur depuis la Dune + Position Gauche/Droite)
  const cadreEval = activeCadre
    ? evaluatePointAgainstCadre(gps.latitude, gps.longitude, activeCadre)
    : null;
  const softMarginM = activeCadre?.softSandMarginM ?? 50;
  const usableWidthM =
    cadreEval?.widthFromDuneM != null
      ? Math.max(0, cadreEval.widthFromDuneM - softMarginM)
      : estimateLitto3dUsableWidthM(correctedWaterHeightM, softMarginM);
  const bayZone = classifyBayZone(gps.latitude, gps.longitude, cadreEval?.lateralPosPct);

  return {
    timestamp: gps.timestamp,
    dateStr,
    timeStr,
    author,
    latitude: gps.latitude,
    longitude: gps.longitude,
    altitude: gps.altitude,
    accuracyM: gps.accuracyM,
    accuracyQuality: gps.accuracyQuality,
    weatherSnapshot,
    theoreticalWaterHeightM,
    correctedWaterHeightM,
    schoolThresholdM: settings.L,
    rawSurcoteCm,
    correctedSurcoteCm,
    measuredWidthFromDuneM: cadreEval?.widthFromDuneM ?? undefined,
    usableWidthM,
    beachZone: bayZone.zoneId,
    lateralPosFromLeftM: cadreEval?.lateralPosFromLeftM ?? undefined,
    lateralPosPct: cadreEval?.lateralPosPct ?? undefined,
    isInsideZone: cadreEval?.isInsideZone ?? undefined,
    cadreProfileUsed: cadreEval?.widthFromDuneM != null ? cadreEval.profileKey : undefined,
    beachState: beachState || 'dur',
    note: note || '',
    createdAt: Date.now(),
  };
}

/**
 * Exporte l'historique complet des relevés GPS en CSV avec BOM UTF-8 compatible Excel
 */
export function exportWaterlineLogsAsCsv(
  logs: GpsWaterlineLog[],
  activeCadre?: BeachCadreProfile | null
): string {
  const headers = [
    'ID',
    'Date',
    'Heure',
    'Auteur',
    'Latitude',
    'Longitude',
    'Altitude_m',
    'Precision_GPS_m',
    'Qualite_GPS',
    'Zone_Plage',
    'Largeur_Dune_Mer_m',
    'Largeur_Utile_Exploitable_m',
    'Position_Depuis_Gauche_m',
    'Position_Couloir_pct',
    'Dans_Cadre_Roulage',
    'Cadre_Reference',
    'Vent_Moyen_nds',
    'Rafales_nds',
    'Direction_deg',
    'Direction_rose',
    'Pression_hPa',
    'Houle_Hauteur_m',
    'Houle_Periode_s',
    'Vent_Reel_nds',
    'Rafales_Reelles_nds',
    'Direction_Reelle',
    'Source_Vent_Reel',
    'Pression_Reelle_hPa',
    'Station_Pression',
    'Maregraphe_SHOM_Brest_m',
    'Houle_Reelle_m',
    'Periode_Houle_Reelle_s',
    'Statut_Consolidation',
    'Hauteur_Theorique_SHOM_m',
    'Hauteur_Corrigee_Ecole_m',
    'Seuil_Roulage_Ecole_m',
    'Surcote_Brute_SHOM_cm',
    'Ecart_Modele_Corrige_cm',
    'Etat_Plage',
    'Notes',
  ];

  const softMarginM = activeCadre?.softSandMarginM ?? 50;
  const rows = logs.map(l => {
    const dynEval = activeCadre ? evaluatePointAgainstCadre(l.latitude, l.longitude, activeCadre) : null;
    const widthNum = dynEval?.widthFromDuneM ?? l.measuredWidthFromDuneM ?? null;
    const widthM = widthNum ?? '';
    const usableW =
      widthNum != null
        ? Math.max(0, widthNum - softMarginM)
        : l.usableWidthM ?? estimateLitto3dUsableWidthM(l.correctedWaterHeightM, softMarginM);
    const bayZone = classifyBayZone(l.latitude, l.longitude, dynEval?.lateralPosPct ?? l.lateralPosPct);
    const latPosM = dynEval?.lateralPosFromLeftM ?? l.lateralPosFromLeftM ?? '';
    const latPct = dynEval?.lateralPosPct ?? l.lateralPosPct ?? '';
    const inZone =
      dynEval?.isInsideZone != null
        ? (dynEval.isInsideZone ? 'Oui' : 'Hors cadre')
        : l.isInsideZone != null
        ? (l.isInsideZone ? 'Oui' : 'Hors cadre')
        : '';
    const cadreRef = dynEval?.widthFromDuneM != null ? dynEval.profileKey : (l.cadreProfileUsed || '');
    const rw = l.realWeatherSnapshot;

    return [
      l.id,
      l.dateStr,
      l.timeStr,
      l.author,
      l.latitude,
      l.longitude,
      l.altitude != null ? l.altitude : '',
      l.accuracyM,
      l.accuracyQuality,
      bayZone.shortLabel,
      widthM,
      usableW,
      latPosM,
      latPct,
      inZone,
      cadreRef,
      l.weatherSnapshot.windSpeedKts,
      l.weatherSnapshot.windGustKts,
      l.weatherSnapshot.windDirectionDeg,
      l.weatherSnapshot.windDirectionComp,
      l.weatherSnapshot.pressureHpa,
      l.weatherSnapshot.waveHeightM != null ? l.weatherSnapshot.waveHeightM : '',
      l.weatherSnapshot.wavePeriodS != null ? l.weatherSnapshot.wavePeriodS : '',
      rw?.windSpeedKts != null ? rw.windSpeedKts : '',
      rw?.windGustKts != null ? rw.windGustKts : '',
      rw?.windDirectionComp || '',
      rw?.windSource || '',
      rw?.pressureHpa != null ? rw.pressureHpa : '',
      rw?.pressureStation || '',
      rw?.shomBrestHeightM != null ? rw.shomBrestHeightM : '',
      rw?.waveHeightM != null ? rw.waveHeightM : '',
      rw?.wavePeriodS != null ? rw.wavePeriodS : '',
      l.consolidationStatus || '',
      l.theoreticalWaterHeightM,
      l.correctedWaterHeightM,
      l.schoolThresholdM,
      l.rawSurcoteCm,
      l.correctedSurcoteCm,
      l.beachState || '',
      `"${(l.note || '').replace(/"/g, '""')}"`,
    ];
  });

  const csvRows = [headers.join(';'), ...rows.map(r => r.join(';'))];
  return '\uFEFF' + csvRows.join('\r\n');
}

/**
 * Calcule la distance approximative en mètres entre deux coordonnées géodésiques (formule de Haversine)
 */
export function calculateGpsDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Rayon de la Terre en mètres
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Recherche si un relevé très récent (< 60 secondes) a été effectué par le même auteur au même endroit (< 25 m)
 */
export function findRecentDuplicateGpsLog(
  newLat: number,
  newLon: number,
  author: string,
  existingLogs: GpsWaterlineLog[],
  windowSeconds: number = 60
): GpsWaterlineLog | null {
  const now = Date.now();
  for (const log of existingLogs) {
    const elapsedSeconds = (now - log.timestamp) / 1000;
    // Si la mesure a été prise il y a moins de X secondes par le même auteur
    if (elapsedSeconds >= 0 && elapsedSeconds <= windowSeconds && log.author === author) {
      const dist = calculateGpsDistanceM(newLat, newLon, log.latitude, log.longitude);
      // À moins de 25 mètres sur la plage = c'est le même point
      if (dist <= 25) {
        return log;
      }
    }
  }
  return null;
}

export const GPS_DIAGNOSTIC_THRESHOLD = 20;

export interface GpsZoneDiagnostic {
  zoneId: 'lestrevet' | 'lieue_de_greve' | 'pentrez';
  label: string;
  count: number;
  avgUsableWidthM: number | null;
  avgCorrDeltaCm: number | null;
}

export interface GpsDiagnosticSummary {
  totalCount: number;
  threshold: number;
  isReady: boolean;
  progressPct: number;
  remaining: number;
  consolidatedCount: number;
  avgTheoreticalWaterM: number | null;
  avgCorrectedWaterM: number | null;
  avgShomBrestWaterM: number | null;
  avgRawSurcoteCm: number | null;
  avgCorrSurcoteCm: number | null;
  suggestedThresholdM: number | null;
  deltaFromCurrentCm: number | null;
  verdictLevel: 'empty' | 'preliminary' | 'aligned' | 'higher' | 'lower';
  verdictText: string;
  lowPressureCount: number;
  lowPressureAvgRawCm: number | null;
  normalHighPressureCount: number;
  normalHighPressureAvgRawCm: number | null;
  seaWindCount: number;
  seaWindAvgRawCm: number | null;
  bachesCount: number;
  bachesPct: number;
  zones: GpsZoneDiagnostic[];
}

/**
 * Synthèse diagnostique des relevés GPS bord de l'eau (palier utile dès 20 mesures).
 * Confronte la hauteur d'eau réelle au moment des relevés au seuil configuré de l'école (settings.L).
 */
export function computeGpsDiagnosticSummary(
  logs: GpsWaterlineLog[],
  currentThresholdM: number,
  activeCadre?: BeachCadreProfile | null
): GpsDiagnosticSummary {
  const totalCount = logs.length;
  const threshold = GPS_DIAGNOSTIC_THRESHOLD;
  const isReady = totalCount >= threshold;
  const progressPct = Math.min(100, Math.round((totalCount / threshold) * 100));
  const remaining = Math.max(0, threshold - totalCount);

  const zoneMeta: Array<{ id: 'lestrevet' | 'lieue_de_greve' | 'pentrez'; label: string }> = [
    { id: 'lestrevet', label: 'Lestrevet (Sud)' },
    { id: 'lieue_de_greve', label: 'Lieue de Grève' },
    { id: 'pentrez', label: 'Pentrez (Nord)' },
  ];

  if (totalCount === 0) {
    return {
      totalCount: 0,
      threshold,
      isReady: false,
      progressPct: 0,
      remaining: threshold,
      consolidatedCount: 0,
      avgTheoreticalWaterM: null,
      avgCorrectedWaterM: null,
      avgShomBrestWaterM: null,
      avgRawSurcoteCm: null,
      avgCorrSurcoteCm: null,
      suggestedThresholdM: null,
      deltaFromCurrentCm: null,
      verdictLevel: 'empty',
      verdictText:
        'Enregistrez vos 20 premiers relevés bord de l’eau (sur plusieurs coefficients et météos) pour obtenir un premier diagnostic chiffré du seuil réel de Lestrevet.',
      lowPressureCount: 0,
      lowPressureAvgRawCm: null,
      normalHighPressureCount: 0,
      normalHighPressureAvgRawCm: null,
      seaWindCount: 0,
      seaWindAvgRawCm: null,
      bachesCount: 0,
      bachesPct: 0,
      zones: zoneMeta.map(z => ({
        zoneId: z.id,
        label: z.label,
        count: 0,
        avgUsableWidthM: null,
        avgCorrDeltaCm: null,
      })),
    };
  }

  const softMarginM = activeCadre?.softSandMarginM ?? 50;
  let sumTheo = 0;
  let sumCorr = 0;
  let sumRawCm = 0;
  let sumCorrCm = 0;

  let sumShomBrest = 0;
  let shomBrestCount = 0;
  let consolidatedCount = 0;

  let lowPCount = 0;
  let lowPSumRaw = 0;
  let normPCount = 0;
  let normPSumRaw = 0;

  let seaWindCount = 0;
  let seaWindSumRaw = 0;

  let bachesCount = 0;

  const zoneBuckets: Record<
    'lestrevet' | 'lieue_de_greve' | 'pentrez',
    { count: number; sumW: number; wCount: number; sumCorrCm: number }
  > = {
    lestrevet: { count: 0, sumW: 0, wCount: 0, sumCorrCm: 0 },
    lieue_de_greve: { count: 0, sumW: 0, wCount: 0, sumCorrCm: 0 },
    pentrez: { count: 0, sumW: 0, wCount: 0, sumCorrCm: 0 },
  };

  for (const l of logs) {
    sumTheo += l.theoreticalWaterHeightM;
    sumCorr += l.correctedWaterHeightM;
    sumRawCm += l.rawSurcoteCm;
    sumCorrCm += l.correctedSurcoteCm;

    if (l.consolidationStatus === 'consolidated') {
      consolidatedCount += 1;
    }
    if (l.realWeatherSnapshot?.shomBrestHeightM != null) {
      sumShomBrest += l.realWeatherSnapshot.shomBrestHeightM;
      shomBrestCount += 1;
    }

    const pressure = l.realWeatherSnapshot?.pressureHpa ?? l.weatherSnapshot.pressureHpa;
    if (pressure != null) {
      if (pressure < 1005) {
        lowPCount += 1;
        lowPSumRaw += l.rawSurcoteCm;
      } else {
        normPCount += 1;
        normPSumRaw += l.rawSurcoteCm;
      }
    }

    const windDeg = l.realWeatherSnapshot?.windDirectionDeg ?? l.weatherSnapshot.windDirectionDeg;
    // Secteur mer / baie Ouest (SO à NO : 200° à 320°)
    if (windDeg != null && windDeg >= 200 && windDeg <= 320) {
      seaWindCount += 1;
      seaWindSumRaw += l.rawSurcoteCm;
    }

    if (l.beachState === 'baches_faibles' || l.beachState === 'baches_fortes') {
      bachesCount += 1;
    }

    const dynEval = activeCadre ? evaluatePointAgainstCadre(l.latitude, l.longitude, activeCadre) : null;
    const bayZone = classifyBayZone(l.latitude, l.longitude, dynEval?.lateralPosPct ?? l.lateralPosPct);
    const bucket = zoneBuckets[bayZone.zoneId];
    bucket.count += 1;
    bucket.sumCorrCm += l.correctedSurcoteCm;
    const widthFromDune = dynEval?.widthFromDuneM ?? l.measuredWidthFromDuneM;
    const usableW =
      widthFromDune != null
        ? Math.max(0, widthFromDune - softMarginM)
        : l.usableWidthM ?? estimateLitto3dUsableWidthM(l.correctedWaterHeightM, softMarginM);
    if (usableW != null) {
      bucket.sumW += usableW;
      bucket.wCount += 1;
    }
  }

  const avgTheoreticalWaterM = Number((sumTheo / totalCount).toFixed(2));
  const avgCorrectedWaterM = Number((sumCorr / totalCount).toFixed(2));
  const avgShomBrestWaterM =
    shomBrestCount > 0 ? Number((sumShomBrest / shomBrestCount).toFixed(2)) : null;
  const avgRawSurcoteCm = Math.round(sumRawCm / totalCount);
  const avgCorrSurcoteCm = Math.round(sumCorrCm / totalCount);

  // Hauteur corrigée moyenne constatée quand le moniteur se tient à la limite basse de roulage
  const suggestedThresholdM = avgCorrectedWaterM;
  const deltaFromCurrentCm = Math.round((suggestedThresholdM - currentThresholdM) * 100);

  let verdictLevel: GpsDiagnosticSummary['verdictLevel'] = 'preliminary';
  let verdictText = '';
  if (!isReady) {
    verdictLevel = 'preliminary';
    verdictText = `Tendance préliminaire (${totalCount}/${threshold} mesures) : hauteur corrigée moyenne constatée à la limite basse = ${avgCorrectedWaterM.toFixed(
      2
    )} m (vs seuil actuel ${currentThresholdM.toFixed(2)} m, soit ${
      deltaFromCurrentCm > 0 ? `+${deltaFromCurrentCm}` : deltaFromCurrentCm
    } cm). Encore ${remaining} relevé${remaining > 1 ? 's' : ''} pour fiabiliser le diagnostic.`;
  } else if (Math.abs(deltaFromCurrentCm) <= 10) {
    verdictLevel = 'aligned';
    verdictText = `Seuil actuel (${currentThresholdM.toFixed(
      2
    )} m) confirmé par le terrain : hauteur corrigée moyenne mesurée = ${avgCorrectedWaterM.toFixed(
      2
    )} m (écart de ${deltaFromCurrentCm > 0 ? `+${deltaFromCurrentCm}` : deltaFromCurrentCm} cm, dans la marge normale ±10 cm).`;
  } else if (deltaFromCurrentCm > 10) {
    verdictLevel = 'higher';
    verdictText = `La plage reste roulable plus haut que prévu (+${deltaFromCurrentCm} cm en moyenne) : seuil mesuré autour de ${suggestedThresholdM.toFixed(
      2
    )} m contre ${currentThresholdM.toFixed(2)} m actuellement. À valider avec Jérôme avant d’ajuster le curseur.`;
  } else {
    verdictLevel = 'lower';
    verdictText = `La mer limite le roulage plus tôt que prévu (${deltaFromCurrentCm} cm en moyenne) : seuil mesuré autour de ${suggestedThresholdM.toFixed(
      2
    )} m contre ${currentThresholdM.toFixed(2)} m actuellement. Envisager un réglage plus prudent avec Jérôme.`;
  }

  return {
    totalCount,
    threshold,
    isReady,
    progressPct,
    remaining,
    consolidatedCount,
    avgTheoreticalWaterM,
    avgCorrectedWaterM,
    avgShomBrestWaterM,
    avgRawSurcoteCm,
    avgCorrSurcoteCm,
    suggestedThresholdM,
    deltaFromCurrentCm,
    verdictLevel,
    verdictText,
    lowPressureCount: lowPCount,
    lowPressureAvgRawCm: lowPCount > 0 ? Math.round(lowPSumRaw / lowPCount) : null,
    normalHighPressureCount: normPCount,
    normalHighPressureAvgRawCm: normPCount > 0 ? Math.round(normPSumRaw / normPCount) : null,
    seaWindCount,
    seaWindAvgRawCm: seaWindCount > 0 ? Math.round(seaWindSumRaw / seaWindCount) : null,
    bachesCount,
    bachesPct: Math.round((bachesCount / totalCount) * 100),
    zones: zoneMeta.map(z => {
      const b = zoneBuckets[z.id];
      return {
        zoneId: z.id,
        label: z.label,
        count: b.count,
        avgUsableWidthM: b.wCount > 0 ? Math.round(b.sumW / b.wCount) : null,
        avgCorrDeltaCm: b.count > 0 ? Math.round(b.sumCorrCm / b.count) : null,
      };
    }),
  };
}

