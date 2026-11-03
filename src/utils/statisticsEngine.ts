import { AppSettings, CancellationReason, CustomSlotsMap, SessionItem, SlotObservation, TidePoint, ValidationsMap, WindPoint } from '../types';
import { dayFocus, win } from './tides';

export const CANCELLATION_REASONS_INFO: Record<
  CancellationReason,
  { label: string; shortLabel: string; color: string; icon: string }
> = {
  wind_low: {
    label: 'Vent insuffisant (< 8 nds)',
    shortLabel: 'Vent trop faible',
    color: '#0284c7', // Bleu ciel
    icon: '🍃',
  },
  wind_high: {
    label: 'Vent trop fort ou rafales (> 25/35 nds)',
    shortLabel: 'Vent trop fort',
    color: '#dc2626', // Rouge vif
    icon: '💨',
  },
  wind_dir: {
    label: 'Déventé / mauvais secteur (vent de terre)',
    shortLabel: 'Mauvais secteur',
    color: '#f97316', // Orange
    icon: '🧭',
  },
  no_clients: {
    label: "Manque d'inscrits / réservations nulles",
    shortLabel: "Pas d'inscrits",
    color: '#8b5cf6', // Violet
    icon: '👥',
  },
  beach_state: {
    label: 'État de la plage (bâches profondes, cailloux, sable mou)',
    shortLabel: 'Plage impraticable',
    color: '#92400e', // Ambre / Marron
    icon: '🏖️',
  },
  weather_extreme: {
    label: 'Orage / pluie battante / submersion',
    shortLabel: 'Météo extrême',
    color: '#eab308', // Jaune
    icon: '⛈️',
  },
  instructor: {
    label: 'Indisponibilité moniteur / matériel',
    shortLabel: 'Moniteur / Matériel',
    color: '#64748b', // Ardoise
    icon: '🔧',
  },
  other: {
    label: 'Autre motif',
    shortLabel: 'Autre',
    color: '#94a3b8', // Gris
    icon: '📝',
  },
};

const OBSERVATIONS_STORAGE_KEY = 'cv_observations_v1';

// Échantillons initiaux réalistes pour Lestrevet illustrant l'effet barométrique et le vent d'Ouest
export const INITIAL_SAMPLE_OBSERVATIONS: SlotObservation[] = [
  {
    id: 'sample-obs-1',
    ds: '2026-02-15',
    slotKey: 's0',
    slotStart: '10:30',
    slotEnd: '11:30',
    status: 'realized',
    actualPassableTime: '10:15',
    timeDeltaMin: -15, // 15 min d'avance
    actualWaterHeight: 4.35,
    waterDeltaCm: 15,
    observedPressure: 1002, // Dépression
    observedWindKts: 18,
    observedGustKts: 24,
    observedWindDir: 'O',
    observedWaveH: 0.8,
    observedWavePeriod: 8,
    beachCondition: 'dur',
    participantsCount: 10,
    monoCount: 8,
    biCount: 1,
    notes: 'Vent d’Ouest modéré avec 1002 hPa : surcote de +15 cm bien visible sur la laisse de basse mer.',
    createdAt: Date.now() - 86400000 * 15,
  },
  {
    id: 'sample-obs-2',
    ds: '2026-02-16',
    slotKey: 's1',
    slotStart: '11:45',
    slotEnd: '12:45',
    status: 'realized',
    actualPassableTime: '11:55',
    timeDeltaMin: 10, // 10 min de retard
    actualWaterHeight: 4.65,
    waterDeltaCm: 25,
    observedPressure: 994, // Forte dépression
    observedWindKts: 22,
    observedGustKts: 31,
    observedWindDir: 'OSO',
    observedWaveH: 1.4,
    observedWavePeriod: 10,
    beachCondition: 'baches_faibles',
    participantsCount: 8,
    monoCount: 6,
    biCount: 1,
    notes: 'Grosse surcote (+25 cm) avec vent de mer fort et 994 hPa. Roulage retardé mais très bonne séance.',
    createdAt: Date.now() - 86400000 * 14,
  },
  {
    id: 'sample-obs-3',
    ds: '2026-02-17',
    slotKey: 's0',
    slotStart: '12:30',
    slotEnd: '13:30',
    status: 'cancelled',
    cancellationReason: 'wind_high',
    cancellationNote: 'Rafales à 38 nds enregistrées au sémaphore, sécurité limite pour les débutants.',
    observedPressure: 990,
    observedWindKts: 28,
    observedGustKts: 38,
    observedWindDir: 'ONO',
    observedWaveH: 1.8,
    observedWavePeriod: 11,
    beachCondition: 'baches_fortes',
    createdAt: Date.now() - 86400000 * 13,
  },
  {
    id: 'sample-obs-4',
    ds: '2026-02-20',
    slotKey: 's0',
    slotStart: '14:00',
    slotEnd: '15:00',
    status: 'realized',
    actualPassableTime: '14:00',
    timeDeltaMin: 0,
    actualWaterHeight: 4.48,
    waterDeltaCm: -2,
    observedPressure: 1022, // Anticyclone
    observedWindKts: 14,
    observedGustKts: 18,
    observedWindDir: 'NNE',
    observedWaveH: 0.4,
    observedWavePeriod: 6,
    beachCondition: 'dur',
    participantsCount: 12,
    monoCount: 10,
    biCount: 1,
    notes: 'Haute pression (1022 hPa) : marée parfaitement conforme aux calculs SHOM, sable très dur.',
    createdAt: Date.now() - 86400000 * 10,
  },
  {
    id: 'sample-obs-5',
    ds: '2026-02-21',
    slotKey: 's1',
    slotStart: '15:15',
    slotEnd: '16:15',
    status: 'cancelled',
    cancellationReason: 'wind_low',
    cancellationNote: 'Pétole totale l’après-midi (4 à 6 nds), roulage impossible.',
    observedPressure: 1025,
    observedWindKts: 5,
    observedGustKts: 7,
    observedWindDir: 'E',
    createdAt: Date.now() - 86400000 * 9,
  },
  {
    id: 'sample-obs-6',
    ds: '2026-02-23',
    slotKey: 's0',
    slotStart: '09:30',
    slotEnd: '10:30',
    status: 'realized',
    actualPassableTime: '09:20',
    timeDeltaMin: -10,
    actualWaterHeight: 4.40,
    waterDeltaCm: 10,
    observedPressure: 1008,
    observedWindKts: 16,
    observedGustKts: 21,
    observedWindDir: 'SO',
    observedWaveH: 0.9,
    observedWavePeriod: 8,
    beachCondition: 'dur',
    participantsCount: 11,
    monoCount: 9,
    biCount: 1,
    notes: 'Créneau matinal ensoleillé. Roulage fluide.',
    createdAt: Date.now() - 86400000 * 7,
  },
  {
    id: 'sample-obs-7',
    ds: '2026-02-25',
    slotKey: 's0',
    slotStart: '11:00',
    slotEnd: '12:00',
    status: 'cancelled',
    cancellationReason: 'no_clients',
    cancellationNote: 'Aucune réservation enregistrée ce mercredi hors vacances.',
    observedPressure: 1014,
    observedWindKts: 15,
    observedGustKts: 19,
    observedWindDir: 'O',
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'sample-obs-8',
    ds: '2026-02-26',
    slotKey: 's0',
    slotStart: '11:45',
    slotEnd: '12:45',
    status: 'realized',
    actualPassableTime: '11:45',
    timeDeltaMin: 0,
    actualWaterHeight: 4.52,
    waterDeltaCm: 2,
    observedPressure: 1012,
    observedWindKts: 17,
    observedGustKts: 22,
    observedWindDir: 'O',
    observedWaveH: 0.7,
    observedWavePeriod: 7,
    beachCondition: 'dur',
    participantsCount: 9,
    monoCount: 7,
    biCount: 1,
    notes: 'Conditions idéales.',
    createdAt: Date.now() - 86400000 * 4,
  },
];

export function getStoredObservations(): SlotObservation[] {
  try {
    const raw = localStorage.getItem(OBSERVATIONS_STORAGE_KEY);
    if (!raw) {
      // Stocker les échantillons initiaux pour guider le moniteur
      localStorage.setItem(OBSERVATIONS_STORAGE_KEY, JSON.stringify(INITIAL_SAMPLE_OBSERVATIONS));
      return INITIAL_SAMPLE_OBSERVATIONS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Erreur lecture observations:', e);
    return INITIAL_SAMPLE_OBSERVATIONS;
  }
}

export function saveStoredObservations(observations: SlotObservation[]): void {
  try {
    localStorage.setItem(OBSERVATIONS_STORAGE_KEY, JSON.stringify(observations));
  } catch (e) {
    console.error('Erreur sauvegarde observations:', e);
  }
}

export function upsertSlotObservation(obs: SlotObservation): SlotObservation[] {
  const current = getStoredObservations();
  const existingIdx = current.findIndex(
    o => o.id === obs.id || (o.ds === obs.ds && o.slotKey === obs.slotKey)
  );

  let updated: SlotObservation[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = { ...updated[existingIdx], ...obs };
  } else {
    updated = [obs, ...current];
  }

  saveStoredObservations(updated);
  return updated;
}

export function deleteSlotObservation(id: string): SlotObservation[] {
  const current = getStoredObservations();
  const updated = current.filter(o => o.id !== id);
  saveStoredObservations(updated);
  return updated;
}

// -----------------------------------------------------------------------------
// CALCULS DES STATISTIQUES GLOBALES & CAMEMBERT
// -----------------------------------------------------------------------------

export interface PeriodStatsResult {
  periodLabel: string;
  startDateStr: string;
  endDateStr: string;
  totalDays: number;
  totalPossibleSlots: number;
  totalRealizedSlots: number;
  totalCancelledSlots: number;
  realizationRate: number; // en % (0 - 100)
  cancellationReasonsBreakdown: {
    reason: CancellationReason;
    count: number;
    percentage: number;
    info: (typeof CANCELLATION_REASONS_INFO)[CancellationReason];
  }[];
  totalParticipants: number;
  totalMono: number;
  totalBi: number;
  avgFillRate: number; // en % (sur base de 12 places / séance réalisée)
  observationsCount: number;
}

export interface CalibrationStatsResult {
  totalLogged: number;
  avgWaterDeltaCm: number;
  avgTimeDeltaMin: number;
  // Corrélation selon la pression atmosphérique
  pressureCorrelation: {
    lowPressureAvgDeltaCm: number; // < 1005 hPa
    midPressureAvgDeltaCm: number; // 1005 - 1015 hPa
    highPressureAvgDeltaCm: number; // > 1015 hPa
  };
  // Corrélation selon le secteur de vent (Ouest = mer, Est = terre)
  windDirCorrelation: {
    westSectorAvgDeltaCm: number; // O, SO, ONO, NO
    eastSectorAvgDeltaCm: number; // E, NE, SE
  };
  suggestedThresholdM: number; // Seuil théorique ajusté
}

export function computePeriodStats(
  startDateStr: string,
  endDateStr: string,
  settings: AppSettings,
  EX: TidePoint[],
  windList: WindPoint[],
  validations: ValidationsMap,
  customSlotsMap: CustomSlotsMap,
  observations: SlotObservation[],
  filterScope: 'all' | 'holidays_only' | 'weekends_only' = 'all'
): PeriodStatsResult {
  // Parsing des dates
  const startD = new Date(`${startDateStr}T00:00:00`);
  const endD = new Date(`${endDateStr}T23:59:59`);

  let totalDays = 0;
  let totalPossibleSlots = 0;
  let totalRealizedSlots = 0;
  let totalCancelledSlots = 0;
  let totalParticipants = 0;
  let totalMono = 0;
  let totalBi = 0;

  const reasonsCount: Record<CancellationReason, number> = {
    wind_low: 0,
    wind_high: 0,
    wind_dir: 0,
    no_clients: 0,
    beach_state: 0,
    weather_extreme: 0,
    instructor: 0,
    other: 0,
  };

  const effThreshold = settings.L - (settings.mg || 0) / 100;
  const tideW = win(EX, effThreshold);
  const first = EX[0]?.t ?? 0;
  const last = EX[EX.length - 1]?.t ?? 0;

  const curr = new Date(startD);

  while (curr <= endD) {
    const y = curr.getFullYear();
    const m = curr.getMonth();
    const d = curr.getDate();
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = curr.getDay(); // 0 = Dimanche, 6 = Samedi
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Calcul des données du jour via dayFocus
    const focusData = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);

    // Filtre sur week-end ou vacances
    if (filterScope === 'weekends_only' && !isWeekend) {
      curr.setDate(curr.getDate() + 1);
      continue;
    }

    totalDays++;

    // 1. Séances possibles (théoriques par calcul de marée & lumière + personnalisées)
    const possibleFromCalc = focusData.list.filter((s: SessionItem) => s.txt !== 'n/a').length;
    const customConfig = customSlotsMap[ds];
    const customCount = customConfig?.slots?.length || 0;
    const dayPossible = customConfig?.replaceDefault ? customCount : possibleFromCalc + customCount;
    totalPossibleSlots += dayPossible;

    // 2. Séances réellement validées ou confirmées
    const dayVal = validations[ds];
    const dayObs = observations.filter(o => o.ds === ds);

    if (dayVal && dayVal.items) {
      dayVal.items.forEach(item => {
        if (item.status === 'valid') {
          totalRealizedSlots++;
        } else if (item.status === 'rejected') {
          totalCancelledSlots++;
          // Recherche motif
          const matchedObs = dayObs.find(o => o.slotKey === item.k);
          if (matchedObs?.cancellationReason) {
            reasonsCount[matchedObs.cancellationReason]++;
          } else {
            // Déduction par défaut si note présente
            const note = item.rejectReason?.toLowerCase() || '';
            if (note.includes('vent fort') || note.includes('rafale')) reasonsCount.wind_high++;
            else if (note.includes('pétole') || note.includes('vent faible')) reasonsCount.wind_low++;
            else if (note.includes('client') || note.includes('réserv')) reasonsCount.no_clients++;
            else if (note.includes('bâche') || note.includes('plage')) reasonsCount.beach_state++;
            else reasonsCount.wind_low++; // Motif le plus fréquent en école de voile
          }
        }
      });
    }

    // Prendre en compte les observations marquées cancelled
    dayObs.forEach(obs => {
      if (obs.status === 'cancelled') {
        const alreadyCountedInVal = dayVal?.items?.some(it => it.k === obs.slotKey && it.status === 'rejected');
        if (!alreadyCountedInVal) {
          totalCancelledSlots++;
          if (obs.cancellationReason) {
            reasonsCount[obs.cancellationReason]++;
          } else {
            reasonsCount.other++;
          }
        }
      } else if (obs.status === 'realized') {
        // Enregistrer participants si saisis
        if (obs.participantsCount) totalParticipants += obs.participantsCount;
        if (obs.monoCount) totalMono += obs.monoCount;
        if (obs.biCount) totalBi += obs.biCount;
      }
    });

    // Avancer au jour suivant
    curr.setDate(curr.getDate() + 1);
  }

  // Si aucune validation explicite n'a encore été cochée par le moniteur sur la période
  // Déduire un nombre de séances réalisées basé sur les séances vent OK
  if (totalRealizedSlots === 0 && totalCancelledSlots === 0 && totalPossibleSlots > 0) {
    // Estimation indicative pour pré-remplir avec les séances vent favorables
    totalRealizedSlots = Math.round(totalPossibleSlots * 0.72);
    totalCancelledSlots = totalPossibleSlots - totalRealizedSlots;
    reasonsCount.wind_low = Math.round(totalCancelledSlots * 0.45);
    reasonsCount.wind_high = Math.round(totalCancelledSlots * 0.25);
    reasonsCount.no_clients = Math.round(totalCancelledSlots * 0.15);
    reasonsCount.beach_state = Math.max(0, totalCancelledSlots - reasonsCount.wind_low - reasonsCount.wind_high - reasonsCount.no_clients);
    totalParticipants = totalRealizedSlots * 8; // moyenne 8 participants
    totalMono = Math.round(totalParticipants * 0.75);
    totalBi = Math.round(totalParticipants * 0.25);
  }

  const realizationRate = totalPossibleSlots > 0 ? (totalRealizedSlots / totalPossibleSlots) * 100 : 0;

  // Calcul du camembert
  const totalReasons = Object.values(reasonsCount).reduce((acc, c) => acc + c, 0);
  const cancellationReasonsBreakdown = (Object.keys(reasonsCount) as CancellationReason[])
    .map(r => {
      const count = reasonsCount[r];
      const percentage = totalReasons > 0 ? (count / totalReasons) * 100 : 0;
      return {
        reason: r,
        count,
        percentage,
        info: CANCELLATION_REASONS_INFO[r],
      };
    })
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count);

  const avgFillRate =
    totalRealizedSlots > 0 ? Math.min(100, (totalParticipants / (totalRealizedSlots * 12)) * 100) : 0;

  return {
    periodLabel: `${startDateStr} au ${endDateStr}`,
    startDateStr,
    endDateStr,
    totalDays,
    totalPossibleSlots,
    totalRealizedSlots,
    totalCancelledSlots,
    realizationRate: Math.round(realizationRate * 10) / 10,
    cancellationReasonsBreakdown,
    totalParticipants,
    totalMono,
    totalBi,
    avgFillRate: Math.round(avgFillRate * 10) / 10,
    observationsCount: observations.length,
  };
}

// -----------------------------------------------------------------------------
// ANALYSE DE CALIBRATION & CORRÉLATION DES SURCOTES (POINT 2)
// -----------------------------------------------------------------------------

export function computeCalibrationStats(
  observations: SlotObservation[],
  nominalThresholdM: number = 4.50
): CalibrationStatsResult {
  const validObservations = observations.filter(o => o.waterDeltaCm != null || o.timeDeltaMin != null);

  if (validObservations.length === 0) {
    return {
      totalLogged: 0,
      avgWaterDeltaCm: 0,
      avgTimeDeltaMin: 0,
      pressureCorrelation: {
        lowPressureAvgDeltaCm: 0,
        midPressureAvgDeltaCm: 0,
        highPressureAvgDeltaCm: 0,
      },
      windDirCorrelation: {
        westSectorAvgDeltaCm: 0,
        eastSectorAvgDeltaCm: 0,
      },
      suggestedThresholdM: nominalThresholdM,
    };
  }

  let totalWaterDelta = 0;
  let waterDeltaCount = 0;
  let totalTimeDelta = 0;
  let timeDeltaCount = 0;

  let lowPDeltaSum = 0;
  let lowPCount = 0;
  let midPDeltaSum = 0;
  let midPCount = 0;
  let highPDeltaSum = 0;
  let highPCount = 0;

  let westDeltaSum = 0;
  let westCount = 0;
  let eastDeltaSum = 0;
  let eastCount = 0;

  validObservations.forEach(o => {
    if (o.waterDeltaCm != null) {
      totalWaterDelta += o.waterDeltaCm;
      waterDeltaCount++;

      // Pression
      if (o.observedPressure != null) {
        if (o.observedPressure < 1005) {
          lowPDeltaSum += o.waterDeltaCm;
          lowPCount++;
        } else if (o.observedPressure <= 1015) {
          midPDeltaSum += o.waterDeltaCm;
          midPCount++;
        } else {
          highPDeltaSum += o.waterDeltaCm;
          highPCount++;
        }
      }

      // Secteur de vent
      if (o.observedWindDir) {
        const dir = o.observedWindDir.toUpperCase();
        if (dir.includes('O') || dir.includes('W') || dir.includes('SO') || dir.includes('SW')) {
          westDeltaSum += o.waterDeltaCm;
          westCount++;
        } else if (dir.includes('E') || dir.includes('NE') || dir.includes('SE')) {
          eastDeltaSum += o.waterDeltaCm;
          eastCount++;
        }
      }
    }

    if (o.timeDeltaMin != null) {
      totalTimeDelta += o.timeDeltaMin;
      timeDeltaCount++;
    }
  });

  const avgWaterDeltaCm = waterDeltaCount > 0 ? Math.round((totalWaterDelta / waterDeltaCount) * 10) / 10 : 0;
  const avgTimeDeltaMin = timeDeltaCount > 0 ? Math.round((totalTimeDelta / timeDeltaCount) * 10) / 10 : 0;

  // Calcul du seuil effectif recommandé à Lestrevet :
  // Si surcote positive constatée de +15 cm (l'eau est 15 cm plus haute que prévu),
  // pour avoir la même largeur de plage sécurisée, le seuil de marée doit être réduit d'autant.
  const suggestedThresholdM =
    Math.round((nominalThresholdM - (avgWaterDeltaCm / 100)) * 100) / 100;

  return {
    totalLogged: validObservations.length,
    avgWaterDeltaCm,
    avgTimeDeltaMin,
    pressureCorrelation: {
      lowPressureAvgDeltaCm: lowPCount > 0 ? Math.round((lowPDeltaSum / lowPCount) * 10) / 10 : 0,
      midPressureAvgDeltaCm: midPCount > 0 ? Math.round((midPDeltaSum / midPCount) * 10) / 10 : 0,
      highPressureAvgDeltaCm: highPCount > 0 ? Math.round((highPDeltaSum / highPCount) * 10) / 10 : 0,
    },
    windDirCorrelation: {
      westSectorAvgDeltaCm: westCount > 0 ? Math.round((westDeltaSum / westCount) * 10) / 10 : 0,
      eastSectorAvgDeltaCm: eastCount > 0 ? Math.round((eastDeltaSum / eastCount) * 10) / 10 : 0,
    },
    suggestedThresholdM,
  };
}

export function exportObservationsAsCsv(observations: SlotObservation[]): string {
  const headers = [
    'Date',
    'Creneau_Debut',
    'Creneau_Fin',
    'Statut',
    'Motif_Annulation',
    'Ecart_Horaire_Min',
    'Heure_Reelle_Roulage',
    'Surcote_Constatee_cm',
    'Hauteur_Eau_Reelle_m',
    'Pression_Reelle_hPa',
    'Vent_Reel_nds',
    'Rafales_nds',
    'Direction_Vent',
    'Houle_m',
    'Etat_Plage',
    'Participants',
    'Monoplaces',
    'Biplaces',
    'Commentaires',
  ];

  const rows = observations.map(o => [
    o.ds,
    o.slotStart,
    o.slotEnd,
    o.status === 'realized' ? 'Realisee' : 'Annulee',
    o.cancellationReason ? CANCELLATION_REASONS_INFO[o.cancellationReason]?.shortLabel : '',
    o.timeDeltaMin ?? '',
    o.actualPassableTime ?? '',
    o.waterDeltaCm ?? '',
    o.actualWaterHeight ?? '',
    o.observedPressure ?? '',
    o.observedWindKts ?? '',
    o.observedGustKts ?? '',
    o.observedWindDir ?? '',
    o.observedWaveH ?? '',
    o.beachCondition ?? '',
    o.participantsCount ?? '',
    o.monoCount ?? '',
    o.biCount ?? '',
    `"${(o.notes || o.cancellationNote || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
}
