import { AppSettings, GpsWaterlineLog, TidePoint, WindPoint } from '../types';
import { build, comp, hAt, windAt } from './tides';

const STORAGE_KEY = 'cv_waterline_gps_logs_v1';

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

export interface GpsCaptureResult {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracyM: number;
  accuracyQuality: 'high' | 'medium' | 'low';
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
    timestamp: Date.now(),
  };
}

/**
 * Calcule instantanément l'ensemble des métriques hydrodynamiques et météo à l'instant T
 */
export function buildWaterlineSnapshot(
  gps: GpsCaptureResult,
  author: string,
  settings: AppSettings,
  EX: TidePoint[],
  windList: WindPoint[],
  beachState?: GpsWaterlineLog['beachState'],
  note?: string
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
  // À la limite basse de roulage, l'eau réelle est au seuil effectif de roulage L.
  // L'écart par rapport au modèle théorique correspond à la surcote constatée.
  const rawSurcoteCm = Math.round((settings.L - theoreticalWaterHeightM) * 100);
  const correctedSurcoteCm = Math.round((settings.L - correctedWaterHeightM) * 100);

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
    beachState: beachState || 'dur',
    note: note || '',
    createdAt: Date.now(),
  };
}

/**
 * Exporte l'historique complet des relevés GPS en CSV avec BOM UTF-8 compatible Excel
 */
export function exportWaterlineLogsAsCsv(logs: GpsWaterlineLog[]): string {
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
    'Vent_Moyen_nds',
    'Rafales_nds',
    'Direction_deg',
    'Direction_rose',
    'Pression_hPa',
    'Houle_Hauteur_m',
    'Houle_Periode_s',
    'Hauteur_Theorique_SHOM_m',
    'Hauteur_Corrigee_Ecole_m',
    'Seuil_Roulage_Ecole_m',
    'Surcote_Brute_SHOM_cm',
    'Ecart_Modele_Corrige_cm',
    'Etat_Plage',
    'Notes',
  ];

  const rows = logs.map(l => [
    l.id,
    l.dateStr,
    l.timeStr,
    l.author,
    l.latitude,
    l.longitude,
    l.altitude != null ? l.altitude : '',
    l.accuracyM,
    l.accuracyQuality,
    l.weatherSnapshot.windSpeedKts,
    l.weatherSnapshot.windGustKts,
    l.weatherSnapshot.windDirectionDeg,
    l.weatherSnapshot.windDirectionComp,
    l.weatherSnapshot.pressureHpa,
    l.weatherSnapshot.waveHeightM != null ? l.weatherSnapshot.waveHeightM : '',
    l.weatherSnapshot.wavePeriodS != null ? l.weatherSnapshot.wavePeriodS : '',
    l.theoreticalWaterHeightM,
    l.correctedWaterHeightM,
    l.schoolThresholdM,
    l.rawSurcoteCm,
    l.correctedSurcoteCm,
    l.beachState || '',
    `"${(l.note || '').replace(/"/g, '""')}"`,
  ]);

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
