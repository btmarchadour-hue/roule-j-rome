import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ensureAuth } from '../firebase';
import { APP_VERSION_INFO } from '../version';
import {
  getActiveInstructor,
  ProcessedTechNotesMap,
  setTechNoteProcessedInFirestore,
  subscribeToProcessedTechNotes,
} from '../utils/firebaseSync';

interface NotesAndHypothesesProps {
  onLock?: () => void;
}

interface TechNoteItem {
  id: string;
  category: 'meteo' | 'topographie' | 'reservation' | 'marees' | 'reunion';
  categoryLabel: string;
  categoryColor: string;
  icon: string;
  title: string;
  subtitle: string;
  summary: string;
  keyPoints: string[];
  docUrl: string;
  docBtnLabel: string;
  statusBadge: {
    label: string;
    bg: string;
    color: string;
  };
}

const LOCAL_STORAGE_KEY = 'cv_processed_tech_notes_cache';

export const NotesAndHypotheses: React.FC<NotesAndHypothesesProps> = ({ onLock }) => {
  const [customPassword, setCustomPassword] = useState('');
  const [currentCloudPassword, setCurrentCloudPassword] = useState<string | null>(null);
  const [isSavingPwd, setIsSavingPwd] = useState(false);
  const [pwdStatus, setPwdStatus] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filtre d'état : 'active' (Actives uniquement), 'processed' (Traitées / Archivées), 'all' (Toutes)
  const [statusFilter, setStatusFilter] = useState<'active' | 'processed' | 'all'>('active');

  // Gestionnaire de statut traité / archivé (Synchronisé Firestore + fallback local)
  const [processedMap, setProcessedMap] = useState<ProcessedTechNotesMap>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  // Modale de traitement d'une note
  const [resolvingNote, setResolvingNote] = useState<TechNoteItem | null>(null);
  const [resolvingAuthor, setResolvingAuthor] = useState<string>(() => getActiveInstructor());
  const [resolutionNote, setResolutionNote] = useState<string>('');
  const [isSubmittingResolution, setIsSubmittingResolution] = useState<boolean>(false);

  // Charger le mot de passe cloud actif
  useEffect(() => {
    let isMounted = true;
    const loadCurrentPwd = async () => {
      try {
        await ensureAuth();
        const docRef = doc(db, 'app_config', 'security');
        const snap = await getDoc(docRef);
        if (snap.exists() && isMounted) {
          const data = snap.data();
          if (data?.schoolPassword || data?.clubPassword) {
            setCurrentCloudPassword(data.schoolPassword || data.clubPassword);
          }
        }
      } catch {
        // ignore
      }
    };
    loadCurrentPwd();
    return () => {
      isMounted = false;
    };
  }, []);

  // Écoute temps réel Firestore du statut des notes traitées
  useEffect(() => {
    const unsubscribe = subscribeToProcessedTechNotes(remoteMap => {
      setProcessedMap(remoteMap);
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remoteMap));
      } catch {
        // ignore
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPassword.trim()) return;
    setIsSavingPwd(true);
    setPwdStatus('');
    try {
      await ensureAuth();
      const newPwd = customPassword.trim().toLowerCase();
      const docRef = doc(db, 'app_config', 'security');
      await setDoc(docRef, {
        schoolPassword: newPwd,
        clubPassword: newPwd,
        updatedAt: Date.now(),
      });
      setCurrentCloudPassword(newPwd);
      setPwdStatus('✓ Nouveau mot de passe enregistré et synchronisé pour Benoît et Jérôme !');
      setCustomPassword('');
    } catch {
      setPwdStatus('Erreur lors de l’enregistrement du mot de passe dans le cloud.');
    } finally {
      setIsSavingPwd(false);
    }
  };

  // Les 7 Notes Techniques et Documents Structurés par Thème
  const notesList = useMemo<TechNoteItem[]>(() => {
    return [
      {
        id: 'note-evolution-deux-temps',
        category: 'reservation',
        categoryLabel: 'Évolution Majeure',
        categoryColor: '#dc2626',
        icon: '🚀',
        title: 'Note Stratégique : Les 2 Temps de l’École & Couplage Réservation',
        subtitle: 'Séparation Anticipation Commerciale vs Pilotage Tactique Météo + Sauvetage SMS',
        summary:
          'Clarification majeure du fonctionnement de l’école : découpler la publication des créneaux lointains du pilotage d’urgence à J-1. Couplage avec les données clients pour automatiser les SMS d’alerte et proposer 5 créneaux de report avec % de réussite météo.',
        keyPoints: [
          'Temps 1 (Anticipation M-1 à J-7) : Créneaux théoriques stables publiés dans la résa sans bouger.',
          'Temps 2 (Tactique J-2 à H+1) : Ajustement météo AROME / surcote en direct et décision d’annuler ou rouler.',
          'Automatisation SMS Préventif J-1 : Alerte préventive à 18h pour réassurer les clients et éviter les appels anxiogènes.',
          'Sauvetage Commercial en 1 clic : Lien SMS proposant 5 reports immédiats (taux de sauvetage 75-80% au lieu de perte sèche de CA).',
          'Garde-fou Métier Inviolable : Interdiction formelle de valider une séance avec 0 participant (pilote). Les séances sans client sont classées en "Vie 1 : Faute de réservations".',
        ],
        docUrl: '/note_evolution_majeure_deux_temps.html',
        docBtnLabel: '🚀 Ouvrir la Note Évolution Majeure (A4 / Word)',
        statusBadge: {
          label: 'Priorité Réunion Jeudi',
          bg: '#fee2e2',
          color: '#991b1b',
        },
      },
      {
        id: 'note-meteo-module8',
        category: 'meteo',
        categoryLabel: 'Météo & Vent',
        categoryColor: '#0284c7',
        icon: '🌪️',
        title: 'Note Module 8 : Choix de la Mesure Météo & Vent en Direct',
        subtitle: 'Étude technique Winds Up Spot 66 vs Modèle AROME HD vs Balise Club Windbird',
        summary:
          'Analyse technique approfondie des contraintes d’intégration du vent à Lestrevet. Pourquoi le scraping / iframe de Winds Up est bloqué et quelle est la meilleure architecture pour l’école.',
        keyPoints: [
          'Sécurités Winds Up vérifiées : Absence d’API publique, blocage navigateur X-Frame-Options.',
          'Fiabilité matérielle : La balise 66 de Lestrevet est régulièrement hors service lors des coups de vent d’automne.',
          'Décision validée : Modèle haute résolution AROME HD Météo-France pour le calcul des créneaux + bouton 1 tap direct pour le contrôle terrain.',
          'Option future ouverte : Balise club Windbird (~180 €) fixée sur la remorque avec vraie API REST ouverte.',
        ],
        docUrl: '/note_mesure_meteo_vent.html',
        docBtnLabel: '📄 Ouvrir la Note Météo (A4 / Word)',
        statusBadge: {
          label: 'Option 1 Validée',
          bg: '#dcfce7',
          color: '#166534',
        },
      },
      {
        id: 'note-cadrage-lestrevet',
        category: 'topographie',
        categoryLabel: 'Topographie & Piste',
        categoryColor: '#16a34a',
        icon: '🏖️',
        title: 'Note Cadrage Lestrevet : Pente Litto3D & Piste Utile',
        subtitle: 'Modèle Lidar IGN/SHOM, pente 1,15 % et les 3 questions de calage pour Jérôme',
        summary:
          'Utilisation des données altimétriques publiques de haute précision Litto3D Finistère (économie géomètre : ~4 000 €). Calcul en temps réel de la largeur de piste selon la hauteur d’eau et la surcote.',
        keyPoints: [
          'Pente réelle moyenne d’estran : 1,15 % (1 cm vertical d’eau = ~87 cm à 1 m de sable praticable mangé).',
          'Question 1 : Ancrage du repère « Zéro » directement sur la remorque / cale de Lestrevet.',
          'Question 2 : Marge haute de sable sec/mou (laisser libre le réglage entre 30 m et 60 m).',
          'Question 3 : Hauteur d’eau minimale pour que les bâches d’eau résiduelles soient entièrement purgées.',
        ],
        docUrl: '/note_cadrage_lestrevet_jerome.html',
        docBtnLabel: '📝 Ouvrir la Note Lestrevet (1 page A4)',
        statusBadge: {
          label: 'À arbitrer avec Jérôme',
          bg: '#fef3c7',
          color: '#92400e',
        },
      },
      {
        id: 'note-reservation-deux-ponts',
        category: 'reservation',
        categoryLabel: 'Réservation',
        categoryColor: '#8b5cf6',
        icon: '🛒',
        title: 'Note Stratégique : Choix du Gestionnaire de Réservation',
        subtitle: 'Remplacement de Booking Activities & Architecture des « Deux Ponts »',
        summary:
          'Notre application reste le cerveau métier exclusif (calcul des marées glissantes, règle de 50, AROME, Fiche Agenda). L’outil de vente externe assure la billetterie et le paiement sécurisé.',
        keyPoints: [
          'Pont 1 (Amont) : Publication automatique des bons créneaux calculés dans l’agenda de vente.',
          'Pont 2 (Aval) : Rapatriement automatique des inscrits pour pré-remplir la Fiche Agenda papier.',
          'Comparatif 4 solutions : Activiti.fr (spécialiste voile/marées), RésaMinute, Billetweb (0 € abonnement), Regiondo.',
          'Question clé : Choix entre forfait fixe sans commission (Activiti) ou commission à la vente (Billetweb).',
        ],
        docUrl: '/note_reservation_deux_ponts.html',
        docBtnLabel: '📄 Ouvrir la Note Réservation (A4 / Word)',
        statusBadge: {
          label: 'Cahier des charges prêt',
          bg: '#e0e7ff',
          color: '#3730a3',
        },
      },
      {
        id: 'note-regles-marees-surcote',
        category: 'marees',
        categoryLabel: 'Marées & Physique',
        categoryColor: '#0369a1',
        icon: '🌊',
        title: 'Note Physique : Règles de Marée & Correcteur de Surcote',
        subtitle: 'Règle de 9h00, seuil Coef ≤ 50 et formule du baromètre inverse (+1 cm/hPa)',
        summary:
          'Détail des règles mathématiques appliquées dans le moteur : pourquoi le baromètre inverse retarde la marée basse de 20 à 35 minutes lors des coups de vent et repousse la mer de 25 mètres.',
        keyPoints: [
          'Règle d’or 09h00 : Aucune séance automatique avant 9h du matin pour respecter le rythme de l’école.',
          'Règle Coef ≤ 50 : Roulage continu toute la journée en mortes-eaux (la mer ne monte jamais trop haut).',
          'Loi du baromètre inverse : +1 cm d’eau par hPa en dessous de 1013 hPa (+28 cm d’eau à 985 hPa).',
          'Conseil d’usage : Désactiver pour les réservations lointaines (stabilité), activer à J-1 par dépression creuse.',
        ],
        docUrl: '/note_regles_marees_surcote.html',
        docBtnLabel: '📄 Ouvrir la Note Marées (A4 / Word)',
        statusBadge: {
          label: 'Moteur Appliqué',
          bg: '#dcfce7',
          color: '#166534',
        },
      },
      {
        id: 'dossier-reunion-jerome',
        category: 'reunion',
        categoryLabel: 'Réunion & DevOps',
        categoryColor: '#d97706',
        icon: '📋',
        title: 'Dossier d’Audit & Réunion de Travail (6 pages A4)',
        subtitle: 'Support complet pour la réunion avec Jérôme · Maquettes fidèles & Relevé de décisions',
        summary:
          'Dossier complet relié au format A4 avec visuels précis de chaque écran, questions d’arbitrage Oui/Non/À ajuster, zones pour annotations manuscrites au crayon et page de signatures.',
        keyPoints: [
          'Page 1 : Calendrier des marées & règle des 45-50 min de décalage quotidien.',
          'Page 2 : Écran Focus du Jour & calcul automatique des créneaux selon le vent.',
          'Page 3 : Bilan de séance, distinction Vie 1 vs Vie 2 et suivi du sauvetage commercial.',
          'Page 4 : Camemberts statistiques d’activité et taux de réussite des créneaux.',
          'Page 5 : Étalonnage GPS terrain, marégramme double courbe et coupe Litto3D.',
          'Page 6 : Relevé récapitulatif des 7 décisions arrêtées et signatures.',
        ],
        docUrl: '/support_reunion_jerome.html',
        docBtnLabel: '📑 Ouvrir le Dossier 6 pages (A4 / PDF / Word)',
        statusBadge: {
          label: 'Prêt pour jeudi',
          bg: '#fef3c7',
          color: '#92400e',
        },
      },
      {
        id: 'guide-github-devops',
        category: 'reunion',
        categoryLabel: 'Réunion & DevOps',
        categoryColor: '#475569',
        icon: '🛡️',
        title: 'Guide de Sécurisation GitHub & Workflow Dev (Point 1)',
        subtitle: 'Verrouillage de la branche principale en « Écluse protégée » et travail sur « dev »',
        summary:
          'Procédure DevOps pas à pas pour protéger la version de production de l’application. Garantit que toute modification est testée sur dev avant d’être déployée.',
        keyPoints: [
          'Création et bascule de la branche par défaut sur dev sur GitHub.',
          'Règle de protection Branch Protection Rule sur la branche principal.',
          'Sécurisation des clés secrètes et absence totale de code sensible dans les dépôts publics.',
        ],
        docUrl: '/guide_securisation_github.html',
        docBtnLabel: '📘 Ouvrir le Guide GitHub Pas à Pas',
        statusBadge: {
          label: 'Procédure Documentée',
          bg: '#f1f5f9',
          color: '#334155',
        },
      },
    ];
  }, []);

  // Décompte
  const totalNotesCount = notesList.length;
  const processedNotesCount = useMemo(() => {
    return Object.values(processedMap).filter(v => v.isProcessed).length;
  }, [processedMap]);
  const activeNotesCount = totalNotesCount - processedNotesCount;

  // Filtrage des notes selon statut, catégorie et recherche
  const filteredNotes = useMemo(() => {
    return notesList.filter(note => {
      const isProcessed = Boolean(processedMap[note.id]?.isProcessed);

      // Filtre d'état
      if (statusFilter === 'active' && isProcessed) return false;
      if (statusFilter === 'processed' && !isProcessed) return false;

      // Filtre catégorie
      const matchCat = selectedCategory === 'all' || note.category === selectedCategory;

      // Filtre recherche
      const matchSearch =
        searchQuery.trim() === '' ||
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.keyPoints.some(kp => kp.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchCat && matchSearch;
    });
  }, [notesList, processedMap, statusFilter, selectedCategory, searchQuery]);

  // Actions de traitement
  const handleOpenResolveModal = (note: TechNoteItem) => {
    setResolvingNote(note);
    setResolutionNote('');
  };

  const handleConfirmResolve = async () => {
    if (!resolvingNote) return;
    setIsSubmittingResolution(true);
    try {
      await setTechNoteProcessedInFirestore(
        resolvingNote.id,
        true,
        resolvingAuthor,
        resolutionNote.trim() || undefined
      );
      setResolvingNote(null);
    } catch (err) {
      alert('Erreur lors de la mise à jour de la note : ' + (err as Error).message);
    } finally {
      setIsSubmittingResolution(false);
    }
  };

  const handleRestoreNote = async (noteId: string) => {
    try {
      await setTechNoteProcessedInFirestore(noteId, false);
    } catch (err) {
      alert('Erreur lors de la réactivation de la note : ' + (err as Error).message);
    }
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', paddingBottom: '60px' }}>
      {/* 1. ZONE EN ÉCRITURE : MOT DE PASSE & CONTRÔLE D'ACCÈS CLOUD (CONSERVÉE 100%) */}
      <div
        className="card nop"
        style={{
          marginBottom: '20px',
          background: '#ffffff',
          borderRadius: '14px',
          border: '1.5px solid #0284c7',
          padding: '18px 20px',
          boxShadow: '0 4px 16px rgba(2, 132, 199, 0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase' }}>
              <span>🔒</span> Sécurité de l'application & Accès Cloud
            </div>
            <h3 style={{ margin: '6px 0 2px', fontSize: '1.20rem', fontWeight: 900, color: '#0f172a' }}>
              Mot de Passe & Protection des Données École
            </h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
              Gestion de l'accès sécurisé à l'application et synchronisation immédiate du mot de passe entre Benoît et Jérôme.
            </p>
          </div>

          {onLock && (
            <button
              type="button"
              className="fbtn"
              onClick={onLock}
              style={{
                margin: 0,
                background: '#fef2f2',
                border: '1.5px solid #fecaca',
                color: '#b91c1c',
                fontWeight: 800,
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.76rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Tester le verrouillage immédiat de l'écran"
            >
              <span>🔒</span>
              <span>Verrouiller maintenant</span>
            </button>
          )}
        </div>

        <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {/* Colonne gauche : Fonctionnement et mots de passe reconnus */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.76rem', color: '#334155', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
              🛡️ Comment fonctionne la protection ?
            </div>
            <div>
              • <strong>Toute personne extérieure</strong> qui ouvre l'adresse tombe sur un écran de verrouillage strict, sans affichage des plannings ni des clients, avec un lien de redirection vers le site public.
            </div>
            <div style={{ marginTop: '4px' }}>
              • <strong>Mots de passe reconnus par défaut :</strong>{' '}
              <code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: '4px', fontWeight: 800, color: '#0f172a' }}>
                lestrevet
              </code>{' '}
              ou{' '}
              <code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: '4px', fontWeight: 800, color: '#0f172a' }}>
                boutdumonde
              </code>
            </div>
            {currentCloudPassword && (
              <div style={{ marginTop: '4px', color: '#0369a1' }}>
                • <strong>Mot de passe personnalisé actif :</strong>{' '}
                <code style={{ background: '#bae6fd', padding: '2px 5px', borderRadius: '4px', fontWeight: 800, color: '#0369a1' }}>
                  {currentCloudPassword}
                </code>
              </div>
            )}
            <div style={{ marginTop: '4px', color: '#64748b', fontSize: '0.72rem' }}>
              • La case <i>« Mémoriser cet appareil »</i> vous évite de retaper le mot de passe à chaque ouverture sur vos téléphones ou ordinateurs personnels.
            </div>
          </div>

          {/* Colonne droite : Formulaire pour définir un nouveau mot de passe */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.76rem', marginBottom: '6px' }}>
              ✏️ Définir ou modifier le mot de passe partagé
            </div>
            <form onSubmit={handleSavePassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                placeholder="Nouveau mot de passe..."
                value={customPassword}
                onChange={e => setCustomPassword(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '0.82rem',
                  outline: 'none',
                  background: '#fff',
                }}
              />
              <button
                type="submit"
                disabled={isSavingPwd || !customPassword.trim()}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: customPassword.trim() ? '#0284c7' : '#94a3b8',
                  color: '#ffffff',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: customPassword.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                {isSavingPwd ? 'Enregistrement dans le Cloud…' : 'Enregistrer le nouveau mot de passe'}
              </button>
            </form>

            {pwdStatus && (
              <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#166534', fontWeight: 800 }}>
                {pwdStatus}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. HUB DES NOTES TECHNIQUES & SUPPORTS PAR THÈME */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.70rem', textTransform: 'uppercase', fontWeight: 900, color: '#0369a1', letterSpacing: '0.04em' }}>
                Dossier d'Ingénierie & Cadrages de Terrain
              </span>
              <span style={{ fontSize: '0.66rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>
                {activeNotesCount} à traiter · {processedNotesCount} traitée{processedNotesCount > 1 ? 's' : ''}
              </span>
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: '1.30rem', fontWeight: 900, color: '#0f172a' }}>
              Notes Techniques & Documents de Réunion par Thème
            </h2>
          </div>

          {/* Recherche rapide */}
          <input
            type="text"
            placeholder="🔍 Filtrer les notes (ex: vent, Lestrevet, résa, baromètre)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              padding: '6px 12px',
              fontSize: '0.76rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              width: '280px',
              maxWidth: '100%',
              background: '#fff',
            }}
          />
        </div>

        {/* Barre de double filtrage : État (Actives vs Traitées) + Catégorie */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          {/* 1. Sélecteur d'état (Actives vs Traitées) */}
          <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              style={{
                border: 'none',
                background: statusFilter === 'active' ? '#ffffff' : 'transparent',
                color: statusFilter === 'active' ? '#0f172a' : '#64748b',
                fontWeight: statusFilter === 'active' ? 900 : 700,
                fontSize: '0.74rem',
                padding: '5px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: statusFilter === 'active' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <span>📌</span>
              <span>Notes Actives ({activeNotesCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('processed')}
              style={{
                border: 'none',
                background: statusFilter === 'processed' ? '#ffffff' : 'transparent',
                color: statusFilter === 'processed' ? '#166534' : '#64748b',
                fontWeight: statusFilter === 'processed' ? 900 : 700,
                fontSize: '0.74rem',
                padding: '5px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: statusFilter === 'processed' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <span>✓</span>
              <span>Traitées / Archivées ({processedNotesCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              style={{
                border: 'none',
                background: statusFilter === 'all' ? '#ffffff' : 'transparent',
                color: statusFilter === 'all' ? '#0f172a' : '#64748b',
                fontWeight: statusFilter === 'all' ? 900 : 700,
                fontSize: '0.74rem',
                padding: '5px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                boxShadow: statusFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Toutes ({totalNotesCount})
            </button>
          </div>

          {/* 2. Barre d'onglets par thème */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {[
              { id: 'all', label: 'Tous les thèmes' },
              { id: 'meteo', label: '🌪️ Météo' },
              { id: 'topographie', label: '🏖️ Piste' },
              { id: 'reservation', label: '🛒 Résa' },
              { id: 'marees', label: '🌊 Marées' },
              { id: 'reunion', label: '📋 Réunion' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedCategory(tab.id)}
                style={{
                  border: selectedCategory === tab.id ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                  background: selectedCategory === tab.id ? '#0284c7' : '#ffffff',
                  color: selectedCategory === tab.id ? '#ffffff' : '#475569',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.70rem',
                  fontWeight: selectedCategory === tab.id ? 800 : 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. GRILLE DES FICHES DE NOTES TECHNIQUES */}
      {filteredNotes.length === 0 ? (
        <div className="card" style={{ padding: '40px 20px', textAlign: 'center', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '12px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>
            {statusFilter === 'processed' ? '🎉' : '🔍'}
          </div>
          <h4 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
            {statusFilter === 'processed' ? 'Aucune note archivée pour le moment' : 'Aucune note active ne correspond aux filtres'}
          </h4>
          <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b' }}>
            {statusFilter === 'processed'
              ? 'Dès qu’une note aura été traitée et validée avec Jérôme, elle apparaîtra ici avec sa date de résolution.'
              : 'Clique sur "Toutes les Notes" ou réinitialise la recherche.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
          {filteredNotes.map(note => {
            const isProcessed = Boolean(processedMap[note.id]?.isProcessed);
            const processedInfo = processedMap[note.id];

            return (
              <div
                key={note.id}
                className="card"
                style={{
                  background: isProcessed ? '#f8fafc' : '#ffffff',
                  borderRadius: '12px',
                  border: isProcessed ? '1.5px solid #86efac' : '1.5px solid #cbd5e1',
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: isProcessed ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.04)',
                  opacity: isProcessed && statusFilter === 'all' ? 0.8 : 1,
                  position: 'relative',
                }}
              >
                <div>
                  {/* Ruban traitée si archivée */}
                  {isProcessed && (
                    <div
                      style={{
                        background: '#dcfce7',
                        border: '1px solid #86efac',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        marginBottom: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.72rem',
                        color: '#166534',
                        fontWeight: 800,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>✓</span>
                        <span>
                          Traitée par <strong>{processedInfo?.processedBy || 'Jérôme'}</strong>
                          {processedInfo?.processedAt && ` le ${new Date(processedInfo.processedAt).toLocaleDateString('fr-FR')}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestoreNote(note.id)}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #86efac',
                          color: '#166534',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.66rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                        title="Remettre cette note dans les actives"
                      >
                        ↩️ Réactiver
                      </button>
                    </div>
                  )}

                  {/* Résolution note si présente */}
                  {isProcessed && processedInfo?.resolutionNote && (
                    <div style={{ background: '#f0fdf4', borderLeft: '3px solid #16a34a', padding: '6px 10px', fontSize: '0.72rem', color: '#15803d', marginBottom: '10px', borderRadius: '0 4px 4px 0' }}>
                      <strong>Décision arrêtée :</strong> « {processedInfo.resolutionNote} »
                    </div>
                  )}

                  {/* En-tête de la carte */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        color: note.categoryColor,
                        background: `${note.categoryColor}15`,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: `1px solid ${note.categoryColor}30`,
                      }}
                    >
                      <span>{note.icon}</span>
                      <span>{note.categoryLabel}</span>
                    </span>

                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: isProcessed ? '#dcfce7' : note.statusBadge.bg,
                        color: isProcessed ? '#166534' : note.statusBadge.color,
                      }}
                    >
                      {isProcessed ? '✓ Traitée' : note.statusBadge.label}
                    </span>
                  </div>

                  {/* Titre & Sous-titre */}
                  <h3 style={{ margin: '0 0 2px', fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', lineHeight: 1.3 }}>
                    {note.title}
                  </h3>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600, marginBottom: '10px' }}>
                    {note.subtitle}
                  </div>

                  {/* Résumé exécutif */}
                  <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: '#334155', lineHeight: 1.45 }}>
                    {note.summary}
                  </p>

                  {/* Points clés */}
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: '6px' }}>
                      Points clés & Arbitrages :
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.72rem', color: '#475569', lineHeight: 1.45 }}>
                      {note.keyPoints.map((kp, idx) => (
                        <li key={idx} style={{ marginBottom: '3px' }}>
                          {kp}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Barre d'action inférieure : Bouton A4 + Bouton Marquer comme traitée / Supprimer */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                  <a
                    href={note.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      background: isProcessed ? '#64748b' : note.categoryColor,
                      color: '#ffffff',
                      textDecoration: 'none',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      textAlign: 'center',
                      boxShadow: isProcessed ? 'none' : `0 3px 10px ${note.categoryColor}30`,
                      transition: 'opacity 0.15s ease',
                    }}
                  >
                    <span>{note.docBtnLabel}</span>
                    <span style={{ fontSize: '0.85rem' }}>➔</span>
                  </a>

                  {!isProcessed ? (
                    <button
                      type="button"
                      onClick={() => handleOpenResolveModal(note)}
                      title="Marquer cette note comme traitée / décidée avec Jérôme"
                      style={{
                        background: '#ffffff',
                        border: '1.5px solid #22c55e',
                        color: '#15803d',
                        borderRadius: '8px',
                        padding: '9px 12px',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>✓</span>
                      <span>Traitée</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRestoreNote(note.id)}
                      title="Remettre cette note dans la liste des actives"
                      style={{
                        background: '#ffffff',
                        border: '1.5px solid #cbd5e1',
                        color: '#475569',
                        borderRadius: '8px',
                        padding: '9px 12px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>↩️ Réactiver</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODALE DE VALIDATION / CLÔTURE D'UNE NOTE TRAITÉE */}
      {resolvingNote && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            animation: 'fadeIn 0.2s ease',
          }}
          onClick={() => setResolvingNote(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
              border: '2px solid #22c55e',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.5rem' }}>✓</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                  Marquer la note comme traitée
                </h3>
                <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                  Elle sera archivée et masquée des notes actives.
                </div>
              </div>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', margin: '14px 0', fontSize: '0.80rem' }}>
              <strong>Note sélectionnée :</strong>
              <div style={{ color: '#0369a1', fontWeight: 800, marginTop: '2px' }}>
                {resolvingNote.title}
              </div>
            </div>

            {/* Qui valide ? */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '4px' }}>
                Validé par :
              </label>
              <select
                value={resolvingAuthor}
                onChange={e => setResolvingAuthor(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '0.80rem',
                  fontWeight: 800,
                  background: '#fff',
                }}
              >
                <option value="Jérôme">Jérôme (Moniteur)</option>
                <option value="Benoît">Benoît</option>
                <option value="Jérôme & Benoît">Jérôme & Benoît (En séance)</option>
              </select>
            </div>

            {/* Décision arrêtée / commentaire optionnel */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '4px' }}>
                Décision arrêtée ou commentaire de clôture (optionnel) :
              </label>
              <input
                type="text"
                placeholder="Ex: Option 1 validée · Accord sur le modèle barométrique..."
                value={resolutionNote}
                onChange={e => setResolutionNote(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '0.80rem',
                  outline: 'none',
                }}
              />
            </div>

            {/* Boutons d'action */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setResolvingNote(null)}
                style={{
                  padding: '8px 14px',
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
                type="button"
                disabled={isSubmittingResolution}
                onClick={handleConfirmResolve}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#16a34a',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
                }}
              >
                <span>✓</span>
                <span>{isSubmittingResolution ? 'Archivage…' : 'Confirmer et archiver'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. PIED DE PAGE OFFICIEL */}
      <footer className="card nop ft" style={{ marginTop: '24px' }}>
        <b>Char à Voile du Bout du Monde</b>
        <br />
        Plage de Lestrevet · 29550 Plomodiern
        <br />
        <a href="tel:+33681638374">06 81 63 83 74</a> ·{' '}
        <a href="https://charavoileduboutdumonde.com" target="_blank" rel="noopener noreferrer">
          charavoileduboutdumonde.com
        </a>
        <br />
        <span style={{ fontSize: '.7rem', color: 'var(--mu)' }}>
          {APP_VERSION_INFO.displayString} · Char à Voile Lestrevet
        </span>
      </footer>
    </div>
  );
};
