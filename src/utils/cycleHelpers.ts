import { MAX_CHARS_PER_INSTRUCTOR, SessionItem, SlotObservation, ValidationItem, ValidationDayRecord } from '../types';
import { AgendaBookingItem } from './firebaseSync';
import { lc } from './tides';

export { MAX_CHARS_PER_INSTRUCTOR };

export interface SlotBookingCounts {
  bookingsCount: number;
  monoCount: number;
  biCount: number;
  totalChars: number;
  totalPeople: number;
  isOverCapacity: boolean;
}

export const DEFAULT_NON_PUBLISH_REASONS = [
  'Réunion / Administratif',
  'Impératif personnel',
  'Vacances / Congés',
  'Formation / Stage',
  'Entretien / Maintenance matériel',
  'Événement / Compétition',
] as const;

export function stripReasonAccents(str: string): string {
  return (str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeClosureReason(raw?: string): {
  key: string;
  label: string;
  isGenericClosed: boolean;
} {
  const cleaned = (raw || '').trim();
  const norm = stripReasonAccents(cleaned);

  if (
    !norm ||
    norm === 'ferme' ||
    norm === 'fermee' ||
    norm === 'fermeture' ||
    norm === 'cloture' ||
    norm === 'cloturee' ||
    norm === 'non publie' ||
    norm === 'a ne pas publier' ||
    norm === 'refuse' ||
    norm === 'refusee' ||
    norm === 'refus' ||
    norm === 'annule' ||
    norm === 'annulee' ||
    norm === 'rejete' ||
    norm === 'rejetee'
  ) {
    return {
      key: 'ferme',
      label: 'Fermé (raison à préciser)',
      isGenericClosed: true,
    };
  }

  if (
    norm === 'indisponibilite moniteur / materiel' ||
    norm === 'indisponibilite moniteur' ||
    norm === 'indisponibilite'
  ) {
    return {
      key: 'indisponibilite moniteur / materiel',
      label: 'Indisponibilité moniteur / matériel',
      isGenericClosed: true,
    };
  }

  if (norm === 'reunion' || norm === 'reunions' || norm === 'reunion / administratif') {
    return {
      key: 'reunion / administratif',
      label: 'Réunion / Administratif',
      isGenericClosed: false,
    };
  }

  if (
    norm === 'imperatif personnel' ||
    norm === 'imperatif' ||
    norm === 'indisponibilite personnelle' ||
    norm === 'raison personnelle' ||
    norm === 'perso'
  ) {
    return {
      key: 'imperatif personnel',
      label: 'Impératif personnel',
      isGenericClosed: false,
    };
  }

  if (norm === 'vacance' || norm === 'vacances' || norm === 'conge' || norm === 'conges' || norm === 'vacances / conges') {
    return {
      key: 'vacances / conges',
      label: 'Vacances / Congés',
      isGenericClosed: false,
    };
  }

  if (norm === 'formation' || norm === 'stage' || norm === 'formation / stage') {
    return {
      key: 'formation / stage',
      label: 'Formation / Stage',
      isGenericClosed: false,
    };
  }

  if (norm === 'entretien' || norm === 'maintenance' || norm === 'entretien / maintenance materiel') {
    return {
      key: 'entretien / maintenance materiel',
      label: 'Entretien / Maintenance matériel',
      isGenericClosed: false,
    };
  }

  if (norm === 'evenement' || norm === 'competition' || norm === 'evenement / competition') {
    return {
      key: 'evenement / competition',
      label: 'Événement / Compétition',
      isGenericClosed: false,
    };
  }

  // Fusionne automatiquement toute variante de casse/accent (ex: "Fermé travaux" vs "Ferme travaux")
  const canonicalDisplay = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return {
    key: norm,
    label: canonicalDisplay,
    isGenericClosed: false,
  };
}

export interface SecondaryInstructorPreset {
  name: string;
  qualification: 'CQP' | 'DE_BPJEPS';
  addChars: number;
  label: string;
}

export const SECONDARY_INSTRUCTOR_PRESETS: SecondaryInstructorPreset[] = [
  {
    name: 'Youenn',
    qualification: 'CQP',
    addChars: 8,
    label: 'Youenn · CQP (+8 chars → 20 max)',
  },
  {
    name: 'Katleen',
    qualification: 'DE_BPJEPS',
    addChars: 12,
    label: 'Katleen · Diplômée (+12 chars → 24 max)',
  },
];

export interface MonitorBadgeStyle {
  bg: string;
  fg: string;
  bd: string;
}

export function getMonitorBadgeStyle(name: string): MonitorBadgeStyle {
  const n = (name || '').toLowerCase();
  if (n.includes('jérôme') || n.includes('jerome')) {
    return { bg: '#eff6ff', fg: '#1d4ed8', bd: '#93c5fd' };
  }
  if (n.includes('youenn')) {
    return { bg: '#ecfdf5', fg: '#047857', bd: '#6ee7b7' };
  }
  if (n.includes('katleen')) {
    return { bg: '#f5f3ff', fg: '#6d28d9', bd: '#c4b5fd' };
  }
  return { bg: '#fff7ed', fg: '#c2410c', bd: '#fdba74' };
}

export function getSlotMaxCapacity(item?: Pick<ValidationItem, 'secondaryInstructor' | 'secondaryMaxChars' | 'secondaryQualification'>): number {
  if (!item?.secondaryInstructor?.trim()) return MAX_CHARS_PER_INSTRUCTOR;
  const extra =
    item.secondaryMaxChars != null
      ? Math.max(1, Number(item.secondaryMaxChars) || 0)
      : item.secondaryQualification === 'CQP'
      ? 8
      : MAX_CHARS_PER_INSTRUCTOR;
  return MAX_CHARS_PER_INSTRUCTOR + extra;
}

export type Cycle1SlotAction = 'publish' | 'not_published' | 'excluded' | 'close_no_bookings' | 'reset';

export type Cycle2ActionPayload =
  | {
      type: 'confirm';
      monoCount?: number;
      biCount?: number;
      pilotsCount?: number;
      instructor?: string;
    }
  | {
      type: 'shift';
      shiftMinutes: number;
      newStart: string;
      newEnd: string;
    }
  | {
      type: 'merge';
      targetSlotKey: string;
      targetLabel: string;
    }
  | {
      type: 'cancel_weather';
      reason: string;
      rescheduledChars?: number;
      lostChars?: number;
    }
  | {
      type: 'realized';
      monoCount?: number;
      biCount?: number;
      pilotsCount?: number;
      instructor?: string;
    }
  | {
      type: 'double_instructor';
      secondaryInstructor?: string;
      secondaryQualification?: 'CQP' | 'DE_BPJEPS';
      secondaryMaxChars?: number;
      secondaryActualEnd?: string;
      secondaryFormula?: string;
    }
  | {
      type: 'reset_to_cycle1';
    }
  | {
      type: 'purge_orphan';
      valItemKey?: string;
    };

/**
 * Extrait de manière fiable le nombre de monoplaces, biplaces et total de chars
 * d'une réservation (champs structurés ou texte libre "1 biplace + 2 mono").
 */
export function parseBookingItemCounts(item: AgendaBookingItem): {
  mono: number;
  bi: number;
  chars: number;
  people: number;
} {
  if (item.monoCount != null || item.biCount != null) {
    const mono = Math.max(0, Number(item.monoCount) || 0);
    const bi = Math.max(0, Number(item.biCount) || 0);
    const chars = mono + bi;
    const people = item.peopleCount != null ? Math.max(0, Number(item.peopleCount) || 0) : mono + bi * 2;
    return { mono, bi, chars, people };
  }

  const raw = (item.chars || '').toLowerCase();
  let mono = 0;
  let bi = 0;

  const biMatch = raw.match(/(\d+)\s*(?:bi|biplace|biplaces)/i);
  if (biMatch) bi = parseInt(biMatch[1], 10) || 0;

  const monoMatch = raw.match(/(\d+)\s*(?:mono|monoplace|monoplaces|simple|simples)/i);
  if (monoMatch) mono = parseInt(monoMatch[1], 10) || 0;

  if (mono === 0 && bi === 0) {
    const anyNum = raw.match(/(\d+)/);
    if (anyNum) {
      mono = parseInt(anyNum[1], 10) || 0;
    } else if (item.name?.trim()) {
      // Au moins 1 char si une réservation nominative a été saisie sans préciser le modèle
      mono = 1;
    }
  }

  const chars = mono + bi;
  const paxNum = item.pax ? parseInt(item.pax.replace(/\D/g, ''), 10) : NaN;
  const people = !isNaN(paxNum) && paxNum > 0 ? paxNum : mono + bi * 2;
  return { mono, bi, chars, people };
}

export function getSlotBookingsSummary(
  bookings: AgendaBookingItem[] = [],
  maxCapacity: number = MAX_CHARS_PER_INSTRUCTOR
): SlotBookingCounts {
  let monoCount = 0;
  let biCount = 0;
  let totalPeople = 0;

  for (const b of bookings) {
    const c = parseBookingItemCounts(b);
    monoCount += c.mono;
    biCount += c.bi;
    totalPeople += c.people;
  }

  const totalChars = monoCount + biCount;
  return {
    bookingsCount: bookings.length,
    monoCount,
    biCount,
    totalChars,
    totalPeople,
    isOverCapacity: totalChars > maxCapacity,
  };
}

/**
 * Calcule la jauge en CHARS (Mono + Bi, règle max 12 chars / moniteur)
 * avec rétrocompatibilité complète sur les fiches antérieures.
 */
export function getValidationItemChars(item?: ValidationItem): {
  mono: number;
  bi: number;
  totalChars: number;
  people: number;
} {
  if (!item) return { mono: 0, bi: 0, totalChars: 0, people: 0 };

  const hasTyped = item.monoCount != null || item.biCount != null;
  const mono = hasTyped ? Math.max(0, Number(item.monoCount) || 0) : 0;
  const bi = hasTyped ? Math.max(0, Number(item.biCount) || 0) : 0;
  const totalChars =
    item.charsCount != null
      ? Math.max(0, Number(item.charsCount) || 0)
      : hasTyped
      ? mono + bi
      : Math.max(0, Number(item.pilotsCount) || 0);

  const people =
    item.pilotsCount != null
      ? Math.max(0, Number(item.pilotsCount) || 0)
      : hasTyped
      ? mono + bi * 2
      : totalChars;

  return { mono, bi, totalChars, people };
}

export function getObservationChars(obs?: SlotObservation | null): number {
  if (!obs) return 0;
  if (obs.monoCount != null || obs.biCount != null) {
    return Math.max(0, Number(obs.monoCount) || 0) + Math.max(0, Number(obs.biCount) || 0);
  }
  if (obs.charsCount != null) return Math.max(0, Number(obs.charsCount) || 0);
  return Math.max(0, Number(obs.participantsCount) || 0);
}

export function isNoBookingsReason(reason?: string): boolean {
  if (!reason) return false;
  const norm = stripReasonAccents(reason);
  if (
    norm.includes('vent') ||
    norm.includes('rafale') ||
    norm.includes('petole') ||
    norm.includes('pluie') ||
    norm.includes('orage') ||
    norm.includes('houle') ||
    norm.includes('bache') ||
    norm.includes('plage') ||
    norm.includes('meteo') ||
    norm.includes('secteur') ||
    norm.includes('devent') ||
    norm.includes('ne se sont pas') ||
    norm.includes('pas present') ||
    norm.includes('absent') ||
    norm.includes('no-show') ||
    norm.includes('no show') ||
    norm.includes('desistement')
  ) {
    return false;
  }
  return (
    norm.includes("pas d'inscr") ||
    norm.includes('pas d inscr') ||
    norm.includes('sans inscr') ||
    norm.includes("manque d'inscr") ||
    norm.includes('manque d inscr') ||
    norm.includes('aucun inscr') ||
    norm.includes('0 inscr') ||
    norm.includes('zero inscr') ||
    norm.includes('faute d') ||
    norm.includes('pas de client') ||
    norm.includes('sans client') ||
    norm.includes('aucun client') ||
    norm.includes('0 client') ||
    norm.includes('pas de reserv') ||
    norm.includes('aucune reserv') ||
    norm.includes('sans reserv') ||
    norm.includes('vie 1') ||
    norm.includes('no_clients') ||
    norm === 'aucun'
  );
}

export function isExcludedCycle1(item?: ValidationItem): boolean {
  if (!item) return false;
  if (item.cycle1Status === 'excluded') return true;
  const r = (item.rejectReason || '').toLowerCase();
  return r.includes('hors offre') || r.includes('non pertinent');
}

export function isNotPublishedCycle1(item?: ValidationItem): boolean {
  if (!item || isExcludedCycle1(item)) return false;
  if (item.cycle1Status === 'not_published' || Boolean(item.nonPublishReason)) return true;
  const r = (item.rejectReason || '').toLowerCase();
  return r.includes('non publié') || r.includes('non publie');
}

/**
 * Statut effectif en Cycle 1 (Publication commerciale jour par jour)
 */
export function getEffectiveCycle1Status(
  item?: ValidationItem
): 'unpublished' | 'published' | 'not_published' | 'excluded' | 'closed_no_bookings' {
  if (!item) return 'unpublished';
  if (isExcludedCycle1(item)) return 'excluded';
  if (isNotPublishedCycle1(item)) return 'not_published';
  if (item.cycle1Status === 'closed_no_bookings') return 'closed_no_bookings';
  if (item.status === 'rejected' && isNoBookingsReason(item.rejectReason)) {
    return 'closed_no_bookings';
  }
  return 'published';
}

/**
 * Détermine si le créneau est pilotable en Cycle 2 :
 * Tout créneau validé « À publier » en Cycle 1 est d'office ouvert en Cycle 2, même avec 0 inscrit saisi.
 */
export function hasCycle2Trigger(
  item?: ValidationItem,
  bookingChars = 0,
  obs?: SlotObservation | null
): boolean {
  if (obs) return true;
  if (!item) return false;
  const c1 = getEffectiveCycle1Status(item);
  if (c1 === 'published') return true;
  if (isExcludedCycle1(item) || isNotPublishedCycle1(item) || c1 === 'closed_no_bookings') return false;
  if (bookingChars > 0) return true;
  if (item.cycle2Status && item.cycle2Status !== 'awaiting_booking') return true;
  if (getValidationItemChars(item).totalChars > 0) return true;
  if (item.status === 'rejected' && !isNoBookingsReason(item.rejectReason)) return true;
  return false;
}

/**
 * Indique si le créneau comporte déjà une activité réelle Cycle 2 (inscrits, décalage, 2e moniteur, météo ou REX)
 * qu'il ne faut pas écraser silencieusement lors d'une revalidation Cycle 1.
 */
export function hasCycle2Activity(
  item?: ValidationItem,
  bookingChars = 0,
  obs?: SlotObservation | null
): boolean {
  if (bookingChars > 0 || Boolean(obs)) return true;
  if (!item) return false;
  if (isExcludedCycle1(item) || isNotPublishedCycle1(item)) return false;
  if (getValidationItemChars(item).totalChars > 0) return true;
  if (Boolean(item.secondaryInstructor?.trim())) return true;
  if (hasRecordedShift(item)) return true;
  if (
    item.cycle2Status === 'shifted' ||
    item.cycle2Status === 'merged' ||
    item.cycle2Status === 'cancelled_weather' ||
    item.cycle2Status === 'realized'
  ) {
    return true;
  }
  if (item.status === 'rejected' && !isNoBookingsReason(item.rejectReason)) {
    return true;
  }
  return false;
}

export function getEffectiveCycle2Status(
  item?: ValidationItem,
  bookingChars = 0,
  obs?: SlotObservation | null
): 'none' | 'awaiting_booking' | 'confirmed' | 'shifted' | 'merged' | 'cancelled_weather' | 'realized' {
  if (obs) {
    return obs.status === 'realized' ? 'realized' : 'cancelled_weather';
  }
  if (!item) {
    return bookingChars > 0 ? 'confirmed' : 'none';
  }
  if (isExcludedCycle1(item) || isNotPublishedCycle1(item)) {
    return 'none';
  }
  if (item.cycle1Status === 'closed_no_bookings' || (item.status === 'rejected' && isNoBookingsReason(item.rejectReason))) {
    return 'none';
  }
  if (item.cycle2Status) {
    if (item.cycle2Status === 'awaiting_booking' && bookingChars > 0) {
      return 'confirmed';
    }
    return item.cycle2Status;
  }
  if (item.status === 'rejected') {
    return 'cancelled_weather';
  }
  if (item.status === 'valid') {
    const chars = Math.max(bookingChars, getValidationItemChars(item).totalChars);
    return chars > 0 ? 'confirmed' : 'awaiting_booking';
  }
  return bookingChars > 0 ? 'confirmed' : 'none';
}

/**
 * Retourne la clé de réservation unifiée pour un créneau d'une date donnée.
 */
export function buildReservationKey(ds: string, slotKey: string): string {
  return `${ds}_${slotKey}`;
}

/**
 * Recherche multi-niveaux de l'item de validation correspondant à un créneau
 */
export function findMatchingValidationItem(
  valRecord: ValidationDayRecord | undefined,
  slotKey: string,
  startTimeStr: string,
  endTimeStr: string,
  usedKeys?: Set<string>
): ValidationItem | undefined {
  const items = valRecord?.items;
  if (!items || items.length === 0) return undefined;

  const available = usedKeys ? items.filter(it => !usedKeys.has(it.k)) : items;
  if (available.length === 0) return undefined;

  const norm = (v?: string) => (v || '').trim().replace('h', ':');
  const startNorm = norm(startTimeStr);
  const endNorm = norm(endTimeStr);

  let found = available.find(it => it.k === slotKey);
  if (!found) {
    found = available.find(
      it =>
        (norm(it.publishedStart || it.s) === startNorm && norm(it.publishedEnd || it.e) === endNorm) ||
        (Boolean(it.actualStart) &&
          Boolean(it.actualEnd) &&
          norm(it.actualStart) === startNorm &&
          norm(it.actualEnd) === endNorm)
    );
  }
  if (!found) {
    found = available.find(
      it =>
        norm(it.publishedStart || it.s) === startNorm ||
        (Boolean(it.actualStart) && norm(it.actualStart) === startNorm)
    );
  }
  if (!found) {
    // Tolérance stricte <= 20 min (glissement barométrique/marée léger uniquement) :
    // interdit tout croisement accidentel avec une séance voisine (>= 45-60 min d'écart)
    const slotMin = parseTimeMinutes(startTimeStr);
    if (slotMin !== null) {
      let closest: ValidationItem | undefined;
      let minDiff = 20;
      for (const item of available) {
        const candidates = [item.publishedStart || item.s, item.actualStart].filter(Boolean) as string[];
        for (const cand of candidates) {
          const candMin = parseTimeMinutes(cand);
          if (candMin === null) continue;
          const diff = Math.abs(slotMin - candMin);
          if (diff <= minDiff) {
            minDiff = diff;
            closest = item;
          }
        }
      }
      found = closest;
    }
  }
  return found;
}

/**
 * Parse un horaire "10h15" ou "10:15" en minutes depuis 00h00
 */
export function parseTimeMinutes(v?: string): number | null {
  if (!v) return null;
  const clean = v.trim().toLowerCase().replace('h', ':');
  const m = clean.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Normalise un horaire au format canonique "10h15"
 */
export function normalizeSlotTimeHHhMM(v?: string): string {
  if (!v) return '';
  const mins = parseTimeMinutes(v);
  if (mins === null) return v.trim();
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}`;
}

/**
 * Calcule le décalage signé en minutes entre l'heure publiée d'origine et l'heure réelle
 */
export function computeShiftMinutes(publishedStart?: string, actualStart?: string): number | undefined {
  const p = parseTimeMinutes(publishedStart);
  const a = parseTimeMinutes(actualStart);
  if (p === null || a === null || p === a) return undefined;
  return a - p;
}

/**
 * Indique si une fiche ValidationItem conserve la trace d'un décalage manuel de l'horaire
 */
export function hasRecordedShift(
  item?: Pick<ValidationItem, 's' | 'e' | 'publishedStart' | 'publishedEnd' | 'actualStart' | 'actualEnd' | 'shiftMinutes' | 'cycle2Status'>
): boolean {
  if (!item) return false;
  if (typeof item.shiftMinutes === 'number' && item.shiftMinutes !== 0) return true;
  const norm = (s?: string) => (s || '').trim().replace('h', ':');
  const pubS = norm(item.publishedStart || item.s);
  const pubE = norm(item.publishedEnd || item.e);
  const actS = norm(item.actualStart);
  const actE = norm(item.actualEnd);
  if (actS && pubS && actS !== pubS) return true;
  if (actE && pubE && actE !== pubE) return true;
  return item.cycle2Status === 'shifted';
}

/**
 * Calcule un horaire décalé en minutes ("10h00" + 15 => "10h15")
 */
export function shiftTimeString(hhmm: string, deltaMin: number): string {
  const baseMin = parseTimeMinutes(hhmm);
  if (baseMin === null) return hhmm;
  const total = Math.max(0, Math.min(23 * 60 + 59, baseMin + deltaMin));
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}h${String(nm).padStart(2, '0')}`;
}

export function formatSlotTime(slot: SessionItem, y: number, m: number, d: number): {
  start: string;
  end: string;
} {
  return {
    start: lc(slot.a, y, m, d),
    end: lc(slot.b, y, m, d),
  };
}
