import React from 'react';

export const NotesAndHypotheses: React.FC = () => {
  return (
    <>
      <p className="note nop">
        Le petit chiffre en haut à droite d'une case = nombre maximal de séances possibles ce jour-là.
        Roulage = marée sous le seuil ET lumière du jour (lever/coucher du soleil calculés pour la
        plage de Lestrevet, précision ≈ ±1 min). Lune : phases et heures de lever/coucher calculées
        (théorie de Meeus, précision attendue ≈ ±3 min). Vent : modèle AROME de Météo-France (le même
        que Windguru) via Open-Meteo.com (CC BY 4.0, gratuit en usage non commercial), valable environ
        2 jours, puis modèle global indicatif jusqu'à 16 jours. Données : ton PDF « Horaires de
        marées » (heures locales, hauteurs en m). Roulage = eau ≤ seuil − marge, entre les heures
        choisies, interpolation sinusoïdale entre PM et BM (≈ 10-15 min de précision). « Décalage
        Lestrevet » ajoute aux valeurs du PDF +12 min et +0,5 m (PM) / +0,2 m (BM), estimés sur 4
        jours de ton premier fichier : à vérifier.
      </p>

      <div className="card hyp">
        <b>Réglages validés et hypothèses</b>
        <ul>
          <li>
            <b>Validé avec le moniteur :</b> séances de 1 h, pause de 15 min en juillet-août (du 1er
            juillet au 31 août) et de 30 min le reste de l'année ; départs à :00, :15, :30 ou :45 ;
            coefficient ≤ 50 (50 inclus) = roulage toute la journée ; un seul créneau à la fois (1
            place).
          </li>
          <li>
            <b>Réponses du moniteur appliquées :</b> dernière séance terminée 30 min avant le coucher du
            soleil (réponse : « si on peut caler 30 minutes, c'est le top ») ; vent idéal de 8 à 25
            nœuds, arrêt à 35 nœuds (appliqué aux rafales).
          </li>
          <li>
            <b>Hypothèses encore ouvertes :</b> première séance 1 h après le lever du soleil ; seuil de
            hauteur d'eau 4,50 m sans calage (il roule parfois dès 5 m selon le vent) ; décalage
            Lestrevet estimé et désactivé par défaut ; correction de pression de +1 cm par hPa sous
            1013 hPa quand la prévision est disponible ; sud-ouest = meilleur vent et vents de terre
            d'est/nord-est = moins favorables (non confirmé).
          </li>
          <li>
            <b>Méthode de création des séances :</b> à partir de la dernière séance, comme le fait le
            moniteur : la dernière séance se termine au plus près de la contrainte de fin (coucher du
            soleil − 30 min, ou fin de plage de marée), puis les précédentes sont calées vers l'arrière
            avec la pause. Le jeu éventuel se retrouve donc en début de plage, là où les séances sont les
            moins prisées (tôt le matin). Le nombre de séances reste le maximum possible.
          </li>
          <li>
            <b>Créneau optionnel (à la discrétion du moniteur) :</b> une séance complète de 60 min qui
            déborde de la plage d'au plus 20 min (réglable), proposée quand il y a au moins 40 min de
            roulage dans la plage. Il est signalé avec le dépassement et la contrainte concernée (marée
            ou heure du jour).
          </li>
          <li>
            <b>Points à surveiller (effets de bord possibles) :</b> un dépassement côté marée veut dire
            que l'eau est encore au-dessus de 4,50 m pendant ces minutes (précision de l'heure ≈ ±10-15
            min ; le PDF est 6 à 12 cm plus bas que le SHOM) ; côté heure du jour, le créneau se
            rapproche du coucher du soleil sans le dépasser ; un créneau optionnel peut apparaître ou
            disparaître d'un rafraîchissement à l'autre quand la prévision de pression change ; une
            souplesse supplémentaire pourra être ajoutée si besoin. Export après validation du moniteur
            : à définir.
          </li>
          <li>
            <b>Données :</b> hauteurs et heures de marée du PDF fourni (port non indiqué ; comparé aux
            prédictions SHOM sur 18 jours d'octobre 2026 : heures à ±5 min de Douarnenez comme de
            Morgat, hauteurs plus basses de 6 cm que Douarnenez et de 12 cm que Morgat) ; vent AROME
            (Météo-France) sur ~2 jours puis modèle global indicatif. La balise Winds Up (spot 66) est
            en panne : mesure en direct à brancher plus tard.
          </li>
          <li>
            <b>Réservation :</b> le site utilise Booking Activities (WordPress). Cette page ne prend
            pas de réservations : elle fournit la liste des créneaux (fichier « Créneaux CSV »).
          </li>
        </ul>
      </div>

      <div className="card hyp">
        <b>Note : automatiser la mise à jour du planning de réservation</b>
        <p className="note" style={{ margin: '8px 0 0' }}>
          Le prestataire de réservation va changer : c'est le moment de choisir un outil qui se met à
          jour tout seul. Aujourd'hui, cette page calcule les créneaux dans le navigateur et les
          exporte en CSV (« Créneaux CSV »). Pour automatiser, ce calcul devrait tourner chaque jour
          tout seul (script programmé), puis envoyer les créneaux à l'outil de réservation par son API
          ; les prévisions de vent à 16 jours permettent de publier au fur et à mesure.
        </p>
        <ul>
          <li>
            <b>Critères du nouvel outil :</b>
          </li>
          <li>
            Créer et modifier des créneaux par API ou par import en masse (CSV), avec un identifiant
            externe pour mettre à jour sans créer de doublons.
          </li>
          <li>
            Capacité par créneau (1 place ou plus) et possibilité de fermer ou annuler un créneau (météo)
            en prévenant automatiquement les clients.
          </li>
          <li>
            Récupérer les réservations (API, webhooks ou export) pour savoir quels créneaux sont pris.
          </li>
          <li>
            Publier à l'avance sur une durée glissante (par exemple 15 jours) et masquer le reste.
          </li>
          <li>
            Synchronisation avec l'agenda (iCal, Google Agenda), si possible dans les deux sens.
          </li>
          <li>
            Paiement en ligne (acompte, bons cadeaux, conditions d'annulation météo).
          </li>
          <li>
            Intégration au site WordPress (widget, iframe ou plugin), interface en français, hébergement
            en Europe (RGPD).
          </li>
          <li>
            API incluse dans l'abonnement choisi (certains éditeurs la réservent à leur offre haute),
            limites de débit et documentation correctes.
          </li>
          <li>
            Export des clients, bons cadeaux et réservations, pour ne pas rester enfermé chez un
            éditeur.
          </li>
          <li>
            <b>À demander à chaque éditeur :</b> peut-on créer des créneaux en masse par API ou import
            CSV, avec identifiant externe ? Quelle formule inclut l'API ? Y a-t-il des webhooks de
            réservation ? Peut-on fermer un créneau avec notification ? Combien de temps pour obtenir
            la clé API ?
          </li>
          <li>
            <b>Pistes à vérifier</b> (informations issues de fiches tierces, à confirmer auprès des
            éditeurs) : Regiondo (API REST disponibilités et réservations, webhooks de réservation) ;
            Rezdy (API avec mise à jour des disponibilités, accès réservé à l'offre la plus haute) ;
            Checkfront (API REST v3 disponibilités et réservations) ; Cal.com (open source, API de
            créneaux et de réservations, webhooks, pensé pour des rendez-vous). Plugin actuel Booking
            Activities : événements récurrents, export CSV/iCal des réservations, API PHP pour
            développeurs, pas d'import de créneaux repéré.
          </li>
          <li>
            <b>Étape suivante, une fois l'outil choisi :</b> transformer le calcul de cette page en
            script quotidien (marées, lumière, vent) qui met à jour les créneaux via l'API, et
            importer les réservations pour griser les créneaux pris.
          </li>
        </ul>
      </div>

      <footer className="card nop ft">
        <b>Char à Voile du Bout du Monde</b>
        <br />
        Plage de Lestrevet · 29550 Plomodiern
        <br />
        <a href="tel:+33681638374">06 81 63 83 74</a> ·{' '}
        <a href="https://charavoileduboutdumonde.com" target="_blank" rel="noopener noreferrer">
          charavoileduboutdumonde.com
        </a>
        <br />
        <span style={{ fontSize: '.7rem' }}>
          Version du 12/10/2026 · n°9 (météo en tête, graphiques bleus, ouverture sur aujourd'hui) · React
        </span>
      </footer>
    </>
  );
};
