# Module de Statistiques Opérationnelles & Observatoire des Écarts Terrain (Lestrevet)

Création d'un module complet d'analyse statistique de l'activité du club (séances possibles vs réalisées, camembert interactif des causes d'annulation, filtres semaine / mois / année) couplé à un observatoire de calibration terrain pour enregistrer et corréler les écarts entre marées théoriques et observations réelles (surcote, vent, pression, houle).

### User Review & Critical Decisions

> [!IMPORTANT]
> Les trois orientations majeures validées avec l'utilisateur :
> 1. **Nouvel onglet dédié « Statistiques & Relevés »** : Intégré dans la navigation principale de l'application (entre *Fiche Agenda Papier* et *Hypothèses & Notes*) pour offrir un espace analytique spacieux, clair et dédié sans surcharger les écrans quotidiens.
> 2. **Saisie rapide en 2 clics au fil de l'eau** : Le moniteur peut consigner la cause d'annulation ou les relevés réels d'eau directement depuis la fiche du jour (onglets Calendrier et Focus), tout en ayant un tableau de gestion consolidé dans l'onglet Statistiques.
> 3. **Observatoire de corrélation multi-paramètres** : Croisement des écarts constatés de hauteur d'eau / d'horaires avec la pression barométrique, le vent (force + secteur) et la houle, débouchant sur une suggestion d'ajustement du seuil de roulage pour le spot de Lestrevet.

- **Décision confirmée 1** : Emplacement dans un 5e onglet dédié `📊 Statistiques & Relevés` accessible via la barre de navigation.
- **Décision confirmée 2** : Les causes d'annulation standardisées incluent : Vent faible (< 8 nds), Vent fort / rafales, Mauvaise direction (déventé), Absence d'inscrits, Plage / bâches impraticables, Orage / Météo extrême, Maintenance / Moniteur indisponible, et Autre avec note libre.
- **Décision confirmée 3** : Stockage persistant des relevés et statistiques via le stockage local (`localStorage`), avec fonction d'export CSV pour archivage ou analyse tableur.

---

### 1. Overview & Core Concept

- **Problématique résolue** : Le club disposait d'un moteur de calcul théorique puissant (marées SHOM, seuil de roulage, météo AROME), mais manquait d'une vision synthétique sur son taux de transformation réel (combien de créneaux théoriques deviennent de vraies séances payantes ?) et d'un outil pour vérifier si la théorie colle à la réalité de la plage de Lestrevet.
- **Utilisateurs cibles** : Le moniteur principal et le gestionnaire du club de char à voile de Lestrevet.
- **Bénéfices clés** :
  1. *Bilan d'activité* : Mesurer précisément la part de séances annulées pour météo vs pour manque de clients, pour adapter les plannings et la communication.
  2. *Calibration physique du spot* : Quantifier l'impact réel des vents d'Ouest et de la dépression barométrique sur la hauteur d'eau à Lestrevet afin d'affiner le seuil de 4.50 m.

---

### 2. User Experience & Visual Design

#### A. Architecture de navigation & Intégration
- La barre d'onglets principale est enrichie d'un nouvel onglet :
  `[ Calendrier ] [ Focus Lendemain ] [ 📋 Fiche Agenda Papier ] [ 📊 Statistiques & Relevés ] [ 💡 Hypothèses & Notes ]`
- L'onglet s'ouvre sur une interface structurée en 2 sous-sections fluides :
  1. **Tableau de Bord des Séances & Taux de Réalisation** (avec sélecteur de granularité : *Semaine*, *Mois*, *Année / Saison*).
  2. **Observatoire des Écarts Terrain & Calibration Marée** (historique des relevés réels, écarts cm / min, et corrélations météo).

#### B. Volet 1 : Statistiques & Camembert des Causes
- **Sélecteur de période** :
  - Boutons segmentés : `Cette semaine` / `Ce mois` / `Année 2026` / `Période personnalisée`.
  - Filtre contextuel supplémentaire : `Tous les jours` / `Vacances scolaires uniquement` / `Week-ends uniquement`.
- **Cartes métriques clés (KPIs sans effet de pill, typographie soignée)** :
  - **Taux de réalisation** : e.g. `78.4 %` (47 séances réalisées sur 60 créneaux possibles).
  - **Séances réalisées** : e.g. `47 séances` (dont 6 sur-mesure).
  - **Séances non réalisées / annulées** : e.g. `13 séances`.
  - **Taux de remplissage moyen** : e.g. `8.6 participants / 12 places (72 %)`.
  - **Total participants accueillis** : e.g. `404 personnes`.
- **Graphique interactif (Camembert SVG natif et réactif)** :
  - Découpage visuel coloré des causes de non-réalisation :
    - 🔵 *Vent insuffisant* (< 8 nds)
    - 🔴 *Vent trop fort / rafales* (> 25/35 nds)
    - 🟠 *Vent déventé / mauvais secteur*
    - 🟣 *Manque d'inscrits / réservations nulles*
    - 🟤 *État de la plage / bâches d'eau trop hautes*
    - 🟡 *Orage / Météo extrême*
    - ⚪ *Maintenance ou indisponibilité moniteur*
  - Légende claire avec pourcentage et nombre absolu de séances.
  - Survol interactif mettant en valeur la tranche et affichant le détail.

#### C. Volet 2 : Observatoire des Écarts & Calibration du Spot
- **Modal / Tiroir de saisie rapide depuis le Calendrier & Focus** :
  - Sur chaque séance du jour, un bouton discret `📝 Noter le réel` permet au moniteur de renseigner en 15 secondes :
    - *Heure réelle de roulage effectif* (ex: 10h15 au lieu de 10h30 calculé -> -15 min).
    - *Hauteur d'eau constatée / surcote observée* (ex: +20 cm d'eau par rapport au tableau).
    - *Pression réelle & Rafales réelles*.
    - *Qualité du sable / bâches*.
- **Tableau comparatif & Visualisation des écarts** :
  - Colonnes claires : *Date & Séance*, *Heure Théorique*, *Heure Réelle*, *Écart (min)*, *Eau Théorique*, *Eau Réelle*, *Surcote constatée (cm)*, *Pression*, *Vent réel*, *Houle*.
  - **Graphique de corrélation (Scatter plot SVG)** : Nuage de points montrant la surcote constatée (axe Y) en fonction de la pression atmosphérique et de la composante de vent d'Ouest (axe X).
  - **Synthèse de calibration automatique** :
    - *« Sur la base de vos N relevés, la surcote moyenne par vent d'Ouest > 15 nds est de +18 cm. Le seuil de roulage moyen effectif observé est de 4.35 m. »*

---

### 3. Key Product Decisions & Trade-Offs

- **Approche technique pour les graphiques** : Composants SVG purs React (zéro dépendance lourde tierce comme Chart.js ou Recharts, garantissant une vitesse d'exécution instantanée, un bundle ultra-léger et une intégration parfaite dans Tailwind).
- **Persistance des données** : Stockage local structuré (`localStorage` via une clé dédiée `cv_observations_v1` et `cv_session_stats_v1`) avec versionnage de schéma et sécurité contre la perte de données.
- **Export & Sauvegarde** : Bouton d'exportation CSV / JSON en un clic permettant d'exporter l'intégralité des relevés et statistiques pour Excel ou sauvegarde externe.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              APP ARCHITECTURE                                │
└─────────────────────────────────────────────────────────────────────────────┘

                  ┌─────────────────────────────────────┐
                  │       App.tsx (Root Tabs Nav)       │
                  └──────────────────┬──────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
┌────────▼────────┐         ┌────────▼────────┐         ┌────────▼────────┐
│  CalendarGrid   │         │    FocusTab     │         │  StatisticsTab  │
│  & DayDetail    │         │ (Quick log CTA) │         │  (New Component)│
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         └─────────────┬─────────────┘                           │
                       │                                         │
            ┌──────────▼──────────┐                              │
            │  SlotFeedbackModal  │                              │
            │ (Cancel reason &    │                              │
            │  Water delta entry) │                              │
            └──────────┬──────────┘                              │
                       │                                         │
                       ▼                                         ▼
            ┌─────────────────────────────────────────────────────────────┐
            │        Local Persistence (localStorage / Memory Cache)      │
            │  - cv_validations_v1 (Decisions & Cancellation reasons)     │
            │  - cv_observations_v1 (Water deltas, real pressure, wind)   │
            │  - cv_bookings_v1 (Pax counts & filled seats)               │
            └─────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
            ┌─────────────────────────────────────────────────────────────┐
            │              Analytics Engine (statisticsEngine.ts)         │
            │  - Aggregations: Week / Month / Year                        │
            │  - Realization Ratio & Fill Rate Calculation                │
            │  - Cancellation Reasons Slices for Pie Chart                │
            │  - Water Delta Correlation Matrix (vs Pression & Wind)      │
            └─────────────────────────────────────────────────────────────┘
```

#### Modèles de données prévus

```typescript
// 1. Observation terrain liée à un créneau
export interface SlotObservation {
  id: string;
  ds: string;             // Date YYYY-MM-DD
  slotKey: string;        // Identifiant du créneau
  slotStart: string;
  slotEnd: string;
  actualPassableTime?: string; // Heure réelle où le sable est devenu praticable
  timeDeltaMin?: number;        // Écart en minutes (+ = retard, - = avance)
  actualWaterHeight?: number;   // Hauteur d'eau constatée
  waterDeltaCm?: number;        // Surcote / sous-cote réelle constatée (+20 cm, -10 cm)
  observedPressure?: number;    // Pression mesurée (hPa)
  observedWindKts?: number;     // Vent moyen mesuré (nds)
  observedGustKts?: number;     // Rafales mesurées (nds)
  observedWindDir?: string;     // Secteur réel
  observedWaveH?: number;       // Houle constatée
  beachCondition?: 'dur' | 'mou' | 'baches_faibles' | 'baches_fortes';
  notes?: string;
  createdAt: number;
}

// 2. Motif d'annulation standardisé
export type CancellationReason =
  | 'wind_low'       // Vent trop faible (< 8 nds)
  | 'wind_high'      // Vent trop fort / rafales (> 25/35 nds)
  | 'wind_direction' // Déventé / mauvais secteur
  | 'no_bookings'    // Manque d'inscrits / 0 client
  | 'beach_state'    // Bâches d'eau / sable trop mou / impraticable
  | 'extreme_weather'// Orage / pluie battante / submersion
  | 'instructor'     // Indisponibilité moniteur / matériel
  | 'other';         // Autre raison avec commentaire
```
