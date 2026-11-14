import React, { useMemo, useState } from 'react';
import { AppSettings, CustomSlotsMap, TidePoint, ValidationsMap, WindPoint } from '../types';
import { AgendaBookingItem } from '../utils/firebaseSync';
import { getSlotBookingsSummary } from '../utils/cycleHelpers';
import { CALENDAR_INDICATOR_COLORS, getFrenchHolidayInfo, HOLIDAY_ZONE_COLORS } from '../utils/frenchHolidays';
import { dayFocus, dayWind, getDayKeyTide, kOf, lc, maxDs, minDs, MOIS, p2, plan, tdy, vstat } from '../utils/tides';

interface CalendarGridProps {
  year: number;
  month: number;
  selectedDate: string;
  onSelectDate: (ds: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  validations?: ValidationsMap;
  customSlotsMap?: CustomSlotsMap;
  bookingsMap?: Record<string, AgendaBookingItem[]>;
  isReadOnly?: boolean;
  onValidateRange?: (dates: string[], scopeLabel: string) => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  year,
  month,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  settings,
  EX,
  W: tideW,
  first,
  last,
  windList,
  validations = {},
  customSlotsMap = {},
  bookingsMap = {},
  isReadOnly = false,
  onValidateRange,
}) => {
  const [confirmScope, setConfirmScope] = useState<'week' | 'month' | null>(null);
  const dayNames = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const firstDayOffset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const numDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const emptyCells = [];
  for (let i = 0; i < firstDayOffset; i++) {
    emptyCells.push(<div key={`empty-${i}`} />);
  }

  const validatedThisMonth = Object.keys(validations || {}).filter(ds => {
    const [y, m] = ds.split('-').map(Number);
    return y === year && m === month + 1;
  }).length;
  const [minY, minM] = minDs.split('-').map(Number);
  const isAtMinMonth = year === minY && month <= minM - 1;

  const dayCells = [];
  for (let d = 1; d <= numDays; d++) {
    const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
    const inRange = ds >= minDs && ds <= maxDs;
    const isSelected = ds === selectedDate;
    const isPast = ds < tdy();

    let dotClass = '';
    let badgeText = '';
    let keyTideLabel = '';
    let valStatus: 'none' | 'ok' | 'chg' = 'none';
    let valCount = 0;
    let rejCount = 0;
    let notPublishedCount = 0;
    let cycle2Count = 0;
    let totalCount = 0;
    let isPartial = false;
    let dayBookedChars = 0;

    let dayTooltip = '';

    const holiday = getFrenchHolidayInfo(ds);

    if (inRange) {
      const dw = dayWind(year, month, d, settings, tideW, first, last, windList);
      if (dw.lvl === 2 || dw.lvl === -1) {
        dotClass = 'ok';
      } else if (dw.lvl === 1) {
        dotClass = 'mid';
      }

      const pl = plan(year, month, d, settings, tideW, first, last);
      const n = pl.full.length;
      const e = pl.extra.length;
      if (n || e) {
        badgeText = (n ? String(n) : '') + (e ? `+${e}` : '');
      }

      // Compter les chars réservés dans bookingsMap pour ce jour
      for (const [bKey, bItems] of Object.entries(bookingsMap)) {
        if (bKey.startsWith(`${ds}_`) && Array.isArray(bItems) && bItems.length > 0) {
          dayBookedChars += getSlotBookingsSummary(bItems).totalChars;
        }
      }

      if (validations && validations[ds]) {
        const fDay = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        const vInfo = vstat(fDay, validations);
        valStatus = isPast && vInfo.st === 'chg' ? 'ok' : vInfo.st;
        valCount = vInfo.valCount;
        rejCount = vInfo.rejCount;
        notPublishedCount = vInfo.notPublishedCount || 0;
        cycle2Count = vInfo.cycle2Count;
        totalCount = vInfo.totalCount;
        isPartial = vInfo.isPartial;
      }

      const kt = getDayKeyTide(EX, ds);
      if (kt) {
        keyTideLabel = kt.label;
        dayTooltip = `${d} ${MOIS[month]} ${year} · ${kt.label}${kt.coef ? ` · Coef ${kt.coef}` : ''}`;
      } else {
        dayTooltip = `${d} ${MOIS[month]} ${year}`;
      }

      if (holiday.isHoliday) {
        dayTooltip += ` · 🎒 ${holiday.holidayName} (${holiday.zonesLabel})`;
      }
      if (holiday.publicHolidayName) {
        dayTooltip += ` · ⭐ Férié : ${holiday.publicHolidayName}`;
      }
      if (holiday.isBridgeWeek && holiday.bridgeHolidayLabel) {
        dayTooltip += ` · 🌉 Pont possible : ${holiday.bridgeHolidayLabel}`;
      }

      if (dayBookedChars > 0) {
        dayTooltip += ` · ⚡ Cycle 2 actif (${dayBookedChars} char${dayBookedChars > 1 ? 's' : ''} inscrit${dayBookedChars > 1 ? 's' : ''})`;
      }

      if (valStatus === 'ok') {
        dayTooltip += ` · ${cycle2Count > 0 ? '✓' : '📅'} ${valCount} ouvert${valCount > 1 ? 's' : ''}${
          rejCount ? `, ${rejCount} fermé${rejCount > 1 ? 's' : ''}` : ''
        }${isPast ? ' (passé)' : ''}`;
      } else if (!isPast && valStatus === 'chg') {
        dayTooltip += ' · ⚠️ Cycle 2 : météo/créneaux modifiés depuis validation';
      }
    }

    const cellClass = [
      'c',
      inRange ? '' : 'na',
      isSelected ? 'sel' : '',
      dotClass,
    ]
      .filter(Boolean)
      .join(' ');

    const hasCycle2 = dayBookedChars > 0 || cycle2Count > 0;

    dayCells.push(
      <button
        key={ds}
        type="button"
        className={cellClass}
        onClick={() => {
          if (inRange) onSelectDate(ds);
        }}
        disabled={!inRange}
        title={inRange ? dayTooltip : undefined}
      >
        {valStatus === 'ok' && valCount > 0 && (
          <span
            className="cal-val-tag ok"
            style={!hasCycle2 && !isPast ? { background: '#0284c7' } : undefined}
            title={
              hasCycle2
                ? `${cycle2Count} créneau(x) en Cycle 2${dayBookedChars > 0 ? ` (${dayBookedChars} chars)` : ''}`
                : isPartial
                ? `Cycle 1 : ${valCount}/${totalCount} créneau(x) publié(s)`
                : 'Cycle 1 : journée publiée à la vente'
            }
          >
            {hasCycle2 ? (isPartial ? `${valCount}/${totalCount}` : '⚡') : isPartial ? `${valCount}/${totalCount}` : 'C1'}
          </span>
        )}
        {valStatus === 'none' && dayBookedChars > 0 && (
          <span
            className="cal-val-tag ok"
            style={{ background: '#7c3aed' }}
            title={`Cycle 2 déclenché (${dayBookedChars} char${dayBookedChars > 1 ? 's' : ''})`}
          >
            ⚡
          </span>
        )}
        {valStatus === 'ok' && valCount === 0 && rejCount > 0 && (
          <span
            className="cal-val-tag rej"
            style={notPublishedCount > 0 ? { background: '#475569' } : undefined}
            title={
              notPublishedCount > 0
                ? `${notPublishedCount} créneau${notPublishedCount > 1 ? 'x' : ''} non publié${notPublishedCount > 1 ? 's' : ''} en Cycle 1`
                : `${rejCount} créneau${rejCount > 1 ? 'x' : ''} fermé${rejCount > 1 ? 's' : ''}`
            }
          >
            {notPublishedCount > 0 ? '🚫' : '✕'}
          </span>
        )}
        {!isPast && valStatus === 'chg' && (
          <span className="cal-val-tag warn" title="Cycle 2 : prévisions modifiées sur journée engagée">
            ⚠️
          </span>
        )}
        <span style={{ lineHeight: 1 }}>{d}</span>
        <i />
        {badgeText && <small>{badgeText}</small>}
        {keyTideLabel && (
          <span
            style={{
              fontSize: '0.52rem',
              fontWeight: 700,
              lineHeight: 1,
              marginTop: '1px',
              opacity: 0.85,
              whiteSpace: 'nowrap',
              letterSpacing: '-0.02em',
            }}
          >
            {keyTideLabel}
          </span>
        )}
        {(holiday.isHoliday || holiday.isPublicHoliday || holiday.isBridgeWeek) && (
          <span
            className="cal-holiday-corner"
            aria-label={[
              holiday.isPublicHoliday ? `Jour férié : ${holiday.publicHolidayName}` : '',
              holiday.isBridgeWeek ? `Pont possible : ${holiday.bridgeHolidayLabel}` : '',
              holiday.isHoliday ? `Vacances scolaires : ${holiday.zonesLabel}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {holiday.isPublicHoliday && (
              <span
                className="cal-holiday-zone"
                style={{
                  backgroundColor: CALENDAR_INDICATOR_COLORS.F.bg,
                  color: CALENDAR_INDICATOR_COLORS.F.text,
                }}
                title={`Jour férié : ${holiday.publicHolidayName}`}
              >
                {CALENDAR_INDICATOR_COLORS.F.code}
              </span>
            )}
            {holiday.isBridgeWeek && (
              <span
                className="cal-holiday-zone"
                style={{
                  backgroundColor: CALENDAR_INDICATOR_COLORS.P.bg,
                  color: CALENDAR_INDICATOR_COLORS.P.text,
                }}
                title={`Pont possible : ${holiday.bridgeHolidayLabel}`}
              >
                {CALENDAR_INDICATOR_COLORS.P.code}
              </span>
            )}
            {holiday.isHoliday &&
              holiday.zones.map(z => {
                const zoneStyle = HOLIDAY_ZONE_COLORS[z];
                return (
                  <span
                    key={z}
                    className="cal-holiday-zone"
                    style={{
                      backgroundColor: zoneStyle.bg,
                      color: zoneStyle.text,
                    }}
                  >
                    {z}
                  </span>
                );
              })}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="card cal">
      <div className="top">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1>Horaires de roulage</h1>
            {validatedThisMonth > 0 && (
              <span
                style={{
                  fontSize: '0.62rem',
                  background: 'var(--okbg, #e2f4e8)',
                  color: 'var(--ok, #166534)',
                  padding: '2px 7px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  border: '1px solid currentColor',
                }}
                title={`${validatedThisMonth} jour(s) validé(s) ce mois`}
              >
                ✓ {validatedThisMonth} validé{validatedThisMonth > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="sub">Plage de Lestrevet · Plomodiern</div>
        </div>
        <div className="nav">
          <button
            type="button"
            onClick={onPrevMonth}
            disabled={isAtMinMonth}
            aria-label="Mois précédent"
            style={isAtMinMonth ? { opacity: 0.25, cursor: 'not-allowed' } : undefined}
            title={isAtMinMonth ? 'Début du calendrier au 1er novembre 2026' : 'Mois précédent'}
          >
            ‹
          </button>
          <b>
            {MOIS[month]} {year}
          </b>
          <button type="button" onClick={onNextMonth} aria-label="Mois suivant">
            ›
          </button>
        </div>
      </div>

      <div className="g">
        {dayNames.map(dn => (
          <div key={dn} className="dn">
            {dn}
          </div>
        ))}
        {emptyCells}
        {dayCells}
      </div>

      <div className="cal-holiday-legend">
        <span style={{ fontWeight: 700 }}>Repères (bas droit) :</span>
        {(['B', 'C', 'A'] as const).map(z => {
          const zoneStyle = HOLIDAY_ZONE_COLORS[z];
          return (
            <span key={z} className="cal-holiday-legend-item">
              <span
                className="cal-holiday-swatch"
                style={{
                  backgroundColor: zoneStyle.bg,
                  color: zoneStyle.text,
                }}
              >
                {z}
              </span>
              <span>
                {zoneStyle.colorName} · {zoneStyle.cities} (Zone {z})
              </span>
            </span>
          );
        })}
        {(['F', 'P'] as const).map(code => {
          const ind = CALENDAR_INDICATOR_COLORS[code];
          return (
            <span key={code} className="cal-holiday-legend-item">
              <span
                className="cal-holiday-swatch"
                style={{
                  backgroundColor: ind.bg,
                  color: ind.text,
                }}
              >
                {ind.code}
              </span>
              <span>
                {ind.colorName} · {ind.label}
              </span>
            </span>
          );
        })}
      </div>

      {!isReadOnly && onValidateRange && (
        <BatchCycle1Bar
          year={year}
          month={month}
          numDays={numDays}
          selectedDate={selectedDate}
          settings={settings}
          tideW={tideW}
          first={first}
          last={last}
          windList={windList}
          customSlotsMap={customSlotsMap}
          validations={validations}
          confirmScope={confirmScope}
          setConfirmScope={setConfirmScope}
          onValidateRange={onValidateRange}
        />
      )}
    </div>
  );
};

interface BatchCycle1BarProps {
  year: number;
  month: number;
  numDays: number;
  selectedDate: string;
  settings: AppSettings;
  tideW: [number, number][];
  first: number;
  last: number;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  validations: ValidationsMap;
  confirmScope: 'week' | 'month' | null;
  setConfirmScope: React.Dispatch<React.SetStateAction<'week' | 'month' | null>>;
  onValidateRange: (dates: string[], scopeLabel: string) => void;
}

const BatchCycle1Bar: React.FC<BatchCycle1BarProps> = ({
  year,
  month,
  numDays,
  selectedDate,
  settings,
  tideW,
  first,
  last,
  windList,
  customSlotsMap,
  validations,
  confirmScope,
  setConfirmScope,
  onValidateRange,
}) => {
  const todayStr = tdy();

  const { weekDates, weekPendingCount, weekLabel, monthDates, monthPendingCount, monthLabel } = useMemo(() => {
    const countPending = (datesList: string[]) => {
      let pending = 0;
      for (const ds of datesList) {
        if (ds < todayStr || ds < minDs || ds > maxDs) continue;
        const fDay = dayFocus(ds, settings, tideW, first, last, windList, customSlotsMap);
        if (!fDay || fDay.list.length === 0) continue;
        const rec = validations[ds];
        if (!rec) {
          pending++;
          continue;
        }
        if (rec.items.length > 0 && rec.items.every(it => it.cycle1Status === 'not_published')) {
          continue;
        }
        const covered = fDay.list.filter(x => {
          const sk = kOf(x);
          const sStr = lc(x.a, fDay.y, fDay.m, fDay.d);
          const eStr = lc(x.b, fDay.y, fDay.m, fDay.d);
          return rec.items.some(it => it.k === sk || (it.s === sStr && it.e === eStr));
        }).length;
        if (covered < fDay.list.length) pending++;
      }
      return pending;
    };

    // Liste des jours du mois affiché (>= aujourd'hui)
    const mDates: string[] = [];
    for (let d = 1; d <= numDays; d++) {
      const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
      if (ds >= todayStr && ds >= minDs && ds <= maxDs) {
        mDates.push(ds);
      }
    }

    // Calcul de la semaine (Lundi -> Dimanche) contenant le jour sélectionné (s'il est dans ce mois), sinon le 1er jour ouvrable du mois
    const displayedPrefix = `${year}-${p2(month + 1)}-`;
    const anchorDs =
      selectedDate.startsWith(displayedPrefix) && selectedDate >= todayStr
        ? selectedDate
        : mDates[0] || `${year}-${p2(month + 1)}-01`;
    const [ay, am, ad] = anchorDs.split('-').map(Number);
    const anchorUtc = new Date(Date.UTC(ay, am - 1, ad));
    const offsetMonday = (anchorUtc.getUTCDay() + 6) % 7;
    const mondayUtc = new Date(anchorUtc.getTime() - offsetMonday * 86400000);
    const sundayUtc = new Date(mondayUtc.getTime() + 6 * 86400000);

    const wDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dObj = new Date(mondayUtc.getTime() + i * 86400000);
      const ds = `${dObj.getUTCFullYear()}-${p2(dObj.getUTCMonth() + 1)}-${p2(dObj.getUTCDate())}`;
      if (ds >= todayStr && ds >= minDs && ds <= maxDs) {
        wDates.push(ds);
      }
    }

    const fmtShort = (dObj: Date) => `${p2(dObj.getUTCDate())}/${p2(dObj.getUTCMonth() + 1)}`;
    const wLabel = `Semaine du ${fmtShort(mondayUtc)} au ${fmtShort(sundayUtc)}`;
    const mLabel = `${MOIS[month]} ${year}`;

    return {
      weekDates: wDates,
      weekPendingCount: countPending(wDates),
      weekLabel: wLabel,
      monthDates: mDates,
      monthPendingCount: countPending(mDates),
      monthLabel: mLabel,
    };
  }, [year, month, numDays, selectedDate, todayStr, settings, tideW, first, last, windList, customSlotsMap, validations]);

  const activeConfirmDates = confirmScope === 'week' ? weekDates : monthDates;
  const activeConfirmCount = confirmScope === 'week' ? weekPendingCount : monthPendingCount;
  const activeConfirmLabel = confirmScope === 'week' ? weekLabel : monthLabel;

  return (
    <div
      style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px dashed var(--bd, #cbd5e1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ fontSize: '0.70rem', fontWeight: 800, color: '#334155' }}>
          📅 Publication rapide Cycle 1 :
          <span style={{ fontWeight: 600, color: '#64748b', marginLeft: '6px' }}>
            (en complément du jour par jour)
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <button
            type="button"
            disabled={weekPendingCount === 0}
            onClick={() => setConfirmScope(prev => (prev === 'week' ? null : 'week'))}
            style={{
              padding: '5px 10px',
              borderRadius: '6px',
              border: weekPendingCount > 0 ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
              background:
                confirmScope === 'week'
                  ? '#0284c7'
                  : weekPendingCount > 0
                  ? '#f0f9ff'
                  : '#f8fafc',
              color:
                confirmScope === 'week'
                  ? '#ffffff'
                  : weekPendingCount > 0
                  ? '#0369a1'
                  : '#94a3b8',
              fontSize: '0.70rem',
              fontWeight: 800,
              cursor: weekPendingCount > 0 ? 'pointer' : 'not-allowed',
            }}
            title={
              weekPendingCount > 0
                ? `Publier en Cycle 1 les ${weekPendingCount} jour(s) ouvrable(s) en attente sur : ${weekLabel}`
                : `${weekLabel} déjà entièrement publiée`
            }
          >
            {weekPendingCount > 0
              ? `📆 Valider la semaine (${weekLabel.replace('Semaine ', '')} · ${weekPendingCount} j)`
              : `✓ ${weekLabel} validée`}
          </button>

          <button
            type="button"
            disabled={monthPendingCount === 0}
            onClick={() => setConfirmScope(prev => (prev === 'month' ? null : 'month'))}
            style={{
              padding: '5px 10px',
              borderRadius: '6px',
              border: monthPendingCount > 0 ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
              background:
                confirmScope === 'month'
                  ? '#16a34a'
                  : monthPendingCount > 0
                  ? '#f0fdf4'
                  : '#f8fafc',
              color:
                confirmScope === 'month'
                  ? '#ffffff'
                  : monthPendingCount > 0
                  ? '#15803d'
                  : '#94a3b8',
              fontSize: '0.70rem',
              fontWeight: 800,
              cursor: monthPendingCount > 0 ? 'pointer' : 'not-allowed',
            }}
            title={
              monthPendingCount > 0
                ? `Publier en Cycle 1 les ${monthPendingCount} jour(s) en attente sur tout ${monthLabel}`
                : `Tout ${monthLabel} est déjà validé`
            }
          >
            {monthPendingCount > 0
              ? `🗓️ Valider le mois (${monthLabel} · ${monthPendingCount} j)`
              : `✓ Mois ${monthLabel} validé`}
          </button>
        </div>
      </div>

      {confirmScope && activeConfirmCount > 0 && (
        <div
          style={{
            background: '#fffbeb',
            border: '1.5px solid #fcd34d',
            borderRadius: '8px',
            padding: '8px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: '#78350f', lineHeight: 1.4 }}>
            <strong>Confirmer la publication Cycle 1 :</strong> {activeConfirmLabel} ({activeConfirmCount} journée
            {activeConfirmCount > 1 ? 's' : ''} avec créneaux).
            <br />
            <span style={{ fontSize: '0.67rem', color: '#92400e' }}>
              Les jours passés, les journées marquées « À ne pas publier » et les créneaux déjà en Cycle 2 sont préservés.
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setConfirmScope(null)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '0.70rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => {
                onValidateRange(activeConfirmDates, activeConfirmLabel);
                setConfirmScope(null);
              }}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                border: 'none',
                background: '#16a34a',
                color: '#ffffff',
                fontSize: '0.70rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ✓ Confirmer ({activeConfirmCount} j)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
