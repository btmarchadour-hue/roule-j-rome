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
  spreadM?: number;
  timestamp: number;
}

/**
  * Capture la position GPS du smartphone avec contrainte de haute précision
 */
export function requestHighAccuracyGps(): Promise<GpsCaptureResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('La géolocalisation GPS n\'est pas supportée par ce navigateur.'));
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
        if (err.code === 1) msg = 'Autorisation GPS refusée. Veuillez autoriser l\'accès à la localisation dans les réglages de votre smartphone.';
        else if (err.code === 2) msg = 'Signal GPS indisponible. Vérifiez que la localisation est activée.';
        else if (err.code === 3) msg = 'Délai d\'attente GPS dépassé. Veuillez réessayer à découvert sur la plage.';
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

/**
 * Étape 1 du Modèle Empirique : Capture moyennée multi-échantillons (3 à 5 lectures successives)
 * avec filtrage strict de précision (rejet/avertissement si accuracy > 15 m et suppression du flottement).
 */
export async function requestSmoothedHighAccuracyGps(
  samplesCount: number = 4,
  sampleDelayMs: number = 600,
  onSampleProgress?: (sampleIndex: number, total: number, lastAcc: number) => void
): Promise<GpsCaptureResult> {
  const readings: GpsCaptureResult[] = [];

  for (let i = 0; i < samplesCount; i++) {
    const single = await requestHighAccuracyGps();
    readings.push(single);
    onSampleProgress?.(i + 1, samplesCount, single.accuracyM);

    if (i < samplesCount - 1) {
      await new Promise(r => setTimeout(r, sampleDelayMs));
    }
  }

  // Filtrage de précision : éliminer les lectures aberrantes (> 15m) si des lectures précises existent
  const validReadings = readings.filter(r => r.accuracyM <= 15);

  if (validReadings.length === 0) {
    const bestAcc = Math.min(...readings.map(r => r.accuracyM));
    throw new Error(
      `Signal GPS insuffisant : la meilleure précision mesurée est de ${bestAcc} m (le seuil requis est inférieur à 15 m). Rapprochez-vous du front de mer à découvert pour une meilleure visibilité satellite.`
    );
  }

  // Moyenne arithmétique sur les coordonnées fiabilisées
  const sumLat = validReadings.reduce((sum, r) => sum + r.latitude, 0);
  const sumLon = validReadings.reduce((sum, r) => sum + r.longitude, 0);
  const sumAcc = validReadings.reduce((sum, r) => sum + r.accuracyM, 0);

  const altitudes = validReadings.map(r => r.altitude).filter((a): a is number => a != null);
  const avgAlt = altitudes.length > 0 ? Number((altitudes.reduce((sum, a) => sum + a, 0) / altitudes.length).toFixed(1)) : null;

  const avgLat = Number((sumLat / validReadings.length).toFixed(6));
  const avgLon = Number((sumLon / validReadings.length).toFixed(6));
  const avgAcc = Number((sumAcc / validReadings.length).toFixed(1));

  let quality: 'high' | 'medium' | 'low' = 'high';
  if (avgAcc > 15) quality = 'low';
  else if (avgAcc > 5) quality = 'medium';

  return {
    latitude: avgLat,
    longitude: avgLon,
    altitude: avgAlt,
    accuracyM: avgAcc,
    accuracyQuality: quality,
    samplesUsed: validReadings.length,
    timestamp: Date.now(),
  };
}

/**
 * Étalonnage statique haute précision pour les points fixes du Cadre Terrain (Dune, Gauche, Droite) :
 * 10 mesures espacées de ~1,6 s, filtrage <= 15 m puis élagage des valeurs les plus éloignées du centroïde médian.
 */
export async function requestCalibratedStationaryGps(
  samplesCount: number = 10,
  sampleDelayMs: number = 1600,
  onSampleProgress?: (sampleIndex: number, total: number, lastAcc: number) => void
): Promise<GpsCaptureResult> {
  const readings: GpsCaptureResult[] = [];

  for (let i = 0; i < samplesCount; i++) {
    const single = await requestHighAccuracyGps();
    readings.push(single);
    onSampleProgress?.(i + 1, samplesCount, single.accuracyM);

    if (i < samplesCount - 1) {
      await new Promise(r => setTimeout(r, sampleDelayMs));
    }
  }

  let pool = readings.filter(r => r.accuracyM <= 15);
  if (pool.length === 0) {
    // Tolérance élargie à 25 m si couverture faible, sinon erreur explicite
    pool = readings.filter(r => r.accuracyM <= 25);
  }
  if (pool.length === 0) {
    const bestAcc = Math.min(...readings.map(r => r.accuracyM));
    throw new Error(
      `Signal GPS insuffisant pour l'étalonnage fixe (meilleure précision : ±${bestAcc} m). Restez immobile à découvert pendant la mesure.`
    );
  }

  // Médiane robuste des coordonnées pour éliminer d'éventuels rebonds multi-trajets
  const sortedLats = [...pool].map(r => r.latitude).sort((a, b) => a - b);
  const sortedLons = [...pool].map(r => r.longitude).sort((a, b) => a - b);
  const medLat = sortedLats[Math.floor(sortedLats.length / 2)];
  const medLon = sortedLons[Math.floor(sortedLons.length / 2)];

  let refined = pool;
  if (pool.length >= 6) {
    const withDist = pool
      .map(r => ({ r, dist: calculateGpsDistanceM(r.latitude, r.longitude, medLat, medLon) }))
      .sort((a, b) => a.dist - b.dist);
    // Garder les 80 % centraux les plus stables
    const keepCount = Math.max(4, Math.floor(pool.length * 0.8));
    refined = withDist.slice(0, keepCount).map(x => x.r);
  }

  const avgLat = Number((refined.reduce((s, r) => s + r.latitude, 0) / refined.length).toFixed(6));
  const avgLon = Number((refined.reduce((s, r) => s + r.longitude, 0) / refined.length).toFixed(6));
  const avgAcc = Number((refined.reduce((s, r) => s + r.accuracyM, 0) / refined.length).toFixed(1));
  const spreadM = Number(
    Math.max(
      0,
      ...refined.map(r => calculateGpsDistanceM(r.latitude, r.longitude, avgLat, avgLon))
    ).toFixed(1)
  );

  const altitudes = refined.map(r => r.altitude).filter((a): a is number => a != null);
  const avgAlt = altitudes.length > 0 ? Number((altitudes.reduce((sum, a) => sum + a, 0) / altitudes.length).toFixed(1)) : null;

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
    spreadM,
    timestamp: Date.now(),
  };
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
