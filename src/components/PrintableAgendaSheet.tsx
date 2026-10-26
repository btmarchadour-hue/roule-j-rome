import React, { useMemo, useState } from 'react';
import { DATA } from '../data/tideData';
import {
  AppSettings,
  CustomSlotsMap,
  DayFocusData,
  SessionItem,
  TidePoint,
  ValidationsMap,
  WindPoint,
} from '../types';
import {
  comp,
  dayFocus,
  getTideCoef,
  hAt,
  kOf,
  lc,
  p2,
  shf,
  sunInfo,
  tdy,
  toU,
  windAt,
} from '../utils/tides';
import { getFrenchHolidayInfo, HolidayInfo } from '../utils/frenchHolidays';

interface PrintableAgendaSheetProps {
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  validations: ValidationsMap;
  customSlotsMap?: CustomSlotsMap;
  selectedDate: string;
  onSelectDate?: (ds: string) => void;
  onValidateDay?: (ds: string, record: DayFocusData, mode?: 'all' | 'wind_only') => void;
  onToggleSlotValidation?: (record: DayFocusData, slot: SessionItem) => void;
  onSetSlotDecision?: (
    record: DayFocusData,
    slot: SessionItem,
    decision: 'valid' | 'rejected' | 'pending',
    reason?: string
  ) => void;
}

type RangeOption = 'selected' | '5days' | 'week' | 'month' | 'custom' | 'all';
export type LayoutOption = 'agenda' | 'strips' | 'cards' | 'table';
export type FilterOption = 'validated' | 'validated_only' | 'navigable' | 'all';
export type EmargementOption = 'with_bookings' | 'handwritten' | 'none';

interface DayPrintData {
  ds: string;
  dateObj: Date;
  weekdayStr: string;
  fullDateStr: string;
  coeff: number;
  bmInfo: string;
  bmTimeStr: string;
  bmHeight: number | null;
  pmInfo: string;
  pmTimeStr: string;
  pmHeight: number | null;
  holiday: HolidayInfo;
  sunRise: string;
  sunSet: string;
  isNear5Days: boolean;
  dayWeather: {
    windRange: string;
    gustMax: number | null;
    dirComp: string;
    dirDeg: number | null;
    temp: number | null;
    tempChill: number | null;
    cloudText: string;
    rainMm: number | null;
    model: string;
    waveH: number | null;
    wavePeriod: number | null;
    waveDirComp: string | null;
    waveDirDeg: number | null;
  } | null;
  slots: {
    slot: SessionItem;
    key: string;
    startStr: string;
    endStr: string;
    status: 'valid' | 'rejected' | 'pending';
    rejectReason?: string;
    isValidated: boolean;
    isRejected: boolean;
    hStart: number | null;
    hEnd: number | null;
    trend: 'down' | 'up' | 'flat';
    weather: {
      windKts: number | null;
      gustKts: number | null;
      dir: string;
      temp: number | null;
      cond: string;
      waveH: number | null;
      wavePeriod: number | null;
      waveDir: string | null;
    } | null;
  }[];
  rawSlots: {
    slot: SessionItem;
    key: string;
    startStr: string;
    endStr: string;
    status: 'valid' | 'rejected' | 'pending';
    rejectReason?: string;
    isValidated: boolean;
    isRejected: boolean;
    hStart: number | null;
    hEnd: number | null;
    trend: 'down' | 'up' | 'flat';
    weather: {
      windKts: number | null;
      gustKts: number | null;
      dir: string;
      temp: number | null;
      cond: string;
      waveH: number | null;
      wavePeriod: number | null;
      waveDir: string | null;
    } | null;
  }[];
  focusData: DayFocusData;
}

export interface AgendaBookingItem {
  id: string;
  name: string;        // Nom / Responsable
  phone: string;       // Téléphone portable
  pax: string;         // Participants (ex: 3 pers.)
  chars: string;       // Matériel / Chars (Mono / Bi)
  formula: string;     // Formule (Initiation, Perf, Balade, Famille...)
  payment: string;     // Règlement (CB, Chèque, Espèces, ANCV, Acompte)
  status: 'valid' | 'pending' | 'signed'; // Pointage
  notes: string;       // Remarques, pointures, casques
}

export const PrintableAgendaSheet: React.FC<PrintableAgendaSheetProps> = ({
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations,
  customSlotsMap = {},
  selectedDate,
  onSelectDate,
  onValidateDay,
  onToggleSlotValidation,
  onSetSlotDecision,
}) => {
  const todayStr = useMemo(() => tdy(), []);
  const allAvailableDates = useMemo(() => DATA.map(d => d[0]), []);

  // 1. Période à imprimer
  const [rangeMode, setRangeMode] = useState<RangeOption>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const r = p.get('range') as RangeOption;
      if (r && ['selected', '5days', 'week', 'month', 'custom', 'all'].includes(r)) return r;
      const s = localStorage.getItem('char_agenda_range') as RangeOption;
      if (s && ['selected', '5days', 'week', 'month', 'custom', 'all'].includes(s)) return s;
    } catch {
      // ignore
    }
    return 'selected';
  });

  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const s = p.get('start');
      if (s) return s;
      const saved = localStorage.getItem('char_agenda_start');
      if (saved) return saved;
    } catch {
      // ignore
    }
    return selectedDate || todayStr;
  });

  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const e = p.get('end');
      if (e) return e;
      const saved = localStorage.getItem('char_agenda_end');
      if (saved) return saved;
    } catch {
      // ignore
    }
    return shf(selectedDate || todayStr, 7);
  });

  // 2. Séances affichées
  const [filterMode, setFilterMode] = useState<FilterOption>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const f = p.get('filter') as FilterOption;
      if (f && ['validated', 'validated_only', 'navigable', 'all'].includes(f)) return f;
      const saved = localStorage.getItem('char_agenda_filter') as FilterOption;
      if (saved && ['validated', 'validated_only', 'navigable', 'all'].includes(saved)) return saved;
    } catch {
      // ignore
    }
    return 'validated';
  });

  // 3. Format d'impression
  const [layoutMode, setLayoutMode] = useState<LayoutOption>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const l = p.get('layout') as LayoutOption;
      if (l && ['agenda', 'strips', 'cards', 'table'].includes(l)) return l;
      const saved = localStorage.getItem('char_agenda_layout') as LayoutOption;
      if (saved && ['agenda', 'strips', 'cards', 'table'].includes(saved)) return saved;
    } catch {
      // ignore
    }
    return 'agenda';
  });

  // 4. Option émargement
  const [emargementMode, setEmargementMode] = useState<EmargementOption>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const e = p.get('emargement') as EmargementOption;
      if (e && ['with_bookings', 'handwritten', 'none'].includes(e)) return e;
      const saved = localStorage.getItem('char_agenda_emargement') as EmargementOption;
      if (saved && ['with_bookings', 'handwritten', 'none'].includes(saved)) return saved;
    } catch {
      // ignore
    }
    return 'with_bookings';
  });

  const [showRejected, setShowRejected] = useState<boolean>(true);
  const includeNotesBox = emargementMode !== 'none';

  // Inscriptions & réservations clients via l'application (mémorisation locale persistante v3)
  const [bookingsMap, setBookingsMap] = useState<Record<string, AgendaBookingItem[]>>(() => {
    try {
      const saved = localStorage.getItem('char_agenda_bookings_v3');
      if (saved) return JSON.parse(saved);
      // Migration automatique v2 -> v3 si disponible
      const old = localStorage.getItem('char_agenda_bookings_v2');
      if (old) {
        const parsed = JSON.parse(old);
        const migrated: Record<string, AgendaBookingItem[]> = {};
        for (const [key, items] of Object.entries(parsed)) {
          if (Array.isArray(items)) {
            migrated[key] = items
              .filter((it: any) => it && (it.name || it.phone || it.chars || it.payment))
              .map((it: any, i: number) => ({
                id: `b_${Date.now()}_${i}`,
                name: it.name || '',
                phone: it.phone || '',
                pax: it.ages ? `${it.ages}` : '',
                chars: it.chars || '',
                formula: 'Initiation',
                payment: it.payment || '',
                status: 'valid',
                notes: '',
              }));
          }
        }
        return migrated;
      }
    } catch {
      // ignore
    }
    return {};
  });

  const saveBookingsMap = (next: Record<string, AgendaBookingItem[]>) => {
    setBookingsMap(next);
    try {
      localStorage.setItem('char_agenda_bookings_v3', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const getSlotBookings = (slotKey: string): AgendaBookingItem[] => {
    return bookingsMap[slotKey] || [];
  };

  const handleAddBooking = (slotKey: string) => {
    const list = getSlotBookings(slotKey);
    const newBooking: AgendaBookingItem = {
      id: `bk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      phone: '',
      pax: '',
      chars: '',
      formula: 'Initiation',
      payment: '',
      status: 'pending',
      notes: '',
    };
    saveBookingsMap({
      ...bookingsMap,
      [slotKey]: [...list, newBooking],
    });
  };

  const handleUpdateBooking = (
    slotKey: string,
    id: string,
    field: keyof AgendaBookingItem,
    value: any
  ) => {
    const list = getSlotBookings(slotKey).map(b => (b.id === id ? { ...b, [field]: value } : b));
    saveBookingsMap({
      ...bookingsMap,
      [slotKey]: list,
    });
  };

  const handleRemoveBooking = (slotKey: string, id: string) => {
    const list = getSlotBookings(slotKey).filter(b => b.id !== id);
    saveBookingsMap({
      ...bookingsMap,
      [slotKey]: list,
    });
  };

  const handlePrefillExample = (slotKey: string) => {
    const examples: AgendaBookingItem[] = [
      {
        id: `bk_ex1_${Date.now()}`,
        name: 'Famille Dupont (Marc)',
        phone: '06 12 34 56 78',
        pax: '3 pers. (2 ad + 1 enf 12a)',
        chars: '1 biplace + 1 mono',
        formula: 'Initiation 2h',
        payment: '135 € réglé CB',
        status: 'valid',
        notes: 'Combinaisons : 2 M, 1 S · Casques M/S',
      },
      {
        id: `bk_ex2_${Date.now()}`,
        name: 'Thomas & Julie',
        phone: '06 98 76 54 32',
        pax: '2 adultes',
        chars: '2 monoplaces',
        formula: 'Perfectionnement',
        payment: 'Acompte 40 € versé (Solde 60 €)',
        status: 'pending',
        notes: 'Ont déjà pratiqué l’été dernier',
      },
    ];
    saveBookingsMap({
      ...bookingsMap,
      [slotKey]: examples,
    });
  };

  const handleClearSlotBookings = (slotKey: string) => {
    const next = { ...bookingsMap };
    delete next[slotKey];
    saveBookingsMap(next);
  };

  // Compute active date list according to rangeMode
  const targetDates = useMemo(() => {
    if (rangeMode === 'selected') {
      return [selectedDate];
    }
    if (rangeMode === '5days') {
      const dates: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = shf(todayStr, i);
        if (allAvailableDates.includes(d)) dates.push(d);
      }
      return dates.length > 0 ? dates : [selectedDate];
    }
    if (rangeMode === 'week') {
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = shf(todayStr, i);
        if (allAvailableDates.includes(d)) dates.push(d);
      }
      return dates.length > 0 ? dates : [selectedDate];
    }
    if (rangeMode === 'month') {
      const [sy, sm] = selectedDate.split('-').map(Number);
      const prefix = `${sy}-${p2(sm)}`;
      return allAvailableDates.filter(d => d.startsWith(prefix));
    }
    if (rangeMode === 'custom') {
      const start = customStartDate || selectedDate || todayStr;
      const end = customEndDate || shf(start, 7);
      const minD = start <= end ? start : end;
      const maxD = start <= end ? end : start;
      const dates: string[] = [];
      let cur = minD;
      let count = 0;
      while (cur <= maxD && count < 500) {
        if (allAvailableDates.includes(cur)) {
          dates.push(cur);
        }
        cur = shf(cur, 1);
        count++;
      }
      return dates.length > 0 ? dates : [selectedDate];
    }
    // 'all'
    return allAvailableDates;
  }, [rangeMode, selectedDate, todayStr, allAvailableDates, customStartDate, customEndDate]);

  // Compute 5-day horizon boundary for detailed weather indications
  const fiveDaysHorizon = useMemo(() => shf(todayStr, 4), [todayStr]);

  // Build full day data for printing
  const daysData: DayPrintData[] = useMemo(() => {
    return targetDates.map(ds => {
      const [y, m0, d] = ds.split('-').map(Number);
      const m = m0 - 1;
      const dateObj = new Date(Date.UTC(y, m, d));

      const weekdayStr = dateObj.toLocaleDateString('fr-FR', {
        weekday: 'long',
        timeZone: 'UTC',
      });
      const fullDateStr = dateObj.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });

      const coeff = getTideCoef(toU(y, m, d, 720), ds);

      // Low & High tides for the day
      const t0 = toU(y, m, d, 0);
      const t1 = toU(y, m, d + 1, 0);
      const dayTides = EX.filter(p => p.t >= t0 && p.t < t1);
      const bmList = dayTides.filter(p => !p.pm);
      const pmList = dayTides.filter(p => p.pm);

      const bmInfo = bmList
        .map(p => `${lc(p.t, y, m, d)} (haut. ${p.h.toFixed(2)} m)`)
        .join(', ') || '—';
      const pmInfo = pmList
        .map(p => `${lc(p.t, y, m, d)} (haut. ${p.h.toFixed(2)} m)`)
        .join(', ') || '—';

      const mainBm = bmList[0];
      const bmTimeStr = mainBm ? lc(mainBm.t, y, m, d) : '—';
      const bmHeight = mainBm ? mainBm.h : null;

      const mainPm = pmList[0];
      const pmTimeStr = mainPm ? lc(mainPm.t, y, m, d) : '—';
      const pmHeight = mainPm ? mainPm.h : null;

      const holiday = getFrenchHolidayInfo(ds);

      // Sunlight
      const sun = sunInfo(y, m, d, settings.lum, settings.lmg);

      // Near 5 days check
      const isNear5Days = ds >= todayStr && ds <= fiveDaysHorizon;

      // Focus data with planned slots
      const focus = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
      const valRecord = validations[ds];

      // Day general weather if within 5 days
      let dayWeather: DayPrintData['dayWeather'] = null;
      if (isNear5Days && windList.length > 0) {
        // Find wind points between sun sunrise & sunset or tide window
        const tMid = toU(y, m, d, 720);
        const wMid = windAt(tMid, windList);
        if (wMid) {
          let cloudText = 'Ensoleillé';
          if (wMid.cc != null) {
            if (wMid.cc > 80) cloudText = 'Couvert';
            else if (wMid.cc > 40) cloudText = 'Éclaircies';
            else cloudText = 'Dégagé';
          }
          if (wMid.pr != null && wMid.pr > 0.1) {
            cloudText += ` · Pluie ${wMid.pr.toFixed(1)} mm`;
          }

          dayWeather = {
            windRange: focus.rng || (wMid.v != null ? `${Math.round(wMid.v)} nds` : '—'),
            gustMax: wMid.g != null ? Math.round(wMid.g) : null,
            dirComp: comp(wMid.a),
            dirDeg: Math.round(wMid.a),
            temp: wMid.tp != null ? Math.round(wMid.tp) : null,
            tempChill: wMid.ap != null ? Math.round(wMid.ap) : null,
            cloudText,
            rainMm: wMid.pr != null ? +wMid.pr.toFixed(1) : null,
            model: wMid.s === 'A' ? 'AROME' : 'Modèle global',
            waveH: wMid.wvh != null ? +wMid.wvh.toFixed(1) : null,
            wavePeriod: wMid.wvp != null ? Math.round(wMid.wvp) : null,
            waveDirComp: wMid.wvd != null ? comp(wMid.wvd) : null,
            waveDirDeg: wMid.wvd != null ? Math.round(wMid.wvd) : null,
          };
        }
      }

      // Format each slot with exact water levels at start and end
      const rawSlots = focus.list.map(slot => {
        const key = kOf(slot);
        const valItem = valRecord?.items?.find(it => it.k === key);

        let status: 'valid' | 'rejected' | 'pending';
        let rejectReason: string | undefined = valItem?.rejectReason;

        if (valItem) {
          status = valItem.status === 'rejected' ? 'rejected' : 'valid';
        } else if (slot.ok === false) {
          // Vent hors plage selon les critères (vitesse max dépassée, rafales)
          status = 'rejected';
          const gStr = slot.st?.g ? `, raf. ${Math.round(slot.st.g)} nds` : '';
          const vStr = slot.st ? `${Math.round(slot.st.lo)}–${Math.round(slot.st.hi)} nds` : '';
          rejectReason = `Vent hors plage ${vStr ? `(${vStr}${gStr})` : 'défavorable'}`.trim();
        } else {
          status = 'pending';
        }

        const isValidated = status === 'valid';
        const isRejected = status === 'rejected';
        if (isRejected && !rejectReason) {
          rejectReason = slot.ok === false ? 'Vent hors plage' : 'Séance refusée';
        }

        const startStr = lc(slot.a, y, m, d);
        const endStr = lc(slot.b, y, m, d);

        // Exact interpolated water heights
        const hStart = hAt(slot.a, EX);
        const hEnd = hAt(slot.b, EX);

        let trend: 'down' | 'up' | 'flat' = 'flat';
        if (hStart != null && hEnd != null) {
          if (hEnd < hStart - 0.05) trend = 'down';
          else if (hEnd > hStart + 0.05) trend = 'up';
        }

        // Slot weather if in 5 days
        let weather: DayPrintData['slots'][0]['weather'] = null;
        if (isNear5Days && windList.length > 0) {
          const wSlot = windAt((slot.a + slot.b) / 2, windList);
          if (wSlot) {
            let cond = 'Vent OK';
            if (slot.ok === false) cond = 'Hors plage';
            else if (wSlot.pr && wSlot.pr > 0.2) cond = 'Averses';

            weather = {
              windKts: Math.round(wSlot.v),
              gustKts: wSlot.g != null ? Math.round(wSlot.g) : null,
              dir: comp(wSlot.a),
              temp: wSlot.tp != null ? Math.round(wSlot.tp) : null,
              cond,
              waveH: wSlot.wvh != null ? +wSlot.wvh.toFixed(1) : null,
              wavePeriod: wSlot.wvp != null ? Math.round(wSlot.wvp) : null,
              waveDir: wSlot.wvd != null ? comp(wSlot.wvd) : null,
            };
          }
        }

        return {
          slot,
          key,
          startStr,
          endStr,
          status,
          rejectReason,
          isValidated,
          isRejected,
          hStart,
          hEnd,
          trend,
          weather,
        };
      });

      // Filter slots according to user filter
      const filteredSlots = rawSlots.filter(s => {
        if (s.isRejected) {
          if (!showRejected) return false;
          if (filterMode === 'validated_only' || filterMode === 'navigable') return false;
          return true; // Included in 'validated' (decisions) and 'all'
        }
        if (filterMode === 'validated' || filterMode === 'validated_only') {
          return s.isValidated;
        }
        if (filterMode === 'navigable') {
          return !s.isRejected;
        }
        // 'all' includes pending as well
        return true;
      });

      return {
        ds,
        dateObj,
        weekdayStr,
        fullDateStr,
        coeff,
        bmInfo,
        bmTimeStr,
        bmHeight,
        pmInfo,
        pmTimeStr,
        pmHeight,
        holiday,
        sunRise: sun.lev,
        sunSet: sun.cou,
        isNear5Days,
        dayWeather,
        slots: filteredSlots,
        rawSlots,
        focusData: focus,
      };
    });
  }, [
    targetDates,
    todayStr,
    fiveDaysHorizon,
    settings.lum,
    settings.lmg,
    tideW,
    first,
    last,
    windList,
    customSlotsMap,
    validations,
    filterMode,
    showRejected,
    EX,
  ]);

  // Total validated & rejected slots in the current view
  const totalSlotsCount = useMemo(() => {
    return daysData.reduce((acc, d) => acc + d.slots.filter(s => s.isValidated).length, 0);
  }, [daysData]);

  const totalRejectedSlotsCount = useMemo(() => {
    return daysData.reduce((acc, d) => acc + d.slots.filter(s => s.isRejected).length, 0);
  }, [daysData]);

  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  const handlePrint = () => {
    try {
      window.focus();
      // Try direct native print
      window.print();
    } catch (err) {
      console.warn('Native window.print() blocked by iframe sandbox:', err);
      setShowPrintModal(true);
    }
  };

  const handleDownloadHtml = () => {
    const sheetEl = document.querySelector('.printable-agenda-sheet');
    if (!sheetEl) return;

    const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agenda Papier Char a Voile - Lestrevet (${selectedDate})</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #fff;
      color: #0f172a;
      margin: 0;
      padding: 16px;
    }
    .print-hide, .nop, .noprint { display: none !important; }
    table { width: 100%; border-collapse: collapse; }
    .agenda-daily-page {
      border: 1.5px solid #0f172a;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 24px;
      page-break-after: always;
      break-after: page;
      break-inside: avoid;
      background: #fff;
    }
    .agenda-slot-section {
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .agenda-daily-input {
      border: none !important;
      background: transparent !important;
      width: 100%;
      font-family: inherit;
    }
    .agenda-strip {
      width: 185px;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 8px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .strips-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    @media print {
      body { padding: 0 !important; }
      .agenda-daily-page { padding: 10mm 8mm !important; margin-bottom: 0 !important; }
      @page { size: auto; margin: 8mm 6mm; }
    }
  </style>
</head>
<body>
  ${sheetEl.outerHTML}
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.focus();
        window.print();
      }, 350);
    };
  <\/script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Agenda-Char-a-Voile-${selectedDate}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const standalonePrintUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams();
    params.set('tab', '3');
    params.set('autoprint', '1');
    params.set('range', rangeMode);
    params.set('layout', layoutMode);
    params.set('filter', filterMode);
    params.set('emargement', emargementMode);
    params.set('sel', selectedDate);
    if (rangeMode === 'custom') {
      params.set('start', customStartDate);
      params.set('end', customEndDate);
    }
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, [rangeMode, layoutMode, filterMode, emargementMode, selectedDate, customStartDate, customEndDate]);

  const handleValidateAllInView = (mode: 'all' | 'wind_only' = 'all') => {
    if (!onValidateDay) return;
    for (const d of daysData) {
      if (d.focusData && d.focusData.list.length > 0) {
        onValidateDay(d.ds, d.focusData, mode);
      }
    }
  };

  const selectedMonthLabel = useMemo(() => {
    const [sy, sm] = selectedDate.split('-').map(Number);
    return new Date(Date.UTC(sy, sm - 1, 1)).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [selectedDate]);

  return (
    <div className="printable-agenda-wrapper">
      {/* Barre de configuration épurée avec menus déroulants (Masquée à l'impression) */}
      <div className="card nop print-toolbar" style={{ marginBottom: '16px', background: 'var(--card, #fff)', border: '1.5px solid var(--bd, #cbd5e1)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--bd, #e2e8f0)', paddingBottom: '12px', marginBottom: '14px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--tx, #111)' }}>
              <span>📋</span> Fiche Agenda Papier & Inscriptions Terrain
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--mu, #64748b)' }}>
              Horaires de roulage, marées, météo et gestion des inscriptions clients. Format optimisé pour collage ou classeur.
            </p>
          </div>

          {/* Boutons d'action rapides */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="fbtn"
              onClick={handlePrint}
              style={{
                margin: 0,
                background: '#16a34a',
                color: '#fff',
                padding: '10px 18px',
                fontSize: '0.84rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)',
                fontWeight: 900,
                cursor: 'pointer',
                border: 'none',
              }}
              title="Lancer l'impression directe de la sélection"
            >
              <span>🖨️</span> Imprimer
            </button>

            {standalonePrintUrl && (
              <a
                href={standalonePrintUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="fbtn"
                style={{
                  margin: 0,
                  background: '#0284c7',
                  color: '#fff',
                  padding: '10px 16px',
                  fontSize: '0.84rem',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  textDecoration: 'none',
                  fontWeight: 800,
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
                }}
                title="Ouvrir dans un nouvel onglet avec la sélection exacte (recommandé si l'impression est bloquée par le navigateur)"
              >
                <span>🚀</span> Nouvel onglet (Impression pure)
              </a>
            )}

            <button
              type="button"
              className="fbtn"
              onClick={handleDownloadHtml}
              style={{
                margin: 0,
                background: '#475569',
                color: '#fff',
                padding: '10px 14px',
                fontSize: '0.84rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                cursor: 'pointer',
                border: 'none',
              }}
              title="Télécharger la fiche en fichier HTML autonome"
            >
              <span>💾</span> Télécharger HTML
            </button>
          </div>
        </div>

        {/* LES 4 MENUS DÉROULANTS PAR OPTIONS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
          {/* 1. Période à imprimer */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #64748b)', fontWeight: 800, display: 'block', marginBottom: '6px' }}>
              1. Période à imprimer
            </label>
            <select
              value={rangeMode}
              onChange={e => {
                const val = e.target.value as RangeOption;
                setRangeMode(val);
                try { localStorage.setItem('char_agenda_range', val); } catch {}
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--bd, #cbd5e1)',
                background: 'var(--card, #fff)',
                color: 'var(--tx, #111)',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              <option value="selected">🎯 Jour sélectionné ({selectedDate})</option>
              <option value="5days">🌟 5 prochains jours (dès aujourd'hui)</option>
              <option value="week">📅 Semaine en cours (7 jours)</option>
              <option value="month">📆 Mois affiché ({selectedMonthLabel})</option>
              <option value="custom">🗓️ De date à date (personnalisée)...</option>
              <option value="all">🌊 Toute la saison (saison complète)</option>
            </select>
          </div>

          {/* 2. Séances affichées */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #64748b)', fontWeight: 800, display: 'block', marginBottom: '6px' }}>
              2. Séances affichées
            </label>
            <select
              value={filterMode}
              onChange={e => {
                const val = e.target.value as FilterOption;
                setFilterMode(val);
                try { localStorage.setItem('char_agenda_filter', val); } catch {}
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--bd, #cbd5e1)',
                background: 'var(--card, #fff)',
                color: 'var(--tx, #111)',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              <option value="validated">✓ Validées & Refusées (toutes les décisions)</option>
              <option value="validated_only">✓ Validées seules (créneaux confirmés)</option>
              <option value="navigable">💨 Navigables uniquement (vent & marée OK)</option>
              <option value="all">📋 Toutes les séances (avec créneaux en attente)</option>
            </select>
          </div>

          {/* 3. Format d'impression */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #64748b)', fontWeight: 800, display: 'block', marginBottom: '6px' }}>
              3. Format d'impression
            </label>
            <select
              value={layoutMode}
              onChange={e => {
                const val = e.target.value as LayoutOption;
                setLayoutMode(val);
                try { localStorage.setItem('char_agenda_layout', val); } catch {}
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--bd, #cbd5e1)',
                background: 'var(--card, #fff)',
                color: 'var(--tx, #111)',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              <option value="agenda">📁 Fiche Agenda Quotidienne (A4/A5 classeur, planning & clients)</option>
              <option value="strips">✂️ Bandelettes / Étiquettes compactes (agenda de poche)</option>
              <option value="cards">📑 Fiches Blocs synthétiques</option>
              <option value="table">📊 Grand Tableau récapitulatif (A4 paysage)</option>
            </select>
          </div>

          {/* 4. Option émargement */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #64748b)', fontWeight: 800, display: 'block', marginBottom: '6px' }}>
              4. Option émargement
            </label>
            <select
              value={emargementMode}
              onChange={e => {
                const val = e.target.value as EmargementOption;
                setEmargementMode(val);
                try { localStorage.setItem('char_agenda_emargement', val); } catch {}
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--bd, #cbd5e1)',
                background: 'var(--card, #fff)',
                color: 'var(--tx, #111)',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              <option value="with_bookings">Tableau complet (clients saisis + lignes d'écriture manuscrite)</option>
              <option value="handwritten">Lignes vierges d'écriture manuscrite seules</option>
              <option value="none">Sans tableau d'émargement (horaires & météo seuls)</option>
            </select>
          </div>
        </div>

        {/* Sélecteur de date à date quand rangeMode === 'custom' */}
        {rangeMode === 'custom' && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#f0f9ff', border: '1.5px solid #0284c7', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 900, color: '#0369a1' }}>
              🗓️ Sélection de date à date :
            </span>
            <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#0f172a' }}>
              <span>Date de début (Du) :</span>
              <input
                type="date"
                value={customStartDate}
                onChange={e => {
                  setCustomStartDate(e.target.value);
                  try { localStorage.setItem('char_agenda_start', e.target.value); } catch {}
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1.5px solid #0284c7',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  background: '#fff',
                }}
              />
            </label>
            <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#0f172a' }}>
              <span>Date de fin (Au) :</span>
              <input
                type="date"
                value={customEndDate}
                onChange={e => {
                  setCustomEndDate(e.target.value);
                  try { localStorage.setItem('char_agenda_end', e.target.value); } catch {}
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1.5px solid #0284c7',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  background: '#fff',
                }}
              />
            </label>
            <span style={{ fontSize: '0.76rem', color: '#0369a1', fontWeight: 700 }}>
              ➔ <strong>{daysData.length} jour{daysData.length > 1 ? 's' : ''}</strong> seront exactement imprimés
            </span>
          </div>
        )}

        {/* Bandeau indicateur d'état */}
        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--bd, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', fontSize: '0.76rem', color: 'var(--mu, #64748b)' }}>
          <div>
            <strong style={{ color: 'var(--tx, #111)' }}>{daysData.length} jour{daysData.length > 1 ? 's' : ''}</strong> sélectionnés · <strong style={{ color: 'var(--tx, #111)' }}>{totalSlotsCount} séance{totalSlotsCount > 1 ? 's' : ''} validée{totalSlotsCount > 1 ? 's' : ''}</strong>
            {totalRejectedSlotsCount > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> · {totalRejectedSlotsCount} refusée{totalRejectedSlotsCount > 1 ? 's' : ''}</span>}
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {onValidateDay && (
              <>
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    background: '#0284c7',
                    color: '#fff',
                    borderRadius: '6px',
                  }}
                  onClick={() => handleValidateAllInView('wind_only')}
                  title="Valider automatiquement les créneaux vent OK sur cette période"
                >
                  ⚡ Valider si Vent OK
                </button>
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    background: '#16a34a',
                    color: '#fff',
                    borderRadius: '6px',
                  }}
                  onClick={() => handleValidateAllInView('all')}
                  title="Valider toutes les séances sur cette période"
                >
                  ✓ Tout valider
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* PRINTABLE CONTENT CONTAINER */}
      <div className="printable-agenda-sheet">
        {/* Print Header (uniquement utile en mode tableau A4, masqué pour n'imprimer que les étiquettes ou fiches agendas) */}
        <div
          className={`print-header ${layoutMode === 'strips' || layoutMode === 'agenda' ? 'print-hide' : ''}`}
          style={{ marginBottom: '14px', borderBottom: '2px solid #111', paddingBottom: '8px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Char à Voile du Bout du Monde
              </div>
              <div style={{ fontSize: '0.8rem', color: '#333' }}>
                Plage de Lestrevet · Plomodiern · Fiche d'agenda et d'émargement terrain
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.74rem', color: '#444' }}>
              <div>Édition du {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div>
                <strong>{totalSlotsCount} séance{totalSlotsCount > 1 ? 's' : ''} validée{totalSlotsCount > 1 ? 's' : ''}</strong>
                {totalRejectedSlotsCount > 0 && <span style={{ color: '#dc2626', fontWeight: 800 }}> · {totalRejectedSlotsCount} refusée{totalRejectedSlotsCount > 1 ? 's' : ''}</span>}
                <span> · Seuil roulage : <strong>{settings.L.toFixed(2)} m</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* VIEW 0: PAGE AGENDA QUOTIDIEN (Réplique & Optimisation Carnet de Bord / Inscriptions Terrain) */}
        {layoutMode === 'agenda' && (
          <div className="agenda-daily-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {daysData.map(day => (
              <div
                key={day.ds}
                className="agenda-daily-page"
                style={{
                  background: '#fff',
                  border: '2px solid #0f172a',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  color: '#0f172a',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid',
                  pageBreakAfter: 'always',
                  breakAfter: 'page',
                }}
              >
                {/* 1. EN-TÊTE : DATE, SEMAINE ET VACANCES SCOLAIRES */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2.5px solid #0f172a', paddingBottom: '10px', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 800, color: '#64748b', letterSpacing: '0.06em' }}>
                      Char à Voile du Bout du Monde · Plage de Lestrevet · Agenda de Bord
                    </div>
                    <h1 style={{ margin: '2px 0 0', fontSize: '1.5rem', fontWeight: 900, textTransform: 'capitalize', color: '#0f172a', letterSpacing: '-0.01em' }}>
                      {day.fullDateStr}
                    </h1>
                    <div style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 600, marginTop: '2px' }}>
                      Semaine n° {day.holiday.weekNumber} · Édition du {new Date().toLocaleDateString('fr-FR')}
                    </div>
                  </div>

                  {/* INDICATEUR VACANCES SCOLAIRES (Inspiré des 3 pastilles de couleur de l'agenda papier !) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    {day.holiday.isHoliday ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fef2f2', border: '1.5px solid #dc2626', padding: '6px 12px', borderRadius: '8px' }}>
                        <span style={{ fontSize: '1.25rem' }}>🎒</span>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 900, fontSize: '0.86rem', color: '#b91c1c', textTransform: 'uppercase' }}>
                            {day.holiday.holidayName}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#7f1d1d', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>{day.holiday.zonesLabel}</span>
                            <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                              <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '0.62rem', fontWeight: 900, color: '#fff', background: day.holiday.isZoneA ? '#0284c7' : '#cbd5e1', opacity: day.holiday.isZoneA ? 1 : 0.45 }}>Zone A</span>
                              <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '0.62rem', fontWeight: 900, color: '#fff', background: day.holiday.isZoneB ? '#dc2626' : '#cbd5e1', opacity: day.holiday.isZoneB ? 1 : 0.45 }}>Zone B</span>
                              <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '0.62rem', fontWeight: 900, color: '#fff', background: day.holiday.isZoneC ? '#d97706' : '#cbd5e1', opacity: day.holiday.isZoneC ? 1 : 0.45 }}>Zone C</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', border: '1.5px solid #cbd5e1', padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', color: '#475569' }}>
                        <span>🏫</span>
                        <span style={{ fontWeight: 800 }}>Période scolaire (Hors vacances)</span>
                      </div>
                    )}

                    {day.holiday.publicHolidayName && (
                      <div style={{ background: '#fef3c7', color: '#92400e', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', border: '1px solid #fcd34d' }}>
                        ⭐ Férié : {day.holiday.publicHolidayName}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. BLOC MARÉES MANUSCRIT DU JOUR (Inspiré de 'Bn 11h15 · Pn 17h25 · (100)' manuscrit) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '8px 12px', marginBottom: '14px' }}>
                  {/* Basse Mer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#0284c7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.75rem' }}>
                      BM
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Basse Mer</div>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: '#0369a1' }}>
                        {day.bmTimeStr} <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>({day.bmHeight != null ? `${day.bmHeight.toFixed(2)} m` : '—'})</span>
                      </div>
                    </div>
                  </div>

                  {/* Pleine Mer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#0369a1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.75rem' }}>
                      PM
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Pleine Mer</div>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: '#0369a1' }}>
                        {day.pmTimeStr} <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>({day.pmHeight != null ? `${day.pmHeight.toFixed(2)} m` : '—'})</span>
                      </div>
                    </div>
                  </div>

                  {/* Coefficient de marée dans son macaron rond entouré comme sur la photo ! */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ border: '2.5px solid #0f172a', width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.05rem', background: '#fff', color: '#0f172a', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}>
                      {day.coeff}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Coefficient</div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a' }}>
                        {day.coeff >= 90 ? 'Grande Marée' : day.coeff >= 70 ? 'Marée Moyenne +' : 'Morte Eau'}
                      </div>
                    </div>
                  </div>

                  {/* Soleil & Seuil */}
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', fontSize: '0.72rem', color: '#334155' }}>
                    <div>☀️ Soleil : <strong>{day.sunRise} – {day.sunSet}</strong></div>
                    <div>🏖️ Seuil roulage : <strong>{settings.L.toFixed(2)} m</strong></div>
                  </div>
                </div>

                {/* 3. MÉTÉO & HOULE SI PROCHE 5 JOURS */}
                {day.isNear5Days && day.dayWeather && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '6px 12px', marginBottom: '14px', fontSize: '0.74rem' }}>
                    <div style={{ fontWeight: 800, color: '#166534' }}>
                      💨 Vent : <strong>{day.dayWeather.windRange}</strong> {day.dayWeather.gustMax ? `(rafales max ${day.dayWeather.gustMax} nds)` : ''} · Secteur <strong>{day.dayWeather.dirComp}</strong> ({day.dayWeather.dirDeg}°)
                    </div>
                    {day.dayWeather.waveH != null && (
                      <div style={{ color: '#0284c7', fontWeight: 700 }}>
                        🌊 Houle : <strong>{day.dayWeather.waveH} m</strong> (période {day.dayWeather.wavePeriod}s {day.dayWeather.waveDirComp || ''})
                      </div>
                    )}
                    <div style={{ color: '#475569' }}>
                      🌡️ {day.dayWeather.temp != null ? `${day.dayWeather.temp}°C` : ''} · {day.dayWeather.cloudText}
                    </div>
                  </div>
                )}

                {/* 4. LISTE DES CRÉNEAUX DE LA JOURNÉE AVEC GRILLE D'INSCRIPTION */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {day.slots.length === 0 ? (
                    day.rawSlots.some(s => s.isRejected) ? (
                      <div style={{ padding: '16px', background: '#fef2f2', border: '2px dashed #dc2626', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ color: '#b91c1c', fontWeight: 900, fontSize: '0.9rem', marginBottom: '4px' }}>
                          ⛔ AUCUNE SÉANCE DISPONIBLE AUJOURD'HUI — CRÉNEAUX REFUSÉS
                        </div>
                        <div style={{ color: '#7f1d1d', fontSize: '0.78rem', fontWeight: 700 }}>
                          {day.rawSlots.filter(s => s.isRejected).map(s => `${s.startStr}–${s.endStr} (${s.rejectReason || 'Vent hors plage'})`).join(' · ')}
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', color: '#64748b', fontStyle: 'italic', padding: '24px 0', fontSize: '0.85rem' }}>
                        Pas de séance calculable pour ce jour (contraintes marée / nuit).
                      </div>
                    )
                  ) : (
                    day.slots.map(s => {
                      const slotStorageKey = `${day.ds}-${s.key}`;
                      return (
                        <div
                          key={s.key}
                          className="agenda-slot-section"
                          style={{
                            border: s.isRejected ? '2px solid #dc2626' : s.isValidated ? '2px solid #16a34a' : '1.5px solid #64748b',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            background: s.isRejected ? '#fff5f5' : '#fff',
                          }}
                        >
                          {/* BANDEAU DU CRÉNEAU */}
                          <div
                            style={{
                              background: s.isRejected ? '#fee2e2' : s.isValidated ? '#dcfce7' : '#f1f5f9',
                              borderBottom: '1.5px solid',
                              borderColor: s.isRejected ? '#fca5a5' : s.isValidated ? '#86efac' : '#cbd5e1',
                              padding: '6px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '6px',
                            }}
                          >
                            {/* Heure encadrée comme sur la photo */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div
                                style={{
                                  background: s.isRejected ? '#dc2626' : s.isValidated ? '#15803d' : '#0f172a',
                                  color: '#fff',
                                  padding: '3px 10px',
                                  borderRadius: '16px',
                                  fontWeight: 900,
                                  fontSize: '0.95rem',
                                  letterSpacing: '0.02em',
                                  textDecoration: s.isRejected ? 'line-through' : 'none',
                                }}
                              >
                                {s.startStr} – {s.endStr}
                              </div>
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 900,
                                  color: '#fff',
                                  background: s.isRejected ? '#dc2626' : s.isValidated ? '#16a34a' : '#64748b',
                                  padding: '2px 7px',
                                  borderRadius: '4px',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {s.isRejected ? '⛔ REFUSÉ' : s.isValidated ? '✓ SÉANCE VALIDÉE' : 'EN ATTENTE'}
                              </span>
                              {s.isRejected && (
                                <span style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 800 }}>
                                  ⚠️ Motif : {s.rejectReason || 'Vent hors plage'}
                                </span>
                              )}
                            </div>

                            {/* Hauteur d'eau début/fin et météo du créneau */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', fontWeight: 700 }}>
                              <span style={{ color: '#0369a1', background: '#e0f2fe', padding: '2px 6px', borderRadius: '4px', border: '1px solid #bae6fd' }}>
                                🌊 Début : <strong>{s.hStart != null ? `${s.hStart.toFixed(2)} m` : '—'}</strong> {s.trend === 'down' ? '↘' : s.trend === 'up' ? '↗' : '→'} Fin : <strong>{s.hEnd != null ? `${s.hEnd.toFixed(2)} m` : '—'}</strong>
                              </span>
                              {s.weather && (
                                <span style={{ color: '#334155' }}>
                                  💨 <strong>{s.weather.windKts} nds</strong> {s.weather.gustKts ? `(raf. ${s.weather.gustKts})` : ''} · {s.weather.dir}
                                  {s.weather.waveH != null && ` · 🌊 ${s.weather.waveH} m`}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* GESTION & SAISIE DES INSCRIPTIONS VIA L'APPLICATION + TABLEAU D'ÉMARGEMENT IMPRIMABLE */}
                          {s.isRejected ? (
                            <div style={{ padding: '14px', textAlign: 'center', color: '#991b1b', background: '#fef2f2', fontStyle: 'italic', fontSize: '0.8rem', fontWeight: 700 }}>
                              ⛔ Ce créneau est refusé / annulé pour conditions météo défavorables (aucune inscription client).
                            </div>
                          ) : emargementMode === 'none' ? (
                            <div className="print-hide" style={{ padding: '8px 12px', color: '#64748b', fontSize: '0.74rem', fontStyle: 'italic', background: '#f8fafc' }}>
                              Tableau d'émargement masqué (sélectionné dans le menu déroulant « 4. Option émargement »).
                            </div>
                          ) : (
                            <div style={{ padding: '4px 6px' }}>
                              {/* 1. INTERFACE DE SAISIE INTERACTIVE DANS L'APPLICATION (Masquée à l'impression) */}
                              {(() => {
                                const slotBookings = getSlotBookings(slotStorageKey);
                                return (
                                  <>
                                    <div className="print-hide" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: slotBookings.length > 0 ? '8px' : 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span style={{ fontSize: '0.9rem' }}>👥</span>
                                          <strong style={{ fontSize: '0.8rem', color: '#0f172a' }}>
                                            Inscriptions clients ({slotBookings.length} réservé{slotBookings.length > 1 ? 's' : ''})
                                          </strong>
                                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                            · Saisissez via l'appli ou laissez des lignes vierges pour écrire au stylo
                                          </span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                          <button
                                            type="button"
                                            onClick={() => handleAddBooking(slotStorageKey)}
                                            style={{
                                              background: '#0284c7',
                                              color: '#fff',
                                              border: 'none',
                                              borderRadius: '6px',
                                              padding: '5px 10px',
                                              fontSize: '0.74rem',
                                              fontWeight: 800,
                                              cursor: 'pointer',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                            }}
                                          >
                                            <span>+</span> Ajouter un client
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handlePrefillExample(slotStorageKey)}
                                            style={{
                                              background: '#fff',
                                              color: '#475569',
                                              border: '1px solid #cbd5e1',
                                              borderRadius: '6px',
                                              padding: '4px 8px',
                                              fontSize: '0.72rem',
                                              cursor: 'pointer',
                                            }}
                                            title="Pré-remplir un exemple réaliste (Famille + Duo)"
                                          >
                                            ✨ Exemple test
                                          </button>
                                          {slotBookings.length > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => handleClearSlotBookings(slotStorageKey)}
                                              style={{
                                                background: '#fee2e2',
                                                color: '#b91c1c',
                                                border: '1px solid #fca5a5',
                                                borderRadius: '6px',
                                                padding: '4px 8px',
                                                fontSize: '0.72rem',
                                                cursor: 'pointer',
                                              }}
                                              title="Vider les clients de ce créneau"
                                            >
                                              🗑️ Vider
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* Formulaire de saisie dynamique à l'écran */}
                                      {slotBookings.length === 0 ? (
                                        <div style={{ fontSize: '0.73rem', color: '#64748b', fontStyle: 'italic', padding: '4px 0' }}>
                                          Aucun client pré-saisi pour ce créneau. Cliquez sur <strong>« + Ajouter un client »</strong> pour noter des réservations à l'avance, ou imprimez directement pour écrire au stylo sur la plage.
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                          {slotBookings.map((b, bIdx) => (
                                            <div
                                              key={b.id || bIdx}
                                              style={{
                                                background: '#fff',
                                                border: '1px solid #cbd5e1',
                                                borderRadius: '6px',
                                                padding: '6px 8px',
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr)) 36px',
                                                gap: '6px',
                                                alignItems: 'center',
                                              }}
                                            >
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Client / Nom</label>
                                                <input
                                                  type="text"
                                                  value={b.name}
                                                  placeholder="ex: Famille Dupont"
                                                  onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'name', e.target.value)}
                                                  style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                />
                                              </div>
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Téléphone</label>
                                                <div style={{ display: 'flex', gap: '3px' }}>
                                                  <input
                                                    type="tel"
                                                    value={b.phone}
                                                    placeholder="06 00 00 00 00"
                                                    onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'phone', e.target.value)}
                                                    style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                  />
                                                  {b.phone && (
                                                    <a
                                                      href={`tel:${b.phone}`}
                                                      style={{ padding: '4px 6px', background: '#e0f2fe', borderRadius: '4px', textDecoration: 'none', fontSize: '0.75rem' }}
                                                      title="Appeler le client"
                                                    >
                                                      📞
                                                    </a>
                                                  )}
                                                </div>
                                              </div>
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Participants</label>
                                                <input
                                                  type="text"
                                                  value={b.pax}
                                                  placeholder="ex: 3 (2 ad + 1 enf)"
                                                  onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'pax', e.target.value)}
                                                  style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                />
                                              </div>
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Chars (Mono/Bi)</label>
                                                <input
                                                  type="text"
                                                  value={b.chars}
                                                  placeholder="ex: 1 bi + 1 mono"
                                                  onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'chars', e.target.value)}
                                                  style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                />
                                              </div>
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Formule</label>
                                                <input
                                                  type="text"
                                                  value={b.formula}
                                                  placeholder="Initiation / Balade"
                                                  onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'formula', e.target.value)}
                                                  style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                />
                                              </div>
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Règlement</label>
                                                <input
                                                  type="text"
                                                  value={b.payment}
                                                  placeholder="ex: 135€ CB réglé"
                                                  onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'payment', e.target.value)}
                                                  style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                />
                                              </div>
                                              <div>
                                                <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Combis / Notes</label>
                                                <input
                                                  type="text"
                                                  value={b.notes}
                                                  placeholder="ex: 2 combis M, 1 S"
                                                  onChange={e => handleUpdateBooking(slotStorageKey, b.id, 'notes', e.target.value)}
                                                  style={{ width: '100%', padding: '4px 6px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                                />
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', paddingBottom: '2px' }}>
                                                <button
                                                  type="button"
                                                  onClick={() => handleRemoveBooking(slotStorageKey, b.id)}
                                                  style={{
                                                    background: '#fee2e2',
                                                    color: '#dc2626',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    width: '28px',
                                                    height: '28px',
                                                    cursor: 'pointer',
                                                    fontWeight: 900,
                                                    fontSize: '0.75rem',
                                                  }}
                                                  title="Supprimer cette inscription"
                                                >
                                                  ✕
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    {/* 2. TABLEAU PROPRE IMPRIMABLE (ET PRÉVISUALISATION DIRECTE) */}
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', background: '#fff' }}>
                                      <thead>
                                        <tr style={{ background: '#f1f5f9', borderBottom: '1.5px solid #0f172a', color: '#0f172a', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                          <th style={{ width: '26px', padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #cbd5e1' }}>N°</th>
                                          <th style={{ width: '28%', padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #cbd5e1' }}>1. Client / Responsable</th>
                                          <th style={{ width: '16%', padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #cbd5e1' }}>2. Téléphone portable</th>
                                          <th style={{ width: '12%', padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #cbd5e1' }}>3. Participants</th>
                                          <th style={{ width: '14%', padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #cbd5e1' }}>4. Chars (M/B)</th>
                                          <th style={{ width: '14%', padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #cbd5e1' }}>5. Formule & Notes</th>
                                          <th style={{ width: '16%', padding: '6px 8px', textAlign: 'left' }}>6. Règlement & Émargement</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {/* A) Clients saisis via l'application (imprimés en texte clair net) */}
                                        {emargementMode === 'with_bookings' &&
                                          slotBookings.map((b, bIdx) => (
                                            <tr
                                              key={b.id || bIdx}
                                              style={{
                                                height: '32px',
                                                borderBottom: '1px solid #94a3b8',
                                                background: bIdx % 2 === 0 ? '#fff' : '#fcfcfc',
                                              }}
                                            >
                                              <td style={{ textAlign: 'center', fontWeight: 900, color: '#475569', borderRight: '1px solid #e2e8f0', fontSize: '0.72rem' }}>
                                                {bIdx + 1}.
                                              </td>
                                              <td style={{ padding: '4px 8px', fontWeight: 800, color: '#0f172a', borderRight: '1px solid #e2e8f0' }}>
                                                {b.name || '—'}
                                              </td>
                                              <td style={{ padding: '4px 8px', color: '#1e293b', borderRight: '1px solid #e2e8f0', fontFamily: 'monospace', fontSize: '0.76rem' }}>
                                                {b.phone || '—'}
                                              </td>
                                              <td style={{ padding: '4px 8px', color: '#1e293b', borderRight: '1px solid #e2e8f0' }}>
                                                {b.pax || '—'}
                                              </td>
                                              <td style={{ padding: '4px 8px', fontWeight: 700, color: '#0f172a', borderRight: '1px solid #e2e8f0' }}>
                                                {b.chars || '—'}
                                              </td>
                                              <td style={{ padding: '4px 8px', color: '#334155', borderRight: '1px solid #e2e8f0', fontSize: '0.72rem' }}>
                                                <strong>{b.formula || 'Initiation'}</strong>{b.notes ? ` · ${b.notes}` : ''}
                                              </td>
                                              <td style={{ padding: '4px 8px', color: '#0f172a', fontWeight: 700 }}>
                                                {b.payment || '—'}
                                              </td>
                                            </tr>
                                          ))}

                                        {/* B) Lignes vierges lignées avec hauteur confortable pour écriture manuscrite au stylo sur la plage */}
                                        {(() => {
                                          const bookedCount = emargementMode === 'with_bookings' ? slotBookings.length : 0;
                                          const blankRowsCount = bookedCount > 0 ? 3 : 6;
                                          const blankIndices = Array.from({ length: blankRowsCount }, (_, i) => bookedCount + i);

                                          return blankIndices.map(rowIdx => (
                                            <tr
                                              key={`blank-${rowIdx}`}
                                              style={{
                                                height: '34px',
                                                borderBottom: '1px solid #94a3b8',
                                                background: '#fff',
                                              }}
                                            >
                                              <td style={{ textAlign: 'center', color: '#94a3b8', fontWeight: 800, fontSize: '0.72rem', borderRight: '1px solid #cbd5e1' }}>
                                                {rowIdx + 1}.
                                              </td>
                                              <td style={{ padding: '0 8px', borderRight: '1px solid #cbd5e1' }}>&nbsp;</td>
                                              <td style={{ padding: '0 8px', borderRight: '1px solid #cbd5e1' }}>&nbsp;</td>
                                              <td style={{ padding: '0 8px', borderRight: '1px solid #cbd5e1' }}>&nbsp;</td>
                                              <td style={{ padding: '0 8px', borderRight: '1px solid #cbd5e1' }}>&nbsp;</td>
                                              <td style={{ padding: '0 8px', borderRight: '1px solid #cbd5e1' }}>&nbsp;</td>
                                              <td style={{ padding: '0 8px' }}>&nbsp;</td>
                                            </tr>
                                          ));
                                        })()}
                                      </tbody>
                                    </table>
                                  </>
                                );
                              })()}

                              {/* POINTAGE & NOTES DE LA SÉANCE */}
                              <div
                                style={{
                                  borderTop: '1px solid #cbd5e1',
                                  background: '#f8fafc',
                                  padding: '6px 10px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: '8px',
                                  fontSize: '0.72rem',
                                  color: '#334155',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 800, color: '#0f172a' }}>
                                    🏁 Pointage séance ({s.startStr}–{s.endStr}) :
                                  </span>
                                  <span>Chars : <strong>____</strong> (Mono : ___ · Bi : ___)</span>
                                  <span>· Participants : <strong>____</strong></span>
                                  <span>· Encaissé séance : <strong>______ €</strong></span>
                                </div>
                                <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: 700, color: '#475569' }}>Voiles & Notes :</span>
                                  <span style={{ flex: 1, borderBottom: '1px dotted #94a3b8', minWidth: '100px', display: 'inline-block' }}>&nbsp;</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 5. BAS DE PAGE JOURNALIER : POINTAGE & ENCAISSEMENTS */}
                <div style={{ marginTop: '16px', paddingTop: '10px', borderTop: '2px solid #0f172a', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', fontSize: '0.75rem' }}>
                  <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                      🏁 Pointage matériel & chars sortis :
                    </div>
                    <div style={{ color: '#475569', lineHeight: 1.6 }}>
                      <div>[ ] Total Chars sortis : ________ (Mono : ____  ·  Bi : ____)</div>
                      <div>[ ] Participants : ________ (Adultes : ____  ·  Enfants : ____)</div>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                      💶 Bilan des Encaissements du jour :
                    </div>
                    <div style={{ color: '#475569', lineHeight: 1.6 }}>
                      <div>CB : ________ €  ·  Chèques : ________ €  ·  Espèces : ________ €  ·  ANCV : ________ €</div>
                      <div>Observations terrain : _______________________________________________</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* VIEW 1: BANDELETTES AGENDA (Colonnes étroites ~65-75mm à découper et coller dans les colonnes d'un semainier) */}
        {layoutMode === 'strips' && (
          <div className="strips-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {daysData.map(day => (
              <div
                key={day.ds}
                className="agenda-strip"
                style={{
                  width: '185px',
                  border: '1px solid #333',
                  borderRadius: '6px',
                  background: '#fff',
                  color: '#000',
                  padding: '8px',
                  fontSize: '0.72rem',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                }}
              >
                {/* Ligne pointillée de découpe */}
                <div style={{ position: 'absolute', top: '-1px', left: '-12px', bottom: '-1px', borderLeft: '1px dashed #999', width: '0' }} className="print-cut-line" />

                {/* En-tête du jour */}
                <div style={{ borderBottom: '1px solid #111', paddingBottom: '4px', marginBottom: '6px' }}>
                  <div style={{ textTransform: 'uppercase', fontWeight: 900, fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{day.weekdayStr.slice(0, 4)}. {day.dateObj.getUTCDate()}</span>
                    <span style={{ background: '#111', color: '#fff', padding: '0 4px', borderRadius: '3px', fontSize: '0.68rem' }}>
                      C.{day.coeff}
                    </span>
                  </div>
                  {day.holiday.isHoliday ? (
                    <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#92400e', background: '#fef3c7', padding: '1px 4px', borderRadius: '3px', marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🎒 {day.holiday.periodName || 'Vacances'}</span>
                      <span style={{ fontSize: '0.52rem', opacity: 0.95, whiteSpace: 'nowrap' }}>
                        {day.holiday.zonesLabel}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.55rem', color: '#64748b', marginTop: '1px' }}>
                      Période scolaire · Semaine {day.holiday.weekNumber}
                    </div>
                  )}
                  <div style={{ fontSize: '0.66rem', color: '#333', display: 'flex', justifyContent: 'space-between', marginTop: '2px', flexWrap: 'wrap', gap: '2px' }}>
                    <span>BM : <strong>{day.bmTimeStr}</strong> · Eau : <strong>{day.bmHeight != null ? `${day.bmHeight.toFixed(2)} m` : '—'}</strong></span>
                    <span>☀️ {day.sunRise}–{day.sunSet}</span>
                  </div>
                </div>

                {/* Météo 5 jours avec Houle si disponible */}
                {day.isNear5Days && day.dayWeather && (
                  <div style={{ background: '#f3f4f6', padding: '4px 6px', borderRadius: '4px', marginBottom: '6px', fontSize: '0.66rem', border: '1px solid #e5e7eb' }}>
                    <div style={{ fontWeight: 800, color: '#1f2937', display: 'flex', justifyContent: 'space-between' }}>
                      <span>💨 {day.dayWeather.windRange}</span>
                      <span>{day.dayWeather.dirComp}</span>
                    </div>
                    {day.dayWeather.waveH != null && (
                      <div style={{ color: '#0369a1', fontWeight: 700, display: 'flex', justifyContent: 'space-between', marginTop: '1px' }}>
                        <span>🌊 Houle : <strong>{day.dayWeather.waveH} m</strong></span>
                        <span>{day.dayWeather.wavePeriod ? `${day.dayWeather.wavePeriod}s` : ''} {day.dayWeather.waveDirComp || ''}</span>
                      </div>
                    )}
                    <div style={{ color: '#4b5563', display: 'flex', justifyContent: 'space-between', marginTop: '1px' }}>
                      <span>{day.dayWeather.temp != null ? `${day.dayWeather.temp}°C` : ''} · {day.dayWeather.cloudText.split('·')[0]}</span>
                      <span style={{ fontSize: '0.6rem', color: '#6b7280' }}>{day.dayWeather.model}</span>
                    </div>
                  </div>
                )}

                {/* Liste des séances */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                  {day.slots.length === 0 ? (
                    day.rawSlots.some(s => s.isRejected) ? (
                      <div
                        style={{
                          border: '2px solid #dc2626',
                          borderRadius: '4px',
                          padding: '6px',
                          background: '#fef2f2',
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            color: '#b91c1c',
                            fontWeight: 900,
                            fontSize: '0.74rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>⛔</span> <span>SÉANCE(S) REFUSÉE(S)</span>
                        </div>
                        <div style={{ fontSize: '0.64rem', color: '#991b1b', marginTop: '3px', fontWeight: 700, lineHeight: 1.3 }}>
                          {day.rawSlots
                            .filter(s => s.isRejected)
                            .map(s => `${s.startStr}–${s.endStr} (${s.rejectReason || 'Vent hors plage'})`)
                            .join(' · ')}
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', color: '#666', fontStyle: 'italic', padding: '12px 0', fontSize: '0.68rem' }}>
                        {filterMode === 'validated' || filterMode === 'validated_only' ? 'Aucun créneau validé' : 'Pas de séance possible'}
                      </div>
                    )
                  ) : (
                    day.slots.map(s => (
                      <div
                        key={s.key}
                        style={{
                          border: s.isRejected ? '2px solid #dc2626' : s.isValidated ? '2px solid #16a34a' : '1px solid #999',
                          borderRadius: '4px',
                          padding: '5px 6px',
                          background: s.isRejected ? '#fef2f2' : s.isValidated ? '#f0fdf4' : '#fff',
                          color: '#111',
                          opacity: 1,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            style={{
                              fontWeight: 900,
                              fontSize: '0.82rem',
                              color: s.isRejected ? '#991b1b' : '#111',
                              textDecoration: s.isRejected ? 'line-through' : 'none',
                            }}
                          >
                            {s.startStr} – {s.endStr}
                          </span>
                          <span
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 900,
                              color: '#fff',
                              background: s.isRejected ? '#dc2626' : s.isValidated ? '#16a34a' : '#6b7280',
                              padding: '2px 5px',
                              borderRadius: '3px',
                              letterSpacing: '0.02em',
                              textTransform: 'uppercase',
                            }}
                          >
                            {s.isRejected ? '⛔ REFUSÉ' : s.isValidated ? '✓ VALIDÉ' : 'EN ATTENTE'}
                          </span>
                        </div>

                        {/* Motif clair de refus si séance refusée */}
                        {s.isRejected && (
                          <div
                            style={{
                              marginTop: '3px',
                              padding: '3px 5px',
                              background: '#fee2e2',
                              borderLeft: '3px solid #dc2626',
                              borderRadius: '2px',
                              fontSize: '0.63rem',
                              fontWeight: 800,
                              color: '#991b1b',
                              lineHeight: 1.25,
                            }}
                          >
                            ⚠️ Motif : {s.rejectReason || 'Vent hors plage / Conditions défavorables'}
                          </div>
                        )}

                        {/* Hauteur d'eau précise en début et fin */}
                        <div
                          style={{
                            margin: '3px 0',
                            fontSize: '0.66rem',
                            color: '#0369a1',
                            fontWeight: 700,
                            display: 'flex',
                            justifyContent: 'space-between',
                            background: '#e0f2fe',
                            padding: '2px 4px',
                            borderRadius: '3px',
                            border: '1px solid #bae6fd',
                          }}
                        >
                          <span>🌊 Début : <strong>{s.hStart != null ? `${s.hStart.toFixed(2)} m` : '—'}</strong></span>
                          <span>{s.trend === 'down' ? '↘' : s.trend === 'up' ? '↗' : '→'}</span>
                          <span>Fin : <strong>{s.hEnd != null ? `${s.hEnd.toFixed(2)} m` : '—'}</strong></span>
                        </div>

                        {/* Météo et houle spécifiques du créneau */}
                        {s.weather && (
                          <div style={{ fontSize: '0.62rem', color: '#374151', display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>💨 <strong>{s.weather.windKts} nds</strong> {s.weather.gustKts ? `(raf. ${s.weather.gustKts})` : ''}</span>
                              <span style={{ fontWeight: 700 }}>{s.weather.dir}</span>
                            </div>
                            {s.weather.waveH != null && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0284c7', fontWeight: 600 }}>
                                <span>🌊 Houle : <strong>{s.weather.waveH} m</strong></span>
                                <span>{s.weather.wavePeriod ? `${s.weather.wavePeriod}s` : ''} {s.weather.waveDir || ''}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Zone d'émargement et inscriptions après chaque séance */}
                        {includeNotesBox && !s.isRejected && (
                          <div style={{ marginTop: '5px', paddingTop: '4px', borderTop: '1px dotted #94a3b8', fontSize: '0.62rem', color: '#334155', lineHeight: 1.35 }}>
                            {/* Ligne 1 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>1. Nom : __________________</span>
                              <span>Chars (M/Bi) : ____</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: '#64748b', marginTop: '1px' }}>
                              <span>Âges : ____ · Tél : _________________</span>
                              <span>Règlt : _____</span>
                            </div>

                            {/* Ligne 2 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px', paddingTop: '2px', borderTop: '1px dashed #e2e8f0' }}>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>2. Nom : __________________</span>
                              <span>Chars (M/Bi) : ____</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: '#64748b', marginTop: '1px' }}>
                              <span>Âges : ____ · Tél : _________________</span>
                              <span>Règlt : _____</span>
                            </div>

                            {/* Pointage séance */}
                            <div style={{ marginTop: '3px', paddingTop: '2px', borderTop: '1px dotted #cbd5e1', fontSize: '0.58rem', color: '#0f172a', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                              <span>🏁 Total Chars : ____ (M:__ Bi:__)</span>
                              <span>Encaissé : _____ €</span>
                            </div>
                          </div>
                        )}

                        {includeNotesBox && s.isRejected && (
                          <div style={{ marginTop: '4px', paddingTop: '3px', borderTop: '1px dotted #fca5a5', fontSize: '0.58rem', color: '#991b1b' }}>
                            Notes / Suivi reports : ___________________________
                          </div>
                        )}

                        {/* Bouton interactif pour modifier la décision à la volée (masqué à l'impression) */}
                        {onSetSlotDecision && (
                          <div className="print-hide nop" style={{ marginTop: '4px', paddingTop: '3px', borderTop: '1px dashed #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                            {s.isRejected ? (
                              <button
                                type="button"
                                onClick={() => onSetSlotDecision(day.focusData, s.slot, 'valid')}
                                style={{
                                  fontSize: '0.6rem',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: '#dcfce7',
                                  color: '#16a34a',
                                  border: '1px solid #86efac',
                                  cursor: 'pointer',
                                  fontWeight: 800,
                                }}
                                title="Passer cette séance en validée"
                              >
                                ✓ Valider la séance
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onSetSlotDecision(day.focusData, s.slot, 'rejected', s.slot.ok === false ? 'Vent hors plage' : 'Séance refusée')}
                                style={{
                                  fontSize: '0.6rem',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: '#fee2e2',
                                  color: '#dc2626',
                                  border: '1px solid #fca5a5',
                                  cursor: 'pointer',
                                  fontWeight: 800,
                                }}
                                title="Refuser cette séance"
                              >
                                ⛔ Refuser
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Espace notes / bilan en bas de bandelette */}
                {includeNotesBox && (
                  <div style={{ marginTop: '8px', paddingTop: '4px', borderTop: '1px solid #333', fontSize: '0.62rem', color: '#333' }}>
                    <div style={{ fontWeight: 800 }}>🏁 Bilan journée :</div>
                    <div>Total chars sortis : ______ · Total caisse : ______ €</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* VIEW 2: FICHES BLOCS JOURNALIÈRES */}
        {layoutMode === 'cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
            {daysData.map(day => (
              <div
                key={day.ds}
                style={{
                  border: '1px solid #111',
                  borderRadius: '6px',
                  padding: '10px',
                  background: '#fff',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #111', paddingBottom: '4px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'capitalize' }}>
                        {day.fullDateStr}
                      </h3>
                      {day.holiday.isHoliday ? (
                        <span style={{ fontSize: '0.62rem', fontWeight: 800, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px' }}>
                          🎒 {day.holiday.periodName || 'Vacances'} ({day.holiday.zonesLabel})
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.62rem', fontWeight: 600, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: '4px' }}>
                          Période scolaire · Semaine {day.holiday.weekNumber}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '2px' }}>
                      Basse Mer : <strong>{day.bmInfo}</strong> · Pleine Mer : {day.pmInfo}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ background: '#111', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 900, fontSize: '0.8rem' }}>
                      Coeff {day.coeff}
                    </span>
                    <div style={{ fontSize: '0.66rem', color: '#555', marginTop: '2px' }}>
                      ☀️ {day.sunRise}–{day.sunSet}
                    </div>
                  </div>
                </div>

                {/* Météo proche avec Houle */}
                {day.isNear5Days && day.dayWeather && (
                  <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '6px 8px', marginBottom: '8px', fontSize: '0.72rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                      <span>💨 Vent : {day.dayWeather.windRange} {day.dayWeather.gustMax ? `(rafales ${day.dayWeather.gustMax} nds)` : ''}</span>
                      <span>Secteur {day.dayWeather.dirComp} ({day.dayWeather.dirDeg}°)</span>
                    </div>
                    {day.dayWeather.waveH != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0284c7', fontWeight: 700, marginTop: '2px' }}>
                        <span>🌊 Houle / Vagues : {day.dayWeather.waveH} m (période {day.dayWeather.wavePeriod}s)</span>
                        <span>Provenance : {day.dayWeather.waveDirComp} ({day.dayWeather.waveDirDeg}°)</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', marginTop: '2px', fontSize: '0.68rem' }}>
                      <span>🌡️ {day.dayWeather.temp != null ? `${day.dayWeather.temp}°C` : '—'} (ressenti {day.dayWeather.tempChill != null ? `${day.dayWeather.tempChill}°C` : '—'}) · {day.dayWeather.cloudText}</span>
                      <span style={{ fontStyle: 'italic' }}>Source {day.dayWeather.model} + Marine</span>
                    </div>
                  </div>
                )}

                {/* Tableau des séances du jour */}
                {day.slots.length === 0 ? (
                  day.rawSlots.some(s => s.isRejected) ? (
                    <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1.5px dashed #dc2626', borderRadius: '4px', textAlign: 'center', fontSize: '0.74rem', color: '#991b1b', fontWeight: 700 }}>
                      ⛔ Séance(s) refusée(s) : {day.rawSlots.filter(s => s.isRejected).map(s => `${s.startStr}–${s.endStr} (${s.rejectReason || 'Vent hors plage'})`).join(', ')}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#666', fontStyle: 'italic', padding: '10px 0', fontSize: '0.76rem' }}>
                      {filterMode === 'validated' || filterMode === 'validated_only' ? 'Aucune séance validée pour ce jour' : 'Aucune séance calculable'}
                    </div>
                  )
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', margin: 0 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #aaa', color: '#555', textAlign: 'left', fontSize: '0.66rem' }}>
                        <th style={{ padding: '3px 4px' }}>Horaires & Décision</th>
                        <th style={{ padding: '3px 4px' }}>Hauteur Début</th>
                        <th style={{ padding: '3px 4px' }}>Hauteur Fin</th>
                        <th style={{ padding: '3px 4px' }}>Évolution</th>
                        {day.isNear5Days && <th style={{ padding: '3px 4px' }}>Météo & Houle</th>}
                        {includeNotesBox && <th style={{ padding: '3px 4px' }}>Pointage / Inscrits</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {day.slots.map(s => (
                        <tr
                          key={s.key}
                          style={{
                            borderBottom: '1px solid #ddd',
                            background: s.isRejected ? '#fef2f2' : s.isValidated ? '#f0fdf4' : 'transparent',
                            borderLeft: s.isRejected ? '3px solid #dc2626' : s.isValidated ? '3px solid #16a34a' : undefined,
                            opacity: 1,
                          }}
                        >
                          <td style={{ padding: '5px 4px', fontWeight: 800, fontSize: '0.78rem' }}>
                            <div style={{ textDecoration: s.isRejected ? 'line-through' : 'none', color: s.isRejected ? '#991b1b' : 'inherit' }}>
                              {s.startStr} – {s.endStr}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                              <span style={{ fontSize: '0.62rem', fontWeight: 900, color: '#fff', background: s.isRejected ? '#dc2626' : s.isValidated ? '#16a34a' : '#6b7280', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>
                                {s.isRejected ? '⛔ REFUSÉ' : s.isValidated ? '✓ Validé' : 'En attente'}
                              </span>
                              {s.isRejected && s.rejectReason && (
                                <span style={{ fontSize: '0.63rem', color: '#991b1b', fontWeight: 700 }}>
                                  ⚠️ {s.rejectReason}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '5px 4px', color: '#0369a1', fontWeight: 700 }}>
                            {s.hStart != null ? `${s.hStart.toFixed(2)} m` : '—'}
                          </td>
                          <td style={{ padding: '5px 4px', color: '#0369a1', fontWeight: 700 }}>
                            {s.hEnd != null ? `${s.hEnd.toFixed(2)} m` : '—'}
                          </td>
                          <td style={{ padding: '5px 4px', fontSize: '0.68rem', color: '#555' }}>
                            {s.trend === 'down' ? '↘ descente' : s.trend === 'up' ? '↗ montée' : '→ étale'}
                          </td>
                          {day.isNear5Days && (
                            <td style={{ padding: '5px 4px', fontSize: '0.68rem' }}>
                              {s.weather ? (
                                <div>
                                  <div>💨 <strong>{s.weather.windKts} nds</strong> · {s.weather.dir}</div>
                                  {s.weather.waveH != null && (
                                    <div style={{ color: '#0284c7', fontWeight: 600, fontSize: '0.64rem' }}>
                                      🌊 {s.weather.waveH} m ({s.weather.wavePeriod}s {s.weather.waveDir || ''})
                                    </div>
                                  )}
                                </div>
                              ) : '—'}
                            </td>
                          )}
                          {includeNotesBox && (
                            <td style={{ padding: '5px 4px', color: '#64748b', fontSize: '0.64rem' }}>
                              Nom : ____________ | Chars : ____ | Âges : ____ | Tél : ____________
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}

        {/* VIEW 3: TABLEAU SYNTHÉTIQUE A4 (Format Liste de bord condensé) */}
        {layoutMode === 'table' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #111', textAlign: 'left', fontSize: '0.68rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '6px 8px' }}>Date</th>
                  <th style={{ padding: '6px 8px' }}>Coeff</th>
                  <th style={{ padding: '6px 8px' }}>Basse Mer & Haut. d'eau</th>
                  <th style={{ padding: '6px 8px' }}>Séance & Décision</th>
                  <th style={{ padding: '6px 8px' }}>Eau Début</th>
                  <th style={{ padding: '6px 8px' }}>Eau Fin</th>
                  <th style={{ padding: '6px 8px' }}>Tendance</th>
                  <th style={{ padding: '6px 8px' }}>Météo, Vent & Houle</th>
                  {includeNotesBox && <th style={{ padding: '6px 8px' }}>Émargement / Inscrits</th>}
                </tr>
              </thead>
              <tbody>
                {daysData.map(day => {
                  if (day.slots.length === 0) {
                    if (day.rawSlots.some(s => s.isRejected)) {
                      return (
                        <tr key={day.ds} style={{ borderBottom: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>
                            {day.weekdayStr.slice(0, 3)} {day.dateObj.getUTCDate()} {day.dateObj.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}
                            {day.holiday.isHoliday && (
                              <div style={{ fontSize: '0.62rem', color: '#92400e', fontWeight: 800 }}>
                                🎒 {day.holiday.periodName || 'Vacances'} ({day.holiday.zonesLabel})
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px' }}>{day.coeff}</td>
                          <td style={{ padding: '6px 8px' }}>{day.bmInfo}</td>
                          <td colSpan={includeNotesBox ? 6 : 5} style={{ padding: '6px 8px', fontWeight: 700, fontSize: '0.74rem' }}>
                            ⛔ Séance(s) refusée(s) : {day.rawSlots.filter(s => s.isRejected).map(s => `${s.startStr}–${s.endStr} (${s.rejectReason || 'Vent hors plage'})`).join(', ')}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={day.ds} style={{ borderBottom: '1px solid #e5e7eb', color: '#888' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 700 }}>
                          {day.weekdayStr.slice(0, 3)} {day.dateObj.getUTCDate()} {day.dateObj.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}
                          {day.holiday.isHoliday && (
                            <div style={{ fontSize: '0.62rem', color: '#92400e', fontWeight: 800 }}>
                              🎒 {day.holiday.periodName || 'Vacances'} ({day.holiday.zonesLabel})
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{day.coeff}</td>
                        <td style={{ padding: '6px 8px' }}>{day.bmInfo}</td>
                        <td colSpan={includeNotesBox ? 6 : 5} style={{ padding: '6px 8px', fontStyle: 'italic' }}>
                          {filterMode === 'validated' || filterMode === 'validated_only' ? 'Aucune séance validée' : 'Pas de roulage'}
                        </td>
                      </tr>
                    );
                  }

                  return day.slots.map((s, idx) => (
                    <tr
                      key={`${day.ds}-${s.key}`}
                      style={{
                        borderBottom: idx === day.slots.length - 1 ? '2px solid #bbb' : '1px solid #e5e7eb',
                        background: s.isRejected ? '#fef2f2' : s.isValidated ? '#f0fdf4' : idx % 2 === 0 ? '#fff' : '#fafafa',
                        opacity: 1,
                      }}
                    >
                      {idx === 0 && (
                        <>
                          <td rowSpan={day.slots.length} style={{ padding: '6px 8px', fontWeight: 800, verticalAlign: 'top', borderRight: '1px solid #eee' }}>
                            <div>{day.weekdayStr.slice(0, 4)}. {day.dateObj.getUTCDate()} {day.dateObj.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}</div>
                            {day.holiday.isHoliday ? (
                              <div style={{ fontSize: '0.62rem', color: '#92400e', fontWeight: 800, marginTop: '2px' }}>
                                🎒 {day.holiday.periodName || 'Vacances'} ({day.holiday.zonesLabel})
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 500, marginTop: '1px' }}>
                                Semaine {day.holiday.weekNumber}
                              </div>
                            )}
                            <div style={{ fontSize: '0.64rem', color: '#666', fontWeight: 400, marginTop: '1px' }}>☀️ {day.sunRise}–{day.sunSet}</div>
                          </td>
                          <td rowSpan={day.slots.length} style={{ padding: '6px 8px', verticalAlign: 'top', borderRight: '1px solid #eee' }}>
                            <span style={{ fontWeight: 800, background: '#111', color: '#fff', padding: '1px 5px', borderRadius: '3px', fontSize: '0.68rem' }}>
                              {day.coeff}
                            </span>
                          </td>
                          <td rowSpan={day.slots.length} style={{ padding: '6px 8px', verticalAlign: 'top', borderRight: '1px solid #eee', fontSize: '0.7rem' }}>
                            {day.bmInfo}
                          </td>
                        </>
                      )}

                      <td style={{ padding: '6px 8px', fontWeight: 900, fontSize: '0.8rem', borderLeft: s.isRejected ? '3px solid #dc2626' : s.isValidated ? '3px solid #16a34a' : undefined }}>
                        <div style={{ textDecoration: s.isRejected ? 'line-through' : 'none', color: s.isRejected ? '#991b1b' : 'inherit' }}>
                          {s.startStr} – {s.endStr}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                          <span style={{ fontSize: '0.62rem', fontWeight: 900, color: '#fff', background: s.isRejected ? '#dc2626' : s.isValidated ? '#16a34a' : '#6b7280', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>
                            {s.isRejected ? '⛔ REFUSÉ' : s.isValidated ? '✓ Validé' : 'En attente'}
                          </span>
                          {s.isRejected && s.rejectReason && (
                            <span style={{ fontSize: '0.63rem', color: '#991b1b', fontWeight: 700 }}>
                              ⚠️ {s.rejectReason}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', color: '#0369a1', fontWeight: 800 }}>
                        {s.hStart != null ? `${s.hStart.toFixed(2)} m` : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', color: '#0369a1', fontWeight: 800 }}>
                        {s.hEnd != null ? `${s.hEnd.toFixed(2)} m` : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '0.68rem', color: '#4b5563' }}>
                        {s.trend === 'down' ? '↘ descente' : s.trend === 'up' ? '↗ montée' : '→ étale'}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '0.7rem' }}>
                        {day.isNear5Days && s.weather ? (
                          <div>
                            <div>
                              <strong>{s.weather.windKts} nds</strong> {s.weather.gustKts ? `(raf. ${s.weather.gustKts})` : ''} · {s.weather.dir}
                            </div>
                            {s.weather.waveH != null && (
                              <div style={{ color: '#0284c7', fontSize: '0.65rem', fontWeight: 600 }}>
                                🌊 Houle {s.weather.waveH} m ({s.weather.wavePeriod}s {s.weather.waveDir || ''})
                              </div>
                            )}
                          </div>
                        ) : day.isNear5Days && day.dayWeather ? (
                          <div>
                            <span style={{ color: '#666' }}>{day.dayWeather.windRange}</span>
                            {day.dayWeather.waveH != null && (
                              <div style={{ color: '#0284c7', fontSize: '0.65rem' }}>
                                🌊 Houle {day.dayWeather.waveH} m ({day.dayWeather.wavePeriod}s)
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>Marée seule (&gt; 5j)</span>
                        )}
                      </td>
                      {includeNotesBox && (
                        <td style={{ padding: '6px 8px', color: '#64748b', fontSize: '0.68rem' }}>
                          Nom : ____________ | Chars (M/Bi) : ____ | Âges : ____ | Tél : ____________
                        </td>
                      )}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info for print */}
        <div
          className={layoutMode === 'strips' || layoutMode === 'agenda' ? 'print-hide' : ''}
          style={{ marginTop: '16px', paddingTop: '8px', borderTop: '1px solid #999', fontSize: '0.66rem', color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            Char à Voile du Bout du Monde · Plage de Lestrevet · 06 81 63 83 74 · charavoileduboutdumonde.com
          </div>
          <div>
            Hauteurs calculées par interpolation SHOM/Lestrevet · Météo AROME Météo-France & Houle ECMWF/WAM via Open-Meteo
          </div>
        </div>
      </div>
    </div>
  );
};
