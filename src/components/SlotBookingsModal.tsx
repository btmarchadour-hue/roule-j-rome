import React, { useMemo, useState } from 'react';
import { MAX_CHARS_PER_INSTRUCTOR } from '../types';
import { AgendaBookingItem } from '../utils/firebaseSync';
import { getSlotBookingsSummary, parseBookingItemCounts } from '../utils/cycleHelpers';

interface SlotBookingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
  slotKey: string;
  slotStart: string;
  slotEnd: string;
  slotTitle?: string;
  bookings: AgendaBookingItem[];
  onSaveBookings: (slotKey: string, bookings: AgendaBookingItem[]) => void;
  isReadOnly?: boolean;
}

export const SlotBookingsModal: React.FC<SlotBookingsModalProps> = ({
  isOpen,
  onClose,
  dateStr,
  slotKey,
  slotStart,
  slotEnd,
  slotTitle,
  bookings,
  onSaveBookings,
  isReadOnly = false,
}) => {
  const [draftList, setDraftList] = useState<AgendaBookingItem[]>(() =>
    bookings.map(b => {
      const parsed = parseBookingItemCounts(b);
      return {
        ...b,
        monoCount: b.monoCount ?? parsed.mono,
        biCount: b.biCount ?? parsed.bi,
        peopleCount: b.peopleCount ?? parsed.people,
      };
    })
  );

  const summary = useMemo(() => getSlotBookingsSummary(draftList), [draftList]);

  if (!isOpen) return null;

  const handleAddRow = () => {
    if (isReadOnly) return;
    const remaining = Math.max(0, MAX_CHARS_PER_INSTRUCTOR - summary.totalChars);
    const defaultMono = remaining > 0 ? 1 : 0;
    const newRow: AgendaBookingItem = {
      id: `bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      phone: '',
      email: '',
      chars: defaultMono > 0 ? '1 monoplace' : '0 char',
      monoCount: defaultMono,
      biCount: 0,
      peopleCount: defaultMono,
      formula: 'Initiation',
      payment: '',
      status: 'pending',
      notes: '',
    };
    setDraftList(prev => [...prev, newRow]);
  };

  const handleUpdateField = (id: string, patch: Partial<AgendaBookingItem>) => {
    if (isReadOnly) return;
    setDraftList(prev =>
      prev.map(item => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        const mono = Math.max(0, Number(next.monoCount) || 0);
        const bi = Math.max(0, Number(next.biCount) || 0);
        const parts: string[] = [];
        if (mono > 0) parts.push(`${mono} mono`);
        if (bi > 0) parts.push(`${bi} bi`);
        next.chars = parts.length > 0 ? parts.join(' + ') : '0 char';
        if (patch.monoCount !== undefined || patch.biCount !== undefined) {
          next.peopleCount = mono + bi * 2;
        }
        return next;
      })
    );
  };

  const handleRemoveRow = (id: string) => {
    if (isReadOnly) return;
    setDraftList(prev => prev.filter(item => item.id !== id));
  };

  const handleSave = () => {
    if (isReadOnly) return;
    const cleaned = draftList.filter(
      b => b.name.trim() || b.phone.trim() || (b.monoCount || 0) > 0 || (b.biCount || 0) > 0
    );
    onSaveBookings(slotKey, cleaned);
    onClose();
  };

  const pct = Math.min(100, Math.round((summary.totalChars / MAX_CHARS_PER_INSTRUCTOR) * 100));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          maxWidth: '760px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 38px -10px rgba(0, 0, 0, 0.28)',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* En-tête */}
        <div
          style={{
            padding: '14px 18px',
            background: '#0f172a',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Gestion Numérique des Inscriptions · Déclencheur Cycle 2
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
              fontSize: '1.3rem',
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            ✕
          </button>
        </div>

        {/* Jauge Chars / Moniteur */}
        <div
          style={{
            padding: '12px 18px',
            background: summary.isOverCapacity ? '#fef2f2' : summary.totalChars > 0 ? '#f0fdf4' : '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontWeight: 900,
                fontSize: '0.84rem',
                background: summary.isOverCapacity ? '#dc2626' : summary.totalChars > 0 ? '#16a34a' : '#64748b',
                color: '#fff',
              }}
            >
              {summary.totalChars} / {MAX_CHARS_PER_INSTRUCTOR} chars
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
              ({summary.monoCount} mono + {summary.biCount} bi · {summary.totalPeople} pilote{summary.totalPeople > 1 ? 's' : ''}/pers.)
            </span>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0369a1' }}>
              {pct}% de jauge moniteur
            </span>
          </div>

          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: summary.totalChars > 0 ? '#15803d' : '#64748b' }}>
            {summary.totalChars > 0
              ? '⚡ ≥ 1 inscription : Créneau basculé en Cycle 2 (Pilotage Terrain)'
              : '⏳ 0 inscrit : reste en Cycle 1 (offre commerciale)'}
          </div>
        </div>

        {summary.isOverCapacity && (
          <div
            style={{
              padding: '8px 18px',
              background: '#fee2e2',
              color: '#991b1b',
              fontSize: '0.76rem',
              fontWeight: 800,
              borderBottom: '1px solid #fca5a5',
            }}
          >
            ⚠️ Attention : la règle école fixe la limite à {MAX_CHARS_PER_INSTRUCTOR} chars maximum par moniteur (actuellement {summary.totalChars} chars).
          </div>
        )}

        {/* Liste des inscriptions */}
        <div style={{ overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
          {draftList.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '10px',
                background: '#f8fafc',
                color: '#64748b',
                fontSize: '0.82rem',
              }}
            >
              Aucune inscription enregistrée sur ce créneau pour l&apos;instant.
              {!isReadOnly && (
                <div style={{ marginTop: '8px' }}>
                  Cliquez sur <strong>« + Ajouter une inscription »</strong> ci-dessous : dès la 1ère inscription, ce créneau passera en <strong>Cycle 2</strong>.
                </div>
              )}
            </div>
          ) : (
            draftList.map((row, idx) => {
              const rowChars = (row.monoCount || 0) + (row.biCount || 0);
              return (
                <div
                  key={row.id}
                  style={{
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    background: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 900, color: '#0369a1' }}>
                      Réservation #{idx + 1} · {rowChars} char{rowChars > 1 ? 's' : ''} ({row.peopleCount ?? ((row.monoCount || 0) + (row.biCount || 0) * 2)} pers.)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <select
                        value={row.status}
                        disabled={isReadOnly}
                        onChange={e => handleUpdateField(row.id, { status: e.target.value as AgendaBookingItem['status'] })}
                        style={{
                          padding: '3px 7px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background: row.status === 'signed' ? '#dcfce7' : row.status === 'valid' ? '#e0f2fe' : '#f8fafc',
                        }}
                      >
                        <option value="pending">⏳ En attente</option>
                        <option value="valid">✓ Confirmé</option>
                        <option value="signed">✅ Présent sur plage</option>
                      </select>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          style={{
                            border: '1px solid #fca5a5',
                            background: '#fef2f2',
                            color: '#dc2626',
                            borderRadius: '6px',
                            padding: '3px 7px',
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                          title="Supprimer cette réservation"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: '#475569' }}>
                        Nom / Famille
                      </label>
                      <input
                        type="text"
                        disabled={isReadOnly}
                        value={row.name}
                        onChange={e => handleUpdateField(row.id, { name: e.target.value })}
                        placeholder="ex: Famille Le Gall"
                        style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: '#475569' }}>
                        Téléphone
                      </label>
                      <input
                        type="text"
                        disabled={isReadOnly}
                        value={row.phone}
                        onChange={e => handleUpdateField(row.id, { phone: e.target.value })}
                        placeholder="06..."
                        style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: '#0369a1' }}>
                          Mono
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={12}
                          disabled={isReadOnly}
                          value={row.monoCount ?? 0}
                          onChange={e => handleUpdateField(row.id, { monoCount: Math.max(0, Number(e.target.value) || 0) })}
                          style={{ width: '100%', padding: '5px 6px', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: '0.8rem', fontWeight: 800, boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: '#0369a1' }}>
                          Bi
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={12}
                          disabled={isReadOnly}
                          value={row.biCount ?? 0}
                          onChange={e => handleUpdateField(row.id, { biCount: Math.max(0, Number(e.target.value) || 0) })}
                          style={{ width: '100%', padding: '5px 6px', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: '0.8rem', fontWeight: 800, boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: '#475569' }}>
                          Pers.
                        </label>
                        <input
                          type="number"
                          min={1}
                          disabled={isReadOnly}
                          value={row.peopleCount ?? ((row.monoCount || 0) + (row.biCount || 0) * 2)}
                          onChange={e => handleUpdateField(row.id, { peopleCount: Math.max(0, Number(e.target.value) || 0) })}
                          style={{ width: '100%', padding: '5px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: '#475569' }}>
                        Règlement / Notes
                      </label>
                      <input
                        type="text"
                        disabled={isReadOnly}
                        value={row.notes}
                        onChange={e => handleUpdateField(row.id, { notes: e.target.value })}
                        placeholder="ex: CB OK, tailles casques..."
                        style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleAddRow}
                style={{
                  background: '#e0f2fe',
                  color: '#0369a1',
                  border: '1.5px solid #7dd3fc',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                + Ajouter une inscription
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#fff',
                color: '#475569',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '7px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Fermer
            </button>
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleSave}
                style={{
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                }}
              >
                💾 Enregistrer ({summary.totalChars} char{summary.totalChars > 1 ? 's' : ''})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
