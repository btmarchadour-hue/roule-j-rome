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
            <b>Hypothèses encore ouvertes :</b> première séance calée par défaut 1 h après le lever du soleil ;
            seuil de hauteur d'eau 4,50 m sans calage (il roule parfois dès 5 m selon la force et l'orientation du vent) ;
            décalage Lestrevet estimé et désactivé par défaut ; sud-ouest = meilleur vent et vents de terre
            d'est/nord-est = moins favorables (non confirmé).
          </li>
          <li>
            <b>Fonctionnement et pertinence du correcteur de pression atmosphérique (surcote / décote) :</b>
            <div style={{ marginTop: '6px', lineHeight: '1.5' }}>
              <p style={{ margin: '0 0 6px' }}>
                <b>1. Principe physique (loi du baromètre inverse) :</b> Les annuaires de marée (SHOM et PDF fourni) calculent les hauteurs d'eau pour une pression atmosphérique standard au niveau de la mer de <b>1013,25 hPa</b>. Lorsqu'une dépression atmosphérique s'installe, la colonne d'air pèse moins lourd sur la surface de l'océan : l'eau « monte » sous l'effet de cette aspiration hydrostatique à raison d'environ <b>+1 cm de hauteur d'eau par hPa en dessous de 1013 hPa</b> (ex. à 985 hPa lors d'un coup de vent, la surcote barométrique brute est de <b>+28 cm</b>). À l'inverse, un anticyclone lourd (ex. 1030 hPa) écrase le plan d'eau et génère une décote d'environ −17 cm.
              </p>
              <p style={{ margin: '0 0 6px' }}>
                <b>2. Calcul appliqué dans l'outil :</b> Lorsque la case <i>« Correction de pression »</i> est cochée et que la prévision météo (AROME / GFS) est disponible, l'application lit la pression atmosphérique prévue à l'instant de la marée et applique la formule : <code>Hauteur d'eau réelle = Hauteur PDF + max(0, (1013 − Pression) / 100)</code>. Le seuil de roulage (4,50 m) est donc atteint plus tard à marée descendante et submergé plus tôt à marée montante.
              </p>
              <p style={{ margin: '0 0 6px' }}>
                <b>3. Impact direct sur la plage de Lestrevet (Plomodiern) :</b>
                Lestrevet présente un estran à pente très douce (≈ 1 % à 1,5 %). Une surcote de +25 cm d'eau ne se résume pas à une simple hauteur verticale : elle repousse le trait de côte de <b>15 à 25 mètres à l'horizontale</b> sur le banc de sable dur roulable. Sur le plan horaire, elle retarde le moment où l'eau redescend sous 4,50 m de <b>20 à 35 minutes</b>. Sans cette correction lors d'un fort coup de vent dépressionnaire, le planning risque de proposer une première séance alors que la zone d'évolution est encore sous l'eau ou détrempée.
              </p>
              <p style={{ margin: '0' }}>
                <b>4. Pertinence et limites pour le moniteur :</b>
                <br />
                • <i>Pourquoi c'est pertinent :</i> En Bretagne, les vents forts favorables au char à voile (20 à 35 nœuds) coïncident presque toujours avec des dépressions d'automne/hiver creuses (980 à 1000 hPa). La surcote d'eau y est bien réelle et tangible sur le sable.
                <br />
                • <i>Les limites physiques :</i> La pression atmosphérique n'explique qu'environ la moitié de la surcote totale. Le reste provient de la <b>surcote dynamique</b> : le vent d'ouest qui pousse l'eau au fond de la baie de Douarnenez (effet d'entonnoir / <i>wind setup</i>) et le déferlement de la houle sur les barres de sable (<i>wave setup</i>), qui peuvent rajouter 10 à 30 cm d'eau en plus. À l'inverse, par vent de terre d'Est anticyclonique, l'eau se retire plus vite et plus loin que prévu.
                <br />
                • <i>Recommandation pratique :</i> Pour ouvrir des plannings de réservation plusieurs semaines à l'avance dans Booking Activities, désactiver le correcteur (ou utiliser une marge fixe de sécurité de +10 à +20 cm) garantit des horaires stables qui ne bougent pas au fil des sorties de modèles météo. En revanche, pour la décision opérationnelle du moniteur à J−2 / J−1 par gros temps, activer ce correcteur évite les surprises de début de séance les pieds dans l'eau.
              </p>
            </div>
          </li>
          <li>
            <b>Méthode de création des séances :</b> calage par défaut dès le début de plage praticable
            (ou depuis la fin selon réglage), 1 h après le lever du soleil. Les séances s'enchaînent avec la pause
            réglementaire (15 min en été, 30 min l'hiver) pour maximiser le nombre de créneaux réalisables.
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
