import React, { useEffect, useMemo, useState } from 'react';
import { AppSettings, BeachCadreConfig, GpsWaterlineLog, TidePoint, WindPoint } from '../types';
import {
  deleteWaterlineGpsLogFromFirestore,
  getActiveInstructor,
  saveBeachCadreConfigToFirestore,
  subscribeToBeachCadreConfig,
  subscribeToWaterlineGpsLogs,
  upsertWaterlineGpsLogToFirestore,
} from '../utils/firebaseSync';
import {
  evaluatePointAgainstCadre,
  getStoredBeachCadreConfig,
  saveStoredBeachCadreConfig,
} from '../utils/beachCadreEngine';
import {
  buildWaterlineSnapshot,
  exportWaterlineLogsAsCsv,
  findRecentDuplicateGpsLog,
  getStoredWaterlineLogs,
  requestSmoothedHighAccuracyGps,
  saveStoredWaterlineLogs,
} from '../utils/waterlineGpsEngine';
import { BeachCadrePanel } from './BeachCadrePanel';
import { Litto3DBeachSection } from './Litto3DBeachSection';

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
  const [cadreConfig, setCadreConfig] = useState<BeachCadreConfig>(() => getStoredBeachCadreConfig());
  const [author, setAuthor] = useState<string>(() => getActiveInstructor());
  const [beachState, setBeachState] = useState<GpsWaterlineLog['beachState']>('dur');
  const [quickNote, setQuickNote] = useState<string>('');
  
  // États de capture
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [sampleProgress, setSampleProgress] = useState<{ current: number; total: number; lastAcc: number } | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string>('');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lastLoggedItem, setLastLoggedItem] = useState<GpsWaterlineLog | null>(null);

  // Filtre d'affichage
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'month'>('all');

  // Gamification Étape 2 : Objectif 300 mesures & Modèle Empirique
  const TARGET_MEASURES = 300;
  const [showCelebrationModal, setShowCelebrationModal] = useState<boolean>(false);
  const [isDemoUnlocked, setIsDemoUnlocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cv_demo_mode_reel_unlocked') === 'true';
    } catch {
      return false;
    }
  });

  const totalCount = logs.length;
  const isRealModeUnlocked = totalCount >= TARGET_MEASURES || isDemoUnlocked;
  const progressPercent = Math.min(100, Math.round((totalCount / TARGET_MEASURES) * 100));
  const remainingCount = Math.max(0, TARGET_MEASURES - totalCount);

  // Détection du cap des 300 mesures pour déclencher l'alerte festive
  useEffect(() => {
    if (totalCount >= TARGET_MEASURES) {
      const alreadyShown = localStorage.getItem('cv_300_celebration_shown');
      if (!alreadyShown) {
        setShowCelebrationModal(true);
      }
    }
  }, [totalCount]);

  const handleDismissCelebration = () => {
    setShowCelebrationModal(false);
    try {
      localStorage.setItem('cv_300_celebration_shown', 'true');
    } catch {
      // ignore
    }
  };

  const handleToggleDemoUnlock = () => {
    const next = !isDemoUnlocked;
    setIsDemoUnlocked(next);
    try {
      localStorage.setItem('cv_demo_mode_reel_unlocked', String(next));
    } catch {
      // ignore
    }
    if (next) {
      setShowCelebrationModal(true);
    }
  };

  // Synchronisation temps réel Firestore (logs mer + cadre terrain fixe)
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
    const unsubCadre = subscribeToBeachCadreConfig(
      remoteCadre => {
        setCadreConfig(remoteCadre);
      },
      err => {
        console.warn('Mode hors ligne ou local pour cadre terrain:', err);
      }
    );
    return () => {
      unsubscribe();
      unsubCadre();
    };
  }, []);

  const activeCadreProfile = cadreConfig.profiles[cadreConfig.activeProfile];

  const handleSaveCadreConfig = async (nextConfig: BeachCadreConfig) => {
    setCadreConfig(nextConfig);
    saveStoredBeachCadreConfig(nextConfig);
    await saveBeachCadreConfigToFirestore(nextConfig, author);
  };

  // Déclencheur du relevé terrain avec moyennage GPS 4 mesures et filtrage 15m
  const handleCaptureNow = async () => {
    if (isReadOnly) {
      alert('Mode consultation active : vous ne pouvez pas enregistrer de relevé.');
      return;
    }

    setIsCapturing(true);
    setCaptureError(null);
    setSampleProgress({ current: 1, total: 4, lastAcc: 0 });
    setCaptureStatus('🛰️ Stabilisation & lissage GPS en cours (4 lectures successives)...');

    try {
      // 1. Capture haute précision moyennée sur 4 lectures (filtre < 15m)
      const gpsResult = await requestSmoothedHighAccuracyGps(4, 600, (curr, tot, acc) => {
        setSampleProgress({ current: curr, total: tot, lastAcc: acc });
        setCaptureStatus(`🛰️ Échantillonnage GPS : mesure ${curr} sur ${tot} (précision : ${acc} m)...`);
      });

      setCaptureStatus('⚡ Capture instantanée des flux météo AROME & calcul hydrodynamique...');

      // 2. Calcul du snapshot (avec largeur depuis la dune si cadre étalonné)
      const snapshot = buildWaterlineSnapshot(
        gpsResult,
        author,
        settings,
        EX,
        windList,
        beachState,
        quickNote.trim() || undefined,
        activeCadreProfile
      );

      // 3. Détection intelligente anti-doublon (même auteur, même endroit < 25m, il y a moins de 60s)
      const recentDup = findRecentDuplicateGpsLog(
        gpsResult.latitude,
        gpsResult.longitude,
        author,
        logs,
        60
      );

      // 4. Enregistrement Firestore (mise à jour si doublon immédiat, sinon nouveau document)
      const { id: savedId, isUpdated } = await upsertWaterlineGpsLogToFirestore(
        snapshot,
        recentDup ? recentDup.id : undefined
      );

      const fullLog: GpsWaterlineLog = {
        ...snapshot,
        id: savedId,
      };

      setLastLoggedItem(fullLog);
      setQuickNote('');
      if (isUpdated) {
        setCaptureStatus(`🛡️ Relevé actualisé (anti-doublon 60s) · Précision lissée : ±${gpsResult.accuracyM} m`);
      } else {
        setCaptureStatus(`✓ Relevé fiabilisé enregistré (4 échantillons) · Précision : ±${gpsResult.accuracyM} m`);
      }
      setTimeout(() => setCaptureStatus(''), 6000);
    } catch (err: any) {
      console.error('Erreur capture GPS:', err);
      setCaptureError(err?.message || 'Erreur inattendue lors de la mesure GPS.');
      setCaptureStatus('');
    } finally {
      setIsCapturing(false);
      setSampleProgress(null);
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
    const csv = exportWaterlineLogsAsCsv(logs, activeCadreProfile);
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

          {/* ÉTAPE 2 : JAUGE DE PROGRESSION & GAMIFICATION (OBJECTIF 300 MESURES) */}
          <div
            style={{
              background: isRealModeUnlocked ? '#f0fdf4' : '#f8fafc',
              border: isRealModeUnlocked ? '1.5px solid #86efac' : '1.5px solid #cbd5e1',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '18px',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '1rem' }}>{isRealModeUnlocked ? '🏆' : '🎯'}</span>
                <span style={{ fontSize: '0.76rem', fontWeight: 900, textTransform: 'uppercase', color: isRealModeUnlocked ? '#15803d' : '#0369a1', letterSpacing: '0.03em' }}>
                  Progression vers le Mode Réel (Modèle Empirique)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
                  {totalCount} / {TARGET_MEASURES} ({progressPercent}%)
                </span>
                <button
                  type="button"
                  onClick={handleToggleDemoUnlock}
                  title="Simuler immédiatement le déblocage des 300 mesures pour tester l'alerte festive"
                  style={{
                    background: isDemoUnlocked ? '#fef3c7' : '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: isDemoUnlocked ? '#b45309' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {isDemoUnlocked ? '✓ Démo 300 active' : '⚡ Tester cap 300'}
                </button>
              </div>
            </div>

            {/* Barre de jauge horizontale */}
            <div style={{ width: '100%', height: '10px', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: isRealModeUnlocked
                    ? 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)'
                    : 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)',
                  borderRadius: '5px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>

            {/* Légende et statut */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.70rem' }}>
              {isRealModeUnlocked ? (
                <span style={{ color: '#166534', fontWeight: 800 }}>
                  ✨ <strong>Cap des 300 mesures franchi !</strong> L'option Mode Réel est déverrouillée.
                </span>
              ) : (
                <span style={{ color: '#64748b' }}>
                  🔒 <strong>Mode Théorique actif</strong> (seuil fixe ex: {settings.L} m) · Encore <strong>{remainingCount}</strong> relevés pour débloquer le Mode Réel.
                </span>
              )}
              <span style={{ color: '#0369a1', fontWeight: 700 }}>
                Objectif : 2 à 5 / jour
              </span>
            </div>
          </div>

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

          {/* Badge de réassurance anti-doublon */}
          <div style={{ marginTop: '10px', fontSize: '0.68rem', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
            <span>🛡️</span>
            <span>Sécurité anti-doublon active (60s) : actualise intelligemment la mesure si ré-appuyé au même endroit.</span>
          </div>

          {/* Jauge d'échantillonnage multi-mesures (Étape 1 Modèle Empirique) */}
          {sampleProgress && (
            <div
              style={{
                marginTop: '14px',
                background: '#f0f9ff',
                border: '1.5px solid #bae6fd',
                borderRadius: '10px',
                padding: '12px 14px',
                maxWidth: '480px',
                margin: '14px auto 0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1' }}>
                  📡 Moyennage anti-flottement : {sampleProgress.current} / {sampleProgress.total}
                </span>
                {sampleProgress.lastAcc > 0 && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      background: sampleProgress.lastAcc <= 5 ? '#dcfce7' : sampleProgress.lastAcc <= 15 ? '#fef3c7' : '#fee2e2',
                      color: sampleProgress.lastAcc <= 5 ? '#15803d' : sampleProgress.lastAcc <= 15 ? '#b45309' : '#b91c1c',
                      padding: '2px 8px',
                      borderRadius: '12px',
                    }}
                  >
                    Précision : ±{sampleProgress.lastAcc} m {sampleProgress.lastAcc <= 15 ? '✓' : '⚠️ >15m'}
                  </span>
                )}
              </div>

              {/* Barres d'échantillons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[1, 2, 3, 4].map(idx => {
                  const isDone = sampleProgress.current > idx || (sampleProgress.current === idx && sampleProgress.lastAcc > 0);
                  const isCurrent = sampleProgress.current === idx;
                  return (
                    <div
                      key={idx}
                      style={{
                        height: '8px',
                        borderRadius: '4px',
                        background: isDone ? '#0284c7' : isCurrent ? '#7dd3fc' : '#e2e8f0',
                        transition: 'all 0.3s ease',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ marginTop: '6px', fontSize: '0.66rem', color: '#64748b', textAlign: 'left' }}>
                3 à 5 lectures successives pour filtrer les décalages de satellites avant validation finale.
              </div>
            </div>
          )}

          {/* Retour de statut */}
          {captureStatus && !sampleProgress && (
            <div style={{ marginTop: '12px', fontSize: '0.82rem', fontWeight: 800, color: captureStatus.startsWith('✓') ? '#166534' : '#0284c7' }}>
              {captureStatus}
            </div>
          )}

          {captureError && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', fontSize: '0.80rem', textAlign: 'left' }}>
              ⚠️ <strong>Erreur GPS :</strong> {captureError}
              <div style={{ marginTop: '4px', fontSize: '0.72rem', color: '#b91c1c' }}>
                Astuce : Assurez-vous d'avoir accordé l'autorisation de géolocalisation dans le navigateur de votre smartphone et que le service GPS est bien activé face à la mer.
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
              {(() => {
                const dyn = evaluatePointAgainstCadre(lastLoggedItem.latitude, lastLoggedItem.longitude, activeCadreProfile);
                const wDune = dyn.widthFromDuneM ?? lastLoggedItem.measuredWidthFromDuneM;
                const latPct = dyn.lateralPosPct ?? lastLoggedItem.lateralPosPct;
                if (wDune == null) return null;
                return (
                  <div style={{ fontSize: '0.74rem', color: '#0f172a', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #e2e8f0' }}>
                    Largeur Dune → Mer : <strong>{wDune} m</strong>
                    {latPct != null && ` · Couloir : ${latPct}%`}
                  </div>
                );
              })()}
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

      {/* RÉFÉRENTIEL CADRE TERRAIN FIXE (DUNE + CÔTÉS GAUCHE/DROITE MAIRIE & JÉRÔME) */}
      <BeachCadrePanel
        config={cadreConfig}
        logs={logs}
        author={author}
        isReadOnly={isReadOnly}
        onSaveConfig={handleSaveCadreConfig}
      />

      {/* MODULE LITTO3D FINISTÈRE (IGN / SHOM) : COUPE 2D & LARGEUR DE ROULAGE (POINT 8) */}
      <div style={{ marginBottom: '20px' }}>
        <Litto3DBeachSection settings={settings} EX={EX} logs={logs} activeCadre={activeCadreProfile} />
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
                <th style={{ padding: '8px 10px' }}>Largeur Dune / Zone</th>
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
                  <td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
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
                filteredLogs.map((log, idx) => {
                  const dynEval = evaluatePointAgainstCadre(log.latitude, log.longitude, activeCadreProfile);
                  const widthDune = dynEval.widthFromDuneM ?? log.measuredWidthFromDuneM;
                  const latPct = dynEval.lateralPosPct ?? log.lateralPosPct;
                  const inZone = dynEval.isInsideZone ?? log.isInsideZone;

                  return (
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
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {widthDune != null ? (
                        <div>
                          <strong style={{ color: '#0f172a' }}>{widthDune} m</strong>
                          {latPct != null && (
                            <span style={{ fontSize: '0.66rem', color: inZone === false ? '#b45309' : '#15803d', marginLeft: '5px', fontWeight: 700 }}>
                              · {latPct}%{inZone === false ? ' (hors zone)' : ''}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>— (Dune requise)</span>
                      )}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALE FESTIVE DE DÉBLOCAGE DES 300 MESURES (ÉTAPE 2) */}
      {showCelebrationModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.82)',
            backdropFilter: 'blur(5px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            animation: 'fadeIn 0.25s ease',
          }}
          onClick={handleDismissCelebration}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              maxWidth: '520px',
              width: '100%',
              padding: '30px 24px',
              textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              border: '3px solid #ffc40d',
              position: 'relative',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Ruban décoratif fête */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '8px',
                background: 'linear-gradient(90deg, #ffc40d 0%, #10b981 33%, #0284c7 66%, #f59e0b 100%)',
              }}
            />

            <div style={{ fontSize: '3.5rem', marginBottom: '10px' }}>
              🎉 🏆 🌊
            </div>

            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 900, color: '#b45309', marginBottom: '4px' }}>
              CAP DES 300 MESURES FRANCHI !
            </div>

            <h2 style={{ margin: '0 0 14px', fontSize: '1.45rem', fontWeight: 900, color: '#0f172a', lineHeight: 1.25 }}>
              Félicitations Jérôme & Benoît !
            </h2>

            <div
              style={{
                background: '#fef3c7',
                border: '1.5px solid #fde68a',
                borderRadius: '12px',
                padding: '16px',
                fontSize: '1rem',
                fontWeight: 800,
                color: '#92400e',
                lineHeight: 1.45,
                marginBottom: '18px',
              }}
            >
              « Vous avez passé les 300 mesures ! Vous avez déverrouillé l'option Mode Réel !! Félicitations !!! »
            </div>

            <p style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
              Grâce à vos relevés constants sur la plage de Pentrez / Lestrevet, le modèle mathématique dispose désormais de données statistiques réelles suffisantes pour corriger les heures et seuils théoriques avec une précision millimétrique.
            </p>

            <button
              type="button"
              onClick={handleDismissCelebration}
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 28px',
                fontSize: '0.95rem',
                fontWeight: 900,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
              }}
            >
              🚀 Activer le Mode Réel & Continuer
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
