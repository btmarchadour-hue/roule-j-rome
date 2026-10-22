# Horaires de roulage – Char à Voile du Bout du Monde

Application React moderne et réactive pour le calcul et la prévision des plages de roulage et créneaux de séances pour l'école de char à voile **Char à Voile du Bout du Monde** sur la plage de Lestrevet (Plomodiern, Finistère).

## Fonctionnalités

- **Calcul dynamique des plages de roulage** :
  - Données astronomiques et hauteurs d'eau de marées (interpolation sinusoïdale entre PM et BM).
  - Éphémérides solaires précises (théorie de Meeus, lever, coucher, crépuscule civil) adaptées aux coordonnées de la plage de Lestrevet (`48.1837° N, -4.2944° W`).
  - Éphémérides lunaires (lever, coucher et phases lunaires calculées).
  - Roulage toute la journée sans contrainte de marée pour les coefficients de marée faibles (coef ≤ 50).
  - Correction barométrique automatique (+1 cm par hPa en dessous de 1013 hPa).

- **Génération automatique des séances de char à voile** :
  - Placement des séances de 60 minutes avec pauses adaptées (15 min en juillet-août, 30 min hors été).
  - Algorithme de calage par l'arrière (méthode du moniteur) ou par l'avant.
  - Détection et proposition de créneaux optionnels (tolérance de dépassement paramétrable).

- **Intégration météo et vent en temps réel** :
  - Prévisions haute résolution AROME de Météo-France (via Open-Meteo) sur 2 à 3 jours, relayées par le modèle global jusqu'à 16 jours.
  - Vitesses moyennes, rafales et directions du vent (16 points cardinaux).
  - Filtrage automatique selon les plages de navigabilité (8 à 25 nœuds, rafales max 35 nœuds).
  - Températures réelles et ressenties, probabilité et intensité des précipitations (mm/h), codes temps WMO.

- **Vues & Ergonomie** :
  - **Onglet Calendrier** : Vue mensuelle interactive avec pastilles d'aptitude vent, nombre de séances par jour, graphique de marnage mensuel, graphique sinusoïdal interactif de marée avec réticule d'analyse horaire, graphique de vent à 10 m, et résumé complet du jour sélectionné.
  - **Onglet Focus** : Verdict synthétique du jour (`OUVRIR`, `OUVRIR AVEC RÉSERVES`, `NE PAS ROULER`, `JOURNÉE TERMINÉE`), vérification des séances restantes, validation locale des journées avec détection des changements de prévision, prévisualisation du lendemain et aperçu des 7 prochains jours.
  - **Tableau mensuel complet & Impression PDF** : Tableau récapitulatif complet stylé avec mise en page optimisée pour l'impression.
  - **Export CSV** : Export du tableau mensuel, de l'historique complet, des créneaux individuels (mois ou global) et du planning des journées validées.
  - **Thème clair / sombre / automatique** respectant les préférences du système ou le choix de l'utilisateur.

## Technologies

- **React 18** avec **TypeScript**
- **Vite**
- **Styles CSS optimisés** avec variables d'accentuation officielles de l'école de char à voile
- **APIs** : Open-Meteo AROME & Global forecast
