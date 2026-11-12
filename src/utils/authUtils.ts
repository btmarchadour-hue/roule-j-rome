import { ActiveUserSession, AppUser } from '../types';

// SHA-256 hashing via standard Web Crypto API
export async function hashPassword(plainText: string): Promise<string> {
  const trimmed = plainText.trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(trimmed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(plainText: string, expectedHash: string): Promise<boolean> {
  const hash = await hashPassword(plainText);
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

// Profils par défaut de l'école de char à voile (Jérôme, Benoît, et Moniteur d'été)
export const DEFAULT_USERS: AppUser[] = [
  {
    id: 'usr_jerome',
    username: 'Jérôme',
    displayName: 'Jérôme (Moniteur Responsable)',
    role: 'admin',
    passwordHash: '792cb90173e78db50f68a37d16a46fdbea1c59518078ef5a41d3485a5628e402', // mdp: lestrevet
    isReadOnly: false,
    isActive: true,
    createdAt: 1730000000000,
    updatedAt: 1730000000000,
  },
  {
    id: 'usr_benoit',
    username: 'Benoît',
    displayName: 'Benoît (Concepteur)',
    role: 'admin',
    passwordHash: 'adce9053b3b6b52dc4a7bb0b963351c77cb09477d1ee87bdc4fdd8ff8c3d04d3', // mdp: Maya2103
    isReadOnly: false,
    isActive: true,
    createdAt: 1730000000000,
    updatedAt: 1730000000000,
  },
  {
    id: 'usr_moniteur',
    username: 'Moniteur',
    displayName: 'Moniteur École (Saison)',
    role: 'moniteur',
    passwordHash: '96f82c7d491f5cce1185b7ac8c3bdfbeb2267c3fa6236136975617c383e17c24', // mdp: moniteur
    isReadOnly: true,
    isActive: true,
    createdAt: 1730000000000,
    updatedAt: 1730000000000,
  },
];

const USER_SESSION_KEY = 'cv_user_session';
const APP_UNLOCKED_KEY = 'cv_app_unlocked';

export function getActiveUser(): ActiveUserSession | null {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY) || sessionStorage.getItem(USER_SESSION_KEY);
    if (raw) {
      return JSON.parse(raw) as ActiveUserSession;
    }
  } catch (err) {
    console.warn('Erreur lecture session utilisateur:', err);
  }
  return null;
}

export function setActiveUser(session: ActiveUserSession, remember: boolean = true): void {
  try {
    const json = JSON.stringify(session);
    if (remember) {
      localStorage.setItem(USER_SESSION_KEY, json);
      localStorage.setItem(APP_UNLOCKED_KEY, 'true');
      sessionStorage.removeItem(USER_SESSION_KEY);
    } else {
      sessionStorage.setItem(USER_SESSION_KEY, json);
      sessionStorage.setItem(APP_UNLOCKED_KEY, 'true');
      localStorage.removeItem(USER_SESSION_KEY);
    }
    // Synchroniser l'instructeur actif pour l'émargement et les validations
    localStorage.setItem('cv_active_instructor', session.username);
  } catch (err) {
    console.warn('Erreur sauvegarde session utilisateur:', err);
  }
}

export function clearActiveUser(): void {
  try {
    localStorage.removeItem(USER_SESSION_KEY);
    localStorage.removeItem(APP_UNLOCKED_KEY);
    sessionStorage.removeItem(USER_SESSION_KEY);
    sessionStorage.removeItem(APP_UNLOCKED_KEY);
  } catch (err) {
    console.warn('Erreur déconnexion:', err);
  }
}

export function isCurrentUserReadOnly(): boolean {
  const current = getActiveUser();
  return Boolean(current?.isReadOnly);
}

export function isCurrentUserAdmin(): boolean {
  const current = getActiveUser();
  return current?.role === 'admin' && !current?.isReadOnly;
}

export function canCurrentUserEditSettings(): boolean {
  const current = getActiveUser();
  return current?.role === 'admin' && !current?.isReadOnly;
}
