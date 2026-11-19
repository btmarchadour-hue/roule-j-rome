import { ValidationsMap, ValidationItem } from '../types';
import { AgendaBookingItem } from './firebaseSync';
import {
  buildReservationKey,
  getEffectiveCycle1Status,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  getValidationItemChars,
} from './cycleHelpers';
import { JS, MOIS, p2, tdy } from './tides';

export type ExportScope = 'upcoming' | 'month';

export interface ValidatedExportSlot {
  ds: string;
  dateFr: string;
  dayName: string;
  slotKey: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  startIso: string; // YYYY-MM-DDTHH:mm:00
  endIso: string; // YYYY-MM-DDTHH:mm:00
  durationMinutes: number;
  title: string;
  slotType: 'standard' | 'optionnel' | 'sur-mesure';
  primaryInstructor: string;
  secondaryInstructor?: string;
  instructorsLabel: string;
  maxCapacityChars: number;
  bookedChars: number;
  availableChars: number;
  cycle2Status: string;
  validatedAtIso: string;
}

function normalizeTimeHHMM(raw?: string): string {
  const cleaned = (raw || '').trim().replace('h', ':');
  const [hStr, mStr] = cleaned.split(':');
  const h = Math.max(0, Math.min(23, parseInt(hStr || '0', 10) || 0));
  const m = Math.max(0, Math.min(59, parseInt(mStr || '0', 10) || 0));
  return `${p2(h)}:${p2(m)}`;
}

function computeDurationMinutes(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : 60;
}

export function isSlotValidatedForBookingExport(item: ValidationItem): boolean {
  if (getEffectiveCycle1Status(item) !== 'published') return false;
  const isExplicitlyValidated =
    item.cycle1Status === 'published' || (!item.cycle1Status && item.status === 'valid');
  if (!isExplicitlyValidated) return false;
  if (item.status === 'rejected') return false;
  if (
    item.cycle2Status === 'cancelled_weather' ||
    item.cycle2Status === 'merged' ||
    item.cycle2Status === 'realized'
  ) {
    return false;
  }
  return true;
}

function getCurrentParisTimeHHMM(): string {
  try {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hh = parts.find(p => p.type === 'hour')?.value ?? '00';
    const mm = parts.find(p => p.type === 'minute')?.value ?? '00';
    return `${hh === '24' ? '00' : hh}:${mm}`;
  } catch {
    const now = new Date();
    return `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  }
}

export function collectValidatedExportSlots(params: {
  validations: ValidationsMap;
  bookingsMap: Record<string, AgendaBookingItem[]>;
  scope: ExportScope;
  year: number;
  month: number;
  onlyWithAvailability?: boolean;
}): ValidatedExportSlot[] {
  const { validations, bookingsMap, scope, year, month, onlyWithAvailability = false } = params;
  const todayStr = tdy();
  const nowParisHHMM = getCurrentParisTimeHHMM();
  const monthPrefix = `${year}-${p2(month + 1)}-`;

  const result: ValidatedExportSlot[] = [];

  for (const ds of Object.keys(validations).sort()) {
    // Règle stricte : l'export ne porte JAMAIS sur les créneaux passés
    if (ds < todayStr) continue;
    if (scope === 'month' && !ds.startsWith(monthPrefix)) continue;

    const dayRec = validations[ds];
    if (!dayRec || !Array.isArray(dayRec.items) || dayRec.items.length === 0) continue;

    const [y, m0, d] = ds.split('-').map(Number);
    const dayName = JS[new Date(Date.UTC(y, m0 - 1, d)).getUTCDay()];
    const dateFr = `${p2(d)}/${p2(m0)}/${y}`;
    const validatedAtIso = new Date(dayRec.cycle1PublishedAt || dayRec.ts || Date.now()).toISOString();

    for (const item of dayRec.items) {
      if (!isSlotValidatedForBookingExport(item)) continue;

      const startTime = normalizeTimeHHMM(item.actualStart || item.publishedStart || item.s);
      const endTime = normalizeTimeHHMM(item.actualEnd || item.publishedEnd || item.e);
      if (ds === todayStr && startTime <= nowParisHHMM) continue;
      const durationMinutes = computeDurationMinutes(startTime, endTime);

      const maxCapacityChars = getSlotMaxCapacity(item);
      const resKey = buildReservationKey(ds, item.k);
      const slotBookings = bookingsMap[resKey] || [];
      const bookingSummary = getSlotBookingsSummary(slotBookings, maxCapacityChars);
      const itemChars = getValidationItemChars(item);
      const bookedChars = Math.max(bookingSummary.totalChars, itemChars.totalChars);
      const availableChars = Math.max(0, maxCapacityChars - bookedChars);

      if (onlyWithAvailability && availableChars <= 0) continue;

      const primaryInstructor = item.instructor || item.assignedPilot || 'Jérôme';
      const secondaryInstructor = item.secondaryInstructor?.trim() || undefined;
      const instructorsLabel = secondaryInstructor
        ? `${primaryInstructor} + ${secondaryInstructor}`
        : primaryInstructor;

      const slotType: ValidatedExportSlot['slotType'] = item.k.endsWith('c')
        ? 'sur-mesure'
        : item.opt
        ? 'optionnel'
        : 'standard';

      const title = item.customTitle
        ? `Char à voile · ${item.customTitle}`
        : item.opt
        ? 'Char à voile · Séance optionnelle'
        : 'Char à voile · Séance découverte / initiation';

      result.push({
        ds,
        dateFr,
        dayName,
        slotKey: item.k,
        startTime,
        endTime,
        startIso: `${ds}T${startTime}:00`,
        endIso: `${ds}T${endTime}:00`,
        durationMinutes,
        title,
        slotType,
        primaryInstructor,
        secondaryInstructor,
        instructorsLabel,
        maxCapacityChars,
        bookedChars,
        availableChars,
        cycle2Status: item.cycle2Status || 'awaiting_booking',
        validatedAtIso,
      });
    }
  }

  result.sort((a, b) => {
    if (a.ds !== b.ds) return a.ds.localeCompare(b.ds);
    return a.startTime.localeCompare(b.startTime);
  });

  return result;
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvCell(val: unknown): string {
  const str = String(val ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildScopeSlug(scope: ExportScope, year: number, month: number): string {
  if (scope === 'month') return `${year}-${p2(month + 1)}-a-venir`;
  return 'a-venir';
}

export function getScopeLabel(scope: ExportScope, year: number, month: number): string {
  if (scope === 'month') return `À venir sur ${MOIS[month]} ${year}`;
  return 'Tous les créneaux à venir';
}

/**
 * Format 1 : CSV Français / Excel / Billetweb / RésaMinute (UTF-8 BOM, séparateur ;)
 */
export function downloadValidatedSlotsCsvFr(
  slots: ValidatedExportSlot[],
  scope: ExportScope,
  year: number,
  month: number
) {
  const headers = [
    'Date (ISO)',
    'Date (FR)',
    'Jour',
    'Heure début',
    'Heure fin',
    'Durée (min)',
    'Intitulé séance',
    'Type',
    'Capacité max (chars)',
    'Chars déjà inscrits',
    'Places dispo (chars)',
    'Moniteur(s)',
    'Statut Cycle 2',
    'Clé créneau',
  ];

  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...slots.map(s =>
      [
        s.ds,
        s.dateFr,
        s.dayName,
        s.startTime,
        s.endTime,
        s.durationMinutes,
        s.title,
        s.slotType,
        s.maxCapacityChars,
        s.bookedChars,
        s.availableChars,
        s.instructorsLabel,
        s.cycle2Status,
        s.slotKey,
      ]
        .map(escapeCsvCell)
        .join(';')
    ),
  ];

  const slug = buildScopeSlug(scope, year, month);
  triggerFileDownload(
    `creneaux-valides-jerome-${slug}-fr.csv`,
    '\ufeff' + lines.join('\r\n'),
    'text/csv;charset=utf-8;'
  );
}

/**
 * Format 2 : CSV Universel / SaaS / Google Calendar / Make / Zapier (UTF-8 sans BOM, séparateur ,)
 */
export function downloadValidatedSlotsCsvUniversal(
  slots: ValidatedExportSlot[],
  scope: ExportScope,
  year: number,
  month: number
) {
  const headers = [
    'Subject',
    'Start Date',
    'Start Time',
    'End Date',
    'End Time',
    'Start ISO',
    'End ISO',
    'Duration Min',
    'Max Capacity',
    'Booked',
    'Available',
    'Instructors',
    'Location',
    'Description',
    'Slot Key',
  ];

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...slots.map(s =>
      [
        `${s.title} (${s.availableChars}/${s.maxCapacityChars} chars dispo)`,
        s.ds,
        s.startTime,
        s.ds,
        s.endTime,
        s.startIso,
        s.endIso,
        s.durationMinutes,
        s.maxCapacityChars,
        s.bookedChars,
        s.availableChars,
        s.instructorsLabel,
        'Plage de Lestrevet, 29550 Plomodiern',
        `Moniteur(s): ${s.instructorsLabel} | Capacité: ${s.maxCapacityChars} chars | Dispo: ${s.availableChars} | Type: ${s.slotType}`,
        s.slotKey,
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];

  const slug = buildScopeSlug(scope, year, month);
  triggerFileDownload(
    `creneaux-valides-jerome-${slug}-universel.csv`,
    lines.join('\n'),
    'text/csv;charset=utf-8;'
  );
}

/**
 * Format 3 : iCalendar RFC 5545 (.ics) — Synchronisation Agenda / Booking Activities / Google & Apple Calendar
 */
export function downloadValidatedSlotsIcs(
  slots: ValidatedExportSlot[],
  scope: ExportScope,
  year: number,
  month: number
) {
  const dtStamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Char a Voile Lestrevet//Validation Cycle 1//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Char à Voile Lestrevet - Créneaux Validés',
    'X-WR-TIMEZONE:Europe/Paris',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const s of slots) {
    const dateCompact = s.ds.replace(/-/g, '');
    const startCompact = s.startTime.replace(':', '') + '00';
    const endCompact = s.endTime.replace(':', '') + '00';
    const summary = `${s.title} (${s.availableChars}/${s.maxCapacityChars} chars dispo)`;
    const description = [
      `Créneau validé par Jérôme (Cycle 1)`,
      `Moniteur(s) : ${s.instructorsLabel}`,
      `Capacité max : ${s.maxCapacityChars} chars`,
      `Déjà inscrits : ${s.bookedChars} chars`,
      `Disponibilité restante : ${s.availableChars} chars`,
      `Type : ${s.slotType}`,
      `Clé : ${s.slotKey}`,
    ].join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.ds}-${s.slotKey}@charavoilelestrevet.fr`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;TZID=Europe/Paris:${dateCompact}T${startCompact}`,
      `DTEND;TZID=Europe/Paris:${dateCompact}T${endCompact}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText('Plage de Lestrevet, 29550 Plomodiern')}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  const slug = buildScopeSlug(scope, year, month);
  triggerFileDownload(
    `creneaux-valides-jerome-${slug}.ics`,
    lines.join('\r\n'),
    'text/calendar;charset=utf-8;'
  );
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMMCompact(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${p2(h)}${p2(m)}00`;
}

function enumerateDateRange(startDs: string, endDs: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = startDs.split('-').map(Number);
  const [ey, em, ed] = endDs.split('-').map(Number);
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  while (cur <= end) {
    const dt = new Date(cur);
    out.push(`${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`);
    cur += 86400000;
  }
  return out;
}

/**
 * Format spécial futur prestataire (.ics bloqueurs complémentaires) :
 * Pour les outils de réservation utilisant des événements iCal / Google Calendar en blocage,
 * ce fichier génère les plages "Occupé / Fermé" complémentaires autour des créneaux
 * validés « À publier » par Jérôme (08h00–21h00), afin que seuls ces créneaux validés restent réservables.
 */
export function downloadValidatedSlotsProviderBlockerIcs(
  slots: ValidatedExportSlot[],
  scope: ExportScope,
  year: number,
  month: number
) {
  if (slots.length === 0) return;

  const dtStamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  const todayStr = tdy();
  const monthPrefix = `${year}-${p2(month + 1)}-`;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const monthStart = `${monthPrefix}01`;
  const rangeStart =
    scope === 'month'
      ? monthStart > todayStr
        ? monthStart
        : todayStr
      : todayStr < slots[0].ds
      ? todayStr
      : slots[0].ds;
  const rangeEnd =
    scope === 'month'
      ? `${monthPrefix}${p2(lastDayOfMonth)}`
      : slots[slots.length - 1].ds;

  const byDate = new Map<string, ValidatedExportSlot[]>();
  for (const s of slots) {
    const list = byDate.get(s.ds) || [];
    list.push(s);
    byDate.set(s.ds, list);
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Char a Voile Lestrevet//Futur Prestataire Blocker Sync//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Futur Prestataire - Blocages hors créneaux validés (Lestrevet)',
    'X-WR-TIMEZONE:Europe/Paris',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const allDates = enumerateDateRange(rangeStart, rangeEnd);
  for (const ds of allDates) {
    const daySlots = byDate.get(ds) || [];
    const intervals = daySlots
      .map(s => [hhmmToMinutes(s.startTime), hhmmToMinutes(s.endTime)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);

    const mergedOpen: [number, number][] = [];
    for (const [a, b] of intervals) {
      const last = mergedOpen[mergedOpen.length - 1];
      if (last && a <= last[1]) {
        last[1] = Math.max(last[1], b);
      } else {
        mergedOpen.push([a, b]);
      }
    }

    const dayOpenMin = Math.min(8 * 60, mergedOpen[0]?.[0] ?? 8 * 60);
    const dayCloseMin = Math.max(
      21 * 60,
      mergedOpen[mergedOpen.length - 1]?.[1] ?? 21 * 60
    );

    const blockers: [number, number][] = [];
    let cursor = dayOpenMin;
    for (const [openStart, openEnd] of mergedOpen) {
      if (openStart > cursor) {
        blockers.push([cursor, openStart]);
      }
      cursor = Math.max(cursor, openEnd);
    }
    if (cursor < dayCloseMin) {
      blockers.push([cursor, dayCloseMin]);
    }

    const dateCompact = ds.replace(/-/g, '');
    for (const [blkStart, blkEnd] of blockers) {
      if (blkEnd <= blkStart) continue;
      const startCompact = minutesToHHMMCompact(blkStart);
      const endCompact = minutesToHHMMCompact(blkEnd);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${ds}-blk-${startCompact}-${endCompact}@charavoilelestrevet.fr`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART;TZID=Europe/Paris:${dateCompact}T${startCompact}`,
        `DTEND;TZID=Europe/Paris:${dateCompact}T${endCompact}`,
        `SUMMARY:${escapeIcsText('Indisponible / Hors créneau validé (Char à voile)')}`,
        `DESCRIPTION:${escapeIcsText('Plage bloquée automatiquement pour le futur prestataire de réservation : aucun créneau validé « À publier » par Jérôme sur ce créneau.')}`,
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    }
  }

  lines.push('END:VCALENDAR');

  const slug = buildScopeSlug(scope, year, month);
  triggerFileDownload(
    `futur-prestataire-blocages-hors-valides-jerome-${slug}.ics`,
    lines.join('\r\n'),
    'text/calendar;charset=utf-8;'
  );
}

/**
 * Format 4 : JSON structuré API / Webhook ("Pont 1" vers futur prestataire / Make / n8n)
 */
export function downloadValidatedSlotsJson(
  slots: ValidatedExportSlot[],
  scope: ExportScope,
  year: number,
  month: number
) {
  const dailyMap = new Map<string, ValidatedExportSlot[]>();
  for (const s of slots) {
    const arr = dailyMap.get(s.ds) || [];
    arr.push(s);
    dailyMap.set(s.ds, arr);
  }

  const dailySchedules = Array.from(dailyMap.entries()).map(([date, daySlots]) => ({
    date,
    intervals: daySlots.map(s => ({
      from: s.startTime,
      to: s.endTime,
      startIso: s.startIso,
      endIso: s.endIso,
      durationMinutes: s.durationMinutes,
      maxCapacityChars: s.maxCapacityChars,
      bookedChars: s.bookedChars,
      availableChars: s.availableChars,
      instructors: s.secondaryInstructor
        ? [s.primaryInstructor, s.secondaryInstructor]
        : [s.primaryInstructor],
      slotKey: s.slotKey,
    })),
  }));

  const payload = {
    schemaVersion: '1.1',
    targetBookingTool: 'futur_prestataire',
    source: 'Char à Voile du Bout du Monde · Validation Cycle 1 (Jérôme)',
    timezone: 'Europe/Paris',
    location: 'Plage de Lestrevet, 29550 Plomodiern',
    exportedAt: new Date().toISOString(),
    scope,
    totalSlots: slots.length,
    totalCapacityChars: slots.reduce((acc, s) => acc + s.maxCapacityChars, 0),
    totalAvailableChars: slots.reduce((acc, s) => acc + s.availableChars, 0),
    dailySchedules,
    slots: slots.map(s => ({
      uid: `${s.ds}_${s.slotKey}`,
      date: s.ds,
      start: s.startTime,
      end: s.endTime,
      startIso: s.startIso,
      endIso: s.endIso,
      durationMinutes: s.durationMinutes,
      title: s.title,
      slotType: s.slotType,
      instructors: s.secondaryInstructor
        ? [s.primaryInstructor, s.secondaryInstructor]
        : [s.primaryInstructor],
      maxCapacityChars: s.maxCapacityChars,
      bookedChars: s.bookedChars,
      availableChars: s.availableChars,
      cycle2Status: s.cycle2Status,
      validatedAt: s.validatedAtIso,
    })),
  };

  const slug = buildScopeSlug(scope, year, month);
  triggerFileDownload(
    `futur-prestataire-creneaux-valides-jerome-${slug}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8;'
  );
}
