import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load local .env file if present (never hardcode secrets in source code)
try {
  if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }
} catch {
  // Ignore if .env cannot be loaded; environment variables may be injected directly
}

interface WindsUpObsRow {
  time: string;
  min: number | null;
  moy: number | null;
  max: number | null;
  dir: string;
  deg: number | null;
  color: string | null;
  barPct: number;
  locked: boolean;
}

interface WindsUpSeriesPoint {
  t: number;
  y: number;
  o: string;
  color: string;
  locked: boolean;
}

interface WindsUpMinMaxPoint {
  t: number;
  low: number;
  high: number;
}

interface WindsUpForecastPoint {
  t: number;
  y: number;
  o: string;
}

interface WindsUpSpotData {
  spotId: number;
  spotName: string;
  date: string;
  isToday: boolean;
  fetchedAt: string;
  isSubscriber: boolean;
  isDelayed: boolean;
  sensorOffline: boolean;
  latest: {
    speed: number | null;
    min: number | null;
    max: number | null;
    dir: string;
    deg: number | null;
    time: string;
    color: string | null;
  };
  series: {
    moy: WindsUpSeriesPoint[];
    minmax: WindsUpMinMaxPoint[];
    previs: WindsUpForecastPoint[];
  };
  rows: WindsUpObsRow[];
  sourceUrl: string;
}

const PORT = Number(process.env.PORT || 3000);
const WINDSUP_BASE = 'https://www.winds-up.com';
const SPOT_ID = 66;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server-side session & cache state
let sessionCookie = '';
let sessionExpiresAt = 0;

interface CacheEntry {
  data: WindsUpSpotData;
  expiresAt: number;
}
const spotCache = new Map<string, CacheEntry>();

function getParisToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')?.value || '2026';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const d = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&nbsp;/g, ' ')
    .replace(/&deg;/g, '°')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractSetCookies(headers: Headers): Record<string, string> {
  const jar: Record<string, string> = {};
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  const rawList = typeof anyHeaders.getSetCookie === 'function' ? anyHeaders.getSetCookie() : [];
  for (const raw of rawList) {
    const firstPart = raw.split(';')[0] || '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      if (val && val !== 'deleted') {
        jar[name] = val;
      }
    }
  }
  return jar;
}

function serializeJar(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function loginWindsUp(): Promise<string> {
  const username = (process.env.WINDSUP_USERNAME || '').trim();
  const password = (process.env.WINDSUP_PASSWORD || '').trim();
  if (!username || !password) {
    return '';
  }

  const jar: Record<string, string> = {};

  // Step 1: prime session on /connexion
  try {
    const initRes = await fetch(`${WINDSUP_BASE}/connexion`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    Object.assign(jar, extractSetCookies(initRes.headers));
  } catch {
    // Proceed directly to POST login
  }

  // Step 2: submit form to /v2/
  const body = new URLSearchParams({
    action: 'log',
    pseudo: username,
    password,
  });

  const loginRes = await fetch(`${WINDSUP_BASE}/v2/`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Referer: `${WINDSUP_BASE}/connexion`,
      ...(Object.keys(jar).length ? { Cookie: serializeJar(jar) } : {}),
    },
  });

  Object.assign(jar, extractSetCookies(loginRes.headers));
  const cookieHeader = serializeJar(jar);
  if (cookieHeader && (jar.codeCnx || jar.autolog || jar.PHPSESSID)) {
    sessionCookie = cookieHeader;
    sessionExpiresAt = Date.now() + 25 * 60 * 1000;
  }
  return sessionCookie;
}

function parseIntOrNull(val: string | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace(/<[^>]+>/g, '').trim();
  if (!cleaned || cleaned.includes('- -')) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function extractSeriesArray(html: string, seriesName: string): string {
  const marker = `name:"${seriesName}"`;
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const dataIdx = html.indexOf('data:', idx);
  if (dataIdx === -1) return '';
  const bracketStart = html.indexOf('[', dataIdx);
  if (bracketStart === -1) return '';

  let depth = 0;
  let inString: string | null = null;
  let escape = false;
  for (let i = bracketStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return html.slice(bracketStart, i + 1);
      }
    }
  }
  return '';
}

function parseWindsUpHtml(html: string, requestedDate: string, parisToday: string): WindsUpSpotData {
  const isDelayed =
    html.includes('class="spotTxtNonAbo"') || html.includes('décalés de 2 heures');
  const isSubscriber = !isDelayed;
  const sensorOffline =
    html.includes('Capteur en panne') ||
    html.includes('balise hors service') ||
    html.includes('Pas de relevé récent');

  const spotNameMatch = html.match(/<h2[^>]*class="spot"[^>]*>([\s\S]*?)<\/h2>/);
  const spotName = spotNameMatch
    ? decodeHtmlEntities(spotNameMatch[1].replace(/<[^>]+>/g, '').trim())
    : 'Douarnenez Pentrez';

  // Parse .spotObsLast header block
  const obsLastMatch = html.match(/<div class="spotObsLast">([\s\S]*?)<\/div>\s*<span>|<div class="spotObsLast">([\s\S]*?)<div class="graph/);
  const obsLastBlock = obsLastMatch ? (obsLastMatch[1] || obsLastMatch[2] || '') : '';

  const speedMatch = obsLastBlock.match(/<div class="speed">(\d+)\s*<span>/);
  const orientMatch = obsLastBlock.match(/<div class="orientation">([^<]*)<\/div>/);
  const minMatch = obsLastBlock.match(/<b>Min\s*:\s*<\/b>\s*(\d+)\s*nd/i);
  const maxMatch = obsLastBlock.match(/<b>Max\s*:\s*<\/b>\s*(\d+)\s*nd/i);
  const dateMatch = obsLastBlock.match(/<div class="date">([\s\S]*?)<\/div>/);
  const dateText = dateMatch
    ? decodeHtmlEntities(dateMatch[1].replace(/<[^>]+>/g, '').trim())
    : '';
  const timeMatch = dateText.match(/(\d{1,2}:\d{2})/);

  // Parse Highcharts series
  const moyRaw = extractSeriesArray(html, 'moy');
  const moy: WindsUpSeriesPoint[] = [];
  if (moyRaw) {
    const itemRegex = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(moyRaw)) !== null) {
      const obj = m[1];
      const xM = obj.match(/x:(\d+)/);
      const yM = obj.match(/y:(\d+(?:\.\d+)?)/);
      const oM = obj.match(/o:"([^"]*)"/);
      const cM = obj.match(/color:"([^"]*)"/);
      const aboM = obj.match(/abo:1/);
      if (xM && yM) {
        moy.push({
          t: Number(xM[1]),
          y: Number(yM[1]),
          o: oM ? oM[1] : '',
          color: cM ? cM[1] : '#129AED',
          locked: Boolean(aboM),
        });
      }
    }
  }

  const minmaxRaw = extractSeriesArray(html, 'minmax');
  const minmax: WindsUpMinMaxPoint[] = [];
  if (minmaxRaw) {
    const itemRegex = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(minmaxRaw)) !== null) {
      const obj = m[1];
      const xM = obj.match(/x:(\d+)/);
      const lowM = obj.match(/low:(\d+(?:\.\d+)?)/);
      const highM = obj.match(/high:(\d+(?:\.\d+)?)/);
      if (xM && lowM && highM) {
        minmax.push({
          t: Number(xM[1]),
          low: Number(lowM[1]),
          high: Number(highM[1]),
        });
      }
    }
  }

  const previsRaw = extractSeriesArray(html, 'previs');
  const previs: WindsUpForecastPoint[] = [];
  if (previsRaw) {
    const itemRegex = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(previsRaw)) !== null) {
      const obj = m[1];
      const xM = obj.match(/x:(\d+)/);
      const yM = obj.match(/y:(\d+(?:\.\d+)?)/);
      const oM = obj.match(/o:"([^"]*)"/);
      if (xM && yM) {
        previs.push({
          t: Number(xM[1]),
          y: Number(yM[1]),
          o: oM ? oM[1] : '',
        });
      }
    }
  }

  // Parse .spotObsLine table rows
  const rows: WindsUpObsRow[] = [];
  const lineSplit = html.split(/<div[^>]*class="spotObsLine"[^>]*>/).slice(1);
  for (const chunk of lineSplit) {
    // Skip non-subscriber prompt row
    if (chunk.includes('spotTxtNonAbo')) continue;
    const rowEnd = chunk.indexOf('<script') !== -1 ? chunk.indexOf('<script') : chunk.length;
    const rowHtml = chunk.slice(0, Math.min(rowEnd, 1400));

    const timeM = rowHtml.match(/<div style="width:14%;">(\d{1,2}:\d{2})<\/div>/);
    if (!timeM) continue;

    const minM = rowHtml.match(/<div style="width:9%; color:#888;">([^<]*)<\/div>/);
    const moyM = rowHtml.match(/<div class="wind" style="background:([^"]+)">([^<]*)<\/div>/);
    const allColor888 = [...rowHtml.matchAll(/<div style="width:9%; color:#888;">([^<]*)<\/div>/g)];
    const maxRaw = allColor888.length > 1 ? allColor888[1][1] : undefined;
    const dirM = rowHtml.match(/<div style="width:8%;\s*">([^<]*)<\/div>/);
    const degM = rowHtml.match(/<div style="width:9%;" class="deg">([^<]*)<\/div>/);
    const barM = rowHtml.match(/<div class="bar"[^>]*width:(\d+)%/);

    const moyVal = moyM ? parseIntOrNull(moyM[2]) : null;
    const locked = moyVal === null;
    const color = moyM && !locked ? moyM[1].trim() : null;

    rows.push({
      time: timeM[1].trim(),
      min: parseIntOrNull(minM ? minM[1] : undefined),
      moy: moyVal,
      max: parseIntOrNull(maxRaw),
      dir: dirM ? dirM[1].replace(/- -/g, '').trim() : '',
      deg: parseIntOrNull(degM ? degM[1] : undefined),
      color,
      barPct: barM ? Number(barM[1]) : 0,
      locked,
    });
  }

  const firstUnlockedRow = rows.find(r => !r.locked);
  const lastUnlockedMoy = [...moy].reverse().find(p => !p.locked);

  return {
    spotId: SPOT_ID,
    spotName,
    date: requestedDate,
    isToday: requestedDate === parisToday,
    fetchedAt: new Date().toISOString(),
    isSubscriber,
    isDelayed,
    sensorOffline,
    latest: {
      speed: speedMatch ? Number(speedMatch[1]) : firstUnlockedRow?.moy ?? lastUnlockedMoy?.y ?? null,
      min: minMatch ? Number(minMatch[1]) : firstUnlockedRow?.min ?? null,
      max: maxMatch ? Number(maxMatch[1]) : firstUnlockedRow?.max ?? null,
      dir: orientMatch ? orientMatch[1].trim() : firstUnlockedRow?.dir ?? lastUnlockedMoy?.o ?? '',
      deg: firstUnlockedRow?.deg ?? null,
      time: timeMatch ? timeMatch[1] : firstUnlockedRow?.time ?? '',
      color: firstUnlockedRow?.color ?? lastUnlockedMoy?.color ?? null,
    },
    series: { moy, minmax, previs },
    rows,
    sourceUrl:
      requestedDate === parisToday
        ? `${WINDSUP_BASE}/spot/${SPOT_ID}`
        : `${WINDSUP_BASE}/spot/${SPOT_ID}/?date=${requestedDate}`,
  };
}

async function fetchWindsUpSpot66(dateParam: string | undefined, forceRefresh: boolean): Promise<WindsUpSpotData> {
  const parisToday = getParisToday();
  const targetDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : parisToday;
  const isToday = targetDate === parisToday;

  const cached = spotCache.get(targetDate);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = isToday
    ? `${WINDSUP_BASE}/spot/${SPOT_ID}`
    : `${WINDSUP_BASE}/spot/${SPOT_ID}/?date=${targetDate}`;

  const hasCredentials = Boolean(
    process.env.WINDSUP_USERNAME?.trim() && process.env.WINDSUP_PASSWORD?.trim()
  );

  if (hasCredentials && (!sessionCookie || Date.now() >= sessionExpiresAt)) {
    await loginWindsUp();
  }

  const doFetch = async (cookie: string): Promise<string> => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Winds-Up HTTP ${res.status}`);
    }
    return await res.text();
  };

  let html = await doFetch(sessionCookie);

  // If session expired and credentials exist, re-authenticate once
  if (
    hasCredentials &&
    (html.includes('class="spotTxtNonAbo"') || html.includes('décalés de 2 heures'))
  ) {
    sessionCookie = '';
    const refreshedCookie = await loginWindsUp();
    if (refreshedCookie) {
      html = await doFetch(refreshedCookie);
    }
  }

  const parsed = parseWindsUpHtml(html, targetDate, parisToday);
  const ttlMs = isToday ? 120_000 : 600_000;
  spotCache.set(targetDate, {
    data: parsed,
    expiresAt: Date.now() + ttlMs,
  });

  return parsed;
}

function getParisDateFromTs(ts: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts));
  const y = parts.find(p => p.type === 'year')?.value || '2026';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const d = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function parisDateTimeToMs(dateStr: string, hhmm: string): number | null {
  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (!Number.isFinite(year) || !Number.isFinite(hour)) return null;

  // Approximate in UTC then adjust by exact Europe/Paris wall-clock delta
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(approxUtc));

  const pY = Number(parts.find(p => p.type === 'year')?.value);
  const pM = Number(parts.find(p => p.type === 'month')?.value);
  const pD = Number(parts.find(p => p.type === 'day')?.value);
  const pH = Number(parts.find(p => p.type === 'hour')?.value) % 24;
  const pMin = Number(parts.find(p => p.type === 'minute')?.value);
  const parisAsUtc = Date.UTC(pY, pM - 1, pD, pH, pMin, 0);
  const offsetMs = parisAsUtc - approxUtc;
  return approxUtc - offsetMs;
}

async function fetchJsonWithTimeout<T>(url: string, headers: Record<string, string>, timeoutMs = 3500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface MetarObsRaw {
  icaoId?: string;
  obsTime?: number;
  reportTime?: string;
  altim?: number;
  slp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
}

interface RealMetarResult {
  station: string;
  pressureHpa?: number;
  windKts?: number;
  gustKts?: number;
  windDirDeg?: number;
  obsTimeIso: string;
  deltaMin: number;
}

const metarCache: { data: MetarObsRaw[]; expiresAt: number } = { data: [], expiresAt: 0 };

async function fetchMetarNearest(ts: number): Promise<RealMetarResult | null> {
  // NOAA AviationWeather METAR returns up to last 48h; for older timestamps skip network wait
  if (Date.now() - ts > 50 * 3600 * 1000) return null;

  let list = metarCache.data;
  if (Date.now() >= metarCache.expiresAt || list.length === 0) {
    const raw = await fetchJsonWithTimeout<MetarObsRaw[]>(
      'https://aviationweather.gov/api/data/metar?ids=LFRL,LFRQ,LFRB&format=json&hours=48',
      { 'User-Agent': 'CharVoilePentrezApp/1.0' },
      3500
    );
    if (Array.isArray(raw)) {
      list = raw;
      metarCache.data = raw;
      metarCache.expiresAt = Date.now() + 10 * 60 * 1000;
    }
  }

  const stationPriority: Record<string, number> = { LFRL: 0, LFRQ: 1, LFRB: 2 };
  const maxDeltaMs = 3 * 3600 * 1000;

  let best: { item: MetarObsRaw; obsMs: number; deltaMs: number; prio: number } | null = null;
  for (const item of list) {
    const icao = (item.icaoId || '').toUpperCase();
    if (!(icao in stationPriority)) continue;
    const obsMs =
      typeof item.obsTime === 'number'
        ? item.obsTime * 1000
        : item.reportTime
        ? Date.parse(item.reportTime)
        : NaN;
    if (!Number.isFinite(obsMs)) continue;
    const deltaMs = Math.abs(obsMs - ts);
    if (deltaMs > maxDeltaMs) continue;

    const prio = stationPriority[icao];
    // Prefer closest within 45 min, breaking ties by LFRL > LFRQ > LFRB
    const score = deltaMs + prio * 12 * 60 * 1000;
    const bestScore = best ? best.deltaMs + best.prio * 12 * 60 * 1000 : Infinity;
    if (score < bestScore) {
      best = { item, obsMs, deltaMs, prio };
    }
  }

  if (!best) return null;
  const rawAltim = typeof best.item.altim === 'number' ? best.item.altim : best.item.slp;
  let pressureHpa: number | undefined;
  if (typeof rawAltim === 'number' && Number.isFinite(rawAltim) && rawAltim > 0) {
    pressureHpa = rawAltim < 100 ? Math.round(rawAltim * 33.8639) : Math.round(rawAltim);
  }

  const wdirNum = typeof best.item.wdir === 'number' ? best.item.wdir : undefined;

  return {
    station: (best.item.icaoId || 'LFRL').toUpperCase(),
    pressureHpa,
    windKts: typeof best.item.wspd === 'number' ? Math.round(best.item.wspd) : undefined,
    gustKts: typeof best.item.wgst === 'number' ? Math.round(best.item.wgst) : undefined,
    windDirDeg: wdirNum,
    obsTimeIso: new Date(best.obsMs).toISOString(),
    deltaMin: Math.round((best.obsMs - ts) / 60000),
  };
}

interface RealShomResult {
  station: string;
  waterHeightM: number;
  obsTimeIso: string;
  deltaMin: number;
}

const shomCache = new Map<string, { points: Array<{ ms: number; h: number }>; expiresAt: number }>();

async function fetchShomBrestNearest(ts: number): Promise<RealShomResult | null> {
  // SHOM REFMAR JSON API for Brest (shom_id = 3)
  const bucketKey = String(Math.floor(ts / (30 * 60 * 1000)));
  let points = shomCache.get(bucketKey)?.expiresAt! > Date.now()
    ? shomCache.get(bucketKey)!.points
    : null;

  if (!points) {
    const dtStart = new Date(ts - 90 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    const dtEnd = new Date(ts + 90 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    const url = `https://services.data.shom.fr/maregraphie/observation/json/3?sources=1&dtStart=${encodeURIComponent(
      dtStart
    )}&dtEnd=${encodeURIComponent(dtEnd)}`;

    const raw = await fetchJsonWithTimeout<unknown>(
      url,
      { 'User-Agent': 'CharVoilePentrezApp/1.0' },
      3500
    );

    const parsedPoints: Array<{ ms: number; h: number }> = [];
    const arr = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown[] }).data)
      ? (raw as { data: unknown[] }).data
      : [];

    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const tRaw = obj.timestamp ?? obj.date ?? obj.t;
      const vRaw = obj.value ?? obj.height ?? obj.h;
      const ms = typeof tRaw === 'number'
        ? (tRaw < 1e12 ? tRaw * 1000 : tRaw)
        : typeof tRaw === 'string'
        ? Date.parse(tRaw)
        : NaN;
      const h = typeof vRaw === 'number' ? vRaw : typeof vRaw === 'string' ? Number(vRaw) : NaN;
      if (Number.isFinite(ms) && Number.isFinite(h)) {
        parsedPoints.push({ ms, h });
      }
    }

    parsedPoints.sort((a, b) => a.ms - b.ms);
    points = parsedPoints;
    shomCache.set(bucketKey, { points, expiresAt: Date.now() + 15 * 60 * 1000 });
  }

  if (!points || points.length === 0) return null;

  let closest = points[0];
  let bestDiff = Math.abs(closest.ms - ts);
  for (const p of points) {
    const diff = Math.abs(p.ms - ts);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = p;
    }
  }

  if (bestDiff > 35 * 60 * 1000) return null;

  return {
    station: 'Brest (SHOM REFMAR)',
    waterHeightM: Number(closest.h.toFixed(2)),
    obsTimeIso: new Date(closest.ms).toISOString(),
    deltaMin: Math.round((closest.ms - ts) / 60000),
  };
}

interface RealCandhisResult {
  buoy: string;
  waveHeightM?: number;
  wavePeriodS?: number;
  waveDirDeg?: number;
  obsTimeIso: string;
  deltaMin: number;
}

const candhisCache: { rows: Array<Record<string, unknown>>; expiresAt: number } = {
  rows: [],
  expiresAt: 0,
};

async function fetchCandhisNearest(ts: number): Promise<RealCandhisResult | null> {
  const token = (process.env.CANDHIS_API_TOKEN || '').trim();
  if (!token) return null;

  let rows = candhisCache.rows;
  if (Date.now() >= candhisCache.expiresAt || rows.length === 0) {
    const raw = await fetchJsonWithTimeout<unknown>(
      'https://candhis.cerema.fr/API/v1/getCampTR.php?camp=02911',
      {
        Authorization: token,
        'User-Agent': 'CharVoilePentrezApp/1.0',
      },
      3500
    );
    const extracted = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown[] }).data)
      ? (raw as { data: unknown[] }).data
      : [];
    rows = extracted.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
    candhisCache.rows = rows;
    candhisCache.expiresAt = Date.now() + 15 * 60 * 1000;
  }

  let best: { row: Record<string, unknown>; ms: number; diff: number } | null = null;
  for (const r of rows) {
    const tStr = String(r.DateHeure ?? r.date ?? r.timestamp ?? '');
    const ms = Date.parse(tStr);
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - ts);
    if (diff <= 90 * 60 * 1000 && (!best || diff < best.diff)) {
      best = { row: r, ms, diff };
    }
  }

  if (!best) return null;
  const hm0 = Number(best.row.Hm0 ?? best.row.hm0 ?? best.row.Hs ?? best.row.hs);
  const tp = Number(best.row.Tp ?? best.row.tp);
  const dir = Number(best.row.Dir ?? best.row.dir ?? best.row.Dpic);

  return {
    buoy: '02911 (Pierres Noires)',
    waveHeightM: Number.isFinite(hm0) ? Number(hm0.toFixed(2)) : undefined,
    wavePeriodS: Number.isFinite(tp) ? Math.round(tp) : undefined,
    waveDirDeg: Number.isFinite(dir) ? Math.round(dir) : undefined,
    obsTimeIso: new Date(best.ms).toISOString(),
    deltaMin: Math.round((best.ms - ts) / 60000),
  };
}

async function startServer(): Promise<void> {
  const app = express();

  // Never expose dotfiles like .env
  app.use((req: Request, res: Response, next) => {
    if (req.path.startsWith('/.env') || req.path === '/.gitignore') {
      res.status(404).end();
      return;
    }
    next();
  });

  app.get('/api/windsup/spot66', async (req: Request, res: Response) => {
    try {
      const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
      const forceRefresh = req.query.refresh === '1';
      const data = await fetchWindsUpSpot66(dateParam, forceRefresh);
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur serveur Winds-Up';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/real-conditions', async (req: Request, res: Response) => {
    const rawTs = Number(req.query.ts);
    const requestedTs = Number.isFinite(rawTs) && rawTs > 1_500_000_000_000 ? rawTs : Date.now();
    const requestedDate = getParisDateFromTs(requestedTs);
    const forceRefresh = req.query.refresh === '1';

    const [wuRes, metarRes, shomRes, candhisRes] = await Promise.allSettled([
      fetchWindsUpSpot66(requestedDate, forceRefresh),
      fetchMetarNearest(requestedTs),
      fetchShomBrestNearest(requestedTs),
      fetchCandhisNearest(requestedTs),
    ]);

    let windsUp: {
      status: 'ok' | 'delayed_locked' | 'offline' | 'unavailable';
      windKts?: number;
      minKts?: number;
      maxKts?: number;
      dir?: string;
      deg?: number;
      time?: string;
      deltaMin?: number;
    } = { status: 'unavailable' };

    if (wuRes.status === 'fulfilled') {
      const wu = wuRes.value;
      if (wu.sensorOffline) {
        windsUp = { status: 'offline' };
      } else {
        let bestRow: { row: WindsUpObsRow; diffMs: number; rowMs: number } | null = null;
        let hasLockedNearTs = false;
        for (const r of wu.rows) {
          const rMs = parisDateTimeToMs(requestedDate, r.time);
          if (rMs == null) continue;
          const diffMs = Math.abs(rMs - requestedTs);
          if (diffMs <= 25 * 60 * 1000) {
            if (r.locked || r.moy == null) {
              hasLockedNearTs = true;
            } else if (!bestRow || diffMs < bestRow.diffMs) {
              bestRow = { row: r, diffMs, rowMs: rMs };
            }
          }
        }

        if (bestRow) {
          windsUp = {
            status: 'ok',
            windKts: bestRow.row.moy ?? undefined,
            minKts: bestRow.row.min ?? undefined,
            maxKts: bestRow.row.max ?? undefined,
            dir: bestRow.row.dir || undefined,
            deg: bestRow.row.deg ?? undefined,
            time: bestRow.row.time,
            deltaMin: Math.round((bestRow.rowMs - requestedTs) / 60000),
          };
        } else if (hasLockedNearTs || (wu.isDelayed && Date.now() - requestedTs < 2.5 * 3600 * 1000)) {
          windsUp = { status: 'delayed_locked' };
        }
      }
    }

    res.json({
      requestedTs,
      requestedDate,
      windsUp,
      metar: metarRes.status === 'fulfilled' ? metarRes.value : null,
      shomBrest: shomRes.status === 'fulfilled' ? shomRes.value : null,
      candhis: candhisRes.status === 'fulfilled' ? candhisRes.value : null,
      fetchedAt: new Date().toISOString(),
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
