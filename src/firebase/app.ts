import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";
import { emulatorsEnabled, isFirebaseConfigured, readFirebaseConfig } from "./config";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;
let emulatorsConnected = false;

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Database } | null {
  if (!isFirebaseConfigured()) return null;
  if (app && auth && db) return { app, auth, db };

  const config = emulatorsEnabled()
    ? {
        apiKey: "demo",
        authDomain: "localhost",
        databaseURL: "http://127.0.0.1:9000?ns=demo-hidden-pictures",
        projectId: "demo-hidden-pictures",
        appId: "demo",
      }
    : readFirebaseConfig();
  if (!config) return null;

  app = getApps()[0] ?? initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);

  if (emulatorsEnabled() && !emulatorsConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(db, "127.0.0.1", 9000);
    emulatorsConnected = true;
  }

  return { app, auth, db };
}

export function requireFirebase() {
  const fb = getFirebase();
  if (!fb) throw new Error("FIREBASE_NOT_CONFIGURED");
  return fb;
}
