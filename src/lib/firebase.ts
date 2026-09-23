/**
 * Firebase client initialisation.
 *
 * Only public web-app configuration lives here — these values identify the
 * project, they are not secrets, and access control is enforced entirely by
 * Auth, the security rules and the callables. No service-account credential
 * is, or may ever be, bundled into the browser.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { FirebaseStorage } from 'firebase/storage';

import { FUNCTIONS_REGION } from '@/shared/constants';

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** False when .env has not been filled in; the UI shows a setup screen instead of crashing. */
export const isConfigured = Boolean(config.apiKey && config.projectId && config.appId);

export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

/**
 * Must equal REGION in functions/src/shared/constants.ts. A mismatch shows up in
 * the browser as a CORS failure, which reads like an unrelated bug.
 */
const region = env.VITE_FUNCTIONS_REGION || FUNCTIONS_REGION;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isConfigured) {
  app = initializeApp(config);
  auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence);

  // Persistent multi-tab cache: a reload or a second tab reads from IndexedDB
  // instead of re-fetching every document, which is most of the read bill for a
  // console people keep open all day.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  if (usingEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    // The Auth emulator sends no SMS and needs no real reCAPTCHA.
    auth.settings.appVerificationDisabledForTesting = true;
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
  }
}

function required<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`Firebase ${name} is not configured. Fill in .env and restart.`);
  return value;
}

export const firebase = {
  get auth(): Auth {
    return required(auth, 'Auth');
  },
  get db(): Firestore {
    return required(db, 'Firestore');
  },
};

/*
 * Functions and Storage load on first use. Reading the register needs only
 * Auth and Firestore; the callable and upload SDKs are fetched the first time
 * someone writes or attaches a file.
 */
let functionsP: Promise<Functions> | null = null;
export function getFunctionsLazy(): Promise<Functions> {
  functionsP ??= import('firebase/functions').then(({ getFunctions, connectFunctionsEmulator }) => {
    const f = getFunctions(required(app, 'App'), region);
    if (usingEmulators) connectFunctionsEmulator(f, '127.0.0.1', 5001);
    return f;
  });
  return functionsP;
}

let storageP: Promise<FirebaseStorage> | null = null;
export function getStorageLazy(): Promise<FirebaseStorage> {
  storageP ??= import('firebase/storage').then(({ getStorage, connectStorageEmulator }) => {
    const s = getStorage(required(app, 'App'));
    if (usingEmulators) connectStorageEmulator(s, '127.0.0.1', 9199);
    return s;
  });
  return storageP;
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');
