export interface AppSettings {
  sdur: number;
  gs: number;
  gw: number;
  s0: string;
  s1: string;
  pre: number;
  post: number;
  rnd: number;
  xon: boolean;
  xtol: number;
  xpl: 'fin' | 'debut';
  cap: number;
  all: boolean;
  cmax: number;
  pcor: boolean;
  L: number;
  mg: number;
  lum: number;
  lmg: number;
  h0: number;
  h1: number;
  les: boolean;
  vmin: number;
  vmax: number;
  gmax: number;
  fmin: number;
}

export interface TidePoint {
  t: number;
  h: number;
  hd: number;
  pm: number;
  adj?: number;
}

export interface WindPoint {
  t: number;
  v: number;
  g: number | null;
  a: number;
  s: 'A' | 'G';
  p: number | null;
  tp: number | null;
  ap: number | null;
  pr: number | null;
  wc: number | null;
  cc?: number | null;
  rh?: number | null;
  pop?: number | null;
  // Données enrichies Houle & Luminosité (modèle Windguru)
  ccl?: number | null; // Nuages bas (%)
  ccm?: number | null; // Nuages moyens (%)
  cch?: number | null; // Nuages hauts (%)
  rad?: number | null; // Rayonnement solaire instantané / luminosité (W/m²)
  uv?: number | null;  // Indice UV
  wvh?: number | null; // Hauteur de houle / vagues (m)
  wvp?: number | null; // Période de houle (s)
  wvd?: number | null; // Direction de la houle (degrés)
}

export interface WindStat {
  lo: number;
  hi: number;
  g: number;
  src: 'A' | 'G';
  dir: number;
}

export interface SessionItem {
  a: number;
  b: number;
  opt: boolean;
  isCustom?: boolean;
  customTitle?: string;
  ok: boolean | null;
  st: WindStat | null;
  txt: string;
  over: number;
  lim: string;
  side: string;
  past: boolean;
}

export interface DayPlan {
  full: [number, number][];
  extra: [number, number, string, number, string][];
}

export interface CustomSlot {
  id: string;
  start: string; // e.g. "14:00"
  end: string;   // e.g. "15:00"
  title: string;
  places: number;
}

export interface CustomDaySlotsConfig {
  replaceDefault: boolean;
  slots: CustomSlot[];
}

export type CustomSlotsMap = Record<string, CustomDaySlotsConfig>;

export interface DayFocusData {
  ds: string;
  y: number;
  m: number;
  d: number;
  list: SessionItem[];
  live: SessionItem[];
  k: 'g' | 'o' | 'r' | 'x';
  why: string;
  glob: boolean;
  hasW: boolean;
  rng: string;
  pl: DayPlan;
}

export interface ValidationItem {
  k: string;
  s: string;
  e: string;
  opt: boolean;
  over: number;
  lim: string;
  customTitle?: string;
}

export interface ValidationDayRecord {
  sig: string;
  ts: number;
  k: 'g' | 'o' | 'r' | 'x';
  items: ValidationItem[];
}

export type ValidationsMap = Record<string, ValidationDayRecord>;

export interface DayRowData {
  ds: string;
  w: string;
  coef: number | undefined;
  tides: string[];
  pl: string[];
  vent: string[];
  lvl: number;
  ext: string[];
  ses: string[];
  all: boolean;
  lev: string;
  cou: string;
  lum: string;
  lr: string;
  ls: string;
  ph: string;
}
