export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
};

export function readFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !databaseURL || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    databaseURL,
    projectId,
    appId,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
  };
}

export function emulatorsEnabled(): boolean {
  return import.meta.env.VITE_USE_EMULATORS === "1" || import.meta.env.VITE_USE_EMULATORS === "true";
}

export function isFirebaseConfigured(): boolean {
  return emulatorsEnabled() || readFirebaseConfig() != null;
}
