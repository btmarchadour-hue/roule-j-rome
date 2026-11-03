import React, { useState, useEffect } from 'react';
import { CancellationReason, SlotObservation } from '../types';
import { CANCELLATION_REASONS_INFO, upsertSlotObservation, deleteSlotObservation } from '../utils/statisticsEngine';
import { saveObservationToFirestore, deleteObservationFromFirestore } from '../utils/firebaseSync';

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
  onSaveSuccess: (updatedList: SlotObservation[]) => void;
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
}) => {
  if (!isOpen) return null;

  const [status, setStatus] = useState<'realized' | 'cancelled'>(
    initialObservation?.status || 'realized'
  );
  const [cancellationReason, setCancellationReason] = useState<CancellationReason>(
    initialObservation?.cancellationReason || 'wind_low'
  );
  const [cancellationNote, setCancellationNote] = useState<string>(
    initialObservation?.cancellationNote || ''
  );

  // Écarts réels
  const [actualPassableTime, setActualPassableTime] = useState<string>(
    initialObservation?.actualPassableTime || slotStart
  );
  const [timeDeltaMin, setTimeDeltaMin] = useState<number | ''>(
    initialObservation?.timeDeltaMin ?? 0
  );
  const [waterDeltaCm, setWaterDeltaCm] = useState<number | ''>(
    initialObservation?.waterDeltaCm ?? 0
  );
  const [actualWaterHeight, setActualWaterHeight] = useState<number | ''>(
    initialObservation?.actualWaterHeight ?? ''
  );

  // Météo réelle
  const [observedPressure, setObservedPressure] = useState<number | ''>(
    initialObservation?.observedPressure ?? defaultPressure ?? 1013
  );
  const [observedWindKts, setObservedWindKts] = useState<number | ''>(
    initialObservation?.observedWindKts ?? defaultWindKts ?? 15
  );
  const [observedGustKts, setObservedGustKts] = useState<number | ''>(
    initialObservation?.observedGustKts ?? defaultGustKts ?? 20
  );
  const [observedWindDir, setObservedWindDir] = useState<string>(
    initialObservation?.observedWindDir ?? defaultWindDir ?? 'O'
  );
  const [observedWaveH, setObservedWaveH] = useState<number | ''>(
    initialObservation?.observedWaveH ?? defaultWaveH ?? ''
  );
  const [beachCondition, setBeachCondition] = useState<SlotObservation['beachCondition']>(
    initialObservation?.beachCondition || 'dur'
  );

  // Bilan participants
  const [participantsCount, setParticipantsCount] = useState<number | ''>(
    initialObservation?.participantsCount ?? ''
  );
  const [monoCount, setMonoCount] = useState<number | ''>(
    initialObservation?.monoCount ?? ''
  );
  const [biCount, setBiCount] = useState<number | ''>(
    initialObservation?.biCount ?? ''
  );
  const [notes, setNotes] = useState<string>(initialObservation?.notes || '');

  // Calcul automatique de l'écart horaire quand l'utilisateur change l'heure réelle
  const handlePassableTimeChange = (val: string) => {
    setActualPassableTime(val);
    if (!val || !slotStart) return;
    try {
      const [hS, mS] = slotStart.split(':').map(Number);
      const [hA, mA] = val.split(':').map(Number);
      const minStart = hS * 60 + mS;
      const minActual = hA * 60 + mA;
      setTimeDeltaMin(minActual - minStart);
    } catch {
      // ignore
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const obs: SlotObservation = {
      id: initialObservation?.id || `obs-${dateStr}-${slotKey}-${Date.now()}`,
      ds: dateStr,
      slotKey,
      slotStart,
      slotEnd,
      isCustom,
      customTitle: slotTitle || initialObservation?.customTitle,
      status,
      cancellationReason: status === 'cancelled' ? cancellationReason : undefined,
      cancellationNote: status === 'cancelled' ? cancellationNote : undefined,
      actualPassableTime: status === 'realized' && actualPassableTime ? actualPassableTime : undefined,
      timeDeltaMin: status === 'realized' && timeDeltaMin !== '' ? Number(timeDeltaMin) : undefined,
      waterDeltaCm: status === 'realized' && waterDeltaCm !== '' ? Number(waterDeltaCm) : undefined,
      actualWaterHeight: status === 'realized' && actualWaterHeight !== '' ? Number(actualWaterHeight) : undefined,
      observedPressure: observedPressure !== '' ? Number(observedPressure) : undefined,
      observedWindKts: observedWindKts !== '' ? Number(observedWindKts) : undefined,
      observedGustKts: observedGustKts !== '' ? Number(observedGustKts) : undefined,
      observedWindDir: observedWindDir || undefined,
      observedWaveH: observedWaveH !== '' ? Number(observedWaveH) : undefined,
      beachCondition: status === 'realized' ? beachCondition : undefined,
      participantsCount: status === 'realized' && participantsCount !== '' ? Number(participantsCount) : undefined,
      monoCount: status === 'realized' && monoCount !== '' ? Number(monoCount) : undefined,
      biCount: status === 'realized' && biCount !== '' ? Number(biCount) : undefined,
      notes: notes.trim() || undefined,
      createdAt: initialObservation?.createdAt || Date.now(),
    };

    const updated = upsertSlotObservation(obs);
    // Synchro Cloud Firestore en tâche de fond pour Jérôme et l'ensemble des appareils
    saveObservationToFirestore(obs).catch(err => console.warn('Erreur envoi Firestore observation:', err));
    onSaveSuccess(updated);
    onClose();
  };

  const handleDelete = () => {
    if (!initialObservation?.id) return;
    if (window.confirm('Voulez-vous supprimer ce relevé terrain ?')) {
      const updated = deleteSlotObservation(initialObservation.id);
      deleteObservationFromFirestore(initialObservation.id).catch(err => console.warn('Erreur suppression Firestore observation:', err));
      onSaveSuccess(updated);
      onClose();
    }
  };

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
                onClick={() => setStatus('cancelled')}
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
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setCancellationReason(r)}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: isSelected ? `2px solid ${info.color}` : '1px solid #cbd5e1',
                        background: isSelected ? '#fff' : '#f8fafc',
                        color: isSelected ? '#0f172a' : '#475569',
                        fontWeight: isSelected ? 800 : 600,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
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

              <div style={{ marginTop: '10px' }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: '#7f1d1d', display: 'block', marginBottom: '2px' }}>
                  Précisions / Observations du moniteur (facultatif) :
                </label>
                <input
                  type="text"
                  value={cancellationNote}
                  onChange={e => setCancellationNote(e.target.value)}
                  placeholder="ex: Rafales à 36 nds, sable trop mou près du ruisseau..."
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
            </div>
          )}

          {/* SI RÉALISÉE : MESURE DES ÉCARTS RÉELS & CONDITIONS PHYSIQUES */}
          {status === 'realized' && (
            <>
              {/* 1. Écart d'horaires & Surcote d'eau */}
              <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#166534', marginBottom: '8px' }}>
                  🌊 Écart constaté : Marée & Roulage effectif
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
                      placeholder="-15 = en avance"
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
                      placeholder="+20 = eau plus haute"
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

              {/* 2. Paramètres environnementaux réels pour corrélation */}
              <div style={{ background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a', marginBottom: '8px' }}>
                  🧭 Paramètres Météo & Mer réels (Calibration)
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
                      placeholder="1013"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                      Vent réel (nds)
                    </label>
                    <input
                      type="number"
                      value={observedWindKts}
                      onChange={e => setObservedWindKts(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="16"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                      Rafales (nds)
                    </label>
                    <input
                      type="number"
                      value={observedGustKts}
                      onChange={e => setObservedGustKts(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="22"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
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
                      value={observedWaveH}
                      onChange={e => setObservedWaveH(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.8"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* État de la plage */}
                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                    État du sable & de la plage :
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
                        onClick={() => setBeachCondition(opt.key as any)}
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

              {/* 3. Bilan participants & chars */}
              <div style={{ background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a', marginBottom: '8px' }}>
                  👥 Participants & Matériel sorti
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                      Total inscrits
                    </label>
                    <input
                      type="number"
                      value={participantsCount}
                      onChange={e => setParticipantsCount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="ex: 10"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                      Monoplaces
                    </label>
                    <input
                      type="number"
                      value={monoCount}
                      onChange={e => setMonoCount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="ex: 8"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.66rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '2px' }}>
                      Biplaces
                    </label>
                    <input
                      type="number"
                      value={biCount}
                      onChange={e => setBiCount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="ex: 1"
                      style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>
            </>
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
            {initialObservation ? (
              <button
                type="button"
                onClick={handleDelete}
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
            ) : (
              <div />
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
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
                Annuler
              </button>
              <button
                type="submit"
                style={{
                  padding: '7px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#0284c7',
                  color: '#fff',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
                }}
              >
                💾 Enregistrer l'observation
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
