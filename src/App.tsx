import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarGrid } from './components/CalendarGrid';
import { DayDetailPanel } from './components/DayDetailPanel';
import { FocusTab } from './components/FocusTab';
import { Header } from './components/Header';
import { MarnageChart } from './components/MarnageChart';
import { NotesAndHypotheses } from './components/NotesAndHypotheses';
import { SettingsCard } from './components/SettingsCard';
import { TableView } from './components/TableView';
import { TideHeaderCard } from './components/TideHeaderCard';
import { WindguruTable } from './components/WindguruTable';
import {
  AppSettings,
  CustomSlot,
  CustomSlotsMap,
  DayFocusData,
  SessionItem,
  TidePoint,
  ValidationItem,
  ValidationsMap,
  WindPoint,
} from './types';
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
  cmax: 50,
  pcor: true,
  L: 4.5,
  mg: 0,
  lum: -1.1,
  lmg: 0,
  h0: 0,
  h1: 24,
  les: false,
  vmin: 8,
  vmax: 25,
  gmax: 35,
  fmin: 3,
};

export const App: React.FC = () => {
  // Navigation tabs: 1 = Calendrier, 2 = Focus
  const [activeTab, setActiveTab] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cvTab');
      return saved === '2' ? 2 : 1;
    } catch {
      return 1;
    }
  });

  // Current year & month for calendar grid, and selected date
  const [year, setYear] = useState<number>(2026);
  const [month, setMonth] = useState<number>(9); // 0-indexed: 9 = October
  const [selectedDate, setSelectedDate] = useState<string>('2026-10-07');

  // App settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('cvSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...defaultSettings,
          ...parsed,
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
    const today = tdy();
    if (today >= minDs && today <= maxDs) {
      setSelectedDate(today);
      const [yy, mm] = today.split('-').map(Number);
      setYear(yy);
      setMonth(mm - 1);
    }
  }, []);

  const handleUpdateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem('cvSettings', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const handleUpdateCustomSlots = useCallback(
    (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => {
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
        return updated;
      });
    },
    []
  );

  const handleTabChange = (tab: number) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('cvTab', String(tab));
    } catch {
      // ignore
    }
  };

  const handlePrevMonth = () => {
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

  // Validation handler
  const handleValidateDay = (ds: string, record: DayFocusData) => {
    const updated: ValidationsMap = {
      ...validations,
      [ds]: {
        sig: sigOf(record),
        ts: Date.now(),
        k: record.k,
        items: record.list.map(x => ({
          k: kOf(x),
          s: lc(x.a, record.y, record.m, record.d),
          e: lc(x.b, record.y, record.m, record.d),
          opt: x.opt,
          over: x.over,
          lim: x.lim,
          customTitle: x.customTitle,
        })),
      },
    };
    setValidations(updated);
    try {
      localStorage.setItem(VK, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleClearValidation = useCallback((ds: string) => {
    setValidations(prev => {
      const updated = { ...prev };
      delete updated[ds];
      try {
        localStorage.setItem(VK, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const handleToggleSlotValidation = useCallback((record: DayFocusData, slot: SessionItem) => {
    setValidations(prev => {
      const ds = record.ds;
      const existing = prev[ds];
      const slotKey = kOf(slot);
      const currentItems = existing?.items || [];
      const isAlreadyValidated = currentItems.some(item => item.k === slotKey);

      let nextItems: ValidationItem[];
      if (isAlreadyValidated) {
        nextItems = currentItems.filter(item => item.k !== slotKey);
      } else {
        const newItem: ValidationItem = {
          k: slotKey,
          s: lc(slot.a, record.y, record.m, record.d),
          e: lc(slot.b, record.y, record.m, record.d),
          opt: slot.opt,
          over: slot.over,
          lim: slot.lim,
          customTitle: slot.customTitle,
        };
        nextItems = [...currentItems, newItem].sort((p, q) => {
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
      return updated;
    });
  }, []);

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

  return (
    <>
      <Header />
      <main>
        {/* En-tête des marées en haut de page (Exigence 5) */}
        <TideHeaderCard selectedDate={selectedDate} EX={EX} />

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

            <SettingsCard
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              windStatusText={windStatus}
              onRefreshWind={fetchWind}
              isLoadingWind={isLoadingWind}
            />

            <NotesAndHypotheses />
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
            onSelectDayInCalendar={handleSelectDayInCalendar}
            customSlotsMap={customSlotsMap}
            onUpdateCustomSlots={handleUpdateCustomSlots}
          />
        )}
      </main>
    </>
  );
};
