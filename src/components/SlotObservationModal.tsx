import React, { useState, useEffect } from 'react';
import { CancellationReason, MAX_CHARS_PER_INSTRUCTOR, SlotObservation } from '../types';
import { CANCELLATION_REASONS_INFO, upsertSlotObservation, deleteSlotObservation } from '../utils/statisticsEngine';
import { getActiveInstructor, saveObservationToFirestore, deleteObservationFromFirestore } from '../utils/firebaseSync';
import {
  DEFAULT_NON_PUBLISH_REASONS,
  getMonitorBadgeStyle,
  stripReasonAccents,
} from '../utils/cycleHelpers';

interface SlotObservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
  slotKey: string;
  slotStart: string;
  slotEnd: string;
  slotTitle?: string;
  isCustom?: boolean;
  defaultPressure?: number | null;
  defaultWindKts?: number | null;
  defaultGustKts?: number | null;
  defaultWindDir?: string | null;
  defaultWaveH?: number | null;
  initialObservation?: SlotObservation | null;
  onSaveSuccess: (
    updatedList: SlotObservation[],
    savedObs?: SlotObservation,
    deletedObs?: SlotObservation
  ) => void;
  isReadOnly?: boolean;
  maxChars?: number;
  primaryInstructor?: string;
  secondaryInstructor?: string;
  currentUserName?: string;
  customNonPublishReasons?: string[];
  defaultStatus?: 'realized' | 'cancelled';
  defaultCancellationReason?: CancellationReason;
  defaultCancellationNote?: string;
  defaultMonoCount?: number;
  defaultBiCount?: number;
  defaultParticipantsCount?: number;
  defaultBookedParticipantsCount?: number;
  agendaBookedPeopleCount?: number;
  forceIntent?: boolean;
}

export const SlotObservationModal: React.FC<SlotObservationModalProps> = ({
  isOpen,
  onClose,
  dateStr,
  slotKey,
  slotStart,
  slotEnd,
  slotTitle,
  isCustom,
  defaultPressure,
  defaultWindKts,
  defaultGustKts,
  defaultWindDir,
  defaultWaveH,
  initialObservation,
  onSaveSuccess,
  isReadOnly = false,
  maxChars = MAX_CHARS_PER_INSTRUCTOR,
  primaryInstructor = 'Jérôme',
  secondaryInstructor,
  currentUserName,
  customNonPublishReasons,
  defaultStatus,
  defaultCancellationReason,
  defaultCancellationNote,
  defaultMonoCount,
  defaultBiCount,
  defaultParticipantsCount,
  defaultBookedParticipantsCount,
  agendaBookedPeopleCount,
  forceIntent = false,
}) => {
  const activeBookedClientsCount = Math.max(
    agendaBookedPeopleCount ?? 0,
    defaultBookedParticipantsCount ?? 0
  );
  const isNoClientsLocked = activeBookedClientsCount > 0;
  const [status, setStatus] = useState<'realized' | 'cancelled'>(
    forceIntent && defaultStatus
      ? defaultStatus
      : initialObservation?.status || defaultStatus || 'realized'
  );
  const [cancellationReason, setCancellationReason] = useState<CancellationReason>(
    forceIntent && defaultCancellationReason
      ? defaultCancellationReason
      : initialObservation?.cancellationReason || defaultCancellationReason || 'wind_low'
  );
  const [cancellationNote, setCancellationNote] = useState<string>(
    initialObservation?.cancellationNote || defaultCancellationNote || ''
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setConfirmDelete(false);
    }
  }, [isOpen, initialObservation?.id]);

  // Écarts réels (vides par défaut si non mesurés)
  const [actualPassableTime, setActualPassableTime] = useState<string>(
    initialObservation?.actualPassableTime || ''
  );
  const [timeDeltaMin, setTimeDeltaMin] = useState<number | ''>(
    initialObservation?.timeDeltaMin ?? ''
  );
  const [waterDeltaCm, setWaterDeltaCm] = useState<number | ''>(
    initialObservation?.waterDeltaCm ?? ''
  );
  const [actualWaterHeight, setActualWaterHeight] = useState<number | ''>(
    initialObservation?.actualWaterHeight ?? ''
  );

  // Météo réelle (laisser vide si non renseigné : aucune valeur par défaut imposée)
  const [observedPressure, setObservedPressure] = useState<number | ''>(
    initialObservation?.observedPressure ?? defaultPressure ?? ''
  );
  const [observedWindKts, setObservedWindKts] = useState<number | ''>(
    initialObservation?.observedWindKts ?? defaultWindKts ?? ''
  );
  const [observedGustKts, setObservedGustKts] = useState<number | ''>(
    initialObservation?.observedGustKts ?? defaultGustKts ?? ''
  );
  const [observedWindDir, setObservedWindDir] = useState<string>(
    initialObservation?.observedWindDir ?? defaultWindDir ?? ''
  );
  const [observedWaveH, setObservedWaveH] = useState<number | ''>(
    initialObservation?.observedWaveH ?? defaultWaveH ?? ''
  );
  const [beachCondition, setBeachCondition] = useState<SlotObservation['beachCondition'] | undefined>(
    initialObservation?.beachCondition
  );

  // Bilan participants
  const [participantsCount, setParticipantsCount] = useState<number | ''>(
    initialObservation?.participantsCount ??
      (defaultParticipantsCount && defaultParticipantsCount > 0 ? defaultParticipantsCount : '')
  );
  const [monoCount, setMonoCount] = useState<number | ''>(
    initialObservation?.monoCount ??
      (defaultMonoCount && defaultMonoCount > 0 ? defaultMonoCount : '')
  );
  const [biCount, setBiCount] = useState<number | ''>(
    initialObservation?.biCount ??
      (defaultBiCount && defaultBiCount > 0 ? defaultBiCount : '')
  );
  // Demande Jérôme : Inscrits sur séances annulées & replacés / perdus
  const [bookedParticipantsCount, setBookedParticipantsCount] = useState<number | ''>(
    initialObservation?.bookedParticipantsCount ??
      (defaultBookedParticipantsCount && defaultBookedParticipantsCount > 0
        ? defaultBookedParticipantsCount
        : '')
  );
  const [rescheduledCount, setRescheduledCount] = useState<number | ''>(
    initialObservation?.rescheduledCount ?? ''
  );
  const [lostCount, setLostCount] = useState<number | ''>(
    initialObservation?.lostCount ?? ''
  );
  const [notes, setNotes] = useState<string>(initialObservation?.notes || '');

  const hasInitialWeatherOrBeach = Boolean(
    initialObservation?.observedPressure != null ||
      initialObservation?.observedWindKts != null ||
      initialObservation?.observedGustKts != null ||
      initialObservation?.observedWindDir ||
      initialObservation?.observedWaveH != null ||
      initialObservation?.beachCondition ||
      defaultPressure != null ||
      defaultWindKts != null ||
      defaultGustKts != null ||
      defaultWindDir ||
      defaultWaveH != null
  );
  const initialIsNoClients =
    (forceIntent && defaultStatus ? defaultStatus : initialObservation?.status || defaultStatus) ===
      'cancelled' &&
    (forceIntent && defaultCancellationReason
      ? defaultCancellationReason
      : initialObservation?.cancellationReason || defaultCancellationReason) === 'no_clients';
  const [weatherExpanded, setWeatherExpanded] = useState<boolean>(
    !initialIsNoClients || hasInitialWeatherOrBeach
  );

  const handlePassableTimeChange = (val: string) => {
    setActualPassableTime(val);
    if (!val || !slotStart) return;
    try {
      const [hS, mS] = slotStart.replace('h', ':').split(':').map(Number);
      const [hA, mA] = val.replace('h', ':').split(':').map(Number);
      if (Number.isNaN(hS) || Number.isNaN(mS) || Number.isNaN(hA) || Number.isNaN(mA)) return;
      const minStart = hS * 60 + mS;
      const minActual = hA * 60 + mA;
      setTimeDeltaMin(minActual - minStart);
    } catch {
      // ignore
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // GARDE-FOU MÉTIER INVIOLABLE (Règle Benoît & Jérôme) :
    // En char à voile, les stagiaires/clients au volant sont les "pilotes".
    // Une séance validée ou marquée "Réalisée" DOIT obligatoirement avoir au moins 1 participant (pilote) !
    // Si 0 inscrit, elle relève de "Vie 2 : Pas d'inscrits" et doit être enregistrée comme Annulée.
    const computedChars = (Number(monoCount) || 0) + (Number(biCount) || 0);
    if (status === 'realized') {
      const pCount = participantsCount === '' ? 0 : Number(participantsCount);
      if (pCount <= 0 && computedChars <= 0) {
        setErrorMessage(
          '⛔ Règle métier stricte : Une séance ne peut JAMAIS être enregistrée comme "Réalisée" avec 0 participant (pilote) ! S\'il n\'y avait aucun participant inscrit, cochez "Séance Annulée / Non roulée" avec le motif "Pas d\'inscrits (Vie 2)".'
        );
        return;
      }

      const charCountToCheck = monoCount !== '' || biCount !== '' ? computedChars : pCount;
      if (charCountToCheck > maxChars) {
        setErrorMessage(
          `⛔ Blocage sécurité encadrement : ${charCountToCheck} chars engagés pour un plafond strict de ${maxChars} chars (${
            secondaryInstructor ? `${primaryInstructor} + ${secondaryInstructor}` : '1 moniteur'
          }). Réduisez le nombre de chars à ${maxChars} max${
            monoCount === '' && biCount === ''
              ? ' (ou détaillez Monoplaces + Biplaces)'
              : !secondaryInstructor
              ? ' ou doublez d’abord le créneau avec un 2e moniteur (Youenn CQP 20 / Katleen 24) en Cycle 2'
              : ''
          }.`
        );
        return;
      }
    } else if (cancellationReason === 'no_clients' && isNoClientsLocked) {
      setErrorMessage(
        `⛔ Impossible : déjà ${activeBookedClientsCount} inscrit${
          activeBookedClientsCount > 1 ? 's' : ''
        } sur ce créneau. Choisissez un motif d'annulation météo/client ou retirez d'abord les inscriptions.`
      );
      return;
    }

    const effectiveChars =
      monoCount !== '' || biCount !== ''
        ? computedChars
        : participantsCount !== ''
        ? Number(participantsCount)
        : undefined;

    const effectiveParticipants =
      participantsCount !== ''
        ? Number(participantsCount)
        : computedChars > 0
        ? (Number(monoCount) || 0) + (Number(biCount) || 0) * 2
        : undefined;

    const obs: SlotObservation = {
      id: initialObservation?.id || `obs-${dateStr}-${slotKey}`,
      ds: dateStr,
      slotKey,
      slotStart,
      slotEnd,
      isCustom,
      customTitle: slotTitle || initialObservation?.customTitle,
      status,
      cancellationReason: status === 'cancelled' ? cancellationReason : undefined,
      cancellationNote: status === 'cancelled' ? cancellationNote : undefined,
      bookedParticipantsCount:
        status === 'cancelled' && bookedParticipantsCount !== ''
          ? Number(bookedParticipantsCount)
          : undefined,
      rescheduledCount:
        status === 'cancelled' && rescheduledCount !== ''
          ? Number(rescheduledCount)
          : undefined,
      lostCount:
        status === 'cancelled' && lostCount !== ''
          ? Number(lostCount)
          : undefined,
      actualPassableTime: status === 'realized' && actualPassableTime ? actualPassableTime : undefined,
      timeDeltaMin: status === 'realized' && timeDeltaMin !== '' ? Number(timeDeltaMin) : undefined,
      waterDeltaCm: status === 'realized' && waterDeltaCm !== '' ? Number(waterDeltaCm) : undefined,
      actualWaterHeight: status === 'realized' && actualWaterHeight !== '' ? Number(actualWaterHeight) : undefined,
      observedPressure: observedPressure !== '' ? Number(observedPressure) : undefined,
      observedWindKts: observedWindKts !== '' ? Number(observedWindKts) : undefined,
      observedGustKts: observedGustKts !== '' ? Number(observedGustKts) : undefined,
      observedWindDir: observedWindDir || undefined,
      observedWaveH: observedWaveH !== '' ? Number(observedWaveH) : undefined,
      beachCondition: beachCondition || undefined,
      charsCount: status === 'realized' ? effectiveChars : undefined,
      participantsCount: status === 'realized' ? effectiveParticipants : undefined,
      monoCount: status === 'realized' && monoCount !== '' ? Number(monoCount) : undefined,
      biCount: status === 'realized' && biCount !== '' ? Number(biCount) : undefined,
      notes: notes.trim() || undefined,
      author: initialObservation?.author || currentUserName || getActiveInstructor() || 'Jérôme',
      secondaryInstructor: secondaryInstructor || initialObservation?.secondaryInstructor || undefined,
      createdAt: initialObservation?.createdAt || Date.now(),
    };

    const updated = upsertSlotObservation(obs);
    // Synchro Cloud Firestore en tâche de fond pour Jérôme et l'ensemble des appareils
    saveObservationToFirestore(obs).catch(err => console.warn('Erreur envoi Firestore observation:', err));
    onSaveSuccess(updated, obs);
    onClose();
  };

  const executeDelete = () => {
    if (!initialObservation?.id) return;
    const deletedObs = initialObservation;
    const updated = deleteSlotObservation(deletedObs.id);
    deleteObservationFromFirestore(deletedObs.id).catch(err => console.warn('Erreur suppression Firestore observation:', err));
    onSaveSuccess(updated, undefined, deletedObs);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          maxWidth: '620px',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1.5px solid #e2e8f0',
            background: '#0f172a',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#38bdf8', fontWeight: 800 }}>
              Observatoire Terrain & Bilan Séance · Lestrevet
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: '1.05rem', fontWeight: 900, color: '#fff' }}>
              {dateStr} · {slotStart} – {slotEnd} {slotTitle ? `(${slotTitle})` : ''}
            </h3>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '5px', alignItems: 'center' }}>
              {(() => {
                const pStyle = getMonitorBadgeStyle(primaryInstructor);
                const sStyle = secondaryInstructor ? getMonitorBadgeStyle(secondaryInstructor) : null;
                return (
                  <>
                    <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 800, background: pStyle.bg, color: pStyle.fg, border: `1px solid ${pStyle.bd}` }}>
                      👤 {primaryInstructor}
                    </span>
                    {secondaryInstructor && sStyle && (
                      <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 800, background: sStyle.bg, color: sStyle.fg, border: `1px solid ${sStyle.bd}` }}>
                        👤 {secondaryInstructor} (2e moniteur)
                      </span>
                    )}
                    {currentUserName && (
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600 }}>
                        · Saisi par {currentUserName}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.25rem',
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} style={{ overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!isReadOnly && (
            <div
              style={{
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                color: '#0369a1',
                padding: '7px 10px',
                borderRadius: '7px',
                fontSize: '0.73rem',
                fontWeight: 700,
              }}
            >
              ⚡ Écran unique : la décision (Séance effectuée / Annulée Vie 2 / Pas d&apos;inscrit) et le REX sont enregistrés en une seule fois.
            </div>
          )}
          {errorMessage && (
            <div
              style={{
                background: '#fef2f2',
                border: '1.5px solid #ef4444',
                color: '#991b1b',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                lineHeight: 1.45,
                fontWeight: 700,
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🚨</span>
              <div>
                <strong>Validation bloquée :</strong>
                <div style={{ marginTop: '2px', fontWeight: 600 }}>{errorMessage}</div>
              </div>
            </div>
          )}

          {/* Statut Réalisée / Annulée */}
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#475569', display: 'block', marginBottom: '6px' }}>
              Statut de la séance :
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setStatus('realized')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: status === 'realized' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                  background: status === 'realized' ? '#f0fdf4' : '#f8fafc',
                  color: status === 'realized' ? '#166534' : '#64748b',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <span>✓</span>
                <span>Séance Réalisée</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStatus('cancelled');
                  if (bookedParticipantsCount === '' && activeBookedClientsCount > 0) {
                    setBookedParticipantsCount(activeBookedClientsCount);
                  }
                  if (isNoClientsLocked && cancellationReason === 'no_clients') {
                    setCancellationReason('wind_low');
                    setWeatherExpanded(true);
                  }
                }}
                style={{
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: status === 'cancelled' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                  background: status === 'cancelled' ? '#fef2f2' : '#f8fafc',
                  color: status === 'cancelled' ? '#991b1b' : '#64748b',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <span>⛔</span>
                <span>Séance Non Réalisée / Annulée</span>
              </button>
            </div>
          </div>

          {/* SI ANNULÉE : MOTIFS DU CAMEMBERT */}
          {status === 'cancelled' && (
            <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '12px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#991b1b', display: 'block', marginBottom: '8px' }}>
                Cause principale de non-réalisation (pour le camembert statistique) :
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '6px' }}>
                {(Object.keys(CANCELLATION_REASONS_INFO) as CancellationReason[]).map(r => {
                  const info = CANCELLATION_REASONS_INFO[r];
                  const isSelected = cancellationReason === r;
                  const disabledNoClients = r === 'no_clients' && isNoClientsLocked;
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={disabledNoClients}
                      onClick={() => {
                        if (disabledNoClients) return;
                        setCancellationReason(r);
                        if (r !== 'no_clients') {
                          setWeatherExpanded(true);
                        }
                      }}
                      title={
                        disabledNoClients
                          ? `Impossible : déjà ${activeBookedClientsCount} inscrit${
                              activeBookedClientsCount > 1 ? 's' : ''
                            } sur ce créneau`
                          : info.label
                      }
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: isSelected ? `2px solid ${info.color}` : '1px solid #cbd5e1',
                        background: disabledNoClients ? '#f1f5f9' : isSelected ? '#fff' : '#f8fafc',
                        color: disabledNoClients ? '#94a3b8' : isSelected ? '#0f172a' : '#475569',
                        opacity: disabledNoClients ? 0.55 : 1,
                        fontWeight: isSelected ? 800 : 600,
                        fontSize: '0.75rem',
                        cursor: disabledNoClients ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{info.icon}</span>
                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {info.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>

              {cancellationReason === 'instructor' && (
                <div style={{ marginTop: '10px', background: '#fff', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 10px' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#991b1b', marginBottom: '6px' }}>
                    Préciser le motif de fermeture / indisponibilité (pour les statistiques) :
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {(() => {
                      const base: string[] = [...DEFAULT_NON_PUBLISH_REASONS];
                      const seen = new Set(base.map(stripReasonAccents));
                      for (const c of customNonPublishReasons || []) {
                        const t = c.trim();
                        const k = stripReasonAccents(t);
                        if (t && k !== 'ferme' && !seen.has(k)) {
                          seen.add(k);
                          base.push(t);
                        }
                      }
                      return base.map(reasonLabel => {
                        const active =
                          stripReasonAccents(cancellationNote) === stripReasonAccents(reasonLabel);
                        return (
                          <button
                            key={reasonLabel}
                            type="button"
                            onClick={() => setCancellationNote(reasonLabel)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '5px',
                              border: active ? '1.5px solid #991b1b' : '1px solid #cbd5e1',
                              background: active ? '#fee2e2' : '#f8fafc',
                              color: active ? '#7f1d1d' : '#334155',
                              fontSize: '0.70rem',
                              fontWeight: active ? 800 : 600,
                              cursor: 'pointer',
                            }}
                          >
                            {reasonLabel}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              <div style={{ marginTop: '10px' }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: '#7f1d1d', display: 'block', marginBottom: '2px' }}>
                  {cancellationReason === 'instructor'
                    ? 'Détail / Motif libre de fermeture :'
                    : 'Précisions / Observations du moniteur (facultatif) :'}
                </label>
                <input
                  type="text"
                  value={cancellationNote}
                  onChange={e => setCancellationNote(e.target.value)}
                  placeholder={
                    cancellationReason === 'instructor'
                      ? 'ex: Réunion mairie, impératif personnel, vacances...'
                      : 'ex: Rafales à 36 nds, sable trop mou près du ruisseau...'
                  }
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid #f87171',
                    fontSize: '0.78rem',
                    background: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* DEMANDE DE JÉRÔME : IMPACT CLIENTS & SAUVETAGE COMMERCIAL */}
              <div style={{ marginTop: '12px', background: '#fff', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span>👥</span>
                    <span>Suivi des inscrits impactés (Demande Jérôme)</span>
                  </div>
                  {cancellationReason === 'no_clients' ? (
                    <span style={{ fontSize: '0.65rem', background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      Vie 2 · Pas d&apos;inscrits
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.65rem', background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      Vie 2 · Session engagée
                    </span>
                  )}
                </div>

                {cancellationReason === 'no_clients' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#991b1b', background: '#fef2f2', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fecaca', lineHeight: '1.35' }}>
                      ℹ️ <strong>Séance annulée · Pas d&apos;inscrits (Vie 2)</strong> : aucun client n&apos;avait réservé sur ce créneau publié. Elle est comptabilisée séparément des annulations météo.
                    </div>
                    {!isReadOnly && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="submit"
                          style={{
                            padding: '7px 13px',
                            borderRadius: '6px',
                            border: 'none',
                            background: '#dc2626',
                            color: '#fff',
                            fontSize: '0.76rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          ⚡ Valider « Pas d&apos;inscrits (Vie 2) » en 1 clic
                        </button>
                        <button
                          type="button"
                          onClick={() => setWeatherExpanded(prev => !prev)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: weatherExpanded ? '#e0f2fe' : '#f8fafc',
                            color: weatherExpanded ? '#0369a1' : '#334155',
                            fontSize: '0.73rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {weatherExpanded
                            ? '▲ Masquer météo / plage'
                            : '🧭 + Saisir vent / pression / plage (facultatif)'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <p style={{ margin: '0 0 8px', fontSize: '0.70rem', color: '#64748b' }}>
                      Mesurez les personnes que vous n'avez pas pu faire rouler et celles que vous avez réussi à replacer :
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#991b1b', display: 'block', marginBottom: '2px' }}>
                          Inscrits prévus
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={bookedParticipantsCount}
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Number(e.target.value);
                            setBookedParticipantsCount(val);
                            if (val !== '' && rescheduledCount !== '') {
                              setLostCount(Math.max(0, val - Number(rescheduledCount)));
                            }
                          }}
                          placeholder="ex: 8"
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', border: '1.5px solid #f87171', fontSize: '0.82rem', fontWeight: 700, color: '#991b1b', boxSizing: 'border-box' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#15803d', display: 'block', marginBottom: '2px' }}>
                          Dont replacés 🔄
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={rescheduledCount}
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Number(e.target.value);
                            setRescheduledCount(val);
                            if (bookedParticipantsCount !== '' && val !== '') {
                              setLostCount(Math.max(0, Number(bookedParticipantsCount) - val));
                            }
                          }}
                          placeholder="ex: 6"
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', border: '1.5px solid #86efac', fontSize: '0.82rem', fontWeight: 700, color: '#15803d', boxSizing: 'border-box' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#b91c1c', display: 'block', marginBottom: '2px' }}>
                          Dont perdus ❌
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={lostCount}
                          onChange={e => setLostCount(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="ex: 2"
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', border: '1.5px solid #cbd5e1', fontSize: '0.82rem', fontWeight: 700, color: '#b91c1c', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* SI RÉALISÉE : MESURE DES ÉCARTS RÉELS & CONDITIONS PHYSIQUES */}
          {status === 'realized' && (
            <>
              {/* 1. Écart d'horaires & Surcote d'eau */}
              <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#166534', marginBottom: '8px' }}>
                  🌊 Écart constaté : Marée & Roulage effectif (facultatif)
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '2px' }}>
                      Accès réel au sable
                    </label>
                    <input
                      type="time"
                      value={actualPassableTime}
                      onChange={e => handlePassableTimeChange(e.target.value)}
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '2px' }}>
                      Écart horaire (min)
                    </label>
                    <input
                      type="number"
                      value={timeDeltaMin}
                      onChange={e => setTimeDeltaMin(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="ex: -15 (vide si N/A)"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '2px' }}>
                      Surcote observée (cm)
                    </label>
                    <input
                      type="number"
                      value={waterDeltaCm}
                      onChange={e => setWaterDeltaCm(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="ex: +20 (vide si N/A)"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '2px' }}>
                      Hauteur d'eau réelle (m)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={actualWaterHeight}
                      onChange={e => setActualWaterHeight(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="ex: 4.45"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              {/* 3. Bilan chars & participants (Règle dynamique 12 chars/moniteur ou 20/24 si doublé) */}
              {(() => {
                const liveChars = (Number(monoCount) || 0) + (Number(biCount) || 0);
                const overLimit = liveChars > maxChars;
                const noCharsYet = liveChars <= 0 && (participantsCount === '' || Number(participantsCount) <= 0);
                return (
                  <div
                    style={{
                      background: overLimit ? '#fef2f2' : noCharsYet ? '#fff7ed' : '#f8fafc',
                      border: overLimit ? '1.5px solid #dc2626' : noCharsYet ? '1.5px solid #f97316' : '1.5px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
                        🏎️ Chars Sortis (Plafond {maxChars} chars{secondaryInstructor ? ` · ${primaryInstructor} + ${secondaryInstructor}` : ' / moniteur'}) &amp; Personnes
                      </div>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 900,
                          color: overLimit ? '#fff' : liveChars > 0 ? '#166534' : '#c2410c',
                          background: overLimit ? '#dc2626' : liveChars > 0 ? '#dcfce7' : '#ffedd5',
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        {liveChars} / {maxChars} chars
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#0369a1', display: 'block', marginBottom: '2px' }}>
                          Monoplaces (1 char)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={maxChars}
                          value={monoCount}
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Number(e.target.value);
                            setMonoCount(val);
                            const nextMono = val === '' ? 0 : val;
                            const nextBi = biCount === '' ? 0 : Number(biCount);
                            if (nextMono + nextBi > 0) {
                              setParticipantsCount(nextMono + nextBi * 2);
                            }
                            setErrorMessage(null);
                          }}
                          placeholder="ex: 8"
                          style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #7dd3fc', fontSize: '0.82rem', fontWeight: 700, boxSizing: 'border-box' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#0369a1', display: 'block', marginBottom: '2px' }}>
                          Biplaces (1 char)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={maxChars}
                          value={biCount}
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Number(e.target.value);
                            setBiCount(val);
                            const nextMono = monoCount === '' ? 0 : Number(monoCount);
                            const nextBi = val === '' ? 0 : val;
                            if (nextMono + nextBi > 0) {
                              setParticipantsCount(nextMono + nextBi * 2);
                            }
                            setErrorMessage(null);
                          }}
                          placeholder="ex: 2"
                          style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #7dd3fc', fontSize: '0.82rem', fontWeight: 700, boxSizing: 'border-box' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '2px' }}>
                          Personnes / Pilotes <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={participantsCount}
                          onChange={e => {
                            setParticipantsCount(e.target.value === '' ? '' : Number(e.target.value));
                            setErrorMessage(null);
                          }}
                          placeholder="ex: 12"
                          style={{
                            width: '100%',
                            padding: '5px 8px',
                            borderRadius: '4px',
                            border: noCharsYet ? '2px solid #ea580c' : '1px solid #cbd5e1',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            background: '#fff',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>

                    {overLimit && (
                      <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#991b1b', background: '#fee2e2', border: '1px solid #fca5a5', padding: '7px 10px', borderRadius: '6px', fontWeight: 800 }}>
                        ⛔ Blocage encadrement : plafond strict de {maxChars} chars dépassé ({liveChars}/{maxChars} chars). Enregistrement bloqué
                        {!secondaryInstructor
                          ? ' — réduisez sous 12 chars ou doublez d’abord le créneau avec un 2e moniteur (Youenn CQP 20 / Katleen 24) en Cycle 2.'
                          : ` (${primaryInstructor} + ${secondaryInstructor}).`}
                      </div>
                    )}

                    {noCharsYet && (
                      <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#c2410c', background: '#ffedd5', padding: '6px 10px', borderRadius: '6px', fontWeight: 600 }}>
                        ⚠️ <strong>Attention Jérôme :</strong> Une séance réalisée doit avoir au moins 1 char (mono ou bi). S&apos;il n&apos;y avait aucun inscrit, classez en « Séance Annulée » motif « Pas d&apos;inscrits (Vie 2) ».
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {/* PARAMÈTRES MÉTÉO & MER RÉELS (DISPONIBLE POUR SÉANCES RÉALISÉES ET ANNULÉES) */}
          {weatherExpanded && (
          <div style={{ background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
                🧭 Conditions Météo & Plage observées (facultatif)
              </div>
              <span style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 600 }}>
                Laissez vide si non relevé (aucune valeur fictive enregistrée)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                  Pression (hPa)
                </label>
                <input
                  type="number"
                  value={observedPressure}
                  onChange={e => setObservedPressure(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="ex: 1013"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box', background: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                  Vent réel (nds)
                </label>
                <input
                  type="number"
                  min={0}
                  value={observedWindKts}
                  onChange={e => setObservedWindKts(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="ex: 9"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box', background: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                  Rafales (nds)
                </label>
                <input
                  type="number"
                  min={0}
                  value={observedGustKts}
                  onChange={e => setObservedGustKts(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="ex: 14"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box', background: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                  Direction
                </label>
                <select
                  value={observedWindDir}
                  onChange={e => setObservedWindDir(e.target.value)}
                  style={{ width: '100%', padding: '5px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff', boxSizing: 'border-box' }}
                >
                  <option value="">— Vide —</option>
                  <option value="O">Ouest (O)</option>
                  <option value="SO">Sud-Ouest (SO)</option>
                  <option value="ONO">Ouest-Nord-Ouest (ONO)</option>
                  <option value="NO">Nord-Ouest (NO)</option>
                  <option value="N">Nord (N)</option>
                  <option value="NNE">Nord-Nord-Est (NNE)</option>
                  <option value="NE">Nord-Est (NE)</option>
                  <option value="E">Est (E - Terre)</option>
                  <option value="SE">Sud-Est (SE)</option>
                  <option value="S">Sud (S)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                  Houle (m)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={observedWaveH}
                  onChange={e => setObservedWaveH(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="ex: 0.8"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box', background: '#fff' }}
                />
              </div>
            </div>

            {/* État de la plage */}
            <div style={{ marginTop: '8px' }}>
              <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '4px' }}>
                État du sable & de la plage (optionnel — re-cliquer pour désélectionner) :
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { key: 'dur', label: 'Sable dur / Idéal' },
                  { key: 'mou', label: 'Sable mou' },
                  { key: 'baches_faibles', label: 'Bâches faibles' },
                  { key: 'baches_fortes', label: 'Bâches fortes' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setBeachCondition(prev => (prev === opt.key ? undefined : (opt.key as SlotObservation['beachCondition'])))
                    }
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: beachCondition === opt.key ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                      background: beachCondition === opt.key ? '#e0f2fe' : '#fff',
                      color: beachCondition === opt.key ? '#0369a1' : '#64748b',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}

          {/* Notes générales */}
          <div>
            <label style={{ fontSize: '0.68rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
              Notes & Débriefing pédagogique :
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Remarques du moniteur sur le groupe, la sécurité, l'état du plan d'eau..."
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.78rem',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Boutons d'action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
            {!isReadOnly && initialObservation ? (
              confirmDelete ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.73rem', fontWeight: 800, color: '#991b1b' }}>
                    Supprimer ce REX ?
                  </span>
                  <button
                    type="button"
                    onClick={executeDelete}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#dc2626',
                      color: '#fff',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      color: '#475569',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✕ Garder
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '6px',
                    border: '1px solid #fca5a5',
                    background: '#fee2e2',
                    color: '#dc2626',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🗑️ Supprimer
                </button>
              )
            ) : (
              <div />
            )}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {isReadOnly && (
                <span style={{ fontSize: '0.74rem', color: '#92400e', background: '#fef3c7', padding: '4px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  🔒 Mode Contrôle (Lecture seule)
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#475569',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isReadOnly ? 'Fermer' : 'Annuler'}
              </button>
              {!isReadOnly && (() => {
                const modalLiveChars = (Number(monoCount) || 0) + (Number(biCount) || 0);
                const isBlockedOverLimit = status === 'realized' && modalLiveChars > maxChars;
                return (
                  <button
                    type="submit"
                    disabled={isBlockedOverLimit}
                    title={
                      isBlockedOverLimit
                        ? `Enregistrement bloqué : ${modalLiveChars}/${maxChars} chars max autorisés`
                        : undefined
                    }
                    style={{
                      padding: '7px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      background: isBlockedOverLimit ? '#dc2626' : '#0284c7',
                      color: '#fff',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor: isBlockedOverLimit ? 'not-allowed' : 'pointer',
                      opacity: isBlockedOverLimit ? 0.75 : 1,
                      boxShadow: isBlockedOverLimit ? 'none' : '0 2px 4px rgba(2, 132, 199, 0.25)',
                    }}
                  >
                    {isBlockedOverLimit
                      ? `⛔ Bloqué (${modalLiveChars}/${maxChars} chars)`
                      : '✓ Valider & Enregistrer le REX'}
                  </button>
                );
              })()}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
