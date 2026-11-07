# CAHIER DES CHARGES FONCTIONNEL & TECHNIQUE
## Sélection du Nouveau Gestionnaire de Réservation en Ligne
### École de Char à Voile du Bout du Monde – Plage de Lestrevet (Finistère)
*Document de cadrage pour la réunion avec Jérôme (Jeudi) et consultation des éditeurs de logiciels*

---

## 1. Contexte & Spécificités Métier de l'École

L'école **Char à Voile du Bout du Monde** opère sur la **Plage de Lestrevet (Plomodiern)**. Son activité présente des contraintes physiques et logistiques strictes, totalement différentes d'une activité sportive classique en salle ou à horaires fixes :

1. **Horaires 100 % variables (Tributaires de la Marée)** :
   - Les horaires de roulage dépendent directement de la marée basse et du coefficient astronomique.
   - Les créneaux glissent chaque jour d'environ **45 à 50 minutes**. Il n'y a **aucun créneau fixe récurrent** (pas de « tous les samedis à 14h00 »).
   - Selon les coefficients (seuil fixé à 50), certaines journées permettent un roulage continu sur 6 créneaux, tandis que d'autres ne permettent que 2 ou 3 créneaux resserrés sur la basse mer.

2. **Forte Dépendance Météorologique (Vent & État de la Plage)** :
   - L'école roule entre **8 et 25 nœuds** de vent (rafales max 35 nœuds).
   - Les annulations ou décalages pour cause de vent nul, vent violent de terre ou tempête peuvent survenir à J-1 ou le matin même.

3. **Capacité Matérielle et Encadrement** :
   - Flotte de chars calibrée (monoplaces adultes/ados et biplaces pour enfants ou personnes à mobilité réduite).
   - Encadrement assuré par le moniteur (Jérôme par défaut, Benoît en renfort).

---

## 2. Architecture de Liaison : Le Modèle des « Deux Ponts »

L'application existante de l'école calcule déjà avec une précision mathématique les plages de roulage, la marée, le soleil et les prévisions de vent. Le futur gestionnaire de réservation ne doit pas réinventer ces calculs, mais s'interfacer avec l'application selon **deux flux automatisés** :

```text
 ┌────────────────────────────────────────────────────────┐
 │       APPLICATION CHAR À VOILE DU BOUT DU MONDE        │
 │  • Moteur astronomique marées SHOM & coefficients      │
 │  • Éphémérides solaires (Lestrevet) & seuil roulage 50 │
 │  • Prévisions de vent AROME / GFS                      │
 │  • Fiche Agenda papier journalière & REX historique    │
 └──────────────┬──────────────────────────▲──────────────┘
                │                          │
         PONT 1 │ Export des créneaux      │ PONT 2  Import des réservations,
                │ navigables & ouverts     │         inscrits, jauges & paiements
                ▼                          │
 ┌─────────────────────────────────────────┴──────────────┐
 │         FUTUR OUTIL DE RÉSERVATION EN LIGNE            │
 │  • Vente en ligne 24/7 sur smartphone & ordinateur     │
 │  • Paiement sécurisé CB / chèques vacances / acomptes  │
 │  • Saisie express au téléphone par Jérôme (10 sec)     │
 │  • Alertes SMS / Emails automatiques en cas de météo   │
 └────────────────────────────────────────────────────────┘
```

### Pont 1 (Amont - Publication de l'Offre) : Appli Météo/Marée ➔ Outil de Réservation
- **Mission** : Transmettre au module de réservation les créneaux praticables calculés ou validés par Jérôme, pour ouvrir automatiquement les ventes aux bonnes heures.
- **Données transmises** :
  - Date de la séance (`YYYY-MM-DD`).
  - Heure de début et heure de fin (ex: `13h45 - 14h45`).
  - Nombre maximum de places disponibles (jauge ex: 8 ou 12 chars).
  - Type de séance (Découverte / Perfectionnement / Séance sur mesure).
  - Statut d'ouverture (Ouvert à la vente / Fermé / En attente météo).
- **Modes techniques retenus** :
  1. *Flux iCal bidirectionnel (`.ics` synchronisé)* : L'outil de réservation s'abonne à une URL d'agenda générée par notre appli.
  2. *API REST / Webhook* : Envoi programmatique d'un payload JSON des créneaux validés.

### Pont 2 (Aval - Remontée de la Demande) : Outil de Réservation ➔ Appli Météo/Marée
- **Mission** : Récupérer automatiquement l'état des réservations et les coordonnées des stagiaires dans l'application de l'école.
- **Données rapatriées** :
  - Taux d'occupation en temps réel par créneau (ex: `6 / 8 places réservées`).
  - Fiche stagiaires : Nom, prénom, téléphone portable d'urgence, adresse email.
  - Formule choisie (monoplace, biplace enfant, groupe, bon cadeau).
  - Statut du règlement (Payé en ligne, Acompte, Sur place).
  - Notes particulières (taille/poids, particularité médicale, niveau).
- **Exploitation directe dans l'école** :
  - **Fiche Agenda Papier & Vue Focus** : Jérôme imprime ou consulte le planning du jour complet sans aucune ressaisie.
  - **Journal REX & Statistiques** : Dès qu'une séance se termine, le nombre réel de participants est consigné automatiquement. Si un créneau n'a eu aucune réservation, il bascule tout seul en *« Pas d'inscrits »*.

---

## 3. Prérequis Indispensables (Critères Éliminatoires)

Tout logiciel candidat ne validant pas ces 5 points sera immédiatement écarté :

| Réf. | Exigence | Justification métier |
| :--- | :--- | :--- |
| **REQ-01** | **Gestion native d'horaires 100 % variables au quotidien** | Les marées décalent les cours chaque jour. Le logiciel ne doit **JAMAIS** forcer une grille d'horaires fixes récurrents par jour de semaine. |
| **REQ-02** | **Accès API REST ouverte ou Webhooks temps réel** | Obligatoire pour alimenter notre base de données (Firestore) et remonter les inscrits dans l'agenda sans import de fichier manuel quotidien. |
| **REQ-03** | **Saisie manuelle ultra-rapide au téléphone (< 15 secondes)** | Quand Jérôme est sur le parking ou dans son camion avec un client au téléphone, il doit pouvoir bloquer une place en 3 clics sur son smartphone sans devoir remplir 20 champs obligatoires. |
| **REQ-04** | **Communication de masse en un clic (SMS / E-mail d'annulation)** | En cas de vent nul (< 8 nds) ou de tempête, Jérôme doit pouvoir avertir tous les inscrits du jour d'un seul clic avec proposition de report ou d'avoir. |
| **REQ-05** | **Gestion des capacités par flotte de matériel** | Le système doit bloquer les ventes dès que le nombre de chars disponibles est atteint (distinction monoplaces vs biplaces). |

---

## 4. Prérequis Techniques & Sécurité

1. **Connectivité & Formats d'Échange** :
   - Webhooks configurables sur les événements clés : `reservation.created`, `reservation.updated`, `reservation.cancelled`.
   - Support d'un flux d'import/export iCalendar (`RFC 5545`) à rafraîchissement rapide (< 15 min).
   - Export CSV / Excel tabulaire complet à la demande pour l'analyse comptable.

2. **Expérience Client (Mobile First)** :
   - Tunnel d'achat optimisé pour smartphone (90 % des réservations touristiques en Bretagne se font sur téléphone le soir ou la veille).
   - Envoi automatique de confirmation avec plan d'accès Google Maps / Waze précis vers la zone de départ de la plage de Lestrevet et consignes vestimentaires (baskets, coupe-vent, lunettes).

3. **Paiement & Caisse** :
   - Passerelle de paiement sécurisée intégrée (Stripe, Payplug, Monetico, etc.) avec support des cartes bancaires, Apple Pay, Google Pay et idéalement Chèques-Vacances Connect (ANCV).
   - Possibilité d'encaisser un acompte ou la totalité en ligne.

4. **Conformité Légale & RGPD** :
   - Hébergement des données dans l'Union Européenne.
   - Registre client conforme RGPD avec droit de rectification et suppression.

---

## 5. Grille d'Évaluation des Solutions Logicielles Candidates

| Critère | Poids | Description & Attendus |
| :--- | :---: | :--- |
| **Souplesse marée / horaires glissants** | **30 %** | Facilité à ouvrir des créneaux aux horaires changeants chaque jour sans bug ni lourdeur |
| **Qualité des API & Webhooks** | **25 %** | Documentation API claire, webhooks fiables pour la liaison bidirectionnelle |
| **Ergonomie smartphone pour Jérôme** | **20 %** | Interface pro rapide, claire et lisible en plein soleil sur le spot |
| **Gestion des alertes météo (SMS)** | **15 %** | Automatisation des annulations météo et reports |
| **Modèle économique & Coûts** | **10 %** | Abonnement fixe vs commission sur les ventes (% du chiffre d'affaires) |

---

## 6. Liste des Solutions Candidates & Estimations Tarifaires

| Solution | Positionnement | Modèle Tarifaire Estimé | Coût estimé (ex: 800 séances/an à 40 € = 32 000 € CA) | Recommandation pour Jérôme |
| :--- | :--- | :--- | :--- | :--- |
| **Activiti** (`activiti.fr`) | **N°1 Nautisme & Marées** (FFV / FFCV) | Abonnement fixe : **~49 € à 89 € / mois** selon saisonnalité. **0 %** de commission sur CA. Frais CB directs Stripe (~1,4 % + 0,25 €) + SMS (~0,06 €). | **~600 € à 900 € / an** d'abonnement fixe + frais bancaires standards. | 🟢 **Idéal si fort volume** estival car aucune commission sur le chiffre d'affaires. |
| **Yootil** (`yootil.com`) | **Outdoor & Glisse** (École de plage) | Au choix : Forfait **~39 € à 79 € / mois** OU formule au succès **~3 % à 4 %** sur les ventes en ligne. | **~500 € à 800 € / an** en formule fixe, ou **~960 € à 1 200 € / an** au pourcentage. | 🟢 **Très adapté**, moderne, application smartphone intuitive pour le moniteur. |
| **RésaMinute** (`resaminute.com`) | **Simplicité Moniteur Solo** | Formule douce : **~29 € à 49 € / mois** (ou ~2,5 % sans abonnement). Gratuit sur résas directes/téléphone. | **~350 € à 500 € / an**. | 🟢 **Excellent pour structure légère**, prise de résa en 10 sec sur mobile, support direct. |
| **Billetweb** (`billetweb.fr`) | **Champion Économique** | **0 € d'abonnement fixe**. Frais uniques : **0,29 € + 1 % TTC** par billet en ligne (frais CB inclus). 0 € sur place. | **~550 € / an tout compris** (frais bancaires déjà inclus !). | 🟢 **Budget imbattable**, 0 frais l'hiver. Demande un léger paramétrage initial. |
| **Regiondo** (`regiondo.fr`) | **Loisirs & Tourisme d'envergure** | Abonnement : **~49 € à 99 € / mois** + commission **~2,5 % à 4 %** + frais bancaires. | **~1 400 € à 2 000 € / an**. | 🟡 Plus cher, rentable uniquement si besoin de multidiffusion (Offices de Tourisme / GetYourGuide). |

---

## 7. Simulation Financière pour l'École de Jérôme

Pour une saison typique de **800 stagiaires à 40 €** (soit 32 000 € de chiffre d'affaires annuel) :

1. **Option Billetweb (Paiement à l'acte, zéro fixe)** :
   - Coût annuel total = 800 x (0,29 € + 0,40 €) = **~552 € TTC / an** (frais bancaires carte bleue inclus).
   - 0 € de charge fixe entre novembre et mars quand l'école roule moins.

2. **Option Activiti / Yootil (Forfait métier nautique)** :
   - Coût annuel total = ~60 € x 12 mois = **~720 € HT / an** + frais bancaires Stripe (~600 €) = **~1 320 € / an**.
   - Avantage : outils métier dédiés marées, alertes SMS groupées et fiches stagiaires spécialisées.

3. **Option Plateforme à commission élevée (ex: 5 % à 8 %)** :
   - Coût annuel total = 1 600 € à 2 560 € / an.
   - Moins intéressant pour Jérôme si la majorité de sa clientèle vient déjà naturellement sur son site ou au téléphone.

---

## 8. Synthèse pour la Réunion de Jeudi avec Jérôme

- **Les 3 questions clés à lui poser** :
  1. **Volume en ligne vs direct** : Combien de personnes réservent directement par téléphone ou SMS plutôt que sur le site ? (Les solutions à abonnement fixe comme Activiti ou RésaMinute ne prennent 0 % sur les ventes directes).
  2. **Budget acceptable** : Préfère-t-il payer ~50 €/mois pour un outil spécialisé nautisme avec SMS météo, ou préfère-t-il du 100 % variable à la vente comme Billetweb pour ne rien payer l'hiver ?
  3. **Démarche proposée** : Sélectionner 2 éditeurs (ex: **Activiti** et **Yootil**) et planifier une démo de 20 minutes pour tester la prise en main sur smartphone et la gestion des marées.
- **Notre engagement technique** :
  Quel que soit son choix final, notre application est déjà prête à s'interfacer via les Deux Ponts (publication de l'offre navigable et collecte automatique des inscrits dans l'agenda).
