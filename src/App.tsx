import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarGrid } from './components/CalendarGrid';
import { DayDetailPanel } from './components/DayDetailPanel';
import { FocusTab } from './components/FocusTab';
import { Header } from './components/Header';
import { MarnageChart } from './components/MarnageChart';
import { NotesAndHypotheses } from './components/NotesAndHypotheses';
import { PrintableAgendaSheet } from './components/PrintableAgendaSheet';
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
  subscribeToValidations,
  saveValidationToFirestore,
  deleteValidationFromFirestore,
  subscribeToCustomSlots,
  saveCustomSlotsToFirestore,
  seedLocalDataToFirestoreIfEmpty,
  syncLocalDataWithFirestore,
  notifySync,
  subscribeToSessionSettings,
  saveSessionSettingsToFirestore,
  resetAllSettingsToFirestore,
  subscribeToTeamNotes,
} from './utils/firebaseSync';
import {
  ActiveUserSession,
  AppSettings,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  SessionItem,
  TeamNote,
  TidePoint,
  ValidationItem,
  ValidationsMap,
  WindPoint,
} from './types';
import { getActiveUser, clearActiveUser } from './utils/authUtils';
import {
  build,
  kOf,
  LAT,
  lc,
  LNG,
  maxDs,
  minDs,
  sigOf,
  tdy,
  toU,
  win,
} from './utils/tides';

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
  // Navigation tabs: 1 = Calendrier, 2 = Focus, 3 = Fiche Agenda Papier, 4 = Réglages & Hypothèses
  // L'application s'ouvre TOUJOURS sur le Calendrier (Tab 1) par défaut
  const [activeTab, setActiveTab] = useState<number>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === '6') return 6;
      if (tabParam === '5') return 5;
      if (tabParam === '4') return 4;
      if (tabParam === '3' || params.has('autoprint')) return 3;
      if (tabParam === '2') return 2;
    } catch {
      // ignore
    }
    return 1; // Toujours le calendrier au démarrage
  });

  // Current year & month for calendar grid, and selected date (démarrage officiel au 1er novembre 2026)
  const [year, setYear] = useState<number>(2026);
  const [month, setMonth] = useState<number>(10); // 0-indexed: 10 = November
  const [selectedDate, setSelectedDate] = useState<string>('2026-11-01');

  // App settings
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

  // Initialize selected date based on today if in valid range
  useEffect(() => {
    try {
      localStorage.removeItem('cvTab');
    } catch {
      // ignore
    }

    const today = tdy();
    if (today >= minDs && today <= maxDs) {
      setSelectedDate(today);
      const [yy, mm] = today.split('-').map(Number);
      setYear(yy);
      setMonth(mm - 1);
    }

    // Auto-print support when opened in a new standalone window (?autoprint=1)
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('autoprint')) {
        setActiveTab(3);
        const timer = setTimeout(() => {
          try {
            window.focus();
            window.print();
          } catch (e) {
            console.warn('Autoprint failed:', e);
          }
        }, 750);
        return () => clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, []);

  // Initialisation et abonnements temps réel Firestore (partage instantané entre smartphone et PC)
  useEffect(() => {
    // 1. Écouter en temps réel les validations validées/refusées (Firestore = source de vérité absolue)
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

    // 4. Écouter en temps réel les notes d'échange Ben ↔ Jérôme (Module 7)
    const unsubTeamNotes = subscribeToTeamNotes(notes => {
      setTeamNotes(notes);
    });

    return () => {
      unsubValidations();
      unsubCustomSlots();
      unsubSessionSettings();
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

  const handleUpdateCustomSlots = useCallback(
    (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => {
      if (currentUser?.isReadOnly) {
        notifySync('🔒 Mode Contrôle : créneaux sur mesure verrouillés');
        return;
      }
      setCustomSlotsMap(prev => {
        const updated = {
          ...prev,
          [dateStr]: { replaceDefault, slots },
        };
        try {
          localStorage.setItem(CS_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        saveCustomSlotsToFirestore(dateStr, { replaceDefault, slots }).catch(err =>
          console.warn('Erreur Firestore custom slots:', err)
        );
        return updated;
      });
    },
    [currentUser]
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

  // Validation handler with optional mode: 'all' | 'wind_only'
  const handleValidateDay = (
    ds: string,
    record: DayFocusData,
    mode: 'all' | 'wind_only' = 'all'
  ) => {
    if (isReadOnly) {
      notifySync('🔒 Mode Contrôle actif : validations verrouillées pour Benoît');
      return;
    }
    const updated: ValidationsMap = {
      ...validations,
      [ds]: {
        sig: sigOf(record),
        ts: Date.now(),
        k: record.k,
        items: record.list.map(x => {
          const isBadWind = x.ok === false;
          const status: 'valid' | 'rejected' = mode === 'wind_only' && isBadWind ? 'rejected' : 'valid';
          const rejectReason = isBadWind ? 'Vent hors plage' : undefined;
          return {
            k: kOf(x),
            s: lc(x.a, record.y, record.m, record.d),
            e: lc(x.b, record.y, record.m, record.d),
            opt: x.opt,
            over: x.over,
            lim: x.lim,
            customTitle: x.customTitle,
            status,
            rejectReason,
          };
        }),
      },
    };
    setValidations(updated);
    try {
      localStorage.setItem(VK, JSON.stringify(updated));
    } catch {
      // ignore
    }
    saveValidationToFirestore(ds, updated[ds]).catch(err =>
      console.warn('Erreur Firestore validation:', err)
    );
  };

  const handleClearValidation = useCallback((ds: string) => {
    if (isReadOnly) {
      notifySync('🔒 Mode Contrôle : réinitialisation verrouillée pour Benoît');
      return;
    }
    setValidations(prev => {
      const updated = { ...prev };
      delete updated[ds];
      try {
        localStorage.setItem(VK, JSON.stringify(updated));
      } catch {
        // ignore
      }
      deleteValidationFromFirestore(ds).catch(err =>
        console.warn('Erreur Firestore delete validation:', err)
      );
      return updated;
    });
  }, [isReadOnly]);

  const handleSetSlotDecision = useCallback(
    (
      record: DayFocusData,
      slot: SessionItem,
      decision: 'valid' | 'rejected' | 'pending',
      reason?: string
    ) => {
      if (isReadOnly) {
        notifySync('🔒 Mode Contrôle : modifications de créneau verrouillées');
        return;
      }
      setValidations(prev => {
        const ds = record.ds;
        const existing = prev[ds];
        const slotKey = kOf(slot);
        const currentItems = existing?.items || [];
        const existingItem = currentItems.find(it => it.k === slotKey);

        let nextItems: ValidationItem[];
        if (decision === 'pending') {
          nextItems = currentItems.filter(item => item.k !== slotKey);
        } else {
          const isBadWind = slot.ok === false;
          const defaultReason = reason || (isBadWind ? 'Vent hors plage' : 'Refusé / Annulé');
          const updatedItem: ValidationItem = {
            k: slotKey,
            s: lc(slot.a, record.y, record.m, record.d),
            e: lc(slot.b, record.y, record.m, record.d),
            opt: slot.opt,
            over: slot.over,
            lim: slot.lim,
            customTitle: slot.customTitle,
            status: decision,
            rejectReason: decision === 'rejected' ? defaultReason : undefined,
          };

          if (existingItem) {
            nextItems = currentItems.map(it => (it.k === slotKey ? updatedItem : it));
          } else {
            nextItems = [...currentItems, updatedItem];
          }

          nextItems.sort((p, q) => {
            const aStart = record.list.find(x => kOf(x) === p.k)?.a || 0;
            const bStart = record.list.find(x => kOf(x) === q.k)?.a || 0;
            return aStart - bStart;
          });
        }

        let updated: ValidationsMap;
        if (nextItems.length === 0) {
          updated = { ...prev };
          delete updated[ds];
        } else {
          updated = {
            ...prev,
            [ds]: {
              sig: sigOf(record),
              ts: Date.now(),
              k: record.k,
              items: nextItems,
            },
          };
        }

        try {
          localStorage.setItem(VK, JSON.stringify(updated));
        } catch {
          // ignore
        }
        if (nextItems.length === 0) {
          deleteValidationFromFirestore(ds).catch(err =>
            console.warn('Erreur Firestore delete validation:', err)
          );
        } else {
          saveValidationToFirestore(ds, updated[ds]).catch(err =>
            console.warn('Erreur Firestore save validation:', err)
          );
        }
        return updated;
      });
    },
    []
  );

  const handleToggleSlotValidation = useCallback(
    (record: DayFocusData, slot: SessionItem) => {
      const ds = record.ds;
      const existing = validations[ds];
      const slotKey = kOf(slot);
      const item = existing?.items?.find(it => it.k === slotKey);
      if (!item) {
        handleSetSlotDecision(record, slot, 'valid');
      } else if (item.status === 'valid' || !item.status) {
        handleSetSlotDecision(record, slot, 'rejected');
      } else {
        handleSetSlotDecision(record, slot, 'pending');
      }
    },
    [validations, handleSetSlotDecision]
  );

  // Calculations for tides and windows
  const EX: TidePoint[] = useMemo(() => {
    return build(settings.les, settings.pcor, windList);
  }, [settings.les, settings.pcor, windList]);

  const effectiveThreshold = settings.L - (settings.mg || 0) / 100;

  const tideW = useMemo(() => {
    return win(EX, effectiveThreshold);
  }, [EX, effectiveThreshold]);

  const first = EX[0]?.t ?? 0;
  const last = EX[EX.length - 1]?.t ?? 0;

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
        {/* En-tête des marées en haut de page (masqué en onglet 3, 4, 5, 6 et 7 et à l'impression) */}
        {activeTab <= 2 && <TideHeaderCard selectedDate={selectedDate} EX={EX} />}

        {/* Navigation tabs */}
        <nav className="tabs noprint">
          <button
            type="button"
            className={activeTab === 1 ? 'on' : ''}
            onClick={() => handleTabChange(1)}
          >
            Calendrier
          </button>
          <button
            type="button"
            className={activeTab === 2 ? 'on' : ''}
            onClick={() => handleTabChange(2)}
          >
            Focus Lendemain
          </button>
          <button
            type="button"
            className={activeTab === 3 ? 'on' : ''}
            onClick={() => handleTabChange(3)}
          >
            📋 Fiche Agenda Papier
          </button>
          <button
            type="button"
            className={activeTab === 4 ? 'on' : ''}
            onClick={() => handleTabChange(4)}
          >
            📊 Statistiques & Relevés
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
            className={activeTab === 5 ? 'on' : ''}
            onClick={() => handleTabChange(5)}
          >
            👥 Répertoire Clients
          </button>
          <button
            type="button"
            className={activeTab === 6 ? 'on' : ''}
            onClick={() => handleTabChange(6)}
          >
            💡 Hypothèses & Notes
          </button>
        </nav>

        {/* Tab 1: Calendrier */}
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
              customSlotsMap={customSlotsMap}
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
              onValidateDay={handleValidateDay}
              onClearValidation={handleClearValidation}
              onToggleSlotValidation={handleToggleSlotValidation}
              onSetSlotDecision={handleSetSlotDecision}
              onOpenPrintAgenda={() => handleTabChange(3)}
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

            {/* Lien d'accès direct vers le nouvel onglet Hypothèses & Notes */}
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
                    Réglages validés et hypothèses du moniteur & notes de calcul
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--mu)', marginTop: '2px' }}>
                    Règles d'enchaînement, pauses, surcote barométrique détaillée et explications techniques.
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="fbtn"
                onClick={() => {
                  handleTabChange(5);
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
                <span>Consulter les Hypothèses & Notes</span>
                <span style={{ fontSize: '0.95rem' }}>➔</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Focus (Limité au lendemain avec tableau Windguru, Exigences 7 & 8) */}
        {activeTab === 2 && (
          <FocusTab
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            EX={EX}
            W={tideW}
            first={first}
            last={last}
            windList={windList}
            validations={validations}
            onValidateDay={handleValidateDay}
            onClearValidation={handleClearValidation}
            onToggleSlotValidation={handleToggleSlotValidation}
            onSetSlotDecision={handleSetSlotDecision}
            onSelectDayInCalendar={handleSelectDayInCalendar}
            customSlotsMap={customSlotsMap}
            onUpdateCustomSlots={handleUpdateCustomSlots}
            onOpenPrintAgenda={() => handleTabChange(3)}
            onOpenObservationModal={slot => setActiveObservationSlot(slot)}
            isReadOnly={isReadOnly}
          />
        )}

        {/* Tab 3: Fiche Agenda Papier (Impression et collage agenda) */}
        {activeTab === 3 && (
          <PrintableAgendaSheet
            settings={settings}
            EX={EX}
            W={tideW}
            first={first}
            last={last}
            windList={windList}
            validations={validations}
            customSlotsMap={customSlotsMap}
            onUpdateCustomSlots={handleUpdateCustomSlots}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onValidateDay={handleValidateDay}
            onToggleSlotValidation={handleToggleSlotValidation}
            onSetSlotDecision={handleSetSlotDecision}
            isReadOnly={isReadOnly}
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

            {/* Carte Administration Équipe & Utilisateurs (Réservée aux Administrateurs Jérôme & Benoît) */}
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
