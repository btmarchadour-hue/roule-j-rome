import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  applyRealConditionsToLog,
  buildWaterlineSnapshot,
  calculateGpsDistanceM,
  computeGpsDiagnosticSummary,
  computeTideCycleAt,
  consolidateGpsLogWithRealData,
  convertBrestHeightToDouarnenezM,
  enqueueOfflineGpsLog,
  exportWaterlineLogsAsCsv,
  fetchRealConditionsAt,
  findRecentDuplicateGpsLog,
  getOfflineGpsQueue,
  getStoredWaterlineLogs,
  GPS_DIAGNOSTIC_THRESHOLD,
  GpsCaptureResult,
  GpsLiveProgress,
  mergeOfflineQueueWithLogs,
  removeOfflineGpsLog,
  requestSmoothedHighAccuracyGps,
  runGpsPrecisionDiagnostic,
  saveStoredWaterlineLogs,
} from '../utils/waterlineGpsEngine';
import {
  BAY_ZONES_META,
  BayZoneId,
  classifyBayZone,
  estimateLitto3dUsableWidthM,
  estimateLitto3dWaterlineXExactM,
  resolveTerrainDuneWidthM,
} from '../utils/beachOrientation';
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
  const [offlineQueue, setOfflineQueue] = useState<GpsWaterlineLog[]>(() => getOfflineGpsQueue());
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [cadreConfig, setCadreConfig] = useState<BeachCadreConfig>(() => getStoredBeachCadreConfig());
  const [author, setAuthor] = useState<string>(() => getActiveInstructor());
  const [beachState, setBeachState] = useState<GpsWaterlineLog['beachState']>('dur');
  const [quickNote, setQuickNote] = useState<string>('');
  
  // États de capture & consolidation réel H+2
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isTestingGps, setIsTestingGps] = useState<boolean>(false);
  const [liveProgress, setLiveProgress] = useState<GpsLiveProgress | null>(null);
  const [gpsTestResult, setGpsTestResult] = useState<GpsCaptureResult | null>(null);
  const [gpsTestRefPoint, setGpsTestRefPoint] = useState<GpsCaptureResult | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string>('');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lastLoggedItem, setLastLoggedItem] = useState<GpsWaterlineLog | null>(null);
  const [isConsolidating, setIsConsolidating] = useState<boolean>(false);
  const [consolidationFeedback, setConsolidationFeedback] = useState<string>('');
  const syncInFlightRef = useRef<boolean>(false);
  const gpsAbortRef = useRef<AbortController | null>(null);

  // Filtre d'affichage & tiroirs repliables
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'month'>('all');
  const [filterZone, setFilterZone] = useState<'all' | BayZoneId>('all');
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState<boolean>(false);

  const displayedLogs = useMemo(
    () => mergeOfflineQueueWithLogs(logs, offlineQueue),
    [logs, offlineQueue]
  );

  // Paliers de maturité empirique : Palier 1 (20 relevés = Diagnostic seuil Lestrevet) & Palier 2 (300 relevés = Modèle complet)
  const TARGET_MEASURES = 300;
  const [showCelebrationModal, setShowCelebrationModal] = useState<boolean>(false);

  const totalCount = displayedLogs.length;
  const isDiagnosticReady = totalCount >= GPS_DIAGNOSTIC_THRESHOLD;
  const isRealModeUnlocked = totalCount >= TARGET_MEASURES;
  const progressPercent = Math.min(100, Math.round((totalCount / TARGET_MEASURES) * 100));
  const remainingCount = Math.max(0, TARGET_MEASURES - totalCount);
  const pendingRealCount = useMemo(
    () =>
      displayedLogs.filter(
        l =>
          !l.offlineQueued &&
          l.consolidationStatus !== 'consolidated' &&
          Date.now() - l.timestamp <= 14 * 24 * 3600 * 1000
      ).length,
    [displayedLogs]
  );

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

  const syncOfflineAndConsolidatePending = useCallback(
    async (options?: { silent?: boolean; forceRefresh?: boolean }) => {
      if (syncInFlightRef.current || isReadOnly) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!options?.silent) {
          setConsolidationFeedback('📴 Hors-ligne : la synchronisation reprendra dès le retour du réseau.');
        }
        return;
      }

      syncInFlightRef.current = true;
      setIsConsolidating(true);
      if (!options?.silent) {
        setConsolidationFeedback('🔄 Synchronisation de la file plage & consolidation des capteurs réels...');
      }

      let syncedOfflineCount = 0;
      let consolidatedCount = 0;
      let backfilledTideCount = 0;

      try {
        // 1. Vider la file hors-ligne vers Firestore (+ récupération capteurs réels immédiate)
        const currentQueue = getOfflineGpsQueue();
        for (const qItem of currentQueue) {
          try {
            const { id: _oldOfflineId, offlineQueued: _oq, ...payloadBase } = qItem;
            const qCycle = computeTideCycleAt(qItem.timestamp, qItem.dateStr);
            let readyPayload: Omit<GpsWaterlineLog, 'id'> = {
              ...payloadBase,
              tideCoef: payloadBase.tideCoef ?? qCycle.coef ?? undefined,
              tideCycleLabel: payloadBase.tideCycleLabel ?? qCycle.label ?? undefined,
              tideDirection: payloadBase.tideDirection ?? qCycle.direction ?? undefined,
              tideMinutesSinceExtreme:
                payloadBase.tideMinutesSinceExtreme ?? qCycle.minutesSinceExtreme ?? undefined,
              consolidationStatus: 'pending_real',
            };
            const realData = await fetchRealConditionsAt(qItem.timestamp, Boolean(options?.forceRefresh));
            if (realData) {
              const applied = applyRealConditionsToLog(
                { ...readyPayload, id: qItem.id },
                realData
              );
              const { id: _appliedId, ...cleanApplied } = applied.updatedLog;
              readyPayload = cleanApplied;
            }
            await upsertWaterlineGpsLogToFirestore(readyPayload);
            const remaining = removeOfflineGpsLog(qItem.id);
            setOfflineQueue(remaining);
            syncedOfflineCount++;
          } catch {
            // Conserver dans la file hors-ligne si l'envoi échoue
          }
        }

        // 2. Consolider les relevés récents en attente (ex: après H+2 pour Winds-Up)
        const now = Date.now();
        const maxAgeMs = 14 * 24 * 3600 * 1000;
        const updatedDocIds = new Set<string>();
        const candidates = logs.filter(l => {
          if (l.consolidationStatus === 'consolidated') return false;
          const ageMs = now - l.timestamp;
          if (ageMs > maxAgeMs) return false;
          if (options?.silent) {
            // En auto : consolider si aucune donnée réelle encore présente ou si H+2 écoulé
            return !l.realWeatherSnapshot || ageMs >= 2 * 3600 * 1000;
          }
          return true;
        });

        const batch = candidates.slice(0, options?.silent ? 6 : 15);
        for (const item of batch) {
          const { updatedLog, changed } = await consolidateGpsLogWithRealData(
            item,
            Boolean(options?.forceRefresh)
          );
          if (changed) {
            const tc = computeTideCycleAt(updatedLog.timestamp, updatedLog.dateStr);
            const enrichedLog: GpsWaterlineLog = {
              ...updatedLog,
              tideCoef: updatedLog.tideCoef ?? tc.coef ?? undefined,
              tideCycleLabel: updatedLog.tideCycleLabel ?? tc.label ?? undefined,
              tideDirection: updatedLog.tideDirection ?? tc.direction ?? undefined,
              tideMinutesSinceExtreme:
                updatedLog.tideMinutesSinceExtreme ?? tc.minutesSinceExtreme ?? undefined,
            };
            const { id: docId, ...restPayload } = enrichedLog;
            await upsertWaterlineGpsLogToFirestore(restPayload, docId);
            updatedDocIds.add(docId);
            if (lastLoggedItem?.id === docId) {
              setLastLoggedItem(enrichedLog);
            }
            consolidatedCount++;
          }
        }

        // 2b. Rétroactivité Firestore : compléter Coef + BM+/HM+ sur les relevés déjà enregistrés
        const missingTideLogs = logs.filter(l => {
          if (updatedDocIds.has(l.id) || l.offlineQueued) return false;
          if (l.tideCoef != null && l.tideCycleLabel) return false;
          const tc = computeTideCycleAt(l.timestamp, l.dateStr);
          return tc.coef != null || tc.label != null;
        });
        for (const item of missingTideLogs.slice(0, 40)) {
          const tc = computeTideCycleAt(item.timestamp, item.dateStr);
          const enriched: GpsWaterlineLog = {
            ...item,
            tideCoef: item.tideCoef ?? tc.coef ?? undefined,
            tideCycleLabel: item.tideCycleLabel ?? tc.label ?? undefined,
            tideDirection: item.tideDirection ?? tc.direction ?? undefined,
            tideMinutesSinceExtreme:
              item.tideMinutesSinceExtreme ?? tc.minutesSinceExtreme ?? undefined,
          };
          const { id: docId, ...restPayload } = enriched;
          await upsertWaterlineGpsLogToFirestore(restPayload, docId);
          if (lastLoggedItem?.id === docId) {
            setLastLoggedItem(enriched);
          }
          backfilledTideCount++;
        }

        if (!options?.silent || syncedOfflineCount > 0 || consolidatedCount > 0 || backfilledTideCount > 0) {
          const parts: string[] = [];
          if (syncedOfflineCount > 0) parts.push(`${syncedOfflineCount} relevé(s) hors-ligne envoyé(s)`);
          if (consolidatedCount > 0) parts.push(`${consolidatedCount} relevé(s) consolidé(s) avec Winds-Up/METAR/SHOM`);
          if (backfilledTideCount > 0) {
            parts.push(`${backfilledTideCount} relevé(s) complété(s) rétroactivement (Coef & BM+/HM+)`);
          }
          setConsolidationFeedback(
            parts.length > 0
              ? `✓ ${parts.join(' · ')}`
              : '✓ Tous les relevés récents sont à jour (Winds-Up Spot 66 public disponible 2h après la prise).'
          );
        }
      } catch (err) {
        console.warn('Erreur consolidation réel GPS:', err);
        if (!options?.silent) {
          setConsolidationFeedback('⚠️ Certains capteurs réels n’ont pas répondu pour le moment.');
        }
      } finally {
        setIsConsolidating(false);
        syncInFlightRef.current = false;
      }
    },
    [isReadOnly, logs, lastLoggedItem]
  );

  // Écoute réseau (retour de connexion plage -> envoi auto + consolidation)
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void syncOfflineAndConsolidatePending({ silent: true });
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOfflineAndConsolidatePending]);

  // Passage automatique au chargement quand la liste Firestore est prête
  const initialAutoConsolidatedRef = useRef<boolean>(false);
  useEffect(() => {
    if (initialAutoConsolidatedRef.current) return;
    if (!isOnline || logs.length === 0) return;
    initialAutoConsolidatedRef.current = true;
    void syncOfflineAndConsolidatePending({ silent: true });
  }, [isOnline, logs.length, syncOfflineAndConsolidatePending]);

  const handleCancelGps = () => {
    gpsAbortRef.current?.abort();
    gpsAbortRef.current = null;
  };

  // Test de précision GPS (100 % local, aucune écriture en base)
  const handleRunGpsTest = async () => {
    if (isCapturing || isTestingGps) return;
    const controller = new AbortController();
    gpsAbortRef.current = controller;
    setIsTestingGps(true);
    setCaptureError(null);
    setCaptureStatus('');
    setLiveProgress({
      elapsedSec: 0,
      maxDurationSec: 15,
      rawCount: 0,
      validCount: 0,
      targetValidCount: 5,
      lastAccM: null,
      bestAccM: null,
      phase: 'warming',
      trajectoryAcc: [],
    });

    try {
      const result = await runGpsPrecisionDiagnostic(prog => {
        setLiveProgress(prog);
      }, controller.signal);
      setGpsTestResult(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur inattendue lors du test GPS.';
      if (!errMsg.includes('annulée')) {
        setCaptureError(errMsg);
      }
    } finally {
      gpsAbortRef.current = null;
      setIsTestingGps(false);
      setLiveProgress(null);
    }
  };

  // Déclencheur du relevé terrain avec flux continu watchPosition pondéré 1/σ², file hors-ligne plage & couche réelle
  const handleCaptureNow = async () => {
    if (isReadOnly) {
      setCaptureError('Mode consultation actif : vous pouvez utiliser « Tester le GPS » mais pas enregistrer de relevé.');
      return;
    }

    const controller = new AbortController();
    gpsAbortRef.current = controller;
    setIsCapturing(true);
    setCaptureError(null);
    setLiveProgress({
      elapsedSec: 0,
      maxDurationSec: 15,
      rawCount: 0,
      validCount: 0,
      targetValidCount: 4,
      lastAccM: null,
      bestAccM: null,
      phase: 'warming',
      trajectoryAcc: [],
    });
    setCaptureStatus('🛰️ Chauffe et convergence GPS en cours (flux continu watchPosition 1/σ²)...');

    try {
      // 1. Capture haute précision continue pondérée 1/σ² (filtre ≤ 15 m)
      const gpsResult = await requestSmoothedHighAccuracyGps(4, 600, undefined, {
        signal: controller.signal,
        onLiveProgress: prog => {
          setLiveProgress(prog);
          const accLabel = prog.lastAccM != null ? `±${prog.lastAccM} m` : 'recherche satellites…';
          setCaptureStatus(
            `🛰️ Convergence GPS (${prog.elapsedSec.toFixed(0)}s/${prog.maxDurationSec}s) · ${prog.validCount}/${prog.targetValidCount} lectures ≤ 15 m (${accLabel})`
          );
        },
      });

      setCaptureStatus('⚡ Capture AROME/SHOM & interro capteurs réels...');

      // 2. Calcul du snapshot théorique (toujours conservé intact)
      let snapshot: Omit<GpsWaterlineLog, 'id'> = buildWaterlineSnapshot(
        gpsResult,
        author,
        settings,
        EX,
        windList,
        beachState,
        quickNote.trim() || undefined,
        activeCadreProfile
      );

      // 3. Détection anti-doublon sur tous les relevés visibles (y compris file hors-ligne)
      const recentDup = findRecentDuplicateGpsLog(
        gpsResult.latitude,
        gpsResult.longitude,
        author,
        displayedLogs,
        60
      );

      // 4. Si hors-ligne sur la plage : stockage garanti dans la file locale immédiate
      const networkAvailable = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (!networkAvailable) {
        const queuedItem = enqueueOfflineGpsLog(
          snapshot,
          recentDup?.offlineQueued ? recentDup.id : undefined
        );
        setOfflineQueue(getOfflineGpsQueue());
        setLastLoggedItem(queuedItem);
        setQuickNote('');
        setCaptureStatus(
          `📴 Hors-ligne plage : relevé sauvegardé localement (±${gpsResult.accuracyM} m). Envoi & météo réelle auto dès le retour du réseau.`
        );
        setTimeout(() => setCaptureStatus(''), 8000);
        return;
      }

      // 5. En ligne : tenter de récupérer immédiatement METAR / SHOM Brest / Winds-Up si dispo
      const realData = await fetchRealConditionsAt(gpsResult.timestamp, false);
      if (realData) {
        const applied = applyRealConditionsToLog(
          { ...snapshot, id: 'tmp' },
          realData
        );
        const { id: _tmpId, ...cleanSnapshot } = applied.updatedLog;
        snapshot = cleanSnapshot;
      } else {
        snapshot = { ...snapshot, consolidationStatus: 'pending_real' };
      }

      // 6. Enregistrement Firestore avec repli automatique hors-ligne en cas de coupure réseau 4G sur la plage
      try {
        const { id: savedId, isUpdated } = await upsertWaterlineGpsLogToFirestore(
          snapshot,
          recentDup && !recentDup.offlineQueued ? recentDup.id : undefined
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
          setCaptureStatus(
            `✓ Relevé enregistré (±${gpsResult.accuracyM} m) · Couche réelle ${
              fullLog.consolidationStatus === 'consolidated' ? 'consolidée' : 'complétée à H+2'
            }`
          );
        }
        setTimeout(() => setCaptureStatus(''), 7000);
      } catch (writeErr) {
        console.warn('Échec réseau Firestore sur la plage, bascule file hors-ligne:', writeErr);
        const queuedItem = enqueueOfflineGpsLog(
          snapshot,
          recentDup?.offlineQueued ? recentDup.id : undefined
        );
        setOfflineQueue(getOfflineGpsQueue());
        setLastLoggedItem(queuedItem);
        setQuickNote('');
        setCaptureStatus(
          `📴 Réseau instable : relevé mis en file d'attente locale (±${gpsResult.accuracyM} m) pour envoi automatique.`
        );
        setTimeout(() => setCaptureStatus(''), 8000);
      }
    } catch (err: unknown) {
      console.error('Erreur capture GPS:', err);
      const errMsg = err instanceof Error ? err.message : 'Erreur inattendue lors de la mesure GPS.';
      if (!errMsg.includes('annulée')) {
        setCaptureError(errMsg);
      }
      setCaptureStatus('');
    } finally {
      gpsAbortRef.current = null;
      setIsCapturing(false);
      setLiveProgress(null);
    }
  };

  const handleDeleteLog = async (id: string) => {
    if (isReadOnly) return;
    if (!window.confirm('Supprimer définitivement ce point de relevé GPS ?')) return;
    if (id.startsWith('offline_')) {
      setOfflineQueue(removeOfflineGpsLog(id));
      if (lastLoggedItem?.id === id) setLastLoggedItem(null);
      return;
    }
    try {
      await deleteWaterlineGpsLogFromFirestore(id);
      if (lastLoggedItem?.id === id) setLastLoggedItem(null);
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  const handleExportCsv = () => {
    if (displayedLogs.length === 0) {
      alert('Aucun relevé GPS à exporter pour le moment.');
      return;
    }
    const csv = exportWaterlineLogsAsCsv(displayedLogs, activeCadreProfile);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `releves_gps_limite_roulage_lestrevet_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Filtrage des logs (période + zone de la baie)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMonthStr = useMemo(() => todayStr.slice(0, 7), [todayStr]);
  const softMarginM = activeCadreProfile?.softSandMarginM ?? 50;

  const logsWithZone = useMemo(() => {
    return displayedLogs.map(l => {
      const dyn = evaluatePointAgainstCadre(l.latitude, l.longitude, activeCadreProfile);
      const zone = classifyBayZone(l.latitude, l.longitude, dyn.lateralPosPct ?? l.lateralPosPct);
      const resolvedDune = resolveTerrainDuneWidthM(
        l.latitude,
        l.longitude,
        dyn.widthFromDuneM,
        l.measuredWidthFromDuneM
      );
      const rawWidth = resolvedDune.widthFromDuneM;
      const theoTotalX = Math.round(estimateLitto3dWaterlineXExactM(l.theoreticalWaterHeightM, zone.zoneId));
      const theoUsableM = Math.max(0, theoTotalX - softMarginM);
      const terrainUsableM = rawWidth != null ? Math.max(0, rawWidth - softMarginM) : null;
      const usableWidthM = terrainUsableM ?? theoUsableM;
      return {
        log: l,
        dyn,
        zone,
        rawWidth,
        widthSource: resolvedDune.source,
        theoTotalX,
        theoUsableM,
        terrainUsableM,
        usableWidthM,
        isEstimatedWidth: rawWidth == null,
      };
    });
  }, [displayedLogs, activeCadreProfile, softMarginM]);

  const zoneSummaries = useMemo(() => {
    const order: BayZoneId[] = ['lestrevet', 'lieue_de_greve', 'pentrez'];
    return order.map(zId => {
      const items = logsWithZone.filter(x => x.zone.zoneId === zId);
      const avgUsableM =
        items.length > 0
          ? Math.round(items.reduce((acc, x) => acc + x.usableWidthM, 0) / items.length)
          : null;
      return {
        meta: BAY_ZONES_META[zId],
        count: items.length,
        avgUsableM,
      };
    });
  }, [logsWithZone]);

  const filteredEntries = useMemo(() => {
    return logsWithZone.filter(item => {
      if (filterPeriod === 'today' && item.log.dateStr !== todayStr) return false;
      if (filterPeriod === 'month' && !item.log.dateStr.startsWith(currentMonthStr)) return false;
      if (filterZone !== 'all' && item.zone.zoneId !== filterZone) return false;
      return true;
    });
  }, [logsWithZone, filterPeriod, filterZone, todayStr, currentMonthStr]);

  const filteredLogs = useMemo(() => filteredEntries.map(e => e.log), [filteredEntries]);

  // Statistiques synthétiques
  const stats = useMemo(() => {
    if (filteredEntries.length === 0) {
      return {
        count: 0,
        avgAccuracy: 0,
        measuredCount: 0,
        avgDeltaVsTheoM: null as number | null,
        avgTerrainUsableM: null as number | null,
      };
    }
    const total = filteredEntries.length;
    const sumAcc = filteredEntries.reduce((acc, e) => acc + e.log.accuracyM, 0);
    const measured = filteredEntries.filter(e => e.terrainUsableM != null);
    const avgDeltaVsTheoM =
      measured.length > 0
        ? Math.round(
            measured.reduce((acc, e) => acc + ((e.terrainUsableM as number) - e.theoUsableM), 0) /
              measured.length
          )
        : null;
    const avgTerrainUsableM =
      measured.length > 0
        ? Math.round(
            measured.reduce((acc, e) => acc + (e.terrainUsableM as number), 0) / measured.length
          )
        : null;

    return {
      count: total,
      avgAccuracy: Math.round((sumAcc / total) * 10) / 10,
      measuredCount: measured.length,
      avgDeltaVsTheoM,
      avgTerrainUsableM,
    };
  }, [filteredEntries]);

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

          {/* ÉTAPE 2 : JAUGE DE PROGRESSION À 2 PALIERS (20 MESURES = DIAGNOSTIC · 300 = MODÈLE COMPLET) */}
          <div
            style={{
              background: isRealModeUnlocked ? '#f0fdf4' : isDiagnosticReady ? '#f0f9ff' : '#f8fafc',
              border: isRealModeUnlocked
                ? '1.5px solid #86efac'
                : isDiagnosticReady
                ? '1.5px solid #7dd3fc'
                : '1.5px solid #cbd5e1',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '18px',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '1rem' }}>{isRealModeUnlocked ? '🏆' : isDiagnosticReady ? '🔬' : '🎯'}</span>
                <span style={{ fontSize: '0.76rem', fontWeight: 900, textTransform: 'uppercase', color: isRealModeUnlocked ? '#15803d' : '#0369a1', letterSpacing: '0.03em' }}>
                  Avancement de l&apos;Étalonnage Plage (Paliers 20 &amp; 300)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: '10px',
                    background: isDiagnosticReady ? '#dcfce7' : '#e0f2fe',
                    color: isDiagnosticReady ? '#166534' : '#0369a1',
                  }}
                >
                  {isDiagnosticReady
                    ? `✓ Diagnostic 20 actif`
                    : `Palier 1 : ${totalCount}/${GPS_DIAGNOSTIC_THRESHOLD}`}
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
                  {totalCount} / {TARGET_MEASURES} ({progressPercent}%)
                </span>
              </div>
            </div>

            {/* Barre de jauge horizontale avec repère palier 20 */}
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
              <div
                title="Palier 1 : 20 relevés (Diagnostic seuil réel Lestrevet)"
                style={{
                  position: 'absolute',
                  left: `${(GPS_DIAGNOSTIC_THRESHOLD / TARGET_MEASURES) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: isDiagnosticReady ? '#16a34a' : '#f59e0b',
                }}
              />
            </div>

            {/* Légende et statut */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '6px', fontSize: '0.70rem' }}>
              {isRealModeUnlocked ? (
                <span style={{ color: '#166534', fontWeight: 800 }}>
                  ✨ <strong>Cap des 300 mesures franchi !</strong> Calibrage fin maximal du modèle empirique.
                </span>
              ) : isDiagnosticReady ? (
                <span style={{ color: '#0369a1', fontWeight: 700 }}>
                  🔬 <strong>Diagnostic 20 mesures actif</strong> · Modèle réel empirique calibré progressivement dès le 20/11/2026 ({remainingCount} relevés avant maturité complète 300).
                </span>
              ) : (
                <span style={{ color: '#64748b' }}>
                  ✨ <strong>Modèle réel empirique actif progressivement dès le 20/11/2026</strong> · Encore{' '}
                  <strong>{Math.max(0, GPS_DIAGNOSTIC_THRESHOLD - totalCount)}</strong> relevé{GPS_DIAGNOSTIC_THRESHOLD - totalCount > 1 ? 's' : ''} pour le <strong>Diagnostic seuil réel (20)</strong>.
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              disabled={isCapturing || isTestingGps || isReadOnly}
              onClick={handleCaptureNow}
              style={{
                width: '100%',
                maxWidth: '480px',
                padding: '16px 24px',
                background: isCapturing || isTestingGps ? '#94a3b8' : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1.05rem',
                fontWeight: 900,
                letterSpacing: '0.02em',
                cursor: isCapturing || isTestingGps || isReadOnly ? 'not-allowed' : 'pointer',
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
                  <span>Convergence satellites GPS en cours...</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '1.3rem' }}>📍</span>
                  <span>TOP RELEVÉ LIMITE BASSE (EN DIRECT)</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={isCapturing || isTestingGps}
              onClick={handleRunGpsTest}
              style={{
                padding: '7px 14px',
                background: '#f8fafc',
                color: '#0369a1',
                border: '1.5px solid #bae6fd',
                borderRadius: '8px',
                fontSize: '0.76rem',
                fontWeight: 800,
                cursor: isCapturing || isTestingGps ? 'not-allowed' : 'pointer',
                opacity: isCapturing || isTestingGps ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>🧪</span>
              <span>{isTestingGps ? 'Test de précision GPS en cours...' : 'Tester mon GPS (sans enregistrer)'}</span>
            </button>
          </div>

          {/* Badge de réassurance anti-doublon + statut réseau & file plage */}
          <div style={{ marginTop: '10px', fontSize: '0.68rem', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span>🛡️ Anti-doublon 60s</span>
            <span>·</span>
            <span>🛰️ Flux continu 1/σ²</span>
            <span>·</span>
            <span style={{ color: isOnline ? '#15803d' : '#b45309', fontWeight: 700 }}>
              {isOnline ? '📶 Réseau actif' : '📴 Mode hors-ligne plage (file locale garantie)'}
            </span>
            {offlineQueue.length > 0 && (
              <span
                style={{
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #fcd34d',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontWeight: 800,
                }}
              >
                ⏳ {offlineQueue.length} point{offlineQueue.length > 1 ? 's' : ''} en attente d&apos;envoi
              </span>
            )}
          </div>

          {/* Jauge de convergence GNSS continue (watchPosition 1/σ²) */}
          {liveProgress && (
            <div
              style={{
                background: '#f0f9ff',
                border: '1.5px solid #bae6fd',
                borderRadius: '10px',
                padding: '12px 14px',
                maxWidth: '480px',
                margin: '14px auto 0',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1' }}>
                  📡 {isTestingGps ? 'Test GPS' : 'Acquisition GPS'} · {liveProgress.validCount}/{liveProgress.targetValidCount} mesures ≤ 15 m ({Math.floor(liveProgress.elapsedSec)}s / {liveProgress.maxDurationSec}s)
                </span>
                <button
                  type="button"
                  onClick={handleCancelGps}
                  style={{
                    background: '#ffffff',
                    color: '#64748b',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '2px 8px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
              </div>

              {/* Barre temps + lectures valides */}
              <div style={{ height: '8px', borderRadius: '4px', background: '#e2e8f0', overflow: 'hidden', marginBottom: '8px' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(
                      100,
                      Math.max(
                        (liveProgress.elapsedSec / Math.max(1, liveProgress.maxDurationSec)) * 100,
                        (liveProgress.validCount / Math.max(1, liveProgress.targetValidCount)) * 100
                      )
                    )}%`,
                    background: liveProgress.bestAccM != null && liveProgress.bestAccM <= 15 ? '#0284c7' : '#f59e0b',
                    transition: 'width 0.35s ease',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '0.7rem' }}>
                <span style={{ color: '#334155', fontWeight: 700 }}>
                  {liveProgress.trajectoryAcc.length > 0
                    ? `Convergence : ${liveProgress.trajectoryAcc.map(a => `±${a}m`).join(' → ')}`
                    : 'Chauffe puce GPS / accrochage satellites...'}
                </span>
                {liveProgress.bestAccM != null && (
                  <span
                    style={{
                      fontWeight: 800,
                      background: liveProgress.bestAccM <= 5 ? '#dcfce7' : liveProgress.bestAccM <= 15 ? '#fef3c7' : '#fee2e2',
                      color: liveProgress.bestAccM <= 5 ? '#15803d' : liveProgress.bestAccM <= 15 ? '#b45309' : '#b91c1c',
                      padding: '2px 8px',
                      borderRadius: '12px',
                    }}
                  >
                    Meilleure : ±{liveProgress.bestAccM} m {liveProgress.bestAccM <= 15 ? '✓' : '(attente < 15 m)'}
                  </span>
                )}
              </div>
              <div style={{ marginTop: '6px', fontSize: '0.66rem', color: '#64748b' }}>
                Restez immobile 5 à 12 s à ciel ouvert : la puce GPS affine le signal et pondère automatiquement les mesures les plus précises (1/σ²).
              </div>
            </div>
          )}

          {/* Carte de résultat du Test de précision GPS (100 % local, aucune écriture en base) */}
          {gpsTestResult && !liveProgress && (() => {
            const isGood = gpsTestResult.accuracyM <= 8;
            const isOk = gpsTestResult.accuracyM <= 15;
            const waterEquivCm = Number(((gpsTestResult.spreadM ?? gpsTestResult.accuracyM) * 1.15).toFixed(1));
            const repeatDistM = gpsTestRefPoint
              ? Number(
                  calculateGpsDistanceM(
                    gpsTestRefPoint.latitude,
                    gpsTestRefPoint.longitude,
                    gpsTestResult.latitude,
                    gpsTestResult.longitude
                  ).toFixed(1)
                )
              : null;
            return (
              <div
                style={{
                  maxWidth: '520px',
                  margin: '14px auto 0',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  textAlign: 'left',
                  background: isGood ? '#f0fdf4' : isOk ? '#fffbeb' : '#fef2f2',
                  border: `1.5px solid ${isGood ? '#86efac' : isOk ? '#fcd34d' : '#fca5a5'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '0.82rem', color: isGood ? '#166534' : isOk ? '#92400e' : '#991b1b' }}>
                    {isGood
                      ? `✅ Test GPS excellent : ±${gpsTestResult.accuracyM} m (prêt pour la plage)`
                      : isOk
                      ? `⚠️ Test GPS exploitable : ±${gpsTestResult.accuracyM} m (seuil ≤ 15 m atteint)`
                      : `❌ Test GPS insuffisant : ±${gpsTestResult.accuracyM} m (seuil plage ≤ 15 m)`}
                  </strong>
                  <button
                    type="button"
                    onClick={() => setGpsTestResult(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#64748b',
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                    title="Fermer le résultat du test"
                  >
                    ✕
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px', fontSize: '0.72rem', color: '#334155', marginBottom: '8px' }}>
                  <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 700 }}>PRÉCISION PONDÉRÉE</div>
                    <strong style={{ fontSize: '0.82rem' }}>±{gpsTestResult.accuracyM} m</strong>
                  </div>
                  <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 700 }}>DISPERSION RÉELLE</div>
                    <strong style={{ fontSize: '0.82rem' }}>{gpsTestResult.spreadM ?? 0} m</strong>
                    <span style={{ color: '#64748b' }}> (~{waterEquivCm} cm eau)</span>
                  </div>
                  <div style={{ background: '#ffffff', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 700 }}>MESURES / DURÉE</div>
                    <strong style={{ fontSize: '0.82rem' }}>
                      {gpsTestResult.samplesUsed ?? 1}/{gpsTestResult.rawSamples ?? 1} · {gpsTestResult.durationSec ?? 0}s
                    </strong>
                  </div>
                </div>

                {gpsTestResult.trajectoryAcc && gpsTestResult.trajectoryAcc.length > 0 && (
                  <div style={{ fontSize: '0.7rem', color: '#475569', marginBottom: '6px' }}>
                    <strong>Convergence observée :</strong> {gpsTestResult.trajectoryAcc.map(a => `±${a} m`).join(' → ')}
                  </div>
                )}

                {repeatDistM !== null && (
                  <div
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #93c5fd',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      fontSize: '0.72rem',
                      color: '#1e3a8a',
                      fontWeight: 700,
                      marginBottom: '6px',
                    }}
                  >
                    📐 Comparaison avec Repère A : <strong>{repeatDistM} m d&apos;écart réel</strong> (≈ {(repeatDistM * 1.15).toFixed(1)} cm de hauteur d&apos;eau à pente 1,15 %).
                  </div>
                )}

                {!isOk && (
                  <div style={{ fontSize: '0.7rem', color: '#991b1b', marginBottom: '6px' }}>
                    Vérifiez que vous êtes bien <strong>à ciel ouvert</strong> (pas en intérieur) et sur iPhone que <strong>Réglages → Confidentialité → Service de localisation → Safari → Position exacte</strong> est activée.
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setGpsTestRefPoint(gpsTestResult)}
                    style={{
                      background: '#ffffff',
                      color: '#0369a1',
                      border: '1px solid #7dd3fc',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {gpsTestRefPoint ? '📍 Remplacer Repère A' : '📍 Mémoriser comme Repère A (test 2 passages)'}
                  </button>
                  {gpsTestRefPoint && (
                    <button
                      type="button"
                      onClick={() => setGpsTestRefPoint(null)}
                      style={{
                        background: 'transparent',
                        color: '#64748b',
                        border: 'none',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Effacer Repère A
                    </button>
                  )}
                  <a
                    href={`https://www.google.com/maps?q=${gpsTestResult.latitude},${gpsTestResult.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: '0.7rem', fontWeight: 800, color: '#0284c7', marginLeft: 'auto' }}
                  >
                    🗺️ Vérifier sur Maps
                  </a>
                </div>
              </div>
            );
          })()}

          {/* Retour de statut */}
          {captureStatus && !liveProgress && (
            <div style={{ marginTop: '12px', fontSize: '0.82rem', fontWeight: 800, color: captureStatus.startsWith('✓') ? '#166534' : '#0284c7' }}>
              {captureStatus}
            </div>
          )}

          {captureError && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', fontSize: '0.80rem', textAlign: 'left' }}>
              ⚠️ <strong>Erreur GPS :</strong> {captureError}
              <div style={{ marginTop: '4px', fontSize: '0.72rem', color: '#b91c1c' }}>
                Astuce iPhone / Android : faites le test <strong>à ciel ouvert</strong> (hors bâtiment) et vérifiez que <strong>Position exacte</strong> est activée pour votre navigateur dans les réglages de localisation.
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

            {/* Météo capturée (Théorique + Réel) */}
            <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                💨 Météo Théorique vs Réelle
              </div>
              <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                Théo (AROME) : {lastLoggedItem.weatherSnapshot.windSpeedKts} nds (raf. {lastLoggedItem.weatherSnapshot.windGustKts}) {lastLoggedItem.weatherSnapshot.windDirectionComp} · {lastLoggedItem.weatherSnapshot.pressureHpa} hPa
                {lastLoggedItem.weatherSnapshot.waveHeightM != null && ` · Houle ${lastLoggedItem.weatherSnapshot.waveHeightM}m`}
              </div>
              {lastLoggedItem.realWeatherSnapshot ? (
                <div style={{ fontSize: '0.76rem', color: '#166534', fontWeight: 700, marginTop: '5px', paddingTop: '5px', borderTop: '1px dashed #cbd5e1' }}>
                  Réel :{' '}
                  {lastLoggedItem.realWeatherSnapshot.windSpeedKts != null
                    ? `${lastLoggedItem.realWeatherSnapshot.windSpeedKts} nds${
                        lastLoggedItem.realWeatherSnapshot.windGustKts != null
                          ? ` (raf. ${lastLoggedItem.realWeatherSnapshot.windGustKts})`
                          : ''
                      } ${lastLoggedItem.realWeatherSnapshot.windDirectionComp || ''} (${
                        lastLoggedItem.realWeatherSnapshot.windSource === 'windsup_spot66' ? 'Winds-Up Spot 66' : 'METAR'
                      })`
                    : 'Vent balise en attente H+2'}
                  {lastLoggedItem.realWeatherSnapshot.pressureHpa != null &&
                    ` · ${lastLoggedItem.realWeatherSnapshot.pressureHpa} hPa (${lastLoggedItem.realWeatherSnapshot.pressureStation || 'METAR'})`}
                  {lastLoggedItem.realWeatherSnapshot.shomBrestHeightM != null &&
                    ` · SHOM Brest ${lastLoggedItem.realWeatherSnapshot.shomBrestHeightM} m (≈ ${convertBrestHeightToDouarnenezM(
                      lastLoggedItem.realWeatherSnapshot.shomBrestHeightM
                    )} m eq. DZ)`}
                  {lastLoggedItem.realWeatherSnapshot.waveHeightM != null &&
                    ` · Houle ${lastLoggedItem.realWeatherSnapshot.waveHeightM} m`}
                </div>
              ) : (
                <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '5px' }}>
                  {lastLoggedItem.offlineQueued
                    ? '📴 En file locale — capteurs réels récupérés au retour réseau'
                    : '⏳ Capteurs réels Winds-Up consolidés automatiquement à H+2'}
                </div>
              )}
            </div>

            {/* Comparaison Hydrodynamique */}
            <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                🌊 SHOM brut vs Réalité (Limite Basse)
              </div>
              <div style={{ fontSize: '0.74rem', color: '#334155', marginTop: '4px' }}>
                Marée SHOM brute : <strong>{lastLoggedItem.theoreticalWaterHeightM} m</strong>
                {(() => {
                  const tc = computeTideCycleAt(lastLoggedItem.timestamp, lastLoggedItem.dateStr);
                  const coef = lastLoggedItem.tideCoef ?? tc.coef;
                  const label = lastLoggedItem.tideCycleLabel ?? tc.label;
                  const dir = lastLoggedItem.tideDirection ?? tc.direction;
                  if (coef == null && !label) return null;
                  return (
                    <span
                      style={{
                        display: 'inline-block',
                        marginLeft: '6px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        background: dir === 'montante' ? '#dbeafe' : '#fef3c7',
                        color: dir === 'montante' ? '#1e40af' : '#92400e',
                      }}
                    >
                      {coef != null ? `Coef ${coef}` : ''}
                      {coef != null && label ? ' · ' : ''}
                      {label || ''}
                      {dir === 'montante' ? ' ↗' : dir === 'descendante' ? ' ↘' : ''}
                    </span>
                  );
                })()}
              </div>
              <div style={{ fontSize: '0.80rem', fontWeight: 900, color: lastLoggedItem.rawSurcoteCm > 0 ? '#0369a1' : '#166534', marginTop: '4px' }}>
                Surcote observée : {lastLoggedItem.rawSurcoteCm > 0 ? `+${lastLoggedItem.rawSurcoteCm}` : lastLoggedItem.rawSurcoteCm} cm
                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b', marginLeft: '6px' }}>
                  (vs SHOM brut)
                </span>
              </div>
              {(() => {
                const dyn = evaluatePointAgainstCadre(lastLoggedItem.latitude, lastLoggedItem.longitude, activeCadreProfile);
                const resolvedDune = resolveTerrainDuneWidthM(
                  lastLoggedItem.latitude,
                  lastLoggedItem.longitude,
                  dyn.widthFromDuneM,
                  lastLoggedItem.measuredWidthFromDuneM
                );
                const wDune = resolvedDune.widthFromDuneM;
                const latPct = dyn.lateralPosPct ?? lastLoggedItem.lateralPosPct;
                const zone = classifyBayZone(lastLoggedItem.latitude, lastLoggedItem.longitude, latPct);
                const usableW =
                  wDune != null
                    ? Math.max(0, wDune - softMarginM)
                    : lastLoggedItem.usableWidthM ??
                      estimateLitto3dUsableWidthM(lastLoggedItem.theoreticalWaterHeightM, softMarginM, zone.zoneId);
                return (
                  <div style={{ fontSize: '0.74rem', color: '#0f172a', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div>
                      Zone :{' '}
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          background: zone.bg,
                          color: zone.fg,
                          border: `1px solid ${zone.bd}`,
                        }}
                      >
                        📍 {zone.label}
                      </span>
                    </div>
                    <div>
                      Bande exploitable utile : <strong>{usableW} m</strong>
                      {wDune != null ? (
                        <span style={{ color: '#64748b' }}>
                          {' '}(Dune → Mer {wDune} m − {softMarginM} m sable mou
                          {resolvedDune.source === 'builtin_dune' ? ' · dune auto' : ''}
                          {latPct != null ? ` · ${latPct}%` : ''})
                        </span>
                      ) : (
                        <span style={{ color: '#64748b' }}> (est. Litto3D)</span>
                      )}
                    </div>
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
            🏖️ Bande Mangée Moy. (vs Théo)
          </div>
          <div
            style={{
              fontSize: stats.avgDeltaVsTheoM != null ? '1.8rem' : '1.15rem',
              fontWeight: 900,
              color:
                stats.avgDeltaVsTheoM == null
                  ? '#64748b'
                  : stats.avgDeltaVsTheoM < 0
                  ? '#c2410c'
                  : '#166534',
              marginTop: '4px',
            }}
          >
            {stats.avgDeltaVsTheoM != null
              ? `${stats.avgDeltaVsTheoM > 0 ? `+${stats.avgDeltaVsTheoM}` : stats.avgDeltaVsTheoM} m`
              : '—'}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#854d0e', marginTop: '2px' }}>
            {stats.measuredCount > 0
              ? `Terrain GPS − SHOM brut sur ${stats.measuredCount} relevé${stats.measuredCount > 1 ? 's' : ''} (négatif = mangé)`
              : 'Aucun point GPS dans la baie Lestrevet–Pentrez'}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', background: '#ffffff', border: '1.5px solid #10b981', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#047857' }}>
            📏 Largeur Utile Moy. Terrain
          </div>
          <div
            style={{
              fontSize: stats.avgTerrainUsableM != null ? '1.8rem' : '1.15rem',
              fontWeight: 900,
              color: stats.avgTerrainUsableM != null ? '#0f172a' : '#64748b',
              marginTop: '4px',
            }}
          >
            {stats.avgTerrainUsableM != null ? `${stats.avgTerrainUsableM} m` : '—'}
          </div>
          <div style={{ fontSize: '0.70rem', color: '#047857', fontWeight: 700, marginTop: '2px' }}>
            {stats.measuredCount > 0
              ? `Distance GPS pied de dune − ${softMarginM} m sable mou`
              : 'Calculé automatiquement dès le 1er relevé en baie'}
          </div>
        </div>
      </div>

      {/* BLOC DIAGNOSTIC MESURÉ — PALIER 20 RELEVÉS GPS */}
      {(() => {
        const diag = computeGpsDiagnosticSummary(displayedLogs, settings.L, activeCadreProfile);
        const verdictBg =
          diag.verdictLevel === 'aligned'
            ? '#f0fdf4'
            : diag.verdictLevel === 'higher'
            ? '#eff6ff'
            : diag.verdictLevel === 'lower'
            ? '#fff7ed'
            : '#f8fafc';
        const verdictBorder =
          diag.verdictLevel === 'aligned'
            ? '#86efac'
            : diag.verdictLevel === 'higher'
            ? '#93c5fd'
            : diag.verdictLevel === 'lower'
            ? '#fdba74'
            : '#cbd5e1';
        const verdictColor =
          diag.verdictLevel === 'aligned'
            ? '#166534'
            : diag.verdictLevel === 'higher'
            ? '#1e40af'
            : diag.verdictLevel === 'lower'
            ? '#9a3412'
            : '#334155';

        return (
          <div
            className="card"
            style={{
              background: '#ffffff',
              border: diag.isReady ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
              borderRadius: '12px',
              padding: isDiagnosticOpen ? '14px 18px 16px' : '12px 18px',
              marginBottom: '20px',
              boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
            }}
          >
            <button
              type="button"
              onClick={() => setIsDiagnosticOpen(prev => !prev)}
              aria-expanded={isDiagnosticOpen}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#0369a1', letterSpacing: '0.04em' }}>
                  🔬 Diagnostic Mesuré · Palier 20 Relevés GPS · dès le 20/11/2026
                </div>
                <h3 style={{ margin: '2px 0 0', fontSize: '1.0rem', fontWeight: 900, color: '#0f172a' }}>
                  Vérification du Seuil Réel de Lestrevet ({settings.L.toFixed(2)} m · vs SHOM brut)
                </h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: diag.isReady ? '#dcfce7' : diag.totalCount > 0 ? '#fef3c7' : '#f1f5f9',
                    color: diag.isReady ? '#166534' : diag.totalCount > 0 ? '#92400e' : '#475569',
                    border: `1px solid ${diag.isReady ? '#86efac' : diag.totalCount > 0 ? '#fcd34d' : '#cbd5e1'}`,
                  }}
                >
                  {diag.isReady
                    ? `✅ Palier atteint (${diag.totalCount} relevés · diagnostic exploitable)`
                    : diag.totalCount > 0
                    ? `⏳ Tendance préliminaire (${diag.totalCount} / ${diag.threshold})`
                    : `🔒 En attente (${diag.totalCount} / ${diag.threshold} relevés)`}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '26px',
                    height: '26px',
                    borderRadius: '6px',
                    background: '#f1f5f9',
                    color: '#334155',
                    fontSize: '0.82rem',
                    fontWeight: 900,
                  }}
                  title={isDiagnosticOpen ? 'Replier le tiroir' : 'Ouvrir le tiroir'}
                >
                  {isDiagnosticOpen ? '▾' : '▸'}
                </span>
              </div>
            </button>

            {isDiagnosticOpen && (
              <div style={{ marginTop: '12px' }}>
                {/* Barre de progression dédiée au palier 20 */}
                <div style={{ height: '7px', borderRadius: '4px', background: '#e2e8f0', overflow: 'hidden', marginBottom: '10px' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${diag.progressPct}%`,
                      background: diag.isReady ? '#16a34a' : '#0284c7',
                      transition: 'width 0.35s ease',
                    }}
                  />
                </div>

            {/* Bandeau conclusion / verdict */}
            <div
              style={{
                background: verdictBg,
                border: `1px solid ${verdictBorder}`,
                borderRadius: '8px',
                padding: '9px 12px',
                fontSize: '0.78rem',
                color: verdictColor,
                fontWeight: 700,
                lineHeight: 1.45,
                marginBottom: diag.totalCount > 0 ? '12px' : '0',
              }}
            >
              {diag.verdictText}
            </div>

            {diag.totalCount === 0 ? (
              <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px', fontSize: '0.72rem', color: '#475569' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                  <strong>1. Seuil mesuré vs {settings.L.toFixed(2)} m</strong>
                  <div style={{ marginTop: '2px' }}>Calcule automatiquement la hauteur d&apos;eau réelle constatée à la limite basse de roulage.</div>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                  <strong>2. Effet dépression &amp; vent de mer</strong>
                  <div style={{ marginTop: '2px' }}>Compare la surcote mesurée en dépression (&lt; 1005 hPa) vs temps calme et par vent d&apos;Ouest.</div>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                  <strong>3. Zones de baie &amp; Bâches</strong>
                  <div style={{ marginTop: '2px' }}>Ventile largeur utile et écarts entre Lestrevet, Lieue de Grève et Pentrez + suivi des bâches.</div>
                </div>
              </div>
            ) : (
              <>
                {/* 4 chiffres clés du diagnostic : Houle empirique, Bande mangée, Brest réel, Seuil & Bâches */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.64rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase' }}>
                      🌊 Effet Houle Empirique
                    </div>
                    <div
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 900,
                        color:
                          diag.swellImpactMPerM == null
                            ? '#64748b'
                            : diag.swellImpactMPerM < 0
                            ? '#c2410c'
                            : '#166534',
                        marginTop: '2px',
                      }}
                    >
                      {diag.swellImpactMPerM != null
                        ? `${diag.swellImpactMPerM > 0 ? `+${diag.swellImpactMPerM}` : diag.swellImpactMPerM} m / m houle`
                        : '—'}
                    </div>
                    <div style={{ fontSize: '0.67rem', color: '#475569' }}>
                      {diag.swellImpactSampleCount > 0
                        ? `Moy. sur ${diag.swellImpactSampleCount} relevé${diag.swellImpactSampleCount > 1 ? 's' : ''} (houle ≥ 0,8 m)`
                        : 'En attente de relevés avec houle'}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.64rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                      🏖️ Bande Mangée par Houle
                    </div>
                    <div style={{ fontSize: '0.73rem', fontWeight: 800, color: '#0f172a', marginTop: '4px', lineHeight: 1.45 }}>
                      <div>
                        Calme &lt;1m :{' '}
                        <span style={{ color: '#0369a1' }}>
                          {diag.swellCalm.avgDeltaVsCorrM != null
                            ? `${diag.swellCalm.avgDeltaVsCorrM > 0 ? '+' : ''}${diag.swellCalm.avgDeltaVsCorrM} m`
                            : '—'}
                        </span>{' '}
                        <span style={{ color: '#64748b', fontWeight: 600 }}>({diag.swellCalm.count})</span>
                      </div>
                      <div>
                        Moy. 1–1,8m :{' '}
                        <span style={{ color: '#b45309' }}>
                          {diag.swellModerate.avgDeltaVsCorrM != null
                            ? `${diag.swellModerate.avgDeltaVsCorrM > 0 ? '+' : ''}${diag.swellModerate.avgDeltaVsCorrM} m`
                            : '—'}
                        </span>{' '}
                        <span style={{ color: '#64748b', fontWeight: 600 }}>({diag.swellModerate.count})</span>
                      </div>
                      <div>
                        Forte ≥1,8m :{' '}
                        <span style={{ color: '#c2410c' }}>
                          {diag.swellStrong.avgDeltaVsCorrM != null
                            ? `${diag.swellStrong.avgDeltaVsCorrM > 0 ? '+' : ''}${diag.swellStrong.avgDeltaVsCorrM} m`
                            : '—'}
                        </span>{' '}
                        <span style={{ color: '#64748b', fontWeight: 600 }}>({diag.swellStrong.count})</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.64rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                      SHOM DZ vs Brest (eq. DZ)
                    </div>
                    <div style={{ fontSize: '1.12rem', fontWeight: 900, color: '#0f172a', marginTop: '2px' }}>
                      {diag.avgTheoreticalWaterM?.toFixed(2)} m
                      {diag.avgShomBrestEqDouarnenezM != null ? ` · ${diag.avgShomBrestEqDouarnenezM.toFixed(2)} m` : ''}
                    </div>
                    <div style={{ fontSize: '0.67rem', color: '#475569' }}>
                      {diag.avgBrestSurgeVsCorrCm != null
                        ? `Surcote Brest vs SHOM : ${diag.avgBrestSurgeVsCorrCm > 0 ? `+${diag.avgBrestSurgeVsCorrCm}` : diag.avgBrestSurgeVsCorrCm} cm · `
                        : ''}
                      {diag.consolidatedCount}/{diag.totalCount} consolidé{diag.consolidatedCount > 1 ? 's' : ''}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.64rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                      SHOM moy. &amp; Bâches
                    </div>
                    <div style={{ fontSize: '1.12rem', fontWeight: 900, color: '#0f172a', marginTop: '2px' }}>
                      {diag.avgTheoreticalWaterM?.toFixed(2)} m
                    </div>
                    <div style={{ fontSize: '0.67rem', color: '#475569' }}>
                      Bâches : <strong style={{ color: diag.bachesCount > 0 ? '#b45309' : '#166534' }}>{diag.bachesCount} ({diag.bachesPct}%)</strong>
                      {' · '}Seuil {settings.L.toFixed(2)} m
                    </div>
                  </div>
                </div>

                {/* Plan de couverture des scénarios pour verrouiller le modèle empirique */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '6px',
                    padding: '7px 10px',
                    background: '#f8fafc',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '8px',
                    marginBottom: '10px',
                    fontSize: '0.68rem',
                    color: '#475569',
                  }}
                >
                  <strong style={{ color: '#0f172a' }}>Couverture calibrage :</strong>
                  {[
                    { label: 'Mer calme (<1m)', count: diag.swellCalm.count, target: 3 },
                    { label: 'Houle moy. (1–1,8m)', count: diag.swellModerate.count, target: 3 },
                    { label: 'Forte houle (≥1,8m)', count: diag.swellStrong.count, target: 3 },
                    { label: 'Secteurs baie', count: diag.coveredZonesCount, target: 3 },
                  ].map(item => {
                    const ok = item.count >= item.target;
                    return (
                      <span
                        key={item.label}
                        style={{
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontWeight: 800,
                          background: ok ? '#dcfce7' : item.count > 0 ? '#fef3c7' : '#ffffff',
                          color: ok ? '#166534' : item.count > 0 ? '#92400e' : '#64748b',
                          border: `1px solid ${ok ? '#86efac' : item.count > 0 ? '#fcd34d' : '#cbd5e1'}`,
                        }}
                      >
                        {ok ? '✓ ' : ''}
                        {item.label} : {item.count}/{item.target}
                      </span>
                    );
                  })}
                </div>

                {/* Ventilation par zone de la baie */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '8px' }}>
                  {diag.zones.map(z => (
                    <div
                      key={z.zoneId}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '7px 10px',
                        fontSize: '0.72rem',
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#0f172a', display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                        <span>📍 {z.label}</span>
                        <span style={{ color: '#0369a1' }}>{z.count} pt{z.count > 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ color: '#475569', marginTop: '3px' }}>
                        {z.count > 0
                          ? `Terrain utile moy. : ${z.avgUsableWidthM != null ? `${z.avgUsableWidthM} m` : '—'} · vs SHOM : ${
                              z.avgDeltaVsCorrM != null ? `${z.avgDeltaVsCorrM > 0 ? '+' : ''}${z.avgDeltaVsCorrM} m` : '—'
                            }`
                          : 'Aucun relevé sur cette zone'}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
              </div>
            )}
          </div>
        );
      })()}

      {/* RÉFÉRENTIEL CADRE TERRAIN FIXE (DUNE + CÔTÉS GAUCHE/DROITE MAIRIE & JÉRÔME) */}
      <BeachCadrePanel
        config={cadreConfig}
        logs={displayedLogs}
        author={author}
        isReadOnly={isReadOnly}
        onSaveConfig={handleSaveCadreConfig}
      />

      {/* MODULE LITTO3D FINISTÈRE (IGN / SHOM) : COUPE 2D & LARGEUR DE ROULAGE (POINT 8) */}
      <div style={{ marginBottom: '20px' }}>
        <Litto3DBeachSection
          settings={settings}
          EX={EX}
          windList={windList}
          logs={displayedLogs}
          activeCadre={activeCadreProfile}
        />
      </div>

      {/* TABLEAU DES RELEVÉS GPS AVEC FILTRES ET EXPORT */}
      <div className="card" style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 900, fontSize: '0.88rem', color: '#0f172a' }}>
                📋 Carnet des Relevés GPS Limite Basse ({filteredEntries.length})
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {!isReadOnly && (
                <button
                  type="button"
                  disabled={isConsolidating || !isOnline}
                  onClick={() => void syncOfflineAndConsolidatePending({ silent: false, forceRefresh: true })}
                  title="Envoyer la file hors-ligne et consolider les relevés avec les capteurs réels (Winds-Up H+2, METAR, SHOM Brest)"
                  style={{
                    padding: '6px 11px',
                    background: isConsolidating || !isOnline ? '#cbd5e1' : '#0f766e',
                    color: isConsolidating || !isOnline ? '#475569' : '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    cursor: isConsolidating || !isOnline ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <span>{isConsolidating ? '⏳ Consolidation...' : '🔄 Synchroniser & consolider réel'}</span>
                  {(offlineQueue.length > 0 || pendingRealCount > 0) && (
                    <span style={{ background: 'rgba(255,255,255,0.22)', padding: '1px 5px', borderRadius: '4px' }}>
                      {offlineQueue.length + pendingRealCount}
                    </span>
                  )}
                </button>
              )}

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
          </div>

          {consolidationFeedback && (
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: consolidationFeedback.startsWith('✓') ? '#0f766e' : '#b45309', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '5px 10px' }}>
              {consolidationFeedback}
            </div>
          )}

          {/* Filtrage & synthèse automatique 3 zones : Lestrevet / Lieue de Grève / Pentrez */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setFilterZone('all')}
              style={{
                border: filterZone === 'all' ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                background: filterZone === 'all' ? '#0f172a' : '#ffffff',
                color: filterZone === 'all' ? '#ffffff' : '#475569',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '0.68rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Toutes zones ({displayedLogs.length})
            </button>
            {zoneSummaries.map(zs => {
              const active = filterZone === zs.meta.zoneId;
              return (
                <button
                  key={zs.meta.zoneId}
                  type="button"
                  onClick={() => setFilterZone(active ? 'all' : zs.meta.zoneId)}
                  style={{
                    border: active ? `1.5px solid ${zs.meta.fg}` : `1px solid ${zs.meta.bd}`,
                    background: zs.meta.bg,
                    color: zs.meta.fg,
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 0 1px currentColor' : 'none',
                  }}
                >
                  📍 {zs.meta.shortLabel} ({zs.count})
                  {zs.avgUsableM != null ? ` · moy. ${zs.avgUsableM} m utile` : ''}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '420px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#475569', fontSize: '0.66rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px' }}>Date & Heure</th>
                <th
                  style={{ padding: '8px 10px' }}
                  title="Coefficient SHOM du jour et position exacte dans le cycle de marée (BM+ = montante / flot, HM+ = descendante / jusant)"
                >
                  Marée (Coef / Cycle)
                </th>
                <th style={{ padding: '8px 10px' }}>Auteur</th>
                <th style={{ padding: '8px 10px' }}>Coordonnées GPS</th>
                <th style={{ padding: '8px 10px' }}>Précision</th>
                <th style={{ padding: '8px 10px' }}>Zone</th>
                <th style={{ padding: '8px 10px' }}>Météo Théo vs Réel</th>
                <th
                  style={{ padding: '8px 10px' }}
                  title={`Bande de sable utile théorique (SHOM brut sur profil réel IGN RGE ALTI 1 m du secteur, après déduction de ${softMarginM} m de sable mou)`}
                >
                  Bande sable SHOM brut
                </th>
                <th
                  style={{ padding: '8px 10px' }}
                  title={`Bande de sable utile réellement mesurée sur le terrain (distance GPS depuis la ligne de dune − ${softMarginM} m de sable mou) et écart mangé/gagné vs SHOM brut`}
                >
                  Bande sable terrain (vs SHOM)
                </th>
                <th style={{ padding: '8px 10px' }}>État & Notes</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📍</div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.90rem', marginBottom: '4px' }}>
                      Aucun relevé GPS pour cette période / zone
                    </div>
                    <div style={{ fontSize: '0.75rem', maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                      Dès que Jérôme se rend sur la plage de Pentrez / Lestrevet à la limite basse de roulage, il lui suffit de cliquer sur le gros bouton bleu ci-dessus pour enregistrer le point en direct.
                    </div>
                  </td>
                </tr>
              ) : (
                filteredEntries.map(
                  (
                    {
                      log,
                      dyn: dynEval,
                      zone,
                      rawWidth: widthDune,
                      widthSource,
                      theoTotalX,
                      theoUsableM,
                      terrainUsableM,
                    },
                    idx
                  ) => {
                    const latPct = dynEval.lateralPosPct ?? log.lateralPosPct;
                    const inZone = dynEval.isInsideZone ?? log.isInsideZone;
                    const terrainVsTheoM = terrainUsableM != null ? terrainUsableM - theoUsableM : null;
                    const tc = computeTideCycleAt(log.timestamp, log.dateStr);
                    const tideCoef = log.tideCoef ?? tc.coef;
                    const tideCycleLabel = log.tideCycleLabel ?? tc.label;
                    const tideDir = log.tideDirection ?? tc.direction;

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
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {tideCoef != null || tideCycleLabel ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>
                            {tideCoef != null ? `Coef ${tideCoef}` : 'Coef —'}
                          </div>
                          {tideCycleLabel && (
                            <span
                              style={{
                                display: 'inline-block',
                                width: 'fit-content',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '0.64rem',
                                fontWeight: 800,
                                background: tideDir === 'montante' ? '#dbeafe' : '#fef3c7',
                                color: tideDir === 'montante' ? '#1e40af' : '#92400e',
                              }}
                              title={
                                tideDir === 'montante'
                                  ? 'Marée montante (flot après basse mer)'
                                  : tideDir === 'descendante'
                                  ? 'Marée descendante (jusant après haute mer)'
                                  : 'Cycle de marée SHOM'
                              }
                            >
                              {tideCycleLabel}
                              {tideDir === 'montante' ? ' ↗' : tideDir === 'descendante' ? ' ↘' : ''}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 'fit-content',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '0.64rem',
                            fontWeight: 800,
                            background: zone.bg,
                            color: zone.fg,
                            border: `1px solid ${zone.bd}`,
                          }}
                        >
                          {zone.shortLabel}
                        </span>
                        {(latPct != null || inZone === false) && (
                          <span style={{ fontSize: '0.64rem', color: inZone === false ? '#b45309' : '#64748b' }}>
                            {latPct != null ? `Couloir ${latPct}%` : ''}
                            {inZone === false ? ' · hors zone' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#334155', lineHeight: 1.45 }}>
                      <div>
                        <span style={{ display: 'inline-block', minWidth: '34px', fontSize: '0.64rem', fontWeight: 800, color: '#64748b' }}>
                          Théo
                        </span>
                        <span>
                          Vent <strong>{log.weatherSnapshot.windSpeedKts} nds</strong> {log.weatherSnapshot.windDirectionComp} · {log.weatherSnapshot.pressureHpa} hPa
                          {log.weatherSnapshot.waveHeightM != null ? (
                            <>
                              {' · '}
                              <span style={{ color: '#0369a1', fontWeight: 700 }}>
                                Houle {log.weatherSnapshot.waveHeightM} m
                                {log.weatherSnapshot.wavePeriodS != null ? ` (${log.weatherSnapshot.wavePeriodS}s)` : ''}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </div>
                      {log.realWeatherSnapshot ? (
                        <div style={{ fontSize: '0.68rem', color: '#166534', marginTop: '2px' }}>
                          <span style={{ display: 'inline-block', minWidth: '34px', fontSize: '0.64rem', fontWeight: 800 }}>
                            Réel
                          </span>
                          <span>
                            {log.realWeatherSnapshot.windSpeedKts != null ? (
                              <>
                                Vent <strong>{log.realWeatherSnapshot.windSpeedKts} nds</strong> {log.realWeatherSnapshot.windDirectionComp || ''}
                              </>
                            ) : (
                              'Vent H+2'
                            )}
                            {log.realWeatherSnapshot.pressureHpa != null
                              ? ` · ${log.realWeatherSnapshot.pressureHpa} hPa (${log.realWeatherSnapshot.pressureStation || 'METAR'})`
                              : ''}
                            {log.realWeatherSnapshot.shomBrestHeightM != null ? (
                              <span
                                title={`Mesure marégraphe SHOM Brest : ${log.realWeatherSnapshot.shomBrestHeightM} m · converti au zéro hydrographique de Douarnenez (-0,63 m)`}
                              >
                                {' · '}Marée <strong>{convertBrestHeightToDouarnenezM(log.realWeatherSnapshot.shomBrestHeightM)} m</strong> eq. DZ{' '}
                                <span style={{ color: '#64748b', fontSize: '0.64rem' }}>
                                  (Brest {log.realWeatherSnapshot.shomBrestHeightM} m)
                                </span>
                              </span>
                            ) : null}
                            {log.realWeatherSnapshot.waveHeightM != null
                              ? ` · Houle ${log.realWeatherSnapshot.waveHeightM} m`
                              : ''}
                          </span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.64rem', color: log.offlineQueued ? '#b45309' : '#94a3b8', marginTop: '2px' }}>
                          {log.offlineQueued ? '📴 En file hors-ligne' : '⏳ Réel en attente (H+2)'}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      <div style={{ fontWeight: 800, color: '#334155' }}>{theoUsableM} m utile</div>
                      <div style={{ fontSize: '0.64rem', color: '#64748b' }}>
                        Dune {theoTotalX} m · SHOM {log.theoreticalWaterHeightM} m
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {terrainUsableM != null ? (
                        <>
                          <div style={{ fontWeight: 900, color: '#0f172a' }}>
                            {terrainUsableM} m utile
                            {terrainVsTheoM != null && (
                              <span
                                style={{
                                  marginLeft: '5px',
                                  fontSize: '0.66rem',
                                  fontWeight: 800,
                                  color: terrainVsTheoM < 0 ? '#c2410c' : '#166534',
                                }}
                                title={`Écart terrain GPS (${terrainUsableM} m) vs SHOM brut (${theoUsableM} m)`}
                              >
                                ({terrainVsTheoM > 0 ? `+${terrainVsTheoM}` : terrainVsTheoM} m
                                {terrainVsTheoM < 0 ? ' mangés' : ''})
                              </span>
                            )}
                          </div>
                          <div
                            style={{ fontSize: '0.64rem', color: '#64748b' }}
                            title={
                              widthSource === 'builtin_dune'
                                ? 'Calcul automatique depuis la ligne de pied de dune Lestrevet–Pentrez (IGN/OSM) − 50 m de sable mou'
                                : 'Calcul depuis les repères personnalisés du Cadre Terrain'
                            }
                          >
                            Dune {widthDune} m · vs SHOM brut
                          </div>
                        </>
                      ) : (
                        <div title="Point GPS situé en dehors de la baie Lestrevet / Pentrez">
                          <div style={{ fontWeight: 700, color: '#94a3b8' }}>Hors baie</div>
                          <div style={{ fontSize: '0.63rem', color: '#94a3b8' }}>GPS hors Lestrevet–Pentrez</div>
                        </div>
                      )}
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
              « Vous avez passé les 300 mesures ! Le modèle réel empirique de Lestrevet atteint sa précision maximale ! »
            </div>

            <p style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
              Grâce à vos relevés constants sur la plage de Pentrez / Lestrevet, le modèle réel empirique dispose désormais d&apos;une base terrain complète pour anticiper la largeur de plage et la surcote avec une grande fiabilité.
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
              🚀 Continuer avec le Modèle Empirique
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
