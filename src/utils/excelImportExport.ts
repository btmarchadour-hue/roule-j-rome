import * as XLSX from 'xlsx';
import { CancellationReason, SlotObservation } from '../types';
import { CANCELLATION_REASONS_INFO } from './statisticsEngine';

/**
 * Normalise une chaîne pour comparaison souple (minuscules, sans accents, sans espaces superflus)
 */
function cleanStr(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalise une date quelle que soit sa forme (YYYY-MM-DD, DD/MM/YYYY, Date JS, nombre série Excel)
 */
export function normalizeExcelDate(val: any): string | null {
  if (!val) return null;

  // Si c'est déjà un objet Date JS
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Si c'est un nombre série Excel (ex: 45488)
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const s = String(val).trim();

  // Format ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // Format français: DD/MM/YYYY ou DD-MM-YYYY
  const frMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (frMatch) {
    const d = frMatch[1].padStart(2, '0');
    const m = frMatch[2].padStart(2, '0');
    const y = frMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Format court: DD/MM/YY
  const frShortMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (frShortMatch) {
    const d = frShortMatch[1].padStart(2, '0');
    const m = frShortMatch[2].padStart(2, '0');
    const y = `20${frShortMatch[3]}`;
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Normalise une heure (HH:MM)
 */
export function normalizeExcelTime(val: any, defaultTime = '14:00'): string {
  if (!val) return defaultTime;

  // Si c'est un nombre décimal issu d'Excel (ex: 0.58333 pour 14:00)
  if (typeof val === 'number' && val >= 0 && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  const s = String(val).trim();
  // Format HH:MM ou H:MM ou HHhMM ou HhMM
  const match = s.match(/^(\d{1,2})[hH:](\d{2})$/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  // Format simple heure juste (ex: "14" ou "14h")
  const hourMatch = s.match(/^(\d{1,2})[hH]?$/);
  if (hourMatch) {
    return `${hourMatch[1].padStart(2, '0')}:00`;
  }

  return defaultTime;
}

/**
 * Déduit le statut à partir de la valeur textuelle
 */
export function normalizeStatus(val: any, participants?: number): 'realized' | 'cancelled' {
  const c = cleanStr(val);
  if (c === 'annule' || c === 'annulee' || c === 'non' || c === 'ko' || c === '0' || c === 'false' || c.startsWith('annul')) {
    return 'cancelled';
  }
  if (c === 'realise' || c === 'realisee' || c === 'oui' || c === 'ok' || c === '1' || c === 'true' || c.startsWith('realis')) {
    return 'realized';
  }
  // Si rien de précisé mais qu'il y a des participants notés, on déduit réalisée
  if (participants && participants > 0) {
    return 'realized';
  }
  return 'realized';
}

/**
 * Déduit le motif d'annulation
 */
export function normalizeCancellationReason(val: any): CancellationReason | undefined {
  const c = cleanStr(val);
  if (!c) return undefined;

  if (c.includes('faible') || c.includes('petole') || c.includes('insuffisant') || c.includes('low') || c.includes('pas de vent')) {
    return 'wind_low';
  }
  if (c.includes('fort') || c.includes('rafale') || c.includes('tempete') || c.includes('high') || c.includes('trop de vent') || c.includes('gros temps')) {
    return 'wind_high';
  }
  if (c.includes('dir') || c.includes('terre') || c.includes('devente') || c.includes('est') || c.includes('nord-est') || c.includes('secteur')) {
    return 'wind_dir';
  }
  if (c.includes('client') || c.includes('inscrit') || c.includes('vide') || c.includes('personne') || c.includes('reservation') || c.includes('no_client')) {
    return 'no_clients';
  }
  if (c.includes('plage') || c.includes('bache') || c.includes('caillou') || c.includes('sable mou') || c.includes('trou') || c.includes('impraticable')) {
    return 'beach_state';
  }
  if (c.includes('orage') || c.includes('submersion') || c.includes('pluie') || c.includes('foudre') || c.includes('extreme')) {
    return 'weather_extreme';
  }
  if (c.includes('moniteur') || c.includes('materiel') || c.includes('casse') || c.includes('panne') || c.includes('malade') || c.includes('instructor')) {
    return 'instructor';
  }

  return 'other';
}

/**
 * Génère et télécharge le fichier Excel modèle prêt à l'emploi pour Jérôme
 */
export function downloadExcelLogbookTemplate(): void {
  const wb = XLSX.utils.book_new();

  // Feuille 1: Modèle de saisie
  const headers = [
    'Date (AAAA-MM-JJ)',
    'Heure Début (HH:MM)',
    'Heure Fin (HH:MM)',
    'Statut (realise / annule)',
    'Motif Annulation (si annulé)',
    'Pilotes Inscrits',
    'Chars Monoplaces',
    'Chars Biplaces',
    'Moniteur',
    'Vent Moyen (nds)',
    'Rafales (nds)',
    'Direction Vent',
    'Accès Plage Réel (HH:MM)',
    'État Plage',
    'Notes & Remarques Terrain',
  ];

  const sampleRows = [
    [
      '2026-07-15',
      '14:00',
      '15:30',
      'realise',
      '',
      10,
      8,
      2,
      'Jérôme',
      16,
      22,
      'O',
      '13:50',
      'dur',
      'Excellente séance d initiation, banc de sable bien dur devant le poste',
    ],
    [
      '2026-07-16',
      '14:30',
      '16:00',
      'annule',
      'vent_faible',
      0,
      '',
      '',
      'Jérôme',
      5,
      7,
      'SO',
      '',
      '',
      'Pétole totale, impossible de faire rouler les chars',
    ],
    [
      '2026-07-17',
      '15:00',
      '16:30',
      'realise',
      '',
      12,
      10,
      2,
      'Benoît',
      18,
      25,
      'NO',
      '',
      'dur',
      'Créneau complet en plein rush estival',
    ],
    [
      '2026-07-18',
      '10:30',
      '12:00',
      'annule',
      'manque_inscrits',
      0,
      '',
      '',
      'Jérôme',
      14,
      18,
      'O',
      '',
      '',
      'Météo idéale mais aucun inscrit sur ce créneau matinal',
    ],
    [
      '2026-07-19',
      '11:00',
      '',
      'realise',
      '',
      8,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Saisie rapide carnet : 8 pilotes ont roulé (info minimale acceptée)',
    ],
  ];

  const dataAoa = [headers, ...sampleRows];
  const wsCarnet = XLSX.utils.aoa_to_sheet(dataAoa);

  // Largeurs de colonnes optimisées
  wsCarnet['!cols'] = [
    { wch: 18 }, // Date
    { wch: 20 }, // Heure début
    { wch: 18 }, // Heure fin
    { wch: 24 }, // Statut
    { wch: 28 }, // Motif annulation
    { wch: 16 }, // Inscrits
    { wch: 18 }, // Mono
    { wch: 16 }, // Bi
    { wch: 14 }, // Moniteur
    { wch: 18 }, // Vent moyen
    { wch: 15 }, // Rafales
    { wch: 16 }, // Direction
    { wch: 24 }, // Accès plage
    { wch: 16 }, // État plage
    { wch: 50 }, // Notes
  ];

  XLSX.utils.book_append_sheet(wb, wsCarnet, 'Saisie_Carnet_REX');

  // Feuille 2: Guide d'aide & Valeurs acceptées
  const guideHeaders = ['Champ', 'Obligatoire ?', 'Valeurs acceptées / Format', 'Description & Exemples'];
  const guideRows = [
    [
      'Date (AAAA-MM-JJ)',
      'OUI',
      '2026-07-15 ou 15/07/2026',
      'La date de la séance (formats ISO ou français acceptés).',
    ],
    [
      'Heure Début (HH:MM)',
      'Recommandé',
      '14:00, 14h00, 14',
      'Heure de départ de la séance. Si vide, sera défini par défaut à 14:00.',
    ],
    [
      'Heure Fin (HH:MM)',
      'Facultatif',
      '15:30, 15h30',
      'Heure de fin du créneau (généralement 1h à 1h30 après).',
    ],
    [
      'Statut',
      'OUI',
      'realise OU annule',
      'Précise si la séance a eu lieu. Mots équivalents tolérés : oui/non, fait, ok, etc.',
    ],
    [
      'Motif Annulation',
      'Si annulé',
      'vent_faible | vent_fort | mauvais_secteur | manque_inscrits | etat_plage | meteo_extreme | moniteur_materiel | autre',
      'Cause principale. Ex: "vent_faible", "pétole", "manque d inscrits", "bâches", etc.',
    ],
    [
      'Pilotes Inscrits',
      'Facultatif',
      'Nombre entier (ex: 8, 12)',
      'Nombre de pratiquants sur la séance. Utilisé pour le calcul du taux de remplissage.',
    ],
    [
      'Chars Monoplaces / Biplaces',
      'Facultatif',
      'Nombres entiers (ex: 6 / 2)',
      'Répartition de la flotte mobilisée pour les statistiques du parc.',
    ],
    [
      'Moniteur',
      'Facultatif',
      'Jérôme ou Benoît',
      'Moniteur ayant encadré ou prévu la séance.',
    ],
    [
      'Vent / Rafales / Direction',
      'Facultatif',
      '15, 22, O, SO, ONO...',
      'Conditions réelles observées sur la plage pendant le roulage.',
    ],
    [
      'Accès Plage Réel',
      'Facultatif',
      '13:50',
      'Heure où le sable a été accessible à sec (étalonnage de surcote).',
    ],
    [
      'État Plage',
      'Facultatif',
      'dur | mou | baches_faibles | baches_fortes',
      'Consistance du sable de Lestrevet.',
    ],
    [
      'TOLÉRANCE DONNÉES INCOMPLÈTES',
      'IMPORTANT',
      'Toutes les colonnes facultatives peuvent être laissées vides !',
      'Même si Jérôme ne note que la date et si la séance a eu lieu (ou juste le nombre de pilotes), l outil l intégrera sans erreur.',
    ],
  ];

  const wsGuide = XLSX.utils.aoa_to_sheet([guideHeaders, ...guideRows]);
  wsGuide['!cols'] = [
    { wch: 25 },
    { wch: 16 },
    { wch: 35 },
    { wch: 70 },
  ];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Guide_Valeurs');

  // Téléchargement immédiat
  XLSX.writeFile(wb, 'modele_import_carnet_lestrevet.xlsx');
}

export interface ParsedLogbookRow {
  rowNumber: number;
  raw: Record<string, any>;
  observation?: SlotObservation;
  isValid: boolean;
  isPartial: boolean;
  warnings: string[];
  error?: string;
}

export interface ImportResult {
  totalRows: number;
  validCount: number;
  partialCount: number;
  errorCount: number;
  items: ParsedLogbookRow[];
}

/**
 * Analyse et parse un fichier de carnet (Excel .xlsx / .xls ou .csv)
 */
export async function parseLogbookFile(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Le classeur ne contient aucune feuille de données.');
  }

  const ws = wb.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('Le fichier sélectionné est vide.');
  }

  const items: ParsedLogbookRow[] = [];
  let validCount = 0;
  let partialCount = 0;
  let errorCount = 0;

  // Création des observations pour chaque ligne
  rawRows.forEach((row, idx) => {
    const rowNumber = idx + 2; // +1 pour header, +1 pour index 0
    const warnings: string[] = [];

    // Recherche souple des clés de colonnes
    const findValue = (possibleNames: string[]): any => {
      for (const [key, val] of Object.entries(row)) {
        const cleanKey = cleanStr(key);
        for (const candidate of possibleNames) {
          if (cleanKey.includes(candidate)) {
            return val;
          }
        }
      }
      return undefined;
    };

    const rawDate = findValue(['date', 'jour', 'date_seance']);
    const ds = normalizeExcelDate(rawDate);

    if (!ds) {
      errorCount++;
      items.push({
        rowNumber,
        raw: row,
        isValid: false,
        isPartial: false,
        warnings: [],
        error: `Date introuvable ou invalide : "${rawDate || ''}". Format attendu: AAAA-MM-JJ ou JJ/MM/AAAA.`,
      });
      return;
    }

    // Heure début et fin
    const rawStart = findValue(['debut', 'start', 'heure_debut', 'creneau', 'horaire', 'heure']);
    const slotStart = normalizeExcelTime(rawStart, '14:00');

    const rawEnd = findValue(['fin', 'end', 'heure_fin']);
    let slotEnd = normalizeExcelTime(rawEnd, '');
    if (!slotEnd) {
      // Déduire 1h30 après par défaut
      const [sh, sm] = slotStart.split(':').map(Number);
      const endTotal = sh * 60 + sm + 90;
      const eh = Math.floor(endTotal / 60) % 24;
      const em = endTotal % 60;
      slotEnd = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      warnings.push(`Heure de fin déduite automatiquement (+1h30) : ${slotEnd}`);
    }

    // Participants & flotte
    const rawPax = findValue(['inscrit', 'pilote', 'pax', 'participant', 'nb_personnes']);
    const participantsCount = rawPax !== '' && !isNaN(Number(rawPax)) ? Number(rawPax) : undefined;

    const rawMono = findValue(['mono', 'monoplace', 'chars_mono']);
    const monoCount = rawMono !== '' && !isNaN(Number(rawMono)) ? Number(rawMono) : undefined;

    const rawBi = findValue(['bi', 'biplace', 'chars_bi']);
    const biCount = rawBi !== '' && !isNaN(Number(rawBi)) ? Number(rawBi) : undefined;

    // Statut
    const rawStatus = findValue(['statut', 'status', 'etat', 'realise', 'deroulement']);
    const status = normalizeStatus(rawStatus, participantsCount);

    // Motif annulation si annulé
    const rawReason = findValue(['motif', 'cause', 'annulation', 'pourquoi', 'raison']);
    const cancellationReason = status === 'cancelled' ? normalizeCancellationReason(rawReason) || 'other' : undefined;

    if (status === 'cancelled' && !rawReason) {
      warnings.push('Séance annulée sans motif renseigné (classée par défaut dans "Autre motif").');
    }

    // Moniteur
    const rawAuthor = findValue(['moniteur', 'auteur', 'responsable', 'instructeur', 'encadrant']);
    const author = rawAuthor ? String(rawAuthor).trim() : 'Jérôme';

    // Météo réelle
    const rawWind = findValue(['vent_moyen', 'vent', 'vitesse_vent', 'nds', 'noeuds']);
    const observedWindKts = rawWind !== '' && !isNaN(Number(rawWind)) ? Number(rawWind) : undefined;

    const rawGust = findValue(['rafale', 'rafales', 'gust']);
    const observedGustKts = rawGust !== '' && !isNaN(Number(rawGust)) ? Number(rawGust) : undefined;

    const rawDir = findValue(['direction', 'secteur', 'orient']);
    const observedWindDir = rawDir ? String(rawDir).trim().toUpperCase() : undefined;

    // Accès plage
    const rawActualPass = findValue(['acces', 'sec', 'passable', 'heure_acces']);
    const actualPassableTime = rawActualPass ? normalizeExcelTime(rawActualPass, '') : undefined;

    // État plage
    const rawBeach = findValue(['etat_plage', 'sable', 'plage']);
    let beachCondition: SlotObservation['beachCondition'] = undefined;
    if (rawBeach) {
      const cBeach = cleanStr(rawBeach);
      if (cBeach.includes('mou')) beachCondition = 'mou';
      else if (cBeach.includes('dur')) beachCondition = 'dur';
      else if (cBeach.includes('fort')) beachCondition = 'baches_fortes';
      else if (cBeach.includes('bache')) beachCondition = 'baches_faibles';
    }

    // Notes
    const rawNotes = findValue(['note', 'remarque', 'commentaire', 'obs']);
    const notes = rawNotes ? String(rawNotes).trim() : undefined;

    // Détection de complétude
    let isPartial = false;
    if (status === 'realized') {
      if (participantsCount === undefined) {
        warnings.push('Nombre de pilotes non renseigné (créneau comptabilisé comme réalisé sans affecter la jauge).');
        isPartial = true;
      }
      if (observedWindKts === undefined) {
        isPartial = true;
      }
    }

    // Clé de créneau déterministe
    const slotKey = `slot-${slotStart.replace(':', '')}`;
    const id = `obs-${ds}-${slotKey}`;

    const observation: SlotObservation = {
      id,
      ds,
      slotKey,
      slotStart,
      slotEnd,
      isCustom: true,
      customTitle: 'Séance Carnet REX',
      status,
      cancellationReason,
      cancellationNote: status === 'cancelled' && rawReason ? String(rawReason).trim() : undefined,
      participantsCount,
      monoCount,
      biCount,
      author,
      observedWindKts,
      observedGustKts,
      observedWindDir,
      actualPassableTime,
      beachCondition,
      notes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    validCount++;
    if (isPartial) partialCount++;

    items.push({
      rowNumber,
      raw: row,
      observation,
      isValid: true,
      isPartial,
      warnings,
    });
  });

  return {
    totalRows: rawRows.length,
    validCount,
    partialCount,
    errorCount,
    items,
  };
}
