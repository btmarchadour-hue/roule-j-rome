import React, { useState, useMemo, useEffect } from 'react';
import { AppSettings, CustomSlotsMap, SlotObservation, TidePoint, ValidationsMap, WindPoint } from '../types';
import {
  CANCELLATION_REASONS_INFO,
  computePeriodStats,
  computeCalibrationStats,
  getStoredObservations,
  exportObservationsAsCsv,
} from '../utils/statisticsEngine';
import { SlotObservationModal } from './SlotObservationModal';
import { subscribeToObservations, deleteObservationFromFirestore } from '../utils/firebaseSync';

interface StatisticsTabProps {
  settings: AppSettings;
  EX: TidePoint[];
  windList: WindPoint[];
  validations: ValidationsMap;
  customSlotsMap: CustomSlotsMap;
  selectedDate: string;
}

export const StatisticsTab: React.FC<StatisticsTabProps> = ({
  settings,
  EX,
  windList,
  validations,
  customSlotsMap,
  selectedDate,
}) => {
  // Liste des observations terrain enregistrées (données réelles uniquement)
  const [observations, setObservations] = useState<SlotObservation[]>(() =>
    getStoredObservations().filter(o => o && o.id && !o.id.startsWith('sample-obs-'))
  );

  // Abonnement temps réel Firestore pour recevoir les relevés notés par Jérôme ou Benoît
  useEffect(() => {
    // Purger définitivement tout ancien échantillon fictif du stockage local
    try {
      localStorage.removeItem('char_slot_observations_v1');
      const stored = localStorage.getItem('cv_observations_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((o: SlotObservation) => o && o.id && !o.id.startsWith('sample-obs-'));
          localStorage.setItem('cv_observations_v1', JSON.stringify(clean));
          setObservations(clean);
        }
      }
    } catch {
      // ignore
    }

    const unsubscribe = subscribeToObservations(remoteObs => {
      const cleanRemote = (remoteObs || []).filter(o => o && o.id && !o.id.startsWith('sample-obs-'));
      setObservations(cleanRemote);
      try {
        localStorage.setItem('cv_observations_v1', JSON.stringify(cleanRemote));
      } catch {
        // ignore
      }
    });
    return () => unsubscribe();
  }, []);

  // Modal de saisie / édition d'un relevé
  const [modalOpen, setModalOpen] = useState(false);
  const [editingObservation, setEditingObservation] = useState<SlotObservation | null>(null);

  // Granularité temporelle : 'week' | 'month' | 'year' | 'all'
  const [timeGranularity, setTimeGranularity] = useState<'week' | 'month' | 'year' | 'all'>('month');

  // Filtre de population / jours : 'all' | 'holidays_only' | 'weekends_only'
  const [filterScope, setFilterScope] = useState<'all' | 'holidays_only' | 'weekends_only'>('all');

  // Mois / Année d'analyse
  const selectedYear = parseInt(selectedDate.slice(0, 4), 10) || 2026;
  const selectedMonth = parseInt(selectedDate.slice(5, 7), 10) || 2; // 1-12

  // Calcul des bornes de dates selon la granularité sélectionnée
  const { startDateStr, endDateStr, periodTitle } = useMemo(() => {
    if (timeGranularity === 'week') {
      // Semaine ISO contenant selectedDate
      const d = new Date(`${selectedDate}T00:00:00`);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Lundi
      const monday = new Date(d.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const sStr = monday.toISOString().slice(0, 10);
      const eStr = sunday.toISOString().slice(0, 10);
      return {
        startDateStr: sStr,
        endDateStr: eStr,
        periodTitle: `Semaine du ${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      };
    }

    if (timeGranularity === 'month') {
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
      const sStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const eStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const monthName = new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return {
        startDateStr: sStr,
        endDateStr: eStr,
        periodTitle: `Mois de ${monthName}`,
      };
    }

    if (timeGranularity === 'year') {
      return {
        startDateStr: `${selectedYear}-01-01`,
        endDateStr: `${selectedYear}-12-31`,
        periodTitle: `Année ${selectedYear}`,
      };
    }

    // 'all' : Historique complet (ex: 2025 - 2027)
    return {
      startDateStr: '2026-01-01',
      endDateStr: '2026-12-31',
      periodTitle: `Historique global 2026`,
    };
  }, [timeGranularity, selectedDate, selectedYear, selectedMonth]);

  // Calcul des statistiques de la période sélectionnée
  const periodStats = useMemo(() => {
    return computePeriodStats(
      startDateStr,
      endDateStr,
      settings,
      EX,
      windList,
      validations,
      customSlotsMap,
      observations,
      filterScope
    );
  }, [startDateStr, endDateStr, settings, EX, windList, validations, customSlotsMap, observations, filterScope]);

  // Calcul des statistiques de calibration & surcote (Point 2)
  const calibrationStats = useMemo(() => {
    return computeCalibrationStats(observations, settings.L);
  }, [observations, settings.L]);

  // Export CSV
  const handleExportCsv = () => {
    const csvContent = exportObservationsAsCsv(observations);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `releves_terrain_lestrevet_${startDateStr}_${endDateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenNewObservation = () => {
    setEditingObservation(null);
    setModalOpen(true);
  };

  const handleEditObservation = (obs: SlotObservation) => {
    setEditingObservation(obs);
    setModalOpen(true);
  };

  // Survol interactif du camembert
  const [hoveredReasonIndex, setHoveredReasonIndex] = useState<number | null>(null);

  // Construction des tranches du camembert SVG
  const pieSlices = useMemo(() => {
    const total = periodStats.cancellationReasonsBreakdown.reduce((sum, item) => sum + item.count, 0);
    if (total === 0) return [];

    let currentAngle = 0;
    return periodStats.cancellationReasonsBreakdown.map((item, idx) => {
      const sliceAngle = (item.count / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      currentAngle = endAngle;

      // Coordonnées SVG de l'arc (rayon 100, centre 120, 120)
      const r = 90;
      const cx = 120;
      const cy = 120;

      const radStart = (startAngle - 90) * (Math.PI / 180);
      const radEnd = (endAngle - 90) * (Math.PI / 180);

      const x1 = cx + r * Math.cos(radStart);
      const y1 = cy + r * Math.sin(radStart);
      const x2 = cx + r * Math.cos(radEnd);
      const y2 = cy + r * Math.sin(radEnd);

      const largeArcFlag = sliceAngle > 180 ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      return {
        ...item,
        path: d,
        index: idx,
      };
    });
  }, [periodStats.cancellationReasonsBreakdown]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* 1. HEADER & ACTIONS BAR */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--card)',
          border: '1px solid var(--bd)',
        }}
      >
        <div>
          <div style={{ textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 800, color: 'var(--mu)', letterSpacing: '0.06em' }}>
            Char à Voile du Bout du Monde · Plage de Lestrevet
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 900, color: 'var(--tx)' }}>
            📊 Statistiques Opérationnelles & Observatoire des Écarts
          </h2>
          <div style={{ fontSize: '0.78rem', color: 'var(--mu)', marginTop: '2px' }}>
            Taux de concrétisation, analyse des causes de non-réalisation et calibration fine du spot.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="fbtn"
            onClick={handleExportCsv}
            style={{
              margin: 0,
              padding: '8px 12px',
              fontSize: '0.78rem',
              fontWeight: 800,
              background: '#f8fafc',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Exporter l'ensemble des relevés et statistiques au format CSV"
          >
            <span>📥</span>
            <span>Exporter CSV</span>
          </button>

          <button
            type="button"
            className="fbtn"
            onClick={handleOpenNewObservation}
            style={{
              margin: 0,
              padding: '8px 14px',
              fontSize: '0.78rem',
              fontWeight: 800,
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>+</span>
            <span>Noter un relevé terrain</span>
          </button>
        </div>
      </div>

      {/* 2. SÉLECTEUR DE PÉRIODE & FILTRES */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--cell, #f1f5f9)',
          padding: '10px 14px',
          borderRadius: '10px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        {/* Sélecteur de granularité : Semaine / Mois / Année */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase' }}>
            Période :
          </span>
          <div style={{ display: 'inline-flex', background: '#fff', padding: '2px', borderRadius: '8px', border: '1px solid var(--bd, #cbd5e1)' }}>
            {[
              { id: 'week', label: 'Semaine' },
              { id: 'month', label: 'Mois' },
              { id: 'year', label: `Année ${selectedYear}` },
              { id: 'all', label: 'Tout' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTimeGranularity(tab.id as any)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: timeGranularity === tab.id ? '#0f172a' : 'transparent',
                  color: timeGranularity === tab.id ? '#fff' : '#64748b',
                  fontSize: '0.76rem',
                  fontWeight: timeGranularity === tab.id ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span style={{ fontWeight: 800, fontSize: '0.82rem', color: '#0f172a', marginLeft: '6px' }}>
            {periodTitle}
          </span>
        </div>

        {/* Filtre contextuel : Tous les jours / Vacances / Week-ends */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase' }}>
            Filtre :
          </span>
          <div style={{ display: 'inline-flex', background: '#fff', padding: '2px', borderRadius: '8px', border: '1px solid var(--bd, #cbd5e1)' }}>
            {[
              { id: 'all', label: 'Tous les jours' },
              { id: 'weekends_only', label: 'Week-ends uniquement' },
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterScope(f.id as any)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: filterScope === f.id ? '#0284c7' : 'transparent',
                  color: filterScope === f.id ? '#fff' : '#64748b',
                  fontSize: '0.74rem',
                  fontWeight: filterScope === f.id ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. CARTES DES MÉTRIQUES CLÉS (KPIS) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        {/* KPI 1 : Taux de concrétisation */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #0284c7',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1', letterSpacing: '0.04em' }}>
            🎯 Taux de concrétisation
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
              {periodStats.realizationRate}%
            </span>
            <span style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700 }}>
              réalisées
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            <strong>{periodStats.totalRealizedSlots}</strong> réalisées sur <strong>{periodStats.totalPossibleSlots}</strong> créneaux possibles
          </div>
        </div>

        {/* KPI 2 : Séances Annulées / Non Réalisées */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #ef4444',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#b91c1c', letterSpacing: '0.04em' }}>
            ⛔ Séances non réalisées
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#dc2626', fontFamily: 'monospace' }}>
              {periodStats.totalCancelledSlots}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#dc2626', fontWeight: 700 }}>
              séances
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            Soit {Math.round((100 - periodStats.realizationRate) * 10) / 10}% de créneaux non exploités
          </div>
        </div>

        {/* KPI 3 : Remplissage & Participants */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid #10b981',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#047857', letterSpacing: '0.04em' }}>
            👥 Participants & Remplissage
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
              {periodStats.totalParticipants}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>
              inscrits
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            Taux de remplissage : <strong>{periodStats.avgFillRate}%</strong> (base 12 places / séance)
          </div>
        </div>

        {/* KPI 4 : Répartition Matériel Mono vs Bi */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            background: 'var(--card)',
            border: '1.5px solid var(--bd)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--mu)', letterSpacing: '0.04em' }}>
            🏎️ Flotte Chars (Mono / Bi)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '6px' }}>
            <div>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a' }}>{periodStats.totalMono}</span>
              <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '3px' }}>Mono</span>
            </div>
            <div style={{ color: '#cbd5e1' }}>|</div>
            <div>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a' }}>{periodStats.totalBi}</span>
              <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '3px' }}>Bi</span>
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mu)', marginTop: '4px' }}>
            {periodStats.totalParticipants > 0 ? `${Math.round((periodStats.totalMono / periodStats.totalParticipants) * 100)}% monoplaces` : 'Répartition conforme aux réservations'}
          </div>
        </div>
      </div>

      {/* 4. SECTION 1 : LE CAMEMBERT DES CAUSES DE NON-RÉALISATION */}
      <div
        className="card"
        style={{
          padding: '18px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
          <div>
            <div style={{ textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 800, color: '#dc2626', letterSpacing: '0.04em' }}>
              Analyse des Annulations · Lestrevet
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
              🥧 Pourquoi les séances n'ont-elles pas eu lieu ?
            </h3>
            <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
              Vent trop faible, rafales excessives, mauvais secteur ou absence d'inscrits sur la période.
            </div>
          </div>

          <div style={{ fontSize: '0.74rem', background: '#fef2f2', color: '#991b1b', padding: '4px 10px', borderRadius: '6px', fontWeight: 800, border: '1px solid #fecaca' }}>
            Total : {periodStats.totalCancelledSlots} séances non réalisées
          </div>
        </div>

        {pieSlices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b', fontSize: '0.85rem' }}>
            🎉 Aucune séance annulée sur cette période ! 100% des créneaux ont été réalisés.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'center' }}>
            {/* Graphique SVG Camembert */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
              <svg width="240" height="240" viewBox="0 0 240 240" style={{ transform: 'rotate(0deg)' }}>
                {pieSlices.map(slice => {
                  const isHovered = hoveredReasonIndex === slice.index;
                  return (
                    <path
                      key={slice.reason}
                      d={slice.path}
                      fill={slice.info.color}
                      stroke="#fff"
                      strokeWidth="2"
                      style={{
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease, opacity 0.15s ease',
                        transformOrigin: '120px 120px',
                        transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                        opacity: hoveredReasonIndex != null && !isHovered ? 0.6 : 1,
                      }}
                      onMouseEnter={() => setHoveredReasonIndex(slice.index)}
                      onMouseLeave={() => setHoveredReasonIndex(null)}
                    >
                      <title>{`${slice.info.label}: ${slice.count} séance(s) (${Math.round(slice.percentage)}%)`}</title>
                    </path>
                  );
                })}
                {/* Cercle central pour effet Donut moderne */}
                <circle cx="120" cy="120" r="48" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
                <text x="120" y="115" textAnchor="middle" style={{ fontSize: '0.8rem', fontWeight: 900, fill: '#0f172a' }}>
                  {periodStats.totalCancelledSlots}
                </text>
                <text x="120" y="132" textAnchor="middle" style={{ fontSize: '0.62rem', fontWeight: 700, fill: '#64748b', textTransform: 'uppercase' }}>
                  Annulations
                </text>
              </svg>
            </div>

            {/* Légende détaillée interactive */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {periodStats.cancellationReasonsBreakdown.map((item, idx) => {
                const isHovered = hoveredReasonIndex === idx;
                return (
                  <div
                    key={item.reason}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      background: isHovered ? '#f1f5f9' : '#f8fafc',
                      border: isHovered ? `1.5px solid ${item.info.color}` : '1px solid #e2e8f0',
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                    }}
                    onMouseEnter={() => setHoveredReasonIndex(idx)}
                    onMouseLeave={() => setHoveredReasonIndex(null)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '3px',
                          background: item.info.color,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '0.80rem', fontWeight: 700, color: '#0f172a' }}>
                        {item.info.icon} {item.info.label}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{ fontSize: '0.76rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
                        {item.count} séance{item.count > 1 ? 's' : ''}
                      </span>
                      <span style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 700, width: '42px', textAlign: 'right' }}>
                        ({Math.round(item.percentage)}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 5. SECTION 2 : OBSERVATOIRE DES ÉCARTS & CALIBRATION DU SPOT (POINT 2) */}
      <div
        className="card"
        style={{
          padding: '18px 20px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div>
            <div style={{ textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 800, color: '#0284c7', letterSpacing: '0.04em' }}>
              Point 2 · Observatoire Physique & Calibration
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
              🌊 Écarts Théorie vs Réel sur les Hauteurs d'Eau & Surcotes
            </h3>
            <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
              Croisement des relevés terrain avec la pression atmosphérique (règle barométrique), le vent de mer et la houle.
            </div>
          </div>

          <button
            type="button"
            className="fbtn"
            onClick={handleOpenNewObservation}
            style={{
              margin: 0,
              padding: '6px 12px',
              fontSize: '0.76rem',
              fontWeight: 800,
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            + Noter un relevé
          </button>
        </div>

        {/* Synthèse de calibration automatique */}
        <div
          style={{
            background: '#f0fdf4',
            border: '1.5px solid #86efac',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#166534' }}>
              💡 Calibration estimée du spot (Lestrevet)
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
              Seuil effectif moyen : <strong>{calibrationStats.suggestedThresholdM.toFixed(2)} m</strong> (nominal {settings.L.toFixed(2)} m)
            </div>
            <div style={{ fontSize: '0.72rem', color: '#334155', marginTop: '2px' }}>
              Surcote moyenne constatée : <strong>{calibrationStats.avgWaterDeltaCm > 0 ? `+${calibrationStats.avgWaterDeltaCm}` : calibrationStats.avgWaterDeltaCm} cm</strong> ({calibrationStats.totalLogged} relevés)
            </div>
          </div>

          <div style={{ fontSize: '0.72rem', color: '#166534', borderLeft: '2px solid #86efac', paddingLeft: '12px' }}>
            <div>
              • <strong>Basse pression (&lt; 1005 hPa)</strong> : surcote moy. <strong>{calibrationStats.pressureCorrelation.lowPressureAvgDeltaCm > 0 ? `+${calibrationStats.pressureCorrelation.lowPressureAvgDeltaCm}` : calibrationStats.pressureCorrelation.lowPressureAvgDeltaCm} cm</strong>
            </div>
            <div style={{ marginTop: '2px' }}>
              • <strong>Vents d'Ouest (portant mer)</strong> : surcote moy. <strong>{calibrationStats.windDirCorrelation.westSectorAvgDeltaCm > 0 ? `+${calibrationStats.windDirCorrelation.westSectorAvgDeltaCm}` : calibrationStats.windDirCorrelation.westSectorAvgDeltaCm} cm</strong>
            </div>
            <div style={{ marginTop: '2px' }}>
              • <strong>Décalage moyen au roulage</strong> : <strong>{calibrationStats.avgTimeDeltaMin > 0 ? `+${calibrationStats.avgTimeDeltaMin} min` : `${calibrationStats.avgTimeDeltaMin} min`}</strong>
            </div>
          </div>
        </div>

        {/* Graphique de Corrélation SVG (Scatter plot Surcote vs Pression) */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase' }}>
              📈 Corrélation : Surcote constatée (cm) vs Pression Atmosphérique (hPa)
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
              Ligne rouge = règle théorique (+1 cm / hPa sous 1013)
            </span>
          </div>

          <div style={{ width: '100%', height: '180px', position: 'relative', overflow: 'hidden' }}>
            <svg width="100%" height="180" viewBox="0 0 500 180" preserveAspectRatio="none">
              {/* Grille de fond */}
              <line x1="50" y1="20" x2="480" y2="20" stroke="#e2e8f0" strokeDasharray="3 3" />
              <line x1="50" y1="65" x2="480" y2="65" stroke="#e2e8f0" strokeDasharray="3 3" />
              <line x1="50" y1="110" x2="480" y2="110" stroke="#94a3b8" strokeWidth="1.5" /> {/* Ligne zéro */}
              <line x1="50" y1="155" x2="480" y2="155" stroke="#e2e8f0" strokeDasharray="3 3" />

              {/* Axes Labels */}
              <text x="45" y="24" textAnchor="end" style={{ fontSize: '9px', fill: '#64748b' }}>+30cm</text>
              <text x="45" y="69" textAnchor="end" style={{ fontSize: '9px', fill: '#64748b' }}>+15cm</text>
              <text x="45" y="114" textAnchor="end" style={{ fontSize: '9px', fill: '#0f172a', fontWeight: 800 }}>0 cm</text>
              <text x="45" y="159" textAnchor="end" style={{ fontSize: '9px', fill: '#64748b' }}>-15cm</text>

              {/* Axe Pression (X de 980 hPa à 1030 hPa) */}
              <text x="50" y="175" textAnchor="start" style={{ fontSize: '9px', fill: '#64748b' }}>980 hPa</text>
              <text x="265" y="175" textAnchor="middle" style={{ fontSize: '9px', fill: '#64748b' }}>1005 hPa</text>
              <text x="350" y="175" textAnchor="middle" style={{ fontSize: '9px', fill: '#0f172a', fontWeight: 800 }}>1013 hPa</text>
              <text x="480" y="175" textAnchor="end" style={{ fontSize: '9px', fill: '#64748b' }}>1030 hPa</text>

              {/* Ligne théorique barométrique (1013 hPa -> 0 cm, 993 hPa -> +20 cm, 1023 hPa -> -10 cm) */}
              {/* X: 980 -> 50, 1030 -> 480. Delta X = 430 pour 50 hPa, soit 8.6 px/hPa */}
              {/* Y: 0cm -> 110. Delta Y = 3 px/cm */}
              <line
                x1={50 + (990 - 980) * 8.6}
                y1={110 - (1013 - 990) * 3}
                x2={50 + (1025 - 980) * 8.6}
                y2={110 - (1013 - 1025) * 3}
                stroke="#dc2626"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />

              {/* Points réels observés */}
              {observations
                .filter(o => o.waterDeltaCm != null && o.observedPressure != null)
                .map((o, idx) => {
                  const p = Math.max(980, Math.min(1030, o.observedPressure!));
                  const delta = Math.max(-20, Math.min(40, o.waterDeltaCm!));

                  const px = 50 + (p - 980) * 8.6;
                  const py = 110 - delta * 3;

                  const isWest = o.observedWindDir?.toUpperCase().includes('O') || o.observedWindDir?.toUpperCase().includes('W');

                  return (
                    <g key={o.id || idx}>
                      <circle
                        cx={px}
                        cy={py}
                        r="5.5"
                        fill={isWest ? '#0284c7' : '#f97316'}
                        stroke="#fff"
                        strokeWidth="1.5"
                        style={{ cursor: 'pointer' }}
                      >
                        <title>{`${o.ds} (${o.slotStart}) : Pression ${p} hPa, Surcote ${delta > 0 ? '+' : ''}${delta} cm, Vent ${o.observedWindKts || 0} nds ${o.observedWindDir || ''}`}</title>
                      </circle>
                    </g>
                  );
                })}
            </svg>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '6px', fontSize: '0.68rem', color: '#64748b' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0284c7', display: 'inline-block' }} />
              Vent portant de mer (Ouest / SO / NO)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
              Vent de terre (Est / NE / SE)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '14px', height: '2px', background: '#dc2626', display: 'inline-block' }} />
              Règle théorique (+1 cm / hPa)
            </span>
          </div>
        </div>

        {/* Tableau des relevés réels enregistrés */}
        <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <span>📋 Carnet de bord des relevés terrain ({observations.length} entrées)</span>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Cliquez sur une ligne pour modifier</span>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '340px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.70rem', background: '#fff', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', color: '#475569', fontSize: '0.64rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '6px 8px' }}>Date</th>
                  <th style={{ padding: '6px 8px' }}>Séance</th>
                  <th style={{ padding: '6px 8px' }}>Statut</th>
                  <th style={{ padding: '6px 8px' }}>Écart Roulage</th>
                  <th style={{ padding: '6px 8px' }}>Surcote (cm)</th>
                  <th style={{ padding: '6px 8px' }}>Pression</th>
                  <th style={{ padding: '6px 8px' }}>Vent & Houle</th>
                  <th style={{ padding: '6px 8px' }}>Plage</th>
                  <th style={{ padding: '6px 8px' }}>Commentaire</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {observations.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: '32px 16px', textAlign: 'center', color: '#64748b' }}>
                      <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>📝</div>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem', marginBottom: '4px' }}>
                        Carnet de relevés vierge (prêt pour la saison)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', maxWidth: '520px', margin: '0 auto', lineHeight: 1.5 }}>
                        Aucun relevé terrain enregistré pour le moment.
                        <br />
                        Pour enregistrer une observation de marée (hauteur d'eau, surcote, vent) ou une cause d’annulation, cliquez sur le bouton bleu « <strong>+ Noter un relevé terrain</strong> » ci-dessus ou sur « <strong>📝 Relevé</strong> » directement depuis le planning.
                      </div>
                    </td>
                  </tr>
                ) : (
                  observations.map((obs, idx) => {
                    const isRealized = obs.status === 'realized';
                    return (
                      <tr
                        key={obs.id || idx}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: idx % 2 === 0 ? '#fff' : '#fcfcfc',
                          cursor: 'pointer',
                        }}
                        onClick={() => handleEditObservation(obs)}
                      >
                        <td style={{ padding: '6px 8px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                          {obs.ds}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {obs.slotStart}–{obs.slotEnd} {obs.customTitle ? `(${obs.customTitle})` : ''}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {isRealized ? (
                            <span style={{ color: '#166534', fontWeight: 800 }}>✓ Réalisée</span>
                          ) : (
                            <span style={{ color: '#b91c1c', fontWeight: 800 }}>
                              ⛔ {obs.cancellationReason ? CANCELLATION_REASONS_INFO[obs.cancellationReason]?.shortLabel : 'Annulée'}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {obs.timeDeltaMin != null ? (
                            <strong style={{ color: obs.timeDeltaMin < 0 ? '#0284c7' : obs.timeDeltaMin > 0 ? '#dc2626' : '#64748b' }}>
                              {obs.timeDeltaMin > 0 ? `+${obs.timeDeltaMin} min` : `${obs.timeDeltaMin} min`}
                            </strong>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {obs.waterDeltaCm != null ? (
                            <strong style={{ color: obs.waterDeltaCm > 0 ? '#0284c7' : '#166534' }}>
                              {obs.waterDeltaCm > 0 ? `+${obs.waterDeltaCm} cm` : `${obs.waterDeltaCm} cm`}
                            </strong>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {obs.observedPressure ? `${obs.observedPressure} hPa` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {obs.observedWindKts ? `${obs.observedWindKts} nds ${obs.observedWindDir || ''}` : '—'}
                          {obs.observedWaveH ? ` · ${obs.observedWaveH}m` : ''}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#475569', fontSize: '0.66rem' }}>
                          {obs.beachCondition === 'dur' ? 'Sable dur' : obs.beachCondition === 'mou' ? 'Sable mou' : obs.beachCondition ? 'Bâches' : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#64748b', fontSize: '0.66rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={obs.notes || obs.cancellationNote}>
                          {obs.notes || obs.cancellationNote || '—'}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditObservation(obs);
                            }}
                            style={{
                              background: '#e0f2fe',
                              border: 'none',
                              color: '#0369a1',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Éditer
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL DE SAISIE / ÉDITION D'OBSERVATION */}
      {modalOpen && (
        <SlotObservationModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          dateStr={editingObservation?.ds || selectedDate}
          slotKey={editingObservation?.slotKey || 's0'}
          slotStart={editingObservation?.slotStart || '10:00'}
          slotEnd={editingObservation?.slotEnd || '11:00'}
          slotTitle={editingObservation?.customTitle}
          isCustom={editingObservation?.isCustom}
          initialObservation={editingObservation}
          onSaveSuccess={updated => setObservations(updated)}
        />
      )}
    </div>
  );
};
