import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarGrid } from './components/CalendarGrid';
import { DayDetailPanel } from './components/DayDetailPanel';
import { FocusTab } from './components/FocusTab';
import { Header } from './components/Header';
import { MarnageChart } from './components/MarnageChart';
import { NotesAndHypotheses } from './components/NotesAndHypotheses';
import { SettingsCard } from './components/SettingsCard';
import { SlotObservationModal } from './components/SlotObservationModal';
import { StatisticsTab } from './components/StatisticsTab';
import { ClientsTab } from './components/ClientsTab';
import { GpsWaterlineTab } from './components/GpsWaterlineTab';
import { TableView } from './components/TableView';
import { TideHeaderCard } from './components/TideHeaderCard';
import { WindguruTable } from './components/WindguruTable';
import { SyncStatusBar } from './components/SyncStatusBar';
import { AppLockScreen } from './components/AppLockScreen';
import { UserManagementModal } from './components/UserManagementModal';
import { TeamExchangeModal } from './components/TeamExchangeModal';
import { ExpressRexModal } from './components/ExpressRexModal';
import { getSlotWeatherRexDefaults } from './utils/slotWeatherRex';
import {
  AgendaBookingItem,
  subscribeToValidations,
  saveValidationToFirestore,
  saveValidationsBatchToFirestore,
  deleteValidationFromFirestore,
  subscribeToCustomSlots,
  saveCustomSlotsToFirestore,
  subscribeToBookings,
  saveBookingToFirestore,
  notifySync,
  subscribeToSessionSettings,
  saveSessionSettingsToFirestore,
  resetAllSettingsToFirestore,
  subscribeToTeamNotes,
  subscribeToObservations,
  saveObservationToFirestore,
  batchSaveObservationsToFirestore,
  getActiveInstructor,
  subscribeToWaterlineGpsLogs,
  subscribeToBeachCadreConfig,
} from './utils/firebaseSync';
import {
  getOfflineGpsQueue,
  getStoredWaterlineLogs,
  mergeOfflineQueueWithLogs,
  saveStoredWaterlineLogs,
} from './utils/waterlineGpsEngine';
import {
  getStoredBeachCadreConfig,
  saveStoredBeachCadreConfig,
} from './utils/beachCadreEngine';
import {
  buildEmpiricalTidePoints,
  buildPhysicalObservationPoints,
  fitEmpiricalTerrainModel,
  OBSERVATORY_START_DATE,
} from './utils/physicalCorrelationEngine';
import {
  CANCELLATION_REASONS_INFO,
  bulkUpsertObservations,
  getStoredObservations,
  upsertSlotObservation,
} from './utils/statisticsEngine';
import {
  ActiveUserSession,
  AppSettings,
  BeachCadreConfig,
  CancellationReason,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  GpsWaterlineLog,
  MAX_CHARS_PER_INSTRUCTOR,
  SessionItem,
  SlotObservation,
  TeamNote,
  TidePoint,
  ValidationDayRecord,
  ValidationItem,
  ValidationsMap,
  WindPoint,
} from './types';
import { getActiveUser, clearActiveUser, canAccessNotesAndHypotheses } from './utils/authUtils';
import {
  build,
  dayFocus,
  isCycle1PastLocked,
  kOf,
  LAT,
  lc,
  LNG,
  maxDs,
  minDs,
  shf,
  sigOf,
  tdy,
  toU,
  win,
} from './utils/tides';
import {
  buildReservationKey,
  computeShiftMinutes,
  Cycle1SlotAction,
  Cycle2ActionPayload,
  findMatchingValidationItem,
  getEffectiveCycle1Status,
  getSlotBookingsSummary,
  getSlotMaxCapacity,
  getValidationItemChars,
  hasCycle2Activity,
  hasCycle2Trigger,
  normalizeSlotTimeHHhMM,
  parseTimeMinutes,
  stripReasonAccents,
} from './utils/cycleHelpers';

const WK = 'cvWind2';
const VK = 'cvValid1';
const CS_KEY = 'cvCustomSlots';

const defaultSettings: AppSettings = {
  sdur: 60,
  gs: 15,
  gw: 30,
  s0: '07-01',
  s1: '08-31',
  pre: 60,
  post: 30,
  rnd: 15,
  xon: true,
  xtol: 20,
  xpl: 'debut', // Caler par défaut le début des séances sur la première plage disponible (1h après le lever)
  cap: 1,
  all: true,
  cmax: 50, // Seuil de roulage toute la journée calé à 50 pour cohérence parfaite avec les carnets de Jérôme
  pcor: false, // Conservé pour compatibilité ascendante (remplacé par le modèle réel empirique)
  calculationMode: 'theorique',
  L: 4.5,
  mg: 0,
  lum: -1.1,
  lmg: 0,
  h0: 9, // Aucune séance automatique avant 9h00
  h1: 24,
  les: false,
  vmin: 8,
  vmax: 25,
  gmax: 35,
  fmin: 1,
  fminCustomized: false,
};

export const App: React.FC = () => {
  // Navigation tabs: 1 = Cycle 1 (Calendrier), 2 = Cycle 2 (Pilotage Terrain), 4 = Statistiques, 7 = Étalonnage GPS, 5 = Clients, 6 = Hypothèses & Notes
  const [activeTab, setActiveTab] = useState<number>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === '7') return 7;
      if (tabParam === '6') return 6;
      if (tabParam === '5') return 5;
      if (tabParam === '4') return 4;
      if (tabParam === '2' || tabParam === '3' || params.has('autoprint')) return 2;
    } catch {
      // ignore
    }
    return 2; // Démarrage direct sur Adaptation météo & prise de décisions (Cycle 2 avec calendrier)
  });

  // Current year, month, selectedDate (Cycle 1) & focusDate (Cycle 2) defaulting to today (clamped to valid range)
  const initialToday = useMemo(() => {
    const t = tdy();
    if (t < minDs) return minDs;
    if (t > maxDs) return maxDs;
    return t;
  }, []);
  const [initY, initM] = initialToday.split('-').map(Number);

  const [year, setYear] = useState<number>(initY);
  const [month, setMonth] = useState<number>(initM - 1);
  const [selectedDate, setSelectedDate] = useState<string>(initialToday);
  const [focusDate, setFocusDate] = useState<string>(initialToday);
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('cvSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restauration du seuil à 50 pour la cohérence totale avec les carnets
        const cmaxVal = parsed.cmax === 45 || parsed.cmax === undefined ? 50 : parsed.cmax;
        return {
          ...defaultSettings,
          ...parsed,
          cmax: cmaxVal,
          xpl: parsed.xplCustomized ? parsed.xpl : 'debut',
          fmin: parsed.fminCustomized ? (parsed.fmin >= 1 ? parsed.fmin : 1) : 1,
        };
      }
    } catch {
      // ignore
    }
    return defaultSettings;
  });

  // Wind data
  const [windList, setWindList] = useState<WindPoint[]>([]);
  const [windStatus, setWindStatus] = useState<string>('');
  const [isLoadingWind, setIsLoadingWind] = useState<boolean>(false);

  // Validations map
  const [validations, setValidations] = useState<ValidationsMap>(() => {
    try {
      return JSON.parse(localStorage.getItem(VK) || '{}');
    } catch {
      return {};
    }
  });

  // Custom slots map (créneaux sur mesure)
  const [customSlotsMap, setCustomSlotsMap] = useState<CustomSlotsMap>(() => {
    try {
      return JSON.parse(localStorage.getItem(CS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  // Réservations numériques par créneau (`${ds}_${slotKey}` -> AgendaBookingItem[])
  const [bookingsMap, setBookingsMap] = useState<Record<string, AgendaBookingItem[]>>({});

  // Relevés terrain REX synchronisés temps réel (partagés entre Planning, Cycle 2 et Statistiques)
  const [observations, setObservations] = useState<SlotObservation[]>(() =>
    getStoredObservations().filter(o => o && o.id && !o.id.startsWith('sample-obs-'))
  );

  // Relevés GPS bord d'eau + cadre plage synchronisés temps réel (pour le modèle réel empirique unifié)
  const [gpsWaterlineLogs, setGpsWaterlineLogs] = useState<GpsWaterlineLog[]>(() =>
    getStoredWaterlineLogs()
  );
  const [beachCadreConfig, setBeachCadreConfig] = useState<BeachCadreConfig>(() =>
    getStoredBeachCadreConfig()
  );

  // Clean obsolete tab storage key on startup
  useEffect(() => {
    try {
      localStorage.removeItem('cvTab');
    } catch {
      // ignore
    }
  }, []);

  // Initialisation et abonnements temps réel Firestore (partage instantané entre smartphone et PC)
  useEffect(() => {
    // 1. Écouter en temps réel les validations & cycles 1/2
    const unsubValidations = subscribeToValidations(remoteVals => {
      const data = remoteVals || {};
      setValidations(data);
      try {
        localStorage.setItem(VK, JSON.stringify(data));
      } catch {
        // ignore
      }
    });

    // 2. Écouter en temps réel les créneaux personnalisés
    const unsubCustomSlots = subscribeToCustomSlots(remoteSlots => {
      const data = remoteSlots || {};
      setCustomSlotsMap(data);
      try {
        localStorage.setItem(CS_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
    });

    // 3. Écouter en temps réel les réglages partagés des séances
    const unsubSessionSettings = subscribeToSessionSettings(cloudSettings => {
      if (cloudSettings && Object.keys(cloudSettings).length > 0) {
        setSettings(prev => {
          const resolvedFminCustomized = cloudSettings.fminCustomized ?? prev.fminCustomized;
          const rawCloudFmin = cloudSettings.fmin ?? prev.fmin;
          const merged = {
            ...prev,
            ...cloudSettings,
            fmin: resolvedFminCustomized ? (rawCloudFmin >= 1 ? rawCloudFmin : 1) : 1,
          };
          try {
            localStorage.setItem('cvSettings', JSON.stringify(merged));
          } catch {
            // ignore
          }
          return merged;
        });
      }
    });

    // 4. Écouter en temps réel les réservations clients (déclencheur Cycle 2)
    const unsubBookings = subscribeToBookings(remoteBookings => {
      setBookingsMap(remoteBookings || {});
    });

    // 5. Écouter en temps réel les notes d'échange Ben ↔ Jérôme (Module 7)
    const unsubTeamNotes = subscribeToTeamNotes(notes => {
      setTeamNotes(notes);
    });

    // 6. Écouter en temps réel les relevés terrain REX (cycle 1, cycle 2, stats)
    const unsubObservations = subscribeToObservations(remoteObs => {
      const cleanRemote = (remoteObs || []).filter(o => o && o.id && !o.id.startsWith('sample-obs-'));
      setObservations(cleanRemote);
      try {
        localStorage.setItem('cv_observations_v1', JSON.stringify(cleanRemote));
      } catch {
        // ignore
      }
    });

    // 7. Écouter en temps réel les relevés GPS bord d'eau et le cadre plage (modèle empirique unifié)
    const unsubGpsLogs = subscribeToWaterlineGpsLogs(remoteLogs => {
      setGpsWaterlineLogs(remoteLogs || []);
      saveStoredWaterlineLogs(remoteLogs || []);
    });

    const unsubBeachCadre = subscribeToBeachCadreConfig(remoteCfg => {
      if (remoteCfg) {
        setBeachCadreConfig(remoteCfg);
        saveStoredBeachCadreConfig(remoteCfg);
      }
    });

    return () => {
      unsubValidations();
      unsubCustomSlots();
      unsubSessionSettings();
      unsubBookings();
      unsubTeamNotes();
      unsubObservations();
      unsubGpsLogs();
      unsubBeachCadre();
    };
  }, []);

  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([]);
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<ActiveUserSession | null>(() => getActiveUser());
  const isReadOnly = Boolean(currentUser?.isReadOnly);
  const isAdminLocked = isReadOnly || currentUser?.role === 'moniteur';
  const canAccessHypothesesTab = canAccessNotesAndHypotheses(currentUser);

  useEffect(() => {
    if (activeTab === 6 && !canAccessHypothesesTab) {
      setActiveTab(2);
    }
  }, [activeTab, canAccessHypothesesTab]);

  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    try {
      const session = getActiveUser();
      const flag =
        localStorage.getItem('cv_app_unlocked') === 'true' ||
        sessionStorage.getItem('cv_app_unlocked') === 'true';
      return Boolean(flag && session);
    } catch {
      return false;
    }
  });

  const handleUnlock = useCallback((session: ActiveUserSession) => {
    setCurrentUser(session);
    setIsUnlocked(true);
  }, []);

  const handleLock = useCallback(() => {
    clearActiveUser();
    setCurrentUser(null);
    setIsUnlocked(false);
  }, []);

  const debounceSettingsRef = useRef<NodeJS.Timeout | null>(null);

  const handleUpdateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    if (currentUser?.isReadOnly || currentUser?.role === 'moniteur') {
      notifySync('🔒 Mode Moniteur : modifications réservées aux administrateurs');
      return;
    }
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem('cvSettings', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    // Sauvegarde automatique temps réel dans Firestore (délai de 600ms après la frappe)
    if (debounceSettingsRef.current) {
      clearTimeout(debounceSettingsRef.current);
    }
    debounceSettingsRef.current = setTimeout(() => {
      saveSessionSettingsToFirestore(newSettings).catch(err => {
        console.warn('Erreur sauvegarde automatique réglages séances:', err);
      });
    }, 600);
  }, [currentUser]);

  const handleAddCustomNonPublishReason = useCallback((rawReason: string) => {
    const trimmed = rawReason.trim();
    const normKey = stripReasonAccents(trimmed);
    if (!trimmed || normKey === 'ferme' || normKey === 'fermee' || normKey === 'fermeture') return;
    if (currentUser?.isReadOnly || currentUser?.role === 'moniteur') {
      notifySync('🔒 Mode Contrôle : ajout de raison verrouillé');
      return;
    }
    setSettings(prev => {
      const existing = prev.customNonPublishReasons || [];
      if (existing.some(r => stripReasonAccents(r) === normKey)) {
        return prev;
      }
      const nextReasons = [...existing, trimmed];
      const updated = { ...prev, customNonPublishReasons: nextReasons };
      try {
        localStorage.setItem('cvSettings', JSON.stringify(updated));
      } catch {
        // ignore
      }
      saveSessionSettingsToFirestore({ customNonPublishReasons: nextReasons }).catch(err => {
        console.warn('Erreur sauvegarde raison personnalisée:', err);
      });
      return updated;
    });
  }, [currentUser]);

  // Sauvegarde temporaire pour bouton Annuler / Retour arrière (Module 2)
  const [backupSettings, setBackupSettings] = useState<AppSettings | null>(null);
  const undoResetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Remise à zéro de tous les 24 réglages vers les valeurs d'origine de l'école
  const handleResetToDefaults = useCallback(() => {
    if (currentUser?.isReadOnly || currentUser?.role !== 'admin') {
      notifySync('🔒 Mode Moniteur : réinitialisation réservée aux administrateurs');
      return;
    }

    // Mémoriser l'état actuel pour permettre le retour arrière immédiat
    setBackupSettings(settings);
    if (undoResetTimerRef.current) {
      clearTimeout(undoResetTimerRef.current);
    }
    undoResetTimerRef.current = setTimeout(() => {
      setBackupSettings(null);
    }, 30000); // Disponible 30 secondes

    // Application locale immédiate
    setSettings(defaultSettings);
    try {
      localStorage.setItem('cvSettings', JSON.stringify(defaultSettings));
    } catch {
      // ignore
    }

    // Propagation Cloud vers tous les autres appareils
    resetAllSettingsToFirestore().catch(err => {
      console.warn('Erreur réinitialisation Firestore:', err);
    });
  }, [currentUser, settings]);

  // Retour arrière : restauration immédiate des réglages précédents
  const handleUndoReset = useCallback(() => {
    if (!backupSettings) return;
    const restored = backupSettings;
    setBackupSettings(null);
    if (undoResetTimerRef.current) {
      clearTimeout(undoResetTimerRef.current);
    }

    setSettings(restored);
    try {
      localStorage.setItem('cvSettings', JSON.stringify(restored));
    } catch {
      // ignore
    }

    saveSessionSettingsToFirestore(restored).catch(err => {
      console.warn('Erreur restauration Cloud:', err);
    });
    notifySync('✓ Vos réglages précédents ont été restaurés !');
  }, [backupSettings]);

  // Marée astronomique SHOM brute (sans ancienne correction théorique +1 cm/hPa)
  const rawEX: TidePoint[] = useMemo(() => {
    return build(settings.les, false, []);
  }, [settings.les]);

  // Modèle réel empirique unifié (Pression + Houle + Vent, calibré progressivement dès le 20/11/2026)
  const empiricalTerrainModel = useMemo(() => {
    const mergedGps = mergeOfflineQueueWithLogs(gpsWaterlineLogs, getOfflineGpsQueue());
    const activeCadre =
      beachCadreConfig.profiles[beachCadreConfig.activeProfile] ||
      beachCadreConfig.profiles.jerome ||
      null;
    const { points } = buildPhysicalObservationPoints(
      mergedGps,
      observations,
      activeCadre,
      OBSERVATORY_START_DATE
    );
    return fitEmpiricalTerrainModel(points);
  }, [gpsWaterlineLogs, observations, beachCadreConfig]);

  const empiricalEX: TidePoint[] = useMemo(() => {
    return buildEmpiricalTidePoints(rawEX, windList, empiricalTerrainModel);
  }, [rawEX, windList, empiricalTerrainModel]);

  // Option B : SHOM brut par défaut pour les horaires ; bascule optionnelle vers le Modèle Réel Empirique
  const isRealMode = settings.calculationMode === 'reel';
  const EX: TidePoint[] = isRealMode ? empiricalEX : rawEX;
  const effectiveThreshold = settings.L - (settings.mg || 0) / 100;

  const tideW = useMemo(() => {
    return win(EX, effectiveThreshold);
  }, [EX, effectiveThreshold]);

  const first = EX[0]?.t ?? 0;
  const last = EX[EX.length - 1]?.t ?? 0;

  const handleUpdateCustomSlots = useCallback(
    (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Contrôle : créneaux sur mesure verrouillés');
        return;
      }
      if (isCycle1PastLocked(dateStr)) {
        notifySync('🔒 Archive verrouillée (> 7 jours) : les créneaux Cycle 1 ne sont plus modifiables');
        return;
      }
      const nextCustomMap: CustomSlotsMap = {
        ...customSlotsMap,
        [dateStr]: { replaceDefault, slots },
      };

      // Garde-fou anti-chevauchement strict avant toute écriture en base
      const prevFocus = dayFocus(dateStr, settings, tideW, first, last, windList, customSlotsMap);
      const nextFocus = dayFocus(dateStr, settings, tideW, first, last, windList, nextCustomMap);
      const countOverlaps = (list: SessionItem[]) => {
        const sorted = [...list].sort((a, b) => a.a - b.a);
        let count = 0;
        let firstPair: [SessionItem, SessionItem] | null = null;
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].b > sorted[i + 1].a) {
            count++;
            if (!firstPair) firstPair = [sorted[i], sorted[i + 1]];
          }
        }
        return { count, firstPair };
      };
      const prevOv = countOverlaps(prevFocus.list);
      const nextOv = countOverlaps(nextFocus.list);
      if (nextOv.count > 0 && nextOv.count >= prevOv.count && nextOv.firstPair) {
        const [ovA, ovB] = nextOv.firstPair;
        const s1 = `${lc(ovA.a, nextFocus.y, nextFocus.m, nextFocus.d)}–${lc(ovA.b, nextFocus.y, nextFocus.m, nextFocus.d)}`;
        const s2 = `${lc(ovB.a, nextFocus.y, nextFocus.m, nextFocus.d)}–${lc(ovB.b, nextFocus.y, nextFocus.m, nextFocus.d)}`;
        notifySync(`⛔ Chevauchement interdit (${s1} et ${s2}) : modification bloquée pour protéger les données`);
        return;
      }

      // Si la journée est déjà publiée en Cycle 1, vérifier d'abord qu'aucun créneau engagé (inscrits/REX/C2) ne sera perdu avant toute écriture
      const existingRecord = validations[dateStr];
      if (existingRecord && existingRecord.items && existingRecord.items.length > 0) {
        const normTime = (v?: string) => (v || '').trim().replace('h', ':');
        const existingItems = [...existingRecord.items];
        const dayObsList = observations.filter(o => o.ds === dateStr);

        const matchObsForItem = (it: ValidationItem) =>
          dayObsList.find(
            o =>
              o.slotKey === it.k ||
              (Boolean(o.slotStart) &&
                Boolean(o.slotEnd) &&
                ((normTime(o.slotStart) === normTime(it.publishedStart || it.s) &&
                  normTime(o.slotEnd) === normTime(it.publishedEnd || it.e)) ||
                  (Boolean(it.actualStart) &&
                    Boolean(it.actualEnd) &&
                    normTime(o.slotStart) === normTime(it.actualStart) &&
                    normTime(o.slotEnd) === normTime(it.actualEnd))))
          ) || null;

        const usedExistingKeys = new Set<string>();
        const pairedExistingForNext: Array<ValidationItem | undefined> = new Array(
          nextFocus.list.length
        ).fill(undefined);

        // Passe 1 : correspondance exacte (même clé OU même horaire publié OU même horaire réel)
        nextFocus.list.forEach((x, idx) => {
          const slotKey = kOf(x);
          const startTimeStr = lc(x.a, nextFocus.y, nextFocus.m, nextFocus.d);
          const endTimeStr = lc(x.b, nextFocus.y, nextFocus.m, nextFocus.d);
          const match = existingItems.find(
            it =>
              !usedExistingKeys.has(it.k) &&
              (it.k === slotKey ||
                (normTime(it.publishedStart || it.s) === normTime(startTimeStr) &&
                  normTime(it.publishedEnd || it.e) === normTime(endTimeStr)) ||
                (Boolean(it.actualStart) &&
                  Boolean(it.actualEnd) &&
                  normTime(it.actualStart) === normTime(startTimeStr) &&
                  normTime(it.actualEnd) === normTime(endTimeStr)))
          );
          if (match) {
            pairedExistingForNext[idx] = match;
            usedExistingKeys.add(match.k);
          }
        });

        // Passe 2 : décalage léger (-15/+15/Ajuster) UNIQUEMENT pour les créneaux SANS activité Cycle 2 / inscrits / REX
        // (ne JAMAIS rattacher silencieusement des inscrits d'un créneau vers un autre horaire !)
        nextFocus.list.forEach((x, idx) => {
          if (pairedExistingForNext[idx]) return;
          const startTimeStr = lc(x.a, nextFocus.y, nextFocus.m, nextFocus.d);
          const newStartMin = parseTimeMinutes(startTimeStr);
          if (newStartMin === null) return;

          const remainingExisting = existingItems.filter(it => {
            if (usedExistingKeys.has(it.k)) return false;
            const bChars = getSlotBookingsSummary(
              bookingsMap[buildReservationKey(dateStr, it.k)] || []
            ).totalChars;
            const itObs = matchObsForItem(it);
            return !hasCycle2Activity(it, bChars, itObs);
          });
          let bestCandidate: ValidationItem | undefined;
          let bestDiff = 61; // fenêtre raisonnable 1h max pour créneau libre (0 inscrit)

          for (const cand of remainingExisting) {
            const candTime = cand.actualStart || cand.publishedStart || cand.s;
            const candMin = parseTimeMinutes(candTime);
            if (candMin === null) continue;
            const diff = Math.abs(newStartMin - candMin);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestCandidate = cand;
            }
          }

          if (bestCandidate) {
            pairedExistingForNext[idx] = bestCandidate;
            usedExistingKeys.add(bestCandidate.k);
          }
        });

        // Garde-fou critique : si un créneau avec inscrits / REX / activité Cycle 2 n'existe plus dans la nouvelle grille,
        // BLOQUER totalement la mise à jour au lieu de créer un reliquat orphelin qui fausse les données !
        const lostActiveItems = existingItems.filter(rem => {
          if (usedExistingKeys.has(rem.k)) return false;
          const bChars = getSlotBookingsSummary(
            bookingsMap[buildReservationKey(dateStr, rem.k)] || []
          ).totalChars;
          const remObs = matchObsForItem(rem);
          return hasCycle2Activity(rem, bChars, remObs);
        });
        if (lostActiveItems.length > 0) {
          const labels = lostActiveItems
            .map(it => `${it.actualStart || it.s}–${it.actualEnd || it.e}`)
            .join(', ');
          notifySync(
            `⛔ Modification bloquée : créneau(x) avec inscrits/REX encore actif(s) (${labels}). Traitez-les d’abord dans Cycle 2.`
          );
          return;
        }

        setCustomSlotsMap(nextCustomMap);
        try {
          localStorage.setItem(CS_KEY, JSON.stringify(nextCustomMap));
        } catch {
          // ignore
        }
        saveCustomSlotsToFirestore(dateStr, { replaceDefault, slots }).catch(err =>
          console.warn('Erreur Firestore custom slots:', err)
        );

        const bookingMigrations: Array<{ oldKey: string; newKey: string; items: AgendaBookingItem[] }> = [];
        const obsMigrations: SlotObservation[] = [];

        const syncedItems: ValidationItem[] = nextFocus.list
          .map((x, idx): ValidationItem | null => {
          const slotKey = kOf(x);
          const startTimeStr = lc(x.a, nextFocus.y, nextFocus.m, nextFocus.d);
          const endTimeStr = lc(x.b, nextFocus.y, nextFocus.m, nextFocus.d);
          const matchedExisting = pairedExistingForNext[idx];

          if (matchedExisting) {
            const oldKey = matchedExisting.k;
            const oldBookings = bookingsMap[buildReservationKey(dateStr, oldKey)] || [];
            const oldBookingChars = getSlotBookingsSummary(oldBookings).totalChars;
            const matchedObs = matchObsForItem(matchedExisting);
            const hasC2Activity = hasCycle2Activity(matchedExisting, oldBookingChars, matchedObs);

            if (oldKey !== slotKey && oldBookings.length > 0) {
              bookingMigrations.push({ oldKey, newKey: slotKey, items: oldBookings });
            }

            const origPubStart = matchedExisting.publishedStart || matchedExisting.s || startTimeStr;
            const origPubEnd = matchedExisting.publishedEnd || matchedExisting.e || endTimeStr;
            const timeChangedFromPub =
              normTime(startTimeStr) !== normTime(origPubStart) ||
              normTime(endTimeStr) !== normTime(origPubEnd);

            const resolvedPubStart = hasC2Activity ? origPubStart : startTimeStr;
            const resolvedPubEnd = hasC2Activity ? origPubEnd : endTimeStr;
            const resolvedShiftMin = hasC2Activity
              ? computeShiftMinutes(resolvedPubStart, startTimeStr)
              : undefined;

            if (matchedObs && (matchedObs.slotKey !== slotKey || normTime(matchedObs.slotStart) !== normTime(startTimeStr) || normTime(matchedObs.slotEnd) !== normTime(endTimeStr))) {
              obsMigrations.push({
                ...matchedObs,
                slotKey,
                slotStart: startTimeStr,
                slotEnd: endTimeStr,
                timeDeltaMin: resolvedShiftMin ?? matchedObs.timeDeltaMin,
                updatedAt: Date.now(),
              });
            }

            if (hasC2Activity) {
              const keepC2 =
                matchedExisting.cycle2Status === 'realized'
                  ? 'realized'
                  : matchedExisting.cycle2Status === 'cancelled_weather'
                  ? 'cancelled_weather'
                  : matchedExisting.cycle2Status === 'merged'
                  ? 'merged'
                  : timeChangedFromPub
                  ? 'shifted'
                  : matchedExisting.cycle2Status || 'confirmed';
              return {
                ...matchedExisting,
                k: slotKey,
                s: startTimeStr,
                e: endTimeStr,
                publishedStart: resolvedPubStart,
                publishedEnd: resolvedPubEnd,
                actualStart: timeChangedFromPub ? startTimeStr : matchedExisting.actualStart,
                actualEnd: timeChangedFromPub ? endTimeStr : matchedExisting.actualEnd,
                shiftMinutes: timeChangedFromPub ? resolvedShiftMin : matchedExisting.shiftMinutes,
                opt: x.opt,
                over: x.over,
                lim: x.lim,
                customTitle: x.customTitle ?? matchedExisting.customTitle,
                cycle1Status: 'published',
                cycle2Status: keepC2,
              };
            }

            const keepExcluded =
              matchedExisting.cycle1Status === 'excluded' ||
              (matchedExisting.rejectReason || '').toLowerCase().includes('hors offre') ||
              (matchedExisting.rejectReason || '').toLowerCase().includes('non pertinent');
            const keepNotPublished =
              !keepExcluded &&
              (matchedExisting.cycle1Status === 'not_published' ||
                Boolean(matchedExisting.nonPublishReason));
            const keepClosedVie1 =
              !keepExcluded &&
              !keepNotPublished &&
              matchedExisting.cycle1Status === 'closed_no_bookings';
            const notPubReason = matchedExisting.nonPublishReason || 'Impératif personnel';

            return {
              ...matchedExisting,
              k: slotKey,
              s: startTimeStr,
              e: endTimeStr,
              publishedStart: startTimeStr,
              publishedEnd: endTimeStr,
              actualStart: undefined,
              actualEnd: undefined,
              shiftMinutes: undefined,
              opt: x.opt,
              over: x.over,
              lim: x.lim,
              customTitle: x.customTitle ?? matchedExisting.customTitle,
              status: keepExcluded || keepNotPublished || keepClosedVie1 ? 'rejected' : 'valid',
              rejectReason: keepExcluded
                ? 'Hors offre / Non pertinent (C1)'
                : keepNotPublished
                ? `Non publié (C1) : ${notPubReason}`
                : keepClosedVie1
                ? matchedExisting.rejectReason || "Faute d'inscrits (Vie 1)"
                : undefined,
              cycle1Status: keepExcluded
                ? 'excluded'
                : keepNotPublished
                ? 'not_published'
                : keepClosedVie1
                ? 'closed_no_bookings'
                : 'published',
              nonPublishReason: keepNotPublished ? notPubReason : undefined,
              cycle2Status: keepExcluded || keepNotPublished || keepClosedVie1 ? undefined : 'awaiting_booking',
            };
          }

          return null;
        }).filter((it): it is ValidationItem => it !== null);

        if (bookingMigrations.length > 0) {
          const mergedByNewKey = new Map<string, AgendaBookingItem[]>();
          for (const mig of bookingMigrations) {
            const newResKey = buildReservationKey(dateStr, mig.newKey);
            const existingTargetBookings = mergedByNewKey.get(newResKey) ?? bookingsMap[newResKey] ?? [];
            const seenIds = new Set(existingTargetBookings.map(b => b.id));
            const merged = [
              ...existingTargetBookings,
              ...mig.items.filter(b => !seenIds.has(b.id)),
            ];
            mergedByNewKey.set(newResKey, merged);
          }

          setBookingsMap(prev => {
            const nextMap = { ...prev };
            for (const mig of bookingMigrations) {
              const oldResKey = buildReservationKey(dateStr, mig.oldKey);
              delete nextMap[oldResKey];
            }
            mergedByNewKey.forEach((items, newResKey) => {
              nextMap[newResKey] = items;
            });
            return nextMap;
          });
          for (const mig of bookingMigrations) {
            const oldResKey = buildReservationKey(dateStr, mig.oldKey);
            const newResKey = buildReservationKey(dateStr, mig.newKey);
            const mergedItems = mergedByNewKey.get(newResKey) || mig.items;
            saveBookingToFirestore(newResKey, mergedItems).catch(err =>
              console.warn('Erreur Firestore migration réservations:', err)
            );
            if (!mergedByNewKey.has(oldResKey)) {
              saveBookingToFirestore(oldResKey, []).catch(err =>
                console.warn('Erreur Firestore purge ancienne clé réservations:', err)
              );
            }
          }
        }

        if (obsMigrations.length > 0) {
          const updatedObsList = bulkUpsertObservations(obsMigrations);
          setObservations(updatedObsList);
          batchSaveObservationsToFirestore(obsMigrations).catch(err =>
            console.warn('Erreur Firestore migration REX:', err)
          );
        }

        if (syncedItems.length === 0) {
          setValidations(prev => {
            const nextVals = { ...prev };
            delete nextVals[dateStr];
            try {
              localStorage.setItem(VK, JSON.stringify(nextVals));
            } catch {
              // ignore
            }
            return nextVals;
          });
          deleteValidationFromFirestore(dateStr).catch(err =>
            console.warn('Erreur Firestore delete validation vide:', err)
          );
        } else {
          const nextValidation: ValidationDayRecord = {
            sig: sigOf(nextFocus),
            ts: Date.now(),
            k: nextFocus.k,
            cycle1PublishedAt: existingRecord.cycle1PublishedAt || Date.now(),
            items: syncedItems,
          };
          setValidations(prev => {
            const nextVals = { ...prev, [dateStr]: nextValidation };
            try {
              localStorage.setItem(VK, JSON.stringify(nextVals));
            } catch {
              // ignore
            }
            return nextVals;
          });
          saveValidationToFirestore(dateStr, nextValidation).catch(err =>
            console.warn('Erreur Firestore sync validation Cycle 1:', err)
          );
        }
        notifySync(
          bookingMigrations.length > 0 || obsMigrations.length > 0
            ? '📅 Horaire ajusté et fiches / inscrits migrés sans doublon'
            : '📅 Horaires Cycle 1 mis à jour'
        );
      } else {
        setCustomSlotsMap(nextCustomMap);
        try {
          localStorage.setItem(CS_KEY, JSON.stringify(nextCustomMap));
        } catch {
          // ignore
        }
        saveCustomSlotsToFirestore(dateStr, { replaceDefault, slots }).catch(err =>
          console.warn('Erreur Firestore custom slots:', err)
        );
        notifySync('✏️ Horaires du jour ajustés');
      }
    },
    [isAdminLocked, currentUser, customSlotsMap, validations, settings, tideW, first, last, windList, bookingsMap, observations]
  );

  const handleTabChange = (tab: number) => {
    if (tab === 6 && !canAccessHypothesesTab) return;
    setActiveTab(tab);
  };

  const [activeObservationSlot, setActiveObservationSlot] = useState<{
    dateStr: string;
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    isCustom?: boolean;
    customTitle?: string;
    maxChars?: number;
    primaryInstructor?: string;
    secondaryInstructor?: string;
    defaultStatus?: 'realized' | 'cancelled';
    defaultCancellationReason?: CancellationReason;
    defaultCancellationNote?: string;
    defaultMonoCount?: number;
    defaultBiCount?: number;
    defaultParticipantsCount?: number;
    defaultBookedParticipantsCount?: number;
    forceIntent?: boolean;
  } | null>(null);
  const [expressRexDate, setExpressRexDate] = useState<string | null>(null);

  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);

  const handlePrevMonth = () => {
    const [minY, minM] = minDs.split('-').map(Number);
    if (year === minY && month <= minM - 1) return;
    setMonth(prevM => {
      if (prevM === 0) {
        setYear(prevY => prevY - 1);
        return 11;
      }
      return prevM - 1;
    });
  };

  const handleNextMonth = () => {
    setMonth(prevM => {
      if (prevM === 11) {
        setYear(prevY => prevY + 1);
        return 0;
      }
      return prevM + 1;
    });
  };

  const handleSelectDayInCalendar = (ds: string) => {
    const [y, m, d] = ds.split('-').map(Number);
    setYear(y);
    setMonth(m - 1);
    setSelectedDate(ds);
    setActiveTab(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateDay = useCallback(
    (deltaDays: number) => {
      const nextDs = shf(selectedDate, deltaDays);
      const clamped = nextDs < minDs ? minDs : nextDs > maxDs ? maxDs : nextDs;
      const [ny, nm] = clamped.split('-').map(Number);
      setYear(ny);
      setMonth(nm - 1);
      setSelectedDate(clamped);
    },
    [selectedDate]
  );

  // Process raw Open-Meteo hourly response + Marine wave data
  const processWind = useCallback((aData: any, gData: any, mData?: any) => {
    const m = new Map<string, WindPoint>();
    const add = (j: any, src: 'A' | 'G') => {
      if (!j || !j.hourly) return;
      const h = j.hourly;
      h.time.forEach((x: string, i: number) => {
        if (h.wind_speed_10m[i] == null) return;
        const o0 = m.get(x) || ({} as Partial<WindPoint>);
        const gv = (k: string, pk: keyof WindPoint) =>
          h[k] && h[k][i] != null ? h[k][i] : o0[pk] != null ? o0[pk] : null;

        m.set(x, {
          tp: gv('temperature_2m', 'tp'),
          ap: gv('apparent_temperature', 'ap'),
          pr: gv('precipitation', 'pr'),
          wc: gv('weather_code', 'wc'),
          cc: gv('cloud_cover', 'cc'),
          ccl: gv('cloud_cover_low', 'ccl'),
          ccm: gv('cloud_cover_mid', 'ccm'),
          cch: gv('cloud_cover_high', 'cch'),
          rad: gv('shortwave_radiation_instant', 'rad'),
          uv: gv('uv_index', 'uv'),
          rh: gv('relative_humidity_2m', 'rh'),
          t: toU(
            +x.slice(0, 4),
            +x.slice(5, 7) - 1,
            +x.slice(8, 10),
            +x.slice(11, 13) * 60 + +x.slice(14, 16)
          ),
          v: h.wind_speed_10m[i],
          g: h.wind_gusts_10m ? h.wind_gusts_10m[i] : null,
          a: h.wind_direction_10m[i],
          s: src,
          p:
            h.pressure_msl && h.pressure_msl[i] != null
              ? h.pressure_msl[i]
              : m.get(x)
              ? m.get(x)!.p
              : null,
        });
      });
    };

    add(gData, 'G');
    add(aData, 'A');

    // Merge marine wave data (wave_height, wave_period, wave_direction)
    if (mData && mData.hourly && Array.isArray(mData.hourly.time)) {
      const mh = mData.hourly;
      mh.time.forEach((x: string, i: number) => {
        const pt = m.get(x);
        if (pt) {
          pt.wvh = mh.wave_height && mh.wave_height[i] != null ? mh.wave_height[i] : null;
          pt.wvp = mh.wave_period && mh.wave_period[i] != null ? mh.wave_period[i] : null;
          pt.wvd = mh.wave_direction && mh.wave_direction[i] != null ? mh.wave_direction[i] : null;
        }
      });
    }

    const sorted = [...m.values()].sort((p, q) => p.t - q.t);
    setWindList(sorted);
  }, []);

  // Fetch forecast from Open-Meteo (AROME + 16-day global + Open-Meteo Marine)
  const fetchWind = useCallback(async () => {
    setIsLoadingWind(true);
    setWindStatus(' Vent & Houle : chargement…');
    const base = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,shortwave_radiation_instant,uv_index,relative_humidity_2m&wind_speed_unit=kn&timezone=Europe%2FParis&forecast_days=`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LNG}&hourly=wave_height,wave_direction,wave_period&timezone=Europe%2FParis&forecast_days=16`;

    const get = (url: string) =>
      fetch(url).then(r => {
        if (!r.ok) throw new Error('Network error');
        return r.json();
      });

    try {
      const [A, G, M] = await Promise.allSettled([
        get(base + '3&models=meteofrance_arome_france_hd'),
        get(base + '16'),
        get(marineUrl),
      ]);

      const aVal = A.status === 'fulfilled' ? A.value : null;
      const gVal = G.status === 'fulfilled' ? G.value : null;
      const mVal = M.status === 'fulfilled' ? M.value : null;

      if (aVal || gVal) {
        processWind(aVal, gVal, mVal);
        try {
          localStorage.setItem(WK, JSON.stringify({ ts: Date.now(), a: aVal, g: gVal, m: mVal }));
        } catch {
          // ignore
        }
        setWindStatus(
          ` Vent & Houle : AROME + Global HD + Marine · mis à jour le ${new Date().toLocaleString('fr-FR')}`
        );
      } else {
        throw new Error('Both fetches failed');
      }
    } catch {
      let cached: any = null;
      try {
        cached = JSON.parse(localStorage.getItem(WK) || 'null');
      } catch {
        // ignore
      }
      if (cached && (cached.a || cached.g)) {
        processWind(cached.a, cached.g, cached.m);
        setWindStatus(
          ` Vent : hors ligne, dernières prévisions du ${new Date(
            cached.ts
          ).toLocaleString('fr-FR')}`
        );
      } else {
        setWindList([]);
        setWindStatus(' Vent indisponible (hors ligne)');
      }
    } finally {
      setIsLoadingWind(false);
    }
  }, [processWind]);

  // Initial wind load
  useEffect(() => {
    let cached: any = null;
    try {
      cached = JSON.parse(localStorage.getItem(WK) || 'null');
    } catch {
      // ignore
    }
    if (cached && (cached.a || cached.g)) {
      processWind(cached.a, cached.g);
      setWindStatus(
        ` Vent : dernières prévisions du ${new Date(cached.ts).toLocaleString('fr-FR')}`
      );
    }
    fetchWind();
  }, [fetchWind, processWind]);

  const persistDayValidation = useCallback((ds: string, nextRecord: ValidationDayRecord | null) => {
    setValidations(prev => {
      const updated = { ...prev };
      if (!nextRecord || nextRecord.items.length === 0) {
        delete updated[ds];
      } else {
        updated[ds] = nextRecord;
      }
      try {
        localStorage.setItem(VK, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    if (!nextRecord || nextRecord.items.length === 0) {
      deleteValidationFromFirestore(ds).catch(err =>
        console.warn('Erreur Firestore delete validation:', err)
      );
    } else {
      saveValidationToFirestore(ds, nextRecord).catch(err =>
        console.warn('Erreur Firestore save validation:', err)
      );
    }
  }, []);

  const findObservationForSlot = useCallback(
    (ds: string, slotKey: string, slotStart?: string, slotEnd?: string): SlotObservation | null => {
      const dayObs = observations.filter(o => o.ds === ds);
      if (dayObs.length === 0) return null;
      const byExactKey = dayObs
        .filter(o => o.slotKey === slotKey)
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      if (byExactKey.length > 0) return byExactKey[0];
      if (slotStart && slotEnd) {
        const norm = (v: string) => v.replace('h', ':');
        const byTime = dayObs
          .filter(o => norm(o.slotStart || '') === norm(slotStart) && norm(o.slotEnd || '') === norm(slotEnd))
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        if (byTime.length > 0) return byTime[0];
      }
      return null;
    },
    [observations]
  );

  const syncValidationFromRex = useCallback(
    (savedObs: SlotObservation) => {
      if (!savedObs || !savedObs.ds || isAdminLocked) return;
      const ds = savedObs.ds;
      const existingRecord = validations[ds];

      const normTime = (v?: string) => (v || '').trim().replace('h', ':');
      const matchesObsSlot = (it: ValidationItem) =>
        it.k === savedObs.slotKey ||
        (Boolean(savedObs.slotStart) &&
          Boolean(savedObs.slotEnd) &&
          ((normTime(it.publishedStart || it.s) === normTime(savedObs.slotStart) &&
            normTime(it.publishedEnd || it.e) === normTime(savedObs.slotEnd)) ||
            (Boolean(it.actualStart) &&
              Boolean(it.actualEnd) &&
              normTime(it.actualStart) === normTime(savedObs.slotStart) &&
              normTime(it.actualEnd) === normTime(savedObs.slotEnd))));

      const applyRexToItem = (base: ValidationItem): ValidationItem => {
        // Un REX ne doit jamais écraser silencieusement un créneau explicitement marqué Hors offre ou À ne pas publier
        if (base.cycle1Status === 'excluded') {
          return base;
        }
        if (base.cycle1Status === 'not_published') {
          if (savedObs.status === 'cancelled' && savedObs.cancellationReason === 'instructor') {
            const cleanReason = savedObs.cancellationNote?.trim() || base.nonPublishReason || 'Impératif personnel';
            return {
              ...base,
              rejectReason: `Non publié (C1) : ${cleanReason}`,
              nonPublishReason: cleanReason,
            };
          }
          return base;
        }

        if (savedObs.status === 'cancelled') {
          const reason = savedObs.cancellationReason || 'wind_low';
          const info = CANCELLATION_REASONS_INFO[reason];
          const noteSuffix = savedObs.cancellationNote?.trim();

          if (reason === 'no_clients') {
            return {
              ...base,
              status: 'rejected',
              rejectReason: "Pas d'inscrits (Vie 2)",
              cycle1Status: 'closed_no_bookings',
              nonPublishReason: undefined,
              cycle2Status: undefined,
              monoCount: 0,
              biCount: 0,
              charsCount: 0,
              pilotsCount: 0,
              rescheduledChars: 0,
              lostChars: 0,
            };
          }
          if (reason === 'instructor') {
            const cleanReason = noteSuffix || 'Impératif personnel';
            const slotBookings =
              bookingsMap[buildReservationKey(ds, base.k)] ||
              bookingsMap[buildReservationKey(ds, savedObs.slotKey)] ||
              [];
            const bSummary = getSlotBookingsSummary(slotBookings);
            const hasBookedClients =
              bSummary.totalChars > 0 ||
              (savedObs.bookedParticipantsCount ?? 0) > 0 ||
              ((base.charsCount ?? 0) > 0 && base.cycle1Status === 'published');
            if (hasBookedClients) {
              return {
                ...base,
                status: 'rejected',
                rejectReason: noteSuffix
                  ? `Indisponibilité moniteur · ${noteSuffix}`
                  : 'Annulé (Vie 2) : Indisponibilité moniteur',
                cycle1Status: 'published',
                nonPublishReason: undefined,
                cycle2Status: 'cancelled_weather',
                monoCount: bSummary.monoCount,
                biCount: bSummary.biCount,
                charsCount: bSummary.totalChars,
                pilotsCount: bSummary.totalPeople,
                rescheduledChars: savedObs.rescheduledCount ?? base.rescheduledChars,
                lostChars: savedObs.lostCount ?? base.lostChars,
                assignedPilot: base.assignedPilot || base.instructor || 'Jérôme',
                instructor: base.instructor || base.assignedPilot || 'Jérôme',
                secondaryInstructor: base.secondaryInstructor || savedObs.secondaryInstructor,
              };
            }
            return {
              ...base,
              status: 'rejected',
              rejectReason: `Non publié (C1) : ${cleanReason}`,
              cycle1Status: 'not_published',
              nonPublishReason: cleanReason,
              cycle2Status: undefined,
              monoCount: 0,
              biCount: 0,
              charsCount: 0,
              pilotsCount: 0,
              rescheduledChars: undefined,
              lostChars: undefined,
            };
          }

          const slotBookings =
            bookingsMap[buildReservationKey(ds, base.k)] ||
            bookingsMap[buildReservationKey(ds, savedObs.slotKey)] ||
            [];
          const bSummary = getSlotBookingsSummary(slotBookings);
          const weatherLabel = noteSuffix
            ? `${info?.shortLabel || 'Météo'} · ${noteSuffix}`
            : info?.label || 'Annulé météo (Vie 2)';
          return {
            ...base,
            status: 'rejected',
            rejectReason: weatherLabel,
            cycle1Status: 'published',
            nonPublishReason: undefined,
            cycle2Status: 'cancelled_weather',
            monoCount: bSummary.monoCount,
            biCount: bSummary.biCount,
            charsCount: bSummary.totalChars,
            pilotsCount: bSummary.totalPeople,
            rescheduledChars: savedObs.rescheduledCount ?? base.rescheduledChars,
            lostChars: savedObs.lostCount ?? base.lostChars,
            assignedPilot: base.assignedPilot || base.instructor || 'Jérôme',
            instructor: base.instructor || base.assignedPilot || 'Jérôme',
            secondaryInstructor: base.secondaryInstructor || savedObs.secondaryInstructor,
          };
        }

        // Séance réalisée dans le REX (en conservant l'horaire décalé et le moniteur titulaire)
        const mono = savedObs.monoCount ?? base.monoCount ?? 0;
        const bi = savedObs.biCount ?? base.biCount ?? 0;
        const chars = savedObs.charsCount ?? (mono + bi > 0 ? mono + bi : base.charsCount ?? 0);
        const pilots = savedObs.participantsCount ?? base.pilotsCount ?? mono + bi * 2;
        const obsStartNorm = normalizeSlotTimeHHhMM(savedObs.slotStart);
        const obsEndNorm = normalizeSlotTimeHHhMM(savedObs.slotEnd);
        const basePubStart = base.publishedStart || base.s;
        const obsDiffersFromPub =
          Boolean(obsStartNorm && basePubStart && normTime(obsStartNorm) !== normTime(basePubStart));
        return {
          ...base,
          status: 'valid',
          rejectReason: undefined,
          cycle1Status: 'published',
          nonPublishReason: undefined,
          cycle2Status: 'realized',
          actualStart: base.actualStart || (obsDiffersFromPub ? obsStartNorm : undefined),
          actualEnd: base.actualEnd || (obsDiffersFromPub ? obsEndNorm : undefined),
          shiftMinutes:
            base.shiftMinutes ??
            (obsDiffersFromPub ? computeShiftMinutes(basePubStart, obsStartNorm) : undefined),
          monoCount: mono,
          biCount: bi,
          charsCount: chars,
          pilotsCount: pilots,
          rescheduledChars: undefined,
          lostChars: undefined,
          assignedPilot: base.assignedPilot || base.instructor || 'Jérôme',
          instructor: base.instructor || base.assignedPilot || 'Jérôme',
          secondaryInstructor: base.secondaryInstructor || savedObs.secondaryInstructor,
        };
      };

      if (existingRecord && existingRecord.items && existingRecord.items.length > 0) {
        let matched = false;
        const nextItems = existingRecord.items.map(it => {
          if (matchesObsSlot(it)) {
            matched = true;
            return applyRexToItem(it);
          }
          return it;
        });

        if (!matched) {
          nextItems.push(
            applyRexToItem({
              k: savedObs.slotKey,
              s: savedObs.slotStart,
              e: savedObs.slotEnd,
              publishedStart: savedObs.slotStart,
              publishedEnd: savedObs.slotEnd,
              opt: false,
              over: 0,
              lim: '',
              customTitle: savedObs.customTitle,
              status: 'valid',
              cycle1Status: 'published',
              cycle2Status: 'confirmed',
            })
          );
        }

        persistDayValidation(ds, {
          ...existingRecord,
          ts: Date.now(),
          items: nextItems,
        });
        return;
      }

      // Si la journée n'avait pas encore de fiche validations, n'enregistrer QUE le créneau concerné par ce REX
      // (sans jamais auto-publier les autres créneaux de la journée en Cycle 1).
      const df = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
      const matchedDfSlot = df.list.find(x => {
        const sk = kOf(x);
        const st = lc(x.a, df.y, df.m, df.d);
        const en = lc(x.b, df.y, df.m, df.d);
        return (
          sk === savedObs.slotKey ||
          (Boolean(savedObs.slotStart) &&
            Boolean(savedObs.slotEnd) &&
            normTime(st) === normTime(savedObs.slotStart) &&
            normTime(en) === normTime(savedObs.slotEnd))
        );
      });

      const baseForOnlyRexSlot: ValidationItem = matchedDfSlot
        ? {
            k: kOf(matchedDfSlot),
            s: lc(matchedDfSlot.a, df.y, df.m, df.d),
            e: lc(matchedDfSlot.b, df.y, df.m, df.d),
            publishedStart: lc(matchedDfSlot.a, df.y, df.m, df.d),
            publishedEnd: lc(matchedDfSlot.b, df.y, df.m, df.d),
            opt: matchedDfSlot.opt,
            over: matchedDfSlot.over,
            lim: matchedDfSlot.lim,
            customTitle: matchedDfSlot.customTitle,
            status: 'valid',
            cycle1Status: 'published',
            cycle2Status: 'confirmed',
          }
        : {
            k: savedObs.slotKey,
            s: savedObs.slotStart,
            e: savedObs.slotEnd,
            publishedStart: savedObs.slotStart,
            publishedEnd: savedObs.slotEnd,
            opt: false,
            over: 0,
            lim: '',
            customTitle: savedObs.customTitle,
            status: 'valid',
            cycle1Status: 'published',
            cycle2Status: 'confirmed',
          };

      persistDayValidation(ds, {
        sig: sigOf(df),
        ts: Date.now(),
        k: df.k,
        items: [applyRexToItem(baseForOnlyRexSlot)],
      });
    },
    [validations, isAdminLocked, persistDayValidation, settings, tideW, first, last, windList, customSlotsMap, bookingsMap]
  );

  const resetValidationAfterRexDeleted = useCallback(
    (deletedObs: SlotObservation) => {
      if (!deletedObs || !deletedObs.ds || isAdminLocked) return;
      const ds = deletedObs.ds;
      const existingRecord = validations[ds];
      if (!existingRecord || !existingRecord.items || existingRecord.items.length === 0) {
        return;
      }

      const normTime = (v?: string) => (v || '').trim().replace('h', ':');
      const matchesObsSlot = (it: ValidationItem) =>
        it.k === deletedObs.slotKey ||
        (Boolean(deletedObs.slotStart) &&
          Boolean(deletedObs.slotEnd) &&
          ((normTime(it.publishedStart || it.s) === normTime(deletedObs.slotStart) &&
            normTime(it.publishedEnd || it.e) === normTime(deletedObs.slotEnd)) ||
            (Boolean(it.actualStart) &&
              Boolean(it.actualEnd) &&
              normTime(it.actualStart) === normTime(deletedObs.slotStart) &&
              normTime(it.actualEnd) === normTime(deletedObs.slotEnd))));

      let updatedAny = false;
      let restoredHasBookings = false;
      const nextItems = existingRecord.items.map(it => {
        if (!matchesObsSlot(it)) return it;
        updatedAny = true;

        if (it.cycle1Status === 'excluded' || it.cycle1Status === 'not_published') {
          return it;
        }

        const slotBookings =
          bookingsMap[buildReservationKey(ds, it.k)] ||
          bookingsMap[buildReservationKey(ds, deletedObs.slotKey)] ||
          [];
        const bSummary = getSlotBookingsSummary(slotBookings);
        const hasBookings = bSummary.totalChars > 0;
        if (hasBookings) {
          restoredHasBookings = true;
        }
        const isShifted = Boolean(it.actualStart && it.shiftMinutes && it.shiftMinutes !== 0);

        return {
          ...it,
          status: 'valid' as const,
          rejectReason: undefined,
          nonPublishReason: undefined,
          cycle1Status: 'published' as const,
          cycle2Status: (hasBookings
            ? isShifted
              ? 'shifted'
              : 'confirmed'
            : 'awaiting_booking') as ValidationItem['cycle2Status'],
          monoCount: bSummary.monoCount,
          biCount: bSummary.biCount,
          charsCount: bSummary.totalChars,
          pilotsCount: bSummary.totalPeople,
          rescheduledChars: undefined,
          lostChars: undefined,
        };
      });

      if (!updatedAny) return;

      persistDayValidation(ds, {
        ...existingRecord,
        ts: Date.now(),
        items: nextItems,
      });

      notifySync(
        restoredHasBookings
          ? '🗑 REX supprimé · Créneau remis en Cycle 2 Confirmé (inscriptions conservées)'
          : '🗑 REX supprimé · Créneau remis en Cycle 1 Actif (en attente d’inscription)'
      );
    },
    [validations, isAdminLocked, bookingsMap, persistDayValidation]
  );

  const handleSaveExpressRexBatch = useCallback(
    async (ds: string, obsList: SlotObservation[]) => {
      if (!obsList || obsList.length === 0) return;

      const updatedLocal = bulkUpsertObservations(obsList);
      setObservations(updatedLocal);

      if (!isAdminLocked) {
        const normTime = (v?: string) => (v || '').replace('h', ':');
        const applyRexToItem = (base: ValidationItem, obs: SlotObservation): ValidationItem => {
          if (base.cycle1Status === 'excluded') {
            return base;
          }
          if (base.cycle1Status === 'not_published') {
            if (obs.status === 'cancelled' && obs.cancellationReason === 'instructor') {
              const cleanReason = obs.cancellationNote?.trim() || base.nonPublishReason || 'Impératif personnel';
              return {
                ...base,
                rejectReason: `Non publié (C1) : ${cleanReason}`,
                nonPublishReason: cleanReason,
              };
            }
            return base;
          }

          if (obs.status === 'cancelled') {
            const reason = obs.cancellationReason || 'wind_low';
            const info = CANCELLATION_REASONS_INFO[reason];
            const noteSuffix = obs.cancellationNote?.trim();

            if (reason === 'no_clients') {
              return {
                ...base,
                status: 'rejected',
                rejectReason: "Pas d'inscrits (Vie 2)",
                cycle1Status: 'closed_no_bookings',
                nonPublishReason: undefined,
                cycle2Status: undefined,
                monoCount: 0,
                biCount: 0,
                charsCount: 0,
                pilotsCount: 0,
                rescheduledChars: 0,
                lostChars: 0,
              };
            }
            if (reason === 'instructor') {
              const cleanReason = noteSuffix || 'Impératif personnel';
              const slotBookings =
                bookingsMap[buildReservationKey(ds, base.k)] ||
                bookingsMap[buildReservationKey(ds, obs.slotKey)] ||
                [];
              const bSummary = getSlotBookingsSummary(slotBookings);
              const hasBookedClients =
                bSummary.totalChars > 0 ||
                (obs.bookedParticipantsCount ?? 0) > 0 ||
                ((base.charsCount ?? 0) > 0 && base.cycle1Status === 'published');
              if (hasBookedClients) {
                return {
                  ...base,
                  status: 'rejected',
                  rejectReason: noteSuffix
                    ? `Indisponibilité moniteur · ${noteSuffix}`
                    : 'Annulé (Vie 2) : Indisponibilité moniteur',
                  cycle1Status: 'published',
                  nonPublishReason: undefined,
                  cycle2Status: 'cancelled_weather',
                  monoCount: bSummary.monoCount,
                  biCount: bSummary.biCount,
                  charsCount: bSummary.totalChars,
                  pilotsCount: bSummary.totalPeople,
                  rescheduledChars: obs.rescheduledCount ?? base.rescheduledChars,
                  lostChars: obs.lostCount ?? base.lostChars,
                  assignedPilot: base.assignedPilot || base.instructor || 'Jérôme',
                  instructor: base.instructor || base.assignedPilot || 'Jérôme',
                  secondaryInstructor: base.secondaryInstructor || obs.secondaryInstructor,
                };
              }
              return {
                ...base,
                status: 'rejected',
                rejectReason: `Non publié (C1) : ${cleanReason}`,
                cycle1Status: 'not_published',
                nonPublishReason: cleanReason,
                cycle2Status: undefined,
                monoCount: 0,
                biCount: 0,
                charsCount: 0,
                pilotsCount: 0,
                rescheduledChars: undefined,
                lostChars: undefined,
              };
            }

            const slotBookings =
              bookingsMap[buildReservationKey(ds, base.k)] ||
              bookingsMap[buildReservationKey(ds, obs.slotKey)] ||
              [];
            const bSummary = getSlotBookingsSummary(slotBookings);
            const weatherLabel = noteSuffix
              ? `${info?.shortLabel || 'Météo'} · ${noteSuffix}`
              : info?.label || 'Annulé météo (Vie 2)';
            return {
              ...base,
              status: 'rejected',
              rejectReason: weatherLabel,
              cycle1Status: 'published',
              nonPublishReason: undefined,
              cycle2Status: 'cancelled_weather',
              monoCount: bSummary.monoCount,
              biCount: bSummary.biCount,
              charsCount: bSummary.totalChars,
              pilotsCount: bSummary.totalPeople,
              rescheduledChars: obs.rescheduledCount ?? base.rescheduledChars,
              lostChars: obs.lostCount ?? base.lostChars,
              assignedPilot: base.assignedPilot || base.instructor || 'Jérôme',
              instructor: base.instructor || base.assignedPilot || 'Jérôme',
              secondaryInstructor: base.secondaryInstructor || obs.secondaryInstructor,
            };
          }

          const mono = obs.monoCount ?? base.monoCount ?? 0;
          const bi = obs.biCount ?? base.biCount ?? 0;
          const chars = obs.charsCount ?? (mono + bi > 0 ? mono + bi : base.charsCount ?? 0);
          const pilots = obs.participantsCount ?? base.pilotsCount ?? mono + bi * 2;
          const obsStartNorm = normalizeSlotTimeHHhMM(obs.slotStart);
          const obsEndNorm = normalizeSlotTimeHHhMM(obs.slotEnd);
          const basePubStart = base.publishedStart || base.s;
          const obsDiffersFromPub =
            Boolean(obsStartNorm && basePubStart && normTime(obsStartNorm) !== normTime(basePubStart));
          return {
            ...base,
            status: 'valid',
            rejectReason: undefined,
            cycle1Status: 'published',
            nonPublishReason: undefined,
            cycle2Status: 'realized',
            actualStart: base.actualStart || (obsDiffersFromPub ? obsStartNorm : undefined),
            actualEnd: base.actualEnd || (obsDiffersFromPub ? obsEndNorm : undefined),
            shiftMinutes:
              base.shiftMinutes ??
              (obsDiffersFromPub ? computeShiftMinutes(basePubStart, obsStartNorm) : undefined),
            monoCount: mono,
            biCount: bi,
            charsCount: chars,
            pilotsCount: pilots,
            rescheduledChars: undefined,
            lostChars: undefined,
            assignedPilot: base.assignedPilot || base.instructor || 'Jérôme',
            instructor: base.instructor || base.assignedPilot || 'Jérôme',
            secondaryInstructor: base.secondaryInstructor || obs.secondaryInstructor,
          };
        };

        const df = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        const existingRecord = validations[ds];
        // Ne jamais auto-publier en C1 les autres créneaux d'une journée sans validation C1 préalable
        let nextItems: ValidationItem[] =
          existingRecord && existingRecord.items && existingRecord.items.length > 0
            ? [...existingRecord.items]
            : [];

        for (const obs of obsList) {
          let matched = false;
          nextItems = nextItems.map(it => {
            const isMatch =
              it.k === obs.slotKey ||
              (Boolean(obs.slotStart) &&
                Boolean(obs.slotEnd) &&
                ((normTime(it.publishedStart || it.s) === normTime(obs.slotStart) &&
                  normTime(it.publishedEnd || it.e) === normTime(obs.slotEnd)) ||
                  (Boolean(it.actualStart) &&
                    Boolean(it.actualEnd) &&
                    normTime(it.actualStart) === normTime(obs.slotStart) &&
                    normTime(it.actualEnd) === normTime(obs.slotEnd))));
            if (isMatch) {
              matched = true;
              return applyRexToItem(it, obs);
            }
            return it;
          });
          if (!matched) {
            const matchedDf = df.list.find(x => {
              const sk = kOf(x);
              const st = lc(x.a, df.y, df.m, df.d);
              const en = lc(x.b, df.y, df.m, df.d);
              return (
                sk === obs.slotKey ||
                (Boolean(obs.slotStart) &&
                  Boolean(obs.slotEnd) &&
                  normTime(st) === normTime(obs.slotStart) &&
                  normTime(en) === normTime(obs.slotEnd))
              );
            });
            nextItems.push(
              applyRexToItem(
                matchedDf
                  ? {
                      k: kOf(matchedDf),
                      s: lc(matchedDf.a, df.y, df.m, df.d),
                      e: lc(matchedDf.b, df.y, df.m, df.d),
                      publishedStart: lc(matchedDf.a, df.y, df.m, df.d),
                      publishedEnd: lc(matchedDf.b, df.y, df.m, df.d),
                      opt: matchedDf.opt,
                      over: matchedDf.over,
                      lim: matchedDf.lim,
                      customTitle: matchedDf.customTitle,
                      status: 'valid',
                      cycle1Status: 'published',
                      cycle2Status: 'confirmed',
                    }
                  : {
                      k: obs.slotKey,
                      s: obs.slotStart,
                      e: obs.slotEnd,
                      publishedStart: obs.slotStart,
                      publishedEnd: obs.slotEnd,
                      opt: false,
                      over: 0,
                      lim: '',
                      customTitle: obs.customTitle,
                      status: 'valid',
                      cycle1Status: 'published',
                      cycle2Status: 'confirmed',
                    },
                obs
              )
            );
          }
        }

        persistDayValidation(ds, {
          sig: existingRecord?.sig || sigOf(df),
          ts: Date.now(),
          k: existingRecord?.k || df.k,
          cycle1PublishedAt: existingRecord?.cycle1PublishedAt,
          items: nextItems,
        });
      }

      batchSaveObservationsToFirestore(obsList).catch(err =>
        console.warn('Erreur envoi batch Firestore Bilan Express:', err)
      );

      const realizedCount = obsList.filter(o => o.status === 'realized').length;
      const totalChars = obsList.reduce(
        (acc, o) => acc + (o.status === 'realized' ? o.charsCount || 0 : 0),
        0
      );
      notifySync(
        `⚡ Bilan Express enregistré (${obsList.length} créneaux · ${realizedCount} réalisée${
          realizedCount > 1 ? 's' : ''
        } · ${totalChars} char${totalChars > 1 ? 's' : ''})`
      );
    },
    [validations, isAdminLocked, persistDayValidation, settings, tideW, first, last, windList, customSlotsMap, bookingsMap]
  );

  const buildCycle1DayRecord = useCallback(
    (
      ds: string,
      record: DayFocusData,
      existingRecord: ValidationDayRecord | undefined,
      mode: 'all' | 'wind_only' | 'not_published' = 'all',
      nonPublishReason?: string
    ): ValidationDayRecord => {
      const usedExistingKeys = new Set<string>();
      const normT = (v?: string) => (v || '').trim().replace('h', ':');
      const items: ValidationItem[] = record.list.map(x => {
        const slotKey = kOf(x);
        const startTimeStr = lc(x.a, record.y, record.m, record.d);
        const endTimeStr = lc(x.b, record.y, record.m, record.d);
        const existingItem = existingRecord?.items?.find(
          it =>
            !usedExistingKeys.has(it.k) &&
            (it.k === slotKey ||
              (normT(it.publishedStart || it.s) === normT(startTimeStr) &&
                normT(it.publishedEnd || it.e) === normT(endTimeStr)))
        );
        if (existingItem) usedExistingKeys.add(existingItem.k);
        const effectiveBookingKey = existingItem ? existingItem.k : slotKey;
        const bookingChars = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(ds, effectiveBookingKey)] ||
            bookingsMap[buildReservationKey(ds, slotKey)] ||
            []
        ).totalChars;
        const slotObs = findObservationForSlot(
          ds,
          effectiveBookingKey,
          existingItem?.actualStart || existingItem?.publishedStart || startTimeStr,
          existingItem?.actualEnd || existingItem?.publishedEnd || endTimeStr
        );

        // Préserver intact tout créneau déjà engagé en Cycle 2 (inscrits, décalage, 2e moniteur ou REX)
        if (existingItem && hasCycle2Activity(existingItem, bookingChars, slotObs)) {
          return {
            ...existingItem,
            publishedStart: existingItem.publishedStart || startTimeStr,
            publishedEnd: existingItem.publishedEnd || endTimeStr,
            cycle1Status: 'published',
          };
        }

        if (mode === 'not_published') {
          const cleanReason = nonPublishReason?.trim() || 'Impératif personnel';
          return {
            k: slotKey,
            s: startTimeStr,
            e: endTimeStr,
            publishedStart: startTimeStr,
            publishedEnd: endTimeStr,
            opt: x.opt,
            over: x.over,
            lim: x.lim,
            customTitle: x.customTitle,
            status: 'rejected',
            rejectReason: `Non publié (C1) : ${cleanReason}`,
            cycle1Status: 'not_published',
            nonPublishReason: cleanReason,
            cycle2Status: undefined,
            charsCount: 0,
            monoCount: 0,
            biCount: 0,
            pilotsCount: 0,
          };
        }

        const isBadWind = x.ok === false;
        const closeInC1 = mode === 'wind_only' && isBadWind;

        return {
          k: slotKey,
          s: startTimeStr,
          e: endTimeStr,
          publishedStart: startTimeStr,
          publishedEnd: endTimeStr,
          opt: x.opt,
          over: x.over,
          lim: x.lim,
          customTitle: x.customTitle,
          status: closeInC1 ? 'rejected' : 'valid',
          rejectReason: closeInC1 ? 'Fermé Cycle 1 (vent hors plage, 0 inscrit)' : undefined,
          cycle1Status: closeInC1 ? 'closed_no_bookings' : 'published',
          nonPublishReason: undefined,
          cycle2Status: closeInC1 ? undefined : 'awaiting_booking',
          charsCount: 0,
          monoCount: 0,
          biCount: 0,
          pilotsCount: 0,
        };
      });

      // Ne jamais effacer silencieusement un créneau existant portant déjà des inscrits ou un REX
      for (const oldItem of existingRecord?.items || []) {
        if (usedExistingKeys.has(oldItem.k)) continue;
        const bChars = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(ds, oldItem.k)] || []
        ).totalChars;
        const oldObs = findObservationForSlot(
          ds,
          oldItem.k,
          oldItem.actualStart || oldItem.publishedStart || oldItem.s,
          oldItem.actualEnd || oldItem.publishedEnd || oldItem.e
        );
        if (hasCycle2Activity(oldItem, bChars, oldObs)) {
          items.push(oldItem);
        }
      }

      return {
        sig: sigOf(record),
        ts: Date.now(),
        k: record.k,
        cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
        items,
      };
    },
    [bookingsMap, findObservationForSlot]
  );

  // CYCLE 1 : Publication commerciale ou Non-publication motivée jour par jour (préserve les créneaux déjà en Cycle 2)
  const handleValidateDay = (
    ds: string,
    record: DayFocusData,
    mode: 'all' | 'wind_only' | 'not_published' = 'all',
    nonPublishReason?: string
  ) => {
    if (isAdminLocked) {
      notifySync('🔒 Mode Moniteur / Lecture seule : publications réservées aux administrateurs');
      return;
    }
    if (isCycle1PastLocked(ds)) {
      notifySync('🔒 Archive verrouillée (> 7 jours) : validation Cycle 1 non modifiable');
      return;
    }
    const existingRecord = validations[ds];

    if (mode === 'not_published') {
      const engagedSlots: string[] = [];
      for (const it of existingRecord?.items || []) {
        const bChars = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(ds, it.k)] || []
        ).totalChars;
        const itObs = findObservationForSlot(
          ds,
          it.k,
          it.actualStart || it.publishedStart || it.s,
          it.actualEnd || it.publishedEnd || it.e
        );
        if (bChars > 0 || Boolean(itObs) || hasCycle2Activity(it, bChars, itObs)) {
          engagedSlots.push(`${it.actualStart || it.s}–${it.actualEnd || it.e}`);
        }
      }
      if (engagedSlots.length > 0) {
        notifySync(
          `⛔ Impossible de fermer toute la journée « À ne pas publier » : créneau(x) déjà engagé(s) avec inscrits/REX (${engagedSlots.join(', ')}). Traitez-les d’abord dans Cycle 2.`
        );
        return;
      }
    }

    const nextRecord = buildCycle1DayRecord(ds, record, existingRecord, mode, nonPublishReason);

    persistDayValidation(ds, nextRecord);
    notifySync(
      mode === 'not_published'
        ? `🚫 Journée marquée « À ne pas publier » (${nonPublishReason?.trim() || 'Indisponibilité'})`
        : '📅 Cycle 1 publié (créneaux ouverts sans impact météo court-terme)'
    );
  };

  // CYCLE 1 : Publication groupée sur une semaine ou un mois entier (préserve jours passés, jours "À ne pas publier" et Cycle 2)
  const handleValidateDateRange = useCallback(
    (dates: string[], scopeLabel: string) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Lecture seule : publications réservées aux administrateurs');
        return;
      }
      const todayStr = tdy();
      const batchEntries: Array<{ dateStr: string; data: ValidationDayRecord }> = [];

      for (const ds of dates) {
        if (ds < todayStr || ds < minDs || ds > maxDs) continue;
        const record = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        if (!record || record.list.length === 0) continue;

        const existingRecord = validations[ds];
        // Respecter toute journée déjà explicitement marquée "À ne pas publier" ou "Hors offre"
        if (
          existingRecord &&
          existingRecord.items.length > 0 &&
          existingRecord.items.every(
            it => it.cycle1Status === 'not_published' || it.cycle1Status === 'excluded'
          )
        ) {
          continue;
        }

        // Ne pas écraser une journée dont tous les créneaux ont déjà une décision Cycle 1
        const alreadyCoveredCount = existingRecord
          ? record.list.filter(x => {
              const sk = kOf(x);
              const sStr = lc(x.a, record.y, record.m, record.d);
              const eStr = lc(x.b, record.y, record.m, record.d);
              return existingRecord.items.some(it => it.k === sk || (it.s === sStr && it.e === eStr));
            }).length
          : 0;
        if (alreadyCoveredCount >= record.list.length && existingRecord) {
          continue;
        }

        const built = buildCycle1DayRecord(ds, record, existingRecord, 'all');
        // Si certains créneaux étaient déjà marqués individuellement "not_published", "excluded" ou "closed_no_bookings", les préserver
        if (existingRecord) {
          built.items = built.items.map(it => {
            const prevIt = existingRecord.items.find(
              old => old.k === it.k || (old.s === it.s && old.e === it.e)
            );
            if (
              prevIt &&
              (prevIt.cycle1Status === 'not_published' ||
                prevIt.cycle1Status === 'excluded' ||
                prevIt.cycle1Status === 'closed_no_bookings')
            ) {
              return prevIt;
            }
            return it;
          });
        }

        batchEntries.push({ dateStr: ds, data: built });
      }

      if (batchEntries.length === 0) {
        notifySync(`✓ ${scopeLabel} : toutes les journées ouvrables sont déjà publiées`);
        return;
      }

      setValidations(prev => {
        const updated = { ...prev };
        for (const entry of batchEntries) {
          updated[entry.dateStr] = entry.data;
        }
        try {
          localStorage.setItem(VK, JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });

      saveValidationsBatchToFirestore(batchEntries).catch(err =>
        console.warn('Erreur Firestore batch validation:', err)
      );
      notifySync(
        `📅 ${scopeLabel} : ${batchEntries.length} journée${batchEntries.length > 1 ? 's' : ''} publiée${batchEntries.length > 1 ? 's' : ''} en Cycle 1`
      );
    },
    [isAdminLocked, settings, tideW, first, last, windList, customSlotsMap, validations, buildCycle1DayRecord]
  );

  const handleClearValidation = useCallback((ds: string) => {
    if (isAdminLocked) {
      notifySync('🔒 Mode Moniteur / Lecture seule : réinitialisation verrouillée');
      return;
    }
    if (isCycle1PastLocked(ds)) {
      notifySync('🔒 Archive verrouillée (> 7 jours) : archive Cycle 1 non modifiable');
      return;
    }
    const existingRecord = validations[ds];
    const hasDayBookings = Object.entries(bookingsMap).some(
      ([key, list]) => key.startsWith(`${ds}_`) && getSlotBookingsSummary(list || []).totalChars > 0
    );
    const hasDayRex = observations.some(o => o.ds === ds);
    const engagedLabels = (existingRecord?.items || [])
      .filter(it => {
        const bChars = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(ds, it.k)] || []
        ).totalChars;
        const itObs = findObservationForSlot(
          ds,
          it.k,
          it.actualStart || it.publishedStart || it.s,
          it.actualEnd || it.publishedEnd || it.e
        );
        return bChars > 0 || Boolean(itObs) || hasCycle2Activity(it, bChars, itObs);
      })
      .map(it => `${it.actualStart || it.s}–${it.actualEnd || it.e}`);

    if (hasDayBookings || hasDayRex || engagedLabels.length > 0) {
      notifySync(
        `⛔ Réinitialisation bloquée : cette journée possède déjà des inscrits, un REX ou une activité Cycle 2${engagedLabels.length > 0 ? ` (${engagedLabels.join(', ')})` : ''}. Traitez-les d’abord dans Cycle 2.`
      );
      return;
    }
    persistDayValidation(ds, null);
  }, [isAdminLocked, validations, bookingsMap, observations, findObservationForSlot, persistDayValidation]);

  // CYCLE 1 : Action unitaire sur un créneau (à publier, à ne pas publier + motif, clôturer Vie 2, réinitialiser)
  const handleSetSlotCycle1Action = useCallback(
    (record: DayFocusData, slot: SessionItem, action: Cycle1SlotAction, reason?: string) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Contrôle : actions Cycle 1 verrouillées');
        return;
      }
      const ds = record.ds;
      if (isCycle1PastLocked(ds)) {
        notifySync('🔒 Archive verrouillée (> 7 jours) : archive Cycle 1 non modifiable');
        return;
      }
      const slotKey = kOf(slot);
      const startTimeStr = lc(slot.a, record.y, record.m, record.d);
      const endTimeStr = lc(slot.b, record.y, record.m, record.d);
      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items || [];
      const normT = (v?: string) => (v || '').trim().replace('h', ':');
      const existingItem = currentItems.find(
        it =>
          it.k === slotKey ||
          (normT(it.publishedStart || it.s) === normT(startTimeStr) &&
            normT(it.publishedEnd || it.e) === normT(endTimeStr))
      );
      const matchedItemKey = existingItem ? existingItem.k : slotKey;
      const effectiveBookingKey = matchedItemKey;
      const bSummary = getSlotBookingsSummary(
        bookingsMap[buildReservationKey(ds, effectiveBookingKey)] ||
          bookingsMap[buildReservationKey(ds, slotKey)] ||
          []
      );
      const existingSlotObs = findObservationForSlot(
        ds,
        existingItem?.k || slotKey,
        existingItem?.actualStart || existingItem?.publishedStart || startTimeStr,
        existingItem?.actualEnd || existingItem?.publishedEnd || endTimeStr
      );

      let nextItems: ValidationItem[];
      if (action === 'reset') {
        if (
          (existingItem && hasCycle2Activity(existingItem, bSummary.totalChars, existingSlotObs)) ||
          bSummary.totalChars > 0 ||
          Boolean(existingSlotObs)
        ) {
          notifySync(
            '⛔ Ce créneau possède déjà une activité Cycle 2 (inscrits, décalage, 2e moniteur ou REX) : impossible de le réinitialiser.'
          );
          return;
        }
        nextItems = currentItems.filter(it => it.k !== matchedItemKey);
      } else {
        if (
          (action === 'excluded' || action === 'not_published' || action === 'close_no_bookings') &&
          (bSummary.totalChars > 0 ||
            Boolean(existingSlotObs) ||
            (existingItem && hasCycle2Activity(existingItem, bSummary.totalChars, existingSlotObs)))
        ) {
          notifySync(
            '⛔ Action bloquée : ce créneau possède déjà des inscrits, un REX ou une activité Cycle 2.'
          );
          return;
        }
        const cleanReason = reason?.trim() || 'Impératif personnel';
        const preservedActiveC2 =
          existingItem?.cycle2Status &&
          existingItem.cycle2Status !== 'awaiting_booking' &&
          (existingItem.cycle2Status !== 'confirmed' || bSummary.totalChars > 0)
            ? existingItem.cycle2Status
            : bSummary.totalChars > 0
            ? 'confirmed'
            : 'awaiting_booking';
        const nextItem: ValidationItem =
          action === 'excluded'
            ? {
                k: slotKey,
                s: existingItem?.publishedStart || startTimeStr,
                e: existingItem?.publishedEnd || endTimeStr,
                publishedStart: existingItem?.publishedStart || startTimeStr,
                publishedEnd: existingItem?.publishedEnd || endTimeStr,
                opt: slot.opt,
                over: slot.over,
                lim: slot.lim,
                customTitle: slot.customTitle,
                status: 'rejected',
                rejectReason: 'Hors offre / Non pertinent (C1)',
                cycle1Status: 'excluded',
                nonPublishReason: undefined,
                cycle2Status: undefined,
                charsCount: 0,
                monoCount: 0,
                biCount: 0,
                pilotsCount: 0,
              }
            : action === 'not_published'
            ? {
                k: slotKey,
                s: existingItem?.publishedStart || startTimeStr,
                e: existingItem?.publishedEnd || endTimeStr,
                publishedStart: existingItem?.publishedStart || startTimeStr,
                publishedEnd: existingItem?.publishedEnd || endTimeStr,
                opt: slot.opt,
                over: slot.over,
                lim: slot.lim,
                customTitle: slot.customTitle,
                status: 'rejected',
                rejectReason: `Non publié (C1) : ${cleanReason}`,
                cycle1Status: 'not_published',
                nonPublishReason: cleanReason,
                cycle2Status: undefined,
                charsCount: 0,
                monoCount: 0,
                biCount: 0,
                pilotsCount: 0,
              }
            : action === 'close_no_bookings'
            ? {
                k: slotKey,
                s: existingItem?.publishedStart || startTimeStr,
                e: existingItem?.publishedEnd || endTimeStr,
                publishedStart: existingItem?.publishedStart || startTimeStr,
                publishedEnd: existingItem?.publishedEnd || endTimeStr,
                opt: slot.opt,
                over: slot.over,
                lim: slot.lim,
                customTitle: slot.customTitle,
                status: 'rejected',
                rejectReason: "Pas d'inscrits (Vie 2)",
                cycle1Status: 'closed_no_bookings',
                nonPublishReason: undefined,
                cycle2Status: undefined,
                charsCount: 0,
                monoCount: 0,
                biCount: 0,
                pilotsCount: 0,
              }
            : {
                ...(existingItem || {}),
                k: slotKey,
                s: existingItem?.s || existingItem?.publishedStart || startTimeStr,
                e: existingItem?.e || existingItem?.publishedEnd || endTimeStr,
                publishedStart: existingItem?.publishedStart || startTimeStr,
                publishedEnd: existingItem?.publishedEnd || endTimeStr,
                opt: slot.opt,
                over: slot.over,
                lim: slot.lim,
                customTitle: existingItem?.customTitle ?? slot.customTitle,
                status: 'valid',
                rejectReason: undefined,
                cycle1Status: 'published',
                nonPublishReason: undefined,
                cycle2Status: preservedActiveC2,
                charsCount: bSummary.totalChars > 0 ? bSummary.totalChars : existingItem?.charsCount ?? 0,
                monoCount: bSummary.totalChars > 0 ? bSummary.monoCount : existingItem?.monoCount ?? 0,
                biCount: bSummary.totalChars > 0 ? bSummary.biCount : existingItem?.biCount ?? 0,
                pilotsCount: bSummary.totalChars > 0 ? bSummary.totalPeople : existingItem?.pilotsCount ?? 0,
              };

        nextItems = existingItem
          ? currentItems.map(it => (it.k === matchedItemKey ? nextItem : it))
          : [...currentItems, nextItem];
      }

      persistDayValidation(
        ds,
        nextItems.length === 0
          ? null
          : {
              sig: sigOf(record),
              ts: Date.now(),
              k: record.k,
              cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
              items: nextItems,
            }
      );
    },
    [isAdminLocked, validations, persistDayValidation, bookingsMap, findObservationForSlot]
  );

  // CYCLE 1 : Écarter d'un clic tous les créneaux encore indécis de la journée en "Hors offre / Non pertinent (hors stats)"
  const handleExcludeRemainingCycle1Slots = useCallback(
    (record: DayFocusData) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Contrôle : actions Cycle 1 verrouillées');
        return;
      }
      const ds = record.ds;
      if (isCycle1PastLocked(ds)) {
        notifySync('🔒 Archive verrouillée (> 7 jours) : archive Cycle 1 non modifiable');
        return;
      }

      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items ? [...existingRecord.items] : [];
      let addedCount = 0;

      for (const slot of record.list) {
        const slotKey = kOf(slot);
        const startTimeStr = lc(slot.a, record.y, record.m, record.d);
        const endTimeStr = lc(slot.b, record.y, record.m, record.d);
        const existingIdx = currentItems.findIndex(
          it => it.k === slotKey || (it.s === startTimeStr && it.e === endTimeStr)
        );
        const existingItem = existingIdx >= 0 ? currentItems[existingIdx] : undefined;
        const effectiveKey = existingItem ? existingItem.k : slotKey;
        const bookingChars = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(ds, effectiveKey)] ||
            bookingsMap[buildReservationKey(ds, slotKey)] ||
            []
        ).totalChars;

        if (existingItem && hasCycle2Activity(existingItem, bookingChars)) {
          continue;
        }
        if (existingItem) {
          continue;
        }

        currentItems.push({
          k: slotKey,
          s: startTimeStr,
          e: endTimeStr,
          publishedStart: startTimeStr,
          publishedEnd: endTimeStr,
          opt: slot.opt,
          over: slot.over,
          lim: slot.lim,
          customTitle: slot.customTitle,
          status: 'rejected',
          rejectReason: 'Hors offre / Non pertinent (C1)',
          cycle1Status: 'excluded',
          nonPublishReason: undefined,
          cycle2Status: undefined,
          charsCount: 0,
          monoCount: 0,
          biCount: 0,
          pilotsCount: 0,
        });
        addedCount++;
      }

      if (addedCount === 0) return;

      persistDayValidation(ds, {
        sig: sigOf(record),
        ts: Date.now(),
        k: record.k,
        cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
        items: currentItems,
      });
      notifySync(
        `➖ ${addedCount} créneau${addedCount > 1 ? 'x' : ''} non retenu${addedCount > 1 ? 's' : ''} écarté${addedCount > 1 ? 's' : ''} (hors offre · hors stats)`
      );
    },
    [isAdminLocked, validations, bookingsMap, persistDayValidation]
  );

  // Requalification rétroactive de motifs de fermeture / non-publication depuis Statistiques
  const handleReclassifyAbsentValidations = useCallback(
    (targets: { ds: string; slotKey: string }[], newReason: string) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Lecture seule : modification des motifs verrouillée');
        return;
      }
      const cleanReason = newReason.trim();
      if (!cleanReason || targets.length === 0) return;

      const byDate = new Map<string, Set<string>>();
      targets.forEach(t => {
        if (!byDate.has(t.ds)) byDate.set(t.ds, new Set());
        byDate.get(t.ds)!.add(t.slotKey);
      });

      byDate.forEach((slotKeys, ds) => {
        const rec = validations[ds];
        if (!rec || !rec.items) return;
        let changed = false;
        const nextItems = rec.items.map(it => {
          if (!slotKeys.has(it.k)) return it;
          changed = true;
          return {
            ...it,
            nonPublishReason: cleanReason,
            rejectReason:
              it.cycle1Status === 'not_published'
                ? `Non publié (C1) : ${cleanReason}`
                : it.rejectReason,
          };
        });
        if (changed) {
          persistDayValidation(ds, {
            ...rec,
            ts: Date.now(),
            items: nextItems,
          });
        }
      });
    },
    [validations, persistDayValidation, isAdminLocked]
  );

  // PASSAGE AUTOMATIQUE CYCLE 1 -> CYCLE 2 DÈS LA 1ÈRE INSCRIPTION
  const handleSaveSlotBookings = useCallback(
    (
      ds: string,
      slotKey: string,
      slotStart: string,
      slotEnd: string,
      bookings: AgendaBookingItem[]
    ) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Contrôle : réservations en consultation seule');
        return;
      }
      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items || [];
      const existingItem = currentItems.find(it => it.k === slotKey);
      const isPublishedC1 = Boolean(existingItem && getEffectiveCycle1Status(existingItem) === 'published');
      if (!isPublishedC1 || !existingItem) {
        notifySync('⛔ Créneau non validé « À publier » en Cycle 1 : validez-le d’abord dans Validation des créneaux.');
        return;
      }

      const slotMaxChars = getSlotMaxCapacity(existingItem);
      const summary = getSlotBookingsSummary(bookings, slotMaxChars);

      if (summary.totalChars > slotMaxChars) {
        notifySync(
          `⛔ Blocage encadrement : ${summary.totalChars}/${slotMaxChars} chars max autorisés (${
            existingItem.secondaryInstructor
              ? `${existingItem.instructor || 'Jérôme'} + ${existingItem.secondaryInstructor}`
              : '1 moniteur'
          }). Enregistrement bloqué.`
        );
        return;
      }

      const resKey = buildReservationKey(ds, slotKey);
      setBookingsMap(prev => ({ ...prev, [resKey]: bookings }));
      saveBookingToFirestore(resKey, bookings).catch(err =>
        console.warn('Erreur Firestore réservations:', err)
      );

      const instructor = getActiveInstructor() || 'Jérôme';

      const preservedC2Status =
        existingItem.cycle2Status && existingItem.cycle2Status !== 'awaiting_booking'
          ? existingItem.cycle2Status
          : 'confirmed';

      const nextItem: ValidationItem =
        summary.totalChars > 0
          ? {
              ...existingItem,
              k: slotKey,
              s: existingItem.s || slotStart,
              e: existingItem.e || slotEnd,
              publishedStart: existingItem.publishedStart || slotStart,
              publishedEnd: existingItem.publishedEnd || slotEnd,
              cycle1Status: 'published',
              cycle2Status: preservedC2Status,
              status: existingItem.status === 'rejected' && preservedC2Status === 'cancelled_weather' ? 'rejected' : 'valid',
              rejectReason:
                existingItem.status === 'rejected' && preservedC2Status === 'cancelled_weather'
                  ? existingItem.rejectReason
                  : undefined,
              assignedPilot: existingItem.assignedPilot || instructor,
              instructor: existingItem.instructor || instructor,
              charsCount: summary.totalChars,
              monoCount: summary.monoCount,
              biCount: summary.biCount,
              pilotsCount: summary.totalPeople,
            }
          : {
              ...existingItem,
              k: slotKey,
              s: existingItem.s || slotStart,
              e: existingItem.e || slotEnd,
              publishedStart: existingItem.publishedStart || slotStart,
              publishedEnd: existingItem.publishedEnd || slotEnd,
              cycle1Status: 'published',
              cycle2Status: preservedC2Status,
              charsCount: 0,
              monoCount: 0,
              biCount: 0,
              pilotsCount: 0,
            };

      notifySync(
        summary.totalChars > 0
          ? `👥 ${summary.totalChars}/${slotMaxChars} char(s) enregistré(s)`
          : '👥 Compteur mis à jour : 0 char saisi (créneau maintenu actif en Cycle 2)'
      );

      const nextItems = currentItems.map(it => (it.k === slotKey ? nextItem : it));

      persistDayValidation(ds, {
        sig: existingRecord?.sig || slotKey,
        ts: Date.now(),
        k: existingRecord?.k || 'g',
        cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
        items: nextItems,
      });
    },
    [isAdminLocked, validations, persistDayValidation]
  );

  // CYCLE 2 : Décisions tactiques terrain (Maintenir, Décaler, Regrouper, Annuler Vie 2, REX)
  const handleCycle2Action = useCallback(
    (record: DayFocusData, slot: SessionItem, payload: Cycle2ActionPayload) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Contrôle : pilotage Cycle 2 réservé aux administrateurs');
        return;
      }

      const ds = record.ds;
      const slotKey = kOf(slot);
      const startTimeStr = lc(slot.a, record.y, record.m, record.d);
      const endTimeStr = lc(slot.b, record.y, record.m, record.d);
      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items || [];

      if (payload.type === 'purge_orphan') {
        const targetKey = payload.valItemKey || slotKey;
        const targetItem = currentItems.find(it => it.k === targetKey);
        const orphanObs = findObservationForSlot(
          ds,
          targetKey,
          targetItem?.actualStart || targetItem?.publishedStart || targetItem?.s || startTimeStr,
          targetItem?.actualEnd || targetItem?.publishedEnd || targetItem?.e || endTimeStr
        );
        if (orphanObs) {
          notifySync(
            '⛔ Suppression bloquée : un REX terrain est encore rattaché à ce reliquat. Supprimez ou réconciliez d’abord le REX.'
          );
          return;
        }
        const nextItems = currentItems.filter(it => it.k !== targetKey);
        persistDayValidation(
          ds,
          nextItems.length === 0
            ? null
            : {
                sig: sigOf(record),
                ts: Date.now(),
                k: record.k,
                cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
                items: nextItems,
              }
        );
        const resKey = buildReservationKey(ds, targetKey);
        if ((bookingsMap[resKey]?.length ?? 0) > 0) {
          setBookingsMap(prev => {
            const next = { ...prev };
            delete next[resKey];
            return next;
          });
          saveBookingToFirestore(resKey, []).catch(err =>
            console.warn('Erreur Firestore purge réservations orphelines:', err)
          );
        }
        notifySync('🗑️ Reliquat orphelin supprimé · planning aligné');
        return;
      }

      const existingItem = currentItems.find(it => it.k === slotKey);
      const bSummary = getSlotBookingsSummary(
        bookingsMap[buildReservationKey(ds, existingItem ? existingItem.k : slotKey)] ||
          bookingsMap[buildReservationKey(ds, slotKey)] ||
          []
      );
      const bookingChars = bSummary.totalChars;
      const isValidatedC1 =
        (existingItem &&
          (getEffectiveCycle1Status(existingItem) === 'published' ||
            (payload.type === 'reset_to_cycle1' &&
              getEffectiveCycle1Status(existingItem) === 'closed_no_bookings'))) ||
        hasCycle2Trigger(existingItem, bookingChars);
      if (!isValidatedC1) {
        notifySync('⛔ Créneau non validé en Cycle 1 : publiez-le d’abord dans Validation (C1)');
        return;
      }

      const existingCounts = getValidationItemChars(existingItem);
      const instructor = getActiveInstructor() || 'Jérôme';

      const baseItem: ValidationItem = existingItem || {
        k: slotKey,
        s: startTimeStr,
        e: endTimeStr,
        publishedStart: startTimeStr,
        publishedEnd: endTimeStr,
        opt: slot.opt,
        over: slot.over,
        lim: slot.lim,
        customTitle: slot.customTitle,
      };

      let nextItems = [...currentItems];
      let updatedSource: ValidationItem = { ...baseItem };

      if (payload.type === 'confirm' || payload.type === 'realized') {
        const mono = payload.monoCount ?? existingCounts.mono;
        const bi = payload.biCount ?? existingCounts.bi;
        const chars = mono + bi > 0 ? mono + bi : Math.max(bookingChars, existingCounts.totalChars);
        if (payload.type === 'realized' && chars <= 0) {
          notifySync(
            '⛔ Blocage : impossible de marquer une séance « Effectuée » avec 0 char. Renseignez au moins 1 char (ou classez « Pas d’inscrits »).'
          );
          return;
        }
        const slotMaxChars = getSlotMaxCapacity(existingItem);
        if (chars > slotMaxChars) {
          notifySync(
            `⛔ Blocage encadrement : ${chars}/${slotMaxChars} chars max autorisés sur ce créneau. Enregistrement bloqué.`
          );
          return;
        }
        updatedSource = {
          ...baseItem,
          publishedStart: baseItem.publishedStart || startTimeStr,
          publishedEnd: baseItem.publishedEnd || endTimeStr,
          cycle1Status: 'published',
          cycle2Status: payload.type === 'realized' ? 'realized' : 'confirmed',
          status: 'valid',
          rejectReason: undefined,
          assignedPilot: payload.instructor || instructor,
          instructor: payload.instructor || instructor,
          monoCount: mono,
          biCount: bi,
          charsCount: chars,
          pilotsCount: payload.pilotsCount ?? (mono + bi > 0 ? mono + bi * 2 : existingCounts.people),
        };
        notifySync(
          payload.type === 'realized'
            ? chars > 0
              ? `🏁 Séance effectuée (${chars} char${chars > 1 ? 's' : ''})`
              : '🏁 Séance marquée effectuée'
            : chars > 0
            ? `⚡ Cycle 2 · Confirmé (${chars} char${chars > 1 ? 's' : ''})`
            : '⚡ Cycle 2 · Créneau confirmé'
        );
      } else if (payload.type === 'shift') {
        const cleanNewStart = normalizeSlotTimeHHhMM(payload.newStart);
        const cleanNewEnd = normalizeSlotTimeHHhMM(payload.newEnd);
        const newStartMin = parseTimeMinutes(cleanNewStart);
        const newEndMin = parseTimeMinutes(cleanNewEnd);
        if (newStartMin === null || newEndMin === null || newEndMin <= newStartMin) {
          notifySync('⛔ Horaire décalé invalide : l’heure de fin doit être postérieure à l’heure de début.');
          return;
        }
        // Garde-fou anti-chevauchement avec toute autre séance active / publiée du jour
        const conflictingActive = currentItems.find(it => {
          if (it.k === baseItem.k) return false;
          if (
            it.status === 'rejected' ||
            it.cycle1Status === 'excluded' ||
            it.cycle1Status === 'not_published' ||
            it.cycle1Status === 'closed_no_bookings' ||
            it.cycle2Status === 'merged' ||
            it.cycle2Status === 'cancelled_weather'
          ) {
            return false;
          }
          const oStart = parseTimeMinutes(it.actualStart || it.publishedStart || it.s);
          const oEnd = parseTimeMinutes(it.actualEnd || it.publishedEnd || it.e);
          if (oStart === null || oEnd === null) return false;
          return newStartMin < oEnd && newEndMin > oStart;
        });
        if (conflictingActive) {
          const cLabel = `${conflictingActive.actualStart || conflictingActive.publishedStart || conflictingActive.s}–${conflictingActive.actualEnd || conflictingActive.publishedEnd || conflictingActive.e}`;
          notifySync(
            `⛔ Décalage bloqué : ${cleanNewStart}–${cleanNewEnd} chevauche la séance active ${cLabel}. Décalez d’abord l’autre créneau ou regroupez.`
          );
          return;
        }

        const origStart = baseItem.publishedStart || startTimeStr;
        const computedDelta = computeShiftMinutes(origStart, cleanNewStart);
        const effectiveShift = computedDelta ?? payload.shiftMinutes;
        const isZeroShift = effectiveShift === 0 || payload.shiftMinutes === 0;
        const nextC2AfterShift =
          baseItem.cycle2Status === 'realized'
            ? 'realized'
            : isZeroShift
            ? 'confirmed'
            : 'shifted';
        updatedSource = {
          ...baseItem,
          publishedStart: origStart,
          publishedEnd: baseItem.publishedEnd || endTimeStr,
          actualStart: isZeroShift ? undefined : cleanNewStart,
          actualEnd: isZeroShift ? undefined : cleanNewEnd,
          shiftMinutes: isZeroShift ? undefined : effectiveShift,
          cycle1Status: 'published',
          cycle2Status: nextC2AfterShift,
          status: 'valid',
          rejectReason: undefined,
          assignedPilot: baseItem.assignedPilot || instructor,
          instructor: baseItem.instructor || instructor,
        };
        const existingSlotObs = findObservationForSlot(
          ds,
          baseItem.k,
          baseItem.actualStart || origStart,
          baseItem.actualEnd || baseItem.publishedEnd || endTimeStr
        );
        if (existingSlotObs) {
          const syncedObs: SlotObservation = {
            ...existingSlotObs,
            slotKey: baseItem.k,
            slotStart: isZeroShift ? origStart : cleanNewStart,
            slotEnd: isZeroShift ? baseItem.publishedEnd || endTimeStr : cleanNewEnd,
            timeDeltaMin: isZeroShift ? 0 : effectiveShift,
            updatedAt: Date.now(),
          };
          const updatedObsList = upsertSlotObservation(syncedObs);
          setObservations(updatedObsList);
          saveObservationToFirestore(syncedObs).catch(err =>
            console.warn('Erreur Firestore sync horaire REX décalé:', err)
          );
        }
        notifySync(
          isZeroShift
            ? '🕒 Horaire rétabli sur Cycle 1'
            : `🕒 Séance décalée (${effectiveShift > 0 ? '+' : ''}${effectiveShift} min) ➔ ${cleanNewStart} - ${cleanNewEnd} (mémorisée)`
        );
      } else if (payload.type === 'merge') {
        const sourceObs = findObservationForSlot(
          ds,
          baseItem.k,
          baseItem.actualStart || baseItem.publishedStart || startTimeStr,
          baseItem.actualEnd || baseItem.publishedEnd || endTimeStr
        );
        if (sourceObs) {
          notifySync(
            '⛔ Regroupement bloqué : un REX est déjà enregistré sur cette séance. Supprimez d’abord le REX avant de regrouper.'
          );
          return;
        }
        if (payload.targetSlotKey === baseItem.k) {
          notifySync('⛔ Impossible de regrouper un créneau sur lui-même.');
          return;
        }

        // Vérifier le plafond AVANT toute fusion (blocage strict à 12 / 20 / 24 chars selon encadrement cible)
        const targetSess = record.list.find(s => kOf(s) === payload.targetSlotKey);
        const sourceResKey = buildReservationKey(ds, baseItem.k);
        const targetResKey = buildReservationKey(ds, payload.targetSlotKey);
        const sourceBookings = bookingsMap[sourceResKey] || [];
        const targetBookings = bookingsMap[targetResKey] || [];

        if (targetSess) {
          const existingTarget = currentItems.find(it => it.k === payload.targetSlotKey);
          const tCounts = getValidationItemChars(existingTarget);
          const tBook = getSlotBookingsSummary(targetBookings);
          const sourceEffectiveChars = Math.max(bookingChars, existingCounts.totalChars);
          const targetEffectiveChars = Math.max(tBook.totalChars, tCounts.totalChars);
          const combChars = sourceEffectiveChars + targetEffectiveChars;
          const targetMaxChars = getSlotMaxCapacity(existingTarget);
          if (combChars > targetMaxChars) {
            notifySync(
              `⛔ Regroupement bloqué : ${combChars}/${targetMaxChars} chars dépasserait le plafond encadrement (${
                existingTarget?.secondaryInstructor
                  ? `${existingTarget.instructor || 'Jérôme'} + ${existingTarget.secondaryInstructor}`
                  : '1 moniteur'
              }). Doublez le créneau cible ou scindez.`
            );
            return;
          }
        }

        // Migrer réellement les réservations clients de la source vers la cible (zéro perte & zéro double comptage)
        let mergedBookingsList = targetBookings;
        if (sourceBookings.length > 0 && targetSess) {
          const existingTargetIds = new Set(targetBookings.map(b => b.id));
          mergedBookingsList = [
            ...targetBookings,
            ...sourceBookings.filter(b => !existingTargetIds.has(b.id)),
          ];
          setBookingsMap(prev => {
            const next = { ...prev, [targetResKey]: mergedBookingsList };
            delete next[sourceResKey];
            return next;
          });
          saveBookingToFirestore(targetResKey, mergedBookingsList).catch(err =>
            console.warn('Erreur Firestore fusion réservations cible:', err)
          );
          saveBookingToFirestore(sourceResKey, []).catch(err =>
            console.warn('Erreur Firestore purge réservations source fusionnée:', err)
          );
        }

        updatedSource = {
          ...baseItem,
          publishedStart: baseItem.publishedStart || startTimeStr,
          publishedEnd: baseItem.publishedEnd || endTimeStr,
          cycle1Status: 'published',
          cycle2Status: 'merged',
          mergedIntoKey: payload.targetSlotKey,
          mergedLabel: payload.targetLabel,
          status: 'rejected',
          rejectReason: `Regroupé vers ${payload.targetLabel}`,
          monoCount: 0,
          biCount: 0,
          charsCount: 0,
          pilotsCount: 0,
        };

        // Mettre à jour la jauge combinée sur le créneau cible
        if (targetSess) {
          const tStart = lc(targetSess.a, record.y, record.m, record.d);
          const tEnd = lc(targetSess.b, record.y, record.m, record.d);
          const existingTarget = nextItems.find(it => it.k === payload.targetSlotKey);
          const tCounts = getValidationItemChars(existingTarget);
          const mergedBookSum = getSlotBookingsSummary(mergedBookingsList);
          const combMono =
            mergedBookSum.totalChars > 0
              ? mergedBookSum.monoCount
              : tCounts.mono + existingCounts.mono;
          const combBi =
            mergedBookSum.totalChars > 0
              ? mergedBookSum.biCount
              : tCounts.bi + existingCounts.bi;
          const combChars =
            mergedBookSum.totalChars > 0
              ? mergedBookSum.totalChars
              : tCounts.totalChars + existingCounts.totalChars;
          const combPeople =
            mergedBookSum.totalChars > 0
              ? mergedBookSum.totalPeople
              : tCounts.people + existingCounts.people;

          const updatedTarget: ValidationItem = {
            ...(existingTarget || {
              k: payload.targetSlotKey,
              s: tStart,
              e: tEnd,
              publishedStart: tStart,
              publishedEnd: tEnd,
              opt: targetSess.opt,
              over: targetSess.over,
              lim: targetSess.lim,
              customTitle: targetSess.customTitle,
            }),
            cycle1Status: 'published',
            cycle2Status:
              existingTarget?.cycle2Status && existingTarget.cycle2Status !== 'awaiting_booking'
                ? existingTarget.cycle2Status
                : 'confirmed',
            status: 'valid',
            assignedPilot: existingTarget?.assignedPilot || instructor,
            instructor: existingTarget?.instructor || instructor,
            monoCount: combMono,
            biCount: combBi,
            charsCount: combChars,
            pilotsCount: combPeople,
          };

          nextItems = existingTarget
            ? nextItems.map(it => (it.k === payload.targetSlotKey ? updatedTarget : it))
            : [...nextItems, updatedTarget];

          const targetMaxChars = getSlotMaxCapacity(existingTarget);
          notifySync(
            `🔗 Regroupé sur ${payload.targetLabel} (${combChars}/${targetMaxChars} chars · fiches clients transférées)`
          );
        }
      } else if (payload.type === 'double_instructor') {
        const cleanSec = payload.secondaryInstructor?.trim();
        const currentSlotChars = Math.max(bookingChars, existingCounts.totalChars);
        if (!cleanSec) {
          if (currentSlotChars > MAX_CHARS_PER_INSTRUCTOR) {
            notifySync(
              `⛔ Impossible de retirer ${baseItem.secondaryInstructor || 'le 2e moniteur'} : ${currentSlotChars} chars engagés dépassent le plafond solo de ${MAX_CHARS_PER_INSTRUCTOR} chars.`
            );
            return;
          }
          updatedSource = {
            ...baseItem,
            publishedStart: baseItem.publishedStart || startTimeStr,
            publishedEnd: baseItem.publishedEnd || endTimeStr,
            secondaryInstructor: undefined,
            secondaryQualification: undefined,
            secondaryMaxChars: undefined,
            secondaryActualEnd: undefined,
            secondaryFormula: undefined,
          };
          notifySync(`👤 2e moniteur retiré · Plafond rétabli à ${MAX_CHARS_PER_INSTRUCTOR} chars`);
        } else {
          const addChars =
            payload.secondaryMaxChars != null
              ? Math.max(1, Number(payload.secondaryMaxChars) || 8)
              : payload.secondaryQualification === 'CQP'
              ? 8
              : MAX_CHARS_PER_INSTRUCTOR;
          const totalCap = MAX_CHARS_PER_INSTRUCTOR + addChars;
          if (currentSlotChars > totalCap) {
            notifySync(
              `⛔ Plafond insuffisant (${totalCap} chars max) pour les ${currentSlotChars} chars déjà engagés sur ce créneau.`
            );
            return;
          }
          updatedSource = {
            ...baseItem,
            publishedStart: baseItem.publishedStart || startTimeStr,
            publishedEnd: baseItem.publishedEnd || endTimeStr,
            cycle1Status: 'published',
            cycle2Status: baseItem.cycle2Status || (existingCounts.totalChars > 0 ? 'confirmed' : 'awaiting_booking'),
            status: 'valid',
            assignedPilot: baseItem.assignedPilot || instructor,
            instructor: baseItem.instructor || instructor,
            secondaryInstructor: cleanSec,
            secondaryQualification: payload.secondaryQualification || (addChars <= 8 ? 'CQP' : 'DE_BPJEPS'),
            secondaryMaxChars: addChars,
            secondaryActualEnd: payload.secondaryActualEnd?.trim() || undefined,
            secondaryFormula: payload.secondaryFormula?.trim() || undefined,
          };
          notifySync(
            `👥 Créneau doublé : ${updatedSource.instructor} + ${cleanSec} (${totalCap} chars max)`
          );
        }
      } else if (payload.type === 'cancel_weather') {
        const isNoBookings =
          payload.reason.toLowerCase().includes('pas d\'inscrit') ||
          payload.reason.toLowerCase().includes('0 réservation');
        if (isNoBookings) {
          if (bookingChars > 0) {
            notifySync(
              `⛔ Impossible de clôturer « Pas d'inscrits » : ${bookingChars} char${bookingChars > 1 ? 's' : ''} encore inscrit${bookingChars > 1 ? 's' : ''} sur ce créneau. Retirez ou transférez d’abord les réservations.`
            );
            return;
          }
          updatedSource = {
            ...baseItem,
            publishedStart: baseItem.publishedStart || startTimeStr,
            publishedEnd: baseItem.publishedEnd || endTimeStr,
            cycle1Status: 'closed_no_bookings',
            cycle2Status: undefined,
            status: 'rejected',
            rejectReason: "Pas d'inscrits (Vie 2)",
            monoCount: 0,
            biCount: 0,
            charsCount: 0,
            pilotsCount: 0,
            rescheduledChars: 0,
            lostChars: 0,
          };
          notifySync("⛔ Annulé (Vie 2) : Pas d'inscrits");
        } else {
          updatedSource = {
            ...baseItem,
            publishedStart: baseItem.publishedStart || startTimeStr,
            publishedEnd: baseItem.publishedEnd || endTimeStr,
            cycle1Status: 'published',
            cycle2Status: 'cancelled_weather',
            status: 'rejected',
            rejectReason: payload.reason,
            rescheduledChars: payload.rescheduledChars ?? 0,
            lostChars: payload.lostChars ?? 0,
          };
          notifySync(`⛔ Annulé météo (Vie 2) : ${payload.reason}`);
        }
      } else if (payload.type === 'reset_to_cycle1') {
        if (ds < tdy()) {
          notifySync(
            '🔒 Date passée : impossible de revenir en Cycle 1 (utilisez la fiche REX pour corriger une séance passée).'
          );
          return;
        }
        const existingSlotObs = findObservationForSlot(
          ds,
          baseItem.k,
          baseItem.actualStart || baseItem.publishedStart || startTimeStr,
          baseItem.actualEnd || baseItem.publishedEnd || endTimeStr
        );
        if (existingSlotObs) {
          notifySync(
            '⛔ Un REX est enregistré sur cette séance : modifiez ou supprimez d’abord le REX avant d’annuler la décision Cycle 2.'
          );
          return;
        }
        const resetMono = bSummary.totalChars > 0 ? bSummary.monoCount : 0;
        const resetBi = bSummary.totalChars > 0 ? bSummary.biCount : 0;
        const resetChars = bSummary.totalChars > 0 ? bSummary.totalChars : 0;
        const resetPeople = bSummary.totalChars > 0 ? bSummary.totalPeople : 0;
        updatedSource = {
          ...baseItem,
          publishedStart: baseItem.publishedStart || startTimeStr,
          publishedEnd: baseItem.publishedEnd || endTimeStr,
          actualStart: undefined,
          actualEnd: undefined,
          shiftMinutes: undefined,
          mergedIntoKey: undefined,
          mergedLabel: undefined,
          cycle1Status: 'published',
          cycle2Status: resetChars > 0 ? 'confirmed' : 'awaiting_booking',
          status: 'valid',
          rejectReason: undefined,
          monoCount: resetMono,
          biCount: resetBi,
          charsCount: resetChars,
          pilotsCount: resetPeople,
          rescheduledChars: undefined,
          lostChars: undefined,
        };
        notifySync('↩ Décision Cycle 2 annulée · créneau remis en attente');
      }

      nextItems = nextItems.some(it => it.k === slotKey)
        ? nextItems.map(it => (it.k === slotKey ? updatedSource : it))
        : [...nextItems, updatedSource];

      persistDayValidation(ds, {
        sig: sigOf(record),
        ts: Date.now(),
        k: record.k,
        cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
        items: nextItems,
      });
    },
    [isAdminLocked, validations, bookingsMap, persistDayValidation, findObservationForSlot]
  );

  const handleCreateAndPublishCustomSlot = useCallback(
    (
      dateStr: string,
      newSlot: CustomSlot,
      options?: { replaceDefault?: boolean; dropAdaptedClassics?: boolean }
    ) => {
      if (isAdminLocked) {
        notifySync('🔒 Mode Moniteur / Contrôle : créneaux sur mesure verrouillés');
        return;
      }
      if (isCycle1PastLocked(dateStr)) {
        notifySync('🔒 Archive verrouillée (> 7 jours) : les créneaux ne sont plus modifiables');
        return;
      }

      const existingCfg = customSlotsMap[dateStr] || { replaceDefault: false, slots: [] };
      const nextReplaceDefault =
        options?.replaceDefault !== undefined ? options.replaceDefault : existingCfg.replaceDefault;
      const baseSlots = options?.dropAdaptedClassics
        ? existingCfg.slots.filter(cs => !cs.isAdapted && !cs.id.startsWith('c1-'))
        : existingCfg.slots;
      const updatedSlots = [...baseSlots, newSlot].sort((a, b) =>
        a.start.localeCompare(b.start)
      );
      const nextCustomMap: CustomSlotsMap = {
        ...customSlotsMap,
        [dateStr]: { replaceDefault: nextReplaceDefault, slots: updatedSlots },
      };

      const nextFocus = dayFocus(dateStr, settings, tideW, first, last, windList, nextCustomMap);

      // Garde-fou anti-chevauchement
      const sortedNext = [...nextFocus.list].sort((a, b) => a.a - b.a);
      for (let i = 0; i < sortedNext.length - 1; i++) {
        if (sortedNext[i].b > sortedNext[i + 1].a) {
          const s1 = `${lc(sortedNext[i].a, nextFocus.y, nextFocus.m, nextFocus.d)}–${lc(sortedNext[i].b, nextFocus.y, nextFocus.m, nextFocus.d)}`;
          const s2 = `${lc(sortedNext[i + 1].a, nextFocus.y, nextFocus.m, nextFocus.d)}–${lc(sortedNext[i + 1].b, nextFocus.y, nextFocus.m, nextFocus.d)}`;
          notifySync(`⛔ Chevauchement interdit (${s1} et ${s2}) : création bloquée`);
          return;
        }
      }

      // Vérifier qu'aucun créneau engagé (inscrits/REX/C2) n'est supprimé lors d'un remplacement ou nettoyage des adaptés
      const existingRecord = validations[dateStr];
      const prevItems = existingRecord?.items || [];
      const nextKeySet = new Set(nextFocus.list.map(kOf));
      const dayObsList = observations.filter(o => o.ds === dateStr);
      const normTime = (v?: string) => (v || '').trim().replace('h', ':');

      if ((nextReplaceDefault || options?.dropAdaptedClassics) && prevItems.length > 0) {
        const lostBusy = prevItems.filter(it => {
          if (nextKeySet.has(it.k)) return false;
          const bChars = getSlotBookingsSummary(
            bookingsMap[buildReservationKey(dateStr, it.k)] || []
          ).totalChars;
          const itObs = dayObsList.find(
            o =>
              o.slotKey === it.k ||
              (Boolean(o.slotStart) &&
                Boolean(o.slotEnd) &&
                normTime(o.slotStart) === normTime(it.actualStart || it.publishedStart || it.s) &&
                normTime(o.slotEnd) === normTime(it.actualEnd || it.publishedEnd || it.e))
          );
          return hasCycle2Activity(it, bChars, itObs);
        });
        if (lostBusy.length > 0) {
          const labels = lostBusy.map(it => `${it.actualStart || it.s}–${it.actualEnd || it.e}`).join(', ');
          notifySync(
            `⛔ Remplacement bloqué : créneau(x) classique(s) avec inscrits/REX (${labels}). Traitez-les d’abord dans Cycle 2.`
          );
          return;
        }
      }

      // Vérifier aussi que le nouveau créneau ne chevauche pas un ancien créneau orphelin actif encore en base
      const newSlotStartMin = parseTimeMinutes(newSlot.start);
      const newSlotEndMin = parseTimeMinutes(newSlot.end);
      if (newSlotStartMin !== null && newSlotEndMin !== null && prevItems.length > 0) {
        const retainedCheck = nextReplaceDefault
          ? prevItems.filter(it => nextKeySet.has(it.k))
          : prevItems;
        const orphanConflict = retainedCheck.find(it => {
          if (nextKeySet.has(it.k)) return false;
          if (
            it.status === 'rejected' ||
            it.cycle1Status === 'excluded' ||
            it.cycle1Status === 'not_published' ||
            it.cycle1Status === 'closed_no_bookings' ||
            it.cycle2Status === 'merged' ||
            it.cycle2Status === 'cancelled_weather'
          ) {
            return false;
          }
          const oStart = parseTimeMinutes(it.actualStart || it.publishedStart || it.s);
          const oEnd = parseTimeMinutes(it.actualEnd || it.publishedEnd || it.e);
          if (oStart === null || oEnd === null) return false;
          return newSlotStartMin < oEnd && newSlotEndMin > oStart;
        });
        if (orphanConflict) {
          const cLabel = `${orphanConflict.actualStart || orphanConflict.s}–${orphanConflict.actualEnd || orphanConflict.e}`;
          notifySync(
            `⛔ Création bloquée : ce créneau chevauche un ancien créneau encore actif en base (${cLabel}). Traitez ou supprimez d’abord ce reliquat.`
          );
          return;
        }
      }

      setCustomSlotsMap(nextCustomMap);
      try {
        localStorage.setItem(CS_KEY, JSON.stringify(nextCustomMap));
      } catch {
        // ignore
      }
      saveCustomSlotsToFirestore(dateStr, {
        replaceDefault: nextReplaceDefault,
        slots: updatedSlots,
      }).catch(err => console.warn('Erreur Firestore custom slots express:', err));

      const [yy, mm0, dd] = dateStr.split('-').map(Number);
      const [sh, sm] = newSlot.start.split(':').map(Number);
      const targetSlotKey = `${Math.round(toU(yy, mm0 - 1, dd, sh * 60 + sm))}c`;
      const targetSession =
        nextFocus.list.find(x => kOf(x) === targetSlotKey) ||
        nextFocus.list.find(
          x =>
            x.isCustom &&
            lc(x.a, nextFocus.y, nextFocus.m, nextFocus.d) === newSlot.start.replace(':', 'h')
        );

      if (targetSession) {
        const sKey = kOf(targetSession);
        const startStr = lc(targetSession.a, nextFocus.y, nextFocus.m, nextFocus.d);
        const endStr = lc(targetSession.b, nextFocus.y, nextFocus.m, nextFocus.d);

        // En mode remplacement propre des créneaux classiques, purger les anciens items classiques vides pour ne pas biaiser les stats
        const retainedPrev =
          nextReplaceDefault || options?.dropAdaptedClassics
            ? prevItems.filter(it => nextKeySet.has(it.k))
            : prevItems;

        const existingTarget = retainedPrev.find(it => it.k === sKey);
        const existingTargetBookChars = existingTarget
          ? getSlotBookingsSummary(bookingsMap[buildReservationKey(dateStr, existingTarget.k)] || []).totalChars
          : 0;
        const preserveExistingActivity = Boolean(
          existingTarget && hasCycle2Activity(existingTarget, existingTargetBookChars)
        );

        const publishedItem: ValidationItem = preserveExistingActivity && existingTarget
          ? {
              ...existingTarget,
              k: sKey,
              opt: targetSession.opt,
              over: targetSession.over,
              lim: targetSession.lim,
              customTitle: targetSession.customTitle || newSlot.title || existingTarget.customTitle,
              cycle1Status: 'published',
            }
          : {
              k: sKey,
              s: startStr,
              e: endStr,
              publishedStart: startStr,
              publishedEnd: endStr,
              opt: targetSession.opt,
              over: targetSession.over,
              lim: targetSession.lim,
              customTitle: targetSession.customTitle || newSlot.title,
              status: 'valid',
              cycle1Status: 'published',
              cycle2Status: 'awaiting_booking',
              charsCount: 0,
              monoCount: 0,
              biCount: 0,
              pilotsCount: 0,
            };

        const nextItems = existingTarget
          ? retainedPrev.map(it => (it.k === sKey ? publishedItem : it))
          : [...retainedPrev, publishedItem];

        persistDayValidation(dateStr, {
          sig: sigOf(nextFocus),
          ts: Date.now(),
          k: nextFocus.k,
          cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
          items: nextItems,
        });
      }

      notifySync(
        nextReplaceDefault
          ? '⚡ Créneau sur mesure créé (créneaux classiques sans inscrit remplacés)'
          : '⚡ Créneau sur mesure créé et publié en Cycle 2 !'
      );
    },
    [
      isAdminLocked,
      currentUser,
      customSlotsMap,
      settings,
      tideW,
      first,
      last,
      windList,
      validations,
      bookingsMap,
      observations,
      persistDayValidation,
    ]
  );

  const handleOpenCycle2FromCalendar = useCallback((ds: string) => {
    const [yy, mm] = ds.split('-').map(Number);
    if (Number.isFinite(yy) && Number.isFinite(mm)) {
      setYear(yy);
      setMonth(mm - 1);
    }
    setFocusDate(ds);
    setActiveTab(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleFocusDateChange = useCallback((ds: string) => {
    setFocusDate(ds);
    const [yy, mm] = ds.split('-').map(Number);
    if (Number.isFinite(yy) && Number.isFinite(mm)) {
      setYear(yy);
      setMonth(mm - 1);
    }
  }, []);

  if (!isUnlocked) {
    return <AppLockScreen onUnlock={handleUnlock} />;
  }

  return (
    <>
      <Header
        onOpenExchange={() => setIsExchangeModalOpen(true)}
        unreadExchangeCount={teamNotes.filter(n => !n.isResolved).length}
      />
      <SyncStatusBar
        isOnline={true}
        currentUser={currentUser}
        onLock={handleLock}
        onOpenUserManagement={() => setIsUserModalOpen(true)}
      />
      <main className={activeTab >= 3 && activeTab <= 7 ? 'agenda-wide' : ''}>
        {/* En-tête des marées : affiche la date du calendrier en tab 1, et la date du lendemain en tab 2 */}
        {activeTab === 1 && <TideHeaderCard selectedDate={selectedDate} EX={EX} windList={windList} />}
        {activeTab === 2 && <TideHeaderCard selectedDate={focusDate} EX={EX} windList={windList} />}

        {/* Navigation tabs (100% Digital : Cycle 2, Stat, Étalonnage, Cycle 1, Hypothèses & Notes, Répertoire) */}
        <nav className="tabs noprint">
          <button
            type="button"
            className={activeTab === 2 ? 'on' : ''}
            onClick={() => handleTabChange(2)}
          >
            ⚡ Adaptation aux conditions météo et prise de décisions
          </button>
          <button
            type="button"
            className={activeTab === 4 ? 'on' : ''}
            onClick={() => handleTabChange(4)}
          >
            📊 Statistiques &amp; Relevés
          </button>
          <button
            type="button"
            className={activeTab === 7 ? 'on' : ''}
            onClick={() => handleTabChange(7)}
          >
            📍 Étalonnage GPS
          </button>
          <button
            type="button"
            className={activeTab === 1 ? 'on' : ''}
            onClick={() => handleTabChange(1)}
          >
            ⏳ Validation des créneaux de roulage
          </button>
          {canAccessHypothesesTab && (
            <button
              type="button"
              className={activeTab === 6 ? 'on' : ''}
              onClick={() => handleTabChange(6)}
            >
              💡 Hypothèses &amp; Notes
            </button>
          )}
          <button
            type="button"
            className={activeTab === 5 ? 'on' : ''}
            onClick={() => handleTabChange(5)}
          >
            👥 Répertoire Clients
          </button>
        </nav>

        {/* Tab 1: Cycle 1 · Calendrier & Offre Commerciale */}
        {activeTab === 1 && (
          <div id="tab1">
            <CalendarGrid
              year={year}
              month={month}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              settings={settings}
              EX={EX}
              W={tideW}
              first={first}
              last={last}
              windList={windList}
              validations={validations}
              bookingsMap={bookingsMap}
              customSlotsMap={customSlotsMap}
              isReadOnly={isAdminLocked}
              onValidateRange={handleValidateDateRange}
            />

            {/* Météo au format Windguru directement sous le calendrier */}
            <WindguruTable
              dateStr={selectedDate}
              settings={settings}
              EX={EX}
              windList={windList}
            />

            <DayDetailPanel
              selectedDate={selectedDate}
              settings={settings}
              EX={EX}
              W={tideW}
              first={first}
              last={last}
              windList={windList}
              customSlotsMap={customSlotsMap}
              onUpdateCustomSlots={handleUpdateCustomSlots}
              validations={validations}
              bookingsMap={bookingsMap}
              onSaveSlotBookings={handleSaveSlotBookings}
              onValidateDay={handleValidateDay}
              onClearValidation={handleClearValidation}
              onSetSlotCycle1Action={handleSetSlotCycle1Action}
              onExcludeRemainingCycle1Slots={handleExcludeRemainingCycle1Slots}
              onCycle2Action={handleCycle2Action}
              onAddCustomNonPublishReason={handleAddCustomNonPublishReason}
              onNavigateDay={handleNavigateDay}
              canPrevDay={selectedDate > minDs}
              canNextDay={selectedDate < maxDs}
              onOpenCycle2={handleOpenCycle2FromCalendar}
              observations={observations}
              onOpenObservationModal={slot => setActiveObservationSlot(slot)}
              onOpenExpressRex={ds => setExpressRexDate(ds)}
              isReadOnly={isAdminLocked}
            />

            {/* Bloc Marnage */}
            <div className="card nop">
              <MarnageChart
                year={year}
                month={month}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                settings={settings}
                EX={EX}
              />
            </div>

            {/* Formulaire des Réglages (tiroir fermé par défaut + vent / Windguru) */}
            <SettingsCard
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onResetToDefaults={handleResetToDefaults}
              canUndoReset={Boolean(backupSettings)}
              onUndoReset={handleUndoReset}
              windStatusText={windStatus}
              onRefreshWind={fetchWind}
              isLoadingWind={isLoadingWind}
              isReadOnly={isReadOnly}
              userRole={currentUser?.role || (isReadOnly ? 'moniteur' : 'admin')}
              userName={currentUser?.displayName || currentUser?.username || 'Jérôme'}
            />

            {/* Outil d'Export en bas de page */}
            <TableView
              year={year}
              month={month}
              settings={settings}
              EX={EX}
              W={tideW}
              first={first}
              last={last}
              windList={windList}
            />
          </div>
        )}

        {/* Tab 2: Cycle 2 · Adaptation aux conditions météo et prise de décisions */}
        {activeTab === 2 && (
          <FocusTab
            year={year}
            month={month}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            EX={EX}
            W={tideW}
            first={first}
            last={last}
            windList={windList}
            validations={validations}
            bookingsMap={bookingsMap}
            onSaveSlotBookings={handleSaveSlotBookings}
            onCycle2Action={handleCycle2Action}
            onSelectDayInCalendar={handleSelectDayInCalendar}
            customSlotsMap={customSlotsMap}
            onUpdateCustomSlots={handleUpdateCustomSlots}
            onCreateAndPublishCustomSlot={handleCreateAndPublishCustomSlot}
            onValidateDay={handleValidateDay}
            onClearValidation={handleClearValidation}
            onAddCustomNonPublishReason={handleAddCustomNonPublishReason}
            observations={observations}
            onOpenObservationModal={slot => setActiveObservationSlot(slot)}
            onOpenExpressRex={ds => setExpressRexDate(ds)}
            isReadOnly={isAdminLocked}
            focusDate={focusDate}
            onFocusDateChange={handleFocusDateChange}
          />
        )}

        {/* Tab 4: Statistiques Opérationnelles & Observatoire des Écarts */}
        {activeTab === 4 && (
          <div id="tab4">
            <StatisticsTab
              settings={settings}
              EX={EX}
              windList={windList}
              validations={validations}
              bookingsMap={bookingsMap}
              customSlotsMap={customSlotsMap}
              selectedDate={selectedDate}
              currentUserName={currentUser?.username}
              isReadOnly={isAdminLocked}
              onAddCustomNonPublishReason={handleAddCustomNonPublishReason}
              onReclassifyValidationReason={handleReclassifyAbsentValidations}
              onObservationSaved={syncValidationFromRex}
              onObservationDeleted={resetValidationAfterRexDeleted}
            />
          </div>
        )}

        {/* Tab 7: Observatoire & Étalonnage GPS Limite Basse de Roulage */}
        {activeTab === 7 && (
          <div id="tab7">
            <GpsWaterlineTab
              settings={settings}
              EX={EX}
              windList={windList}
              selectedDate={selectedDate}
              isReadOnly={isReadOnly}
            />
          </div>
        )}

        {/* Tab 5: Base de données Clients & CRM */}
        {activeTab === 5 && (
          <div id="tab5">
            <ClientsTab isReadOnly={isAdminLocked} />
          </div>
        )}

        {/* Tab 6: Réglages validés, Hypothèses & Notes (strictement réservé à Jérôme et Benoît) */}
        {activeTab === 6 && canAccessHypothesesTab && (
          <div id="tab6">
            <div
              className="card nop"
              style={{
                marginBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: 'var(--card)',
                padding: '12px 16px',
                borderRadius: '10px',
                border: '1px solid var(--bd)',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>💡</span> Réglages validés, Hypothèses & Notes
                </h2>
                <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--mu)' }}>
                  Règles opérationnelles convenues avec le moniteur, hypothèses de roulage et explications physiques détaillées.
                </p>
              </div>

              <button
                type="button"
                className="fbtn"
                onClick={() => {
                  handleTabChange(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{
                  margin: 0,
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  borderRadius: '8px',
                  background: 'var(--cell, #f1f5f9)',
                  color: 'var(--tx, #111)',
                  border: '1.5px solid var(--bd, #cbd5e1)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>⬅</span>
                <span>Revenir au Calendrier</span>
              </button>
            </div>

            {/* Carte Administration Équipe & Utilisateurs (Réservée à Jérôme & Concepteur : Benoît) */}
            {currentUser?.role === 'admin' && (
              <div
                className="card nop"
                style={{
                  marginBottom: '16px',
                  background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                  padding: '16px 20px',
                  borderRadius: '12px',
                  border: '1.5px solid #0284c7',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.3rem' }}>👥</span>
                    <strong style={{ fontSize: '1rem', color: '#0369a1' }}>
                      Gestion de l&apos;Équipe & des Comptes Moniteurs (Accès Administrateur)
                    </strong>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#334155' }}>
                    Ajoutez de nouveaux moniteurs, définissez leurs mots de passe individuels, attribuez les rôles Admin ou activez le mode contrôle en lecture seule.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(true)}
                  style={{
                    background: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 6px rgba(2, 132, 199, 0.35)',
                  }}
                >
                  <span>⚙️</span>
                  <span>Ouvrir la gestion des utilisateurs</span>
                </button>
              </div>
            )}

            <NotesAndHypotheses
              validations={validations}
              bookingsMap={bookingsMap}
              customSlotsMap={customSlotsMap}
              settings={settings}
              EX={EX}
              windList={windList}
              onSaveDayValidation={persistDayValidation}
              onAddCustomNonPublishReason={handleAddCustomNonPublishReason}
            />
          </div>
        )}

        {/* Modal de saisie rapide d'un relevé terrain depuis le calendrier */}
        {activeObservationSlot && (() => {
          const weatherDefaults = getSlotWeatherRexDefaults(
            activeObservationSlot.dateStr,
            activeObservationSlot.slotStart,
            activeObservationSlot.slotEnd,
            EX,
            windList
          );
          const matchedValForObs = findMatchingValidationItem(
            validations[activeObservationSlot.dateStr],
            activeObservationSlot.slotKey,
            activeObservationSlot.slotStart,
            activeObservationSlot.slotEnd
          );
          const obsBookingKey =
            matchedValForObs &&
            (bookingsMap[
              buildReservationKey(activeObservationSlot.dateStr, matchedValForObs.k)
            ]?.length ?? 0) > 0
              ? matchedValForObs.k
              : activeObservationSlot.slotKey;
          const agendaPeopleCount = getSlotBookingsSummary(
            bookingsMap[buildReservationKey(activeObservationSlot.dateStr, obsBookingKey)] || []
          ).totalPeople;
          return (
            <SlotObservationModal
              key={`${activeObservationSlot.dateStr}_${activeObservationSlot.slotKey}`}
              isOpen={Boolean(activeObservationSlot)}
              onClose={() => setActiveObservationSlot(null)}
              dateStr={activeObservationSlot.dateStr}
              slotKey={activeObservationSlot.slotKey}
              slotStart={activeObservationSlot.slotStart}
              slotEnd={activeObservationSlot.slotEnd}
              slotTitle={activeObservationSlot.customTitle}
              isCustom={activeObservationSlot.isCustom}
              maxChars={activeObservationSlot.maxChars}
              primaryInstructor={activeObservationSlot.primaryInstructor}
              secondaryInstructor={activeObservationSlot.secondaryInstructor}
              defaultPressure={weatherDefaults.pressureHpa ?? null}
              defaultWindKts={weatherDefaults.windKts ?? null}
              defaultGustKts={weatherDefaults.gustKts ?? null}
              defaultWindDir={weatherDefaults.windDir ?? null}
              defaultWaveH={weatherDefaults.waveH ?? null}
              initialObservation={findObservationForSlot(
                activeObservationSlot.dateStr,
                activeObservationSlot.slotKey,
                activeObservationSlot.slotStart,
                activeObservationSlot.slotEnd
              )}
              currentUserName={currentUser?.username}
              customNonPublishReasons={settings.customNonPublishReasons}
              defaultStatus={activeObservationSlot.defaultStatus}
              defaultCancellationReason={activeObservationSlot.defaultCancellationReason}
              defaultCancellationNote={activeObservationSlot.defaultCancellationNote}
              defaultMonoCount={activeObservationSlot.defaultMonoCount}
              defaultBiCount={activeObservationSlot.defaultBiCount}
              defaultParticipantsCount={activeObservationSlot.defaultParticipantsCount}
              defaultBookedParticipantsCount={
                activeObservationSlot.defaultBookedParticipantsCount ??
                (agendaPeopleCount > 0 ? agendaPeopleCount : undefined)
              }
              agendaBookedPeopleCount={agendaPeopleCount}
              forceIntent={activeObservationSlot.forceIntent}
              onSaveSuccess={(updated, savedObs, deletedObs) => {
                setObservations(updated);
                if (savedObs) {
                  syncValidationFromRex(savedObs);
                  if (savedObs.status === 'realized') {
                    notifySync(
                      savedObs.charsCount
                        ? `🏁 Séance effectuée (${savedObs.charsCount} char${savedObs.charsCount > 1 ? 's' : ''}) & REX enregistrés`
                        : '🏁 Séance effectuée & REX enregistrés'
                    );
                  } else if (savedObs.cancellationReason === 'no_clients') {
                    notifySync("⛔ Annulé (Vie 2) : Pas d'inscrits & REX enregistrés");
                  } else {
                    notifySync('⛔ Annulé (Vie 2) & REX enregistrés');
                  }
                } else if (deletedObs) {
                  resetValidationAfterRexDeleted(deletedObs);
                }
                setActiveObservationSlot(null);
              }}
              isReadOnly={isReadOnly}
            />
          );
        })()}

        {/* Modal Bilan Express fin de journée (tous les créneaux en une seule vue) */}
        {expressRexDate && (
          <ExpressRexModal
            isOpen={Boolean(expressRexDate)}
            onClose={() => setExpressRexDate(null)}
            initialDate={expressRexDate}
            settings={settings}
            EX={EX}
            W={tideW}
            first={first}
            last={last}
            windList={windList}
            customSlotsMap={customSlotsMap}
            validations={validations}
            bookingsMap={bookingsMap}
            observations={observations}
            currentUserName={currentUser?.username || 'Jérôme'}
            isReadOnly={isReadOnly}
            onSaveBatch={handleSaveExpressRexBatch}
          />
        )}

        {/* Modal d'administration des utilisateurs et de l'équipe */}
        <UserManagementModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          currentUser={currentUser}
        />

        {/* Modal d'échange et carnet de liaison Ben ↔ Jérôme (Module 7) */}
        <TeamExchangeModal
          isOpen={isExchangeModalOpen}
          onClose={() => setIsExchangeModalOpen(false)}
          notes={teamNotes}
          currentUserName={currentUser?.displayName || currentUser?.username}
        />
      </main>
    </>
  );
};
