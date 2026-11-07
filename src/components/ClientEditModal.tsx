import React, { useState, useEffect } from 'react';
import { ClientPreferredGear, ClientProfile, ClientSkillLevel } from '../types';
import { normalizePhone } from '../utils/excelImportExport';
import { deleteClientFromFirestore, saveClientToFirestore } from '../utils/firebaseSync';

interface ClientEditModalProps {
  isOpen: boolean;
  client: ClientProfile | null; // null = nouveau client
  onClose: () => void;
  onSaved?: (client: ClientProfile) => void;
  onDeleted?: (clientId: string) => void;
}

export const ClientEditModal: React.FC<ClientEditModalProps> = ({
  isOpen,
  client,
  onClose,
  onSaved,
  onDeleted,
}) => {
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [level, setLevel] = useState<ClientSkillLevel | ''>('debutant');
  const [preferredGear, setPreferredGear] = useState<ClientPreferredGear | ''>('monoplace');
  const [totalSessions, setTotalSessions] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (client) {
      setLastName(client.lastName || '');
      setFirstName(client.firstName || '');
      setPhone(client.phone || '');
      setEmail(client.email || '');
      setCity(client.city || '');
      setPostalCode(client.postalCode || '');
      setLevel(client.level || 'debutant');
      setPreferredGear(client.preferredGear || 'monoplace');
      setTotalSessions(client.totalSessions || 1);
      setNotes(client.notes || '');
      setTagsStr((client.tags || []).join(', '));
    } else {
      setLastName('');
      setFirstName('');
      setPhone('');
      setEmail('');
      setCity('');
      setPostalCode('');
      setLevel('debutant');
      setPreferredGear('monoplace');
      setTotalSessions(1);
      setNotes('');
      setTagsStr('');
    }
    setErrorMessage(null);
  }, [client, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lastName.trim()) {
      setErrorMessage('Le nom de famille est obligatoire.');
      return;
    }

    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) {
      setErrorMessage('Un numéro de téléphone portable est requis pour les alertes météo et rappels.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    const tags = tagsStr
      .split(/[,;\/]/)
      .map(t => t.trim())
      .filter(Boolean);

    const payload: ClientProfile = {
      id: client?.id || `cli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      phone: cleanPhone,
      email: email.trim().toLowerCase() || undefined,
      city: city.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      level: level ? (level as ClientSkillLevel) : undefined,
      preferredGear: preferredGear ? (preferredGear as ClientPreferredGear) : undefined,
      totalSessions: Math.max(0, Number(totalSessions) || 1),
      notes: notes.trim() || undefined,
      tags: tags.length ? tags : undefined,
      createdAt: client?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await saveClientToFirestore(payload);
      onSaved?.(payload);
      onClose();
    } catch (err: any) {
      console.error('Erreur enregistrement client:', err);
      setErrorMessage("Erreur lors de l'enregistrement dans le Cloud.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!client?.id) return;
    if (!window.confirm(`Supprimer définitivement la fiche de ${client.firstName || ''} ${client.lastName} ?`)) {
      return;
    }

    setIsSaving(true);
    try {
      await deleteClientFromFirestore(client.id);
      onDeleted?.(client.id);
      onClose();
    } catch (err) {
      console.error('Erreur suppression client:', err);
      setErrorMessage('Erreur lors de la suppression.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
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
          background: 'var(--card, #ffffff)',
          color: 'var(--tx, #0f172a)',
          borderRadius: '12px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
          border: '1px solid var(--bd, #e2e8f0)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--bd, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--cell, #f8fafc)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>👤</span> {client ? `Modifier fiche client : ${client.lastName}` : 'Nouveau Client'}
          </h3>
          <button type="button" className="fbtn" style={{ margin: 0, padding: '5px 9px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '18px', overflowY: 'auto', flex: 1 }}>
          {errorMessage && (
            <div
              style={{
                padding: '8px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                color: '#991b1b',
                fontSize: '0.78rem',
                marginBottom: '12px',
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Nom de famille *
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Dupont"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Prénom
              </label>
              <input
                type="text"
                placeholder="Ex: Marc"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Téléphone portable *
              </label>
              <input
                type="tel"
                required
                placeholder="06 12 34 56 78"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
              <span style={{ fontSize: '0.68rem', color: 'var(--mu, #64748b)' }}>Alerte météo SMS</span>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                E-mail
              </label>
              <input
                type="email"
                placeholder="client@domaine.fr"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Ville
              </label>
              <input
                type="text"
                placeholder="Ex: Plomodiern, Douarnenez"
                value={city}
                onChange={e => setCity(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Code Postal
              </label>
              <input
                type="text"
                placeholder="Ex: 29550"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Niveau
              </label>
              <select
                value={level}
                onChange={e => setLevel(e.target.value as any)}
                style={{ width: '100%', padding: '7px', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              >
                <option value="debutant">Débutant (1ère fois)</option>
                <option value="initie">Initié (Quelques séances)</option>
                <option value="perfectionnement">Perfectionnement</option>
                <option value="autonome">Autonome (Roulage libre)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Char préféré
              </label>
              <select
                value={preferredGear}
                onChange={e => setPreferredGear(e.target.value as any)}
                style={{ width: '100%', padding: '7px', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              >
                <option value="monoplace">Monoplace</option>
                <option value="biplace">Biplace (Duo/Enfant)</option>
                <option value="standart">Standart</option>
                <option value="promo">Promo</option>
                <option value="indifferent">Indifférent</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
                Total séances
              </label>
              <input
                type="number"
                min={0}
                value={totalSessions}
                onChange={e => setTotalSessions(Number(e.target.value))}
                style={{ width: '100%', padding: '7px', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
              Mots-clés / Tags (séparés par des virgules)
            </label>
            <input
              type="text"
              placeholder="Ex: Famille, Habitué, Local, Stage été, PMR"
              value={tagsStr}
              onChange={e => setTagsStr(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, marginBottom: '4px' }}>
              Notes, gabarit et particularités
            </label>
            <textarea
              rows={3}
              placeholder="Ex: Mesure 1m92 (prévoir palonnier long), vient souvent le week-end avec ses enfants..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid var(--bd, #cbd5e1)' }}
            />
          </div>

          <div
            style={{
              paddingTop: '12px',
              borderTop: '1px solid var(--bd, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            {client?.id ? (
              <button
                type="button"
                className="fbtn"
                style={{ color: '#dc2626', border: '1px solid #fca5a5' }}
                onClick={handleDelete}
                disabled={isSaving}
              >
                🗑️ Supprimer
              </button>
            ) : <div />}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="fbtn" onClick={onClose} disabled={isSaving}>
                Annuler
              </button>
              <button
                type="submit"
                className="fbtn fbtn-primary"
                style={{ background: '#16a34a', color: '#fff', fontWeight: 800 }}
                disabled={isSaving}
              >
                {isSaving ? 'Enregistrement...' : '✓ Enregistrer le Client'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
