import React, { useEffect, useMemo, useState } from 'react';
import { AppSettings, GpsWaterlineLog, TidePoint, WindPoint } from '../types';
import { getActiveInstructor } from '../utils/firebaseSync';
import {
  addWaterlineGpsLogToFirestore,
  deleteWaterlineGpsLogFromFirestore,
  subscribeToWaterlineGpsLogs,
} from '../utils/firebaseSync';
import {
  buildWaterlineSnapshot,
  exportWaterlineLogsAsCsv,
  getStoredWaterlineLogs,
  requestHighAccuracyGps,
  saveStoredWaterlineLogs,
} from '../utils/waterlineGpsEngine';

interface GpsWaterlineTabProps {
  settings: AppSettings;
  EX: TidePoint[];
  windList: WindPoint[];
  selectedDate: string;
  isReadOnly?: boolean;
}

export const GpsWaterlineTab: React.FC<GpsWaterlineTabProps> = ({
  settings,
  EX,
  windList,
  selectedDate,
  isReadOnly = false,
}) => {
  const [logs, setLogs] = useState<GpsWaterlineLog[]>(() => getStoredWaterlineLogs());
  const [author, setAuthor] = useState<string>(() => getActiveInstructor());
  const [beachState, setBeachState] = useState<GpsWaterlineLog['beachState']>('dur');
  const [quickNote, setQuickNote] = useState<string>('');
  
  // États de capture
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [captureStatus, setCaptureStatus] = useState<string>('');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lastLoggedItem, setLastLoggedItem] = useState<GpsWaterlineLog | null>(null);

  // Filtre d'affichage
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'month'>('all');

  // Synchronisation temps réel Firestore
  useEffect(() => {
    const unsubscribe = subscribeToWaterlineGpsLogs(
      remoteLogs => {
        setLogs(remoteLogs);
        saveStoredWaterlineLogs(remoteLogs);
      },
      err => {
        console.warn('Mode hors ligne ou local pour logs GPS:', err);
      }
    );
    return () => unsubscribe();
  }, []);

  // Déclencheur du relevé terrain
  const handleCaptureNow = async () => {
    if (isReadOnly) {
      alert('Mode consultation active : vous ne pouvez pas enregistrer de relevé.');
      return;
    }

    setIsCapturing(true);
    setCaptureError(null);
    setCaptureStatus('🛰️ Acquisition des signaux satellites GPS (haute précision en cours)...');

    try {
      // 1. Capture haute précision
      const gpsResult = await requestHighAccuracyGps();

      setCaptureStatus('⚡ Capture instantanée des flux météo AROME & calcul hydrodynamique...');

      // 2. Calcul du snapshot
      const snapshot = buildWaterlineSnapshot(
        gpsResult,
        author,
        settings,
        EX,
        windList,
        beachState,
        quickNote.trim() || undefined
      );

      // 3. Enregistrement Firestore
      const newId = await addWaterlineGpsLogToFirestore(snapshot);
      const fullLog: GpsWaterlineLog = {
        ...snapshot,
        id: newId,
      };

      setLastLoggedItem(fullLog);
      setQuickNote('');
      setCaptureStatus('✓ Relevé GPS enregistré avec succès !');
      setTimeout(() => setCaptureStatus(''), 4000);
    } catch (err: any) {
      console.error('Erreur capture GPS:', err);
      setCaptureError(err?.message || 'Erreur inattendue lors de la mesure GPS.');
      setCaptureStatus('');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    if (isReadOnly) return;
    if (!window.confirm('Supprimer définitivement ce point de relevé GPS ?')) return;
    try {
      await deleteWaterlineGpsLogFromFirestore(id);
      if (lastLoggedItem?.id === id) setLastLoggedItem(null);
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  const handleExportCsv = () => {
    if (logs.length === 0) {
      alert('Aucun relevé GPS à exporter pour le moment.');
      return;
    }
    const csv = exportWaterlineLogsAsCsv(logs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `releves_gps_limite_roulage_lestrevet_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Filtrage des logs
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMonthStr = useMemo(() => todayStr.slice(0, 7), [todayStr]);

  const filteredLogs = useMemo(() => {
    if (filterPeriod === 'today') return logs.filter(l => l.dateStr === todayStr);
    if (filterPeriod === 'month') return logs.filter(l => l.dateStr.startsWith(currentMonthStr));
    return logs;
  }, [logs, filterPeriod, todayStr, currentMonthStr]);

  // Statistiques synthétiques
  const stats = useMemo(() => {
    if (filteredLogs.length === 0) {
      return { count: 0, avgAccuracy: 0, avgRawSurcote: 0, avgCorrSurcote: 0 };
    }
    const total = filteredLogs.length;
    const sumAcc = filteredLogs.reduce((acc, l) => acc + l.accuracyM, 0);
    const sumRaw = filteredLogs.reduce((acc, l) => acc + l.rawSurcoteCm, 0);
    const sumCorr = filteredLogs.reduce((acc, l) => acc + l.correctedSurcoteCm, 0);

    return {
      count: total,
      avgAccuracy: Math.round((sumAcc / total) * 10) / 10,
      avgRawSurcote: Math.round(sumRaw / total),
      avgCorrSurcote: Math.round(sumCorr / total),
    };
  }, [filteredLogs]);

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '8px 12px 60px' }}>
      {/* En-tête */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
          color: '#ffffff',
          padding: '20px 22px',
          borderRadius: '12px',
          marginBottom: '16px',
          boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.8rem' }}>📍</span>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
                  Étalonnage GPS & Limite Basse de Roulage
                </h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', opacity: 0.92, lineHeight: 1.4 }}>
                  Observatoire terrain en direct à Pentrez / Lestrevet · 3 à 5 relevés par jour au contact de l'eau pour confronter le modèle SHOM et AROME à la réalité de la plage.
                </p>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.74rem', opacity: 0.9 }}>Pilote actif :</span>
            <select
              value={author}
              onChange={e => setAuthor(e.target.value)}
              disabled={isReadOnly}
              style={{
                background: '#ffffff',
                color: '#0f172a',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.78rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              <option value="Jérôme">Jérôme (Titulaire)</option>
              <option value="Benoît">Benoît</option>
            </select>
          </div>
        </div>
      </div>

      {/* BOUTON D'ACTION PRINCIPAL : PRISE DE RELEVÉ EN 1 CLIC (OPTIMISÉ MOBILE / PLAGE) */}
      <div
        className="card"
        style={{
          background: '#ffffff',
          border: '2px solid #0284c7',
          borderRadius: '14px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 800, color: '#0369a1', letterSpacing: '0.05em', marginBottom: '8px' }}>
            🌊 Mesure terrain instantanée au bord du sable praticable
          </div>

          <p style={{ fontSize: '0.84rem', color: '#475569', margin: '0 0 16px', lineHeight: 1.45 }}>
            Rends-toi physiquement à la <strong>limite basse de roulage</strong> (front de l'eau). Appuie sur le bouton ci-dessous : ton smartphone fige automatiquement la position GPS haute précision, la météo AROME du moment et l'écart avec les modèles théoriques.
          </p>

          {/* Options rapides avant mesure */}
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>État sable :</span>
              {(['dur', 'mou', 'baches_faibles', 'baches_fortes'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setBeachState(st)}
                  style={{
                    border: beachState === st ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background: beachState === st ? '#e0f2fe' : '#f8fafc',
                    color: beachState === st ? '#0369a1' : '#475569',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.70rem',
                    fontWeight: beachState === st ? 800 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {st === 'dur' ? 'Sable dur' : st === 'mou' ? 'Sable mou' : st === 'baches_faibles' ? 'Bâches faibles' : 'Bâches profondes'}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Remarque libre (ex: Poste de secours, vent mollissant...)"
              value={quickNote}
              onChange={e => setQuickNote(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '0.75rem',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                width: '280px',
                maxWidth: '100%',
              }}
            />
          </div>

          {/* GROS BOUTON MOBILE */}
          <button
            type="button"
            disabled={isCapturing || isReadOnly}
            onClick={handleCaptureNow}
            style={{
              width: '100%',
              maxWidth: '480px',
              padding: '16px 24px',
              background: isCapturing ? '#94a3b8' : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontSize: '1.05rem',
              fontWeight: 900,
              letterSpacing: '0.02em',
              cursor: isCapturing || isReadOnly ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 18px rgba(2, 132, 199, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.15s ease-in-out',
            }}
          >
            {isCapturing ? (
              <>
                <span className="spinner" style={{ width: '18px', height: '18px', border: '3px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                <span>Acquisition satellites GPS en cours...</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '1.3rem' }}>📍</span>
                <span>TOP RELEVÉ LIMITE BASSE (EN DIRECT)</span>
              </>
            )}
          </button>

          {/* Retour de statut */}
          {captureStatus && (
            <div style={{ marginTop: '12px', fontSize: '0.82rem', fontWeight: 800, color: captureStatus.startsWith('✓') ? '#166534' : '#0284c7' }}>
              {captureStatus}
            </div>
          )}

          {captureError && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', fontSize: '0.80rem', textAlign: 'left' }}>
              ⚠️ <strong>Erreur GPS :</strong> {captureError}
              <div style={{ marginTop: '4px', fontSize: '0.72rem', color: '#b91c1c' }}>
                Astuce : Assurez-vous d'avoir accordé l'autorisation de géolocalisation dans le navigateur de votre smartphone et que le service GPS est bien activé.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CARTE RÉSULTAT DU DERNIER RELEVÉ (AFFICHAGE IMMÉDIAT) */}
      {lastLoggedItem && (
        <div
          className="card"
          style={{
            background: '#f0fdf4',
            border: '2px solid #22c55e',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '20px',
            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #bbf7d0', paddingBottom: '8px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🎯</span>
              <strong style={{ fontSize: '0.92rem', color: '#166534' }}>
                Dernier relevé enregistré : {lastLoggedItem.dateStr} à {lastLoggedItem.timeStr} ({lastLoggedItem.author})
              </strong>
            </div>
            <a
              href={`https://www.google.com/maps?q=${lastLoggedItem.latitude},${lastLoggedItem.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.74rem',
                fontWeight: 800,
                color: '#0369a1',
                textDecoration: 'none',
                background: '#ffffff',
                border: '1px solid #bae6fd',
                padding: '4px 8px',
                borderRadius: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              🗺️ Ouvrir sur Google Maps
            </a>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {/* Position GPS */}
            <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                🛰️ Position GPS Mesurée
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a', marginTop: '4px', fontFamily: 'monospace' }}>
                {lastLoggedItem.latitude.toFixed(5)}° N, {Math.abs(lastLoggedItem.longitude).toFixed(5)}° O
              </div>
              <div style={{ fontSize: '0.72rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: lastLoggedItem.accuracyQuality === 'high' ? '#22c55e' : lastLoggedItem.accuracyQuality === 'medium' ? '#f59e0b' : '#ef4444'
                }} />
                <span style={{ fontWeight: 700, color: lastLoggedItem.accuracyQuality === 'high' ? '#166534' : '#b45309' }}>
                  Précision : ± {lastLoggedItem.accuracyM} m ({lastLoggedItem.accuracyQuality === 'high' ? 'Excellente' : lastLoggedItem.accuracyQuality === 'medium' ? 'Moyenne' : 'Basse'})
                </span>
              </div>
            </div>

            {/* Météo capturée */}
            <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                💨 Météo AROME capturée à l'instant T
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                {lastLoggedItem.weatherSnapshot.windSpeedKts} nds (raf. {lastLoggedItem.weatherSnapshot.windGustKts}) {lastLoggedItem.weatherSnapshot.windDirectionComp}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
                Pression : <strong>{lastLoggedItem.weatherSnapshot.pressureHpa} hPa</strong>
                {lastLoggedItem.weatherSnapshot.waveHeightM != null && ` · Houle : ${lastLoggedItem.weatherSnapshot.waveHeightM}m`}
              </div>
            </div>

            {/* Comparaison Hydrodynamique */}
            <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                🌊 Modèle vs Réalité (Limite Basse)
              </div>
              <div style={{ fontSize: '0.74rem', color: '#334155', marginTop: '4px' }}>
                Théorique brut : <strong>{lastLoggedItem.theoreticalWaterHeightM} m</strong>
                <br />
                Modèle corrigé : <strong>{lastLoggedItem.correctedWaterHeightM} m</strong>
              </div>
              <div style={{ fontSize: '0.80rem', fontWeight: 900, color: lastLoggedItem.rawSurcoteCm > 0 ? '#0369a1' : '#166534', marginTop: '4px' }}>
                Surcote observée : {lastLoggedItem.rawSurcoteCm > 0 ? `+${lastLoggedItem.rawSurcoteCm}` : lastLoggedItem.rawSurcoteCm} cm
                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b', marginLeft: '6px' }}>
                  (Écart résiduel : {lastLoggedItem.correctedSurcoteCm > 0 ? `+${lastLoggedItem.correctedSurcoteCm}` : lastLoggedItem.correctedSurcoteCm} cm)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CARTES KPIS SYNTHÉTIQUES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div className="card" style={{ padding: '14px 16px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
            📍 Points GPS Enregistrés
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
            {stats.count}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#64748b', marginTop: '2px' }}>
            {filterPeriod === 'today' ? "Aujourd'hui" : filterPeriod === 'month' ? 'Ce mois' : 'Historique total'}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', background: '#ffffff', border: '1.5px solid #0284c7', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1' }}>
            🛰️ Précision Moyenne Capteur
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
            {stats.count > 0 ? `± ${stats.avgAccuracy} m` : '—'}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#0284c7', fontWeight: 700, marginTop: '2px' }}>
            {stats.avgAccuracy <= 5 && stats.count > 0 ? '✓ Niveau de fiabilité scientifique élevé' : 'Qualité terrain conforme'}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', background: '#ffffff', border: '1.5px solid #eab308', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#a16207' }}>
            🌊 Surcote Moyenne Constatée
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
            {stats.count > 0 ? `${stats.avgRawSurcote > 0 ? `+${stats.avgRawSurcote}` : stats.avgRawSurcote} cm` : '—'}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#854d0e', marginTop: '2px' }}>
            par rapport au SHOM astronomique pur
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', background: '#ffffff', border: '1.5px solid #10b981', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#047857' }}>
            🎯 Précision Modèle Corrigé École
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
            {stats.count > 0 ? `${stats.avgCorrSurcote > 0 ? `+${stats.avgCorrSurcote}` : stats.avgCorrSurcote} cm` : '—'}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#047857', fontWeight: 700, marginTop: '2px' }}>
            Écart moyen résiduel avec nos corrections (+1cm/hPa)
          </div>
        </div>
      </div>

      {/* TABLEAU DES RELEVÉS GPS AVEC FILTRES ET EXPORT */}
      <div className="card" style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 900, fontSize: '0.88rem', color: '#0f172a' }}>
              📋 Carnet des Relevés GPS Limite Basse ({filteredLogs.length})
            </span>
            <div style={{ display: 'inline-flex', background: '#e2e8f0', borderRadius: '6px', padding: '2px' }}>
              <button
                type="button"
                onClick={() => setFilterPeriod('all')}
                style={{
                  border: 'none',
                  background: filterPeriod === 'all' ? '#ffffff' : 'transparent',
                  color: filterPeriod === 'all' ? '#0f172a' : '#64748b',
                  fontWeight: filterPeriod === 'all' ? 800 : 600,
                  fontSize: '0.68rem',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Tous
              </button>
              <button
                type="button"
                onClick={() => setFilterPeriod('month')}
                style={{
                  border: 'none',
                  background: filterPeriod === 'month' ? '#ffffff' : 'transparent',
                  color: filterPeriod === 'month' ? '#0f172a' : '#64748b',
                  fontWeight: filterPeriod === 'month' ? 800 : 600,
                  fontSize: '0.68rem',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Ce mois
              </button>
              <button
                type="button"
                onClick={() => setFilterPeriod('today')}
                style={{
                  border: 'none',
                  background: filterPeriod === 'today' ? '#ffffff' : 'transparent',
                  color: filterPeriod === 'today' ? '#0f172a' : '#64748b',
                  fontWeight: filterPeriod === 'today' ? 800 : 600,
                  fontSize: '0.68rem',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Aujourd'hui
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            style={{
              padding: '6px 12px',
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.74rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>📥 Exporter Excel / CSV</span>
          </button>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '420px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#475569', fontSize: '0.66rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px' }}>Date & Heure</th>
                <th style={{ padding: '8px 10px' }}>Auteur</th>
                <th style={{ padding: '8px 10px' }}>Coordonnées GPS</th>
                <th style={{ padding: '8px 10px' }}>Précision</th>
                <th style={{ padding: '8px 10px' }}>Météo AROME capturée</th>
                <th style={{ padding: '8px 10px' }}>Modèle SHOM brut</th>
                <th style={{ padding: '8px 10px' }}>Modèle Corrigé</th>
                <th style={{ padding: '8px 10px' }}>Surcote réelle</th>
                <th style={{ padding: '8px 10px' }}>État & Notes</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📍</div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.90rem', marginBottom: '4px' }}>
                      Aucun relevé GPS pour cette période
                    </div>
                    <div style={{ fontSize: '0.75rem', maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                      Dès que Jérôme se rend sur la plage de Pentrez / Lestrevet à la limite basse de roulage, il lui suffit de cliquer sur le gros bouton bleu ci-dessus pour enregistrer le point en direct.
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log, idx) => (
                  <tr
                    key={log.id}
                    style={{
                      borderBottom: '1px solid #e2e8f0',
                      background: idx % 2 === 0 ? '#ffffff' : '#fcfcfc',
                    }}
                  >
                    <td style={{ padding: '8px 10px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {log.dateStr} à {log.timeStr}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#334155' }}>
                      {log.author}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      <a
                        href={`https://www.google.com/maps?q=${log.latitude},${log.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#0284c7', textDecoration: 'underline' }}
                        title="Ouvrir dans Google Maps"
                      >
                        {log.latitude.toFixed(5)}°, {log.longitude.toFixed(5)}°
                      </a>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          background: log.accuracyQuality === 'high' ? '#dcfce7' : log.accuracyQuality === 'medium' ? '#fef3c7' : '#fee2e2',
                          color: log.accuracyQuality === 'high' ? '#166534' : log.accuracyQuality === 'medium' ? '#92400e' : '#991b1b',
                        }}
                      >
                        ± {log.accuracyM} m
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#334155' }}>
                      <strong>{log.weatherSnapshot.windSpeedKts} nds</strong> ({log.weatherSnapshot.windDirectionComp}) · {log.weatherSnapshot.pressureHpa} hPa
                      {log.weatherSnapshot.waveHeightM != null ? ` · ${log.weatherSnapshot.waveHeightM}m` : ''}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#64748b' }}>
                      {log.theoreticalWaterHeightM} m
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#0369a1', fontWeight: 700 }}>
                      {log.correctedWaterHeightM} m
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: log.rawSurcoteCm > 0 ? '#0284c7' : '#166534' }}>
                        {log.rawSurcoteCm > 0 ? `+${log.rawSurcoteCm}` : log.rawSurcoteCm} cm
                      </strong>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#475569', fontSize: '0.68rem', maxWidth: '220px' }}>
                      {log.beachState === 'dur' ? 'Sable dur' : log.beachState === 'mou' ? 'Sable mou' : log.beachState ? 'Bâches' : ''}
                      {log.note ? ` · ${log.note}` : ''}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLog(log.id)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#94a3b8',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            padding: '2px 4px',
                          }}
                          title="Supprimer ce point GPS"
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
