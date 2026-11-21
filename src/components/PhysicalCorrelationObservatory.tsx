import React, { useEffect, useMemo, useState } from 'react';
import {
  AppSettings,
  BeachCadreProfile,
  GpsWaterlineLog,
  SlotObservation,
  WindPoint,
} from '../types';
import {
  buildPhysicalObservationPoints,
  buildWeatherMatrix3x3,
  extractDayWeatherProfile,
  filterPointsByWindow,
  fitEmpiricalTerrainModel,
  MatrixCellData,
  OBSERVATORY_START_DATE,
  ObservatoryMetric,
  PRESSURE_BANDS,
  runTerrainSimulation,
  SWELL_BANDS,
  TimeWindowFilter,
  WindFilterMode,
} from '../utils/physicalCorrelationEngine';
import { MOIS } from '../utils/tides';

interface PhysicalCorrelationObservatoryProps {
  gpsLogs: GpsWaterlineLog[];
  observations: SlotObservation[];
  activeCadre?: BeachCadreProfile | null;
  settings: AppSettings;
  windList?: WindPoint[];
  selectedDate?: string;
  onNewObservation?: () => void;
  onEditObservation?: (obs: SlotObservation) => void;
}

function fmtSigned(val: number | null, unit: 'm' | 'cm' | 'min'): string {
  if (val == null || !Number.isFinite(val)) return '—';
  const r = Math.round(val);
  if (r === 0) return `0 ${unit}`;
  return `${r > 0 ? '+' : '−'}${Math.abs(r)} ${unit}`;
}

function fmtDateShort(ds: string): string {
  if (!ds) return '—';
  const parts = ds.split('-');
  if (parts.length !== 3) return ds;
  const d = Number(parts[2]);
  const m = Number(parts[1]) - 1;
  const mon = MOIS[m] ? MOIS[m].slice(0, 3) : parts[1];
  return `${String(d).padStart(2, '0')} ${mon}.`;
}

export const PhysicalCorrelationObservatory: React.FC<
  PhysicalCorrelationObservatoryProps
> = ({
  gpsLogs,
  observations,
  activeCadre,
  windList = [],
  selectedDate = '',
  onNewObservation,
  onEditObservation,
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'simulator'>('matrix');
  const [windFilter, setWindFilter] = useState<WindFilterMode>('all');
  const [windowFilter, setWindowFilter] = useState<TimeWindowFilter>('all');
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);

  // 1. Base terrain propre dès le 20/11/2026 (GPS bord d'eau + REX)
  const { points: rawPoints, excludedPreStartCount } = useMemo(
    () =>
      buildPhysicalObservationPoints(
        gpsLogs,
        observations,
        activeCadre,
        OBSERVATORY_START_DATE
      ),
    [gpsLogs, observations, activeCadre]
  );

  // Choix automatique d'unité par défaut : mètres si au moins 1 relevé GPS largeur existe, sinon cm
  const hasAnyWidthData = useMemo(
    () => rawPoints.some(p => p.widthDeltaM != null),
    [rawPoints]
  );
  const [metric, setMetric] = useState<ObservatoryMetric>(() =>
    hasAnyWidthData ? 'width_m' : 'surcote_cm'
  );
  const [userPickedMetric, setUserPickedMetric] = useState(false);

  useEffect(() => {
    if (!userPickedMetric) {
      setMetric(hasAnyWidthData ? 'width_m' : 'surcote_cm');
    }
  }, [hasAnyWidthData, userPickedMetric]);

  const points = useMemo(
    () => filterPointsByWindow(rawPoints, windowFilter),
    [rawPoints, windowFilter]
  );

  // 2. Profil météo du jour sélectionné (pour repère "Jour" dans la matrice + pré-remplissage simulateur)
  const dayWeather = useMemo(
    () => extractDayWeatherProfile(selectedDate, windList),
    [selectedDate, windList]
  );

  // 3. Matrice 3x3 (Pression × Houle)
  const matrix = useMemo(
    () => buildWeatherMatrix3x3(points, windFilter, metric, dayWeather),
    [points, windFilter, metric, dayWeather]
  );

  const selectedCell: MatrixCellData | null =
    selectedCellKey && matrix.cells[selectedCellKey]?.count > 0
      ? matrix.cells[selectedCellKey]
      : null;

  // 4. Modèle empirique auto-calibré + Simulateur (3 curseurs)
  const empiricalModel = useMemo(
    () => fitEmpiricalTerrainModel(points),
    [points]
  );

  const [simPressure, setSimPressure] = useState<number>(1013);
  const [simWave, setSimWave] = useState<number>(1.2);
  const [simWindKts, setSimWindKts] = useState<number>(15);
  const [simWindSector, setSimWindSector] = useState<'sea' | 'land'>('sea');
  const [simInitialized, setSimInitialized] = useState(false);

  const resetSimToDayWeather = () => {
    if (!dayWeather) {
      setSimPressure(1013);
      setSimWave(1.2);
      setSimWindKts(15);
      setSimWindSector('sea');
      return;
    }
    setSimPressure(
      dayWeather.pressureHpa != null
        ? Math.max(985, Math.min(1035, dayWeather.pressureHpa))
        : 1013
    );
    setSimWave(
      dayWeather.waveHeightM != null
        ? Math.max(0, Math.min(3.5, dayWeather.waveHeightM))
        : 1.0
    );
    setSimWindKts(
      dayWeather.windKts != null
        ? Math.max(0, Math.min(35, dayWeather.windKts))
        : 12
    );
    setSimWindSector(dayWeather.windSector === 'land' ? 'land' : 'sea');
  };

  useEffect(() => {
    if (!simInitialized && dayWeather) {
      resetSimToDayWeather();
      setSimInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayWeather, simInitialized]);

  const simulation = useMemo(
    () =>
      runTerrainSimulation(
        empiricalModel,
        points,
        simPressure,
        simWave,
        simWindKts,
        simWindSector
      ),
    [empiricalModel, points, simPressure, simWave, simWindKts, simWindSector]
  );

  const unitLabel: 'm' | 'cm' = metric === 'width_m' ? 'm' : 'cm';

  return (
    <div className="obs-wrap">
      {/* EN-TÊTE SOBRE */}
      <div className="obs-head">
        <div className="obs-title-group">
          <h3 className="obs-title">🧭 2. Impact Météo sur la Plage</h3>
          <span className="obs-pill-date">
            Dès le 20/11/2026 · {points.length} relevé{points.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="obs-head-actions">
          <div className="obs-seg" role="tablist" aria-label="Mode d'analyse">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'matrix'}
              className={`obs-seg-btn ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              ⊞ Matrice 3×3
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'simulator'}
              className={`obs-seg-btn ${activeTab === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulator')}
            >
              🎛️ Simulateur
            </button>
          </div>

          {onNewObservation && (
            <button
              type="button"
              className="obs-btn-primary"
              onClick={onNewObservation}
            >
              + REX
            </button>
          )}
        </div>
      </div>

      {/* VUE 1 : MATRICE 3×3 (PRESSION × HOULE + FILTRE VENT MER/TERRE) */}
      {activeTab === 'matrix' && (
        <div>
          {/* Barre de filtres unique et compacte */}
          <div className="obs-toolbar">
            <div className="obs-toolbar-group">
              <div className="obs-seg" aria-label="Filtre secteur vent">
                {(
                  [
                    { id: 'all', label: 'Tous vents' },
                    { id: 'sea', label: '🌊 Mer (O)' },
                    { id: 'land', label: '🌬️ Terre (E)' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`obs-seg-btn ${windFilter === opt.id ? 'active' : ''}`}
                    onClick={() => {
                      setWindFilter(opt.id);
                      setSelectedCellKey(null);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="obs-seg" aria-label="Unité affichée">
                <button
                  type="button"
                  className={`obs-seg-btn ${metric === 'width_m' ? 'active' : ''}`}
                  onClick={() => {
                    setMetric('width_m');
                    setUserPickedMetric(true);
                  }}
                >
                  Plage (m)
                </button>
                <button
                  type="button"
                  className={`obs-seg-btn ${metric === 'surcote_cm' ? 'active' : ''}`}
                  onClick={() => {
                    setMetric('surcote_cm');
                    setUserPickedMetric(true);
                  }}
                >
                  Surcote (cm)
                </button>
              </div>
            </div>

            <div className="obs-seg" aria-label="Période">
              {(
                [
                  { id: 'all', label: 'Dès 20/11' },
                  { id: '90d', label: '90 j' },
                  { id: '30d', label: '30 j' },
                ] as const
              ).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`obs-seg-btn ${windowFilter === opt.id ? 'active' : ''}`}
                  onClick={() => {
                    setWindowFilter(opt.id);
                    setSelectedCellKey(null);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* GRILLE 3×3 PROPRE ET LISIBLE */}
          <div className="obs-matrix-scroll">
            <div className="obs-matrix">
              <div className="obs-m-corner">
                <span>Houle →</span>
                <span>Pression ↓</span>
              </div>

              {SWELL_BANDS.map(sb => (
                <div key={sb.id} className="obs-m-colhead">
                  <div className="obs-m-colhead-title">{sb.label}</div>
                  <div className="obs-m-colhead-sub">{sb.subLabel}</div>
                </div>
              ))}

              {PRESSURE_BANDS.map(pb => (
                <React.Fragment key={pb.id}>
                  <div className="obs-m-rowhead">
                    <div className="obs-m-rowhead-title">{pb.label}</div>
                    <div className="obs-m-rowhead-sub">{pb.subLabel}</div>
                  </div>

                  {SWELL_BANDS.map(sb => {
                    const key = `${pb.id}_${sb.id}`;
                    const cell = matrix.cells[key];
                    const isSelected = selectedCellKey === key;
                    const clickable = cell.count > 0;

                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!clickable}
                        onClick={() =>
                          clickable &&
                          setSelectedCellKey(prev => (prev === key ? null : key))
                        }
                        className={`obs-cell tone-${cell.tone} ${
                          clickable ? 'clickable' : ''
                        } ${isSelected ? 'selected' : ''} ${
                          cell.isTodayCell ? 'today-cell' : ''
                        }`}
                        title={
                          clickable
                            ? `${pb.label} · ${sb.label} : ${cell.count} relevé(s) — cliquer pour voir`
                            : `${pb.label} · ${sb.label} : aucun relevé pour l'instant`
                        }
                      >
                        {cell.isTodayCell && (
                          <span className="obs-today-tag">
                            {dayWeather?.isFallbackToday
                              ? 'Auj.'
                              : fmtDateShort(dayWeather?.dateStr || '')}
                          </span>
                        )}

                        <div className="obs-cell-val">
                          {fmtSigned(cell.displayValue, unitLabel)}
                        </div>
                        <div className="obs-cell-sub">
                          {cell.displayCount > 0
                            ? `${cell.displayCount} rel.`
                            : cell.count > 0
                            ? `${cell.count} REX (cm)`
                            : '—'}
                        </div>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Tiroir de détail uniquement si on clique sur une case */}
          {selectedCell && (
            <div className="obs-drawer">
              <div className="obs-drawer-head">
                <span>
                  {PRESSURE_BANDS.find(p => p.id === selectedCell.pressureBand)?.label} ·{' '}
                  {SWELL_BANDS.find(s => s.id === selectedCell.swellBand)?.label} —{' '}
                  {selectedCell.count} relevé{selectedCell.count > 1 ? 's' : ''}
                  {selectedCell.minValue != null &&
                    selectedCell.maxValue != null &&
                    selectedCell.displayCount >= 2 && (
                      <>
                        {' '}
                        (de {fmtSigned(selectedCell.minValue, unitLabel)} à{' '}
                        {fmtSigned(selectedCell.maxValue, unitLabel)})
                      </>
                    )}
                </span>
                <button
                  type="button"
                  className="obs-drawer-close"
                  onClick={() => setSelectedCellKey(null)}
                >
                  ✕ Fermer
                </button>
              </div>
              <table className="obs-drawer-table">
                <tbody>
                  {selectedCell.points.slice(0, 5).map(pt => (
                    <tr key={pt.id}>
                      <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {fmtDateShort(pt.dateStr)} · {pt.timeStr}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {pt.source === 'gps' ? '📍 GPS' : '📝 REX'}
                      </td>
                      <td>
                        {pt.pressureHpa ?? '—'} hPa ·{' '}
                        {pt.waveHeightM != null
                          ? `${pt.waveHeightM.toFixed(1).replace('.', ',')} m`
                          : '—'}{' '}
                        · {pt.windKts != null ? `${pt.windKts} nds ` : ''}
                        {pt.windDirComp || ''}
                      </td>
                      <td style={{ fontWeight: 900, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {pt.widthDeltaM != null
                          ? fmtSigned(pt.widthDeltaM, 'm')
                          : fmtSigned(pt.surcoteCm, 'cm')}
                        {pt.widthDeltaM != null && pt.surcoteCm != null && (
                          <span style={{ fontWeight: 600, opacity: 0.7, marginLeft: '6px' }}>
                            ({fmtSigned(pt.surcoteCm, 'cm')})
                          </span>
                        )}
                      </td>
                      {pt.rawRexObs && onEditObservation ? (
                        <td style={{ textAlign: 'right', width: '1%' }}>
                          <button
                            type="button"
                            className="obs-sim-reset"
                            onClick={() => onEditObservation(pt.rawRexObs!)}
                          >
                            Modifier
                          </button>
                        </td>
                      ) : (
                        <td style={{ width: '1%' }} />
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedCell.points.length > 5 && (
                <div
                  style={{
                    padding: '5px 10px',
                    fontSize: '0.67rem',
                    color: 'var(--mu)',
                    background: 'var(--cell)',
                  }}
                >
                  Affichage des 5 relevés les plus récents sur {selectedCell.points.length}.
                </div>
              )}
            </div>
          )}

          {/* Bandeau de synthèse 1 ligne */}
          <div className="obs-summary-bar">
            <span>
              {matrix.totalMatchedPoints > 0 ? (
                <>
                  <strong>{matrix.totalMatchedPoints}</strong> relevé
                  {matrix.totalMatchedPoints > 1 ? 's' : ''} classé
                  {matrix.totalMatchedPoints > 1 ? 's' : ''} · Écart moyen :{' '}
                  <strong>{fmtSigned(matrix.avgDisplayValue, unitLabel)}</strong>
                  {matrix.withinTolerancePct != null && (
                    <>
                      {' '}
                      · <strong>{matrix.withinTolerancePct}%</strong> dans ±15 {unitLabel} du
                      SHOM
                    </>
                  )}
                </>
              ) : (
                <>
                  Grille prête dès le <strong>20/11/2026</strong> — vos relevés GPS bord d’eau
                  et REX rempliront automatiquement ces 9 cases.
                </>
              )}
            </span>
            <span>
              {excludedPreStartCount > 0 && (
                <span>{excludedPreStartCount} essais avant le 20/11 exclus</span>
              )}
              {dayWeather && dayWeather.pressureHpa != null && dayWeather.waveHeightM != null && (
                <span style={{ marginLeft: excludedPreStartCount > 0 ? '10px' : 0 }}>
                  📍 {dayWeather.isFallbackToday ? 'Auj.' : fmtDateShort(dayWeather.dateStr)} :{' '}
                  <strong>{dayWeather.pressureHpa} hPa</strong> ·{' '}
                  <strong>{dayWeather.waveHeightM.toFixed(1).replace('.', ',')} m</strong>
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* VUE 2 : SIMULATEUR INTERACTIF + CALIBRATION APPRISE */}
      {activeTab === 'simulator' && (
        <div>
          <div className="obs-sim-grid">
            {/* Gauche : 3 curseurs météo */}
            <div className="obs-sim-panel">
              <div className="obs-sim-panel-head">
                <span className="obs-sim-label">Conditions à tester</span>
                <button
                  type="button"
                  className="obs-sim-reset"
                  onClick={resetSimToDayWeather}
                >
                  ↺ Météo du jour
                </button>
              </div>

              <div className="obs-slider-row">
                <div className="obs-slider-top">
                  <span className="obs-slider-name">Pression atmosphérique</span>
                  <span className="obs-slider-val">{simPressure} hPa</span>
                </div>
                <input
                  type="range"
                  className="obs-slider-input"
                  min={985}
                  max={1035}
                  step={1}
                  value={simPressure}
                  onChange={e => setSimPressure(Number(e.target.value))}
                />
              </div>

              <div className="obs-slider-row">
                <div className="obs-slider-top">
                  <span className="obs-slider-name">Hauteur de houle</span>
                  <span className="obs-slider-val">
                    {simWave.toFixed(1).replace('.', ',')} m
                  </span>
                </div>
                <input
                  type="range"
                  className="obs-slider-input"
                  min={0}
                  max={3.5}
                  step={0.1}
                  value={simWave}
                  onChange={e => setSimWave(Number(e.target.value))}
                />
              </div>

              <div className="obs-slider-row">
                <div className="obs-slider-top">
                  <span className="obs-slider-name">Vent</span>
                  <span className="obs-slider-val">
                    {simWindKts} nds · {simWindSector === 'sea' ? 'Mer (O)' : 'Terre (E)'}
                  </span>
                </div>
                <input
                  type="range"
                  className="obs-slider-input"
                  min={0}
                  max={35}
                  step={1}
                  value={simWindKts}
                  onChange={e => setSimWindKts(Number(e.target.value))}
                />
                <div className="obs-seg" style={{ marginTop: '4px', alignSelf: 'flex-start' }}>
                  <button
                    type="button"
                    className={`obs-seg-btn ${simWindSector === 'sea' ? 'active' : ''}`}
                    onClick={() => setSimWindSector('sea')}
                  >
                    🌊 Vent de mer (Ouest)
                  </button>
                  <button
                    type="button"
                    className={`obs-seg-btn ${simWindSector === 'land' ? 'active' : ''}`}
                    onClick={() => setSimWindSector('land')}
                  >
                    🌬️ Vent de terre (Est)
                  </button>
                </div>
              </div>
            </div>

            {/* Droite : 1 seule réponse directe */}
            <div className={`obs-result-card tone-${simulation.tone}`}>
              <div>
                <div className="obs-sim-label" style={{ opacity: 0.75, marginBottom: '6px' }}>
                  Impact estimé sur la plage de Lestrevet
                </div>
                <div className="obs-result-main">
                  {fmtSigned(simulation.estimatedWidthDeltaM, 'm')}{' '}
                  <span style={{ fontSize: '0.92rem', fontWeight: 800 }}>de piste</span>
                </div>
                <div className="obs-result-sub">
                  Surcote eau : <strong>{fmtSigned(simulation.estimatedSurcoteCm, 'cm')}</strong>
                  {' · '}
                  Roulage :{' '}
                  <strong>≈ {fmtSigned(simulation.estimatedTimeDeltaMin, 'min')}</strong> vs SHOM
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '8px' }}>
                  {simulation.nearbyCount > 0 ? (
                    <>
                      Confirmé par <strong>{simulation.nearbyCount} relevé</strong>
                      {simulation.nearbyCount > 1 ? 's' : ''} proche
                      {simulation.nearbyCount > 1 ? 's' : ''}
                      {simulation.nearbyMinM != null &&
                      simulation.nearbyMaxM != null &&
                      simulation.nearbyCount >= 2
                        ? ` (constaté entre ${fmtSigned(simulation.nearbyMinM, 'm')} et ${fmtSigned(
                            simulation.nearbyMaxM,
                            'm'
                          )})`
                        : simulation.nearbyMinCm != null &&
                          simulation.nearbyMaxCm != null &&
                          simulation.nearbyCount >= 2
                        ? ` (surcote entre ${fmtSigned(simulation.nearbyMinCm, 'cm')} et ${fmtSigned(
                            simulation.nearbyMaxCm,
                            'cm'
                          )})`
                        : ''}
                    </>
                  ) : points.length === 0 ? (
                    'Estimation physique de départ — se calibrera automatiquement dès vos relevés du 20/11.'
                  ) : (
                    `Estimé par votre modèle terrain (${points.length} relevé${
                      points.length > 1 ? 's' : ''
                    } depuis le 20/11).`
                  )}
                </div>
              </div>

              {simulation.nearbyPoints.length > 0 && (
                <div className="obs-nearby-list">
                  <div style={{ fontSize: '0.67rem', fontWeight: 800, opacity: 0.75 }}>
                    RELEVÉS LES PLUS PROCHES :
                  </div>
                  {simulation.nearbyPoints.map(({ point, similarityPct }) => (
                    <div key={point.id} className="obs-nearby-row">
                      <span>
                        <strong>{fmtDateShort(point.dateStr)}</strong> ·{' '}
                        {point.pressureHpa ?? '—'} hPa ·{' '}
                        {point.waveHeightM != null
                          ? `${point.waveHeightM.toFixed(1).replace('.', ',')} m`
                          : '—'}{' '}
                        · {point.windKts != null ? `${point.windKts} nds` : '—'}
                      </span>
                      <span>
                        <strong>
                          {point.widthDeltaM != null
                            ? fmtSigned(point.widthDeltaM, 'm')
                            : fmtSigned(point.surcoteCm, 'cm')}
                        </strong>{' '}
                        <span style={{ opacity: 0.7 }}>({similarityPct}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Barre de calibration apprise (Piste 3 condensée en 1 ligne propre) */}
          <div className="obs-cal-bar">
            <div className="obs-cal-items">
              <span>
                <strong>⚙️ Poids Lestrevet</strong> ({empiricalModel.terrainConfidencePct}%
                terrain) :
              </span>
              <span>
                Pression{' '}
                <strong>
                  +{empiricalModel.surcoteCoefs.cmPerHpaDrop.toFixed(1).replace('.', ',')} cm/hPa
                </strong>
              </span>
              <span>
                Houle{' '}
                <strong>
                  +{empiricalModel.surcoteCoefs.cmPerWaveM.toFixed(1).replace('.', ',')} cm/m
                </strong>
              </span>
              <span>
                Vent mer{' '}
                <strong>
                  +{empiricalModel.surcoteCoefs.cmPer10KtsOnshore.toFixed(1).replace('.', ',')}{' '}
                  cm / 10 nds
                </strong>
              </span>
            </div>

            {empiricalModel.shomMaeM != null && empiricalModel.calibratedMaeM != null ? (
              <div style={{ fontWeight: 800, color: '#065f46' }}>
                Erreur SHOM : ±{Math.round(empiricalModel.shomMaeM)} m → Calibré : ±
                {Math.round(empiricalModel.calibratedMaeM)} m
              </div>
            ) : empiricalModel.shomMaeCm != null && empiricalModel.calibratedMaeCm != null ? (
              <div style={{ fontWeight: 800, color: '#065f46' }}>
                Erreur SHOM : ±{Math.round(empiricalModel.shomMaeCm)} cm → Calibré : ±
                {Math.round(empiricalModel.calibratedMaeCm)} cm
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
