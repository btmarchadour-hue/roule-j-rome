/**
 * Relais Cloudflare Worker pour la balise Winds-Up Douarnenez Pentrez (Spot 66).
 *
 * Variables secrètes à configurer dans Cloudflare Workers (Settings -> Variables and Secrets) :
 * - WINDSUP_USERNAME : identifiant du compte abonné Winds-Up
 * - WINDSUP_PASSWORD : mot de passe du compte abonné Winds-Up
 *
 * Déploiement rapide sans CLI :
 * 1. Workers & Pages -> Create -> Create Worker -> coller ce fichier -> Deploy
 * 2. Settings -> Variables and Secrets -> ajouter WINDSUP_USERNAME et WINDSUP_PASSWORD (type Secret)
 * 3. Copier l'URL *.workers.dev dans la variable GitHub Actions VITE_WINDSUP_PROXY_URL
 */

const WINDSUP_BASE = 'https://www.winds-up.com';
const SPOT_ID = 66;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let sessionCookie = '';
let sessionExpiresAt = 0;
const spotCache = new Map();

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function getParisToday() {
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

function decodeHtmlEntities(input) {
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

function extractSetCookies(headers) {
  const jar = {};
  let rawList = [];
  if (typeof headers.getSetCookie === 'function') {
    rawList = headers.getSetCookie();
  } else {
    const combined = headers.get('set-cookie');
    if (combined) {
      rawList = combined.split(/,(?=[^;,=\s]+=[^;,]+)/g);
    }
  }
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

function serializeJar(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function loginWindsUp(env) {
  const username = (env.WINDSUP_USERNAME || '').trim();
  const password = (env.WINDSUP_PASSWORD || '').trim();
  if (!username || !password) {
    return '';
  }

  const jar = {};

  try {
    const initRes = await fetch(`${WINDSUP_BASE}/connexion`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    Object.assign(jar, extractSetCookies(initRes.headers));
  } catch {
    // Proceed directly to login POST
  }

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

function parseIntOrNull(val) {
  if (!val) return null;
  const cleaned = val.replace(/<[^>]+>/g, '').trim();
  if (!cleaned || cleaned.includes('- -')) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function extractSeriesArray(html, seriesName) {
  const marker = `name:"${seriesName}"`;
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const dataIdx = html.indexOf('data:', idx);
  if (dataIdx === -1) return '';
  const bracketStart = html.indexOf('[', dataIdx);
  if (bracketStart === -1) return '';

  let depth = 0;
  let inString = null;
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
      if (depth === 0) return html.slice(bracketStart, i + 1);
    }
  }
  return '';
}

function parseWindsUpHtml(html, requestedDate, parisToday) {
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

  const obsLastMatch = html.match(
    /<div class="spotObsLast">([\s\S]*?)<\/div>\s*<span>|<div class="spotObsLast">([\s\S]*?)<div class="graph/
  );
  const obsLastBlock = obsLastMatch ? obsLastMatch[1] || obsLastMatch[2] || '' : '';

  const speedMatch = obsLastBlock.match(/<div class="speed">(\d+)\s*<span>/);
  const orientMatch = obsLastBlock.match(/<div class="orientation">([^<]*)<\/div>/);
  const minMatch = obsLastBlock.match(/<b>Min\s*:\s*<\/b>\s*(\d+)\s*nd/i);
  const maxMatch = obsLastBlock.match(/<b>Max\s*:\s*<\/b>\s*(\d+)\s*nd/i);
  const dateMatch = obsLastBlock.match(/<div class="date">([\s\S]*?)<\/div>/);
  const dateText = dateMatch
    ? decodeHtmlEntities(dateMatch[1].replace(/<[^>]+>/g, '').trim())
    : '';
  const timeMatch = dateText.match(/(\d{1,2}:\d{2})/);

  const moyRaw = extractSeriesArray(html, 'moy');
  const moy = [];
  if (moyRaw) {
    const itemRegex = /\{([^}]+)\}/g;
    let m;
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
  const minmax = [];
  if (minmaxRaw) {
    const itemRegex = /\{([^}]+)\}/g;
    let m;
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
  const previs = [];
  if (previsRaw) {
    const itemRegex = /\{([^}]+)\}/g;
    let m;
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

  const rows = [];
  const lineSplit = html.split(/<div[^>]*class="spotObsLine"[^>]*>/).slice(1);
  for (const chunk of lineSplit) {
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

async function fetchWindsUpSpot66(dateParam, forceRefresh, env) {
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
    env.WINDSUP_USERNAME?.trim() && env.WINDSUP_PASSWORD?.trim()
  );

  if (hasCredentials && (!sessionCookie || Date.now() >= sessionExpiresAt)) {
    await loginWindsUp(env);
  }

  const doFetch = async cookie => {
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

  if (
    hasCredentials &&
    (html.includes('class="spotTxtNonAbo"') || html.includes('décalés de 2 heures'))
  ) {
    sessionCookie = '';
    const refreshedCookie = await loginWindsUp(env);
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    const reqUrl = new URL(request.url);
    const allowedPaths = ['/', '/api/windsup/spot66', '/spot66'];
    if (!allowedPaths.includes(reqUrl.pathname)) {
      return jsonResponse({ error: 'Not Found' }, 404);
    }

    try {
      const dateParam = reqUrl.searchParams.get('date') || undefined;
      const forceRefresh = reqUrl.searchParams.get('refresh') === '1';
      const data = await fetchWindsUpSpot66(dateParam, forceRefresh, env);
      return jsonResponse(data, 200, {
        'Cache-Control': forceRefresh ? 'no-store' : 'public, max-age=60',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur relais Winds-Up';
      return jsonResponse({ error: message }, 502);
    }
  },
};
