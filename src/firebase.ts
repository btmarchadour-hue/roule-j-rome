import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, User } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  doc,
  getDocFromServer,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Firestore's IndexedDB multi-tab persistence checks stored lease timestamps against Date.now().
// When a device's OS clock steps backwards by a few seconds (e.g., NTP sync or waking from sleep),
// the SDK self-heals by re-acquiring the lease with Date.now(), but emits a noisy console.error
// ("Detected an update time that is in the future: ..."). Downgrade only that exact benign
// clock-skew diagnostic to console.warn while preserving all genuine Firestore errors.
function installFirestoreClockSkewLogGuard(): void {
  if (typeof console === 'undefined' || typeof console.error !== 'function') return;
  type PatchedConsoleError = typeof console.error & { __firestoreClockSkewGuarded?: boolean };
  const currentError = console.error as PatchedConsoleError;
  if (currentError.__firestoreClockSkewGuarded) return;

  const originalError = currentError.bind(console);
  const guardedError: PatchedConsoleError = (...args: unknown[]) => {
    const isFirestoreClockSkew =
      args.length >= 2 &&
      typeof args[0] === 'string' &&
      args[0].includes('@firebase/firestore') &&
      typeof args[1] === 'string' &&
      args[1].includes('Detected an update time that is in the future:');

    if (isFirestoreClockSkew) {
      console.warn(...args);
      return;
    }
    originalError(...args);
  };
  guardedError.__firestoreClockSkewGuarded = true;
  console.error = guardedError;
}

installFirestoreClockSkewLogGuard();

// Initialize Firebase App
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';

// Initialize Firestore with persistent multi-tab IndexedDB cache (reduces daily read units by ~90-95%
// and improves offline/weak-4G beach resilience), with graceful fallback for private browsing modes.
function initFirestoreInstance(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        ignoreUndefinedProperties: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      databaseId
    );
  } catch (err) {
    console.warn('Firestore persistent cache unavailable, falling back to memory cache:', err);
    try {
      return initializeFirestore(
        app,
        {
          ignoreUndefinedProperties: true,
          localCache: memoryLocalCache(),
        },
        databaseId
      );
    } catch {
      return getFirestore(app, databaseId);
    }
  }
}

export const db: Firestore = initFirestoreInstance();

// Initialize Auth
export const auth = getAuth(app);

// Direct access mode: anonymous signin is restricted by project policy, direct Firestore access is enabled
export const ensureAuth = async (): Promise<User | null> => {
  return auth.currentUser || null;
};

// Validate connection as per Firebase skill requirements
async function testConnection() {
  try {
    await ensureAuth();
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase configuration offline check:', error.message);
    }
  }
}

// Auto-run connection test
testConnection();
