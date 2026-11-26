import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  MapMouseEvent,
  Polygon,
  Polyline,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AppSettings,
  BeachCadreConfig,
  BeachCadreProfileKey,
  GpsWaterlineLog,
  TidePoint,
  WindPoint,
} from '../types';
import { build, comp, getNextTideInfo, getTideCoef, hAt, lc, plan, tdy, toU, windAt } from '../utils/tides';
import {
  BAY_ZONES_META,
  BayZoneId,
  classifyBayZone,
  classifyWindSector,
  estimateLitto3dWaterlineXExactM,
  measureDistanceFromBuiltInDuneM,
  resolveTerrainDuneWidthM,
} from '../utils/beachOrientation';
import {
  evaluatePointAgainstCadre,
  getStoredBeachCadreConfig,
} from '../utils/beachCadreEngine';
import {
  clearStoredDailyUpperLimit,
  computePreviousHighTideUpperLimit,
  DailyUpperLimitOverride,
  getOfflineGpsQueue,
  getStoredDailyUpperLimit,
  getStoredWaterlineLogs,
  mergeOfflineQueueWithLogs,
  resolveEffectiveUpperMargin,
  saveStoredDailyUpperLimit,
} from '../utils/waterlineGpsEngine';
import {
  subscribeToBeachCadreConfig,
  subscribeToWaterlineGpsLogs,
} from '../utils/firebaseSync';
import {
  buildPhysicalObservationPoints,
  fitEmpiricalTerrainModel,
  OBSERVATORY_START_DATE,
  predictEmpiricalAt,
} from '../utils/physicalCorrelationEngine';
import { getStoredObservations } from '../utils/statisticsEngine';
import {
  BAY_CAMERA_PRESETS,
  BAY_STRICT_BOUNDS,
  buildBandPolygonBetweenDistances,
  buildCadreOverlayGeometry,
  CameraPreset,
  computePointsBounds,
  getDunePolylineForFocus,
  LatLngBoundsBox,
  LatLngPoint,
  MapFocusAreaId,
  projectShorelineAlongDune,
} from '../utils/beachMapGeometry';

interface GpsVisualTestTabProps {
  settings: AppSettings;
  EX: TidePoint[];
  W: [number, number][];
  first: number;
  last: number;
  windList?: WindPoint[];
  selectedDate: string;
}

type MapTypeChoice = 'satellite' | 'hybrid' | 'roadmap';
type ZoneFocusId = CameraPreset['id'] | 'cadre';

interface CameraCommand {
  id: number;
  center?: LatLngPoint;
  zoom?: number;
  fitBounds?: LatLngBoundsBox;
  fitPoints?: LatLngPoint[];
}

interface ProbePoint {
  lat: number;
  lng: number;
  zoneLabel: string;
  zoneId: BayZoneId;
  distanceFromDuneM: number | null;
  rawSignedM: number | null;
  statusLabel: string;
  statusColor: string;
}

const ALL_ZONES: ReadonlyArray<BayZoneId> = ['lestrevet', 'lieue_de_greve', 'pentrez'];

function resolveGoogleMapsApiKey(): string {
  const fromVite = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (typeof fromVite === 'string' && fromVite.trim()) return fromVite.trim();
  if (typeof __GOOGLE_MAPS_API_KEY__ === 'string' && __GOOGLE_MAPS_API_KEY__.trim()) {
    return __GOOGLE_MAPS_API_KEY__.trim();
  }
  return '';
}

const MapCameraController: React.FC<{
  command: CameraCommand | null;
  lockedBounds: LatLngBoundsBox | null;
  isViewLocked: boolean;
}> = ({ command, lockedBounds, isViewLocked }) => {
  const map = useMap();

  // Cadrage automatique dès que la carte est prête ou que la zone figée change
  useEffect(() => {
    if (!map || !lockedBounds || !isViewLocked) return;
    map.fitBounds(lockedBounds, { top: 16, right: 16, bottom: 16, left: 16 });
  }, [map, lockedBounds, isViewLocked]);

  useEffect(() => {
    if (!map || !command) return;
    if (command.fitBounds) {
      map.fitBounds(command.fitBounds, { top: 18, right: 18, bottom: 18, left: 18 });
      return;
    }
    if (command.fitPoints && command.fitPoints.length >= 2) {
      const bounds = new google.maps.LatLngBounds();
      for (const pt of command.fitPoints) {
        bounds.extend(pt);
      }
      map.fitBounds(bounds, { top: 36, right: 36, bottom: 36, left: 36 });
      return;
    }
    if (command.center) {
      map.panTo(command.center);
      if (typeof command.zoom === 'number') {
        map.setZoom(command.zoom);
      }
    }
  }, [map, command]);

  return null;
};

const MapLoadStatusOverlay: React.FC = () => {
  const status = useApiLoadingStatus();

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(15, 23, 42, 0.78)',
          color: '#ffffff',
          padding: '20px',
          textAlign: 'center',
          zIndex: 5,
        }}
      >
        <div style={{ maxWidth: '460px' }}>
          <div style={{ fontWeight: 900, fontSize: '0.98rem', marginBottom: '6px' }}>
            Impossible de charger la carte Google Maps
          </div>
          <div style={{ fontSize: '0.8rem', color: '#e2e8f0', lineHeight: 1.45 }}>
            Vérifiez la connexion réseau ou la configuration de la clé Google Maps Platform dans cet environnement.
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export const GpsVisualTestTab: React.FC<GpsVisualTestTabProps> = ({
  settings,
  EX,
  W,
  first,
  last,
  windList = [],
  selectedDate,
}) => {
  const apiKey = useMemo(() => resolveGoogleMapsApiKey(), []);

  // Date & heure simulées sur la carte (par défaut date active + heure actuelle ou mi-journée)
  const [dateStr, setDateStr] = useState<string>(selectedDate || tdy());
  const [y, m0, d] = useMemo(() => {
    const parts = dateStr.split('-').map(Number);
    return [parts[0] || 2026, parts[1] || 1, parts[2] || 1];
  }, [dateStr]);
  const m = m0 - 1;
  const t0 = useMemo(() => toU(y, m, d, 0), [y, m, d]);
  const t1 = useMemo(() => toU(y, m, d + 1, 0), [y, m, d]);

  const nowU = Math.floor(Date.now() / 60000);
  const isToday = dateStr === tdy();

  const [activeU, setActiveU] = useState<number>(() => {
    const start = toU(y, m, d, 0);
    const end = toU(y, m, d + 1, 0);
    if (dateStr === tdy() && nowU >= start && nowU <= end) {
      return Math.round(nowU / 10) * 10;
    }
    return start + 12 * 60;
  });

  useEffect(() => {
    if (activeU < t0 || activeU > t1) {
      const target = isToday && nowU >= t0 && nowU <= t1 ? Math.round(nowU / 10) * 10 : t0 + 12 * 60;
      setActiveU(Math.min(t1, Math.max(t0, target)));
    }
  }, [t0, t1, isToday, nowU, activeU]);

  // Données GPS et Cadre Terrain synchronisées (lecture seule vis-à-vis de l'existant)
  const [gpsLogs, setGpsLogs] = useState<GpsWaterlineLog[]>(() =>
    mergeOfflineQueueWithLogs(getStoredWaterlineLogs(), getOfflineGpsQueue())
  );
  const [cadreConfig, setCadreConfig] = useState<BeachCadreConfig>(() =>
    getStoredBeachCadreConfig()
  );
  const [cadreKey, setCadreKey] = useState<BeachCadreProfileKey>(() =>
    getStoredBeachCadreConfig().activeProfile
  );
  const [dayUpperOverride, setDayUpperOverride] = useState<DailyUpperLimitOverride | null>(() =>
    getStoredDailyUpperLimit(dateStr)
  );

  useEffect(() => {
    const unsubLogs = subscribeToWaterlineGpsLogs(
      remoteLogs => {
        setGpsLogs(mergeOfflineQueueWithLogs(remoteLogs, getOfflineGpsQueue()));
      },
      () => {
        // Fallback silencieux sur le cache local
      }
    );
    const unsubCadre = subscribeToBeachCadreConfig(
      remoteCfg => {
        if (remoteCfg) {
          setCadreConfig(remoteCfg);
        }
      },
      () => {
        // Fallback silencieux
      }
    );
    return () => {
      unsubLogs();
      unsubCadre();
    };
  }, []);

  useEffect(() => {
    setDayUpperOverride(getStoredDailyUpperLimit(dateStr));
  }, [dateStr]);

  useEffect(() => {
    const syncOverride = () => {
      setDayUpperOverride(getStoredDailyUpperLimit(dateStr));
    };
    window.addEventListener('focus', syncOverride);
    window.addEventListener('storage', syncOverride);
    return () => {
      window.removeEventListener('focus', syncOverride);
      window.removeEventListener('storage', syncOverride);
    };
  }, [dateStr]);

  const activeCadre = cadreConfig.profiles[cadreKey] ?? null;

  // Préférences de couches et vue (figée par défaut sur Lestrevet / zone active)
  const [mapTypeId, setMapTypeId] = useState<MapTypeChoice>('satellite');
  const [activeZoneFocus, setActiveZoneFocus] = useState<ZoneFocusId>('lestrevet');
  const [isViewLocked, setIsViewLocked] = useState<boolean>(true);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null);
  const [showDuneLine, setShowDuneLine] = useState<boolean>(true);
  const [showSoftSand, setShowSoftSand] = useState<boolean>(true);
  const [showUsableBand, setShowUsableBand] = useState<boolean>(true);
  const [showWaterlines, setShowWaterlines] = useState<boolean>(true);
  const [showJeromeLimit, setShowJeromeLimit] = useState<boolean>(true);
  const [showCadreOverlay, setShowCadreOverlay] = useState<boolean>(true);
  const [showGpsLogs, setShowGpsLogs] = useState<boolean>(true);
  const [onlySelectedDateLogs, setOnlySelectedDateLogs] = useState<boolean>(false);

  // Sélection interactive (InfoWindows)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedCadrePin, setSelectedCadrePin] = useState<{
    label: string;
    detail: string;
    position: LatLngPoint;
  } | null>(null);
  const [probePoint, setProbePoint] = useState<ProbePoint | null>(null);

  // Modèle SHOM pur + Modèle Réel Empirique (identique à CurveChart)
  const rawEX = useMemo(() => build(settings.les, false, []), [settings.les]);
  const dayEx = useMemo(() => EX.filter(p => p.t >= t0 && p.t <= t1), [EX, t0, t1]);
  const dayPlan = useMemo(
    () => plan(y, m, d, settings, W, first, last),
    [y, m, d, settings, W, first, last]
  );

  const empiricalTerrainModel = useMemo(() => {
    const rexObs = getStoredObservations().filter(
      o => o && o.id && !o.id.startsWith('sample-obs-')
    );
    const { points } = buildPhysicalObservationPoints(
      gpsLogs,
      rexObs,
      activeCadre,
      OBSERVATORY_START_DATE
    );
    return fitEmpiricalTerrainModel(points);
  }, [gpsLogs, activeCadre]);

  const activeWind = useMemo(
    () => (windList.length > 0 ? windAt(activeU, windList) : null),
    [activeU, windList]
  );
  const activeHt = useMemo(() => hAt(activeU, rawEX), [activeU, rawEX]);
  const activeEmpPred = useMemo(
    () => predictEmpiricalAt(empiricalTerrainModel, activeWind),
    [empiricalTerrainModel, activeWind]
  );

  const theoWaterHeightM = Number((activeHt ?? settings.L).toFixed(2));
  const realWaterHeightM = Number(
    ((activeHt ?? settings.L) + activeEmpPred.surcoteCm / 100).toFixed(2)
  );
  const activeDeltaCm = Math.round((realWaterHeightM - theoWaterHeightM) * 100);
  const jeromeLimitH = settings.L;

  // Relevé GPS limite haute du jour (si présent en base)
  const dayGpsUpperLog = useMemo(() => {
    const matching = gpsLogs.filter(
      log =>
        log &&
        log.dateStr === dateStr &&
        log.upperSoftMarginM != null &&
        Number.isFinite(log.upperSoftMarginM) &&
        (log.upperLimitSource === 'gps_high_mark' || log.upperLimitSource === 'manual_day')
    );
    if (!matching.length) return null;
    return matching.reduce((latest, cur) => (cur.timestamp >= latest.timestamp ? cur : latest));
  }, [gpsLogs, dateStr]);

  // Limite haute sable mou calculée pour chacune des 3 zones de la baie
  const upperMarginByZone = useMemo(() => {
    const refTsMs = activeU * 60000;
    const result: Record<BayZoneId, ReturnType<typeof resolveEffectiveUpperMargin>> = {
      lestrevet: resolveEffectiveUpperMargin({ timestampMs: refTsMs, zoneId: 'lestrevet' }),
      lieue_de_greve: resolveEffectiveUpperMargin({
        timestampMs: refTsMs,
        zoneId: 'lieue_de_greve',
      }),
      pentrez: resolveEffectiveUpperMargin({ timestampMs: refTsMs, zoneId: 'pentrez' }),
    };

    for (const z of ALL_ZONES) {
      const basePrevPm = computePreviousHighTideUpperLimit(refTsMs, z, settings.les);
      const prevPmWind =
        windList.length > 0 && basePrevPm?.prevPmUtcMin != null
          ? windAt(basePrevPm.prevPmUtcMin, windList)
          : null;
      const prevPmSurcoteCm = prevPmWind
        ? predictEmpiricalAt(empiricalTerrainModel, prevPmWind).surcoteCm
        : undefined;

      result[z] = resolveEffectiveUpperMargin({
        timestampMs: refTsMs,
        zoneId: z,
        storedUpperMarginM: !dayUpperOverride ? dayGpsUpperLog?.upperSoftMarginM : undefined,
        storedUpperSource: !dayUpperOverride ? dayGpsUpperLog?.upperLimitSource : undefined,
        storedPrevPmHeightM: !dayUpperOverride ? dayGpsUpperLog?.prevPmHeightM : undefined,
        dailyOverride: dayUpperOverride,
        activeCadre,
        les: settings.les,
        prevPmSurcoteCm,
      });
    }
    return result;
  }, [
    activeU,
    settings.les,
    windList,
    empiricalTerrainModel,
    dayUpperOverride,
    dayGpsUpperLog,
    activeCadre,
  ]);

  const activeMetricZone: BayZoneId =
    activeZoneFocus === 'lieue_de_greve' || activeZoneFocus === 'pentrez'
      ? activeZoneFocus
      : 'lestrevet';
  const activeZoneShortLabel = BAY_ZONES_META[activeMetricZone].shortLabel;
  const refSoftMargin = upperMarginByZone[activeMetricZone];

  const handleAdjustSoftMargin = (deltaM: number) => {
    const nextMargin = Math.max(0, Math.min(220, Math.round(refSoftMargin.marginM + deltaM)));
    const nextOverride: DailyUpperLimitOverride = {
      dateStr,
      marginM: nextMargin,
      source: 'manual_day',
      updatedAt: Date.now(),
    };
    saveStoredDailyUpperLimit(nextOverride);
    setDayUpperOverride(nextOverride);
  };

  const handleResetSoftMargin = () => {
    clearStoredDailyUpperLimit(dateStr);
    setDayUpperOverride(null);
  };

  // Distances métriques depuis la dune par zone
  const zoneMetrics = useMemo(() => {
    const out: Record<
      BayZoneId,
      { softM: number; theoX: number; realX: number; jeromeX: number; usableRealM: number }
    > = {
      lestrevet: { softM: 50, theoX: 200, realX: 200, jeromeX: 220, usableRealM: 150 },
      lieue_de_greve: { softM: 50, theoX: 200, realX: 200, jeromeX: 220, usableRealM: 150 },
      pentrez: { softM: 50, theoX: 200, realX: 200, jeromeX: 220, usableRealM: 150 },
    };

    for (const z of ALL_ZONES) {
      const softM = upperMarginByZone[z].marginM;
      const theoX = estimateLitto3dWaterlineXExactM(theoWaterHeightM, z);
      const realX = estimateLitto3dWaterlineXExactM(realWaterHeightM, z);
      const jeromeX = estimateLitto3dWaterlineXExactM(jeromeLimitH, z);
      out[z] = {
        softM,
        theoX,
        realX,
        jeromeX,
        usableRealM: Math.max(0, Math.round(realX - softM)),
      };
    }
    return out;
  }, [upperMarginByZone, theoWaterHeightM, realWaterHeightM, jeromeLimitH]);

  const overlayFocusArea: MapFocusAreaId =
    activeZoneFocus === 'cadre' ? 'bay' : activeZoneFocus;

  const focusedDunePath = useMemo(
    () => getDunePolylineForFocus(overlayFocusArea),
    [overlayFocusArea]
  );

  // Géométries géoréférencées projetées sur la zone sélectionnée (Lestrevet par défaut)
  const softSandPolygon = useMemo(
    () =>
      buildBandPolygonBetweenDistances(
        () => 0,
        z => zoneMetrics[z].softM,
        overlayFocusArea
      ),
    [zoneMetrics, overlayFocusArea]
  );

  const usableBandPolygon = useMemo(
    () =>
      buildBandPolygonBetweenDistances(
        z => zoneMetrics[z].softM,
        z => zoneMetrics[z].realX,
        overlayFocusArea
      ),
    [zoneMetrics, overlayFocusArea]
  );

  const deltaBandPolygon = useMemo(() => {
    if (Math.abs(activeDeltaCm) < 2) return [];
    return buildBandPolygonBetweenDistances(
      z => Math.min(zoneMetrics[z].theoX, zoneMetrics[z].realX),
      z => Math.max(zoneMetrics[z].theoX, zoneMetrics[z].realX),
      overlayFocusArea
    );
  }, [zoneMetrics, activeDeltaCm, overlayFocusArea]);

  const shomWaterlinePath = useMemo(
    () => projectShorelineAlongDune(z => zoneMetrics[z].theoX, overlayFocusArea),
    [zoneMetrics, overlayFocusArea]
  );

  const realWaterlinePath = useMemo(
    () => projectShorelineAlongDune(z => zoneMetrics[z].realX, overlayFocusArea),
    [zoneMetrics, overlayFocusArea]
  );

  const jeromeLimitPath = useMemo(
    () => projectShorelineAlongDune(z => zoneMetrics[z].jeromeX, overlayFocusArea),
    [zoneMetrics, overlayFocusArea]
  );

  const cadreOverlay = useMemo(
    () => buildCadreOverlayGeometry(activeCadre, Math.max(240, zoneMetrics.lestrevet.realX + 35)),
    [activeCadre, zoneMetrics.lestrevet.realX]
  );

  const cadreBounds = useMemo(() => {
    if (!cadreOverlay) return null;
    const pts: LatLngPoint[] = [
      ...cadreOverlay.corridorPolygon,
      ...cadreOverlay.duneBaseline,
      ...cadreOverlay.leftBoundaryRay,
      ...cadreOverlay.rightBoundaryRay,
    ];
    return computePointsBounds(pts, 0.001, 0.0015);
  }, [cadreOverlay]);

  const activeFocusPreset = useMemo(
    () => BAY_CAMERA_PRESETS.find(p => p.id === activeZoneFocus) || BAY_CAMERA_PRESETS[0],
    [activeZoneFocus]
  );

  const lockedBounds = useMemo<LatLngBoundsBox>(() => {
    if (activeZoneFocus === 'cadre' && cadreBounds) {
      return cadreBounds;
    }
    return activeFocusPreset.bounds;
  }, [activeZoneFocus, cadreBounds, activeFocusPreset]);

  const activeZoneFocusLabel =
    activeZoneFocus === 'cadre' && cadreBounds
      ? `Cadre ${cadreKey === 'jerome' ? 'Jérôme' : 'Mairie'}`
      : activeFocusPreset.label;

  // Relevés GPS filtrés avec coordonnées valides en baie
  const visibleGpsLogs = useMemo(() => {
    return gpsLogs
      .filter(log => {
        if (!log || !Number.isFinite(log.latitude) || !Number.isFinite(log.longitude)) return false;
        if (onlySelectedDateLogs && log.dateStr !== dateStr) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [gpsLogs, onlySelectedDateLogs, dateStr]);

  const selectedLog = useMemo(
    () => visibleGpsLogs.find(l => l.id === selectedLogId) || null,
    [visibleGpsLogs, selectedLogId]
  );

  const cadrePins = useMemo(() => {
    if (!activeCadre) return [];
    const pins: Array<{ key: string; short: string; label: string; color: string; lat: number; lng: number }> = [];
    if (activeCadre.dunePointA) {
      pins.push({
        key: 'duneA',
        short: 'DA',
        label: 'Dune A (Repère Sud)',
        color: '#4d7c0f',
        lat: activeCadre.dunePointA.lat,
        lng: activeCadre.dunePointA.lon,
      });
    }
    if (activeCadre.dunePointB) {
      pins.push({
        key: 'duneB',
        short: 'DB',
        label: 'Dune B (Repère Nord)',
        color: '#4d7c0f',
        lat: activeCadre.dunePointB.lat,
        lng: activeCadre.dunePointB.lon,
      });
    }
    if (activeCadre.leftBoundary) {
      pins.push({
        key: 'left',
        short: 'G',
        label: 'Borne Gauche (Sud)',
        color: '#7c3aed',
        lat: activeCadre.leftBoundary.lat,
        lng: activeCadre.leftBoundary.lon,
      });
    }
    if (activeCadre.rightBoundary) {
      pins.push({
        key: 'right',
        short: 'D',
        label: 'Borne Droite (Nord)',
        color: '#7c3aed',
        lat: activeCadre.rightBoundary.lat,
        lng: activeCadre.rightBoundary.lon,
      });
    }
    return pins;
  }, [activeCadre]);

  const triggerCamera = useCallback((cmd: Omit<CameraCommand, 'id'>) => {
    setCameraCommand({ id: Date.now() + Math.random(), ...cmd });
  }, []);

  const handleSelectZoneFocus = (zoneId: ZoneFocusId) => {
    setActiveZoneFocus(zoneId);
    if (zoneId === 'cadre' && cadreBounds) {
      triggerCamera({ fitBounds: cadreBounds });
      return;
    }
    const preset = BAY_CAMERA_PRESETS.find(p => p.id === zoneId) || BAY_CAMERA_PRESETS[0];
    triggerCamera({ fitBounds: preset.bounds });
  };

  const handleCenterOnGpsLogs = () => {
    if (!visibleGpsLogs.length) return;
    setIsViewLocked(false);
    if (visibleGpsLogs.length === 1) {
      triggerCamera({
        center: { lat: visibleGpsLogs[0].latitude, lng: visibleGpsLogs[0].longitude },
        zoom: 17,
      });
      return;
    }
    triggerCamera({
      fitPoints: visibleGpsLogs.map(l => ({ lat: l.latitude, lng: l.longitude })),
    });
  };

  const handleSnapToLogMoment = (log: GpsWaterlineLog) => {
    setDateStr(log.dateStr);
    const logUtcMin = Math.round(log.timestamp / 60000);
    setActiveU(logUtcMin);
    setIsViewLocked(false);
    triggerCamera({
      center: { lat: log.latitude, lng: log.longitude },
      zoom: 17,
    });
  };

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      const ll = ev.detail.latLng;
      if (!ll) return;
      setSelectedLogId(null);
      setSelectedCadrePin(null);

      const zone = classifyBayZone(ll.lat, ll.lng);
      const duneRes = measureDistanceFromBuiltInDuneM(ll.lat, ll.lng);
      const zm = zoneMetrics[zone.zoneId];

      let statusLabel = 'Hors plage / arrière-dune';
      let statusColor = '#64748b';
      if (duneRes) {
        if (duneRes.rawSignedM < 0) {
          statusLabel = `Côté terre (${Math.abs(duneRes.rawSignedM)} m derrière la dune)`;
          statusColor = '#4d7c0f';
        } else if (duneRes.widthFromDuneM <= zm.softM) {
          statusLabel = `Dans la bande de sable mou (0–${zm.softM} m)`;
          statusColor = '#b45309';
        } else if (duneRes.widthFromDuneM <= zm.realX) {
          statusLabel = `Sur la piste roulable utile (${zm.softM}–${Math.round(zm.realX)} m)`;
          statusColor = '#15803d';
        } else {
          statusLabel = `Dans l'eau à ${lc(activeU, y, m, d)} (mer à ${Math.round(zm.realX)} m)`;
          statusColor = '#0369a1';
        }
      }

      setProbePoint({
        lat: ll.lat,
        lng: ll.lng,
        zoneLabel: zone.label,
        zoneId: zone.zoneId,
        distanceFromDuneM: duneRes ? duneRes.widthFromDuneM : null,
        rawSignedM: duneRes ? duneRes.rawSignedM : null,
        statusLabel,
        statusColor,
      });
    },
    [zoneMetrics, activeU, y, m, d]
  );

  const firstBm = dayEx.find(p => !p.pm);
  const firstPm = dayEx.find(p => p.pm);
  const firstSlot = dayPlan.full[0] || dayPlan.extra[0];

  const isWithinJerome = realWaterHeightM <= jeromeLimitH;
  const isSurcote = activeDeltaCm > 0;

  // Rappel coefficient de marée + horaires PM/BM du jour
  const tideInfo = useMemo(() => getNextTideInfo(EX, dateStr), [EX, dateStr]);
  const activeCoef = useMemo(() => getTideCoef(activeU, dateStr), [activeU, dateStr]);
  const coefHeadline = useMemo(() => {
    const vals = tideInfo.pmCoefs.filter(c => Number.isFinite(c));
    if (vals.length >= 2 && vals[0] !== vals[vals.length - 1]) {
      return `${vals[0]} / ${vals[vals.length - 1]}`;
    }
    return String(vals[0] ?? tideInfo.coef ?? activeCoef);
  }, [tideInfo, activeCoef]);
  const coefCategory =
    activeCoef >= 95
      ? { label: 'Grande marée', color: '#b91c1c' }
      : activeCoef >= 80
        ? { label: 'Vives-eaux', color: '#c2410c' }
        : activeCoef >= 55
          ? { label: 'Moyenne', color: '#0369a1' }
          : { label: 'Mortes-eaux', color: '#475569' };
  const pmTimesStr = tideInfo.pmList.map(p => lc(p.t, y, m, d)).join(' · ');
  const bmTimesStr = tideInfo.bmList.map(p => lc(p.t, y, m, d)).join(' · ');

  // Rappel vent à l'heure simulée
  const activeWindSector = useMemo(
    () => (activeWind ? classifyWindSector(activeWind.a) : null),
    [activeWind]
  );
  const activeWindComp = activeWind ? comp(activeWind.a) : null;
  const activeWindKts = activeWind ? Math.round(activeWind.v) : null;
  const activeGustKts =
    activeWind?.g != null && Number.isFinite(activeWind.g) ? Math.round(activeWind.g) : null;

  // Mètres perdus / gagnés sur la plage (Empirique vs SHOM, et marge vs limite Jérôme)
  const activeZoneMetrics = zoneMetrics[activeMetricZone];
  const deltaBeachM = Math.round(activeZoneMetrics.realX - activeZoneMetrics.theoX);
  const jeromeMarginM = Math.round(activeZoneMetrics.realX - activeZoneMetrics.jeromeX);
  const softMarginReason = dayUpperOverride
    ? 'Ajustement manuel du jour'
    : refSoftMargin.source === 'gps_high_mark'
      ? 'Relevé GPS laisse PM'
      : refSoftMargin.source === 'prev_pm_auto'
        ? 'Auto d’après PM précédente'
        : refSoftMargin.shortLabel;
  const metersDeltaBadge =
    deltaBeachM < 0
      ? `−${Math.abs(deltaBeachM)} m perdus`
      : deltaBeachM > 0
        ? `+${deltaBeachM} m gagnés`
        : '0 m perdu';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* En-tête de l'onglet expérimental */}
      <div
        className="card"
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '0.7rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#0369a1',
              }}
            >
              Zone expérimentale · Aucune modification sur l’existant
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
              Test visuel GPS · Superposition sur vue satellite réelle
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#475569' }}>
              Projette en direct la ligne de dune IGN, la bande de sable mou, la piste roulable utile, le bord d’eau SHOM/Empirique, votre Cadre Terrain et vos relevés GPS réels sur la plage de Lestrevet–Pentrez.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#334155',
              }}
            >
              Date :
              <input
                type="date"
                value={dateStr}
                onChange={e => {
                  if (e.target.value) setDateStr(e.target.value);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  background: '#f8fafc',
                }}
              />
            </label>

            <div
              style={{
                display: 'inline-flex',
                borderRadius: '7px',
                border: '1px solid #cbd5e1',
                overflow: 'hidden',
                background: '#f8fafc',
              }}
            >
              {(
                [
                  ['satellite', 'Satellite'],
                  ['hybrid', 'Hybride'],
                  ['roadmap', 'Plan'],
                ] as Array<[MapTypeChoice, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMapTypeId(id)}
                  style={{
                    padding: '5px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer',
                    background: mapTypeId === id ? '#0284c7' : 'transparent',
                    color: mapTypeId === id ? '#ffffff' : '#334155',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Barre horaire interactive + indicateurs clés */}
        <div
          style={{
            marginTop: '12px',
            padding: '10px 12px',
            borderRadius: '10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#334155', whiteSpace: 'nowrap' }}>
              Heure simulée :
            </span>
            <input
              type="range"
              min={t0}
              max={t1}
              step={10}
              value={Math.round(activeU)}
              onChange={e => setActiveU(Number(e.target.value))}
              aria-label="Choisir l'heure projetée sur la carte satellite"
              style={{ flex: 1, minWidth: '180px', cursor: 'pointer', accentColor: '#0284c7' }}
            />
            <span
              style={{
                fontSize: '0.88rem',
                fontWeight: 900,
                color: '#0f172a',
                fontVariantNumeric: 'tabular-nums',
                minWidth: '48px',
                textAlign: 'right',
              }}
            >
              {lc(activeU, y, m, d)}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              {isToday && (
                <button
                  type="button"
                  onClick={() => setActiveU(Math.min(t1, Math.max(t0, Math.round(nowU / 10) * 10)))}
                  style={quickBtnStyle}
                >
                  Maintenant
                </button>
              )}
              {firstBm && (
                <button
                  type="button"
                  onClick={() => setActiveU(Math.min(t1, Math.max(t0, Math.round(firstBm.t / 10) * 10)))}
                  style={quickBtnStyle}
                >
                  BM {lc(firstBm.t, y, m, d)}
                </button>
              )}
              {firstPm && (
                <button
                  type="button"
                  onClick={() => setActiveU(Math.min(t1, Math.max(t0, Math.round(firstPm.t / 10) * 10)))}
                  style={quickBtnStyle}
                >
                  PM {lc(firstPm.t, y, m, d)}
                </button>
              )}
              {firstSlot && (
                <button
                  type="button"
                  onClick={() =>
                    setActiveU(
                      Math.min(t1, Math.max(t0, Math.round(((firstSlot[0] + firstSlot[1]) / 2) / 10) * 10))
                    )
                  }
                  style={quickBtnStyle}
                >
                  Créneau
                </button>
              )}
            </div>
          </div>

          {/* Synthèse chiffrée temps réel : Coeff · Vent · Mètres perdus · Sable mou · Piste utile */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
              gap: '8px',
            }}
          >
            <div style={metricBoxStyle}>
              <div style={metricLabelStyle}>Coeff de marée</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 900, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                  Coef {coefHeadline}
                </span>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: coefCategory.color }}>
                  {coefCategory.label}
                </span>
              </div>
              <div style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                BM {bmTimesStr || '—'} · PM {pmTimesStr || '—'}
              </div>
            </div>

            <div style={metricBoxStyle}>
              <div style={metricLabelStyle}>Vent à {lc(activeU, y, m, d)}</div>
              {activeWind ? (
                <>
                  <div style={{ fontSize: '0.9rem', fontWeight: 900, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                    {activeWindKts} nds {activeWindComp}
                    {activeGustKts != null && activeGustKts > (activeWindKts ?? 0) && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>
                        {' '}
                        · raf. {activeGustKts}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {activeWindSector && (
                      <span
                        style={{
                          fontSize: '0.64rem',
                          fontWeight: 800,
                          color: activeWindSector.fg,
                          background: activeWindSector.bg,
                          border: `1px solid ${activeWindSector.bd}`,
                          borderRadius: '4px',
                          padding: '0 5px',
                        }}
                      >
                        {activeWindSector.shortLabel}
                      </span>
                    )}
                    {activeWind.wvh != null && Number.isFinite(activeWind.wvh) && (
                      <span style={{ fontSize: '0.66rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                        Houle {activeWind.wvh.toFixed(1).replace('.', ',')} m
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#64748b' }}>
                    Non disponible
                  </div>
                  <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginTop: '2px' }}>
                    Hors fenêtre de prévision météo
                  </div>
                </>
              )}
            </div>

            <div style={metricBoxStyle}>
              <div style={metricLabelStyle}>Mètres perdus (Météo vs SHOM)</div>
              <div
                style={{
                  fontSize: '0.9rem',
                  fontWeight: 900,
                  color: deltaBeachM < 0 ? '#c2410c' : deltaBeachM > 0 ? '#047857' : '#334155',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {deltaBeachM < 0
                  ? `−${Math.abs(deltaBeachM)} m perdus`
                  : deltaBeachM > 0
                    ? `+${deltaBeachM} m gagnés`
                    : '0 m perdu'}
              </div>
              <div style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                Mer à {Math.round(activeZoneMetrics.realX)} m dune (SHOM {Math.round(activeZoneMetrics.theoX)} m)
              </div>
            </div>

            <div style={metricBoxStyle}>
              <div style={metricLabelStyle}>Sable mou haut ({activeZoneShortLabel})</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 900, color: '#92400e', fontVariantNumeric: 'tabular-nums' }}>
                  {refSoftMargin.marginM} m
                </span>
                <button
                  type="button"
                  onClick={() => handleAdjustSoftMargin(-5)}
                  style={amberBtnStyle}
                  title="Réduire la bande de sable mou de 5 m pour cette journée"
                >
                  −5 m
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustSoftMargin(5)}
                  style={amberBtnStyle}
                  title="Augmenter la bande de sable mou de 5 m pour cette journée"
                >
                  +5 m
                </button>
                {dayUpperOverride && (
                  <button
                    type="button"
                    onClick={handleResetSoftMargin}
                    style={quickBtnStyle}
                    title="Revenir au calcul automatique depuis la pleine mer précédente"
                  >
                    ↺ Auto
                  </button>
                )}
              </div>
              <div style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '2px' }}>
                {softMarginReason}
              </div>
            </div>

            <div style={metricBoxStyle}>
              <div style={metricLabelStyle}>Piste roulable utile ({activeZoneShortLabel})</div>
              <div
                style={{
                  fontSize: '0.9rem',
                  fontWeight: 900,
                  color: isWithinJerome ? '#15803d' : '#b91c1c',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {activeZoneMetrics.usableRealM} m
              </div>
              <div
                style={{
                  fontSize: '0.66rem',
                  color: isWithinJerome ? '#15803d' : '#b91c1c',
                  fontWeight: 700,
                  marginTop: '2px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {jeromeMarginM >= 0
                  ? `+${jeromeMarginM} m avant limite Jérôme`
                  : `−${Math.abs(jeromeMarginM)} m au-delà limite Jérôme`}
              </div>
            </div>

            <div style={metricBoxStyle}>
              <div style={metricLabelStyle}>Relevés GPS affichés</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 900, color: '#0369a1', fontVariantNumeric: 'tabular-nums' }}>
                {visibleGpsLogs.length} point{visibleGpsLogs.length > 1 ? 's' : ''}
              </div>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '0.68rem',
                  color: '#475569',
                  marginTop: '2px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={onlySelectedDateLogs}
                  onChange={e => setOnlySelectedDateLogs(e.target.checked)}
                />
                Uniquement le {dateStr}
              </label>
            </div>
          </div>
        </div>

        {/* Caméra rapide + Calques */}
        <div
          style={{
            marginTop: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#475569' }}>Zone cadrée :</span>
            {BAY_CAMERA_PRESETS.map(preset => {
              const isActive = activeZoneFocus === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectZoneFocus(preset.id)}
                  style={{
                    ...quickBtnStyle,
                    background: isActive ? '#0284c7' : '#ffffff',
                    color: isActive ? '#ffffff' : '#0f172a',
                    borderColor: isActive ? '#0284c7' : '#cbd5e1',
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
            {cadreBounds && (
              <button
                type="button"
                onClick={() => handleSelectZoneFocus('cadre')}
                style={{
                  ...quickBtnStyle,
                  background: activeZoneFocus === 'cadre' ? '#7c3aed' : '#f5f3ff',
                  color: activeZoneFocus === 'cadre' ? '#ffffff' : '#6d28d9',
                  borderColor: '#a78bfa',
                }}
              >
                Cadre {cadreKey === 'jerome' ? 'Jérôme' : 'Mairie'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsViewLocked(prev => {
                  const next = !prev;
                  if (next) {
                    triggerCamera({ fitBounds: lockedBounds });
                  }
                  return next;
                });
              }}
              style={{
                ...quickBtnStyle,
                background: isViewLocked ? '#0f172a' : '#f8fafc',
                color: isViewLocked ? '#ffffff' : '#334155',
                borderColor: isViewLocked ? '#0f172a' : '#cbd5e1',
              }}
              title={
                isViewLocked
                  ? 'La carte est figée sur la zone choisie (cliquez pour zoomer/déplacer librement dans la baie)'
                  : 'Navigation libre dans la baie (cliquez pour re-figer sur la zone)'
              }
            >
              {isViewLocked ? '🔒 Vue figée' : '🔓 Zoom libre (baie)'}
            </button>
            {visibleGpsLogs.length > 0 && (
              <button
                type="button"
                onClick={handleCenterOnGpsLogs}
                style={{
                  ...quickBtnStyle,
                  borderColor: '#7dd3fc',
                  background: '#f0f9ff',
                  color: '#0369a1',
                }}
              >
                Relevés GPS
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.72rem' }}>
            <span style={{ fontWeight: 800, color: '#475569' }}>Calques :</span>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showDuneLine} onChange={e => setShowDuneLine(e.target.checked)} />
              Dune IGN
            </label>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showSoftSand} onChange={e => setShowSoftSand(e.target.checked)} />
              Sable mou
            </label>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showUsableBand} onChange={e => setShowUsableBand(e.target.checked)} />
              Piste utile
            </label>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showWaterlines} onChange={e => setShowWaterlines(e.target.checked)} />
              SHOM vs Empirique
            </label>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showJeromeLimit} onChange={e => setShowJeromeLimit(e.target.checked)} />
              Limite Jérôme
            </label>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showCadreOverlay} onChange={e => setShowCadreOverlay(e.target.checked)} />
              Cadre Terrain
            </label>
            <label style={layerToggleStyle}>
              <input type="checkbox" checked={showGpsLogs} onChange={e => setShowGpsLogs(e.target.checked)} />
              Relevés GPS
            </label>
            <select
              value={cadreKey}
              onChange={e => setCadreKey(e.target.value as BeachCadreProfileKey)}
              aria-label="Profil Cadre Terrain affiché"
              style={{
                padding: '2px 6px',
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                fontSize: '0.7rem',
                fontWeight: 700,
                background: '#ffffff',
                color: '#334155',
              }}
            >
              <option value="jerome">Cadre : Jérôme</option>
              <option value="mairie">Cadre : Mairie</option>
            </select>
          </div>
        </div>
      </div>

      {/* Conteneur de la carte satellite Google Maps */}
      <div
        className="card"
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          padding: '10px',
        }}
      >
        {!apiKey ? (
          <div
            style={{
              height: '460px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '24px',
              background: '#f8fafc',
              borderRadius: '8px',
              border: '1px dashed #cbd5e1',
              color: '#334155',
            }}
          >
            <div style={{ fontWeight: 900, fontSize: '1rem', marginBottom: '6px' }}>
              Clé Google Maps non détectée dans cet environnement
            </div>
            <div style={{ fontSize: '0.8rem', maxWidth: '480px', lineHeight: 1.5, color: '#64748b' }}>
              Définissez <code>VITE_GOOGLE_MAPS_API_KEY</code> puis redémarrez le serveur pour afficher la vue satellite interactive de la plage.
            </div>
          </div>
        ) : (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '620px',
              minHeight: '440px',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #cbd5e1',
            }}
          >
            {/* Bandeau discret d'état de verrouillage sur la zone */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                zIndex: 4,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 10px',
                borderRadius: '7px',
                background: 'rgba(15, 23, 42, 0.82)',
                color: '#ffffff',
                fontSize: '0.72rem',
                fontWeight: 800,
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.35)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <span>
                {isViewLocked ? `🔒 Figé sur ${activeZoneFocusLabel}` : `🔓 Zone libre · Baie Lestrevet–Pentrez`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsViewLocked(prev => {
                    const next = !prev;
                    if (next) {
                      triggerCamera({ fitBounds: lockedBounds });
                    }
                    return next;
                  });
                }}
                style={{
                  padding: '2px 7px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  background: 'rgba(255, 255, 255, 0.14)',
                  color: '#ffffff',
                  fontSize: '0.66rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {isViewLocked ? 'Déverrouiller' : 'Re-figer'}
              </button>
            </div>

            {/* Rappel compact Coeff · Vent · Mètres perdus directement sur la carte */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                right: '56px',
                zIndex: 4,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                maxWidth: 'calc(100% - 260px)',
                padding: '5px 10px',
                borderRadius: '7px',
                background: 'rgba(15, 23, 42, 0.82)',
                color: '#ffffff',
                fontSize: '0.72rem',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.35)',
                backdropFilter: 'blur(4px)',
                pointerEvents: 'none',
              }}
            >
              <span>Coef {coefHeadline}</span>
              <span style={{ opacity: 0.45 }}>·</span>
              <span>
                {activeWind
                  ? `${activeWindKts} nds ${activeWindComp}${activeWindSector ? ` (${activeWindSector.shortLabel})` : ''}`
                  : 'Vent —'}
              </span>
              <span style={{ opacity: 0.45 }}>·</span>
              <span
                style={{
                  color: deltaBeachM < 0 ? '#fdba74' : deltaBeachM > 0 ? '#6ee7b7' : '#e2e8f0',
                }}
              >
                {metersDeltaBadge}
              </span>
            </div>

            <APIProvider
              apiKey={apiKey}
              libraries={['marker']}
              language="fr"
              region="FR"
            >
              <MapLoadStatusOverlay />
              <GoogleMap
                mapId="DEMO_MAP_ID"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                defaultBounds={{ ...BAY_CAMERA_PRESETS[0].bounds, padding: 16 }}
                mapTypeId={mapTypeId}
                restriction={{
                  latLngBounds: BAY_STRICT_BOUNDS,
                  strictBounds: false,
                }}
                minZoom={14}
                maxZoom={19}
                gestureHandling={isViewLocked ? 'none' : 'greedy'}
                zoomControl={!isViewLocked}
                disableDoubleClickZoom={isViewLocked}
                streetViewControl={false}
                mapTypeControl={false}
                fullscreenControl={true}
                onClick={handleMapClick}
                style={{ width: '100%', height: '100%' }}
              >
                <MapCameraController
                  command={cameraCommand}
                  lockedBounds={lockedBounds}
                  isViewLocked={isViewLocked}
                />

                {/* 1. Bande haute de sable mou (0 -> softSandMarginM) */}
                {showSoftSand && softSandPolygon.length >= 3 && (
                  <Polygon
                    paths={softSandPolygon}
                    fillColor="#f59e0b"
                    fillOpacity={0.22}
                    strokeColor="#f59e0b"
                    strokeOpacity={0.95}
                    strokeWeight={1.8}
                    clickable={false}
                    zIndex={10}
                  />
                )}

                {/* 2. Piste roulable utile (softSandMarginM -> bord d'eau empirique) */}
                {showUsableBand && usableBandPolygon.length >= 3 && (
                  <Polygon
                    paths={usableBandPolygon}
                    fillColor="#22c55e"
                    fillOpacity={0.2}
                    strokeColor="#22c55e"
                    strokeOpacity={0.85}
                    strokeWeight={1.8}
                    clickable={false}
                    zIndex={12}
                  />
                )}

                {/* 3. Zone d'écart Surcote (orange) / Décote (cyan-émeraude) entre SHOM et Empirique */}
                {showWaterlines && deltaBandPolygon.length >= 3 && (
                  <Polygon
                    paths={deltaBandPolygon}
                    fillColor={isSurcote ? '#f97316' : '#10b981'}
                    fillOpacity={0.32}
                    strokeColor={isSurcote ? '#ea580c' : '#059669'}
                    strokeOpacity={0.9}
                    strokeWeight={1.2}
                    clickable={false}
                    zIndex={14}
                  />
                )}

                {/* 4. Ligne de pied de dune IGN/OSM */}
                {showDuneLine && focusedDunePath.length >= 2 && (
                  <Polyline
                    path={focusedDunePath}
                    strokeColor="#84cc16"
                    strokeOpacity={0.95}
                    strokeWeight={3}
                    clickable={false}
                    zIndex={20}
                  />
                )}

                {/* 5. Ligne d'eau SHOM brut (jaune pointillé) */}
                {showWaterlines && shomWaterlinePath.length >= 2 && (
                  <Polyline
                    path={shomWaterlinePath}
                    strokeColor="#facc15"
                    strokeOpacity={0}
                    strokeWeight={3}
                    icons={[
                      {
                        icon: {
                          path: 'M 0,-1 0,1',
                          strokeOpacity: 0.95,
                          scale: 3,
                          strokeColor: '#facc15',
                        },
                        offset: '0',
                        repeat: '14px',
                      },
                    ]}
                    clickable={false}
                    zIndex={22}
                  />
                )}

                {/* 6. Ligne d'eau Modèle Réel Empirique (bleu vif continu) */}
                {showWaterlines && realWaterlinePath.length >= 2 && (
                  <Polyline
                    path={realWaterlinePath}
                    strokeColor="#0ea5e9"
                    strokeOpacity={0.95}
                    strokeWeight={3.2}
                    clickable={false}
                    zIndex={24}
                  />
                )}

                {/* 7. Ligne Limite Jérôme (settings.L, rouge pointillé) */}
                {showJeromeLimit && jeromeLimitPath.length >= 2 && (
                  <Polyline
                    path={jeromeLimitPath}
                    strokeColor="#ef4444"
                    strokeOpacity={0}
                    strokeWeight={2.5}
                    icons={[
                      {
                        icon: {
                          path: 'M 0,-1 0,1',
                          strokeOpacity: 0.95,
                          scale: 2.8,
                          strokeColor: '#ef4444',
                        },
                        offset: '0',
                        repeat: '12px',
                      },
                    ]}
                    clickable={false}
                    zIndex={25}
                  />
                )}

                {/* 8. Cadre Terrain étalonné (Zone Jérôme / Zone Mairie) */}
                {showCadreOverlay && cadreOverlay && (
                  <>
                    {cadreOverlay.corridorPolygon.length >= 3 && (
                      <Polygon
                        paths={cadreOverlay.corridorPolygon}
                        fillColor="#8b5cf6"
                        fillOpacity={0.1}
                        strokeColor="#7c3aed"
                        strokeOpacity={0.9}
                        strokeWeight={2}
                        clickable={false}
                        zIndex={18}
                      />
                    )}
                    {cadreOverlay.duneBaseline.length >= 2 && (
                      <Polyline
                        path={cadreOverlay.duneBaseline}
                        strokeColor="#a855f7"
                        strokeOpacity={0.95}
                        strokeWeight={3}
                        clickable={false}
                        zIndex={26}
                      />
                    )}
                    {cadreOverlay.leftBoundaryRay.length >= 2 && (
                      <Polyline
                        path={cadreOverlay.leftBoundaryRay}
                        strokeColor="#7c3aed"
                        strokeOpacity={0.9}
                        strokeWeight={2.5}
                        clickable={false}
                        zIndex={26}
                      />
                    )}
                    {cadreOverlay.rightBoundaryRay.length >= 2 && (
                      <Polyline
                        path={cadreOverlay.rightBoundaryRay}
                        strokeColor="#7c3aed"
                        strokeOpacity={0.9}
                        strokeWeight={2.5}
                        clickable={false}
                        zIndex={26}
                      />
                    )}
                  </>
                )}

                {/* Marqueurs des repères du Cadre Terrain */}
                {showCadreOverlay &&
                  cadrePins.map(pin => (
                    <AdvancedMarker
                      key={pin.key}
                      position={{ lat: pin.lat, lng: pin.lng }}
                      title={pin.label}
                      onClick={() => {
                        setSelectedLogId(null);
                        setProbePoint(null);
                        setSelectedCadrePin({
                          label: pin.label,
                          detail: `${pin.lat.toFixed(5)}°, ${pin.lng.toFixed(5)}° · Profil ${cadreKey === 'jerome' ? 'Jérôme' : 'Mairie'}`,
                          position: { lat: pin.lat, lng: pin.lng },
                        });
                      }}
                    >
                      <div
                        style={{
                          padding: '2px 6px',
                          borderRadius: '6px',
                          background: pin.color,
                          color: '#ffffff',
                          fontSize: '0.68rem',
                          fontWeight: 900,
                          border: '2px solid #ffffff',
                          boxShadow: '0 2px 6px rgba(15, 23, 42, 0.45)',
                          cursor: 'pointer',
                        }}
                      >
                        {pin.short}
                      </div>
                    </AdvancedMarker>
                  ))}

                {/* 9. Relevés GPS réels (bord d'eau + éventuels points laisse PM) */}
                {showGpsLogs &&
                  visibleGpsLogs.map(log => {
                    const isSelected = selectedLogId === log.id;
                    const isSameDay = log.dateStr === dateStr;
                    const markerBg =
                      log.rawSurcoteCm >= 10
                        ? '#ea580c'
                        : log.rawSurcoteCm <= -10
                          ? '#059669'
                          : '#0284c7';

                    return (
                      <React.Fragment key={log.id}>
                        <AdvancedMarker
                          position={{ lat: log.latitude, lng: log.longitude }}
                          title={`Relevé GPS ${log.dateStr} ${log.timeStr}`}
                          onClick={() => {
                            setSelectedCadrePin(null);
                            setProbePoint(null);
                            setSelectedLogId(log.id);
                          }}
                        >
                          <div
                            style={{
                              width: isSelected ? '18px' : isSameDay ? '15px' : '12px',
                              height: isSelected ? '18px' : isSameDay ? '15px' : '12px',
                              borderRadius: '50%',
                              background: markerBg,
                              border: isSelected ? '3px solid #fef08a' : '2px solid #ffffff',
                              boxShadow: '0 2px 6px rgba(15, 23, 42, 0.55)',
                              cursor: 'pointer',
                            }}
                          />
                        </AdvancedMarker>

                        {log.upperLimitLat != null &&
                          log.upperLimitLon != null &&
                          Number.isFinite(log.upperLimitLat) &&
                          Number.isFinite(log.upperLimitLon) && (
                            <AdvancedMarker
                              position={{ lat: log.upperLimitLat, lng: log.upperLimitLon }}
                              title={`Laisse PM GPS ${log.dateStr}`}
                              onClick={() => {
                                setSelectedCadrePin(null);
                                setProbePoint(null);
                                setSelectedLogId(log.id);
                              }}
                            >
                              <div
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '3px',
                                  background: '#d97706',
                                  border: '2px solid #ffffff',
                                  boxShadow: '0 2px 5px rgba(15, 23, 42, 0.5)',
                                  cursor: 'pointer',
                                }}
                              />
                            </AdvancedMarker>
                          )}
                      </React.Fragment>
                    );
                  })}

                {/* InfoWindow d'un relevé GPS sélectionné */}
                {selectedLog && (() => {
                  const dynEval = activeCadre
                    ? evaluatePointAgainstCadre(selectedLog.latitude, selectedLog.longitude, activeCadre)
                    : null;
                  const resolvedDune = resolveTerrainDuneWidthM(
                    selectedLog.latitude,
                    selectedLog.longitude,
                    dynEval?.widthFromDuneM,
                    selectedLog.measuredWidthFromDuneM
                  );
                  const zone = classifyBayZone(
                    selectedLog.latitude,
                    selectedLog.longitude,
                    dynEval?.lateralPosPct ?? selectedLog.lateralPosPct
                  );
                  const theoXAtLog = Math.round(
                    estimateLitto3dWaterlineXExactM(selectedLog.theoreticalWaterHeightM, zone.zoneId)
                  );
                  const windKts =
                    selectedLog.realWeatherSnapshot?.windSpeedKts ??
                    selectedLog.weatherSnapshot?.windSpeedKts;
                  const windComp =
                    selectedLog.realWeatherSnapshot?.windDirectionComp ??
                    selectedLog.weatherSnapshot?.windDirectionComp;

                  return (
                    <InfoWindow
                      position={{ lat: selectedLog.latitude, lng: selectedLog.longitude }}
                      onCloseClick={() => setSelectedLogId(null)}
                      maxWidth={270}
                    >
                      <div style={{ fontSize: '0.76rem', color: '#0f172a', lineHeight: 1.45 }}>
                        <div style={{ fontWeight: 900, fontSize: '0.82rem', marginBottom: '4px' }}>
                          Relevé GPS · {selectedLog.dateStr} à {selectedLog.timeStr}
                        </div>
                        <div>
                          <b>Zone :</b> {zone.shortLabel} ({selectedLog.author})
                        </div>
                        <div>
                          <b>Distance dune :</b>{' '}
                          {resolvedDune.widthFromDuneM != null
                            ? `${resolvedDune.widthFromDuneM} m`
                            : 'N/A'}{' '}
                          <span style={{ color: '#64748b' }}>(SHOM : {theoXAtLog} m)</span>
                        </div>
                        {resolvedDune.widthFromDuneM != null && (() => {
                          const logDeltaM = Math.round(resolvedDune.widthFromDuneM - theoXAtLog);
                          return (
                            <div>
                              <b>Écart plage vs SHOM :</b>{' '}
                              <span
                                style={{
                                  fontWeight: 800,
                                  color: logDeltaM < 0 ? '#c2410c' : logDeltaM > 0 ? '#047857' : '#334155',
                                }}
                              >
                                {logDeltaM < 0
                                  ? `−${Math.abs(logDeltaM)} m perdus`
                                  : logDeltaM > 0
                                    ? `+${logDeltaM} m gagnés`
                                    : '0 m (conforme SHOM)'}
                              </span>
                            </div>
                          );
                        })()}
                        {selectedLog.upperSoftMarginM != null && (
                          <div>
                            <b>Sable mou retenu :</b> {selectedLog.upperSoftMarginM} m
                          </div>
                        )}
                        <div>
                          <b>Vent :</b> {windKts != null ? `${Math.round(windKts)} nds ${windComp || ''}` : '—'} ·{' '}
                          <b>Précision :</b> ±{Math.round(selectedLog.accuracyM)} m
                        </div>
                        {selectedLog.note && (
                          <div style={{ marginTop: '4px', color: '#334155', fontStyle: 'italic' }}>
                            « {selectedLog.note} »
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSnapToLogMoment(selectedLog)}
                          style={{
                            marginTop: '8px',
                            width: '100%',
                            padding: '5px 8px',
                            borderRadius: '6px',
                            border: 'none',
                            background: '#0284c7',
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Caler la carte sur ce relevé ({selectedLog.timeStr})
                        </button>
                      </div>
                    </InfoWindow>
                  );
                })()}

                {/* InfoWindow d'un repère Cadre Terrain */}
                {selectedCadrePin && (
                  <InfoWindow
                    position={selectedCadrePin.position}
                    onCloseClick={() => setSelectedCadrePin(null)}
                    maxWidth={240}
                  >
                    <div style={{ fontSize: '0.76rem', color: '#0f172a', lineHeight: 1.4 }}>
                      <div style={{ fontWeight: 900 }}>{selectedCadrePin.label}</div>
                      <div style={{ color: '#475569', marginTop: '2px' }}>{selectedCadrePin.detail}</div>
                    </div>
                  </InfoWindow>
                )}

                {/* Sonde interactive au clic sur la plage */}
                {probePoint && (
                  <>
                    <AdvancedMarker
                      position={{ lat: probePoint.lat, lng: probePoint.lng }}
                      title="Point mesuré"
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: '#0f172a',
                          border: '2.5px solid #ffffff',
                          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
                        }}
                      />
                    </AdvancedMarker>
                    <InfoWindow
                      position={{ lat: probePoint.lat, lng: probePoint.lng }}
                      onCloseClick={() => setProbePoint(null)}
                      maxWidth={260}
                    >
                      <div style={{ fontSize: '0.76rem', color: '#0f172a', lineHeight: 1.45 }}>
                        <div style={{ fontWeight: 900, marginBottom: '3px' }}>Mesure au clic</div>
                        <div>
                          <b>Secteur :</b> {probePoint.zoneLabel}
                        </div>
                        <div>
                          <b>Distance pied de dune IGN :</b>{' '}
                          {probePoint.distanceFromDuneM != null
                            ? `${probePoint.distanceFromDuneM} m`
                            : 'Hors baie'}
                        </div>
                        <div style={{ marginTop: '3px', fontWeight: 800, color: probePoint.statusColor }}>
                          {probePoint.statusLabel}
                        </div>
                        <div style={{ marginTop: '3px', fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace' }}>
                          {probePoint.lat.toFixed(5)}, {probePoint.lng.toFixed(5)}
                        </div>
                      </div>
                    </InfoWindow>
                  </>
                )}
              </GoogleMap>
            </APIProvider>
          </div>
        )}

        {/* Légende compacte sous la carte */}
        <div
          style={{
            marginTop: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '0.7rem',
            color: '#475569',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: '#84cc16', height: '3px' }} />
              Pied de dune IGN
            </span>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: 'rgba(245, 158, 11, 0.55)', border: '1px solid #d97706' }} />
              Sable mou
            </span>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: 'rgba(34, 197, 94, 0.45)', border: '1px solid #16a34a' }} />
              Piste roulable utile
            </span>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: '#0ea5e9', height: '3px' }} />
              Mer empirique
            </span>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: '#facc15', height: '3px' }} />
              Mer SHOM brut
            </span>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: '#ef4444', height: '3px' }} />
              Limite Jérôme ({Math.round(activeZoneMetrics.jeromeX)} m dune)
            </span>
            <span style={legendItemStyle}>
              <span style={{ ...legendSwatchStyle, background: '#7c3aed', height: '3px' }} />
              Cadre Terrain
            </span>
          </div>
          <span style={{ color: '#64748b' }}>
            Astuce : cliquez n’importe où sur la plage pour mesurer la distance au pied de dune, ou sur un point GPS pour recaler la carte à son heure exacte.
          </span>
        </div>
      </div>
    </div>
  );
};

const quickBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: '0.68rem',
  fontWeight: 800,
  borderRadius: '5px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#0f172a',
  cursor: 'pointer',
};

const amberBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '0.66rem',
  fontWeight: 800,
  borderRadius: '4px',
  border: '1px solid #fcd34d',
  background: '#fffbeb',
  color: '#92400e',
  cursor: 'pointer',
};

const metricBoxStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '7px 10px',
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  fontWeight: 700,
  color: '#64748b',
  marginBottom: '2px',
};

const layerToggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: '#334155',
  fontWeight: 700,
  cursor: 'pointer',
};

const legendItemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  fontWeight: 700,
};

const legendSwatchStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '14px',
  height: '10px',
  borderRadius: '2px',
};
