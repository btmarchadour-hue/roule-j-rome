import { DATA } from '../data/tideData';
import {
  AppSettings,
  CustomSlotsMap,
  DayFocusData,
  DayPlan,
  DayRowData,
  SessionItem,
  TidePoint,
  ValidationsMap,
  WindPoint,
  WindStat,
} from '../types';

export const LAT = 48.1837;
export const LNG = -4.2944;
export const R = Math.PI / 180;

export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

export const JS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const COMP = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
export const comp = (a: number) => COMP[Math.round(a / 22.5) % 16];

export const PH = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
export const PN = [
  'Nouvelle lune', 'Premier croissant', 'Premier quartier', 'Gibbeuse croissante',
  'Pleine lune', 'Gibbeuse décroissante', 'Dernier quartier', 'Dernier croissant'
];

export const VC: Record<'g' | 'o' | 'r' | 'x', [string, string]> = {
  g: ['#1b8f4e', 'OUVRIR'],
  o: ['#e8731a', 'OUVRIR AVEC RÉSERVES'],
  r: ['#c8402f', 'NE PAS ROULER'],
  x: ['#667a85', 'JOURNÉE TERMINÉE'],
};

export const minDs = '2026-10-01';
export const maxDs = DATA[DATA.length - 1][0];

export const lastSun = (y: number, m: number) => {
  const e = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, e.getUTCDate() - e.getUTCDay(), 1) / 60000;
};

export const off = (u: number) => {
  const y = new Date(u * 60000).getUTCFullYear();
  return u >= lastSun(y, 2) && u < lastSun(y, 9) ? 120 : 60;
};

export const ds0 = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 60000;

export const toU = (y: number, m: number, d: number, mi: number) => {
  let u = ds0(y, m, d) + mi - 120;
  if (off(u) === 60) u += 60;
  return u;
};

export const p2 = (n: number | string) => String(n).padStart(2, '0');

export const hm = (m: number) => {
  m = Math.round(m);
  return p2(Math.floor(m / 60)) + 'h' + p2(m % 60);
};

export const lc = (u: number, y: number, m: number, d: number) => {
  return hm(u + off(u) - ds0(y, m, d));
};

export const COEF: Record<string, number> = {};
for (const [ds, c] of DATA) {
  COEF[ds] = c;
}

export function build(les: boolean, pcor: boolean, windList: WindPoint[]): TidePoint[] {
  const P: TidePoint[] = [];
  for (const [ds, , en] of DATA) {
    const [y, m, d] = ds.split('-').map(Number);
    for (const [pm, mi, h] of en) {
      const pointH = +(h + (les ? (pm ? 0.5 : 0.2) : 0)).toFixed(2);
      P.push({
        t: toU(y, m - 1, d, mi) + (les ? (pm ? 12 : 13) : 0),
        h: pointH,
        hd: pointH,
        pm,
      });
    }
  }
  P.sort((a, b) => a.t - b.t);

  if (pcor && windList.length > 0) {
    for (const p of P) {
      const w = windAt(p.t, windList);
      if (w && w.p != null && w.p < 1013) {
        p.adj = (1013 - w.p) / 100;
        p.h = +(p.h + p.adj).toFixed(2);
      }
    }
  }
  return P;
}

export function win(EX: TidePoint[], L: number): [number, number][] {
  const iv: [number, number][] = [];
  for (let i = 0; i < EX.length - 1; i++) {
    const a = EX[i];
    const b = EX[i + 1];
    const la = a.h <= L;
    const lb = b.h <= L;
    if (la && lb) {
      iv.push([a.t, b.t]);
    } else if (la || lb) {
      const m = (a.h + b.h) / 2;
      const am = (a.h - b.h) / 2;
      const s = Math.acos(Math.max(-1, Math.min(1, (L - m) / am))) / Math.PI;
      const tc = a.t + s * (b.t - a.t);
      iv.push(la ? [a.t, tc] : [tc, b.t]);
    }
  }
  const r: [number, number][] = [];
  for (const x of iv) {
    const l = r[r.length - 1];
    if (l && x[0] - l[1] <= 1) {
      l[1] = x[1];
    } else {
      r.push([x[0], x[1]]);
    }
  }
  return r;
}

export function hAt(u: number, EX: TidePoint[]): number | null {
  const n = EX.length;
  if (n < 2 || u < EX[0].t || u > EX[n - 1].t) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const k = (lo + hi) >> 1;
    if (EX[k].t <= u) lo = k;
    else hi = k;
  }
  const a = EX[lo];
  const b = EX[hi];
  const f = (u - a.t) / (b.t - a.t);
  return (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * f);
}

export function sAlt(ms: number): number {
  const jd = ms / 864e5 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const sn = Math.sin;
  const cs = Math.cos;
  const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * sn(M * R) +
    (0.019993 - 0.000101 * T) * sn(2 * M * R) + 0.000289 * sn(3 * M * R);
  const om = 125.04 - 1934.136 * T;
  const lam = L0 + C - 0.00569 - 0.00478 * sn(om * R);
  const eps = 23.439291 - T * 0.013004 + 0.00256 * cs(om * R);
  const ra = Math.atan2(cs(eps * R) * sn(lam * R), cs(lam * R));
  const dec = Math.asin(sn(eps * R) * sn(lam * R));
  const H = R * (280.46061837 + 360.98564736629 * (jd - 2451545) + LNG) - ra;
  const p = R * LAT;
  return Math.asin(sn(p) * sn(dec) + cs(p) * cs(dec) * cs(H)) / R;
}

export function crossings(f: (t: number) => number, t0: number, t1: number): [number | null, number | null] {
  let rise: number | null = null;
  let set: number | null = null;
  let p = f(t0);
  let pt = t0;
  const st = 5 * 6e4;
  for (let t = t0 + st; t <= t1; t += st) {
    const g = f(t);
    if (rise == null && p < 0 && g >= 0) rise = pt + st * (-p) / (g - p);
    if (set == null && p >= 0 && g < 0) set = pt + st * p / (p - g);
    p = g;
    pt = t;
  }
  return [rise, set];
}

const LC = new Map<string, [number | null, number | null]>();

export function dayLight(y: number, m: number, d: number, lum: number, lmg: number): [number, number] | null {
  const thr = lum;
  const mg = (lmg || 0) * 6e4;
  const k = `${y}-${m}-${d}|${thr}`;
  let c = LC.get(k);
  if (!c) {
    c = crossings(t => sAlt(t) - thr, toU(y, m, d, 0) * 6e4, toU(y, m, d + 1, 0) * 6e4);
    LC.set(k, c);
  }
  return c[0] == null || c[1] == null ? null : [(c[0] + mg) / 6e4, (c[1] - mg) / 6e4];
}

export function sunInfo(y: number, m: number, d: number, lum: number, lmg: number) {
  const c = crossings(t => sAlt(t) + 1.1, toU(y, m, d, 0) * 6e4, toU(y, m, d + 1, 0) * 6e4);
  const l = dayLight(y, m, d, lum, lmg);
  const f = (x: number | null) => (x == null ? '—' : lc(x / 6e4, y, m, d));
  return {
    lev: f(c[0]),
    cou: f(c[1]),
    lum: l ? lc(l[0], y, m, d) + ' – ' + lc(l[1], y, m, d) : '—',
  };
}

export const T1: [number, number, number, number, number][] = [
  [6288774, 0, 0, 1, 0], [1274027, 2, 0, -1, 0], [658314, 2, 0, 0, 0],
  [213618, 0, 0, 2, 0], [-185116, 0, 1, 0, 0], [-114332, 0, 0, 0, 2],
  [58793, 2, 0, -2, 0], [57066, 2, -1, -1, 0], [53322, 2, 0, 1, 0],
  [45758, 2, -1, 0, 0], [-40923, 0, -1, 1, 0], [-34720, 1, 0, 0, 0],
  [-30383, 0, 1, 1, 0], [15327, 2, 0, 0, -2], [-12528, 0, 0, 1, 2],
  [10980, 0, 0, 1, -2], [10675, 4, 0, -1, 0], [10034, 0, 0, 3, 0],
  [8548, 4, 0, -2, 0], [-7888, 2, 1, -1, 0], [-6766, 2, 1, 0, 0],
  [-5163, 1, 0, -1, 0], [4987, 1, 1, 0, 0], [4036, 2, -1, 1, 0],
  [3994, 2, 0, 2, 0], [3861, 4, 0, 0, 0], [3665, 2, 0, -3, 0]
];

export const T2: [number, number, number, number, number][] = [
  [5128122, 0, 0, 0, 1], [280602, 0, 0, 1, 1], [277693, 0, 0, 1, -1],
  [173237, 2, 0, 0, -1], [55413, 2, 0, -1, 1], [46271, 2, 0, -1, -1],
  [32573, 2, 0, 0, 1], [17198, 0, 0, 2, 1], [9266, 2, 0, 1, -1],
  [8822, 0, 0, 2, -1], [8216, 2, -1, 0, -1], [4324, 2, 0, -2, -1],
  [4200, 2, 0, 1, 1]
];

export function mCo(jd: number) {
  const T = (jd - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;
  const cs = Math.cos;
  const sn = Math.sin;
  const S = (L: [number, number, number, number, number][]) => {
    let x = 0;
    for (const [c, d, m, mp, f] of L) {
      x += c * Math.pow(E, Math.abs(m)) * sn(R * (d * D + m * M + mp * Mp + f * F));
    }
    return x;
  };
  const lam = R * (Lp + S(T1) / 1e6);
  const bt = R * (S(T2) / 1e6);
  const e = R * (23.4392911 - 0.0130042 * T);
  const dist = 385000.56 - 20905.355 * cs(R * Mp) - 3699.111 * cs(R * (2 * D - Mp)) -
    2955.968 * cs(R * 2 * D) - 569.925 * cs(R * 2 * Mp) + 246.158 * cs(R * (2 * D - 2 * Mp)) -
    204.586 * E * cs(R * (2 * D - M)) - 170.733 * cs(R * (2 * D + Mp)) -
    152.138 * E * cs(R * (2 * D - M - Mp)) - 129.62 * E * cs(R * (M - Mp)) +
    108.743 * cs(R * D) + 104.755 * E * cs(R * (M + Mp));
  return {
    ra: Math.atan2(sn(lam) * cs(e) - Math.tan(bt) * sn(e), cs(lam)),
    dec: Math.asin(sn(bt) * cs(e) + cs(bt) * sn(e) * sn(lam)),
    dist,
  };
}

export function mG(ms: number) {
  const jd = ms / 864e5 + 2440587.5;
  const c = mCo(jd);
  const H = R * (280.46061837 + 360.98564736629 * (jd - 2451545) + LNG) - c.ra;
  const p = R * LAT;
  const h = Math.asin(Math.sin(p) * Math.sin(c.dec) + Math.cos(p) * Math.cos(c.dec) * Math.cos(H)) / R;
  const par = Math.asin(6378.14 / c.dist) / R;
  return h - (0.7275 * par - 0.5667);
}

export function moonTimes(y: number, m: number, d: number) {
  const c = crossings(mG, toU(y, m, d, 0) * 6e4, toU(y, m, d + 1, 0) * 6e4);
  const f = (x: number | null) => (x == null ? '—' : lc(x / 6e4, y, m, d));
  return { rise: f(c[0]), set: f(c[1]) };
}

export const phase = (u: number) => {
  const a = ((((u * 60000 - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % 29.530588 + 29.530588) % 29.530588);
  const i = Math.round((a / 29.530588) * 8) % 8;
  return PH[i] + ' ' + PN[i];
};

export const allDay = (y: number, m: number, d: number, settings: AppSettings) => {
  if (!settings.all) return false;
  const c = COEF[`${y}-${p2(m + 1)}-${p2(d)}`];
  return c != null && c <= settings.cmax;
};

export function dayInfo(
  y: number,
  m: number,
  d: number,
  settings: AppSettings,
  W: [number, number][],
  first: number,
  last: number
): [number, number][] {
  const l = dayLight(y, m, d, settings.lum, settings.lmg);
  if (!l) return [];
  const h0 = settings.h0 * 60;
  const h1 = settings.h1 * 60;
  const a = Math.max(l[0], toU(y, m, d, h0), first);
  const b = Math.min(l[1], toU(y, m, d, h1), last);
  if (allDay(y, m, d, settings)) {
    return b - a >= 1 ? [[a, b]] : [];
  }
  return W.map(w => [Math.max(w[0], a), Math.min(w[1], b)] as [number, number])
    .filter(w => w[1] - w[0] >= 1);
}

export function inSummer(m: number, d: number, settings: AppSettings) {
  const md = `${p2(m + 1)}-${p2(d)}`;
  return md >= settings.s0.trim() && md <= settings.s1.trim();
}

export function plan(
  y: number,
  m: number,
  d: number,
  settings: AppSettings,
  W: [number, number][],
  first: number,
  last: number
): DayPlan {
  const P = dayInfo(y, m, d, settings, W, first, last);
  const l = dayLight(y, m, d, settings.lum, settings.lmg);
  const full: [number, number][] = [];
  const extra: [number, number, string, number, string][] = [];
  if (!P.length || !l) return { full, extra };

  const dur = settings.sdur;
  const rnd = settings.rnd || 15;
  const gap = inSummer(m, d, settings) ? settings.gs : settings.gw;
  const lo = l[0] + settings.pre;
  const hi = l[1] - settings.post;
  const xon = settings.xon;
  const tol = Math.max(0, settings.xtol || 0);
  const back = settings.xpl !== 'debut';

  if (!(dur > 0)) return { full, extra };

  const cg = (u: number) => toU(y, m, d, Math.ceil((u + off(u) - ds0(y, m, d)) / rnd - 1e-9) * rnd);
  const fg = (u: number) => toU(y, m, d, Math.floor((u + off(u) - ds0(y, m, d)) / rnd + 1e-9) * rnd);
  const ov = (s0: number, a: number, b: number) => Math.max(0, Math.min(s0 + dur, b) - Math.max(s0, a));
  const E = 0.01;

  for (const p of P) {
    const a = Math.max(p[0], lo);
    const b = Math.min(p[1], hi);
    const limEnd = (hi < p[1] - E || p[1] >= l[1] - 1) ? 'jour' : 'marée';
    const limStart = lo >= p[0] - E ? 'jour' : 'marée';
    const arr: [number, number][] = [];

    if (b - a >= dur - E) {
      if (back) {
        let sx = fg(b - dur);
        while (sx >= a - E) {
          arr.unshift([sx, sx + dur]);
          sx = fg(sx - gap - dur);
        }
      } else {
        let t = cg(a);
        while (t + dur <= b + E) {
          arr.push([t, t + dur]);
          t = cg(t + dur + gap);
        }
      }
    }

    for (const x of arr) full.push(x);

    if (!xon || !(tol > 0)) continue;

    const need = dur - tol;
    const add = (s0: number) => {
      const o = ov(s0, a, b);
      const over = Math.round(dur - o);
      if (over <= 0) return;
      const before = s0 < a - E;
      const after = s0 + dur > b + E;
      const lim = before && after ? (a - s0 >= s0 + dur - b ? limStart : limEnd) : before ? limStart : limEnd;
      extra.push([s0, s0 + dur, lim, over, before && after ? 'début et fin' : before ? 'début' : 'fin']);
    };

    if (arr.length) {
      const firstSess = arr[0][0];
      const lastSess = arr[arr.length - 1][1];
      const sB = fg(firstSess - gap - dur);
      if (sB >= l[0] - E && ov(sB, a, b) >= need - E && ov(sB, a, b) > 0) add(sB);
      const sA = cg(lastSess + gap);
      if (sA + dur <= l[1] + E && sA < b && ov(sA, a, b) >= need - E && sA + dur > b + E) add(sA);
    } else {
      let best: [number, number] | null = null;
      for (let s0 = cg(Math.max(l[0], a - tol)); s0 <= b; s0 = cg(s0 + 1)) {
        if (s0 + dur > l[1] + E) break;
        const o = ov(s0, a, b);
        if (o >= need - E && (!best || o >= best[1] - E)) best = [s0, o];
      }
      if (best) add(best[0]);
    }
  }

  return { full, extra };
}

export function windAt(u: number, windList: WindPoint[]): WindPoint | null {
  const n = windList.length;
  if (!n || u < windList[0].t || u > windList[n - 1].t) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const k = (lo + hi) >> 1;
    if (windList[k].t <= u) lo = k;
    else hi = k;
  }
  const a = windList[lo];
  const b = windList[hi];
  const f = b.t > a.t ? (u - a.t) / (b.t - a.t) : 0;
  return {
    t: u,
    pr: f < 0.5 ? a.pr : b.pr,
    wc: f < 0.5 ? a.wc : b.wc,
    tp: a.tp != null && b.tp != null ? a.tp + (b.tp - a.tp) * f : null,
    ap: a.ap != null && b.ap != null ? a.ap + (b.ap - a.ap) * f : null,
    v: a.v + (b.v - a.v) * f,
    g: a.g != null && b.g != null ? a.g + (b.g - a.g) * f : null,
    a: f < 0.5 ? a.a : b.a,
    s: a.s === 'A' && b.s === 'A' ? 'A' : 'G',
    p: a.p != null && b.p != null ? a.p + (b.p - a.p) * f : null,
    cc: f < 0.5 ? a.cc : b.cc,
    rh: a.rh != null && b.rh != null ? a.rh + (b.rh - a.rh) * f : null,
    pop: a.pop != null && b.pop != null ? a.pop + (b.pop - a.pop) * f : null,
  };
}

export function wslots(P: [number, number][], settings: AppSettings, windList: WindPoint[]): [number, number][] {
  const qa = settings.vmin;
  const qb = settings.vmax;
  const qg = settings.gmax;
  const out: [number, number][] = [];

  for (const [a, b] of P) {
    let s: number | null = null;
    let last = a;
    for (let u = a; ; u += 10) {
      const x = Math.min(u, b);
      const w = windAt(x, windList);
      const ok = w && w.v >= qa && w.v <= qb && (w.g == null || w.g <= qg);
      if (ok && s == null) s = x;
      if (!ok && s != null) {
        out.push([s, last]);
        s = null;
      }
      if (ok) last = x;
      if (x >= b) break;
    }
    if (s != null) out.push([s, last]);
  }
  return out.filter(x => x[1] - x[0] >= 20);
}

export function wstat(a: number, b: number, windList: WindPoint[]): WindStat | null {
  let lo = 1e9;
  let hi = 0;
  let g = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  let src: 'A' | 'G' = 'A';

  for (let u = a; u <= b; u += 15) {
    const w = windAt(u, windList);
    if (!w) continue;
    lo = Math.min(lo, w.v);
    hi = Math.max(hi, w.v);
    g = Math.max(g, w.g || 0);
    sx += Math.sin(w.a * R);
    sy += Math.cos(w.a * R);
    n++;
    if (w.s === 'G') src = 'G';
  }
  return n ? { lo, hi, g, src, dir: ((Math.atan2(sx, sy) / R + 360) % 360) } : null;
}

export const wtxt = (s: WindStat | null) =>
  s
    ? Math.round(s.lo) + '–' + Math.round(s.hi) + ' nds' +
      (s.g ? ', raf. ' + Math.round(s.g) : '') + ', ' +
      comp(s.dir) + (s.src === 'A' ? ' (AROME)' : ' (modèle global)')
    : '';

export function sw(a: number, b: number, settings: AppSettings, windList: WindPoint[]): boolean | null {
  const qa = settings.vmin;
  const qb = settings.vmax;
  const qg = settings.gmax;
  let any = false;
  let ok = true;
  for (let u = a; u <= b; u += 10) {
    const w = windAt(u, windList);
    if (!w) continue;
    any = true;
    if (!(w.v >= qa && w.v <= qb && (w.g == null || w.g <= qg))) {
      ok = false;
    }
  }
  return any ? ok : null;
}

export function dayWind(
  y: number,
  m: number,
  d: number,
  settings: AppSettings,
  W: [number, number][],
  first: number,
  last: number,
  windList: WindPoint[]
) {
  const P = dayInfo(y, m, d, settings, W, first, last);
  const ws = P.map(p => wstat(p[0], p[1], windList));
  const sl = wslots(P, settings, windList);
  return {
    P,
    ws,
    sl,
    lvl: !P.length ? 0 : !ws.some(Boolean) ? -1 : sl.length ? 2 : 1,
  };
}

export const tdy = (): string => {
  const n = Date.now() / 6e4;
  const u = n + off(n);
  const x = new Date(u * 6e4);
  return x.getUTCFullYear() + '-' + p2(x.getUTCMonth() + 1) + '-' + p2(x.getUTCDate());
};

export const shf = (ds: string, n: number): string => {
  const [y, m, d] = ds.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.getUTCFullYear() + '-' + p2(x.getUTCMonth() + 1) + '-' + p2(x.getUTCDate());
};

/**
 * Calculates the tide coefficient for any tide timestamp (PM or BM)
 * using smooth interpolation between adjacent daily coefficients (SHOM model).
 */
export function getTideCoef(tideTime: number, dateStr: string): number {
  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;
  const tMid = toU(y, m, d, 720);
  const cCurr = COEF[dateStr] ?? 50;

  const prevDate = shf(dateStr, -1);
  const nextDate = shf(dateStr, 1);
  const cPrev = COEF[prevDate] ?? cCurr;
  const cNext = COEF[nextDate] ?? cCurr;

  let raw = cCurr;
  if (tideTime < tMid) {
    const tPrevMid = tMid - 1440;
    const alpha = Math.max(0, Math.min(1, (tideTime - tPrevMid) / 1440));
    raw = cPrev + alpha * (cCurr - cPrev);
  } else {
    const beta = Math.max(0, Math.min(1, (tideTime - tMid) / 1440));
    raw = cCurr + beta * (cNext - cCurr);
  }

  return Math.max(20, Math.min(120, Math.round(raw)));
}

export const getPmCoef = getTideCoef;

/**
 * Returns next tide info (BM or PM), PMs and BMs with individual coefficients, and day tides list
 */
export function getNextTideInfo(EX: TidePoint[], dateStr?: string) {
  const targetDate = dateStr || tdy();
  const [y, m0, d] = targetDate.split('-').map(Number);
  const m = m0 - 1;
  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);

  const dayTides = EX.filter(p => p.t >= t0 && p.t < t1);
  const rawPmList = dayTides.filter(p => p.pm);
  const rawBmList = dayTides.filter(p => !p.pm);

  const pmList = rawPmList.map(p => ({
    ...p,
    coef: getTideCoef(p.t, targetDate),
  }));
  const bmList = rawBmList.map(p => ({
    ...p,
    coef: getTideCoef(p.t, targetDate),
  }));

  const pmCoefs = pmList.map(p => p.coef);
  const bmCoefs = bmList.map(p => p.coef);

  // If viewing today, find next upcoming tide
  const now = Date.now() / 60000;
  const isToday = targetDate === tdy();
  let nextTide: {
    type: 'PM' | 'BM';
    timeStr: string;
    height: number;
    diffMin: number;
    coef?: number;
  } | null = null;

  if (isToday) {
    const upcoming = EX.find(p => p.t >= now);
    if (upcoming) {
      const [uy, um, ud] = new Date(upcoming.t * 60000).toISOString().split('T')[0].split('-').map(Number);
      const upcomingDateStr = `${uy}-${p2(um)}-${p2(ud)}`;
      nextTide = {
        type: upcoming.pm ? 'PM' : 'BM',
        timeStr: lc(upcoming.t, uy, um - 1, ud),
        height: upcoming.hd != null ? upcoming.hd : upcoming.h,
        diffMin: Math.round(upcoming.t - now),
        coef: getTideCoef(upcoming.t, upcomingDateStr),
      };
    }
  }

  return {
    dayTides,
    pmList,
    bmList,
    nextTide,
    coef: COEF[targetDate],
    pmCoefs,
    bmCoefs,
  };
}

/**
 * Returns key tide for mini-display in calendar tile (e.g. key Basse Mer)
 */
export function getDayKeyTide(EX: TidePoint[], ds: string): { label: string; height?: number; coef?: number } | null {
  const [y, m0, d] = ds.split('-').map(Number);
  const m = m0 - 1;
  const t0 = toU(y, m, d, 0);
  const t1 = toU(y, m, d + 1, 0);

  const dayTides = EX.filter(p => p.t >= t0 && p.t < t1);
  if (!dayTides.length) return null;

  // Prefer daylight BM (basse mer) as it is primary for char à voile
  const l = dayLight(y, m, d, -1.1, 0);
  const bmTides = dayTides.filter(p => !p.pm);
  let bestBM = bmTides[0];
  if (l && bmTides.length > 1) {
    const inLight = bmTides.find(p => p.t >= l[0] - 60 && p.t <= l[1] + 60);
    if (inLight) bestBM = inLight;
  }

  if (bestBM) {
    return {
      label: `BM ${lc(bestBM.t, y, m, d)}`,
      height: bestBM.hd != null ? bestBM.hd : bestBM.h,
      coef: getTideCoef(bestBM.t, ds),
    };
  }

  // Fallback to first tide
  const first = dayTides[0];
  return {
    label: `${first.pm ? 'PM' : 'BM'} ${lc(first.t, y, m, d)}`,
    height: first.hd != null ? first.hd : first.h,
    coef: getTideCoef(first.t, ds),
  };
}

export function dayFocus(
  ds: string,
  settings: AppSettings,
  W: [number, number][],
  first: number,
  last: number,
  windList: WindPoint[],
  customSlotsMap?: CustomSlotsMap
): DayFocusData {
  const [y, m0, d] = ds.split('-').map(Number);
  const m = m0 - 1;
  const pl = plan(y, m, d, settings, W, first, last);
  const nw = Date.now() / 6e4;
  const isT = ds === tdy();

  const mk = (
    x: [number, number] | [number, number, string, number, string],
    opt: boolean,
    isCustom?: boolean,
    customTitle?: string
  ): SessionItem => {
    const ok = sw(x[0], x[1], settings, windList);
    const st = wstat(x[0], x[1], windList);
    return {
      a: x[0],
      b: x[1],
      opt,
      isCustom,
      customTitle,
      ok,
      st,
      txt: st ? wtxt(st) : '',
      over: opt ? (x as [number, number, string, number, string])[3] : 0,
      lim: opt ? (x as [number, number, string, number, string])[2] : '',
      side: opt ? (x as [number, number, string, number, string])[4] : '',
      past: isT && x[1] < nw,
    };
  };

  const customCfg = customSlotsMap?.[ds];
  let list: SessionItem[] = [];

  if (customCfg && customCfg.slots.length > 0) {
    const customItems: SessionItem[] = customCfg.slots.map(cs => {
      const [sh, sm] = cs.start.split(':').map(Number);
      const [eh, em] = cs.end.split(':').map(Number);
      const a = toU(y, m, d, sh * 60 + sm);
      const b = toU(y, m, d, eh * 60 + em);
      return mk([a, b], false, true, cs.title);
    });

    if (customCfg.replaceDefault) {
      list = customItems.sort((p, q) => p.a - q.a);
    } else {
      const defaultItems: SessionItem[] = (pl.full.map(x => mk(x, false)) as SessionItem[])
        .concat(pl.extra.map(x => mk(x, true)));
      list = defaultItems.concat(customItems).sort((p, q) => p.a - q.a);
    }
  } else {
    list = (pl.full.map(x => mk(x, false)) as SessionItem[])
      .concat(pl.extra.map(x => mk(x, true)))
      .sort((p, q) => p.a - q.a);
  }

  const live = list.filter(x => !x.opt && !x.past);
  const nOK = live.filter(x => x.ok === true).length;
  const nBad = live.filter(x => x.ok === false).length;
  const hasW = live.some(x => x.ok !== null);
  const glob = list.some(x => x.st && x.st.src === 'G');
  const minOpen = settings.fmin;

  const s = live.map(x => x.st).filter(Boolean) as WindStat[];
  let rng = '';
  if (s.length) {
    const lo = Math.min(...s.map(x => x.lo));
    const hi = Math.max(...s.map(x => x.hi));
    const g = Math.max(...s.map(x => x.g || 0));
    let sx = 0;
    let sy = 0;
    for (const x of s) {
      sx += Math.sin(x.dir * R);
      sy += Math.cos(x.dir * R);
    }
    rng = Math.round(lo) + '–' + Math.round(hi) + ' nds' +
      (g ? ', raf. ' + Math.round(g) : '') + ', ' +
      comp(((Math.atan2(sx, sy) / R + 360) % 360));
  }

  let k: 'g' | 'o' | 'r' | 'x';
  let why: string;

  if (!list.length) {
    k = 'r';
    why = 'Aucune séance possible ce jour-là';
  } else if (isT && !live.length) {
    k = 'x';
    why = "Plus de séance à venir aujourd'hui";
  } else if (!hasW) {
    k = 'o';
    why = live.length + ' séance' + (live.length > 1 ? 's' : '') +
      ' possible' + (live.length > 1 ? 's' : '') +
      ' · météo indisponible, vent non vérifié';
  } else if (nOK === 0) {
    k = 'r';
    why = 'Vent hors plage sur toutes les séances (' + rng + ')';
  } else if (nOK >= minOpen && nBad === 0) {
    k = 'g';
    why = nOK + ' séances · vent ' + rng;
  } else {
    k = 'o';
    why = nOK + ' séance' + (nOK > 1 ? 's' : '') + ' avec vent OK sur ' +
      live.length + (nBad ? ' · vent hors plage sur ' + nBad : '') + ' (' + rng + ')';
  }

  return { ds, y, m, d, list, live, k, why, glob, hasW, rng, pl };
}

export const kOf = (x: SessionItem) => Math.round(x.a) + (x.opt ? 'o' : '') + (x.isCustom ? 'c' : '');
export const sigOf = (f: DayFocusData) => f.list.map(kOf).join('|');

export function vstat(f: DayFocusData, validations: ValidationsMap) {
  const V = validations[f.ds];
  if (!V) return { st: 'none' as const };
  if (V.sig === sigOf(f) && V.k === f.k) return { st: 'ok' as const, V };
  const old = new Set(V.items.map(x => x.k));
  const cur = new Set(f.list.map(kOf));
  return {
    st: 'chg' as const,
    V,
    add: f.list.filter(x => !old.has(kOf(x))),
    rem: V.items.filter(x => !cur.has(x.k)),
    kchg: V.k !== f.k,
  };
}

export const WMO = (c: number | null) =>
  c == null ? '' : c === 0 ? '☀️' : c <= 1 ? '🌤️' : c === 2 ? '⛅' : c === 3 ? '☁️' :
  (c === 45 || c === 48) ? '🌫️' : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' :
  c <= 82 ? '🌦️' : c <= 86 ? '🌨️' : '⛈️';

export const WMON = (c: number | null) =>
  c == null ? '' : c === 0 ? 'Ciel dégagé' : c <= 1 ? 'Peu nuageux' : c === 2 ? 'Éclaircies' :
  c === 3 ? 'Couvert' : (c === 45 || c === 48) ? 'Brouillard' : c <= 57 ? 'Bruine' :
  c <= 67 ? 'Pluie' : c <= 77 ? 'Neige' : c <= 82 ? 'Averses' : c <= 86 ? 'Averses de neige' : 'Orage';

export function dayRow(
  y: number,
  m: number,
  d: number,
  settings: AppSettings,
  EX: TidePoint[],
  W: [number, number][],
  first: number,
  last: number,
  windList: WindPoint[]
): DayRowData {
  const ds = `${y}-${p2(m + 1)}-${p2(d)}`;
  const a = toU(y, m, d, 0);
  const z = toU(y, m, d + 1, 0);
  const sn = sunInfo(y, m, d, settings.lum, settings.lmg);
  const mt = moonTimes(y, m, d);
  const W2 = dayWind(y, m, d, settings, W, first, last, windList);
  const pl = plan(y, m, d, settings, W, first, last);

  return {
    ds,
    w: JS[new Date(Date.UTC(y, m, d)).getUTCDay()],
    coef: COEF[ds],
    tides: EX.filter(p => p.t >= a && p.t < z).map(
      p => (p.pm ? 'PM ' : 'BM ') + lc(p.t, y, m, d) + ' ' + (p.hd != null ? p.hd : p.h).toFixed(2).replace('.', ',')
    ),
    pl: W2.P.map(p => lc(p[0], y, m, d) + ' – ' + lc(p[1], y, m, d)),
    vent: W2.ws.map(wtxt).filter(Boolean),
    lvl: W2.lvl,
    ext: pl.extra.map(x => lc(x[0], y, m, d) + '–' + lc(x[1], y, m, d) + ' (optionnel, +' + x[3] + ' min)'),
    ses: pl.full.map(x => lc(x[0], y, m, d) + '–' + lc(x[1], y, m, d) + (sw(x[0], x[1], settings, windList) === true ? ' ✓' : '')),
    all: allDay(y, m, d, settings),
    lev: sn.lev,
    cou: sn.cou,
    lum: sn.lum,
    lr: mt.rise,
    ls: mt.set,
    ph: phase(a),
  };
}

export const qCsv = (x: unknown) => '"' + String(x ?? '').replace(/"/g, '""') + '"';

export function dl(name: string, rows: (string | number)[][]) {
  const b = new Blob(['\ufeff' + rows.map(r => r.map(qCsv).join(';')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

export function exportSlotsCsv(
  all: boolean,
  currentY: number,
  currentM: number,
  settings: AppSettings,
  W: [number, number][],
  first: number,
  last: number,
  windList: WindPoint[],
  customSlotsMap?: CustomSlotsMap
) {
  const rows: (string | number)[][] = [
    ['Date', 'Jour', 'Début', 'Fin', 'Durée (min)', 'Places', 'Coef', 'Vent prévu', 'Vent OK', 'Type', 'Limité par', 'Dépassement (min)']
  ];
  const from = all ? minDs : `${currentY}-${p2(currentM + 1)}-01`;
  const to = all ? maxDs : `${currentY}-${p2(currentM + 1)}-31`;
  const hh = (x: string) => x.replace('h', ':');

  for (const [ds] of DATA) {
    if (ds < from || ds > to || ds < minDs || ds > maxDs) continue;
    const [y, m0, d] = ds.split('-').map(Number);
    const m = m0 - 1;
    const w = JS[new Date(Date.UTC(y, m, d)).getUTCDay()];
    const pl = plan(y, m, d, settings, W, first, last);

    const customCfg = customSlotsMap?.[ds];
    let allSlots: [number, number, string, string, number][] = [];

    if (customCfg && customCfg.slots.length > 0) {
      const customSess: [number, number, string, string, number][] = customCfg.slots.map(cs => {
        const [sh, sm] = cs.start.split(':').map(Number);
        const [eh, em] = cs.end.split(':').map(Number);
        const a = toU(y, m, d, sh * 60 + sm);
        const b = toU(y, m, d, eh * 60 + em);
        return [a, b, cs.title || 'sur-mesure', '', 0];
      });

      if (customCfg.replaceDefault) {
        allSlots = customSess.sort((p, q) => p[0] - q[0]);
      } else {
        const def = (pl.full.map(x => [x[0], x[1], 'séance', '', 0]) as [number, number, string, string, number][])
          .concat(pl.extra.map(x => [x[0], x[1], 'optionnel', x[2], x[3]]));
        allSlots = def.concat(customSess).sort((p, q) => p[0] - q[0]);
      }
    } else {
      allSlots = (pl.full.map(x => [x[0], x[1], 'séance', '', 0]) as [number, number, string, string, number][])
        .concat(pl.extra.map(x => [x[0], x[1], 'optionnel', x[2], x[3]]))
        .sort((p, q) => p[0] - q[0]);
    }

    for (const x of allSlots) {
      const ok = sw(x[0], x[1], settings, windList);
      rows.push([
        p2(d) + '/' + p2(m0) + '/' + y,
        w,
        hh(lc(x[0], y, m, d)),
        hh(lc(x[1], y, m, d)),
        Math.round(x[1] - x[0]),
        settings.cap || 1,
        COEF[ds],
        wtxt(wstat(x[0], x[1], windList)),
        ok === true ? 'oui' : ok === false ? 'non' : '',
        x[2],
        x[3],
        x[4] || '',
      ]);
    }
  }

  dl(all ? 'creneaux-complet.csv' : `creneaux-${currentY}-${p2(currentM + 1)}.csv`, rows);
}

export function exportMonthCsv(
  all: boolean,
  currentY: number,
  currentM: number,
  settings: AppSettings,
  EX: TidePoint[],
  W: [number, number][],
  first: number,
  last: number,
  windList: WindPoint[]
) {
  const rows: (string | number)[][] = [
    ['Date', 'Coef', 'Marées', 'Plages de roulage', 'Séances', 'Vent', 'Lever soleil', 'Coucher soleil', 'Lumière retenue', 'Lever lune', 'Coucher lune', 'Phase']
  ];
  const from = all ? minDs : `${currentY}-${p2(currentM + 1)}-01`;
  const to = all ? maxDs : `${currentY}-${p2(currentM + 1)}-31`;

  for (const [ds] of DATA) {
    if (ds < from || ds > to || ds < minDs || ds > maxDs) continue;
    const [y, m, d] = ds.split('-').map(Number);
    const r = dayRow(y, m - 1, d, settings, EX, W, first, last, windList);
    rows.push([
      p2(d) + '/' + p2(m) + '/' + y,
      r.coef ?? '',
      r.tides.join(' | '),
      r.pl.join(' | '),
      r.ses.concat(r.ext).join(' | '),
      r.vent.join(' | '),
      r.lev,
      r.cou,
      r.lum,
      r.lr,
      r.ls,
      r.ph,
    ]);
  }

  dl(all ? 'roulage-complet.csv' : `roulage-${currentY}-${p2(currentM + 1)}.csv`, rows);
}

export function exportValidCsv(validations: ValidationsMap, cap: number) {
  const rows: (string | number)[][] = [
    ['Date', 'Début', 'Fin', 'Type', 'Dépassement (min)', 'Limité par', 'Places', 'Validé le']
  ];
  for (const ds of Object.keys(validations).sort()) {
    const [y, m, d] = ds.split('-');
    for (const x of validations[ds].items) {
      rows.push([
        d + '/' + m + '/' + y,
        x.s.replace('h', ':'),
        x.e.replace('h', ':'),
        x.customTitle || (x.opt ? 'optionnel' : 'séance'),
        x.over || '',
        x.lim || '',
        cap || 1,
        new Date(validations[ds].ts).toLocaleString('fr-FR'),
      ]);
    }
  }
  if (rows.length < 2) {
    alert('Aucune journée validée.');
    return;
  }
  dl('planning-valide.csv', rows);
}

/**
 * Windguru color coding styles
 */
export function getWindguruBg(knots: number): { bg: string; text: string } {
  if (knots < 7) return { bg: '#e2e8f0', text: '#334155' };
  if (knots <= 10) return { bg: '#bbf7d0', text: '#14532d' };
  if (knots <= 15) return { bg: '#86efac', text: '#14532d' };
  if (knots <= 21) return { bg: '#fef08a', text: '#713f12' };
  if (knots <= 27) return { bg: '#fed7aa', text: '#7c2d12' };
  if (knots <= 34) return { bg: '#fca5a5', text: '#7f1d1d' };
  return { bg: '#e9d5ff', text: '#581c87' };
}

export function getWindguruGustBg(knots: number): { bg: string; text: string } {
  if (knots < 15) return { bg: '#f1f5f9', text: '#475569' };
  if (knots <= 22) return { bg: '#fef08a', text: '#713f12' };
  if (knots <= 29) return { bg: '#fdba74', text: '#7c2d12' };
  if (knots <= 35) return { bg: '#f87171', text: '#450a0a' };
  return { bg: '#c084fc', text: '#3b0764' };
}
