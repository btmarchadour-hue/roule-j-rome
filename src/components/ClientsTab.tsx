import React, { useState, useEffect, useMemo } from 'react';
import { ClientProfile } from '../types';
import {
  batchSaveClientsToFirestore,
  deleteClientFromFirestore,
  saveClientToFirestore,
  subscribeToClients,
} from '../utils/firebaseSync';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { ClientEditModal } from './ClientEditModal';
import { ImportClientsModal } from './ImportClientsModal';

interface ClientsTabProps {
  isReadOnly?: boolean;
}

export const ClientsTab: React.FC<ClientsTabProps> = ({ isReadOnly = false }) => {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedGear, setSelectedGear] = useState<string>('all');
  const [onlyRegulars, setOnlyRegulars] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'name' | 'sessions' | 'recent'>('name');

  // Modals state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
  const [isSyncingFromAgenda, setIsSyncingFromAgenda] = useState(false);
  const [agendaSyncFeedback, setAgendaSyncFeedback] = useState<string | null>(null);
  const [mergingGroupKey, setMergingGroupKey] = useState<string | null>(null);
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);

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

  // Normalisation sans accents pour une recherche tolérante
  const normalizeText = (val?: string) =>
    (val || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const normalizeDigits = (val?: string) => (val || '').replace(/[^\d+]/g, '');

  const normalizePhoneMatchKey = (val?: string) => {
    const digits = (val || '').replace(/\D/g, '');
    if (digits.length < 8) return '';
    return digits.length > 9 ? digits.slice(-9) : digits;
  };

  // Normalisation stricte pour détecter les variantes d'écriture ("O.D.C.V.L." == "ODCVL", "Jean-Luc" == "Jean Luc")
  const normalizeCompactName = (val?: string) =>
    normalizeText(val).replace(/[^a-z0-9]/g, '');

  const normalizeNameTokens = (val?: string) =>
    normalizeText(val)
      .replace(/\./g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  const normalizeSortedTokensKey = (val?: string) => {
    const tokens = normalizeNameTokens(val);
    return tokens.length > 0 ? [...tokens].sort().join('|') : '';
  };

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
            const phoneKey = normalizePhoneMatchKey(c.phone);
            const compactName = normalizeCompactName(c.name);
            const sortedTokens = normalizeSortedTokensKey(c.name);
            const key = phoneKey ? `tel:${phoneKey}` : `nom:${compactName || sortedTokens}`;
            if (!key || key === 'nom:') return;

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

      // Comparer avec les clients existants (par téléphone ET par variantes de nom)
      const existingPhoneKeys = new Set<string>();
      const existingNameKeys = new Set<string>();
      clients.forEach(c => {
        const phoneKey = normalizePhoneMatchKey(c.phone);
        if (phoneKey) existingPhoneKeys.add(phoneKey);
        const fullA = `${c.lastName || ''} ${c.firstName || ''}`.trim();
        const fullB = `${c.firstName || ''} ${c.lastName || ''}`.trim();
        [fullA, fullB].forEach(label => {
          const compact = normalizeCompactName(label);
          const sorted = normalizeSortedTokensKey(label);
          if (compact) existingNameKeys.add(compact);
          if (sorted) existingNameKeys.add(sorted);
        });
      });

      const newProfilesToCreate: ClientProfile[] = [];
      foundClientsMap.forEach(val => {
        const phoneKey = normalizePhoneMatchKey(val.phone);
        const compactName = normalizeCompactName(val.name);
        const sortedTokens = normalizeSortedTokensKey(val.name);

        const alreadyExists =
          (phoneKey && existingPhoneKeys.has(phoneKey)) ||
          (compactName && existingNameKeys.has(compactName)) ||
          (sortedTokens && existingNameKeys.has(sortedTokens));

        if (!alreadyExists) {
          const parts = val.name.split(/\s+/).filter(Boolean);
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

  // Détection automatique des doublons probables (même téléphone, même nom avec/sans ponctuation ou variante d'organisme type ODCVL / O.D.C.V.L.)
  const duplicateGroups = useMemo(() => {
    if (clients.length < 2) return [] as Array<{ key: string; reason: string; members: ClientProfile[] }>;

    const parent = clients.map((_, i) => i);
    const reasons = new Map<number, string>();

    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };

    const union = (a: number, b: number, reason: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        const keep = Math.min(ra, rb);
        const drop = Math.max(ra, rb);
        parent[drop] = keep;
        if (!reasons.has(keep)) reasons.set(keep, reason);
      }
    };

    const meta = clients.map(c => {
      const fullName = `${c.lastName || ''} ${c.firstName || ''}`.trim();
      return {
        phoneKey: normalizePhoneMatchKey(c.phone),
        compact: normalizeCompactName(fullName),
        sorted: normalizeSortedTokensKey(fullName),
        tokens: normalizeNameTokens(fullName),
      };
    });

    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        const a = meta[i];
        const b = meta[j];

        if (a.phoneKey && b.phoneKey && a.phoneKey === b.phoneKey) {
          union(i, j, 'Même numéro de téléphone');
          continue;
        }
        if (a.compact && b.compact && a.compact === b.compact) {
          union(i, j, 'Même nom (orthographe / ponctuation proche)');
          continue;
        }
        if (a.sorted && b.sorted && a.sorted === b.sorted) {
          union(i, j, 'Même nom / prénom inversé');
          continue;
        }
        // Variante organisme / nom seul inclus dans une fiche plus longue (ex: "ODCVL" et "ODCVL Pentrez")
        if (
          a.tokens.length === 1 &&
          a.tokens[0].length >= 4 &&
          b.tokens.length > 1 &&
          b.tokens.includes(a.tokens[0])
        ) {
          union(i, j, `Nom proche (« ${a.tokens[0].toUpperCase()} »)`);
          continue;
        }
        if (
          b.tokens.length === 1 &&
          b.tokens[0].length >= 4 &&
          a.tokens.length > 1 &&
          a.tokens.includes(b.tokens[0])
        ) {
          union(i, j, `Nom proche (« ${b.tokens[0].toUpperCase()} »)`);
        }
      }
    }

    const grouped = new Map<number, ClientProfile[]>();
    clients.forEach((c, idx) => {
      const root = find(idx);
      const list = grouped.get(root) || [];
      list.push(c);
      grouped.set(root, list);
    });

    const result: Array<{ key: string; reason: string; members: ClientProfile[] }> = [];
    grouped.forEach((members, root) => {
      if (members.length >= 2) {
        // Trier la fiche la plus complète en premier
        const score = (c: ClientProfile) =>
          (c.phone ? 4 : 0) +
          (c.email ? 2 : 0) +
          (c.city ? 2 : 0) +
          (c.notes ? 1 : 0) +
          (c.totalSessions || 0);
        const sortedMembers = [...members].sort(
          (a, b) => score(b) - score(a) || (b.updatedAt || 0) - (a.updatedAt || 0)
        );
        result.push({
          key: sortedMembers.map(m => m.id).join('__'),
          reason: reasons.get(root) || 'Fiches très proches',
          members: sortedMembers,
        });
      }
    });

    return result;
  }, [clients]);

  const handleMergeDuplicateGroup = async (group: { key: string; members: ClientProfile[] }) => {
    if (isReadOnly || group.members.length < 2) return;
    setMergingGroupKey(group.key);
    setMergeFeedback(null);
    try {
      const [primary, ...duplicates] = group.members;

      const mergedTagsSet = new Map<string, string>();
      group.members.forEach(m => {
        (m.tags || []).forEach(t => {
          const k = normalizeText(t);
          if (k && !mergedTagsSet.has(k)) mergedTagsSet.set(k, t);
        });
      });

      const mergedNotesList: string[] = [];
      group.members.forEach(m => {
        const trimmed = (m.notes || '').trim();
        if (
          trimmed &&
          !mergedNotesList.some(existing => normalizeText(existing).includes(normalizeText(trimmed)))
        ) {
          mergedNotesList.push(trimmed);
        }
      });

      const latestDate = group.members
        .map(m => m.lastSessionDate)
        .filter((d): d is string => Boolean(d))
        .sort()
        .reverse()[0];

      const mergedClient: ClientProfile = {
        ...primary,
        firstName: primary.firstName || duplicates.find(d => d.firstName)?.firstName || '',
        phone: primary.phone || duplicates.find(d => d.phone)?.phone || '',
        email: primary.email || duplicates.find(d => d.email)?.email,
        city: primary.city || duplicates.find(d => d.city)?.city,
        postalCode: primary.postalCode || duplicates.find(d => d.postalCode)?.postalCode,
        totalSpent: Math.max(...group.members.map(m => m.totalSpent || 0)) || undefined,
        hasGiftVoucher: group.members.some(m => m.hasGiftVoucher) || undefined,
        giftVoucherBalance: Math.max(...group.members.map(m => m.giftVoucherBalance || 0)) || undefined,
        totalSessions: Math.max(...group.members.map(m => m.totalSessions || 1)),
        lastSessionDate: latestDate || primary.lastSessionDate,
        tags: Array.from(mergedTagsSet.values()),
        notes: mergedNotesList.length > 0 ? mergedNotesList.join(' / ') : undefined,
        updatedAt: Date.now(),
      };

      await saveClientToFirestore(mergedClient);
      for (const dup of duplicates) {
        await deleteClientFromFirestore(dup.id);
      }

      const displayName = `${mergedClient.lastName} ${mergedClient.firstName}`.trim();
      setMergeFeedback(
        `✓ Fusion effectuée pour « ${displayName} » (${duplicates.length} doublon${duplicates.length > 1 ? 's' : ''} supprimé${duplicates.length > 1 ? 's' : ''}).`
      );
    } catch (err) {
      console.error('Erreur fusion doublons clients:', err);
      setMergeFeedback('Erreur lors de la fusion des fiches. Vérifiez votre connexion.');
    } finally {
      setMergingGroupKey(null);
    }
  };

  const hasActiveFilters = Boolean(
    searchQuery.trim() || selectedLevel !== 'all' || selectedGear !== 'all' || onlyRegulars
  );

  // Filtrage et recherche dynamique
  const filteredClients = useMemo(() => {
    let result = [...clients];

    if (searchQuery.trim()) {
      const qNorm = normalizeText(searchQuery);
      const qTokens = qNorm.split(/\s+/).filter(Boolean);
      const qDigits = normalizeDigits(searchQuery);

      result = result.filter(c => {
        const searchableText = normalizeText(
          [
            c.firstName,
            c.lastName,
            c.email,
            c.city,
            c.postalCode,
            c.notes,
            ...(c.tags || []),
          ]
            .filter(Boolean)
            .join(' ')
        );
        const phoneDigits = normalizeDigits(c.phone);

        // Tous les mots tapés doivent correspondre (gère "Prénom Nom", "Nom Prénom", "Nom Ville", etc.)
        const matchesAllTokens =
          qTokens.length > 0 &&
          qTokens.every(tok => {
            const tokDigits = normalizeDigits(tok);
            return (
              searchableText.includes(tok) ||
              (tokDigits.length >= 2 && phoneDigits.includes(tokDigits))
            );
          });

        const matchesPhoneDirect = qDigits.length >= 2 && phoneDigits.includes(qDigits);
        return matchesAllTokens || matchesPhoneDirect;
      });
    }

    if (selectedLevel !== 'all') {
      result = result.filter(c => c.level === selectedLevel);
    }

    if (selectedGear !== 'all') {
      result = result.filter(c => c.preferredGear === selectedGear);
    }

    if (onlyRegulars) {
      result = result.filter(c => (c.totalSessions || 0) >= 2);
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
      return (
        (a.lastName || '').localeCompare(b.lastName || '', 'fr') ||
        (a.firstName || '').localeCompare(b.firstName || '', 'fr')
      );
    });

    return result;
  }, [clients, searchQuery, selectedLevel, selectedGear, onlyRegulars, sortBy]);

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
          {isReadOnly && (
            <span
              style={{
                background: '#fffbeb',
                border: '1.5px solid #fde68a',
                color: '#92400e',
                padding: '7px 12px',
                borderRadius: '6px',
                fontSize: '0.74rem',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>🔒</span>
              <span>Mode Moniteur : Répertoire en lecture seule</span>
            </span>
          )}

          {!isReadOnly && (
            <>
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
            </>
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
            borderTop: '1px solid var(--bd, #e2e8f0)',
            borderRight: '1px solid var(--bd, #e2e8f0)',
            borderBottom: '1px solid var(--bd, #e2e8f0)',
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
            borderTop: '1px solid var(--bd, #e2e8f0)',
            borderRight: '1px solid var(--bd, #e2e8f0)',
            borderBottom: '1px solid var(--bd, #e2e8f0)',
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

        <button
          type="button"
          onClick={() => setOnlyRegulars(prev => !prev)}
          title="Cliquer pour afficher uniquement les clients fidèles (≥ 2 séances)"
          style={{
            textAlign: 'left',
            cursor: 'pointer',
            background: onlyRegulars ? '#f5f3ff' : 'var(--card, #fff)',
            borderTop: onlyRegulars ? '2px solid #7c3aed' : '1px solid var(--bd, #e2e8f0)',
            borderRight: onlyRegulars ? '2px solid #7c3aed' : '1px solid var(--bd, #e2e8f0)',
            borderBottom: onlyRegulars ? '2px solid #7c3aed' : '1px solid var(--bd, #e2e8f0)',
            borderLeft: '4px solid #8b5cf6',
            borderRadius: '8px',
            padding: '12px 14px',
            boxShadow: onlyRegulars ? '0 0 0 3px rgba(139, 92, 246, 0.16)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <div style={{ fontSize: '0.72rem', color: onlyRegulars ? '#5b21b6' : 'var(--mu, #64748b)', fontWeight: 800, textTransform: 'uppercase' }}>
              Clients Fidèles / Habitués
            </div>
            {onlyRegulars && (
              <span style={{ fontSize: '0.64rem', fontWeight: 800, background: '#7c3aed', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>
                Filtre actif
              </span>
            )}
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#6d28d9', marginTop: '2px' }}>
            {stats.regulars}
          </div>
          <div style={{ fontSize: '0.7rem', color: onlyRegulars ? '#6d28d9' : 'var(--mu, #64748b)', marginTop: '2px', fontWeight: onlyRegulars ? 700 : 400 }}>
            {onlyRegulars
              ? 'Affichage ≥ 2 séances · Cliquer pour tout voir'
              : 'Ayant effectué ≥ 2 séances · Cliquer pour voir'}
          </div>
        </button>

        <div
          style={{
            background: 'var(--card, #fff)',
            borderTop: '1px solid var(--bd, #e2e8f0)',
            borderRight: '1px solid var(--bd, #e2e8f0)',
            borderBottom: '1px solid var(--bd, #e2e8f0)',
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

      {/* Alerte doublons potentiels + fusion en 1 clic */}
      {(duplicateGroups.length > 0 || mergeFeedback) && (
        <div
          style={{
            background: duplicateGroups.length > 0 ? '#fffbeb' : '#f0fdf4',
            border: duplicateGroups.length > 0 ? '1.5px solid #f59e0b' : '1.5px solid #86efac',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px',
          }}
        >
          {mergeFeedback && (
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#15803d', marginBottom: duplicateGroups.length > 0 ? '8px' : 0 }}>
              {mergeFeedback}
            </div>
          )}
          {duplicateGroups.length > 0 && (
            <>
              <div style={{ fontSize: '0.82rem', fontWeight: 900, color: '#92400e', marginBottom: '6px' }}>
                ⚠️ {duplicateGroups.length} doublon{duplicateGroups.length > 1 ? 's' : ''} potentiel{duplicateGroups.length > 1 ? 's' : ''} détecté{duplicateGroups.length > 1 ? 's' : ''} dans le répertoire
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {duplicateGroups.map(group => {
                  const isBusy = mergingGroupKey === group.key;
                  const keptSessions = Math.max(...group.members.map(m => m.totalSessions || 1));
                  return (
                    <div
                      key={group.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px',
                        background: '#ffffff',
                        border: '1px solid #fde68a',
                        borderRadius: '6px',
                        padding: '8px 10px',
                      }}
                    >
                      <div style={{ fontSize: '0.76rem', color: '#1e293b' }}>
                        <div style={{ fontWeight: 800 }}>
                          {group.members
                            .map(m => `« ${`${m.lastName} ${m.firstName}`.trim()} » (${m.totalSessions || 1} séan.)`)
                            .join('  ↔  ')}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                          {group.reason} · La fusion garde 1 fiche complète ({keptSessions} séan.) et supprime le doublon.
                        </div>
                      </div>
                      {!isReadOnly && (
                        <button
                          type="button"
                          className="fbtn"
                          disabled={Boolean(mergingGroupKey)}
                          onClick={() => handleMergeDuplicateGroup(group)}
                          style={{
                            margin: 0,
                            background: '#d97706',
                            color: '#ffffff',
                            border: 'none',
                            fontWeight: 800,
                            fontSize: '0.74rem',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            cursor: isBusy ? 'wait' : 'pointer',
                          }}
                        >
                          {isBusy ? 'Fusion en cours...' : '🔗 Fusionner en 1 fiche'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Barre d'aspiration depuis l'Agenda */}
      {!isReadOnly && (
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
      )}

      {/* Barre de Recherche et Filtres */}
      <div
        className="card"
        style={{
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: 'var(--card, #fff)',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--bd, #e2e8f0)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          {/* Champ de recherche */}
          <div style={{ flex: '1 1 260px', minWidth: '200px', position: 'relative' }}>
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '0.82rem',
                pointerEvents: 'none',
                opacity: 0.7,
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Rechercher par prénom, nom, téléphone, ville, CP, tag..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 32px 8px 32px',
                fontSize: '0.82rem',
                borderRadius: '6px',
                border: '1px solid var(--bd, #cbd5e1)',
                background: 'var(--cell, #f8fafc)',
                color: 'var(--tx, #0f172a)',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Effacer la recherche"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  fontWeight: 800,
                  padding: '2px 4px',
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
                color: 'var(--tx, #0f172a)',
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
                color: 'var(--tx, #0f172a)',
              }}
            >
              <option value="all">Tous les matériels</option>
              <option value="monoplace">Monoplace</option>
              <option value="biplace">Biplace</option>
              <option value="standart">Standard</option>
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
                color: 'var(--tx, #0f172a)',
              }}
            >
              <option value="name">Tri : Nom (A-Z)</option>
              <option value="sessions">Tri : Nb Séances</option>
              <option value="recent">Tri : Modifié récent</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              paddingTop: '8px',
              borderTop: '1px dashed var(--bd, #e2e8f0)',
              fontSize: '0.75rem',
              color: 'var(--mu, #64748b)',
            }}
          >
            <span>
              <strong>{filteredClients.length}</strong> fiche{filteredClients.length > 1 ? 's' : ''} affichée{filteredClients.length > 1 ? 's' : ''} sur <strong>{clients.length}</strong>
              {onlyRegulars && (
                <strong style={{ color: '#6d28d9', marginLeft: '6px' }}>
                  (Filtre : Clients Fidèles ≥ 2 séances)
                </strong>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedLevel('all');
                setSelectedGear('all');
                setOnlyRegulars(false);
              }}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '3px 9px',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              ✕ Réinitialiser les filtres
            </button>
          </div>
        )}
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
              : searchQuery.trim()
              ? `Aucun contact ne correspond à "${searchQuery.trim()}" avec les filtres sélectionnés.`
              : 'Aucun contact ne correspond aux filtres sélectionnés.'}
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
                setOnlyRegulars(false);
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
                  borderTop: '1px solid var(--bd, #e2e8f0)',
                  borderRight: '1px solid var(--bd, #e2e8f0)',
                  borderBottom: '1px solid var(--bd, #e2e8f0)',
                  borderLeft:
                    (c.totalSessions || 0) >= 2
                      ? '5px solid #8b5cf6'
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
                      {(c.totalSessions || 0) >= 2 && (
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
                    <span>•</span>
                    <span><b>Séances :</b> {c.totalSessions || 1}</span>
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
        isReadOnly={isReadOnly}
      />
    </div>
  );
};
