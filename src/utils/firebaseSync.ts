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
  } catch (error) {
    console.error('Erreur enregistrement validation Firestore:', error);
    throw error;
  }
};

export const deleteValidationFromFirestore = async (dateStr: string) => {
  try {
    await ensureAuth();
    const docRef = doc(db, 'validations', dateStr);
    await deleteDoc(docRef);
    console.info(`✓ Validation [${dateStr}] supprimée de Firestore`);
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
/* 5. SYNCHRONISATION BIDIRECTIONNELLE LOCALE <-> CLOUD FIRESTORE             */
/* Garantit que toutes les modifications faites sur mobile ou PC sont dans    */
/* Firestore et propagées instantanément à tous les appareils de l'école.     */
/* -------------------------------------------------------------------------- */
export const syncLocalDataWithFirestore = async () => {
  try {
    await ensureAuth();

    // 1. Synchroniser les observations
    const obsCol = collection(db, 'observations');
    const obsSnap = await getDocs(obsCol);
    obsSnap.forEach(d => {
      if (d.id.startsWith('sample-obs-')) {
        deleteDoc(d.ref).catch(() => {});
      }
    });

    const localObsRaw =
      localStorage.getItem('char_slot_observations_v1') ||
      localStorage.getItem('cv_observations_v1');
    if (localObsRaw) {
      try {
        const localObs = JSON.parse(localObsRaw);
        if (Array.isArray(localObs)) {
          const cleanReal = localObs.filter(
            (o: SlotObservation) => o && o.id && !o.id.startsWith('sample-obs-')
          );
          if (cleanReal.length > 0) {
            const batch = writeBatch(db);
            cleanReal.forEach((o: SlotObservation) => {
              const id = o.id || `${o.ds}_${o.slotKey}`;
              const ref = doc(db, 'observations', id);
              batch.set(ref, cleanForFirestore({ ...o, id, author: o.author || 'Jérôme' }), { merge: true });
            });
            await batch.commit();
          }
        }
      } catch (e) {
        console.warn('Erreur synchro locale obs:', e);
      }
    }

    // 2. Synchroniser les validations
    const localValRaw = localStorage.getItem('char_validations_v2');
    if (localValRaw) {
      try {
        const localVal = JSON.parse(localValRaw);
        if (localVal && Object.keys(localVal).length > 0) {
          const batch = writeBatch(db);
          for (const [dateStr, vData] of Object.entries(localVal)) {
            const ref = doc(db, 'validations', dateStr);
            batch.set(
              ref,
              cleanForFirestore({ ...(vData as any), author: (vData as any)?.author || 'Jérôme' }),
              { merge: true }
            );
          }
          await batch.commit();
        }
      } catch (e) {
        console.warn('Erreur synchro locale validations:', e);
      }
    }

    // 3. Synchroniser les créneaux sur mesure
    const localCsRaw = localStorage.getItem('char_custom_slots_v1');
    if (localCsRaw) {
      try {
        const localCs = JSON.parse(localCsRaw);
        if (localCs && Object.keys(localCs).length > 0) {
          const batch = writeBatch(db);
          for (const [dateStr, csData] of Object.entries(localCs)) {
            const ref = doc(db, 'custom_slots', dateStr);
            batch.set(
              ref,
              cleanForFirestore({ ...(csData as any), updatedBy: (csData as any)?.updatedBy || 'Jérôme' }),
              { merge: true }
            );
          }
          await batch.commit();
        }
      } catch (e) {
        console.warn('Erreur synchro locale custom slots:', e);
      }
    }

    // 4. Synchroniser les réservations
    const localBookingsRaw = localStorage.getItem('char_agenda_bookings_v3');
    if (localBookingsRaw) {
      try {
        const localBookings = JSON.parse(localBookingsRaw);
        if (localBookings && Object.keys(localBookings).length > 0) {
          const batch = writeBatch(db);
          for (const [resKey, clients] of Object.entries(localBookings)) {
            const ref = doc(db, 'reservations', resKey);
            const [ds, slotKey] = resKey.split('_');
            batch.set(
              ref,
              cleanForFirestore({
                ds: ds || '',
                slotKey: slotKey || '',
                clients,
                updatedBy: 'Jérôme',
                updatedAt: Date.now(),
              }),
              { merge: true }
            );
          }
          await batch.commit();
        }
      } catch (e) {
        console.warn('Erreur synchro locale bookings:', e);
      }
    }
  } catch (error) {
    console.warn('Synchronisation initiale Firestore terminée avec note:', error);
  }
};

// Alias rétrocompatible
export const seedLocalDataToFirestoreIfEmpty = syncLocalDataWithFirestore;
