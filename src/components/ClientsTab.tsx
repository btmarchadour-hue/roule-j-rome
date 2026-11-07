import React, { useState, useEffect, useMemo } from 'react';
import { ClientProfile, ClientSkillLevel } from '../types';
import {
  downloadClientExcelTemplate,
  exportClientsToCsv,
} from '../utils/excelImportExport';
import {
  batchSaveClientsToFirestore,
  subscribeToClients,
} from '../utils/firebaseSync';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { ClientEditModal } from './ClientEditModal';
import { ImportClientsModal } from './ImportClientsModal';

export const ClientsTab: React.FC = () => {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedGear, setSelectedGear] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'sessions' | 'recent'>('name');

  // Modals state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
  const [isSyncingFromAgenda, setIsSyncingFromAgenda] = useState(false);
  const [agendaSyncFeedback, setAgendaSyncFeedback] = useState<string | null>(null);

  // Synchronisation temps réel Firestore
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToClients(
      data => {
        setClients(data);
        setIsLoading(false);
      },
      err => {
        console.warn('Erreur écoute clients Firestore:', err);
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Fonction pour aspirer et agréger les clients déjà saisis dans l'Agenda
  const handleSyncFromReservations = async () => {
    setIsSyncingFromAgenda(true);
    setAgendaSyncFeedback(null);
    try {
      const snap = await getDocs(collection(db, 'reservations'));
      const foundClientsMap = new Map<string, { name: string; phone: string; email?: string; formula?: string; chars?: string; dates: string[] }>();

      snap.forEach(docSnap => {
        const data = docSnap.data();
        const dateStr = docSnap.id.slice(0, 10);
        if (data && Array.isArray(data.clients)) {
          data.clients.forEach((c: any) => {
            if (!c.name) return;
            const key = (c.phone ? c.phone.replace(/[\s\.\-]/g, '') : '') || c.name.trim().toLowerCase();
            const existing = foundClientsMap.get(key);
            if (existing) {
              if (dateStr && !existing.dates.includes(dateStr)) existing.dates.push(dateStr);
              if (!existing.email && c.email) existing.email = c.email;
              if (!existing.phone && c.phone) existing.phone = c.phone;
            } else {
              foundClientsMap.set(key, {
                name: c.name.trim(),
                phone: c.phone || '',
                email: c.email || undefined,
                formula: c.formula || undefined,
                chars: c.chars || undefined,
                dates: dateStr ? [dateStr] : [],
              });
            }
          });
        }
      });

      // Comparer avec les clients existants
      const existingKeys = new Set(
        clients.map(c => (c.phone ? c.phone.replace(/[\s\.\-]/g, '') : '') || `${c.lastName} ${c.firstName}`.trim().toLowerCase())
      );

      const newProfilesToCreate: ClientProfile[] = [];
      foundClientsMap.forEach((val, k) => {
        if (!existingKeys.has(k)) {
          const parts = val.name.split(' ');
          const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
          const firstName = parts.length > 1 ? parts[0] : '';
          const isBi = (val.chars || '').toLowerCase().includes('bi');

          newProfilesToCreate.push({
            id: `cli-agenda-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            lastName,
            firstName,
            phone: val.phone,
            email: val.email,
            level: val.formula?.toLowerCase().includes('perf') ? 'perfectionnement' : 'debutant',
            preferredGear: isBi ? 'biplace' : 'monoplace',
            totalSessions: val.dates.length || 1,
            lastSessionDate: val.dates.sort().reverse()[0] || undefined,
            tags: ['Agenda'],
            notes: val.formula ? `Formule : ${val.formula}` : undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });

      if (newProfilesToCreate.length > 0) {
        await batchSaveClientsToFirestore(newProfilesToCreate);
        setAgendaSyncFeedback(`✓ ${newProfilesToCreate.length} nouveau(x) client(s) importé(s) depuis les feuilles d'émargement !`);
      } else {
        setAgendaSyncFeedback("Tous les clients de l'agenda sont déjà présents dans le répertoire.");
      }
    } catch (err: any) {
      console.error('Erreur synchronisation agenda:', err);
      setAgendaSyncFeedback("Erreur lors de la récupération des données de l'agenda.");
    } finally {
      setIsSyncingFromAgenda(false);
    }
  };

  // Filtrage et recherche dynamique
  const filteredClients = useMemo(() => {
    let result = [...clients];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        c =>
          (c.lastName || '').toLowerCase().includes(q) ||
          (c.firstName || '').toLowerCase().includes(q) ||
          (c.phone || '').replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.city || '').toLowerCase().includes(q) ||
          (c.notes || '').toLowerCase().includes(q) ||
          (c.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    if (selectedLevel !== 'all') {
      result = result.filter(c => c.level === selectedLevel);
    }

    if (selectedGear !== 'all') {
      result = result.filter(c => c.preferredGear === selectedGear);
    }

    // Tri
    result.sort((a, b) => {
      if (sortBy === 'sessions') {
        return (b.totalSessions || 0) - (a.totalSessions || 0);
      }
      if (sortBy === 'recent') {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
      // Par défaut : Nom alphabétique
      return (a.lastName || '').localeCompare(b.lastName || '', 'fr') || (a.firstName || '').localeCompare(b.firstName || '', 'fr');
    });

    return result;
  }, [clients, searchQuery, selectedLevel, selectedGear, sortBy]);

  // Statistiques clés
  const stats = useMemo(() => {
    const total = clients.length;
    const withMobile = clients.filter(c => c.phone && c.phone.trim().length >= 8).length;
    const regulars = clients.filter(c => (c.totalSessions || 0) >= 2).length;
    const locals = clients.filter(c => {
      const city = (c.city || '').toLowerCase();
      const cp = (c.postalCode || '').trim();
      return (
        city.includes('plomodiern') ||
        city.includes('douarnenez') ||
        city.includes('crozon') ||
        city.includes('chateaulin') ||
        cp.startsWith('29')
      );
    }).length;

    return { total, withMobile, regulars, locals };
  }, [clients]);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 8px 30px' }}>
      {/* En-tête */}
      <div
        className="card nop"
        style={{
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--card, #ffffff)',
          padding: '16px 20px',
          borderRadius: '10px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>👥</span> Base de Données Clients & Répertoire Stagiaires
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--mu, #64748b)' }}>
            Fichier centralisé de l'école : coordonnées, alertes météo SMS, niveau, préférences de char et historique.
          </p>
        </div>

        {/* Boutons d'actions principales */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="fbtn fbtn-primary"
            style={{
              margin: 0,
              background: '#16a34a',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.78rem',
              padding: '8px 14px',
              borderRadius: '6px',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.25)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => {
              setEditingClient(null);
              setIsEditModalOpen(true);
            }}
          >
            <span>➕</span>
            <span>Nouveau Client</span>
          </button>

          <button
            type="button"
            className="fbtn"
            style={{
              margin: 0,
              background: 'var(--cell, #f1f5f9)',
              color: '#0369a1',
              border: '1px solid #bae6fd',
              fontWeight: 700,
              fontSize: '0.76rem',
              padding: '8px 12px',
              borderRadius: '6px',
            }}
            onClick={() => setIsImportModalOpen(true)}
            title="Importer une liste de clients depuis un fichier Excel ou CSV"
          >
            📤 Importer Fichier (Excel / CSV)
          </button>

          <button
            type="button"
            className="fbtn"
            style={{
              margin: 0,
              background: 'var(--cell, #f1f5f9)',
              color: 'var(--tx, #0f172a)',
              border: '1px solid var(--bd, #cbd5e1)',
              fontWeight: 700,
              fontSize: '0.76rem',
              padding: '8px 12px',
              borderRadius: '6px',
            }}
            onClick={downloadClientExcelTemplate}
            title="Télécharger le modèle Excel type pré-formaté"
          >
            📥 Modèle Excel Vierge
          </button>

          {clients.length > 0 && (
            <button
              type="button"
              className="fbtn"
              style={{
                margin: 0,
                background: 'var(--cell, #f1f5f9)',
                color: 'var(--tx, #0f172a)',
                border: '1px solid var(--bd, #cbd5e1)',
                fontWeight: 700,
                fontSize: '0.76rem',
                padding: '8px 12px',
                borderRadius: '6px',
              }}
              onClick={() => exportClientsToCsv(filteredClients)}
              title="Exporter la liste filtrée au format CSV pour Excel ou publipostage"
            >
              📊 Exporter CSV ({filteredClients.length})
            </button>
          )}
        </div>
      </div>

      {/* Cartes Métriques Clés (KPIs) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--bd, #e2e8f0)',
            borderLeft: '4px solid #0284c7',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: 'var(--mu, #64748b)', fontWeight: 800, textTransform: 'uppercase' }}>
            Total Fiches Clients
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0369a1', marginTop: '2px' }}>
            {stats.total}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--mu, #64748b)', marginTop: '2px' }}>
            Enregistrés dans le Cloud
          </div>
        </div>

        <div
          style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--bd, #e2e8f0)',
            borderLeft: '4px solid #16a34a',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: 'var(--mu, #64748b)', fontWeight: 800, textTransform: 'uppercase' }}>
            Numéros Portables Valides
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#15803d', marginTop: '2px' }}>
            {stats.withMobile}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--mu, #64748b)', marginTop: '2px' }}>
            Disponibles pour alerte SMS météo
          </div>
        </div>

        <div
          style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--bd, #e2e8f0)',
            borderLeft: '4px solid #8b5cf6',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: 'var(--mu, #64748b)', fontWeight: 800, textTransform: 'uppercase' }}>
            Clients Fidèles / Habitués
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#6d28d9', marginTop: '2px' }}>
            {stats.regulars}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--mu, #64748b)', marginTop: '2px' }}>
            Ayant effectué ≥ 2 séances
          </div>
        </div>

        <div
          style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--bd, #e2e8f0)',
            borderLeft: '4px solid #f59e0b',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: 'var(--mu, #64748b)', fontWeight: 800, textTransform: 'uppercase' }}>
            Clients Locaux (Finistère)
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#b45309', marginTop: '2px' }}>
            {stats.locals}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--mu, #64748b)', marginTop: '2px' }}>
            Bassin Douarnenez / Baie
          </div>
        </div>
      </div>

      {/* Barre d'aspiration depuis l'Agenda */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px dashed #cbd5e1',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <b style={{ fontSize: '0.82rem', color: '#0f172a' }}>
            🔄 Synchronisation automatique depuis les Fiches Agenda :
          </b>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>
            Récupère les noms et numéros des stagiaires déjà consignés sur les feuilles d'émargement pour les ajouter au répertoire.
          </div>
          {agendaSyncFeedback && (
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#16a34a', marginTop: '4px' }}>
              {agendaSyncFeedback}
            </div>
          )}
        </div>
        <button
          type="button"
          className="fbtn"
          style={{
            margin: 0,
            background: '#fff',
            color: '#0284c7',
            border: '1px solid #0284c7',
            fontWeight: 700,
            fontSize: '0.76rem',
            padding: '6px 12px',
          }}
          disabled={isSyncingFromAgenda}
          onClick={handleSyncFromReservations}
        >
          {isSyncingFromAgenda ? 'Analyse en cours...' : '🔄 Synchroniser les clients de l’Agenda'}
        </button>
      </div>

      {/* Barre de Recherche et Filtres */}
      <div
        className="card"
        style={{
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--card, #fff)',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        {/* Champ de recherche */}
        <div style={{ flex: '1 1 260px', position: 'relative' }}>
          <input
            type="text"
            placeholder="🔍 Rechercher par nom, prénom, téléphone, ville, tag..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              fontSize: '0.82rem',
              borderRadius: '6px',
              border: '1px solid var(--bd, #cbd5e1)',
              background: 'var(--cell, #f8fafc)',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#94a3b8',
                fontWeight: 800,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Filtres secondaires */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={selectedLevel}
            onChange={e => setSelectedLevel(e.target.value)}
            style={{
              padding: '7px 10px',
              fontSize: '0.78rem',
              borderRadius: '6px',
              border: '1px solid var(--bd, #cbd5e1)',
              background: 'var(--cell, #fff)',
            }}
          >
            <option value="all">Tous les niveaux</option>
            <option value="debutant">Débutant</option>
            <option value="initie">Initié</option>
            <option value="perfectionnement">Perfectionnement</option>
            <option value="autonome">Autonome</option>
          </select>

          <select
            value={selectedGear}
            onChange={e => setSelectedGear(e.target.value)}
            style={{
              padding: '7px 10px',
              fontSize: '0.78rem',
              borderRadius: '6px',
              border: '1px solid var(--bd, #cbd5e1)',
              background: 'var(--cell, #fff)',
            }}
          >
            <option value="all">Tous les matériels</option>
            <option value="monoplace">Monoplace</option>
            <option value="biplace">Biplace</option>
            <option value="standart">Standart</option>
            <option value="promo">Promo</option>
          </select>

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
            style={{
              padding: '7px 10px',
              fontSize: '0.78rem',
              borderRadius: '6px',
              border: '1px solid var(--bd, #cbd5e1)',
              background: 'var(--cell, #fff)',
            }}
          >
            <option value="name">Tri : Nom (A-Z)</option>
            <option value="sessions">Tri : Nb Séances</option>
            <option value="recent">Tri : Modifié récent</option>
          </select>
        </div>
      </div>

      {/* Liste des Fiches Clients */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⏳</div>
          <div style={{ fontWeight: 700 }}>Chargement du répertoire clients...</div>
        </div>
      ) : filteredClients.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '50px 20px',
            background: 'var(--card, #fff)',
            borderRadius: '10px',
            border: '1px solid var(--bd, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>👤</div>
          <h3 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 800 }}>
            {clients.length === 0 ? 'Aucun client enregistré' : 'Aucun résultat trouvé'}
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--mu, #64748b)' }}>
            {clients.length === 0
              ? 'Créez votre première fiche client ou importez votre fichier de contacts pour commencer.'
              : `Aucun contact ne correspond à votre recherche "${searchQuery}".`}
          </p>
          {clients.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                type="button"
                className="fbtn fbtn-primary"
                style={{ background: '#16a34a', color: '#fff', fontWeight: 800 }}
                onClick={() => {
                  setEditingClient(null);
                  setIsEditModalOpen(true);
                }}
              >
                ➕ Ajouter un Premier Client
              </button>
              <button
                type="button"
                className="fbtn"
                onClick={() => setIsImportModalOpen(true)}
              >
                📤 Importer un fichier Excel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="fbtn"
              onClick={() => {
                setSearchQuery('');
                setSelectedLevel('all');
                setSelectedGear('all');
              }}
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '12px',
          }}
        >
          {filteredClients.map(c => {
            const levelLabel =
              c.level === 'autonome'
                ? 'Autonome'
                : c.level === 'perfectionnement'
                ? 'Perfectionnement'
                : c.level === 'initie'
                ? 'Initié'
                : 'Débutant';

            return (
              <div
                key={c.id}
                style={{
                  background: 'var(--card, #ffffff)',
                  border: '1px solid var(--bd, #e2e8f0)',
                  borderLeft:
                    (c.totalSessions || 0) >= 3
                      ? '5px solid #8b5cf6'
                      : (c.totalSessions || 0) >= 2
                      ? '5px solid #0284c7'
                      : '5px solid #10b981',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div>
                  {/* Titre & Tags */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--tx, #0f172a)' }}>
                        {c.lastName} {c.firstName}
                      </div>
                      {c.city && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--mu, #64748b)' }}>
                          📍 {c.city} {c.postalCode ? `(${c.postalCode})` : ''}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {(c.totalSessions || 0) >= 3 && (
                        <span style={{ background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '2px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 800 }}>
                          ★ Fidèle ({c.totalSessions} séan.)
                        </span>
                      )}
                      {c.preferredGear === 'biplace' && (
                        <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '2px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 800 }}>
                          Biplace
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Coordonnées de contact avec boutons directs téléphone / SMS */}
                  <div
                    style={{
                      background: 'var(--cell, #f8fafc)',
                      border: '1px solid var(--bd, #f1f5f9)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      marginBottom: '10px',
                      fontSize: '0.78rem',
                    }}
                  >
                    {c.phone ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: c.email ? '4px' : 0 }}>
                        <a
                          href={`tel:${c.phone.replace(/\s+/g, '')}`}
                          style={{
                            fontWeight: 800,
                            color: '#0369a1',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Appeler directement ce numéro"
                        >
                          📞 {c.phone}
                        </a>
                        <a
                          href={`sms:${c.phone.replace(/\s+/g, '')}`}
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: '#15803d',
                            textDecoration: 'none',
                            background: '#dcfce7',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                          title="Envoyer un SMS d'alerte météo ou d'information"
                        >
                          💬 SMS
                        </a>
                      </div>
                    ) : (
                      <div style={{ color: '#dc2626', fontSize: '0.72rem' }}>⚠️ Aucun téléphone</div>
                    )}

                    {c.email && (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a
                          href={`mailto:${c.email}`}
                          style={{ color: '#475569', textDecoration: 'none', fontSize: '0.72rem' }}
                        >
                          ✉️ {c.email}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Profil Pratique */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--mu, #475569)', marginBottom: '8px' }}>
                    <span><b>Niveau :</b> {levelLabel}</span>
                    <span>•</span>
                    <span><b>Char :</b> {c.preferredGear || 'Monoplace'}</span>
                    {c.lastSessionDate && (
                      <>
                        <span>•</span>
                        <span><b>Dernier passage :</b> {c.lastSessionDate}</span>
                      </>
                    )}
                  </div>

                  {/* Notes & gabarit */}
                  {c.notes && (
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: '#334155',
                        background: '#f1f5f9',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        marginBottom: '8px',
                        fontStyle: 'italic',
                      }}
                    >
                      📝 {c.notes}
                    </div>
                  )}

                  {/* Tags */}
                  {c.tags && c.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {c.tags.map((t, idx) => (
                        <span
                          key={idx}
                          style={{
                            background: '#e2e8f0',
                            color: '#334155',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontSize: '0.66rem',
                            fontWeight: 700,
                          }}
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bouton d'édition */}
                <div style={{ borderTop: '1px solid var(--bd, #f1f5f9)', paddingTop: '8px', marginTop: '6px', textAlign: 'right' }}>
                  <button
                    type="button"
                    className="fbtn"
                    style={{ margin: 0, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 700 }}
                    onClick={() => {
                      setEditingClient(c);
                      setIsEditModalOpen(true);
                    }}
                  >
                    ✏️ Modifier fiche
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <ImportClientsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />

      <ClientEditModal
        isOpen={isEditModalOpen}
        client={editingClient}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingClient(null);
        }}
      />
    </div>
  );
};
