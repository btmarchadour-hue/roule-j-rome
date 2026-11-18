import { TidePoint, WindPoint, WindsUpSpotData } from '../types';
import { comp, hAt, toU, windAt, wstat } from './tides';
import { fetchPublicWindsUpSpot66Fallback } from './windsUpFallback';

export interface SlotWeatherRexDefaults {
  windKts?: number;
  gustKts?: number;
  windDir?: string;
  pressureHpa?: number;
  waveH?: number;
  wavePeriod?: number;
  theoreticalWaterM?: number;
  windSource: 'windsup' | 'arome' | 'global' | 'none';
  windSourceLabel: string;
}

const VALID_MODAL_DIRS = new Set(['O', 'SO', 'ONO', 'NO', 'N', 'NNE', 'NE', 'E', 'SE', 'S']);

/**
 * Normalise une direction textuelle (FR/EN ou rose 16 points) vers une valeur compatible
 * avec les sélecteurs du REX.
 */
export function normalizeFrenchWindDir(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const up = raw
    .trim()
    .toUpperCase()
    .replace(/W/g, 'O');

  if (!up) return undefined;
  if (VALID_MODAL_DIRS.has(up)) return up;

  const fallbackMap: Record<string, string> = {
    OSO: 'SO',
    SSO: 'SO',
    NNO: 'NO',
    ENE: 'NE',
    ESE: 'SE',
    SSE: 'SE',
  };
  if (fallbackMap[up]) return fallbackMap[up];
  return up;
}

function parseHHMMToMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim().replace('h', ':');
  const m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/**
 * Tente de récupérer les mesures réelles Winds-Up Spot 66 (Pentrez/Lestrevet) pour une date donnée,
 * sans jamais bloquer ni lever d'erreur si la balise ou le réseau est indisponible.
 */
export async function fetchWindsUpQuietly(dateStr: string): Promise<WindsUpSpotData | null> {
  const query = `?date=${encodeURIComponent(dateStr)}`;
  const proxyBase = (import.meta.env.VITE_WINDSUP_PROXY_URL || '').trim().replace(/\/+$/, '');
  const isStaticGitHubPages =
    typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io');

  const tryFetchJson = async (url: string, init: RequestInit): Promise<WindsUpSpotData | null> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        return (await res.json()) as WindsUpSpotData;
      }
    } catch {
      // Ignore network/proxy errors cleanly
    }
    return null;
  };

  if (isStaticGitHubPages && proxyBase) {
    const proxyRes = await tryFetchJson(`${proxyBase}${query}`, {
      mode: 'cors',
      credentials: 'omit',
    });
    if (proxyRes) return proxyRes;
  } else {
    const localRes = await tryFetchJson(`./api/windsup/spot66${query}`, {
      credentials: 'same-origin',
    });
    if (localRes && (!localRes.isDelayed || !proxyBase)) return localRes;
    if (proxyBase) {
      const proxyRes = await tryFetchJson(`${proxyBase}${query}`, {
        mode: 'cors',
        credentials: 'omit',
      });
      if (proxyRes && (!proxyRes.isDelayed || !localRes)) return proxyRes;
    }
    if (localRes) return localRes;
  }

  try {
    return await fetchPublicWindsUpSpot66Fallback(dateStr);
  } catch {
    return null;
  }
}

/**
 * Extrait les conditions météo et marée automatiques pour un créneau donné,
 * en privilégiant la balise réelle Winds-Up si elle couvre la plage horaire,
 * puis AROME / Global / Marine pour pression et houle.
 */
export function getSlotWeatherRexDefaults(
  dateStr: string,
  slotStart: string,
  slotEnd: string,
  EX: TidePoint[],
  windList: WindPoint[],
  windsUpData?: WindsUpSpotData | null
): SlotWeatherRexDefaults {
  const [y, m0, d] = dateStr.split('-').map(Number);
  const startMin = parseHHMMToMinutes(slotStart);
  const endMin = parseHHMMToMinutes(slotEnd);

  if (!y || !m0 || !d || startMin == null || endMin == null) {
    return { windSource: 'none', windSourceLabel: 'Non disponible' };
  }

  const m = m0 - 1;
  const startU = toU(y, m, d, startMin);
  const endU = toU(y, m, d, Math.max(startMin + 15, endMin));
  const midU = Math.round((startU + endU) / 2);

  // 1. Modèle théorique (AROME / Global + Marine)
  const st = wstat(startU, endU, windList);
  const midW = windAt(midU, windList);
  const waterH = hAt(midU, EX);

  let windKts: number | undefined = st
    ? Math.round((st.lo + st.hi) / 2)
    : midW
    ? Math.round(midW.v)
    : undefined;
  let gustKts: number | undefined = st
    ? Math.round(st.g)
    : midW?.g != null
    ? Math.round(midW.g)
    : undefined;
  let windDir: string | undefined = normalizeFrenchWindDir(
    st ? comp(st.dir) : midW ? comp(midW.a) : undefined
  );
  const pressureHpa = midW?.p != null ? Math.round(midW.p) : undefined;
  const waveH = midW?.wvh != null ? Number(midW.wvh.toFixed(1)) : undefined;
  const wavePeriod = midW?.wvp != null ? Math.round(midW.wvp) : undefined;
  const theoreticalWaterM = waterH != null ? Number(waterH.toFixed(2)) : undefined;

  let windSource: SlotWeatherRexDefaults['windSource'] = st
    ? st.src === 'A'
      ? 'arome'
      : 'global'
    : midW
    ? midW.s === 'A'
      ? 'arome'
      : 'global'
    : 'none';
  let windSourceLabel =
    windSource === 'arome'
      ? 'Modèle AROME'
      : windSource === 'global'
      ? 'Modèle Global'
      : 'Non disponible';

  // 2. Surcharge vent réel par la Balise Winds-Up Spot 66 si disponible pour ce jour & créneau
  if (windsUpData && windsUpData.date === dateStr && !windsUpData.sensorOffline) {
    const matchingRows = windsUpData.rows.filter(row => {
      if (row.locked || row.moy == null) return false;
      const rMin = parseHHMMToMinutes(row.time);
      if (rMin == null) return false;
      return rMin >= startMin - 10 && rMin <= endMin + 10;
    });

    if (matchingRows.length > 0) {
      const avgMoy = Math.round(
        matchingRows.reduce((acc, r) => acc + (r.moy || 0), 0) / matchingRows.length
      );
      const maxGustCandidates = matchingRows
        .map(r => r.max ?? r.moy ?? 0)
        .filter(v => v > 0);
      const maxGust =
        maxGustCandidates.length > 0 ? Math.max(...maxGustCandidates) : avgMoy;

      // Direction dominante ou médiane du créneau
      const dirCounts = new Map<string, number>();
      for (const r of matchingRows) {
        const nd = normalizeFrenchWindDir(r.dir);
        if (nd) dirCounts.set(nd, (dirCounts.get(nd) || 0) + 1);
      }
      let bestDir = windDir;
      let bestCount = -1;
      for (const [dirKey, cnt] of dirCounts.entries()) {
        if (cnt > bestCount) {
          bestCount = cnt;
          bestDir = dirKey;
        }
      }

      windKts = avgMoy;
      gustKts = Math.round(maxGust);
      windDir = bestDir || windDir;
      windSource = 'windsup';
      windSourceLabel = windsUpData.isDelayed ? 'Balise Winds-Up (consolidé)' : 'Balise Winds-Up';
    }
  }

  return {
    windKts,
    gustKts,
    windDir,
    pressureHpa,
    waveH,
    wavePeriod,
    theoreticalWaterM,
    windSource,
    windSourceLabel,
  };
}
