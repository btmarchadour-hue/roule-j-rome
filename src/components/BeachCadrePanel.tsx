import React, { useMemo, useState } from 'react';
import {
  BeachCadreConfig,
  BeachCadreProfile,
  BeachCadreProfileKey,
  BeachReferencePoint,
  GpsWaterlineLog,
} from '../types';
import {
  computeCadreGeometry,
  evaluatePointAgainstCadre,
  formatCoordsShort,
  latLonToLocalMeters,
  parseLatLonInput,
} from '../utils/beachCadreEngine';
import { requestCalibratedStationaryGps } from '../utils/waterlineGpsEngine';

type SlotKey = 'dunePointA' | 'dunePointB' | 'leftBoundary' | 'rightBoundary';

interface SlotDescriptor {
  key: SlotKey;
  title: string;
  subtitle: string;
  defaultLabel: string;
  group: 'dune' | 'corridor';
}

const SLOTS: SlotDescriptor[] = [
  {
    key: 'dunePointA',
    title: 'Dune · Point A (Origine Zéro côté Sud / Lestrevet)',
    subtitle: 'Pied de dune ou ligne de départ définie avec Jérôme (côté gauche face mer).',
    defaultLabel: 'Pied de dune Lestrevet',
    group: 'dune',
  },
  {
    key: 'dunePointB',
    title: 'Dune · Point B (Alignement côté Nord / Pentrez)',
    subtitle: '2e point au pied de dune (≥ 200 m plus au Nord) pour verrouiller l’axe exact.',
    defaultLabel: 'Pied de dune Nord',
    group: 'dune',
  },
  {
    key: 'leftBoundary',
    title: 'Limite Côté Gauche (Sud / Lestrevet)',
    subtitle: 'En regardant la mer : extrémité gauche de la zone de roulage.',
    defaultLabel: 'Borne Gauche (Sud)',
    group: 'corridor',
  },
  {
    key: 'rightBoundary',
    title: 'Limite Côté Droit (Nord / Pentrez)',
    subtitle: 'En regardant la mer : extrémité droite de la zone de roulage.',
    defaultLabel: 'Borne Droite (Nord)',
    group: 'corridor',
  },
];

interface BeachCadrePanelProps {
  config: BeachCadreConfig;
  logs: GpsWaterlineLog[];
  author: string;
  isReadOnly?: boolean;
  onSaveConfig: (next: BeachCadreConfig) => Promise<void>;
}

export const BeachCadrePanel: React.FC<BeachCadrePanelProps> = ({
  config,
  logs,
  author,
  isReadOnly = false,
  onSaveConfig,
}) => {
  const [editingProfileKey, setEditingProfileKey] = useState<BeachCadreProfileKey>(
    config.activeProfile || 'jerome'
  );
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // GPS static calibration state
  const [calibratingSlot, setCalibratingSlot] = useState<SlotKey | null>(null);
  const [calibProgress, setCalibProgress] = useState<{
    current: number;
    total: number;
    lastAcc: number;
  } | null>(null);
  const [calibFeedback, setCalibFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  // Manual coordinate edit state
  const [manualSlot, setManualSlot] = useState<SlotKey | null>(null);
  const [manualCoordStr, setManualCoordStr] = useState<string>('');
  const [manualLabelStr, setManualLabelStr] = useState<string>('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const selectedProfile: BeachCadreProfile = config.profiles[editingProfileKey];
  const otherProfileKey: BeachCadreProfileKey = editingProfileKey === 'jerome' ? 'mairie' : 'jerome';
  const otherProfile: BeachCadreProfile = config.profiles[otherProfileKey];
  const activeProfile: BeachCadreProfile = config.profiles[config.activeProfile];

  const selectedGeom = useMemo(() => computeCadreGeometry(selectedProfile), [selectedProfile]);
  const otherGeom = useMemo(() => computeCadreGeometry(otherProfile), [otherProfile]);

  const latestMeasuredWidth = useMemo(() => {
    if (logs.length === 0) return null;
    const latest = logs[0];
    const ev = evaluatePointAgainstCadre(latest.latitude, latest.longitude, selectedProfile);
    if (ev.widthFromDuneM == null) return null;
    const soft = selectedProfile.softSandMarginM ?? 0;
    return {
      totalM: ev.widthFromDuneM,
      usableM: Math.max(0, ev.widthFromDuneM - soft),
      lateralPct: ev.lateralPosPct,
      lateralM: ev.lateralPosFromLeftM,
      isInside: ev.isInsideZone,
      log: latest,
    };
  }, [logs, selectedProfile]);

  const persistProfileUpdate = async (
    profileKey: BeachCadreProfileKey,
    patch: Partial<BeachCadreProfile>,
    nextActiveProfile?: BeachCadreProfileKey
  ) => {
    setIsSaving(true);
    try {
      const next: BeachCadreConfig = {
        ...config,
        activeProfile: nextActiveProfile ?? config.activeProfile,
        profiles: {
          ...config.profiles,
          [profileKey]: {
            ...config.profiles[profileKey],
            ...patch,
            updatedAt: Date.now(),
            updatedBy: author,
          },
        },
        updatedAt: Date.now(),
        updatedBy: author,
      };
      await onSaveConfig(next);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetActiveProfile = async (key: BeachCadreProfileKey) => {
    if (isReadOnly) return;
    setEditingProfileKey(key);
    if (config.activeProfile !== key) {
      await persistProfileUpdate(key, {}, key);
      setCalibFeedback({
        type: 'ok',
        msg: `Référentiel actif basculé sur : ${key === 'jerome' ? 'Zone Jérôme (École)' : 'Zone Mairie (AOT)'}.`,
      });
    }
  };

  const handleGpsCalibrateSlot = async (slot: SlotDescriptor) => {
    if (isReadOnly || calibratingSlot) return;
    setCalibratingSlot(slot.key);
    setCalibProgress({ current: 1, total: 10, lastAcc: 0 });
    setCalibFeedback(null);
    setManualSlot(null);

    try {
      const gps = await requestCalibratedStationaryGps(10, 1500, (curr, tot, acc) => {
        setCalibProgress({ current: curr, total: tot, lastAcc: acc });
      });

      const point: BeachReferencePoint = {
        lat: gps.latitude,
        lon: gps.longitude,
        accuracyM: gps.accuracyM,
        samplesCount: gps.samplesUsed || 10,
        label: selectedProfile[slot.key]?.label || slot.defaultLabel,
        source: 'gps_calib',
        updatedAt: Date.now(),
        updatedBy: author,
      };

      await persistProfileUpdate(editingProfileKey, { [slot.key]: point });
      setCalibFeedback({
        type: 'ok',
        msg: `✓ ${slot.title} enregistré (${gps.latitude.toFixed(5)}°, ${gps.longitude.toFixed(5)}° · ±${gps.accuracyM} m sur ${gps.samplesUsed || 10} mesures).`,
      });
    } catch (err: any) {
      setCalibFeedback({
        type: 'err',
        msg: err?.message || 'Impossible de capter le signal GPS pour ce repère.',
      });
    } finally {
      setCalibratingSlot(null);
      setCalibProgress(null);
    }
  };

  const handleOpenManualEdit = (slot: SlotDescriptor) => {
    if (isReadOnly) return;
    const existing = selectedProfile[slot.key];
    setManualSlot(slot.key);
    setManualCoordStr(existing ? `${existing.lat}, ${existing.lon}` : '');
    setManualLabelStr(existing?.label || slot.defaultLabel);
    setManualError(null);
    setCalibFeedback(null);
  };

  const handleSaveManualEdit = async (slot: SlotDescriptor) => {
    if (isReadOnly) return;
    const parsed = parseLatLonInput(manualCoordStr);
    if ('error' in parsed) {
      setManualError(parsed.error);
      return;
    }

    const point: BeachReferencePoint = {
      lat: parsed.lat,
      lon: parsed.lon,
      accuracyM: null,
      samplesCount: 1,
      label: manualLabelStr.trim() || slot.defaultLabel,
      source: 'manual',
      updatedAt: Date.now(),
      updatedBy: author,
    };

    await persistProfileUpdate(editingProfileKey, { [slot.key]: point });
    setManualSlot(null);
    setManualError(null);
    setCalibFeedback({
      type: 'ok',
      msg: parsed.warning
        ? `Repère enregistré avec avertissement : ${parsed.warning}`
        : `✓ ${slot.title} mis à jour (${parsed.lat.toFixed(5)}°, ${parsed.lon.toFixed(5)}°).`,
    });
  };

  const handleClearSlot = async (slot: SlotDescriptor) => {
    if (isReadOnly) return;
    if (!window.confirm(`Effacer le repère « ${slot.title} » du cadre ${editingProfileKey === 'jerome' ? 'Jérôme' : 'Mairie'} ?`)) {
      return;
    }
    await persistProfileUpdate(editingProfileKey, { [slot.key]: null });
  };

  const handleCopyDuneToOther = async () => {
    if (isReadOnly) return;
    if (!selectedProfile.dunePointA && !selectedProfile.dunePointB) return;
    const targetName = otherProfileKey === 'mairie' ? 'Zone Mairie' : 'Zone Jérôme';
    await persistProfileUpdate(otherProfileKey, {
      dunePointA: selectedProfile.dunePointA,
      dunePointB: selectedProfile.dunePointB,
    });
    setCalibFeedback({
      type: 'ok',
      msg: `✓ Ligne de Dune copiée vers « ${targetName} ». Il ne reste qu'à définir ses bornes Gauche/Droite.`,
    });
  };

  // Construction du plan SVG 2D top-down du Cadre Terrain
  const svgPlan = useMemo(() => {
    if (!selectedGeom.originLat || !selectedGeom.originLon) return null;

    const originLat = selectedGeom.originLat;
    const originLon = selectedGeom.originLon;
    const { tangent, seaNormal } = selectedGeom;

    const projectPt = (lat: number, lon: number) => {
      const m = latLonToLocalMeters(lat, lon, originLat, originLon);
      return {
        s: m.e * tangent.e + m.n * tangent.n,      // le long de la plage (Gauche -> Droite)
        w: m.e * seaNormal.e + m.n * seaNormal.n,  // distance vers la mer depuis la dune
      };
    };

    const sValues: number[] = [0];
    const wValues: number[] = [0, 320];

    const leftProj = selectedProfile.leftBoundary
      ? projectPt(selectedProfile.leftBoundary.lat, selectedProfile.leftBoundary.lon)
      : null;
    const rightProj = selectedProfile.rightBoundary
      ? projectPt(selectedProfile.rightBoundary.lat, selectedProfile.rightBoundary.lon)
      : null;

    if (leftProj) sValues.push(leftProj.s);
    if (rightProj) sValues.push(rightProj.s);

    const otherLeftProj = otherProfile.leftBoundary
      ? projectPt(otherProfile.leftBoundary.lat, otherProfile.leftBoundary.lon)
      : null;
    const otherRightProj = otherProfile.rightBoundary
      ? projectPt(otherProfile.rightBoundary.lat, otherProfile.rightBoundary.lon)
      : null;
    if (otherLeftProj) sValues.push(otherLeftProj.s);
    if (otherRightProj) sValues.push(otherRightProj.s);

    const duneAProj = selectedProfile.dunePointA
      ? projectPt(selectedProfile.dunePointA.lat, selectedProfile.dunePointA.lon)
      : null;
    const duneBProj = selectedProfile.dunePointB
      ? projectPt(selectedProfile.dunePointB.lat, selectedProfile.dunePointB.lon)
      : null;
    if (duneAProj) sValues.push(duneAProj.s);
    if (duneBProj) sValues.push(duneBProj.s);

    const recentWaterLogs = logs.slice(0, 10).map(log => ({
      log,
      pt: projectPt(log.latitude, log.longitude),
    }));
    recentWaterLogs.forEach(({ pt }) => {
      sValues.push(pt.s);
      wValues.push(Math.max(50, pt.w + 40));
    });

    const minS = Math.min(...sValues) - 80;
    const maxS = Math.max(...sValues) + 80;
    const spanS = Math.max(200, maxS - minS);
    const maxW = Math.min(750, Math.max(350, ...wValues));

    const svgW = 720;
    const svgH = 260;
    const padX = 56;
    const padTop = 36;
    const padBottom = 38;
    const plotW = svgW - padX * 2;
    const plotH = svgH - padTop - padBottom;

    // Axe X SVG = le long de la plage (Gauche = Sud/Lestrevet, Droite = Nord/Pentrez)
    // Axe Y SVG = distance perpendiculaire (Haut = Dune 0m, Bas = Mer)
    const mapS = (s: number) => padX + ((s - minS) / spanS) * plotW;
    const mapW = (w: number) => padTop + Math.max(-12, Math.min(maxW, w)) / maxW * plotH;

    const sZoneMin =
      leftProj && rightProj ? Math.min(leftProj.s, rightProj.s) : minS + 80;
    const sZoneMax =
      leftProj && rightProj ? Math.max(leftProj.s, rightProj.s) : maxS - 80;

    const otherZoneMin =
      otherLeftProj && otherRightProj ? Math.min(otherLeftProj.s, otherRightProj.s) : null;
    const otherZoneMax =
      otherLeftProj && otherRightProj ? Math.max(otherLeftProj.s, otherRightProj.s) : null;

    const latestLogW = recentWaterLogs.length > 0 ? Math.max(40, recentWaterLogs[0].pt.w) : 260;

    return {
      svgW,
      svgH,
      padX,
      padTop,
      plotW,
      plotH,
      mapS,
      mapW,
      leftProj,
      rightProj,
      duneAProj,
      duneBProj,
      sZoneMin,
      sZoneMax,
      otherZoneMin,
      otherZoneMax,
      recentWaterLogs,
      latestLogW,
      softMarginW: selectedProfile.softSandMarginM ?? 0,
    };
  }, [selectedGeom, selectedProfile, otherProfile, logs]);

  const calibratedPointsCount = [
    selectedProfile.dunePointA,
    selectedProfile.dunePointB,
    selectedProfile.leftBoundary,
    selectedProfile.rightBoundary,
  ].filter(Boolean).length;

  return (
    <div
      className="card"
      style={{
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '14px',
        padding: '18px 20px',
        marginBottom: '20px',
      }}
    >
      {/* EN-TÊTE CADRE TERRAIN */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '12px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.72rem', color: '#475569', fontWeight: 700 }}>
            <span style={{ color: '#0369a1', fontWeight: 800 }}>Référentiel Terrain Fixe</span>
            <span aria-hidden="true">·</span>
            <span>{calibratedPointsCount}/4 repères enregistrés</span>
            <span aria-hidden="true">·</span>
            <span>
              Référence active :{' '}
              <strong style={{ color: '#0f172a' }}>
                {config.activeProfile === 'jerome' ? 'Zone Jérôme (École)' : 'Zone Mairie (AOT)'}
              </strong>
            </span>
          </div>
          <h2 style={{ margin: '4px 0 0', fontSize: '1.12rem', fontWeight: 900, color: '#0f172a' }}>
            Cadre de Roulage : Ligne de Dune & Limites Gauche / Droite
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Sélecteur de profil Mairie vs Jérôme */}
          <div
            style={{
              display: 'inline-flex',
              background: '#f1f5f9',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
            }}
          >
            <button
              type="button"
              onClick={() => setEditingProfileKey('jerome')}
              style={{
                border: 'none',
                background: editingProfileKey === 'jerome' ? '#0f172a' : 'transparent',
                color: editingProfileKey === 'jerome' ? '#ffffff' : '#475569',
                fontWeight: 800,
                fontSize: '0.74rem',
                padding: '7px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Zone Jérôme {config.activeProfile === 'jerome' ? '★' : ''}
            </button>
            <button
              type="button"
              onClick={() => setEditingProfileKey('mairie')}
              style={{
                border: 'none',
                background: editingProfileKey === 'mairie' ? '#0f172a' : 'transparent',
                color: editingProfileKey === 'mairie' ? '#ffffff' : '#475569',
                fontWeight: 800,
                fontSize: '0.74rem',
                padding: '7px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Zone Mairie (AOT) {config.activeProfile === 'mairie' ? '★' : ''}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsCollapsed(v => !v)}
            style={{
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              borderRadius: '8px',
              padding: '7px 12px',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isCollapsed ? 'Afficher le calibrage' : 'Réduire'}
          </button>
        </div>
      </div>

      {/* BARRE DE SYNTHÈSE GÉOMÉTRIQUE (TOUJOURS VISIBLE) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: '12px',
          marginTop: '14px',
          padding: '12px 14px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
        }}
      >
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b' }}>
            Longueur de roulage ({editingProfileKey === 'jerome' ? 'Jérôme' : 'Mairie'})
          </div>
          <div
            style={{
              fontSize: '1.35rem',
              fontWeight: 900,
              color: selectedGeom.corridorLengthM ? '#0f172a' : '#94a3b8',
              fontVariantNumeric: 'tabular-nums',
              marginTop: '2px',
            }}
          >
            {selectedGeom.corridorLengthM != null ? `${selectedGeom.corridorLengthM} m` : 'À définir'}
          </div>
          {otherGeom.corridorLengthM != null && (
            <div style={{ fontSize: '0.68rem', color: '#475569' }}>
              {otherProfileKey === 'mairie' ? 'Mairie' : 'Jérôme'} : {otherGeom.corridorLengthM} m
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b' }}>
            Axe Dune / Orientation Mer
          </div>
          <div
            style={{
              fontSize: '1.05rem',
              fontWeight: 900,
              color: '#0f172a',
              fontVariantNumeric: 'tabular-nums',
              marginTop: '4px',
            }}
          >
            {selectedGeom.beachAzimuthDeg}° ↔ {(selectedGeom.beachAzimuthDeg + 180) % 360}°
          </div>
          <div style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>
            {selectedGeom.hasFullDuneLine
              ? `Calibré (${selectedGeom.duneBaselineLengthM} m) · Mer ${selectedGeom.seawardAzimuthDeg}°`
              : selectedGeom.hasDuneOrigin
              ? `1 point dune · Axe par défaut · Mer ${selectedGeom.seawardAzimuthDeg}°`
              : 'En attente de la ligne de dune'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b' }}>
            Dernière largeur Dune → Mer
          </div>
          <div
            style={{
              fontSize: '1.35rem',
              fontWeight: 900,
              color: latestMeasuredWidth ? '#15803d' : '#94a3b8',
              fontVariantNumeric: 'tabular-nums',
              marginTop: '2px',
            }}
          >
            {latestMeasuredWidth ? `${latestMeasuredWidth.totalM} m` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#475569' }}>
            {latestMeasuredWidth
              ? `Utile (hors ${selectedProfile.softSandMarginM ?? 0}m mou) : ${latestMeasuredWidth.usableM} m`
              : 'Nécessite 1 point Dune + 1 point Mer'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
          {config.activeProfile !== editingProfileKey ? (
            <button
              type="button"
              disabled={isReadOnly || isSaving}
              onClick={() => handleSetActiveProfile(editingProfileKey)}
              style={{
                padding: '9px 12px',
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.74rem',
                fontWeight: 800,
                cursor: isReadOnly ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Activer ce cadre pour les relevés
            </button>
          ) : (
            <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#15803d' }}>
              ✓ Cadre actif pour les calculs Mer
            </div>
          )}
          <div style={{ fontSize: '0.66rem', color: '#64748b' }}>
            {activeProfile.updatedAt
              ? `MàJ ${new Date(activeProfile.updatedAt).toLocaleDateString('fr-FR')} par ${activeProfile.updatedBy || 'Jérôme'}`
              : 'Synchronisé dans Firestore'}
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <div style={{ marginTop: '16px' }}>
          {/* Barre d'état / erreur / action rapide */}
          {calibFeedback && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '0.80rem',
                fontWeight: 700,
                background: calibFeedback.type === 'ok' ? '#f0fdf4' : '#fef2f2',
                border: calibFeedback.type === 'ok' ? '1px solid #86efac' : '1px solid #fca5a5',
                color: calibFeedback.type === 'ok' ? '#166534' : '#991b1b',
              }}
            >
              {calibFeedback.msg}
            </div>
          )}

          {selectedGeom.boundariesSwappedWarning && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                color: '#92400e',
              }}
            >
              ⚠️ La borne Gauche semble située au Nord de la borne Droite (face à la mer, Gauche = Sud/Lestrevet, Droite = Nord/Pentrez). Vérifiez vos 2 bornes si besoin.
            </div>
          )}

          {/* PROGRESSION CAPTURE STATIQUE 20s */}
          {calibratingSlot && calibProgress && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                marginBottom: '14px',
                background: '#f0f9ff',
                border: '1px solid #7dd3fc',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.78rem', fontWeight: 800, color: '#0369a1' }}>
                <span>
                  Étalonnage fixe en cours (restez immobile) : mesure {calibProgress.current} / {calibProgress.total}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {calibProgress.lastAcc > 0 ? `±${calibProgress.lastAcc} m` : 'Acquisition…'}
                </span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0f2fe', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(calibProgress.current / calibProgress.total) * 100}%`,
                    height: '100%',
                    background: '#0284c7',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* ACTIONS UTILITAIRES DUNE & MARGE SABLE MOU */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label
                htmlFor="soft-sand-margin-input"
                style={{ fontSize: '0.74rem', fontWeight: 800, color: '#334155' }}
              >
                Marge sable mou haut de dune :
              </label>
              <input
                id="soft-sand-margin-input"
                type="number"
                min={0}
                max={150}
                step={5}
                disabled={isReadOnly}
                value={selectedProfile.softSandMarginM ?? 30}
                onChange={e =>
                  persistProfileUpdate(editingProfileKey, {
                    softSandMarginM: Math.max(0, Math.min(150, Number(e.target.value) || 0)),
                  })
                }
                style={{
                  width: '74px',
                  padding: '5px 8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>mètres</span>
            </div>

            {(selectedProfile.dunePointA || selectedProfile.dunePointB) && (
              <button
                type="button"
                disabled={isReadOnly || isSaving}
                onClick={handleCopyDuneToOther}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#0369a1',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  cursor: isReadOnly ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Copier cette ligne de Dune vers « {otherProfileKey === 'mairie' ? 'Mairie' : 'Jérôme'} »
              </button>
            )}
          </div>

          {/* GRILLE DES 4 REPÈRES FIXES (DUNE A, DUNE B, GAUCHE, DROITE) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
              gap: '12px',
              marginBottom: '18px',
            }}
          >
            {SLOTS.map(slot => {
              const pt = selectedProfile[slot.key];
              const isManualOpen = manualSlot === slot.key;
              const isCalibratingThis = calibratingSlot === slot.key;

              return (
                <div
                  key={slot.key}
                  style={{
                    border: pt ? '1px solid #86efac' : '1px solid #cbd5e1',
                    background: pt ? '#f9fefb' : '#ffffff',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div style={{ fontSize: '0.84rem', fontWeight: 900, color: '#0f172a' }}>
                        {slot.title}
                      </div>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          color: pt ? '#15803d' : '#64748b',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pt ? '✓ Enregistré' : 'À définir'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', lineHeight: 1.35 }}>
                      {slot.subtitle}
                    </div>

                    {pt && (
                      <div
                        style={{
                          marginTop: '8px',
                          paddingTop: '8px',
                          borderTop: '1px solid #e2e8f0',
                          fontSize: '0.74rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                            {formatCoordsShort(pt)}
                          </span>
                          <a
                            href={`https://www.google.com/maps?q=${pt.lat},${pt.lon}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '0.70rem', fontWeight: 700, color: '#0284c7', textDecoration: 'underline' }}
                          >
                            Carte ↗
                          </a>
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: '3px' }}>
                          {pt.label || slot.defaultLabel}
                          {pt.accuracyM != null && ` · ±${pt.accuracyM} m`}
                          {pt.samplesCount && pt.samplesCount > 1 ? ` (${pt.samplesCount} mes.)` : ''}
                          {pt.source === 'manual' ? ' · Saisie carte' : ' · GPS terrain'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* FORMULAIRE SAISIE MANUELLE */}
                  {isManualOpen ? (
                    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder="Lat, Lon (ex: 48.18372, -4.29441)"
                        value={manualCoordStr}
                        onChange={e => setManualCoordStr(e.target.value)}
                        style={{
                          padding: '7px 9px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          fontFamily: 'monospace',
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Repère visuel (ex: Poteau bois Parking)"
                        value={manualLabelStr}
                        onChange={e => setManualLabelStr(e.target.value)}
                        style={{
                          padding: '7px 9px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                        }}
                      />
                      {manualError && (
                        <div style={{ fontSize: '0.70rem', color: '#dc2626', fontWeight: 700 }}>
                          {manualError}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleSaveManualEdit(slot)}
                          disabled={isSaving}
                          style={{
                            flex: 1,
                            padding: '8px 10px',
                            background: '#0284c7',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Enregistrer
                        </button>
                        <button
                          type="button"
                          onClick={() => setManualSlot(null)}
                          style={{
                            padding: '8px 10px',
                            background: '#f1f5f9',
                            color: '#475569',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={isReadOnly || Boolean(calibratingSlot) || isSaving}
                        onClick={() => handleGpsCalibrateSlot(slot)}
                        style={{
                          flex: '1 1 auto',
                          minHeight: '38px',
                          padding: '7px 10px',
                          background: isCalibratingThis ? '#94a3b8' : '#0284c7',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '7px',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: isReadOnly || Boolean(calibratingSlot) ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isCalibratingThis ? 'Mesure GPS…' : '📍 GPS sur place (10 mes.)'}
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly || Boolean(calibratingSlot)}
                        onClick={() => handleOpenManualEdit(slot)}
                        style={{
                          minHeight: '38px',
                          padding: '7px 10px',
                          background: '#f8fafc',
                          color: '#334155',
                          border: '1px solid #cbd5e1',
                          borderRadius: '7px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: isReadOnly ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ✏️ Saisir GPS
                      </button>
                      {pt && !isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleClearSlot(slot)}
                          title="Effacer ce repère"
                          style={{
                            minHeight: '38px',
                            padding: '7px 9px',
                            background: '#ffffff',
                            color: '#94a3b8',
                            border: '1px solid #e2e8f0',
                            borderRadius: '7px',
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* PLAN GÉOMÉTRIQUE 2D DU CADRE & PROJECTION DES POINTS MER */}
          {svgPlan ? (
            <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '12px 14px', overflowX: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px', fontSize: '0.72rem', color: '#475569' }}>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>
                  Schéma du Cadre « {editingProfileKey === 'jerome' ? 'Jérôme' : 'Mairie'} » (Haut = Dune Zéro · Bas = Front de mer · Gauche = Sud Lestrevet · Droite = Nord Pentrez)
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {svgPlan.recentWaterLogs.length} dernier(s) relevé(s) mer projetés
                </span>
              </div>

              <svg
                viewBox={`0 0 ${svgPlan.svgW} ${svgPlan.svgH}`}
                style={{ width: '100%', minWidth: '580px', height: 'auto', display: 'block', borderRadius: '8px', background: '#fef9c3' }}
              >
                {/* Bande Dune (y < padTop) */}
                <rect x={0} y={0} width={svgPlan.svgW} height={svgPlan.padTop} fill="#bef264" />
                <line
                  x1={0}
                  y1={svgPlan.padTop}
                  x2={svgPlan.svgW}
                  y2={svgPlan.padTop}
                  stroke="#3f6212"
                  strokeWidth={2}
                />
                <text x={12} y={22} fill="#365314" fontSize="10" fontWeight="900">
                  LIGNE DE DUNE (0 m · Repère fixe)
                </text>

                {/* Zone mer approximative (sous la dernière mesure d'eau ou 260m par défaut) */}
                <rect
                  x={0}
                  y={svgPlan.mapW(svgPlan.latestLogW)}
                  width={svgPlan.svgW}
                  height={svgPlan.svgH - svgPlan.mapW(svgPlan.latestLogW)}
                  fill="#0284c7"
                  opacity={0.85}
                />
                <line
                  x1={0}
                  y1={svgPlan.mapW(svgPlan.latestLogW)}
                  x2={svgPlan.svgW}
                  y2={svgPlan.mapW(svgPlan.latestLogW)}
                  stroke="#ffffff"
                  strokeWidth={2.5}
                />
                <text
                  x={svgPlan.svgW - 14}
                  y={svgPlan.mapW(svgPlan.latestLogW) + 16}
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="800"
                  textAnchor="end"
                >
                  MER · Limite basse ({Math.round(svgPlan.latestLogW)} m depuis dune)
                </text>

                {/* Marge sable mou haut de plage */}
                {svgPlan.softMarginW > 0 && (
                  <g>
                    <rect
                      x={0}
                      y={svgPlan.padTop}
                      width={svgPlan.svgW}
                      height={Math.max(0, svgPlan.mapW(svgPlan.softMarginW) - svgPlan.padTop)}
                      fill="#fef08a"
                      opacity={0.65}
                    />
                    <line
                      x1={0}
                      y1={svgPlan.mapW(svgPlan.softMarginW)}
                      x2={svgPlan.svgW}
                      y2={svgPlan.mapW(svgPlan.softMarginW)}
                      stroke="#d97706"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  </g>
                )}

                {/* Autre cadre en pointillés comparatifs (ex: Mairie vs Jérôme) */}
                {svgPlan.otherZoneMin != null && svgPlan.otherZoneMax != null && (
                  <rect
                    x={svgPlan.mapS(svgPlan.otherZoneMin)}
                    y={svgPlan.padTop}
                    width={Math.max(4, svgPlan.mapS(svgPlan.otherZoneMax) - svgPlan.mapS(svgPlan.otherZoneMin))}
                    height={svgPlan.mapW(svgPlan.latestLogW) - svgPlan.padTop}
                    fill="none"
                    stroke="#64748b"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                  />
                )}

                {/* Rectangle actif du Cadre de Roulage (Gauche -> Droite) */}
                {selectedGeom.hasLeftBoundary && selectedGeom.hasRightBoundary && (
                  <g>
                    <rect
                      x={svgPlan.mapS(svgPlan.sZoneMin)}
                      y={svgPlan.mapW(svgPlan.softMarginW)}
                      width={Math.max(6, svgPlan.mapS(svgPlan.sZoneMax) - svgPlan.mapS(svgPlan.sZoneMin))}
                      height={Math.max(10, svgPlan.mapW(svgPlan.latestLogW) - svgPlan.mapW(svgPlan.softMarginW))}
                      fill="#22c55e"
                      fillOpacity={0.22}
                      stroke="#15803d"
                      strokeWidth={2}
                    />
                    <text
                      x={(svgPlan.mapS(svgPlan.sZoneMin) + svgPlan.mapS(svgPlan.sZoneMax)) / 2}
                      y={svgPlan.padTop + 18}
                      fill="#14532d"
                      fontSize="10.5"
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      Couloir « {editingProfileKey === 'jerome' ? 'Jérôme' : 'Mairie'} » · Longueur {selectedGeom.corridorLengthM} m
                    </text>
                  </g>
                )}

                {/* Points Dune A & B */}
                {svgPlan.duneAProj && (
                  <g>
                    <circle cx={svgPlan.mapS(svgPlan.duneAProj.s)} cy={svgPlan.padTop} r={5} fill="#15803d" stroke="#fff" strokeWidth={1.5} />
                    <text x={svgPlan.mapS(svgPlan.duneAProj.s)} y={svgPlan.padTop - 8} fill="#14532d" fontSize="8.5" fontWeight="800" textAnchor="middle">
                      Dune A
                    </text>
                  </g>
                )}
                {svgPlan.duneBProj && (
                  <g>
                    <circle cx={svgPlan.mapS(svgPlan.duneBProj.s)} cy={svgPlan.padTop} r={5} fill="#15803d" stroke="#fff" strokeWidth={1.5} />
                    <text x={svgPlan.mapS(svgPlan.duneBProj.s)} y={svgPlan.padTop - 8} fill="#14532d" fontSize="8.5" fontWeight="800" textAnchor="middle">
                      Dune B
                    </text>
                  </g>
                )}

                {/* Bornes Gauche & Droite */}
                {svgPlan.leftProj && (
                  <g>
                    <line
                      x1={svgPlan.mapS(svgPlan.leftProj.s)}
                      y1={svgPlan.padTop}
                      x2={svgPlan.mapS(svgPlan.leftProj.s)}
                      y2={svgPlan.svgH - 20}
                      stroke="#dc2626"
                      strokeWidth={2}
                    />
                    <circle cx={svgPlan.mapS(svgPlan.leftProj.s)} cy={svgPlan.mapW(svgPlan.leftProj.w)} r={5} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
                    <text x={svgPlan.mapS(svgPlan.leftProj.s)} y={svgPlan.svgH - 8} fill="#991b1b" fontSize="9" fontWeight="900" textAnchor="middle">
                      ◀ Gauche (Sud)
                    </text>
                  </g>
                )}
                {svgPlan.rightProj && (
                  <g>
                    <line
                      x1={svgPlan.mapS(svgPlan.rightProj.s)}
                      y1={svgPlan.padTop}
                      x2={svgPlan.mapS(svgPlan.rightProj.s)}
                      y2={svgPlan.svgH - 20}
                      stroke="#dc2626"
                      strokeWidth={2}
                    />
                    <circle cx={svgPlan.mapS(svgPlan.rightProj.s)} cy={svgPlan.mapW(svgPlan.rightProj.w)} r={5} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
                    <text x={svgPlan.mapS(svgPlan.rightProj.s)} y={svgPlan.svgH - 8} fill="#991b1b" fontSize="9" fontWeight="900" textAnchor="middle">
                      Droite (Nord) ▶
                    </text>
                  </g>
                )}

                {/* Derniers relevés GPS Mer projetés */}
                {svgPlan.recentWaterLogs.map(({ log, pt }, i) => {
                  const cx = svgPlan.mapS(pt.s);
                  const cy = svgPlan.mapW(pt.w);
                  const isLatest = i === 0;
                  return (
                    <g key={log.id}>
                      {isLatest && (
                        <line
                          x1={cx}
                          y1={svgPlan.padTop}
                          x2={cx}
                          y2={cy}
                          stroke="#0f172a"
                          strokeWidth={1.5}
                          strokeDasharray="3 2"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isLatest ? 5.5 : 4}
                        fill={isLatest ? '#ffc40d' : '#f59e0b'}
                        stroke="#0f172a"
                        strokeWidth={1.5}
                      />
                      {isLatest && (
                        <text
                          x={cx + 8}
                          y={Math.max(svgPlan.padTop + 28, cy - 6)}
                          fill="#0f172a"
                          fontSize="9"
                          fontWeight="900"
                        >
                          {Math.round(pt.w)} m ({log.timeStr})
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <div
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: '1px dashed #cbd5e1',
                background: '#f8fafc',
                fontSize: '0.78rem',
                color: '#475569',
                textAlign: 'center',
              }}
            >
              Enregistrez au moins <strong>Dune · Point A</strong> (sur place au GPS ou en saisissant les coordonnées) pour activer le plan 2D et le calcul automatique de la largeur de roulage depuis la dune.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
