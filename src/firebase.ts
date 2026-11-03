import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with the provisioned database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

// Initialize Auth
export const auth = getAuth(app);

// Sign in anonymously automatically to authenticate both Bertrand and Jerome
let authPromise: Promise<User> | null = null;

export const ensureAuth = async (): Promise<User> => {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  if (!authPromise) {
    authPromise = new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      });
      signInAnonymously(auth).catch(err => {
        unsubscribe();
        reject(err);
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
