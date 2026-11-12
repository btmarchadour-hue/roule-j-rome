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
  xplCustomized?: boolean;
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
  calculationMode?: 'theorique' | 'reel';
  empiricalOffsetCm?: number;
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
  status?: 'valid' | 'rejected';
  rejectReason?: string;
  assignedPilot?: string; // Nom du moniteur diplômé (Jérôme)
  instructor?: string;    // Moniteur diplômé encadrant responsable (Jérôme)
  pilotsCount?: number;   // Nombre de participants / pilotes inscrits (min 1 si séance validée)
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

// -----------------------------------------------------------------------------
// MODULE STATISTIQUES & OBSERVATOIRE DES ÉCARTS TERRAIN (LESTREVET)
// -----------------------------------------------------------------------------

export type CancellationReason =
  | 'wind_low'         // Vent insuffisant (< 8 nds)
  | 'wind_high'        // Vent trop fort ou rafales (> 25/35 nds)
  | 'wind_dir'         // Déventé / mauvais secteur (vent de terre)
  | 'no_clients'       // Manque d'inscrits / réservations nulles
  | 'beach_state'      // État de la plage (bâches profondes, cailloux, sable mou)
  | 'weather_extreme'  // Orage / pluie battante / submersion
  | 'instructor'       // Indisponibilité moniteur / matériel
  | 'other';           // Autre motif

export interface SlotObservation {
  id: string;
  ds: string;                  // Date YYYY-MM-DD
  slotKey: string;             // Identifiant du créneau (ex: "s0", "custom-1")
  slotStart: string;           // "10:30"
  slotEnd: string;             // "11:30"
  isCustom?: boolean;
  customTitle?: string;
  status: 'realized' | 'cancelled';
  cancellationReason?: CancellationReason;
  cancellationNote?: string;
  // Écarts mesurés vs théorie
  actualPassableTime?: string; // Heure réelle d'accès effectif au sable (ex: "10:15")
  timeDeltaMin?: number;        // Différence en minutes (- = accessible plus tôt, + = retard)
  actualWaterHeight?: number;   // Hauteur d'eau constatée (m)
  waterDeltaCm?: number;        // Surcote ou sous-cote constatée (cm, ex: +20 cm)
  // Paramètres environnementaux réels au moment de la séance
  observedPressure?: number;    // Pression atmosphérique réelle (hPa)
  observedWindKts?: number;     // Vent moyen réel (nds)
  observedGustKts?: number;     // Rafales réelles (nds)
  observedWindDir?: string;     // Secteur réel (ex: "O", "SO", "ONO")
  observedWaveH?: number;       // Hauteur de houle réelle (m)
  observedWavePeriod?: number;  // Période de houle (s)
  beachCondition?: 'dur' | 'mou' | 'baches_faibles' | 'baches_fortes';
  // Bilan participants (Séances réalisées ou annulées avec inscrits)
  participantsCount?: number;           // Pilotes ayant effectivement roulé (si réalisée)
  monoCount?: number;
  biCount?: number;
  bookedParticipantsCount?: number;     // Inscrits prévus sur ce créneau (si annulée)
  rescheduledCount?: number;            // Dont personnes replacées / reportées sur une autre séance
  lostCount?: number;                   // Dont personnes définitivement perdues / remboursées
  notes?: string;
  author?: string;
  updatedAt?: number;
  createdAt: number;
}

// -----------------------------------------------------------------------------
// MODULE BASE DE DONNÉES CLIENTS & CRM (ÉCOLE DE CHAR À VOILE)
// -----------------------------------------------------------------------------

export type ClientSkillLevel = 'debutant' | 'initie' | 'perfectionnement' | 'autonome';
export type ClientPreferredGear = 'monoplace' | 'biplace' | 'standart' | 'promo' | 'indifferent';

export interface ClientBookingHistoryItem {
  date: string;
  slotTime: string;
  formula?: string;
  chars?: string;
  payment?: string;
  status: 'valid' | 'pending' | 'signed';
}

export interface ClientProfile {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  city?: string;
  postalCode?: string;
  level?: ClientSkillLevel;
  preferredGear?: ClientPreferredGear;
  totalSessions: number;
  lastSessionDate?: string;
  totalSpent?: number;
  hasGiftVoucher?: boolean;
  giftVoucherBalance?: number;
  notes?: string;
  tags?: string[];
  author?: string;
  createdAt: number;
  updatedAt: number;
}

// -----------------------------------------------------------------------------
// MODULE GESTION DES PROFILS & UTILISATEURS (AUTHENTIFICATION INDIVIDUELLE)
// -----------------------------------------------------------------------------

export type UserRole = 'admin' | 'moniteur';

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  isReadOnly: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
}

export interface ActiveUserSession {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isReadOnly: boolean;
  loginTime: number;
}

// -----------------------------------------------------------------------------
// MODULE 7 : ESPACE D'ÉCHANGE BEN ↔ JÉRÔME (CARNET DE LIAISON PARTAGÉ)
// -----------------------------------------------------------------------------

export type TeamNoteCategory = 'terrain' | 'technique' | 'organisation' | 'autre';

export interface TeamNote {
  id: string;
  author: string; // 'Jérôme' | 'Benoît'
  category: TeamNoteCategory;
  content: string;
  createdAt: number;
  isResolved?: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
}

// -----------------------------------------------------------------------------
// MODULE ÉTALONNAGE GPS LIMITE BASSE DE ROULAGE (OBSERVATOIRE HYDRODYNAMIQUE)
// -----------------------------------------------------------------------------

export interface GpsWaterlineLog {
  id: string;                  // Identifiant unique (ex: "gps-1794246800000")
  timestamp: number;           // Millisecondes UTC au moment du clic
  dateStr: string;             // YYYY-MM-DD
  timeStr: string;             // HH:MM (ex: "14:27")
  author: string;              // "Jérôme" | "Benoît"

  // Coordonnées GPS réelles du smartphone
  latitude: number;            // Ex: 48.18731
  longitude: number;           // Ex: -4.37542
  altitude?: number | null;    // Altitude en mètres si disponible
  accuracyM: number;           // Précision en mètres (ex: 3.5 m)
  accuracyQuality: 'high' | 'medium' | 'low'; // high (<= 5m), medium (6-15m), low (> 15m)

  // Météo instantanée capturée au moment du relevé
  weatherSnapshot: {
    windSpeedKts: number;      // Vitesse vent moyen (nds)
    windGustKts: number;       // Rafales (nds)
    windDirectionDeg: number;  // Direction en degrés (0-360)
    windDirectionComp: string; // Direction boussole (ex: "OSO")
    pressureHpa: number;       // Pression atmosphérique (hPa)
    waveHeightM?: number;      // Hauteur de houle (m)
    wavePeriodS?: number;      // Période de houle (s)
  };

  // Modèles hydrodynamiques à cet instant T
  theoreticalWaterHeightM: number; // Modèle SHOM pur sans correction barométrique/vent (m)
  correctedWaterHeightM: number;   // Modèle corrigé école (avec surcote barométrique +1cm/hPa et vent) (m)
  schoolThresholdM: number;        // Seuil de roulage de l'école (ex: 4.50 m)

  // Écarts mesurés vs modèles
  rawSurcoteCm: number;            // Surcote constatée vs modèle brut SHOM (cm)
  correctedSurcoteCm: number;      // Écart résiduel vs modèle corrigé école (cm)

  // Notes de terrain
  beachState?: 'dur' | 'mou' | 'baches_faibles' | 'baches_fortes';
  note?: string;
  createdAt: number;
}

