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
  getActiveInstructor,
} from './utils/firebaseSync';
import {
  ActiveUserSession,
  AppSettings,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  MAX_CHARS_PER_INSTRUCTOR,
  SessionItem,
  TeamNote,
  TidePoint,
  ValidationDayRecord,
  ValidationItem,
  ValidationsMap,
  WindPoint,
} from './types';
import { getActiveUser, clearActiveUser } from './utils/authUtils';
import {
  build,
  dayFocus,
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
  Cycle1SlotAction,
  Cycle2ActionPayload,
  getSlotBookingsSummary,
  getValidationItemChars,
  hasCycle2Trigger,
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
  pcor: true,
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
  fmin: 3,
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
          const merged = { ...prev, ...cloudSettings };
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

    return () => {
      unsubValidations();
      unsubCustomSlots();
      unsubSessionSettings();
      unsubBookings();
      unsubTeamNotes();
    };
  }, []);

  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([]);
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<ActiveUserSession | null>(() => getActiveUser());
  const isReadOnly = Boolean(currentUser?.isReadOnly);

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
    if (!trimmed) return;
    if (currentUser?.isReadOnly || currentUser?.role === 'moniteur') {
      notifySync('🔒 Mode Contrôle : ajout de raison verrouillé');
      return;
    }
    setSettings(prev => {
      const existing = prev.customNonPublishReasons || [];
      if (existing.some(r => r.toLowerCase() === trimmed.toLowerCase())) {
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

  // Calculations for tides and windows
  const EX: TidePoint[] = useMemo(() => {
    return build(settings.les, settings.pcor, windList);
  }, [settings.les, settings.pcor, windList]);

  // ÉTAPE 3 : Ajustement selon le mode Théorique vs Mode Réel (Modèle Empirique)
  const isRealMode = settings.calculationMode === 'reel';
  const empiricalOffsetM = isRealMode ? ((settings.empiricalOffsetCm ?? 15) / 100) : 0;
  const effectiveThreshold = (settings.L + empiricalOffsetM) - (settings.mg || 0) / 100;

  const tideW = useMemo(() => {
    return win(EX, effectiveThreshold);
  }, [EX, effectiveThreshold]);

  const first = EX[0]?.t ?? 0;
  const last = EX[EX.length - 1]?.t ?? 0;

  const handleUpdateCustomSlots = useCallback(
    (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => {
      if (currentUser?.isReadOnly) {
        notifySync('🔒 Mode Contrôle : créneaux sur mesure verrouillés');
        return;
      }
      if (dateStr < tdy()) {
        notifySync('🔒 Journée passée : les créneaux Cycle 1 ne sont plus modifiables');
        return;
      }
      const nextCustomMap: CustomSlotsMap = {
        ...customSlotsMap,
        [dateStr]: { replaceDefault, slots },
      };
      setCustomSlotsMap(nextCustomMap);
      try {
        localStorage.setItem(CS_KEY, JSON.stringify(nextCustomMap));
      } catch {
        // ignore
      }
      saveCustomSlotsToFirestore(dateStr, { replaceDefault, slots }).catch(err =>
        console.warn('Erreur Firestore custom slots:', err)
      );

      // Si la journée est déjà publiée en Cycle 1, synchroniser automatiquement les créneaux sans inscrit (tout en préservant les créneaux Cycle 2)
      const existingRecord = validations[dateStr];
      if (existingRecord && existingRecord.items && existingRecord.items.length > 0) {
        const nextFocus = dayFocus(dateStr, settings, tideW, first, last, windList, nextCustomMap);
        const preservedCycle2 = existingRecord.items.filter(it => {
          const bChars = getSlotBookingsSummary(
            bookingsMap[buildReservationKey(dateStr, it.k)] || []
          ).totalChars;
          return hasCycle2Trigger(it, bChars);
        });
        const usedCycle2Keys = new Set<string>();
        const syncedItems: ValidationItem[] = [];

        for (const x of nextFocus.list) {
          const slotKey = kOf(x);
          const startTimeStr = lc(x.a, nextFocus.y, nextFocus.m, nextFocus.d);
          const endTimeStr = lc(x.b, nextFocus.y, nextFocus.m, nextFocus.d);

          const matchedC2 = preservedCycle2.find(
            it => !usedCycle2Keys.has(it.k) && (it.k === slotKey || (it.s === startTimeStr && it.e === endTimeStr))
          );
          if (matchedC2) {
            usedCycle2Keys.add(matchedC2.k);
            syncedItems.push(matchedC2);
            continue;
          }

          const matchedExisting = existingRecord.items.find(
            it => it.k === slotKey || (it.s === startTimeStr && it.e === endTimeStr)
          );
          const keepNotPublished =
            matchedExisting?.cycle1Status === 'not_published' ||
            Boolean(matchedExisting?.nonPublishReason);
          const keepClosedVie1 =
            !keepNotPublished && matchedExisting?.cycle1Status === 'closed_no_bookings';
          const notPubReason =
            matchedExisting?.nonPublishReason || 'Indisponibilité personnelle';

          syncedItems.push({
            k: slotKey,
            s: startTimeStr,
            e: endTimeStr,
            publishedStart: startTimeStr,
            publishedEnd: endTimeStr,
            opt: x.opt,
            over: x.over,
            lim: x.lim,
            customTitle: x.customTitle,
            status: keepNotPublished || keepClosedVie1 ? 'rejected' : 'valid',
            rejectReason: keepNotPublished
              ? `Non publié (C1) : ${notPubReason}`
              : keepClosedVie1
              ? matchedExisting?.rejectReason || "Faute d'inscrits (Vie 1)"
              : undefined,
            cycle1Status: keepNotPublished
              ? 'not_published'
              : keepClosedVie1
              ? 'closed_no_bookings'
              : 'published',
            nonPublishReason: keepNotPublished ? notPubReason : undefined,
            cycle2Status: keepNotPublished || keepClosedVie1 ? undefined : 'awaiting_booking',
            charsCount: 0,
            monoCount: 0,
            biCount: 0,
            pilotsCount: 0,
          });
        }

        // Préserver tout créneau Cycle 2 dont l'horaire ne figure plus dans la liste calculée
        for (const c2Item of preservedCycle2) {
          if (!usedCycle2Keys.has(c2Item.k)) {
            syncedItems.push(c2Item);
          }
        }

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
        notifySync('📅 Horaires Cycle 1 mis à jour');
      } else {
        notifySync('✏️ Horaires du jour ajustés');
      }
    },
    [currentUser, customSlotsMap, validations, settings, tideW, first, last, windList, bookingsMap]
  );

  const handleTabChange = (tab: number) => {
    setActiveTab(tab);
  };

  const [activeObservationSlot, setActiveObservationSlot] = useState<{
    dateStr: string;
    slotKey: string;
    slotStart: string;
    slotEnd: string;
    isCustom?: boolean;
    customTitle?: string;
  } | null>(null);

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

  const buildCycle1DayRecord = useCallback(
    (
      ds: string,
      record: DayFocusData,
      existingRecord: ValidationDayRecord | undefined,
      mode: 'all' | 'wind_only' | 'not_published' = 'all',
      nonPublishReason?: string
    ): ValidationDayRecord => {
      const items: ValidationItem[] = record.list.map(x => {
        const slotKey = kOf(x);
        const startTimeStr = lc(x.a, record.y, record.m, record.d);
        const endTimeStr = lc(x.b, record.y, record.m, record.d);
        const existingItem = existingRecord?.items?.find(
          it => it.k === slotKey || (it.s === startTimeStr && it.e === endTimeStr)
        );
        const effectiveBookingKey = existingItem ? existingItem.k : slotKey;
        const bookingChars = getSlotBookingsSummary(
          bookingsMap[buildReservationKey(ds, effectiveBookingKey)] ||
            bookingsMap[buildReservationKey(ds, slotKey)] ||
            []
        ).totalChars;

        // Préserver intact tout créneau déjà engagé en Cycle 2 (>= 1 char ou action terrain)
        if (existingItem && hasCycle2Trigger(existingItem, bookingChars)) {
          return {
            ...existingItem,
            publishedStart: existingItem.publishedStart || startTimeStr,
            publishedEnd: existingItem.publishedEnd || endTimeStr,
            cycle1Status: 'published',
          };
        }

        if (mode === 'not_published') {
          const cleanReason = nonPublishReason?.trim() || 'Indisponibilité personnelle';
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

      return {
        sig: sigOf(record),
        ts: Date.now(),
        k: record.k,
        cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
        items,
      };
    },
    [bookingsMap]
  );

  // CYCLE 1 : Publication commerciale ou Non-publication motivée jour par jour (préserve les créneaux déjà en Cycle 2)
  const handleValidateDay = (
    ds: string,
    record: DayFocusData,
    mode: 'all' | 'wind_only' | 'not_published' = 'all',
    nonPublishReason?: string
  ) => {
    if (isReadOnly) {
      notifySync('🔒 Mode Lecture seule actif : publications réservées aux administrateurs');
      return;
    }
    if (ds < tdy()) {
      notifySync('🔒 Journée passée : validation Cycle 1 verrouillée (archive)');
      return;
    }
    const existingRecord = validations[ds];
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
      if (isReadOnly) {
        notifySync('🔒 Mode Lecture seule actif : publications réservées aux administrateurs');
        return;
      }
      const todayStr = tdy();
      const batchEntries: Array<{ dateStr: string; data: ValidationDayRecord }> = [];

      for (const ds of dates) {
        if (ds < todayStr || ds < minDs || ds > maxDs) continue;
        const record = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        if (!record || record.list.length === 0) continue;

        const existingRecord = validations[ds];
        // Respecter toute journée déjà explicitement marquée "À ne pas publier"
        if (
          existingRecord &&
          existingRecord.items.length > 0 &&
          existingRecord.items.every(it => it.cycle1Status === 'not_published')
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
        // Si certains créneaux étaient déjà marqués individuellement "not_published" ou "closed_no_bookings", les préserver
        if (existingRecord) {
          built.items = built.items.map(it => {
            const prevIt = existingRecord.items.find(
              old => old.k === it.k || (old.s === it.s && old.e === it.e)
            );
            if (
              prevIt &&
              (prevIt.cycle1Status === 'not_published' || prevIt.cycle1Status === 'closed_no_bookings')
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
    [isReadOnly, settings, tideW, first, last, windList, customSlotsMap, validations, buildCycle1DayRecord]
  );

  const handleClearValidation = useCallback((ds: string) => {
    if (isReadOnly) {
      notifySync('🔒 Mode Lecture seule : réinitialisation verrouillée');
      return;
    }
    if (ds < tdy()) {
      notifySync('🔒 Journée passée : archive Cycle 1 non modifiable');
      return;
    }
    persistDayValidation(ds, null);
  }, [isReadOnly, persistDayValidation]);

  // CYCLE 1 : Action unitaire sur un créneau (à publier, à ne pas publier + motif, clôturer Vie 1, réinitialiser)
  const handleSetSlotCycle1Action = useCallback(
    (record: DayFocusData, slot: SessionItem, action: Cycle1SlotAction, reason?: string) => {
      if (isReadOnly) {
        notifySync('🔒 Mode Contrôle : actions Cycle 1 verrouillées');
        return;
      }
      const ds = record.ds;
      if (ds < tdy()) {
        notifySync('🔒 Journée passée : archive Cycle 1 non modifiable');
        return;
      }
      const slotKey = kOf(slot);
      const startTimeStr = lc(slot.a, record.y, record.m, record.d);
      const endTimeStr = lc(slot.b, record.y, record.m, record.d);
      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items || [];
      const existingItem = currentItems.find(it => it.k === slotKey);

      let nextItems: ValidationItem[];
      if (action === 'reset') {
        nextItems = currentItems.filter(it => it.k !== slotKey);
      } else {
        const cleanReason = reason?.trim() || 'Indisponibilité personnelle';
        const nextItem: ValidationItem =
          action === 'not_published'
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
                rejectReason: "Faute d'inscrits (Vie 1)",
                cycle1Status: 'closed_no_bookings',
                nonPublishReason: undefined,
                cycle2Status: undefined,
                charsCount: 0,
                monoCount: 0,
                biCount: 0,
                pilotsCount: 0,
              }
            : {
                k: slotKey,
                s: existingItem?.publishedStart || startTimeStr,
                e: existingItem?.publishedEnd || endTimeStr,
                publishedStart: existingItem?.publishedStart || startTimeStr,
                publishedEnd: existingItem?.publishedEnd || endTimeStr,
                opt: slot.opt,
                over: slot.over,
                lim: slot.lim,
                customTitle: slot.customTitle,
                status: 'valid',
                rejectReason: undefined,
                cycle1Status: 'published',
                nonPublishReason: undefined,
                cycle2Status: 'awaiting_booking',
                charsCount: 0,
                monoCount: 0,
                biCount: 0,
                pilotsCount: 0,
              };

        nextItems = existingItem
          ? currentItems.map(it => (it.k === slotKey ? nextItem : it))
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
    [isReadOnly, validations, persistDayValidation]
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
      if (isReadOnly) {
        notifySync('🔒 Mode Contrôle : réservations verrouillées');
        return;
      }
      const resKey = buildReservationKey(ds, slotKey);
      setBookingsMap(prev => ({ ...prev, [resKey]: bookings }));
      saveBookingToFirestore(resKey, bookings).catch(err =>
        console.warn('Erreur Firestore réservations:', err)
      );

      const summary = getSlotBookingsSummary(bookings);
      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items || [];
      const existingItem = currentItems.find(it => it.k === slotKey);
      const instructor = getActiveInstructor() || 'Jérôme';

      let nextItem: ValidationItem;
      if (summary.totalChars > 0) {
        const nextC2Status =
          existingItem?.cycle2Status && existingItem.cycle2Status !== 'awaiting_booking'
            ? existingItem.cycle2Status
            : 'confirmed';

        nextItem = {
          ...(existingItem || {
            k: slotKey,
            s: slotStart,
            e: slotEnd,
            opt: slotKey.endsWith('o'),
            over: 0,
            lim: '',
          }),
          k: slotKey,
          s: existingItem?.s || slotStart,
          e: existingItem?.e || slotEnd,
          publishedStart: existingItem?.publishedStart || slotStart,
          publishedEnd: existingItem?.publishedEnd || slotEnd,
          cycle1Status: 'published',
          cycle2Status: nextC2Status,
          status: existingItem?.status === 'rejected' && nextC2Status === 'cancelled_weather' ? 'rejected' : 'valid',
          rejectReason:
            existingItem?.status === 'rejected' && nextC2Status === 'cancelled_weather'
              ? existingItem.rejectReason
              : undefined,
          assignedPilot: instructor,
          instructor,
          charsCount: summary.totalChars,
          monoCount: summary.monoCount,
          biCount: summary.biCount,
          pilotsCount: summary.totalPeople,
        };
        notifySync(
          summary.totalChars > MAX_CHARS_PER_INSTRUCTOR
            ? `⚠️ ${summary.totalChars}/${MAX_CHARS_PER_INSTRUCTOR} chars inscrits (dépassement moniteur) · Cycle 2 actif`
            : `⚡ ${summary.totalChars} char(s) inscrit(s) · Créneau basculé en Cycle 2`
        );
      } else {
        nextItem = {
          ...(existingItem || {
            k: slotKey,
            s: slotStart,
            e: slotEnd,
            opt: slotKey.endsWith('o'),
            over: 0,
            lim: '',
          }),
          k: slotKey,
          s: existingItem?.s || slotStart,
          e: existingItem?.e || slotEnd,
          publishedStart: existingItem?.publishedStart || slotStart,
          publishedEnd: existingItem?.publishedEnd || slotEnd,
          cycle1Status:
            existingItem?.cycle1Status === 'not_published'
              ? 'not_published'
              : existingItem?.cycle1Status === 'closed_no_bookings'
              ? 'closed_no_bookings'
              : 'published',
          cycle2Status:
            existingItem?.cycle1Status === 'not_published' ||
            existingItem?.cycle1Status === 'closed_no_bookings'
              ? undefined
              : 'awaiting_booking',
          charsCount: 0,
          monoCount: 0,
          biCount: 0,
          pilotsCount: 0,
        };
        notifySync('📅 0 char inscrit · Retour en attente Cycle 1');
      }

      const nextItems = existingItem
        ? currentItems.map(it => (it.k === slotKey ? nextItem : it))
        : [...currentItems, nextItem];

      persistDayValidation(ds, {
        sig: existingRecord?.sig || slotKey,
        ts: Date.now(),
        k: existingRecord?.k || 'g',
        cycle1PublishedAt: existingRecord?.cycle1PublishedAt || Date.now(),
        items: nextItems,
      });
    },
    [isReadOnly, validations, persistDayValidation]
  );

  // CYCLE 2 : Décisions tactiques terrain (Maintenir, Décaler, Regrouper, Annuler Vie 2, REX)
  const handleCycle2Action = useCallback(
    (record: DayFocusData, slot: SessionItem, payload: Cycle2ActionPayload) => {
      if (isReadOnly) {
        notifySync('🔒 Mode Contrôle : pilotage Cycle 2 verrouillé');
        return;
      }

      const ds = record.ds;
      const slotKey = kOf(slot);
      const startTimeStr = lc(slot.a, record.y, record.m, record.d);
      const endTimeStr = lc(slot.b, record.y, record.m, record.d);
      const existingRecord = validations[ds];
      const currentItems = existingRecord?.items || [];
      const existingItem = currentItems.find(it => it.k === slotKey);
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
        const chars = mono + bi > 0 ? mono + bi : existingCounts.totalChars;
        if (chars < 1) {
          notifySync('⛔ Au moins 1 char inscrit est requis pour activer le Cycle 2');
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
      } else if (payload.type === 'shift') {
        const isZeroShift = payload.shiftMinutes === 0;
        updatedSource = {
          ...baseItem,
          publishedStart: baseItem.publishedStart || startTimeStr,
          publishedEnd: baseItem.publishedEnd || endTimeStr,
          actualStart: isZeroShift ? undefined : payload.newStart,
          actualEnd: isZeroShift ? undefined : payload.newEnd,
          shiftMinutes: isZeroShift ? undefined : payload.shiftMinutes,
          cycle1Status: 'published',
          cycle2Status: isZeroShift ? 'confirmed' : 'shifted',
          status: 'valid',
          rejectReason: undefined,
          assignedPilot: baseItem.assignedPilot || instructor,
          instructor: baseItem.instructor || instructor,
        };
        notifySync(
          isZeroShift
            ? '🕒 Horaire rétabli sur Cycle 1'
            : `🕒 Séance décalée (${payload.shiftMinutes > 0 ? '+' : ''}${payload.shiftMinutes} min) ➔ ${payload.newStart} - ${payload.newEnd}`
        );
      } else if (payload.type === 'merge') {
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
        };

        // Ajouter les chars déplacés sur le créneau cible pour refléter la jauge combinée
        const targetSess = record.list.find(s => kOf(s) === payload.targetSlotKey);
        if (targetSess) {
          const tStart = lc(targetSess.a, record.y, record.m, record.d);
          const tEnd = lc(targetSess.b, record.y, record.m, record.d);
          const existingTarget = nextItems.find(it => it.k === payload.targetSlotKey);
          const tCounts = getValidationItemChars(existingTarget);
          const combMono = tCounts.mono + existingCounts.mono;
          const combBi = tCounts.bi + existingCounts.bi;
          const combChars = tCounts.totalChars + existingCounts.totalChars;
          const combPeople = tCounts.people + existingCounts.people;

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

          notifySync(
            combChars > MAX_CHARS_PER_INSTRUCTOR
              ? `⚠️ Regroupé (${combChars}/${MAX_CHARS_PER_INSTRUCTOR} chars : dépassement moniteur)`
              : `🔗 Regroupé sur ${payload.targetLabel} (${combChars}/${MAX_CHARS_PER_INSTRUCTOR} chars)`
          );
        }
      } else if (payload.type === 'cancel_weather') {
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
      } else if (payload.type === 'reset_to_cycle1') {
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
          cycle2Status: existingCounts.totalChars > 0 ? 'confirmed' : 'awaiting_booking',
          status: 'valid',
          rejectReason: undefined,
        };
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
    [isReadOnly, validations, persistDayValidation]
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
        {activeTab === 1 && <TideHeaderCard selectedDate={selectedDate} EX={EX} />}
        {activeTab === 2 && <TideHeaderCard selectedDate={focusDate} EX={EX} />}

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
            📅 Validation des créneaux de roulage
          </button>
          <button
            type="button"
            className={activeTab === 6 ? 'on' : ''}
            onClick={() => handleTabChange(6)}
          >
            💡 Hypothèses &amp; Notes
          </button>
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
              isReadOnly={isReadOnly}
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
              onAddCustomNonPublishReason={handleAddCustomNonPublishReason}
              onNavigateDay={handleNavigateDay}
              canPrevDay={selectedDate > minDs}
              canNextDay={selectedDate < maxDs}
              onOpenCycle2={handleOpenCycle2FromCalendar}
              onOpenObservationModal={slot => setActiveObservationSlot(slot)}
              isReadOnly={isReadOnly}
            />

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

            {/* Positionnement du bloc Marnage directement en dessous du bloc Export (Exigence 1) */}
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

            {/* Formulaire des Réglages (Séances, seuils, vent, actualisation, réinitialisation) */}
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

            {/* Lien d'accès direct vers l'onglet Hypothèses & Notes */}
            <div
              className="card nop"
              style={{
                marginTop: '14px',
                background: 'var(--card)',
                border: '1.5px dashed var(--bd)',
                borderRadius: '12px',
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>💡</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--tx)' }}>
                    Réglages validés et hypothèses du moniteur &amp; notes de calcul
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--mu)', marginTop: '2px' }}>
                    Règles d&apos;enchaînement, pauses, surcote barométrique détaillée et explications techniques.
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="fbtn"
                onClick={() => {
                  handleTabChange(6);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{
                  margin: 0,
                  padding: '8px 16px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  borderRadius: '8px',
                  background: 'var(--cell, #f1f5f9)',
                  color: 'var(--tx, #111)',
                  border: '1.5px solid var(--bd, #cbd5e1)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>Consulter les Hypothèses &amp; Notes</span>
                <span style={{ fontSize: '0.95rem' }}>➔</span>
              </button>
            </div>
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
            onOpenObservationModal={slot => setActiveObservationSlot(slot)}
            isReadOnly={isReadOnly}
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
              customSlotsMap={customSlotsMap}
              selectedDate={selectedDate}
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
            <ClientsTab isReadOnly={isReadOnly} />
          </div>
        )}

        {/* Tab 6: Réglages validés, Hypothèses & Notes */}
        {activeTab === 6 && (
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

            <NotesAndHypotheses onLock={handleLock} />
          </div>
        )}

        {/* Modal de saisie rapide d'un relevé terrain depuis le calendrier */}
        {activeObservationSlot && (
          <SlotObservationModal
            isOpen={Boolean(activeObservationSlot)}
            onClose={() => setActiveObservationSlot(null)}
            dateStr={activeObservationSlot.dateStr}
            slotKey={activeObservationSlot.slotKey}
            slotStart={activeObservationSlot.slotStart}
            slotEnd={activeObservationSlot.slotEnd}
            slotTitle={activeObservationSlot.customTitle}
            isCustom={activeObservationSlot.isCustom}
            onSaveSuccess={() => {
              setActiveObservationSlot(null);
            }}
            isReadOnly={isReadOnly}
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
