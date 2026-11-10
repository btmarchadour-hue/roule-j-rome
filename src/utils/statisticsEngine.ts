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

export const INITIAL_SAMPLE_OBSERVATIONS: SlotObservation[] = [];

export function getStoredObservations(): SlotObservation[] {
  try {
    const raw = localStorage.getItem(OBSERVATIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filtrer et purger définitivement les anciennes données d'exemple fictives
      const clean = parsed.filter(o => o && o.id && !o.id.startsWith('sample-obs-'));
      if (clean.length !== parsed.length) {
        localStorage.setItem(OBSERVATIONS_STORAGE_KEY, JSON.stringify(clean));
      }
      return clean;
    }
    return [];
  } catch (e) {
    console.error('Erreur lecture observations:', e);
    return [];
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

export function bulkUpsertObservations(newObsList: SlotObservation[]): SlotObservation[] {
  const current = getStoredObservations();
  const map = new Map<string, SlotObservation>();

  for (const obs of current) {
    const key = obs.id || `${obs.ds}_${obs.slotKey}`;
    map.set(key, obs);
  }

  for (const obs of newObsList) {
    const key = obs.id || `${obs.ds}_${obs.slotKey}`;
    map.set(key, { ...map.get(key), ...obs });
  }

  const updated = Array.from(map.values()).sort((a, b) => {
    if (a.ds !== b.ds) return b.ds.localeCompare(a.ds);
    return (b.slotStart || '').localeCompare(a.slotStart || '');
  });

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
  totalRealizedParticipants: number;    // Inscrits ayant roulé (séances réalisées)
  totalCancelledParticipants: number;   // Inscrits impactés par des annulations météo/aléa
  totalRescheduledParticipants: number; // Inscrits replacés avec succès sur une autre séance
  totalLostParticipants: number;        // Inscrits définitivement perdus / remboursés
  rescheduledRate: number;              // Taux de sauvetage commercial (% replacés)
  unbookedSlotsCount: number;           // Créneaux fermés faute d'inscrits (Vie 1)
  weatherCancelledSlotsCount: number;   // Créneaux annulés météo/aléa (Vie 2)
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
  let totalRealizedParticipants = 0;
  let totalCancelledParticipants = 0;
  let totalRescheduledParticipants = 0;
  let totalLostParticipants = 0;
  let unbookedSlotsCount = 0;
  let weatherCancelledSlotsCount = 0;
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

    // Déduplication des observations par créneau (garder le relevé le plus récent pour chaque créneau)
    const dedupObsMap = new Map<string, SlotObservation>();
    observations
      .filter(o => o.ds === ds)
      .forEach(o => {
        const existing = dedupObsMap.get(o.slotKey);
        if (!existing || (o.updatedAt || o.createdAt || 0) >= (existing.updatedAt || existing.createdAt || 0)) {
          dedupObsMap.set(o.slotKey, o);
        }
      });
    const dayObs = Array.from(dedupObsMap.values());

    const handledSlotKeys = new Set<string>();

    if (dayVal && dayVal.items) {
      dayVal.items.forEach(item => {
        handledSlotKeys.add(item.k);
        const matchedObs = dayObs.find(o => o.slotKey === item.k);

        if (item.status === 'valid') {
          totalRealizedSlots++;
          if (matchedObs?.participantsCount) {
            totalParticipants += matchedObs.participantsCount;
            totalRealizedParticipants += matchedObs.participantsCount;
          }
          if (matchedObs?.monoCount) totalMono += matchedObs.monoCount;
          if (matchedObs?.biCount) totalBi += matchedObs.biCount;
        } else if (item.status === 'rejected') {
          totalCancelledSlots++;
          // Recherche motif
          let reason: CancellationReason = 'wind_low';
          if (matchedObs?.cancellationReason) {
            reason = matchedObs.cancellationReason;
          } else {
            // Déduction par défaut si note présente
            const note = item.rejectReason?.toLowerCase() || '';
            if (note.includes('vent fort') || note.includes('rafale')) reason = 'wind_high';
            else if (note.includes('pétole') || note.includes('vent faible')) reason = 'wind_low';
            else if (note.includes('client') || note.includes('réserv')) reason = 'no_clients';
            else if (note.includes('bâche') || note.includes('plage')) reason = 'beach_state';
          }
          reasonsCount[reason]++;

          // Distinction Vie 1 (faute d'inscrits) vs Vie 2 (annulé avec inscrits)
          if (reason === 'no_clients') {
            unbookedSlotsCount++;
          } else {
            weatherCancelledSlotsCount++;
            const booked = matchedObs?.bookedParticipantsCount || 0;
            const resched = matchedObs?.rescheduledCount || 0;
            const lost = matchedObs?.lostCount != null ? matchedObs.lostCount : Math.max(0, booked - resched);
            totalCancelledParticipants += booked;
            totalRescheduledParticipants += resched;
            totalLostParticipants += lost;
          }
        }
      });
    }

    // Prendre en compte les observations terrain (non encore saisies dans validations)
    dayObs.forEach(obs => {
      if (handledSlotKeys.has(obs.slotKey)) {
        return;
      }
      handledSlotKeys.add(obs.slotKey);

      if (obs.status === 'cancelled') {
        totalCancelledSlots++;
        const reason: CancellationReason = obs.cancellationReason || 'other';
        reasonsCount[reason]++;

        if (reason === 'no_clients') {
          unbookedSlotsCount++;
        } else {
          weatherCancelledSlotsCount++;
          const booked = obs.bookedParticipantsCount || 0;
          const resched = obs.rescheduledCount || 0;
          const lost = obs.lostCount != null ? obs.lostCount : Math.max(0, booked - resched);
          totalCancelledParticipants += booked;
          totalRescheduledParticipants += resched;
          totalLostParticipants += lost;
        }
      } else if (obs.status === 'realized') {
        totalRealizedSlots++;
        if (obs.participantsCount) {
          totalParticipants += obs.participantsCount;
          totalRealizedParticipants += obs.participantsCount;
        }
        if (obs.monoCount) totalMono += obs.monoCount;
        if (obs.biCount) totalBi += obs.biCount;
      }
    });

    // Avancer au jour suivant
    curr.setDate(curr.getDate() + 1);
  }

  const effectivePossibleSlots = Math.max(totalPossibleSlots, totalRealizedSlots + totalCancelledSlots);
  const realizationRate = effectivePossibleSlots > 0 ? (totalRealizedSlots / effectivePossibleSlots) * 100 : 0;

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

  const rescheduledRate =
    totalCancelledParticipants > 0
      ? Math.round((totalRescheduledParticipants / totalCancelledParticipants) * 1000) / 10
      : 0;

  return {
    periodLabel: `${startDateStr} au ${endDateStr}`,
    startDateStr,
    endDateStr,
    totalDays,
    totalPossibleSlots: effectivePossibleSlots,
    totalRealizedSlots,
    totalCancelledSlots,
    realizationRate: Math.round(realizationRate * 10) / 10,
    cancellationReasonsBreakdown,
    totalParticipants,
    totalRealizedParticipants,
    totalCancelledParticipants,
    totalRescheduledParticipants,
    totalLostParticipants,
    rescheduledRate,
    unbookedSlotsCount,
    weatherCancelledSlotsCount,
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
