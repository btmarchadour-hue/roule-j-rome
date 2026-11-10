import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db, ensureAuth } from '../firebase';
import {
  AppSettings,
  AppUser,
  ClientProfile,
  CustomSlotsMap,
  GpsWaterlineLog,
  SlotObservation,
  TeamNote,
  ValidationsMap,
} from '../types';
import { DEFAULT_USERS } from './authUtils';

export interface AgendaBookingItem {
  id: string;
  name: string;
  phone: string;
  email?: string;
  pax?: string;
  chars: string;
  formula: string;
  payment: string;
  status: 'valid' | 'pending' | 'signed';
  notes: string;
  updatedBy?: string;
  updatedAt?: number;
}

// Clé de stockage local de l'identité du moniteur actif
const INSTRUCTOR_KEY = 'cv_active_instructor';

export const getActiveInstructor = (): string => {
  try {
    const saved = localStorage.getItem(INSTRUCTOR_KEY);
    if (saved && saved !== 'Bertrand' && saved !== 'bertrand') return saved;
  } catch {
    // ignore
  }
  return 'Jérôme';
};

export const setActiveInstructor = (name: string): void => {
  try {
    localStorage.setItem(INSTRUCTOR_KEY, name);
  } catch {
    // ignore
  }
};

export const notifySync = (msg: string) => {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cv_sync_status', { detail: { msg, time: Date.now() } })
      );
    }
  } catch {
    // ignore
  }
};

/* -------------------------------------------------------------------------- */
/* 1. VALIDATIONS SYNCHRONIZATION                                             */
/* -------------------------------------------------------------------------- */
export const subscribeToValidations = (
  onData: (data: ValidationsMap) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'validations');
  return onSnapshot(
    colRef,
    snapshot => {
      const result: ValidationsMap = {};
      snapshot.forEach(docSnap => {
        result[docSnap.id] = docSnap.data() as any;
      });
      onData(result);
      notifySync('✓ Cloud synchronisé');
    },
    error => {
      console.warn('Erreur synchro validations Firestore:', error);
      onError?.(error);
    }
  );
};

export const cleanForFirestore = <T>(obj: T): T => {
  if (obj === undefined) return null as any;
  return JSON.parse(
    JSON.stringify(obj, (_, value) => (value === undefined ? null : value))
  );
};

export const saveValidationToFirestore = async (
  dateStr: string,
  validationData: any
) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'validations', dateStr);
    const author = getActiveInstructor();
    const payload = cleanForFirestore({
      ...validationData,
      author: validationData?.author || author,
      updatedAt: Date.now(),
    });
    await setDoc(docRef, payload);
    console.info(`✓ Validation [${dateStr}] synchronisée dans Firestore`);
    notifySync(`✓ Validation [${dateStr}] envoyée au Cloud`);
  } catch (error) {
    console.error('Erreur enregistrement validation Firestore:', error);
    notifySync(`⚠️ Erreur d'envoi [${dateStr}] au Cloud`);
    throw error;
  }
};

export const deleteValidationFromFirestore = async (dateStr: string) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'validations', dateStr);
    await deleteDoc(docRef);
    console.info(`✓ Validation [${dateStr}] supprimée de Firestore`);
    notifySync(`✓ Validation [${dateStr}] retirée du Cloud`);
  } catch (error) {
    console.error('Erreur suppression validation Firestore:', error);
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* 2. CRÉNEAUX SUR MESURE (CUSTOM SLOTS)                                      */
/* -------------------------------------------------------------------------- */
export const subscribeToCustomSlots = (
  onData: (data: CustomSlotsMap) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'custom_slots');
  return onSnapshot(
    colRef,
    snapshot => {
      const result: CustomSlotsMap = {};
      snapshot.forEach(docSnap => {
        result[docSnap.id] = docSnap.data() as any;
      });
      onData(result);
    },
    error => {
      console.warn('Erreur synchro custom_slots Firestore:', error);
      onError?.(error);
    }
  );
};

export const saveCustomSlotsToFirestore = async (
  dateStr: string,
  config: { replaceDefault: boolean; slots: any[] }
) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'custom_slots', dateStr);
    const author = getActiveInstructor();
    const payload = cleanForFirestore({
      ...config,
      updatedBy: author,
      updatedAt: Date.now(),
    });
    await setDoc(docRef, payload);
    console.info(`✓ Créneaux sur mesure [${dateStr}] synchronisés dans Firestore`);
  } catch (error) {
    console.error('Erreur enregistrement custom slots Firestore:', error);
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* 3. RELEVÉS TERRAIN & CALIBRATION (OBSERVATIONS)                            */
/* -------------------------------------------------------------------------- */
export const subscribeToObservations = (
  onData: (data: SlotObservation[]) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'observations');
  return onSnapshot(
    colRef,
    snapshot => {
      const list: SlotObservation[] = [];
      snapshot.forEach(docSnap => {
        if (!docSnap.id.startsWith('sample-obs-')) {
          list.push({ id: docSnap.id, ...(docSnap.data() as any) });
        } else {
          // Supprimer automatiquement les résidus de données d'exemple fictives
          deleteDoc(docSnap.ref).catch(() => {});
        }
      });
      // Tri du plus récent au plus ancien
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onData(list);
    },
    error => {
      console.warn('Erreur synchro observations Firestore:', error);
      onError?.(error);
    }
  );
};

export const saveObservationToFirestore = async (
  observation: SlotObservation
) => {
  try {
    await ensureAuth();
    const docId = observation.id || `${observation.ds}_${observation.slotKey}`;
    const docRef = doc(db, 'observations', docId);
    const author = getActiveInstructor();
    const payload = cleanForFirestore({
      ...observation,
      id: docId,
      author: observation.author || author,
      updatedAt: Date.now(),
      createdAt: observation.createdAt || Date.now(),
    });
    await setDoc(docRef, payload);
    console.info(`✓ Relevé terrain [${docId}] synchronisé dans Firestore`);
  } catch (error) {
    console.error('Erreur enregistrement observation Firestore:', error);
    throw error;
  }
};

export const deleteObservationFromFirestore = async (obsId: string) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'observations', obsId);
    await deleteDoc(docRef);
    console.info(`✓ Relevé terrain [${obsId}] supprimé de Firestore`);
  } catch (error) {
    console.error('Erreur suppression observation Firestore:', error);
    throw error;
  }
};

export const batchSaveObservationsToFirestore = async (
  observations: SlotObservation[]
): Promise<number> => {
  if (!observations || observations.length === 0) return 0;
  await ensureAuth();

  const author = getActiveInstructor();
  const BATCH_SIZE = 400; // Seuil de sécurité sous la limite Firestore de 500 opérations
  let totalSaved = 0;

  for (let i = 0; i < observations.length; i += BATCH_SIZE) {
    const chunk = observations.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const obs of chunk) {
      const docId = obs.id || `obs-${obs.ds}-${obs.slotKey}`;
      const docRef = doc(db, 'observations', docId);
      const payload = cleanForFirestore({
        ...obs,
        id: docId,
        author: obs.author || author,
        updatedAt: Date.now(),
        createdAt: obs.createdAt || Date.now(),
      });
      batch.set(docRef, payload, { merge: true });
    }

    await batch.commit();
    totalSaved += chunk.length;
  }

  notifySync(`✓ ${totalSaved} relevés enregistrés dans le Cloud`);
  return totalSaved;
};

/* -------------------------------------------------------------------------- */
/* 4. RÉSERVATIONS & ÉMARGEMENT CLIENTS (BOOKINGS)                            */
/* -------------------------------------------------------------------------- */
export const subscribeToBookings = (
  onData: (data: Record<string, AgendaBookingItem[]>) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'reservations');
  return onSnapshot(
    colRef,
    snapshot => {
      const result: Record<string, AgendaBookingItem[]> = {};
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data && Array.isArray(data.clients)) {
          result[docSnap.id] = data.clients;
        }
      });
      onData(result);
    },
    error => {
      console.warn('Erreur synchro réservations Firestore:', error);
      onError?.(error);
    }
  );
};

export const saveBookingToFirestore = async (
  reservationKey: string,
  clients: AgendaBookingItem[]
) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'reservations', reservationKey);
    const author = getActiveInstructor();
    const [ds, slotKey] = reservationKey.split('_');
    const payload = cleanForFirestore({
      ds: ds || '',
      slotKey: slotKey || '',
      clients,
      updatedBy: author,
      updatedAt: Date.now(),
    });
    await setDoc(docRef, payload);
    console.info(`✓ Réservations [${reservationKey}] synchronisées dans Firestore`);
  } catch (error) {
    console.error('Erreur enregistrement réservations Firestore:', error);
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* 5. VÉRIFICATION ET PURGE CLOUD                                            */
/* Firestore est la source de vérité absolue. Les suppressions et ajouts     */
/* sont propagés en direct par onSnapshot sans réinjection locale fantôme.   */
/* -------------------------------------------------------------------------- */
export const syncLocalDataWithFirestore = async () => {
  try {
    // Nettoyer les éventuels résidus d'échantillons fictifs dans Firestore
    const obsCol = collection(db, 'observations');
    const obsSnap = await getDocs(obsCol);
    obsSnap.forEach(d => {
      if (d.id.startsWith('sample-obs-')) {
        deleteDoc(d.ref).catch(() => {});
      }
    });

    notifySync('✓ Cloud synchronisé en direct');
  } catch (error) {
    console.warn('Note vérification Cloud:', error);
  }
};

// Alias rétrocompatible
export const seedLocalDataToFirestoreIfEmpty = syncLocalDataWithFirestore;

/* -------------------------------------------------------------------------- */
/* 6. BASE CLIENTS & CRM                                                      */
/* -------------------------------------------------------------------------- */
export const subscribeToClients = (
  onData: (data: ClientProfile[]) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'clients');
  return onSnapshot(
    colRef,
    snapshot => {
      const list: ClientProfile[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...(docSnap.data() as any) });
      });
      // Tri alphabétique par nom puis prénom
      list.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'fr') || (a.firstName || '').localeCompare(b.firstName || '', 'fr'));
      onData(list);
    },
    error => {
      console.warn('Erreur synchro clients Firestore:', error);
      onError?.(error);
    }
  );
};

export const saveClientToFirestore = async (client: ClientProfile): Promise<string> => {
  try {
    await ensureAuth();
    const docId = client.id || `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const docRef = doc(db, 'clients', docId);
    const author = getActiveInstructor();
    const payload = cleanForFirestore({
      ...client,
      id: docId,
      author: client.author || author,
      updatedAt: Date.now(),
      createdAt: client.createdAt || Date.now(),
    });
    await setDoc(docRef, payload);
    console.info(`✓ Client [${docId}] enregistré dans Firestore`);
    notifySync(`✓ Client ${client.firstName || ''} ${client.lastName} enregistré`);
    return docId;
  } catch (error) {
    console.error('Erreur enregistrement client Firestore:', error);
    throw error;
  }
};

export const deleteClientFromFirestore = async (clientId: string) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'clients', clientId);
    await deleteDoc(docRef);
    console.info(`✓ Client [${clientId}] supprimé de Firestore`);
    notifySync(`✓ Client retiré du répertoire`);
  } catch (error) {
    console.error('Erreur suppression client Firestore:', error);
    throw error;
  }
};

export const batchSaveClientsToFirestore = async (clients: ClientProfile[]): Promise<number> => {
  if (!clients || clients.length === 0) return 0;
  await ensureAuth();

  const author = getActiveInstructor();
  const BATCH_SIZE = 400;
  let totalSaved = 0;

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const chunk = clients.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const c of chunk) {
      const docId = c.id || `cli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const docRef = doc(db, 'clients', docId);
      const payload = cleanForFirestore({
        ...c,
        id: docId,
        author: c.author || author,
        updatedAt: Date.now(),
        createdAt: c.createdAt || Date.now(),
      });
      batch.set(docRef, payload, { merge: true });
    }

    await batch.commit();
    totalSaved += chunk.length;
  }

  notifySync(`✓ ${totalSaved} fiches clients enregistrées dans le Cloud`);
  return totalSaved;
};

/* -------------------------------------------------------------------------- */
/* 6. GESTION DES UTILISATEURS & PROFILS (AUTHENTIFICATION INDIVIDUELLE)      */
/* -------------------------------------------------------------------------- */
export const subscribeToUsers = (
  onData: (users: AppUser[]) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'app_users');
  return onSnapshot(
    colRef,
    async snapshot => {
      if (snapshot.empty) {
        // Initialiser automatiquement avec Jérôme et Benoît si la collection est vide
        try {
          await seedDefaultUsersIfEmpty();
        } catch (e) {
          console.warn('Initialisation des utilisateurs par défaut différée:', e);
        }
        onData(DEFAULT_USERS);
        return;
      }
      const list: AppUser[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...(docSnap.data() as any) });
      });
      // Trier : Admin en premier, puis ordre alphabétique
      list.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return a.username.localeCompare(b.username);
      });
      onData(list);
    },
    error => {
      console.warn('Erreur abonnement utilisateurs Firestore:', error);
      onError?.(error);
      // Fallback sur les utilisateurs par défaut en local
      onData(DEFAULT_USERS);
    }
  );
};

export const seedDefaultUsersIfEmpty = async (): Promise<AppUser[]> => {
  try {
    await ensureAuth();
    const colRef = collection(db, 'app_users');
    const snap = await getDocs(colRef);
    if (!snap.empty) {
      const list: AppUser[] = [];
      snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
      return list;
    }

    const batch = writeBatch(db);
    for (const u of DEFAULT_USERS) {
      const docRef = doc(db, 'app_users', u.id);
      batch.set(docRef, cleanForFirestore(u));
    }
    await batch.commit();
    console.info('✓ Utilisateurs initiaux (Jérôme & Benoît) initialisés dans Firestore');
    return DEFAULT_USERS;
  } catch (err) {
    console.warn('Erreur seed default users:', err);
    return DEFAULT_USERS;
  }
};

export const saveUserToFirestore = async (user: AppUser): Promise<string> => {
  try {
    await ensureAuth();
    const docId = user.id || `usr_${user.username.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_')}`;
    const docRef = doc(db, 'app_users', docId);
    const payload = cleanForFirestore({
      ...user,
      id: docId,
      updatedAt: Date.now(),
      createdAt: user.createdAt || Date.now(),
    });
    await setDoc(docRef, payload, { merge: true });
    notifySync(`✓ Profil de ${user.username} mis à jour`);
    return docId;
  } catch (error) {
    console.error('Erreur enregistrement utilisateur Firestore:', error);
    throw error;
  }
};

export const deleteUserFromFirestore = async (userId: string): Promise<void> => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'app_users', userId);
    await deleteDoc(docRef);
    notifySync('✓ Utilisateur supprimé');
  } catch (error) {
    console.error('Erreur suppression utilisateur Firestore:', error);
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* 7. PARAMÈTRES DES SÉANCES PARTAGÉS EN TEMPS RÉEL (MODULE 1 & 2)            */
/* -------------------------------------------------------------------------- */

// Valeurs d'usine par défaut immuables (servira pour le bouton de remise à zéro du Module 2)
export const DEFAULT_SESSION_SETTINGS = {
  sdur: 60,       // Durée d'une séance (min)
  gs: 15,         // Pause été (min)
  gw: 30,         // Pause hors été (min)
  s0: '07-01',    // Été : début (MM-JJ)
  s1: '08-31',    // Été : fin (MM-JJ)
  pre: 60,        // 1re séance : min. après le lever
  post: 30,       // Fin de séance : min. avant le coucher
  rnd: 15,        // Débuts arrondis à (min)
  xon: true,      // Tolérer débordement
  xtol: 20,       // Débordement toléré (min)
  xpl: 'debut' as const, // Calage des créneaux
  cap: 1,         // Chars par séance
  all: true,      // Tout le jour si petit coef
  cmax: 50,       // Seuil coef roulage continu
  h0: 9,          // Pas avant 9h
  h1: 24,         // Pas après 24h
};

// Configuration complète par défaut (Module 2 : Réinitialisation globale)
export const DEFAULT_APP_SETTINGS: AppSettings = {
  sdur: 60,       // Durée d'une séance (min)
  gs: 15,         // Pause été (min)
  gw: 30,         // Pause hors été (min)
  s0: '07-01',    // Été : début (MM-JJ)
  s1: '08-31',    // Été : fin (MM-JJ)
  pre: 60,        // 1re séance : min. après le lever
  post: 30,       // Fin de séance : min. avant le coucher
  rnd: 15,        // Débuts arrondis à (min)
  xon: true,      // Tolérer débordement
  xtol: 20,       // Débordement toléré (min)
  xpl: 'debut',   // Calage des créneaux
  cap: 1,         // Chars par séance
  all: true,      // Tout le jour si petit coef
  cmax: 50,       // Seuil coef roulage continu
  pcor: true,     // Correction pression
  L: 4.5,         // Seuil hauteur d'eau L (m)
  mg: 0,          // Marge marée (cm)
  lum: -1.1,      // Seuil luminosité lum (deg)
  lmg: 0,         // Marge luminosité (min)
  h0: 9,          // Pas avant 9h
  h1: 24,         // Pas après 24h
  les: false,     // Heure stricte été/hiver
  vmin: 8,        // Vent min (nœuds)
  vmax: 25,       // Vent max (nœuds)
  gmax: 35,       // Rafales max (nœuds)
  fmin: 3,        // Force min Beaufort
};

export const subscribeToSessionSettings = (
  onData: (cloudSettings: Partial<AppSettings>) => void,
  onError?: (err: Error) => void
) => {
  const docRef = doc(db, 'app_config', 'session_settings');
  return onSnapshot(
    docRef,
    snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data) {
          // Filtrer les métadonnées et renvoyer les réglages
          const { updatedAt, updatedBy, ...settings } = data;
          onData(settings as Partial<AppSettings>);
          notifySync('✓ Réglages séances synchronisés');
        }
      }
    },
    error => {
      console.warn('Erreur écoute des réglages séances Firestore:', error);
      onError?.(error);
    }
  );
};

export const saveSessionSettingsToFirestore = async (
  newSettings: Partial<AppSettings>
): Promise<void> => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'app_config', 'session_settings');
    const author = getActiveInstructor();
    const payload = cleanForFirestore({
      ...newSettings,
      updatedBy: author,
      updatedAt: Date.now(),
    });
    await setDoc(docRef, payload, { merge: true });
    notifySync('✓ Réglages séances enregistrés dans le Cloud');
  } catch (error) {
    console.error('Erreur enregistrement réglages séances Firestore:', error);
    notifySync('⚠️ Erreur de sauvegarde des réglages');
    throw error;
  }
};

/**
 * Réinitialise tous les réglages partagés sur Firestore avec les valeurs d'origine de l'école (Module 2)
 */
export const resetAllSettingsToFirestore = async (): Promise<void> => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'app_config', 'session_settings');
    const author = getActiveInstructor();
    const payload = cleanForFirestore({
      ...DEFAULT_APP_SETTINGS,
      updatedBy: author,
      updatedAt: Date.now(),
    });
    await setDoc(docRef, payload);
    notifySync('✓ Paramètres réinitialisés aux valeurs par défaut');
  } catch (error) {
    console.error('Erreur réinitialisation réglages Firestore:', error);
    notifySync('⚠️ Erreur de réinitialisation des réglages');
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* 8. ESPACE D'ÉCHANGE BEN ↔ JÉRÔME (MODULE 7)                                */
/* -------------------------------------------------------------------------- */

export const subscribeToTeamNotes = (
  onNotes: (notes: TeamNote[]) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'team_notes');
  return onSnapshot(
    colRef,
    snapshot => {
      const list: TeamNote[] = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          author: d.author || 'Benoît',
          category: d.category || 'organisation',
          content: d.content || '',
          createdAt: d.createdAt || Date.now(),
          isResolved: Boolean(d.isResolved),
          resolvedAt: d.resolvedAt,
          resolvedBy: d.resolvedBy,
        });
      });
      // Trier par date décroissante (plus récent d'abord)
      list.sort((a, b) => b.createdAt - a.createdAt);
      onNotes(list);
    },
    error => {
      console.warn('Erreur écoute des notes d\'équipe Firestore:', error);
      onError?.(error);
    }
  );
};

export const addTeamNoteToFirestore = async (
  note: Omit<TeamNote, 'id'>
): Promise<string> => {
  try {
    await ensureAuth();
    const cleanId = `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const docRef = doc(db, 'team_notes', cleanId);
    const payload = cleanForFirestore({
      ...note,
      createdAt: note.createdAt || Date.now(),
      isResolved: false,
    });
    await setDoc(docRef, payload);
    notifySync('✓ Message envoyé dans l\'espace d\'échange');
    return cleanId;
  } catch (error) {
    console.error('Erreur ajout note d\'équipe Firestore:', error);
    notifySync('⚠️ Erreur d\'envoi du message');
    throw error;
  }
};

export const toggleTeamNoteResolvedInFirestore = async (
  noteId: string,
  isResolved: boolean,
  resolvedBy?: string
): Promise<void> => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'team_notes', noteId);
    const payload = cleanForFirestore({
      isResolved,
      resolvedAt: isResolved ? Date.now() : null,
      resolvedBy: isResolved ? resolvedBy || getActiveInstructor() : null,
    });
    await setDoc(docRef, payload, { merge: true });
    notifySync(isResolved ? '✓ Note marquée comme traitée' : '✓ Note remise en cours');
  } catch (error) {
    console.error('Erreur mise à jour note Firestore:', error);
    throw error;
  }
};

export const deleteTeamNoteFromFirestore = async (noteId: string): Promise<void> => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'team_notes', noteId);
    await deleteDoc(docRef);
    notifySync('✓ Note supprimée');
  } catch (error) {
    console.error('Erreur suppression note Firestore:', error);
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* 9. RELEVÉS GPS LIMITE BASSE DE ROULAGE (OBSERVATOIRE HYDRODYNAMIQUE)       */
/* -------------------------------------------------------------------------- */

export const subscribeToWaterlineGpsLogs = (
  onLogs: (logs: GpsWaterlineLog[]) => void,
  onError?: (err: Error) => void
) => {
  const colRef = collection(db, 'waterline_gps_logs');
  return onSnapshot(
    colRef,
    snapshot => {
      const list: GpsWaterlineLog[] = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          timestamp: d.timestamp || Date.now(),
          dateStr: d.dateStr || '',
          timeStr: d.timeStr || '',
          author: d.author || 'Jérôme',
          latitude: Number(d.latitude) || 0,
          longitude: Number(d.longitude) || 0,
          altitude: d.altitude != null ? Number(d.altitude) : null,
          accuracyM: Number(d.accuracyM) || 0,
          accuracyQuality: d.accuracyQuality || 'medium',
          weatherSnapshot: {
            windSpeedKts: Number(d.weatherSnapshot?.windSpeedKts) || 0,
            windGustKts: Number(d.weatherSnapshot?.windGustKts) || 0,
            windDirectionDeg: Number(d.weatherSnapshot?.windDirectionDeg) || 0,
            windDirectionComp: d.weatherSnapshot?.windDirectionComp || 'O',
            pressureHpa: Number(d.weatherSnapshot?.pressureHpa) || 1013,
            waveHeightM: d.weatherSnapshot?.waveHeightM != null ? Number(d.weatherSnapshot.waveHeightM) : undefined,
            wavePeriodS: d.weatherSnapshot?.wavePeriodS != null ? Number(d.weatherSnapshot.wavePeriodS) : undefined,
          },
          theoreticalWaterHeightM: Number(d.theoreticalWaterHeightM) || 0,
          correctedWaterHeightM: Number(d.correctedWaterHeightM) || 0,
          schoolThresholdM: Number(d.schoolThresholdM) || 4.5,
          rawSurcoteCm: Number(d.rawSurcoteCm) || 0,
          correctedSurcoteCm: Number(d.correctedSurcoteCm) || 0,
          beachState: d.beachState,
          note: d.note,
          createdAt: d.createdAt || Date.now(),
        });
      });
      // Trier par date/heure décroissante (plus récent d'abord)
      list.sort((a, b) => b.timestamp - a.timestamp);
      onLogs(list);
    },
    error => {
      console.warn('Erreur écoute relevés GPS Firestore:', error);
      onError?.(error);
    }
  );
};

export const upsertWaterlineGpsLogToFirestore = async (
  log: Omit<GpsWaterlineLog, 'id'>,
  existingId?: string
): Promise<{ id: string; isUpdated: boolean }> => {
  try {
    await ensureAuth();
    const cleanId = existingId || `gps_${log.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const docRef = doc(db, 'waterline_gps_logs', cleanId);
    const payload = cleanForFirestore({
      ...log,
      createdAt: log.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    await setDoc(docRef, payload, { merge: true });
    notifySync(existingId ? '🛡️ Relevé GPS mis à jour (sécurité anti-doublon)' : '✓ Relevé GPS limite d\'eau enregistré');
    return { id: cleanId, isUpdated: Boolean(existingId) };
  } catch (error) {
    console.error('Erreur enregistrement relevé GPS Firestore:', error);
    notifySync('⚠️ Erreur d\'enregistrement GPS');
    throw error;
  }
};

export const addWaterlineGpsLogToFirestore = async (
  log: Omit<GpsWaterlineLog, 'id'>
): Promise<string> => {
  const res = await upsertWaterlineGpsLogToFirestore(log);
  return res.id;
};

export const deleteWaterlineGpsLogFromFirestore = async (logId: string): Promise<void> => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'waterline_gps_logs', logId);
    await deleteDoc(docRef);
    notifySync('✓ Relevé GPS supprimé');
  } catch (error) {
    console.error('Erreur suppression relevé GPS Firestore:', error);
    throw error;
  }
};

