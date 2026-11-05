import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore, getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with ignoreUndefinedProperties: true to prevent SDK errors on optional fields
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
}, firebaseConfig.firestoreDatabaseId || '(default)');

// Initialize Auth
export const auth = getAuth(app);

// Ensure auth resolves smoothly without blocking operations if anonymous signin is restricted
let authPromise: Promise<User | null> | null = null;

export const ensureAuth = async (): Promise<User | null> => {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  if (!authPromise) {
    authPromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      });
      signInAnonymously(auth)
        .then(cred => {
          unsubscribe();
          resolve(cred.user);
        })
        .catch(() => {
          unsubscribe();
          // L'authentification anonyme est restreinte dans la console GCP, les règles autorisent l'accès direct
          resolve(null);
        });
    });
  }
  return authPromise;
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
