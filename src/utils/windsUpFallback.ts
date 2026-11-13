import {
  WindsUpForecastPoint,
  WindsUpMinMaxPoint,
  WindsUpObsRow,
  WindsUpSeriesPoint,
  WindsUpSpotData,
} from '../types';

function decodeHtml(input: string): string {
  return input
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&nbsp;/g, ' ')
    .replace(/&deg;/g, '°')
    .replace(/&amp;/g, '&');
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
      if (depth === 0) return html.slice(bracketStart, i + 1);
    }
  }
  return '';
}

export async function fetchPublicWindsUpSpot66Fallback(dateStr: string): Promise<WindsUpSpotData> {
  const parisToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const isToday = dateStr === parisToday;
  const url = isToday
    ? 'https://www.winds-up.com/spot/66'
    : `https://www.winds-up.com/spot/66/?date=${encodeURIComponent(dateStr)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const html = await res.text();

  const isDelayed =
    html.includes('class="spotTxtNonAbo"') || html.includes('décalés de 2 heures');
  const isSubscriber = !isDelayed;

  const spotNameMatch = html.match(/<h2[^>]*class="spot"[^>]*>([\s\S]*?)<\/h2>/);
  const spotName = spotNameMatch
    ? decodeHtml(spotNameMatch[1].replace(/<[^>]+>/g, '').trim())
    : 'Douarnenez Pentrez';

  const obsLastMatch = html.match(/<div class="spotObsLast">([\s\S]*?)<\/div>\s*<span>|<div class="spotObsLast">([\s\S]*?)<div class="graph/);
  const obsLastBlock = obsLastMatch ? obsLastMatch[1] || obsLastMatch[2] || '' : '';
  const speedMatch = obsLastBlock.match(/<div class="speed">(\d+)\s*<span>/);
  const orientMatch = obsLastBlock.match(/<div class="orientation">([^<]*)<\/div>/);
  const minMatch = obsLastBlock.match(/<b>Min\s*:\s*<\/b>\s*(\d+)\s*nd/i);
  const maxMatch = obsLastBlock.match(/<b>Max\s*:\s*<\/b>\s*(\d+)\s*nd/i);
  const dateMatch = obsLastBlock.match(/<div class="date">([\s\S]*?)<\/div>/);
  const dateText = dateMatch ? decodeHtml(dateMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
  const timeMatch = dateText.match(/(\d{1,2}:\d{2})/);

  const moy: WindsUpSeriesPoint[] = [];
  const moyRaw = extractSeriesArray(html, 'moy');
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

  const minmax: WindsUpMinMaxPoint[] = [];
  const minmaxRaw = extractSeriesArray(html, 'minmax');
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

  const previs: WindsUpForecastPoint[] = [];
  const previsRaw = extractSeriesArray(html, 'previs');
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

  const rows: WindsUpObsRow[] = [];
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
    rows.push({
      time: timeM[1].trim(),
      min: parseIntOrNull(minM ? minM[1] : undefined),
      moy: moyVal,
      max: parseIntOrNull(maxRaw),
      dir: dirM ? dirM[1].replace(/- -/g, '').trim() : '',
      deg: parseIntOrNull(degM ? degM[1] : undefined),
      color: moyM && !locked ? moyM[1].trim() : null,
      barPct: barM ? Number(barM[1]) : 0,
      locked,
    });
  }

  const firstUnlockedRow = rows.find(r => !r.locked);
  const lastUnlockedMoy = [...moy].reverse().find(p => !p.locked);

  return {
    spotId: 66,
    spotName,
    date: dateStr,
    isToday,
    fetchedAt: new Date().toISOString(),
    isSubscriber,
    isDelayed,
    sensorOffline: html.includes('Capteur en panne') || html.includes('balise hors service'),
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
    sourceUrl: url,
  };
}
