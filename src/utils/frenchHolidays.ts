/**
 * French School Holidays & Public Holidays Helper
 * Covers 2026, 2027, 2028 school years
 * Spot location: Plage de Lestrevet, Plomodiern, Finistère (Académie de Rennes -> Zone B)
 */

export interface HolidayInfo {
  isHoliday: boolean;
  holidayName?: string;
  periodName?: string;
  zones: ('A' | 'B' | 'C')[];
  isZoneB: boolean; // Académie de Rennes (Bretagne / Finistère)
  isZoneA: boolean;
  isZoneC: boolean;
  publicHolidayName?: string;
  weekNumber: number;
  label: string;
  shortLabel: string;
}

interface HolidayPeriod {
  name: string;
  zone: 'A' | 'B' | 'C' | 'ALL';
  start: string; // YYYY-MM-DD (inclusive)
  end: string;   // YYYY-MM-DD (inclusive)
}

const HOLIDAY_PERIODS: HolidayPeriod[] = [
  // 2026
  { name: 'Vacances de la Toussaint', zone: 'ALL', start: '2026-10-17', end: '2026-11-02' },
  { name: 'Vacances de Noël', zone: 'ALL', start: '2026-12-19', end: '2027-01-04' },

  // 2027 - Hiver
  { name: "Vacances d'Hiver", zone: 'A', start: '2027-02-06', end: '2027-02-22' },
  { name: "Vacances d'Hiver", zone: 'B', start: '2027-02-13', end: '2027-03-01' },
  { name: "Vacances d'Hiver", zone: 'C', start: '2027-02-20', end: '2027-03-08' },

  // 2027 - Printemps
  { name: 'Vacances de Printemps', zone: 'A', start: '2027-04-03', end: '2027-04-19' },
  { name: 'Vacances de Printemps', zone: 'B', start: '2027-04-10', end: '2027-04-26' },
  { name: 'Vacances de Printemps', zone: 'C', start: '2027-04-17', end: '2027-05-03' },

  // 2027 - Ascension & Été
  { name: "Pont de l'Ascension", zone: 'ALL', start: '2027-05-06', end: '2027-05-09' },
  { name: "Vacances d'Été", zone: 'ALL', start: '2027-07-03', end: '2027-09-01' },

  // 2027 - Toussaint & Noël
  { name: 'Vacances de la Toussaint', zone: 'ALL', start: '2027-10-23', end: '2027-11-08' },
  { name: 'Vacances de Noël', zone: 'ALL', start: '2027-12-18', end: '2028-01-03' },

  // 2028 - Hiver
  { name: "Vacances d'Hiver", zone: 'A', start: '2028-02-12', end: '2028-02-28' },
  { name: "Vacances d'Hiver", zone: 'B', start: '2028-02-19', end: '2028-03-06' },
  { name: "Vacances d'Hiver", zone: 'C', start: '2028-02-26', end: '2028-03-13' },

  // 2028 - Printemps
  { name: 'Vacances de Printemps', zone: 'A', start: '2028-04-08', end: '2028-04-24' },
  { name: 'Vacances de Printemps', zone: 'B', start: '2028-04-15', end: '2028-05-02' },
  { name: 'Vacances de Printemps', zone: 'C', start: '2028-04-22', end: '2028-05-09' },

  // 2028 - Été
  { name: "Vacances d'Été", zone: 'ALL', start: '2028-07-01', end: '2028-09-02' },
];

const PUBLIC_HOLIDAYS: Record<string, string> = {
  // 2026
  '2026-11-01': 'Toussaint',
  '2026-11-11': 'Armistice 1918',
  '2026-12-25': 'Noël',

  // 2027
  '2027-01-01': "Jour de l'An",
  '2027-03-29': 'Lundi de Pâques',
  '2027-05-01': 'Fête du Travail',
  '2027-05-06': 'Ascension',
  '2027-05-08': 'Victoire 1945',
  '2027-05-17': 'Lundi de Pentecôte',
  '2027-07-14': 'Fête Nationale',
  '2027-08-15': 'Assomption',
  '2027-11-01': 'Toussaint',
  '2027-11-11': 'Armistice 1918',
  '2027-12-25': 'Noël',

  // 2028
  '2028-01-01': "Jour de l'An",
  '2028-04-17': 'Lundi de Pâques',
  '2028-05-01': 'Fête du Travail',
  '2028-05-08': 'Victoire 1945',
  '2028-05-25': 'Ascension',
  '2028-06-05': 'Lundi de Pentecôte',
  '2028-07-14': 'Fête Nationale',
  '2028-08-15': 'Assomption',
  '2028-11-01': 'Toussaint',
  '2028-11-11': 'Armistice 1918',
  '2028-12-25': 'Noël',
};

/**
 * Calculates ISO week number (1-53) for a given date
 */
export function getISOWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
}

/**
 * Returns holiday and calendar info for a date string YYYY-MM-DD
 */
export function getFrenchHolidayInfo(dateStr: string): HolidayInfo {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const weekNumber = getISOWeekNumber(dateObj);
  const publicHolidayName = PUBLIC_HOLIDAYS[dateStr];

  const matching = HOLIDAY_PERIODS.filter(p => dateStr >= p.start && dateStr <= p.end);

  if (matching.length === 0) {
    return {
      isHoliday: false,
      zones: [],
      isZoneB: false,
      isZoneA: false,
      isZoneC: false,
      publicHolidayName,
      weekNumber,
      label: publicHolidayName ? `Férié : ${publicHolidayName} · Période scolaire` : 'Période scolaire',
      shortLabel: publicHolidayName ? `Férié ${publicHolidayName}` : 'Scolaire',
    };
  }

  const holidayName = matching[0].name;
  const isAll = matching.some(m => m.zone === 'ALL');

  const isZoneA = isAll || matching.some(m => m.zone === 'A');
  const isZoneB = isAll || matching.some(m => m.zone === 'B');
  const isZoneC = isAll || matching.some(m => m.zone === 'C');

  const zones: ('A' | 'B' | 'C')[] = [];
  if (isZoneA) zones.push('A');
  if (isZoneB) zones.push('B');
  if (isZoneC) zones.push('C');

  let label = `${holidayName} (${zones.length === 3 ? 'Toutes zones A, B, C' : `Zone ${zones.join(', ')}`})`;
  if (publicHolidayName) {
    label += ` · Férié : ${publicHolidayName}`;
  }

  return {
    isHoliday: true,
    holidayName,
    periodName: holidayName,
    zones,
    isZoneB,
    isZoneA,
    isZoneC,
    publicHolidayName,
    weekNumber,
    label,
    shortLabel: holidayName.replace('Vacances de la ', '').replace('Vacances de ', '').replace("Vacances d'", ''),
  };
}
