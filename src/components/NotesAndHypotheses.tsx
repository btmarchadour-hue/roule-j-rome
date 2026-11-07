import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ensureAuth } from '../firebase';
import { APP_VERSION_INFO } from '../version';

interface NotesAndHypothesesProps {
  onLock?: () => void;
}

export const NotesAndHypotheses: React.FC<NotesAndHypothesesProps> = ({ onLock }) => {
  const [customPassword, setCustomPassword] = useState('');
  const [currentCloudPassword, setCurrentCloudPassword] = useState<string | null>(null);
  const [isSavingPwd, setIsSavingPwd] = useState(false);
  const [pwdStatus, setPwdStatus] = useState('');

  // Charger le mot de passe cloud actif s'il a été personnalisé
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

  return (
    <>
      {/* 1. CARTE SÉCURITÉ & MOT DE PASSE D'OUVERTURE (MONITEURS) */}
      <div
        className="card nop"
        style={{
          marginBottom: '16px',
          background: '#ffffff',
          borderRadius: '12px',
          border: '1.5px solid #0284c7',
          padding: '18px 20px',
          boxShadow: '0 4px 12px rgba(2, 132, 199, 0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase' }}>
              <span>🔒</span> Sécurité de l'application
            </div>
            <h3 style={{ margin: '6px 0 2px', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
              Mot de Passe & Accès Moniteurs
            </h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
              Gestion de l'accès à l'application, protection des données clients et synchronisation cloud entre Benoît et Jérôme.
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
                padding: '7px 12px',
                borderRadius: '8px',
                fontSize: '0.74rem',
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
            (ou depuis la fin selon réglage), au plus tôt 1 h après le lever du soleil. <strong>Règle d'or horaire appliquée :</strong> aucune séance automatique n'est positionnée avant 09h00 du matin (les séances sur mesure créées manuellement restent possibles à toute heure selon vos besoins). Les séances s'enchaînent avec la pause
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <b style={{ fontSize: '1.05rem', color: 'var(--tx, #0f172a)' }}>
            Note : Automatiser la mise à jour du planning & choix du nouveau gestionnaire de réservation
          </b>
          <span style={{ background: '#dbeafe', color: '#1e40af', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
            Cahier des charges pour Jérôme
          </span>
        </div>

        <p className="note" style={{ margin: '10px 0 12px', lineHeight: 1.5 }}>
          Le prestataire de réservation actuel (Booking Activities / WordPress) va changer. C'est l'opportunité d'adopter un gestionnaire moderne fonctionnant sur une <b>liaison bidirectionnelle à deux ponts</b> : notre application reste le <b>cerveau métier</b> (calcul des marées, seuil de 50, vent AROME, fiche agenda et REX), et l'outil de réservation gère les paiements en ligne et les clients.
        </p>

        {/* Schéma explicatif des deux ponts */}
        <div
          style={{
            background: 'var(--cell, #f8fafc)',
            border: '1px solid var(--bd, #e2e8f0)',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '14px',
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--tx, #0f172a)', marginBottom: '6px' }}>
            🔄 L'Architecture des Deux Ponts :
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '8px 10px', borderRadius: '6px' }}>
              <b style={{ color: '#166534' }}>Pont 1 (Amont - Offre) : Appli ➔ Outil de Réservation</b>
              <div style={{ color: '#15803d', fontSize: '0.74rem', marginTop: '3px' }}>
                Notre application calcule et valide les créneaux praticables (décalage de marée quotidien de 45-50 min, seuil 50, météo) et les publie automatiquement dans l'outil de réservation (via API ou flux iCal synchronisé).
              </div>
            </div>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '8px 10px', borderRadius: '6px' }}>
              <b style={{ color: '#1e40af' }}>Pont 2 (Aval - Demande) : Outil de Réservation ➔ Appli</b>
              <div style={{ color: '#1d4ed8', fontSize: '0.74rem', marginTop: '3px' }}>
                L'outil de réservation renvoie les inscrits (noms, téléphones d'urgence, nombre de places prises, paiements) : la Fiche Agenda papier se pré-remplit toute seule et le journal REX consigne automatiquement les participants réels.
              </div>
            </div>
          </div>
        </div>

        <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem', lineHeight: 1.45 }}>
          <li>
            <b>Critères indispensables (non négociables) pour le choix du logiciel :</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px', listStyleType: 'circle' }}>
              <li>
                <b>Horaires 100 % variables au quotidien :</b> Le logiciel doit accepter nativement les horaires glissants sans imposer de grille fixe par jour de la semaine (les marées décalent les cours chaque jour).
              </li>
              <li>
                <b>Saisie express au téléphone par Jérôme (&lt; 15 secondes) :</b> Pour inscrire un client en direct sur son smartphone quand il est sur le parking ou dans son camion, sans lourdeur administrative.
              </li>
              <li>
                <b>Alerte météo SMS / E-mail en un clic :</b> Prévenir immédiatement tous les inscrits du jour en cas de vent nul (&lt; 8 nds) ou de coup de vent (&gt; 25-35 nds) avec proposition de report.
              </li>
              <li>
                <b>Gestion fine de la flotte de matériel :</b> Bloquer la vente dès que la capacité maxi en chars est atteinte (distinction monoplaces adultes vs biplaces enfants/PMR).
              </li>
              <li>
                <b>API REST ouverte ou Webhooks temps réel :</b> Pour synchroniser automatiquement les réservations avec notre base de données sans export manuel de fichier.
              </li>
              <li>
                <b>Paiement en ligne :</b> Cartes bancaires, Apple Pay/Google Pay, acomptes, bons cadeaux et idéalement Chèques-Vacances Connect (ANCV).
              </li>
            </ul>
          </li>

          <li>
            <b>Prestataires identifiés, compatibles et estimations tarifaires pour Jérôme :</b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
              <div style={{ background: 'var(--cell, #fff)', border: '1px solid var(--bd, #e2e8f0)', padding: '10px 12px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <b style={{ color: '#0369a1', fontSize: '0.85rem' }}>1. Activiti (activiti.fr)</b>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                    ~49 € à 89 € / mois (sans commission sur CA)
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', marginTop: '4px' }}>
                  <b>Spécialiste nautisme &amp; marées :</b> Très répandu en voile et char à voile (FFV/FFCV). Gère nativement les marées, les horaires glissants, la flotte de chars (monoplaces/biplaces), les alertes SMS météo et les fiches stagiaires.
                </div>
                <div style={{ fontSize: '0.72rem', color: '#0f766e', marginTop: '4px', background: '#f0fdfa', padding: '4px 6px', borderRadius: '4px' }}>
                  💶 <b>Modèle tarifaire :</b> Forfait mensuel fixe (ou abonnement lissé sur la saison). 0 % de commission prélevée sur le CA de Jérôme. Frais bancaires CB directs via Stripe (~1,4 % + 0,25 €) et packs SMS d'annulation météo (~0,05 € à 0,07 € le SMS).
                </div>
              </div>

              <div style={{ background: 'var(--cell, #fff)', border: '1px solid var(--bd, #e2e8f0)', padding: '10px 12px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <b style={{ color: '#0369a1', fontSize: '0.85rem' }}>2. Yootil (yootil.com)</b>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                    ~39 € à 79 € / mois OU ~3 % à 4 % au succès
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', marginTop: '4px' }}>
                  <b>Outdoor &amp; Glisse :</b> Interface smartphone très intuitive sur la plage, gestion souple des créneaux selon le vent, module de bons cadeaux et intégration WordPress fluide.
                </div>
                <div style={{ fontSize: '0.72rem', color: '#0f766e', marginTop: '4px', background: '#f0fdfa', padding: '4px 6px', borderRadius: '4px' }}>
                  💶 <b>Modèle tarifaire :</b> Choix entre formule fixe (recommandée si gros volume estival) ou formule au pourcentage (3 à 4 % sur les paiements en ligne). Pas de coût sur les réservations prises en direct au téléphone.
                </div>
              </div>

              <div style={{ background: 'var(--cell, #fff)', border: '1px solid var(--bd, #e2e8f0)', padding: '10px 12px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <b style={{ color: '#0369a1', fontSize: '0.85rem' }}>3. RésaMinute (resaminute.com)</b>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                    ~29 € à 49 € / mois (ou ~2,5 % sans abonnement)
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', marginTop: '4px' }}>
                  <b>Simplicité maximale pour moniteur :</b> Conçu pour les indépendants. Prise de réservation téléphonique express en 10 secondes sur mobile, envoi instantané de lien de paiement par SMS.
                </div>
                <div style={{ fontSize: '0.72rem', color: '#0f766e', marginTop: '4px', background: '#f0fdfa', padding: '4px 6px', borderRadius: '4px' }}>
                  💶 <b>Modèle tarifaire :</b> L'un des plus doux pour une structure à taille humaine. Support client français ultra-réactif au téléphone, pas de mauvaise surprise hors saison.
                </div>
              </div>

              <div style={{ background: 'var(--cell, #fff)', border: '1px solid var(--bd, #e2e8f0)', padding: '10px 12px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <b style={{ color: '#0369a1', fontSize: '0.85rem' }}>4. Billetweb (billetweb.fr)</b>
                  <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                    0 € d'abonnement · 0,29 € + 1 % par vente (frais CB inclus)
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', marginTop: '4px' }}>
                  <b>Le champion économique :</b> Zéro abonnement fixe, zéro frais l'hiver quand l'école roule moins. Frais tout compris parmi les plus bas de France (~2,2 % à 2,5 % CB incluse). API REST complète.
                </div>
                <div style={{ fontSize: '0.72rem', color: '#0f766e', marginTop: '4px', background: '#f0fdfa', padding: '4px 6px', borderRadius: '4px' }}>
                  💶 <b>Exemple de coût :</b> Pour une séance découverte à 40 €, Billetweb prélève seulement ~0,69 € tout compris (frais bancaires inclus). Gratuit pour les réservations réglées sur place.
                </div>
              </div>

              <div style={{ background: 'var(--cell, #fff)', border: '1px solid var(--bd, #e2e8f0)', padding: '10px 12px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <b style={{ color: '#0369a1', fontSize: '0.85rem' }}>5. Regiondo (regiondo.fr)</b>
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                    ~49 € à 99 € / mois + 2,5 % à 4 % de commission
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', marginTop: '4px' }}>
                  <b>Puissance &amp; Réseau touristique :</b> Leader européen des activités de loisirs, passerelle vers les Offices de Tourisme et plateformes (GetYourGuide, Manawa). API robuste.
                </div>
                <div style={{ fontSize: '0.72rem', color: '#9a3412', marginTop: '4px', background: '#fff7ed', padding: '4px 6px', borderRadius: '4px' }}>
                  💶 <b>Budget prévisionnel :</b> Solution plus onéreuse (abonnement + commission). Rentable principalement si Jérôme souhaite capter une grosse clientèle touristique via les distributeurs externes.
                </div>
              </div>
            </div>
          </li>

          <li>
            <b>Questions à trancher avec Jérôme jeudi :</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px', listStyleType: 'circle' }}>
              <li>
                <b>Part du direct :</b> Combien de réservations prend-il encore par appel/SMS direct vs sur le site web ?
              </li>
              <li>
                <b>Modèle de coût :</b> Préfère-t-il un forfait mensuel fixe (ex: 30-50 €/mois) ou une commission au pourcentage sur les ventes en ligne ?
              </li>
              <li>
                <b>Matériel :</b> Utilise-t-il déjà un terminal CB portable (SumUp, Zettle) ou souhaite-t-il que le logiciel gère tout ?
              </li>
            </ul>
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
        <span style={{ fontSize: '.7rem', color: 'var(--mu)' }}>
          {APP_VERSION_INFO.displayString} · Char à Voile Lestrevet
        </span>
      </footer>
    </>
  );
};
