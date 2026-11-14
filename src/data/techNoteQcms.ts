export interface TechNoteQcmOption {
  id: string;
  label: string;
  detail: string;
  recommended?: boolean;
}

export interface TechNoteQcmQuestion {
  id: string;
  title: string;
  tag: string;
  description: string;
  type: 'radio' | 'checkbox';
  placeholder: string;
  options: TechNoteQcmOption[];
}

export interface TechNoteQcmDefinition {
  noteId: string;
  title: string;
  subtitle: string;
  accentColor: string;
  contextTitle: string;
  contextBullets: string[];
  exampleImageUrl?: string;
  exampleImageCaption?: string;
  exampleSlots?: {
    timeLabel: string;
    instructor: string;
    details: string;
    borderColor: string;
  }[];
  questions: TechNoteQcmQuestion[];
}

export const TECH_NOTE_QCMS: Record<string, TechNoteQcmDefinition> = {
  'note-creneaux-simultanes-ete': {
    noteId: 'note-creneaux-simultanes-ete',
    title: 'QCM · Créneaux Simultanés d’Été & Multi-Moniteurs',
    subtitle: 'Cas type : 2 séances sur la même tranche horaire (ex. 15h Jérôme + 15h Katleen)',
    accentColor: '#7c3aed',
    contextTitle: '☀️ Pourquoi ce cadrage est nécessaire avant l’été ?',
    contextBullets: [
      'Aujourd’hui dans le moteur, chaque créneau est identifié uniquement par son heure de début (ex. 15:00) avec une règle de 12 chars max / moniteur.',
      'En haute saison, deux séances peuvent tourner à la même heure (ex. 15h00 Jérôme + 15h00 Katleen).',
      'Tes réponses fixent comment séparer les inscrits, le plafond total de chars du club et l’affichage téléphone.',
    ],
    exampleSlots: [
      {
        timeLabel: '15h00 – 16h30',
        instructor: '👤 Jérôme',
        details: 'Découverte / Grand public · 10 / 12 chars (Cycle 2 actif)',
        borderColor: '#0284c7',
      },
      {
        timeLabel: '15h00 – 16h30',
        instructor: '👤 Katleen',
        details: 'Groupe / Stage · 6 / 12 chars · Total parc simultané : 16 chars',
        borderColor: '#7c3aed',
      },
    ],
    questions: [
      {
        id: 'q1',
        title: 'Question 1 · Modèle choisi quand deux séances roulent sur la même heure (ex. 15h)',
        tag: 'Architecture Cycle 1 & 2',
        description: 'Comment préfères-tu structurer deux séances simultanées à 15h00 dans l’application ?',
        type: 'radio',
        placeholder: 'Précision de Jérôme sur la séparation ou le regroupement des groupes de 15h…',
        options: [
          {
            id: 'opt_a',
            recommended: true,
            label: 'Option A (Recommandée) · 2 séances bien distinctes à 15h',
            detail:
              'Chacune a son moniteur (Jérôme / Katleen), sa jauge 12 chars, sa liste d’élèves, son décalage/annulation Cycle 2 indépendant et son REX propre.',
          },
          {
            id: 'opt_b',
            label: 'Option B · 1 seul gros créneau 15h multi-moniteurs (ex. 24 chars)',
            detail: 'Un créneau unique à 24 places max, où les groupes sont répartis sur place à l’oral.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Passage manuel via « Modifier les créneaux »',
            detail: 'Garder le fonctionnement actuel et ajouter la 2e séance à la main au cas par cas.',
          },
        ],
      },
      {
        id: 'q2',
        title: 'Question 2 · Horaires, durées et formules des séances en parallèle',
        tag: 'Souplesse Horaires',
        description: 'Lorsque Jérôme et Katleen encadrent en même temps l’après-midi, leurs créneaux sont-ils strictement calqués ou parfois différents ?',
        type: 'radio',
        placeholder: 'Exemples concrets de l’été dernier (heures, durées, types de public)…',
        options: [
          {
            id: 'opt_a',
            recommended: true,
            label: 'Option A (Souple) · Même départ par défaut, fin ou formule modifiables',
            detail: 'Ex. 15h–16h30 Découverte (Jérôme) et 15h–17h00 Perfectionnement / Stage (Katleen).',
          },
          {
            id: 'opt_b',
            label: 'Option B (Identique) · Dédoublement strict à l’identique',
            detail: 'Toujours exactement les mêmes horaires et la même durée que le créneau marée calculé.',
          },
          {
            id: 'opt_c',
            label: 'Option C (Décalage accueil) · Départs parfois décalés de 15–30 min',
            detail: 'Ex. 15h00 Jérôme / 15h15 Katleen pour fluidifier les briefings au parking.',
          },
        ],
      },
      {
        id: 'q3',
        title: 'Question 3 · Limite matériel : jauge moniteur (12 chars) vs parc total simultané',
        tag: 'Parc Chars & Sécurité',
        description: '1 moniteur = 12 chars max. Si deux moniteurs tournent à 15h00 en même temps, combien de chars du club peuvent sortir simultanément ?',
        type: 'radio',
        placeholder: 'Indiquer ici le nombre exact de chars roulants disponibles au parc (monos + bis)…',
        options: [
          {
            id: 'opt_a',
            recommended: true,
            label: 'Option A (Recommandée) · Plafond global « Parc simultané » dans les réglages',
            detail: 'Ex. 16 ou 18 chars max au parc : alerte rouge si Jérôme + Katleen dépassent ce parc à 15h.',
          },
          {
            id: 'opt_b',
            label: 'Option B (Fine Mono / Bi) · Plafond séparé Monoplaces et Biplaces',
            detail: 'Alerte distincte si on manque de biplaces ou de monoplaces utilisables en même temps.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Uniquement 12 chars max par moniteur (jusqu’à 24)',
            detail: 'Pas de limite globale de parc nécessaire dans l’app.',
          },
        ],
      },
      {
        id: 'q4',
        title: 'Question 4 · Gestion des moniteurs & accès à l’app (Katleen, saisonniers…)',
        tag: 'Équipe & Accès',
        description: 'Comment Katleen (ou un autre moniteur d’été) doit-elle être gérée dans « Ça roule ? » ?',
        type: 'radio',
        placeholder: 'Prénoms habituels des moniteurs d’été et besoin éventuel de comptage d’heures…',
        options: [
          {
            id: 'opt_a',
            label: 'Option A (Simple) · Liste de prénoms paramétrable pilotée par Jérôme',
            detail: 'Choix rapide (Jérôme, Katleen, renfort…) sur chaque créneau sans créer de compte séparé.',
          },
          {
            id: 'opt_b',
            label: 'Option B (Autonomie terrain) · Accès moniteur dédié pour Katleen',
            detail: 'Elle consulte ses élèves de 15h sur son téléphone et saisit son REX, sans accès admin.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Compte partagé / lecture seule',
            detail: 'Elle utilise simplement le compte partagé / lecture seule pour consulter le planning du jour.',
          },
        ],
      },
      {
        id: 'q5',
        title: 'Question 5 · Comment déclencher le doublon à 15h au quotidien ?',
        tag: 'Ergonomie Planning',
        description: 'Quel geste veux-tu avoir dans l’écran du jour pour ajouter la deuxième séance de Katleen ?',
        type: 'radio',
        placeholder: 'Périodes de l’année concernées (juillet-août, ponts de mai, Toussaint ?)…',
        options: [
          {
            id: 'opt_a',
            recommended: true,
            label: 'Option A (1 clic) · Bouton « + Doubler (2e moniteur) » sur le créneau',
            detail: 'Copie l’horaire marée en 1 tap et assigne Katleen à côté de ta séance.',
          },
          {
            id: 'opt_b',
            label: 'Option B (Au remplissage) · Ouverture de la 2e séance à 10–12 chars',
            detail: 'On publie 1 séance au départ, puis on ajoute le doublon quand la première est presque pleine.',
          },
          {
            id: 'opt_c',
            label: 'Option C (Automatique été) · Mode Haute Saison sur juillet–août',
            detail: 'Plage de dates paramétrable qui ouvre 2 créneaux d’office les après-midis d’été.',
          },
        ],
      },
      {
        id: 'q6',
        title: 'Question 6 · Affichage Calendrier, Agenda & Suivi des heures par moniteur',
        tag: 'Lisibilité & Stats',
        description: 'Comment afficher ces créneaux doublés sans surcharger l’écran sur smartphone ? (plusieurs choix possibles)',
        type: 'checkbox',
        placeholder: 'Autres besoins d’affichage ou contraintes de l’été (rotation matériel, navette, pauses)…',
        options: [
          {
            id: 'opt_1',
            label: 'Choix 1 · Badge prénom/couleur par moniteur (👤 Jérôme / 👤 Katleen)',
            detail: 'Identification visuelle immédiate sur chaque carte de séance du jour.',
          },
          {
            id: 'opt_2',
            label: 'Choix 2 · Filtre rapide « Toutes / Mes séances » dans la journée',
            detail: 'Permet à chacun d’isoler uniquement ses créneaux sur petit écran.',
          },
          {
            id: 'opt_3',
            label: 'Choix 3 · Séparation des heures roulées & chars par moniteur en stats',
            detail: 'Prépare le comptage individuel d’heures et de chars (en lien avec Axes d’Amélioration).',
          },
        ],
      },
    ],
  },

  'note-orientation-plage-lestrevet': {
    noteId: 'note-orientation-plage-lestrevet',
    title: 'QCM · Orientation Plage, Balise Pentrez vs Lestrevet & Zones GPS',
    subtitle: 'Calage des secteurs de vent (~335°/155°), de la houle OSO et des 3 zones de la baie',
    accentColor: '#0284c7',
    contextTitle: '📍 Repères du plan de la baie (Pentrez ↔ Lestrevet)',
    contextBullets: [
      'Axe réel de la plage : NNO ↔ SSE (~335° / 155°), ouvert face à l’OSO (~245°) sur la baie de Douarnenez.',
      'Arrière-pays : terres et reliefs de Kervennec juste derrière l’école à l’ENE (~65°).',
      '3 secteurs sur ~3–4 km : Plage de Pentrez (Nord · Balise Winds-Up Spot 66), La Lieue de Grève (Centre) et Plage de Lestrevet / École (Sud).',
    ],
    exampleImageUrl: '/assets/aistudio/image_1995386a.png',
    exampleImageCaption: 'Axe de roulage ~335°–155° · Face baie OSO (~245°) · Kervennec ENE (~65°)',
    questions: [
      {
        id: 'q1',
        title: 'Question 1 · Qualification de la direction du vent (Axe plage ~335° / 155°)',
        tag: 'Cycle 2 & Balise Winds-Up',
        description: 'Souhaites-tu afficher un indicateur automatique sur l’orientation du vent par rapport à l’axe de la plage ?',
        type: 'radio',
        placeholder: 'Précision de Jérôme sur les secteurs favorables / défavorables (ex. SSE vs NNO, limites en degrés)…',
        options: [
          {
            id: 'opt_a',
            label: 'Option A (Complète) · 3 badges : Travers mer / Dans l’axe / Vent de terre',
            detail: 'Travers mer optimal (OSO/O/SO), Dans l’axe de plage (NNO/SSE) et Vent de terre (NE/E/ESE).',
          },
          {
            id: 'opt_b',
            label: 'Option B (Simplifiée) · Alerte uniquement si Vent de terre ou Dans l’axe',
            detail: 'Aucun badge quand c’est travers mer, alerte seulement sur secteurs délicats.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Garder uniquement les nœuds et la boussole brute',
            detail: 'Pas de qualification automatique, juste la direction cardinale (NE, OSO…) et la vitesse.',
          },
        ],
      },
      {
        id: 'q2',
        title: 'Question 2 · Gestion du vent de terre (secteur NE / ENE / E / ESE via Kervennec)',
        tag: 'Dévente & Turbulence',
        description: 'Par vent d’Est / Nord-Est au-dessus de Kervennec et de la dune, l’air est souvent plus irrégulier devant l’école. Comment l’outil doit-il réagir ?',
        type: 'radio',
        placeholder: 'Commentaire de Jérôme (ex. seuil minimum réel par secteur NE/E vs O/OSO)…',
        options: [
          {
            id: 'opt_a',
            label: 'Option A · Alerte visuelle orange informative uniquement',
            detail: 'Affiche « Vent de terre : déventes possibles devant l’école » sans modifier le verdict auto.',
          },
          {
            id: 'opt_b',
            label: 'Option B · Verdict « Ouvrir avec réserves » si vent faible (< 10–11 nds)',
            detail: 'Évite les séances poussives lorsque le vent est faible par secteur de terre.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Aucune règle particulière sur le vent de terre',
            detail: 'Je décide au cas par cas sur place.',
          },
        ],
      },
      {
        id: 'q3',
        title: 'Question 3 · Écart géographique entre Balise Pentrez (Spot 66) et École Lestrevet (~3–4 km)',
        tag: 'Balise vs Terrain',
        description: 'La balise Winds-Up Spot 66 est à Pentrez (Nord) et AROME est centré au milieu (Lieue de Grève). Quelles actions veux-tu activer ? (plusieurs choix possibles)',
        type: 'checkbox',
        placeholder: 'Constat habituel de Jérôme entre le vent affiché à Pentrez et le vent réel à Lestrevet…',
        options: [
          {
            id: 'opt_1',
            label: 'Choix 1 · Ajouter au REX : « Vent Lestrevet vs Balise Pentrez (identique / + faible / + fort) »',
            detail: 'Un clic rapide en fin de séance pour objectiver les écarts entre les deux bouts de baie.',
          },
          {
            id: 'opt_2',
            label: 'Choix 2 · Recaler le point AROME exactement face à l’école à Lestrevet Sud',
            detail: 'Déplace la coordonnée de prévision du milieu de la Lieue de Grève vers le parking de Lestrevet.',
          },
          {
            id: 'opt_3',
            label: 'Choix 3 · Garder le point central actuel (Lieue de Grève)',
            detail: 'Représentatif de l’ensemble de la piste entre Lestrevet et Pentrez.',
          },
        ],
      },
      {
        id: 'q4',
        title: 'Question 4 · Découpage en 3 zones pour l’Étalonnage GPS (Onglet 7) & Bâches',
        tag: 'Étalonnage GPS',
        description: 'Lors des relevés GPS au bord de l’eau, la pente et les bâches varient entre Lestrevet Sud, la Lieue de Grève et Pentrez Nord.',
        type: 'radio',
        placeholder: 'Remarques sur les zones de bâches récurrentes, ruissellements ou cailloux…',
        options: [
          {
            id: 'opt_a',
            recommended: true,
            label: 'Option A (Recommandée) · Classement auto en 3 zones + largeur exploitable',
            detail: 'Identifie Lestrevet / Lieue de Grève / Pentrez d’après le GPS et calcule la largeur utile.',
          },
          {
            id: 'opt_b',
            label: 'Option B · Enregistrer uniquement l’étiquette de zone',
            detail: 'Sert uniquement à filtrer les stats et localiser les bâches par secteur.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Garder un étalonnage global unique',
            detail: 'Pas de découpage en 3 secteurs.',
          },
        ],
      },
      {
        id: 'q5',
        title: 'Question 5 · Impact de la houle de face (secteur OSO ~245°) sur la bande de roulage',
        tag: 'Marées & Houle',
        description: 'La baie s’ouvre plein OSO (~245°). Une houle frontale réduit plus vite la largeur sèche qu’une houle de NO abritée par Crozon.',
        type: 'radio',
        placeholder: 'Hauteur ou période de houle à partir de laquelle tu réduis ou décales les séances…',
        options: [
          {
            id: 'opt_a',
            label: 'Option A · Alerte Cycle 2 dès houle frontale (SO/OSO/O) ≥ 1,2 m',
            detail: 'Signale un « Jet de rive important » à surveiller en marée montante.',
          },
          {
            id: 'opt_b',
            label: 'Option B · Marge indicative (+10 à +15 cm sur le seuil L) si houle ≥ 1,5 m',
            detail: 'Propose automatiquement une marge de sécurité quand ça pousse frontalement.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Laisser uniquement les chiffres bruts de houle dans le tableau météo',
            detail: 'Aucune alerte ni marge automatique sur la houle.',
          },
        ],
      },
      {
        id: 'q6',
        title: 'Question 6 · Mini-schéma visuel « Axe de plage (335°–155°) + Flèche du vent »',
        tag: 'Ergonomie Terrain',
        description: 'Souhaites-tu intégrer un petit repère visuel montrant le trait de côte réel avec la flèche du vent en direct superposée ?',
        type: 'radio',
        placeholder: 'Autre idée ou besoin terrain suggéré par le plan…',
        options: [
          {
            id: 'opt_a',
            label: 'Option A · Oui, directement dans l’encart Winds-Up en Cycle 2',
            detail: 'Lecture instantanée de l’angle vent/plage juste avant de gréer.',
          },
          {
            id: 'opt_b',
            label: 'Option B · Oui, plutôt dans Étalonnage GPS / Statistiques',
            detail: 'Utile pour l’analyse mais pas nécessaire sur l’écran du jour.',
          },
          {
            id: 'opt_c',
            label: 'Option C · Non, la flèche actuelle et la direction cardinale suffisent',
            detail: 'Pas besoin d’ajouter de schéma supplémentaire.',
          },
        ],
      },
    ],
  },
};
