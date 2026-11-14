import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ensureAuth } from '../firebase';
import { APP_VERSION_INFO } from '../version';
import {
  getActiveInstructor,
  ProcessedTechNotesMap,
  saveTechNoteQcmToFirestore,
  setTechNoteProcessedInFirestore,
  subscribeToProcessedTechNotes,
  subscribeToTechNoteQcms,
  TechNoteQcmMap,
  TechNoteQcmSubmission,
} from '../utils/firebaseSync';
import { TECH_NOTE_QCMS, TechNoteQcmDefinition } from '../data/techNoteQcms';

interface NotesAndHypothesesProps {
  onLock?: () => void;
}

interface TechNoteItem {
  id: string;
  category: 'meteo' | 'topographie' | 'reservation' | 'marees' | 'reunion' | 'amelioration';
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
const QCM_STORAGE_KEY = 'cv_qcm_tech_notes_cache';

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

  // Réponses aux QCM intégrés dans l'app (Synchronisées Firestore + fallback local)
  const [qcmMap, setQcmMap] = useState<TechNoteQcmMap>(() => {
    try {
      const cached = localStorage.getItem(QCM_STORAGE_KEY);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  // Modale de réponse au QCM dans l'application
  const [activeQcmDef, setActiveQcmDef] = useState<TechNoteQcmDefinition | null>(null);
  const [qcmDraftAnswers, setQcmDraftAnswers] = useState<Record<string, string[]>>({});
  const [qcmDraftNotes, setQcmDraftNotes] = useState<Record<string, string>>({});
  const [qcmRespondent, setQcmRespondent] = useState<string>(() => {
    const cur = getActiveInstructor();
    return cur === 'Benoît' ? 'Benoît' : 'Jérôme';
  });
  const [isSavingQcm, setIsSavingQcm] = useState(false);
  const [qcmSaveError, setQcmSaveError] = useState<string | null>(null);

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

  // Écoute temps réel Firestore des réponses aux QCM intégrés
  useEffect(() => {
    const unsubscribe = subscribeToTechNoteQcms(remoteMap => {
      setQcmMap(remoteMap);
      try {
        localStorage.setItem(QCM_STORAGE_KEY, JSON.stringify(remoteMap));
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

  // Les Notes Techniques et Documents Structurés par Thème
  const notesList = useMemo<TechNoteItem[]>(() => {
    return [
      {
        id: 'guide-prise-de-mesure',
        category: 'topographie',
        categoryLabel: 'Topographie & GPS',
        categoryColor: '#16a34a',
        icon: '📏',
        title: 'Guide pour prise de mesure : Mode Opératoire Plage (Zéro Doute)',
        subtitle: 'Check-list complète du jour J : réglages, ordre des 6 arrêts, sens Gauche/Droite, moyens d’améliorer la précision et fiche secours',
        summary:
          'Feuille de route terrain exhaustive pour le calibrage sur la plage avec Jérôme puis les relevés quotidiens à l’eau : check-list pré-départ, règle visuelle infaillible, parcours en 6 arrêts, feuille de route précision (orthophoto IGN 20 cm, watchPosition 1/σ², Litto3D 1 m, L1+L5, SBAS, Centipède RTK, protocole 3 vagues) et fiche mémo papier de secours.',
        keyPoints: [
          'Pré-vol (2 min) : compte admin Jérôme/Benoît actif, GPS Haute Précision, veille écran 2–5 min, repères Mairie prêts.',
          'Orientation & 6 arrêts : face à la mer (Gauche = Sud, Droite = Nord), Dune A → Borne Gauche → Dune B (≥ 200 m) → Borne Droite → Copie Mairie → Marge + 1er test Mer.',
          'Gains précision (0 € à RTK cm) : pente ~1,15 % (1 cm = 87 cm), orthophoto IGN 20 cm, polyligne dune, watchPosition 1/σ², Litto3D 1 m, protocole « 3 vagues », SBAS et ZED-F9P + Centipède RTK.',
          'FAQ & fiche secours : posture téléphone, conduite si signal > 15 m, recalcul rétroactif automatique et tableau de notes terrain imprimable.',
        ],
        docUrl: '/guide_prise_de_mesure.html',
        docBtnLabel: '📏 Ouvrir le Guide pour prise de mesure (A4 / Word)',
        statusBadge: {
          label: 'Guide Opérationnel',
          bg: '#dcfce7',
          color: '#166534',
        },
      },
      {
        id: 'note-axes-amelioration',
        category: 'amelioration',
        categoryLabel: 'Axes d’Amélioration',
        categoryColor: '#6366f1',
        icon: '💡',
        title: 'Note · Axes d’Amélioration & Évolutions Futures',
        subtitle: 'Backlog vivant : bâches (ex-Q3), heures moniteur & stats, précision GPS/Litto3D, capteurs et billetterie',
        summary:
          'Registre évolutif regroupant les sujets trop complexes pour être figés a priori (comme les bâches à Lestrevet) ou volontairement planifiés en phase 2 après les premiers retours terrain (heures moniteur, statistiques avancées, capteurs locaux).',
        keyPoints: [
          'Bâches & ruissellements Lestrevet (ex-Q3 Cadrage Terrain) : suivi via tag GPS « Bâches » + REX avant toute modélisation.',
          'Heures moniteur & Stats avancées (ex-Évolution Majeure) : heures estran + préparation/convoyage, pertes par secteur vent et fréquentation par coef.',
          'Précision & Modèle Plage : polyligne de dune (3–5 pts), watchPosition 1/σ², raster Litto3D 1 m, ou ZED-F9P Centipède RTK à long terme.',
          'Météo, Cycle 2 & Billetterie : correctif Pentrez ↔ Lestrevet, balise club locale, houle OSO, schéma vectoriel et connexion Deux Ponts / SMS.',
        ],
        docUrl: '/note_axes_amelioration.html',
        docBtnLabel: '💡 Ouvrir la Note Axes d’Amélioration (A4 / Word)',
        statusBadge: {
          label: 'Évolutif · Backlog',
          bg: '#ede9fe',
          color: '#5b21b6',
        },
      },
      {
        id: 'note-creneaux-simultanes-ete',
        category: 'reunion',
        categoryLabel: 'Organisation Été',
        categoryColor: '#7c3aed',
        icon: '☀️',
        title: 'Questionnaire QCM Remplissable : Créneaux Simultanés d’Été & Multi-Moniteurs',
        subtitle: '6 choix multiples pour caler les séances parallèles (ex. 15h Jérôme + Katleen), le parc chars et l’affichage',
        summary:
          'Note interactive pour trancher avec Jérôme l’organisation de la haute saison lorsque deux moniteurs roulent sur la même tranche horaire : architecture des séances parallèles, plafond du parc matériel simultané, bouton de dédoublement, accès Katleen et comptage d’heures.',
        keyPoints: [
          'Q1 & Q2 · 2 séances distinctes sur la même heure (ex. 15h Jérôme / 15h Katleen) vs créneau double, horaires identiques ou souples.',
          'Q3 · Jauge moniteur (12 chars) vs plafond total du parc matériel roulant en simultané (monoplaces + biplaces).',
          'Q4 & Q5 · Liste de prénoms simple vs accès dédié Katleen, et bouton « + Doubler ce créneau » ou mode Haute Saison.',
          'Q6 · Badges moniteur, filtre rapide et préparation du comptage d’heures séparé par moniteur (export Word / HTML / PDF).',
        ],
        docUrl: '/note_creneaux_simultanes_ete.html',
        docBtnLabel: '☀️ Ouvrir le QCM Été Multi-Moniteurs (Word / HTML / PDF)',
        statusBadge: {
          label: 'À arbitrer avec Jérôme',
          bg: '#fef3c7',
          color: '#92400e',
        },
      },
      {
        id: 'note-orientation-plage-lestrevet',
        category: 'topographie',
        categoryLabel: 'Topographie & Météo',
        categoryColor: '#0284c7',
        icon: '🗺️',
        title: 'Questionnaire QCM Remplissable : Orientation Plage, Balise Pentrez & Zones GPS',
        subtitle: '6 choix multiples pour caler les secteurs de vent (~335°/155°), la houle OSO et les 3 zones de la baie',
        summary:
          'Note interactive issue de l’analyse du plan Pentrez ↔ Lieue de Grève ↔ Lestrevet. Jérôme peut répondre directement aux 6 QCM à l’écran ou exporter le questionnaire en fichier Word (.doc) ou HTML remplissable hors-ligne.',
        keyPoints: [
          'Q1 & Q2 · Axe réel ~335°/155° : badges Travers mer / Axe / Vent de terre (Kervennec ENE) et règle éventuelle en vent faible.',
          'Q3 · Distance ~3–4 km entre Balise Winds-Up (Pentrez Nord) et École (Lestrevet Sud) : relevé d’écart REX et calage AROME.',
          'Q4 · Étalonnage GPS (Tab 7) : classement automatique en 3 zones (Lestrevet / Lieue de Grève / Pentrez) et suivi des bâches.',
          'Q5 & Q6 · Pondération de la houle frontale OSO (~245°) et mini-schéma vectoriel plage + vent en Cycle 2.',
          'Exportable en document remplissable : téléchargement direct Word (.doc), HTML autonome remplissable ou PDF A4.',
        ],
        docUrl: '/note_orientation_plage_lestrevet.html',
        docBtnLabel: '🗺️ Ouvrir le Questionnaire Remplissable (Word / HTML / PDF)',
        statusBadge: {
          label: 'À arbitrer avec Jérôme',
          bg: '#fef3c7',
          color: '#92400e',
        },
      },
      {
        id: 'note-arbitrage-cycle1-cycle2-digital',
        category: 'reunion',
        categoryLabel: 'Arbitrage Organisation',
        categoryColor: '#7c3aed',
        icon: '⚡',
        title: 'Note Jérôme : Cycle 1 / Cycle 2, Règle des 12 Chars & Passage au 100 % Digital',
        subtitle: 'Dissociation offre/terrain, abandon du papier, SMS reportés & boutons Semaine / Mois actifs',
        summary:
          'Tous les points sont désormais actés et en production : capacité fixée à 12 chars max/moniteur (mono + bi), Cycle 2 déclenché dès la 1ère inscription, 100 % digital et publication Cycle 1 disponible au choix jour par jour, à la semaine ou au mois complet.',
        keyPoints: [
          'Cycle 1 (Offre commerciale) : protégé contre les alertes météo tant que 0 char inscrit · validation possible jour par jour, à la semaine ou au mois.',
          'Cycle 2 (Pilotage terrain) : déclenché dès le 1er char inscrit (Maintenir, Décaler, Regrouper, Vie 2, REX).',
          'Capacité : règle officielle en nombre de chars (1 mono = 1 char, 1 bi = 1 char, max 12 chars / moniteur).',
          '100 % Digital : suppression définitive de la Fiche Agenda Papier · SMS clients reportés au nouvel outil de résa.',
        ],
        docUrl: '/note_arbitrage_cycle1_cycle2_digital.html',
        docBtnLabel: '⚡ Ouvrir la Note d’Arbitrage pour Jérôme (A4 / Word)',
        statusBadge: {
          label: '100 % Appliquée · Prête à archiver',
          bg: '#dcfce7',
          color: '#166534',
        },
      },
      {
        id: 'note-evolution-deux-temps',
        category: 'reservation',
        categoryLabel: 'Évolution Majeure',
        categoryColor: '#dc2626',
        icon: '🚀',
        title: 'Note Stratégique : Les 2 Temps, le Cycle en 6 Étapes & Nouveaux Modules',
        subtitle: 'Anticipation vs Tactique, Décalage/Regroupement, Garde-fou 0 pilote, Litto3D · Heures & Stats transférées',
        summary:
          'Synthèse clôturée : l’organisation en 2 temps, le décalage/regroupement, le garde-fou 0 pilote, la séparation Vie 1 / Vie 2 et Litto3D/GPS sont en production. Les SMS suivent le chantier Billetterie, et les volets Heures moniteur + Statistiques avancées ont été transférés dans « Axes d’Amélioration ».',
        keyPoints: [
          'Cycle Opérationnel & Ajustements (En prod) : Cycle 1 / Cycle 2, décalage horaire, fusion de créneaux et séparation Vie 1 / Vie 2.',
          'Garde-fou Métier Inviolable (En prod) : aucun passage en séance réalisée à 0 pilote inscrit (12 chars max/moniteur).',
          'Topographie Litto3D & GPS (En prod) : coupe altimétrique NGF + module d’étalonnage plage.',
          'Transférés en Axes d’Amélioration / Phase 2 : Heures moniteur (estran + prépa), Stats complémentaires et automatisations SMS billetterie.',
        ],
        docUrl: '/note_evolution_majeure_deux_temps.html',
        docBtnLabel: '🚀 Ouvrir la Note Évolution Majeure (2 Pages A4 / Word)',
        statusBadge: {
          label: 'Clôturée · Prête à archiver',
          bg: '#dcfce7',
          color: '#166534',
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
        subtitle: 'Modèle Lidar IGN/SHOM, pente 1,15 % · Q1 & Q2 (50 m) cadrées, Q3 transférée en Améliorations',
        summary:
          'Utilisation des données altimétriques publiques de haute précision Litto3D Finistère (économie géomètre : ~4 000 €). Les arbitrages sont posés : référence au Pied de dune (Q1), marge haute fixée à 50 m (Q2) et bâches/ruissellements transférés dans Axes d’amélioration (Q3). Il ne reste plus que la prise des points GPS sur la plage avec le Guide de mesure.',
        keyPoints: [
          'Pente réelle moyenne d’estran : 1,15 % (1 cm vertical d’eau = ~87 cm à 1 m de sable praticable mangé).',
          'Question 1 (Actée sur le principe) : référence au Pied de dune + bornes Gauche/Droite (à relever sur place via le Guide de mesure).',
          'Question 2 (Actée : 50 m fixes) : marge haute de sable sec/mou fixée à 50 mètres, synchronisée entre le Cadre de Roulage et Litto3D.',
          'Question 3 (Transférée ➔ Axes d’amélioration) : bâches & ruissellements trop complexes à modéliser sans historique REX.',
        ],
        docUrl: '/note_cadrage_lestrevet_jerome.html',
        docBtnLabel: '📝 Ouvrir la Note Lestrevet (1 page A4)',
        statusBadge: {
          label: 'Arbitrages clos · Prête à archiver',
          bg: '#dcfce7',
          color: '#166534',
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
          'Notre application reste le cerveau métier exclusif (calcul des marées glissantes, règle de 50, AROME, inscriptions numériques). L’outil de vente externe assure la billetterie, le paiement sécurisé et l’automatisation future des SMS.',
        keyPoints: [
          'Pont 1 (Amont) : Publication automatique des bons créneaux calculés (Cycle 1) dans l’agenda de vente.',
          'Pont 2 (Aval) : Rapatriement automatique des inscrits pour déclencher le Cycle 2 et pré-remplir les séances en numérique.',
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
    } catch {
      // Erreur déjà journalisée
    }
  };

  // Ouverture et sauvegarde du QCM dans l'app
  const handleOpenQcmModal = (noteId: string) => {
    const def = TECH_NOTE_QCMS[noteId];
    if (!def) return;
    const existing = qcmMap[noteId];
    setQcmDraftAnswers(existing?.answers ? { ...existing.answers } : {});
    setQcmDraftNotes(existing?.notes ? { ...existing.notes } : {});
    if (existing?.respondent) {
      setQcmRespondent(existing.respondent);
    } else {
      const cur = getActiveInstructor();
      setQcmRespondent(cur === 'Benoît' ? 'Benoît' : 'Jérôme');
    }
    setQcmSaveError(null);
    setActiveQcmDef(def);
  };

  const handleToggleQcmOption = (questionId: string, optionId: string, type: 'radio' | 'checkbox') => {
    setQcmDraftAnswers(prev => {
      const current = prev[questionId] || [];
      if (type === 'radio') {
        return { ...prev, [questionId]: [optionId] };
      }
      const exists = current.includes(optionId);
      return {
        ...prev,
        [questionId]: exists ? current.filter(id => id !== optionId) : [...current, optionId],
      };
    });
  };

  const handleSaveQcm = async () => {
    if (!activeQcmDef) return;
    setIsSavingQcm(true);
    setQcmSaveError(null);
    const totalQuestions = activeQcmDef.questions.length;
    const answeredCount = activeQcmDef.questions.filter(
      q => (qcmDraftAnswers[q.id]?.length || 0) > 0
    ).length;

    const submission: TechNoteQcmSubmission = {
      noteId: activeQcmDef.noteId,
      answers: qcmDraftAnswers,
      notes: qcmDraftNotes,
      respondent: qcmRespondent || 'Jérôme',
      submittedAt: Date.now(),
      answeredCount,
      totalQuestions,
    };

    try {
      await saveTechNoteQcmToFirestore(activeQcmDef.noteId, submission);
      setQcmMap(prev => {
        const next = { ...prev, [activeQcmDef.noteId]: submission };
        try {
          localStorage.setItem(QCM_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      setActiveQcmDef(null);
    } catch (err) {
      setQcmSaveError(
        'Impossible d’enregistrer les réponses pour le moment : ' + ((err as Error)?.message || 'erreur réseau')
      );
    } finally {
      setIsSavingQcm(false);
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
              { id: 'amelioration', label: '💡 Améliorations' },
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
            const qcmDef = TECH_NOTE_QCMS[note.id];
            const qcmSubmission = qcmMap[note.id];
            const hasQcmAnswers = Boolean(qcmSubmission && qcmSubmission.answeredCount > 0);
            const isQcmComplete = Boolean(
              qcmDef && qcmSubmission && qcmSubmission.answeredCount >= qcmDef.questions.length
            );

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

                  {/* Bandeau réponses QCM synchronisées dans l'app */}
                  {qcmDef && hasQcmAnswers && qcmSubmission && (
                    <div
                      style={{
                        background: isQcmComplete ? '#ecfdf5' : '#eff6ff',
                        border: `1.5px solid ${isQcmComplete ? '#6ee7b7' : '#93c5fd'}`,
                        borderRadius: '8px',
                        padding: '8px 10px',
                        marginBottom: '10px',
                        fontSize: '0.72rem',
                        color: isQcmComplete ? '#065f46' : '#1e40af',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontWeight: 800 }}>
                        <span>
                          {isQcmComplete ? '✅' : '📝'} QCM rempli par <strong>{qcmSubmission.respondent}</strong> ({qcmSubmission.answeredCount}/{qcmDef.questions.length})
                        </span>
                        <span style={{ fontSize: '0.66rem', opacity: 0.85 }}>
                          le {new Date(qcmSubmission.submittedAt).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                      <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.68rem', color: '#334155' }}>
                        {qcmDef.questions.slice(0, 3).map((q, idx) => {
                          const chosenIds = qcmSubmission.answers?.[q.id] || [];
                          if (chosenIds.length === 0) return null;
                          const chosenText = chosenIds
                            .map(id => q.options.find(o => o.id === id)?.label || id)
                            .join(' + ');
                          return (
                            <div key={q.id} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <strong>Q{idx + 1} :</strong> {chosenText}
                            </div>
                          );
                        })}
                        {qcmDef.questions.length > 3 && qcmSubmission.answeredCount > 3 && (
                          <div style={{ fontSize: '0.65rem', color: '#475569', fontStyle: 'italic' }}>
                            + autres réponses enregistrées (cliquer sur « Voir / Modifier réponses »)
                          </div>
                        )}
                      </div>
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
                        background: isProcessed
                          ? '#dcfce7'
                          : hasQcmAnswers
                          ? isQcmComplete
                            ? '#dcfce7'
                            : '#dbeafe'
                          : note.statusBadge.bg,
                        color: isProcessed
                          ? '#166534'
                          : hasQcmAnswers
                          ? isQcmComplete
                            ? '#166534'
                            : '#1d4ed8'
                          : note.statusBadge.color,
                      }}
                    >
                      {isProcessed
                        ? '✓ Traitée'
                        : hasQcmAnswers
                        ? isQcmComplete
                          ? `✓ Répondu (${qcmSubmission?.answeredCount}/${qcmDef?.questions.length})`
                          : `📝 ${qcmSubmission?.answeredCount}/${qcmDef?.questions.length} rép.`
                        : note.statusBadge.label}
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

                {/* Barre d'action inférieure : Bouton QCM in-app (si QCM), Bouton A4/Word + Marquer traitée */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {qcmDef && (
                    <button
                      type="button"
                      onClick={() => handleOpenQcmModal(note.id)}
                      style={{
                        width: '100%',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        background: hasQcmAnswers ? '#0f766e' : note.categoryColor,
                        color: '#ffffff',
                        border: 'none',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 900,
                        cursor: 'pointer',
                        boxShadow: `0 3px 10px ${(hasQcmAnswers ? '#0f766e' : note.categoryColor)}35`,
                      }}
                    >
                      <span>{hasQcmAnswers ? '👁️' : '✍️'}</span>
                      <span>
                        {hasQcmAnswers
                          ? `Voir / Modifier les réponses dans l’app (${qcmSubmission?.answeredCount}/${qcmDef.questions.length})`
                          : 'Répondre au QCM directement dans l’app'}
                      </span>
                    </button>
                  )}

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                        background: qcmDef ? '#f8fafc' : isProcessed ? '#64748b' : note.categoryColor,
                        color: qcmDef ? '#334155' : '#ffffff',
                        border: qcmDef ? '1.5px solid #cbd5e1' : 'none',
                        textDecoration: 'none',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        fontSize: qcmDef ? '0.72rem' : '0.76rem',
                        fontWeight: 800,
                        textAlign: 'center',
                        boxShadow: qcmDef || isProcessed ? 'none' : `0 3px 10px ${note.categoryColor}30`,
                        transition: 'opacity 0.15s ease',
                      }}
                    >
                      <span>{qcmDef ? '📄 Version imprimable (Word / PDF)' : note.docBtnLabel}</span>
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
                <option value="Jérôme">Jérôme (Moniteur titulaire)</option>
                <option value="Benoît">Benoît (Concepteur)</option>
                <option value="Jérôme & Benoît">Jérôme (Moniteur) &amp; Benoît (Concepteur)</option>
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

      {/* MODALE QCM INTERACTIF DANS L'APPLI (SYNCHRONISÉE CLOUD) */}
      {activeQcmDef && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(4px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
          }}
          onClick={() => !isSavingQcm && setActiveQcmDef(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '760px',
              width: '100%',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
              border: `2px solid ${activeQcmDef.accentColor}`,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* En-tête fixe */}
            <div
              style={{
                background: '#0f172a',
                color: '#ffffff',
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      background: activeQcmDef.accentColor,
                      color: '#ffffff',
                      fontSize: '0.66rem',
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                    }}
                  >
                    QCM Synchronisé Cloud
                  </span>
                  <span style={{ fontSize: '0.70rem', color: '#cbd5e1', fontWeight: 700 }}>
                    {
                      activeQcmDef.questions.filter(
                        q => (qcmDraftAnswers[q.id]?.length || 0) > 0
                      ).length
                    }{' '}
                    / {activeQcmDef.questions.length} questions répondues
                  </span>
                </div>
                <h3 style={{ margin: '6px 0 2px', fontSize: '1.08rem', fontWeight: 900 }}>
                  {activeQcmDef.title}
                </h3>
                <div style={{ fontSize: '0.74rem', color: '#cbd5e1' }}>
                  {activeQcmDef.subtitle}
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingQcm}
                onClick={() => setActiveQcmDef(null)}
                aria-label="Fermer le QCM"
                style={{
                  background: '#334155',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Corps scrollable */}
            <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1, background: '#f8fafc' }}>
              {/* Contexte */}
              <div
                style={{
                  background: '#ffffff',
                  border: `1.5px solid ${activeQcmDef.accentColor}40`,
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '14px',
                }}
              >
                <div style={{ fontWeight: 900, fontSize: '0.84rem', color: '#0f172a', marginBottom: '6px' }}>
                  {activeQcmDef.contextTitle}
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.75rem', color: '#334155', lineHeight: 1.45 }}>
                  {activeQcmDef.contextBullets.map((b, i) => (
                    <li key={i} style={{ marginBottom: '3px' }}>
                      {b}
                    </li>
                  ))}
                </ul>

                {activeQcmDef.exampleSlots && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', marginTop: '10px' }}>
                    {activeQcmDef.exampleSlots.map((slot, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          borderLeft: `4px solid ${slot.borderColor}`,
                          borderRadius: '6px',
                          padding: '7px 10px',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>
                          {slot.timeLabel} · {slot.instructor}
                        </div>
                        <div style={{ color: '#475569', marginTop: '2px' }}>{slot.details}</div>
                      </div>
                    ))}
                  </div>
                )}

                {activeQcmDef.exampleImageUrl && (
                  <div style={{ marginTop: '10px', textAlign: 'center' }}>
                    <img
                      src={activeQcmDef.exampleImageUrl}
                      alt={activeQcmDef.exampleImageCaption || 'Plan secteur Lestrevet'}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '220px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        objectFit: 'contain',
                      }}
                    />
                    {activeQcmDef.exampleImageCaption && (
                      <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '4px' }}>
                        {activeQcmDef.exampleImageCaption}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Répondant */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#0f172a' }}>
                  👤 Qui répond à ce questionnaire ?
                </span>
                <select
                  value={qcmRespondent}
                  onChange={e => setQcmRespondent(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    background: '#f8fafc',
                    color: '#0f172a',
                  }}
                >
                  <option value="Jérôme">Jérôme (Moniteur titulaire)</option>
                  <option value="Benoît">Benoît (Concepteur)</option>
                  <option value="Jérôme & Benoît">Jérôme &amp; Benoît ensemble</option>
                </select>
              </div>

              {/* Liste des questions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activeQcmDef.questions.map(q => {
                  const selectedIds = qcmDraftAnswers[q.id] || [];
                  return (
                    <div
                      key={q.id}
                      style={{
                        background: '#ffffff',
                        border: selectedIds.length > 0 ? `1.5px solid ${activeQcmDef.accentColor}` : '1.5px solid #cbd5e1',
                        borderLeft: `4px solid ${activeQcmDef.accentColor}`,
                        borderRadius: '10px',
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 900, color: '#0f172a' }}>
                          {q.title}
                        </div>
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: `${activeQcmDef.accentColor}15`,
                            color: activeQcmDef.accentColor,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {q.tag}
                        </span>
                      </div>
                      <p style={{ margin: '0 0 8px', fontSize: '0.75rem', color: '#475569' }}>
                        {q.description}
                      </p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                        {q.options.map(opt => {
                          const isChecked = selectedIds.includes(opt.id);
                          return (
                            <label
                              key={opt.id}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '10px',
                                padding: '9px 10px',
                                borderRadius: '8px',
                                border: isChecked ? `1.5px solid ${activeQcmDef.accentColor}` : '1px solid #e2e8f0',
                                background: isChecked ? `${activeQcmDef.accentColor}10` : '#f8fafc',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type={q.type}
                                name={`inapp_${activeQcmDef.noteId}_${q.id}`}
                                checked={isChecked}
                                onChange={() => handleToggleQcmOption(q.id, opt.id, q.type)}
                                style={{
                                  marginTop: '3px',
                                  accentColor: activeQcmDef.accentColor,
                                  transform: 'scale(1.15)',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                }}
                              />
                              <div style={{ fontSize: '0.76rem', lineHeight: 1.4, color: '#0f172a' }}>
                                <div style={{ fontWeight: isChecked ? 900 : 700 }}>
                                  {opt.label}
                                </div>
                                <div style={{ fontSize: '0.71rem', color: '#475569', marginTop: '2px' }}>
                                  {opt.detail}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      <textarea
                        rows={2}
                        value={qcmDraftNotes[q.id] || ''}
                        onChange={e =>
                          setQcmDraftNotes(prev => ({ ...prev, [q.id]: e.target.value }))
                        }
                        placeholder={q.placeholder}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '6px 9px',
                          fontSize: '0.74rem',
                          fontFamily: 'inherit',
                          background: '#fcfcfc',
                          color: '#0f172a',
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  );
                })}

                {/* Remarques générales */}
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1.5px solid #fcd34d',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: '0.78rem', color: '#92400e', marginBottom: '6px' }}>
                    ✍️ Remarques libres ou précisions complémentaires :
                  </div>
                  <textarea
                    rows={3}
                    value={qcmDraftNotes.general || ''}
                    onChange={e =>
                      setQcmDraftNotes(prev => ({ ...prev, general: e.target.value }))
                    }
                    placeholder="Ex : contraintes particulières, dates de haute saison, nombre exact de chars au parc…"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      border: '1px solid #fcd34d',
                      borderRadius: '6px',
                      padding: '7px 10px',
                      fontSize: '0.75rem',
                      fontFamily: 'inherit',
                      background: '#ffffff',
                      color: '#0f172a',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>

              {qcmSaveError && (
                <div
                  style={{
                    marginTop: '12px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                  }}
                >
                  {qcmSaveError}
                </div>
              )}
            </div>

            {/* Pied de modale fixe */}
            <div
              style={{
                padding: '12px 18px',
                background: '#ffffff',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Synchronisé en direct entre Jérôme et Benoît
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  disabled={isSavingQcm}
                  onClick={() => setActiveQcmDef(null)}
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={isSavingQcm}
                  onClick={handleSaveQcm}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: activeQcmDef.accentColor,
                    color: '#ffffff',
                    fontSize: '0.78rem',
                    fontWeight: 900,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: `0 3px 10px ${activeQcmDef.accentColor}40`,
                  }}
                >
                  <span>✓</span>
                  <span>{isSavingQcm ? 'Enregistrement…' : 'Enregistrer mes réponses'}</span>
                </button>
              </div>
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
