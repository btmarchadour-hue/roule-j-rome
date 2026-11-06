import React, { useState, useMemo } from 'react';
import { AppSettings, CustomSlotsMap, SlotObservation, TidePoint, ValidationsMap, WindPoint } from '../types';
import { computePeriodStats, PeriodStatsResult, CANCELLATION_REASONS_INFO } from '../utils/statisticsEngine';
import { minDs, maxDs, MOIS, p2, shf } from '../utils/tides';

interface StatisticsComparatorProps {
  settings: AppSettings;
  EX: TidePoint[];
  windList: WindPoint[];
  validations: ValidationsMap;
  customSlotsMap: CustomSlotsMap;
  observations: SlotObservation[];
  availableYears: number[];
}

type ComparatorPreset =
  | 'year_vs_year'
  | 'same_month'
  | 'summer_season'
  | 'quarter'
  | 'custom';

export const StatisticsComparator: React.FC<StatisticsComparatorProps> = ({
  settings,
  EX,
  windList,
  validations,
  customSlotsMap,
  observations,
  availableYears,
}) => {
  // Preset actif
  const [preset, setPreset] = useState<ComparatorPreset>('year_vs_year');

  // Filtre contextuel : Tous les jours ou week-ends
  const [filterScope, setFilterScope] = useState<'all' | 'weekends_only'>('all');

  // Paramètres pour le preset Année vs Année
  const [yearA, setYearA] = useState<number>(2026);
  const [yearB, setYearB] = useState<number>(2027);

  // Paramètres pour le preset Même mois
  const [monthSelected, setMonthSelected] = useState<number>(11); // 1-12
  const [monthYearA, setMonthYearA] = useState<number>(2026);
  const [monthYearB, setMonthYearB] = useState<number>(2027);

  // Paramètres pour le preset Saison estivale (Juillet-Août)
  const [summerYearA, setSummerYearA] = useState<number>(2026);
  const [summerYearB, setSummerYearB] = useState<number>(2027);

  // Paramètres pour le preset Trimestre
  const [quarterIdx, setQuarterIdx] = useState<number>(3); // 1: T1 (Jan-Mar), 2: T2 (Avr-Juin), 3: T3 (Juil-Sep), 4: T4 (Oct-Déc)
  const [quarterYearA, setQuarterYearA] = useState<number>(2026);
  const [quarterYearB, setQuarterYearB] = useState<number>(2027);

  // Paramètres pour le mode personnalisé
  const [customStartA, setCustomStartA] = useState<string>('2026-11-01');
  const [customEndA, setCustomEndA] = useState<string>('2026-11-15');
  const [customStartB, setCustomStartB] = useState<string>('2026-11-16');
  const [customEndB, setCustomEndB] = useState<string>('2026-11-30');

  // Définition des bornes de la Période A et Période B selon le preset
  const { periodA, periodB } = useMemo(() => {
    let sA = '';
    let eA = '';
    let titleA = '';
    let sB = '';
    let eB = '';
    let titleB = '';

    if (preset === 'year_vs_year') {
      sA = `${yearA}-01-01`;
      eA = `${yearA}-12-31`;
      titleA = `Année ${yearA}`;
      sB = `${yearB}-01-01`;
      eB = `${yearB}-12-31`;
      titleB = `Année ${yearB}`;
    } else if (preset === 'same_month') {
      const monthName = MOIS[monthSelected - 1];
      const lastDayA = new Date(monthYearA, monthSelected, 0).getDate();
      const lastDayB = new Date(monthYearB, monthSelected, 0).getDate();
      sA = `${monthYearA}-${p2(monthSelected)}-01`;
      eA = `${monthYearA}-${p2(monthSelected)}-${p2(lastDayA)}`;
      titleA = `${monthName} ${monthYearA}`;
      sB = `${monthYearB}-${p2(monthSelected)}-01`;
      eB = `${monthYearB}-${p2(monthSelected)}-${p2(lastDayB)}`;
      titleB = `${monthName} ${monthYearB}`;
    } else if (preset === 'summer_season') {
      sA = `${summerYearA}-07-01`;
      eA = `${summerYearA}-08-31`;
      titleA = `Été ${summerYearA} (Juil–Août)`;
      sB = `${summerYearB}-07-01`;
      eB = `${summerYearB}-08-31`;
      titleB = `Été ${summerYearB} (Juil–Août)`;
    } else if (preset === 'quarter') {
      const qNames = ['T1 (Janv–Mars)', 'T2 (Avr–Juin)', 'T3 (Juil–Sept)', 'T4 (Oct–Déc)'];
      const qRanges = [
        ['01-01', '03-31'],
        ['04-01', '06-30'],
        ['07-01', '09-30'],
        ['10-01', '12-31'],
      ];
      const range = qRanges[quarterIdx - 1];
      sA = `${quarterYearA}-${range[0]}`;
      eA = `${quarterYearA}-${range[1]}`;
      titleA = `${qNames[quarterIdx - 1]} ${quarterYearA}`;
      sB = `${quarterYearB}-${range[0]}`;
      eB = `${quarterYearB}-${range[1]}`;
      titleB = `${qNames[quarterIdx - 1]} ${quarterYearB}`;
    } else {
      // Custom
      sA = customStartA;
      eA = customEndA;
      titleA = `Du ${customStartA} au ${customEndA}`;
      sB = customStartB;
      eB = customEndB;
      titleB = `Du ${customStartB} au ${customEndB}`;
    }

    // Clamp à minDs et maxDs
    const clampA_s = sA < minDs ? minDs : sA;
    const clampA_e = eA > maxDs ? maxDs : eA;
    const clampB_s = sB < minDs ? minDs : sB;
    const clampB_e = eB > maxDs ? maxDs : eB;

    return {
      periodA: { start: clampA_s, end: clampA_e, label: titleA },
      periodB: { start: clampB_s, end: clampB_e, label: titleB },
    };
  }, [
    preset,
    yearA,
    yearB,
    monthSelected,
    monthYearA,
    monthYearB,
    summerYearA,
    summerYearB,
    quarterIdx,
    quarterYearA,
    quarterYearB,
    customStartA,
    customEndA,
    customStartB,
    customEndB,
  ]);

  // Calcul des statistiques Période A
  const statsA: PeriodStatsResult = useMemo(() => {
    return computePeriodStats(
      periodA.start,
      periodA.end,
      settings,
      EX,
      windList,
      validations,
      customSlotsMap,
      observations,
      filterScope
    );
  }, [periodA, settings, EX, windList, validations, customSlotsMap, observations, filterScope]);

  // Calcul des statistiques Période B
  const statsB: PeriodStatsResult = useMemo(() => {
    return computePeriodStats(
      periodB.start,
      periodB.end,
      settings,
      EX,
      windList,
      validations,
      customSlotsMap,
      observations,
      filterScope
    );
  }, [periodB, settings, EX, windList, validations, customSlotsMap, observations, filterScope]);

  // Calcul des deltas (Écarts B - A)
  const deltas = useMemo(() => {
    const diffConcretisation = Math.round((statsB.realizationRate - statsA.realizationRate) * 10) / 10;
    const diffRealized = statsB.totalRealizedSlots - statsA.totalRealizedSlots;
    const diffPossible = statsB.totalPossibleSlots - statsA.totalPossibleSlots;
    const diffCancelled = statsB.totalCancelledSlots - statsA.totalCancelledSlots;
    const diffParticipants = statsB.totalParticipants - statsA.totalParticipants;
    const diffFillRate = Math.round((statsB.avgFillRate - statsA.avgFillRate) * 10) / 10;
    const diffMono = statsB.totalMono - statsA.totalMono;
    const diffBi = statsB.totalBi - statsA.totalBi;

    // Pourcentage d'évolution participants
    const pctParticipants =
      statsA.totalParticipants > 0
        ? Math.round(((statsB.totalParticipants - statsA.totalParticipants) / statsA.totalParticipants) * 100)
        : null;

    return {
      diffConcretisation,
      diffRealized,
      diffPossible,
      diffCancelled,
      diffParticipants,
      pctParticipants,
      diffFillRate,
      diffMono,
      diffBi,
    };
  }, [statsA, statsB]);

  // Export CSV comparatif
  const handleExportComparisonCsv = () => {
    const headers = [
      'Indicateur',
      `Période A (${periodA.label})`,
      `Période B (${periodB.label})`,
      'Écart brut (B - A)',
      'Évolution relative',
    ];
    const rows = [
      [
        'Taux de concrétisation (%)',
        `${statsA.realizationRate}%`,
        `${statsB.realizationRate}%`,
        `${deltas.diffConcretisation > 0 ? '+' : ''}${deltas.diffConcretisation} pts`,
        '',
      ],
      [
        'Séances réalisées (nb)',
        statsA.totalRealizedSlots,
        statsB.totalRealizedSlots,
        `${deltas.diffRealized > 0 ? '+' : ''}${deltas.diffRealized}`,
        '',
      ],
      [
        'Créneaux possibles offerts par la plage (nb)',
        statsA.totalPossibleSlots,
        statsB.totalPossibleSlots,
        `${deltas.diffPossible > 0 ? '+' : ''}${deltas.diffPossible}`,
        '',
      ],
      [
        'Séances non réalisées / annulées (nb)',
        statsA.totalCancelledSlots,
        statsB.totalCancelledSlots,
        `${deltas.diffCancelled > 0 ? '+' : ''}${deltas.diffCancelled}`,
        '',
      ],
      [
        'Total participants accueillis',
        statsA.totalParticipants,
        statsB.totalParticipants,
        `${deltas.diffParticipants > 0 ? '+' : ''}${deltas.diffParticipants}`,
        deltas.pctParticipants != null ? `${deltas.pctParticipants > 0 ? '+' : ''}${deltas.pctParticipants}%` : 'N/A',
      ],
      [
        'Taux de remplissage moyen (%)',
        `${statsA.avgFillRate}%`,
        `${statsB.avgFillRate}%`,
        `${deltas.diffFillRate > 0 ? '+' : ''}${deltas.diffFillRate} pts`,
        '',
      ],
      [
        'Chars Monoplaces déployés',
        statsA.totalMono,
        statsB.totalMono,
        `${deltas.diffMono > 0 ? '+' : ''}${deltas.diffMono}`,
        '',
      ],
      [
        'Chars Biplaces déployés',
        statsA.totalBi,
        statsB.totalBi,
        `${deltas.diffBi > 0 ? '+' : ''}${deltas.diffBi}`,
        '',
      ],
    ];

    const csv = [
      headers.join(';'),
      ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparatif_lestrevet_${periodA.start}_vs_${periodB.start}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderDeltaBadge = (val: number, unit = '', invert = false) => {
    if (val === 0) {
      return (
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', background: '#f1f5f9', padding: '2px 7px', borderRadius: '4px' }}>
          = Stable
        </span>
      );
    }
    const isPositive = val > 0;
    // Pour les annulations, une hausse est négative pour l'activité
    const isGood = invert ? !isPositive : isPositive;
    const color = isGood ? '#166534' : '#991b1b';
    const bg = isGood ? '#dcfce7' : '#fee2e2';

    return (
      <span style={{ fontSize: '0.72rem', fontWeight: 800, color, background: bg, padding: '2px 7px', borderRadius: '4px' }}>
        {isPositive ? '+' : ''}{val}{unit}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. SÉLECTEUR DE CONFIGURATION DU COMPARATEUR */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1.5px solid #0284c7',
          boxShadow: '0 2px 8px rgba(2, 132, 199, 0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#0284c7', letterSpacing: '0.04em' }}>
              ⚖️ Comparateur Opérationnel & Multi-Saisons
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
              Comparer deux périodes (Année N vs N-1, Mois, Trimestres ou Sur-mesure)
            </h3>
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>
              Mesurez l'évolution de la fréquentation, l'impact météo sur les créneaux praticables et le taux de concrétisation.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="fbtn"
              onClick={handleExportComparisonCsv}
              style={{
                margin: 0,
                padding: '6px 12px',
                fontSize: '0.74rem',
                fontWeight: 800,
                background: '#f8fafc',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              📥 Exporter le comparatif CSV
            </button>
          </div>
        </div>

        {/* Choix des Presets rapides */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase' }}>
            Modèle de comparaison :
          </span>
          <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', flexWrap: 'wrap', gap: '2px' }}>
            {[
              { id: 'year_vs_year', label: '📅 Année vs Année' },
              { id: 'same_month', label: '🗓️ Même mois (N vs N-1)' },
              { id: 'summer_season', label: '☀️ Saison Estivale (Juil-Août)' },
              { id: 'quarter', label: '📊 Trimestre / Saison' },
              { id: 'custom', label: '✏️ Personnalisé' },
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id as ComparatorPreset)}
                style={{
                  padding: '5px 11px',
                  borderRadius: '6px',
                  border: 'none',
                  background: preset === p.id ? '#0f172a' : 'transparent',
                  color: preset === p.id ? '#fff' : '#64748b',
                  fontSize: '0.74rem',
                  fontWeight: preset === p.id ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Paramétrage contextuel des 2 périodes selon le Preset */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
            background: '#f8fafc',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
          }}
        >
          {/* Bloc Période A */}
          <div style={{ background: '#fff', border: '1.5px solid #0284c7', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase', marginBottom: '6px' }}>
              🔵 Période A (Référence)
            </div>

            {preset === 'year_vs_year' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>Année :</span>
                <select
                  value={yearA}
                  onChange={e => setYearA(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'same_month' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={monthSelected}
                  onChange={e => setMonthSelected(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {MOIS.map((m, idx) => (
                    <option key={idx + 1} value={idx + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                  ))}
                </select>
                <select
                  value={monthYearA}
                  onChange={e => setMonthYearA(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'summer_season' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>Été :</span>
                <select
                  value={summerYearA}
                  onChange={e => setSummerYearA(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'quarter' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={quarterIdx}
                  onChange={e => setQuarterIdx(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  <option value={1}>T1 (Janv–Mars)</option>
                  <option value={2}>T2 (Avr–Juin)</option>
                  <option value={3}>T3 (Juil–Sept)</option>
                  <option value={4}>T4 (Oct–Déc)</option>
                </select>
                <select
                  value={quarterYearA}
                  onChange={e => setQuarterYearA(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={customStartA}
                  min={minDs}
                  max={maxDs}
                  onChange={e => setCustomStartA(e.target.value)}
                  style={{ padding: '3px 6px', fontSize: '0.76rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '0.72rem' }}>au</span>
                <input
                  type="date"
                  value={customEndA}
                  min={minDs}
                  max={maxDs}
                  onChange={e => setCustomEndA(e.target.value)}
                  style={{ padding: '3px 6px', fontSize: '0.76rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
              </div>
            )}

            <div style={{ fontSize: '0.70rem', color: '#64748b', marginTop: '4px' }}>
              Du {periodA.start} au {periodA.end} ({statsA.totalDays} jours)
            </div>
          </div>

          {/* Bloc Période B */}
          <div style={{ background: '#fff', border: '1.5px solid #10b981', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#047857', textTransform: 'uppercase', marginBottom: '6px' }}>
              🟢 Période B (Comparaison)
            </div>

            {preset === 'year_vs_year' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>Année :</span>
                <select
                  value={yearB}
                  onChange={e => setYearB(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'same_month' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>
                  {MOIS[monthSelected - 1]?.charAt(0).toUpperCase() + MOIS[monthSelected - 1]?.slice(1)}
                </span>
                <select
                  value={monthYearB}
                  onChange={e => setMonthYearB(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'summer_season' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>Été :</span>
                <select
                  value={summerYearB}
                  onChange={e => setSummerYearB(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'quarter' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>
                  {['T1 (Janv–Mars)', 'T2 (Avr–Juin)', 'T3 (Juil–Sept)', 'T4 (Oct–Déc)'][quarterIdx - 1]}
                </span>
                <select
                  value={quarterYearB}
                  onChange={e => setQuarterYearB(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.8rem' }}
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={customStartB}
                  min={minDs}
                  max={maxDs}
                  onChange={e => setCustomStartB(e.target.value)}
                  style={{ padding: '3px 6px', fontSize: '0.76rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '0.72rem' }}>au</span>
                <input
                  type="date"
                  value={customEndB}
                  min={minDs}
                  max={maxDs}
                  onChange={e => setCustomEndB(e.target.value)}
                  style={{ padding: '3px 6px', fontSize: '0.76rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
              </div>
            )}

            <div style={{ fontSize: '0.70rem', color: '#64748b', marginTop: '4px' }}>
              Du {periodB.start} au {periodB.end} ({statsB.totalDays} jours)
            </div>
          </div>
        </div>
      </div>

      {/* 2. TABLEAU COMPARATIF DÉTAILLÉ & DELTAS */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: '#0f172a' }}>
            📊 Synthèse des Écarts : {periodA.label} vs {periodB.label}
          </h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Filtre :</span>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '2px', borderRadius: '6px' }}>
              <button
                type="button"
                onClick={() => setFilterScope('all')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: filterScope === 'all' ? '#0284c7' : 'transparent',
                  color: filterScope === 'all' ? '#fff' : '#64748b',
                  fontSize: '0.70rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Tous les jours
              </button>
              <button
                type="button"
                onClick={() => setFilterScope('weekends_only')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: filterScope === 'weekends_only' ? '#0284c7' : 'transparent',
                  color: filterScope === 'weekends_only' ? '#fff' : '#64748b',
                  fontSize: '0.70rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Week-ends
              </button>
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1', color: '#475569', fontSize: '0.70rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px' }}>Indicateur clé</th>
                <th style={{ padding: '8px 10px', color: '#0369a1' }}>🔵 {periodA.label}</th>
                <th style={{ padding: '8px 10px', color: '#047857' }}>🟢 {periodB.label}</th>
                <th style={{ padding: '8px 10px' }}>Écart brut (B − A)</th>
                <th style={{ padding: '8px 10px' }}>Visualisation comparative</th>
              </tr>
            </thead>
            <tbody>
              {/* Ligne 1 : Taux de concrétisation */}
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 10px', fontWeight: 800 }}>
                  🎯 Taux de concrétisation
                  <div style={{ fontSize: '0.67rem', color: '#64748b', fontWeight: 400 }}>
                    Part des créneaux calculés réellement courus
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontFamily: 'monospace', fontSize: '0.92rem', fontWeight: 900 }}>
                  {statsA.realizationRate}%
                </td>
                <td style={{ padding: '10px 10px', fontFamily: 'monospace', fontSize: '0.92rem', fontWeight: 900 }}>
                  {statsB.realizationRate}%
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {renderDeltaBadge(deltas.diffConcretisation, ' pts')}
                </td>
                <td style={{ padding: '10px 10px', minWidth: '160px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.65rem', width: '12px', color: '#0369a1' }}>A</span>
                      <div style={{ flex: 1, background: '#e2e8f0', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, statsA.realizationRate)}%`, background: '#0284c7', height: '100%' }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.65rem', width: '12px', color: '#047857' }}>B</span>
                      <div style={{ flex: 1, background: '#e2e8f0', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, statsB.realizationRate)}%`, background: '#10b981', height: '100%' }} />
                      </div>
                    </div>
                  </div>
                </td>
              </tr>

              {/* Ligne 2 : Séances réalisées */}
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 10px', fontWeight: 800 }}>
                  ⛵ Séances réalisées (validées)
                  <div style={{ fontSize: '0.67rem', color: '#64748b', fontWeight: 400 }}>
                    Volume de séances ayant eu lieu sur l'eau
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 900, fontFamily: 'monospace' }}>
                  {statsA.totalRealizedSlots} séance{statsA.totalRealizedSlots > 1 ? 's' : ''}
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 900, fontFamily: 'monospace' }}>
                  {statsB.totalRealizedSlots} séance{statsB.totalRealizedSlots > 1 ? 's' : ''}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {renderDeltaBadge(deltas.diffRealized, ' séance' + (Math.abs(deltas.diffRealized) > 1 ? 's' : ''))}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <div style={{ fontSize: '0.70rem', color: '#475569' }}>
                    {statsA.totalRealizedSlots === 0 && statsB.totalRealizedSlots === 0
                      ? 'Aucune séance sur ces périodes'
                      : `${statsA.totalRealizedSlots} vs ${statsB.totalRealizedSlots}`}
                  </div>
                </td>
              </tr>

              {/* Ligne 3 : Créneaux possibles (Impact météo & marée) */}
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 10px', fontWeight: 800 }}>
                  🌊 Potentiel de créneaux praticables
                  <div style={{ fontSize: '0.67rem', color: '#64748b', fontWeight: 400 }}>
                    Créneaux praticables offerts par la marée et la météo (théorie)
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 800, color: '#334155' }}>
                  {statsA.totalPossibleSlots} créneaux
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 800, color: '#334155' }}>
                  {statsB.totalPossibleSlots} créneaux
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {renderDeltaBadge(deltas.diffPossible, ' créneaux')}
                </td>
                <td style={{ padding: '10px 10px', fontSize: '0.70rem', color: '#64748b' }}>
                  {deltas.diffPossible > 0
                    ? `+${deltas.diffPossible} créneaux exploitables en plus sur B`
                    : deltas.diffPossible < 0
                    ? `${deltas.diffPossible} créneaux exploitables en moins sur B`
                    : 'Potentiel de marée équivalent'}
                </td>
              </tr>

              {/* Ligne 4 : Séances annulées */}
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 10px', fontWeight: 800 }}>
                  ⛔ Séances non réalisées (annulées)
                  <div style={{ fontSize: '0.67rem', color: '#64748b', fontWeight: 400 }}>
                    Créneaux prévus mais annulés (météo, vent, absence de clients)
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 800, color: '#dc2626' }}>
                  {statsA.totalCancelledSlots}
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 800, color: '#dc2626' }}>
                  {statsB.totalCancelledSlots}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {renderDeltaBadge(deltas.diffCancelled, '', true)}
                </td>
                <td style={{ padding: '10px 10px', fontSize: '0.70rem', color: '#64748b' }}>
                  {deltas.diffCancelled < 0
                    ? `🟢 ${Math.abs(deltas.diffCancelled)} annulation(s) en moins sur B`
                    : deltas.diffCancelled > 0
                    ? `⚠️ +${deltas.diffCancelled} annulation(s) supplémentaires sur B`
                    : 'Même niveau d’annulations'}
                </td>
              </tr>

              {/* Ligne 5 : Total inscrits / Fréquentation */}
              <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#faf5ff' }}>
                <td style={{ padding: '10px 10px', fontWeight: 900, color: '#6b21a8' }}>
                  👥 Participants & Pilotes accueillis
                  <div style={{ fontSize: '0.67rem', color: '#7e22ce', fontWeight: 400 }}>
                    Volume d'activité réelle sur le sable
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 900, fontFamily: 'monospace', fontSize: '0.95rem', color: '#0f172a' }}>
                  {statsA.totalParticipants} inscrits
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 900, fontFamily: 'monospace', fontSize: '0.95rem', color: '#0f172a' }}>
                  {statsB.totalParticipants} inscrits
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {renderDeltaBadge(deltas.diffParticipants, ' pilotes')}
                  {deltas.pctParticipants != null && (
                    <span style={{ fontSize: '0.68rem', marginLeft: '6px', color: deltas.pctParticipants >= 0 ? '#166534' : '#991b1b', fontWeight: 800 }}>
                      ({deltas.pctParticipants > 0 ? '+' : ''}{deltas.pctParticipants}%)
                    </span>
                  )}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <div style={{ fontSize: '0.70rem', color: '#6b21a8', fontWeight: 700 }}>
                    {deltas.diffParticipants > 0
                      ? `Hausse d'activité (+${deltas.diffParticipants} personnes)`
                      : deltas.diffParticipants < 0
                      ? `Baisse de fréquentation (${deltas.diffParticipants} personnes)`
                      : 'Fréquentation identique'}
                  </div>
                </td>
              </tr>

              {/* Ligne 6 : Taux de remplissage moyen */}
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 10px', fontWeight: 800 }}>
                  📈 Taux de remplissage moyen
                  <div style={{ fontSize: '0.67rem', color: '#64748b', fontWeight: 400 }}>
                    Remplissage des séances (base 12 places / séance)
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 800, fontFamily: 'monospace' }}>
                  {statsA.avgFillRate}%
                </td>
                <td style={{ padding: '10px 10px', fontWeight: 800, fontFamily: 'monospace' }}>
                  {statsB.avgFillRate}%
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {renderDeltaBadge(deltas.diffFillRate, ' pts')}
                </td>
                <td style={{ padding: '10px 10px', fontSize: '0.70rem', color: '#64748b' }}>
                  Capacité d'encadrement optimisée à {statsB.avgFillRate}% sur B
                </td>
              </tr>

              {/* Ligne 7 : Matériel Mono vs Bi */}
              <tr>
                <td style={{ padding: '10px 10px', fontWeight: 800 }}>
                  🏎️ Mix Flotte : Monoplaces / Biplaces
                  <div style={{ fontSize: '0.67rem', color: '#64748b', fontWeight: 400 }}>
                    Répartition des chars déployés
                  </div>
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <span style={{ fontWeight: 800 }}>{statsA.totalMono}</span> Mono · <span style={{ fontWeight: 800 }}>{statsA.totalBi}</span> Bi
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <span style={{ fontWeight: 800 }}>{statsB.totalMono}</span> Mono · <span style={{ fontWeight: 800 }}>{statsB.totalBi}</span> Bi
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <div style={{ fontSize: '0.70rem', fontWeight: 700 }}>
                    Mono: {deltas.diffMono > 0 ? `+${deltas.diffMono}` : deltas.diffMono} | Bi: {deltas.diffBi > 0 ? `+${deltas.diffBi}` : deltas.diffBi}
                  </div>
                </td>
                <td style={{ padding: '10px 10px', fontSize: '0.70rem', color: '#64748b' }}>
                  {statsB.totalParticipants > 0
                    ? `${Math.round((statsB.totalMono / statsB.totalParticipants) * 100)}% monoplaces en B`
                    : 'N/A'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. COMPARAISON DES MOTIFS D'ANNULATION (A vs B) */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div style={{ marginBottom: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#0f172a' }}>
            🌪️ Comparatif des Causes d'Annulation : {periodA.label} vs {periodB.label}
          </h4>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Identifiez si les pertes de séances sont dues à la météo (vent/bâches) ou au manque de réservations.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {/* Motifs Période A */}
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', marginBottom: '8px' }}>
              🔵 {periodA.label} ({statsA.totalCancelledSlots} annulation{statsA.totalCancelledSlots > 1 ? 's' : ''})
            </div>
            {statsA.cancellationReasonsBreakdown.length === 0 ? (
              <div style={{ fontSize: '0.72rem', color: '#166534', fontStyle: 'italic', padding: '10px 0' }}>
                🎉 Aucune annulation enregistrée sur cette période
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {statsA.cancellationReasonsBreakdown.map(item => (
                  <div key={item.reason} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem' }}>
                    <span>{item.info.icon} {item.info.label}</span>
                    <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>
                      {item.count} ({Math.round(item.percentage)}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Motifs Période B */}
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#047857', marginBottom: '8px' }}>
              🟢 {periodB.label} ({statsB.totalCancelledSlots} annulation{statsB.totalCancelledSlots > 1 ? 's' : ''})
            </div>
            {statsB.cancellationReasonsBreakdown.length === 0 ? (
              <div style={{ fontSize: '0.72rem', color: '#166534', fontStyle: 'italic', padding: '10px 0' }}>
                🎉 Aucune annulation enregistrée sur cette période
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {statsB.cancellationReasonsBreakdown.map(item => (
                  <div key={item.reason} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem' }}>
                    <span>{item.info.icon} {item.info.label}</span>
                    <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>
                      {item.count} ({Math.round(item.percentage)}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
