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
  'Vacances / Congés',
  'Formation / Stage',
  'Entretien / Maintenance matériel',
  'Indisponibilité personnelle',
  'Événement / Compétition',
] as const;

export type Cycle1SlotAction = 'publish' | 'not_published' | 'close_no_bookings' | 'reset';

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
      type: 'reset_to_cycle1';
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

export function getSlotBookingsSummary(bookings: AgendaBookingItem[] = []): SlotBookingCounts {
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
    isOverCapacity: totalChars > MAX_CHARS_PER_INSTRUCTOR,
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
  const lower = reason.toLowerCase();
  return (
    lower.includes('inscr') ||
    lower.includes('client') ||
    lower.includes('réserv') ||
    lower.includes('reserv') ||
    lower.includes('vie 1') ||
    lower.includes('aucun')
  );
}

export function isNotPublishedCycle1(item?: ValidationItem): boolean {
  if (!item) return false;
  if (item.cycle1Status === 'not_published' || Boolean(item.nonPublishReason)) return true;
  const r = (item.rejectReason || '').toLowerCase();
  return r.includes('non publié') || r.includes('non publie');
}

/**
 * Statut effectif en Cycle 1 (Publication commerciale jour par jour)
 */
export function getEffectiveCycle1Status(
  item?: ValidationItem
): 'unpublished' | 'published' | 'not_published' | 'closed_no_bookings' {
  if (!item) return 'unpublished';
  if (isNotPublishedCycle1(item)) return 'not_published';
  if (item.cycle1Status === 'closed_no_bookings') return 'closed_no_bookings';
  if (item.status === 'rejected' && isNoBookingsReason(item.rejectReason)) {
    return 'closed_no_bookings';
  }
  return 'published';
}

/**
 * Détermine si le créneau a franchi le seuil d'entrée en Cycle 2 ("dès la première inscription")
 */
export function hasCycle2Trigger(
  item?: ValidationItem,
  bookingChars = 0,
  obs?: SlotObservation | null
): boolean {
  if (bookingChars > 0) return true;
  if (obs) return true;
  if (!item) return false;
  if (isNotPublishedCycle1(item)) return false;
  if (
    item.cycle2Status &&
    item.cycle2Status !== 'awaiting_booking'
  ) {
    return true;
  }
  const itemChars = getValidationItemChars(item).totalChars;
  if (itemChars > 0) return true;
  if (item.status === 'rejected' && !isNoBookingsReason(item.rejectReason)) {
    // Annulé météo / aléa avec historique
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
  if (isNotPublishedCycle1(item)) {
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

  let found = items.find(it => it.k === slotKey);
  if (!found) {
    found = items.find(
      it =>
        (it.publishedStart === startTimeStr && it.publishedEnd === endTimeStr) ||
        (it.s === startTimeStr && it.e === endTimeStr)
    );
  }
  if (!found) {
    found = items.find(it => it.publishedStart === startTimeStr || it.s === startTimeStr);
  }
  if (!found) {
    const [sh, sm] = startTimeStr.replace('h', ':').split(':').map(Number);
    const slotMin = sh * 60 + sm;
    let closest: ValidationItem | undefined;
    let minDiff = 45;
    for (const item of items) {
      const refTime = item.publishedStart || item.s;
      if (!refTime || usedKeys?.has(item.k)) continue;
      const [ih, im] = refTime.replace('h', ':').split(':').map(Number);
      const diff = Math.abs(slotMin - (ih * 60 + im));
      if (diff <= minDiff) {
        minDiff = diff;
        closest = item;
      }
    }
    found = closest;
  }
  return found;
}

/**
 * Calcule un horaire décalé en minutes ("09:30" + 30 => "10:00")
 */
export function shiftTimeString(hhmm: string, deltaMin: number): string {
  const clean = hhmm.replace('h', ':');
  const [h, m] = clean.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const total = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + deltaMin));
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
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
