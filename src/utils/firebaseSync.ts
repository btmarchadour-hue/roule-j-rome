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
  CustomSlotsMap,
  SlotObservation,
  ValidationsMap,
} from '../types';

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
