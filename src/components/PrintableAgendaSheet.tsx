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

type RangeOption = '5days' | 'week' | 'month' | 'selected' | 'custom' | 'all';
type LayoutOption = 'strips' | 'cards' | 'table';
type FilterOption = 'validated' | 'all' | 'valid_or_pending';

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
  focusData: DayFocusData;
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
}) => {
  const [rangeMode, setRangeMode] = useState<RangeOption>('5days');
  const [layoutMode, setLayoutMode] = useState<LayoutOption>('strips');
  const [filterMode, setFilterMode] = useState<FilterOption>('validated');
  const [includeNotesBox, setIncludeNotesBox] = useState<boolean>(true);

  const todayStr = useMemo(() => tdy(), []);
  const allAvailableDates = useMemo(() => DATA.map(d => d[0]), []);

  const [customStartDate, setCustomStartDate] = useState<string>(todayStr);
  const [customEndDate, setCustomEndDate] = useState<string>(shf(todayStr, 7));

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
      const start = customStartDate || todayStr;
      const end = customEndDate || shf(start, 7);
      const minD = start <= end ? start : end;
      const maxD = start <= end ? end : start;
      return allAvailableDates.filter(d => d >= minD && d <= maxD);
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
        const status: 'valid' | 'rejected' | 'pending' = valItem
          ? valItem.status === 'rejected'
            ? 'rejected'
            : 'valid'
          : 'pending';
        const isValidated = status === 'valid';
        const isRejected = status === 'rejected';
        const rejectReason = valItem?.rejectReason;
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
      const filteredSlots =
        filterMode === 'validated'
          ? rawSlots.filter(s => s.isValidated)
          : filterMode === 'valid_or_pending'
          ? rawSlots.filter(s => !s.isRejected)
          : rawSlots;

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
        sunRise: sun.lev,
        sunSet: sun.cou,
        isNear5Days,
        dayWeather,
        slots: filteredSlots,
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
    EX,
  ]);

  // Total validated slots in the current view
  const totalSlotsCount = useMemo(() => {
    return daysData.reduce((acc, d) => acc + d.slots.length, 0);
  }, [daysData]);

  const handlePrint = () => {
    window.print();
  };

  const handleValidateAllInView = (mode: 'all' | 'wind_only' = 'all') => {
    if (!onValidateDay) return;
    for (const d of daysData) {
      if (d.focusData && d.focusData.list.length > 0) {
        onValidateDay(d.ds, d.focusData, mode);
      }
    }
  };

  return (
    <div className="printable-agenda-wrapper">
      {/* Configuration & Controls Toolbar (Hidden on print) */}
      <div className="card nop print-toolbar" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📋</span> Fiche Agenda Papier à imprimer
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--mu, #666)' }}>
              Horaires des séances, hauteurs d'eau au début et en fin de séance, météo détaillée pour les 5 prochains jours. Format optimisé pour collage dans votre agenda ou carnet de bord.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="fbtn"
              onClick={handlePrint}
              style={{
                margin: 0,
                background: '#16a34a',
                color: '#fff',
                padding: '9px 16px',
                fontSize: '0.82rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)',
              }}
            >
              <span>🖨️</span> Imprimer la fiche (A4 / Agenda)
            </button>
          </div>
        </div>

        {/* Filter & Layout Selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--bd, #e5e7eb)' }}>
          {/* Période */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #666)', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
              Période à imprimer
            </label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`cal-nav-btn ${rangeMode === '5days' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setRangeMode('5days')}
              >
                🌟 5 prochains jours
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${rangeMode === 'week' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setRangeMode('week')}
              >
                Semaine (7 j)
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${rangeMode === 'month' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setRangeMode('month')}
              >
                Mois affiché
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${rangeMode === 'custom' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setRangeMode('custom')}
              >
                📅 De date à date
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${rangeMode === 'all' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setRangeMode('all')}
              >
                Toute la saison
              </button>
            </div>

            {rangeMode === 'custom' && (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>Du :</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--bd, #cbd5e1)',
                      fontSize: '0.75rem',
                      background: 'var(--card, #fff)',
                      color: 'inherit',
                    }}
                  />
                </label>
                <label style={{ fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>Au :</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--bd, #cbd5e1)',
                      fontSize: '0.75rem',
                      background: 'var(--card, #fff)',
                      color: 'inherit',
                    }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Filtrage séances */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #666)', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
              Séances affichées
            </label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className={`cal-nav-btn ${filterMode === 'validated' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setFilterMode('validated')}
              >
                ✓ Validées uniquement
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${filterMode === 'all' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setFilterMode('all')}
              >
                Toutes les séances
              </button>
            </div>
          </div>

          {/* Format mise en page */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #666)', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
              Format de découpe / collage
            </label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className={`cal-nav-btn ${layoutMode === 'strips' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setLayoutMode('strips')}
                title="Bandelettes verticales (~65mm) à coller dans les colonnes d'un semainier"
              >
                ✂️ Bandelettes Semainier
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${layoutMode === 'cards' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setLayoutMode('cards')}
                title="Fiches journalières découpables"
              >
                📑 Fiches blocs
              </button>
              <button
                type="button"
                className={`cal-nav-btn ${layoutMode === 'table' ? 'on' : ''}`}
                style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '6px' }}
                onClick={() => setLayoutMode('table')}
                title="Tableau de bord A4 complet"
              >
                📊 Tableau A4
              </button>
            </div>
          </div>

          {/* Options secondaires */}
          <div>
            <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--mu, #666)', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
              Options d'émargement
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', cursor: 'pointer', marginTop: '4px' }}>
              <input
                type="checkbox"
                checked={includeNotesBox}
                onChange={e => setIncludeNotesBox(e.target.checked)}
              />
              Zone d'émargement stylo (inscrits / paiements)
            </label>
          </div>
        </div>

        {/* Status banner */}
        <div style={{ marginTop: '12px', padding: '8px 12px', background: 'var(--cell, #f9fafb)', borderRadius: '8px', fontSize: '0.76rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <strong>{daysData.length} jour{daysData.length > 1 ? 's' : ''}</strong> sélectionnés · <strong>{totalSlotsCount} séance{totalSlotsCount > 1 ? 's' : ''}</strong> à imprimer
            {filterMode === 'validated' && totalSlotsCount === 0 && (
              <span style={{ color: '#dc2626', marginLeft: '8px', fontWeight: 600 }}>
                ⚠️ Aucune séance validée sur cette sélection.
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.68rem', color: '#666', marginRight: '2px' }}>Filtre :</span>
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                padding: '3px 8px',
                fontSize: '0.72rem',
                background: filterMode === 'validated' ? 'var(--ac, #ffc40d)' : 'var(--cell, #e5e7eb)',
                color: '#111',
                fontWeight: filterMode === 'validated' ? 800 : 500,
              }}
              onClick={() => setFilterMode('validated')}
              title="Uniquement les séances marquées ✓ Validées"
            >
              ✓ Validées seuls
            </button>
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                padding: '3px 8px',
                fontSize: '0.72rem',
                background: filterMode === 'valid_or_pending' ? 'var(--ac, #ffc40d)' : 'var(--cell, #e5e7eb)',
                color: '#111',
                fontWeight: filterMode === 'valid_or_pending' ? 800 : 500,
              }}
              onClick={() => setFilterMode('valid_or_pending')}
              title="Séances validées et séances en attente (masque les séances refusées)"
            >
              ✓ + ⏳ Validées & Attente
            </button>
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                padding: '3px 8px',
                fontSize: '0.72rem',
                background: filterMode === 'all' ? 'var(--ac, #ffc40d)' : 'var(--cell, #e5e7eb)',
                color: '#111',
                fontWeight: filterMode === 'all' ? 800 : 500,
              }}
              onClick={() => setFilterMode('all')}
              title="Toutes les séances calculées, y compris celles refusées (affichées barrées avec motif)"
            >
              📋 Tout imprimer
            </button>
            {onValidateDay && (
              <>
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    background: '#0284c7',
                    color: '#fff',
                  }}
                  onClick={() => handleValidateAllInView('wind_only')}
                  title="Valider automatiquement les créneaux vent OK et refuser les hors vent sur cette période"
                >
                  ⚡ Valider si Vent OK
                </button>
                <button
                  type="button"
                  className="fbtn"
                  style={{
                    margin: 0,
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    background: '#16a34a',
                    color: '#fff',
                  }}
                  onClick={() => handleValidateAllInView('all')}
                  title="Valider toutes les séances sans exception sur cette période"
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
        {/* Print Header */}
        <div className="print-header" style={{ marginBottom: '14px', borderBottom: '2px solid #111', paddingBottom: '8px' }}>
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
              <div><strong>{totalSlotsCount} séances</strong> · Seuil roulage : <strong>{settings.L.toFixed(2)} m</strong></div>
            </div>
          </div>
        </div>

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
                  <div style={{ textTransform: 'uppercase', fontWeight: 900, fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{day.weekdayStr.slice(0, 4)}. {day.dateObj.getUTCDate()}</span>
                    <span style={{ background: '#111', color: '#fff', padding: '0 4px', borderRadius: '3px', fontSize: '0.68rem' }}>
                      C.{day.coeff}
                    </span>
                  </div>
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
                    <div style={{ textAlign: 'center', color: '#666', fontStyle: 'italic', padding: '12px 0' }}>
                      {filterMode === 'validated' ? 'Aucun créneau validé' : 'Pas de séance possible'}
                    </div>
                  ) : (
                    day.slots.map((s, idx) => (
                      <div
                        key={s.key}
                        style={{
                          border: s.isRejected ? '1px dashed #fca5a5' : '1px solid #bbb',
                          borderRadius: '4px',
                          padding: '4px 6px',
                          background: s.isValidated ? '#f0fdf4' : s.isRejected ? '#fef2f2' : '#fff',
                          opacity: s.isRejected ? 0.75 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 900, fontSize: '0.8rem', color: '#111', textDecoration: s.isRejected ? 'line-through' : 'none' }}>
                            {s.startStr} – {s.endStr}
                          </span>
                          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: s.isValidated ? '#15803d' : s.isRejected ? '#b91c1c' : '#888' }}>
                            {s.isValidated ? '✓ VALIDÉ' : s.isRejected ? '✕ REFUSÉ' : 'EN ATTENTE'}
                          </span>
                        </div>
                        {s.isRejected && s.rejectReason && (
                          <div style={{ fontSize: '0.58rem', color: '#b91c1c', fontStyle: 'italic', marginTop: '1px' }}>
                            {s.rejectReason}
                          </div>
                        )}

                        {/* Hauteur d'eau précise en début et fin */}
                        <div style={{ margin: '3px 0', fontSize: '0.67rem', color: '#0369a1', fontWeight: 600, display: 'flex', justifyContent: 'space-between', background: '#e0f2fe', padding: '2px 4px', borderRadius: '3px' }}>
                          <span>🌊 Début : <strong>{s.hStart != null ? `${s.hStart.toFixed(2)} m` : '—'}</strong></span>
                          <span>{s.trend === 'down' ? '↘' : s.trend === 'up' ? '↗' : '→'}</span>
                          <span>Fin : <strong>{s.hEnd != null ? `${s.hEnd.toFixed(2)} m` : '—'}</strong></span>
                        </div>

                        {/* Météo et houle spécifiques du créneau */}
                        {s.weather && (
                          <div style={{ fontSize: '0.62rem', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>💨 {s.weather.windKts} nds {s.weather.gustKts ? `(raf. ${s.weather.gustKts})` : ''}</span>
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

                        {/* Zone d'émargement pour agenda papier */}
                        {includeNotesBox && (
                          <div style={{ marginTop: '3px', paddingTop: '3px', borderTop: '1px dotted #ccc', fontSize: '0.6rem', color: '#666' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>[ ] _____ pers.</span>
                              <span>Paiement : _____</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Espace notes en bas de bandelette */}
                {includeNotesBox && (
                  <div style={{ marginTop: '8px', paddingTop: '4px', borderTop: '1px solid #eee', fontSize: '0.6rem', color: '#888' }}>
                    Notes : ___________________________
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
                    <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'capitalize' }}>
                      {day.fullDateStr}
                    </h3>
                    <div style={{ fontSize: '0.7rem', color: '#555' }}>
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
                  <div style={{ textAlign: 'center', color: '#666', fontStyle: 'italic', padding: '10px 0', fontSize: '0.76rem' }}>
                    {filterMode === 'validated' ? 'Aucune séance validée pour ce jour' : 'Aucune séance calculable'}
                  </div>
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
                            background: s.isValidated ? '#f0fdf4' : s.isRejected ? '#fef2f2' : 'transparent',
                            opacity: s.isRejected ? 0.75 : 1,
                          }}
                        >
                          <td style={{ padding: '5px 4px', fontWeight: 800, fontSize: '0.78rem' }}>
                            <div style={{ textDecoration: s.isRejected ? 'line-through' : 'none' }}>
                              {s.startStr} – {s.endStr}
                            </div>
                            <div style={{ fontSize: '0.62rem', fontWeight: 800, color: s.isValidated ? '#15803d' : s.isRejected ? '#b91c1c' : '#6b7280' }}>
                              {s.isValidated ? '✓ Validé' : s.isRejected ? `✕ Refusé ${s.rejectReason ? `(${s.rejectReason})` : ''}` : 'En attente'}
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
                            <td style={{ padding: '5px 4px', color: '#999', fontSize: '0.66rem' }}>
                              [ ] _____ pers.
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
                    return (
                      <tr key={day.ds} style={{ borderBottom: '1px solid #e5e7eb', color: '#888' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 700 }}>
                          {day.weekdayStr.slice(0, 3)} {day.dateObj.getUTCDate()} {day.dateObj.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{day.coeff}</td>
                        <td style={{ padding: '6px 8px' }}>{day.bmInfo}</td>
                        <td colSpan={includeNotesBox ? 6 : 5} style={{ padding: '6px 8px', fontStyle: 'italic' }}>
                          {filterMode === 'validated' ? 'Aucune séance validée' : 'Pas de roulage'}
                        </td>
                      </tr>
                    );
                  }

                  return day.slots.map((s, idx) => (
                    <tr
                      key={`${day.ds}-${s.key}`}
                      style={{
                        borderBottom: idx === day.slots.length - 1 ? '2px solid #bbb' : '1px solid #e5e7eb',
                        background: s.isValidated ? '#f0fdf4' : s.isRejected ? '#fef2f2' : idx % 2 === 0 ? '#fff' : '#fafafa',
                        opacity: s.isRejected ? 0.75 : 1,
                      }}
                    >
                      {idx === 0 && (
                        <>
                          <td rowSpan={day.slots.length} style={{ padding: '6px 8px', fontWeight: 800, verticalAlign: 'top', borderRight: '1px solid #eee' }}>
                            <div>{day.weekdayStr.slice(0, 4)}. {day.dateObj.getUTCDate()} {day.dateObj.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}</div>
                            <div style={{ fontSize: '0.64rem', color: '#666', fontWeight: 400 }}>☀️ {day.sunRise}–{day.sunSet}</div>
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

                      <td style={{ padding: '6px 8px', fontWeight: 900, fontSize: '0.8rem' }}>
                        <div style={{ textDecoration: s.isRejected ? 'line-through' : 'none' }}>
                          {s.startStr} – {s.endStr}
                        </div>
                        <div style={{ fontSize: '0.62rem', fontWeight: 800, color: s.isValidated ? '#15803d' : s.isRejected ? '#b91c1c' : '#6b7280' }}>
                          {s.isValidated ? '✓ Validé' : s.isRejected ? `✕ Refusé ${s.rejectReason ? `(${s.rejectReason})` : ''}` : 'En attente'}
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
                        <td style={{ padding: '6px 8px', color: '#888', fontSize: '0.68rem' }}>
                          [ ] _____ pers. | Noms : ____________
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
        <div style={{ marginTop: '16px', paddingTop: '8px', borderTop: '1px solid #999', fontSize: '0.66rem', color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
