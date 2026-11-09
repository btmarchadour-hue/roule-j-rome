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
