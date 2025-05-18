
// src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Explizit die Namen der benötigten Umgebungsvariablen auflisten
const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

const firebaseConfigValues = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let firebaseInitializedCorrectly = false;

// Überprüfen, ob alle benötigten Umgebungsvariablen vorhanden sind
let allConfigVarsPresent = true;
if (typeof window === 'undefined') { // Nur serverseitig beim Build/Start loggen
  console.log("============================================================");
  console.log("Firebase Initialization Configuration Check (Server-Side):");
  REQUIRED_ENV_VARS.forEach(varName => {
    const value = process.env[varName];
    console.log(`[Firebase Init] ${varName}: Value: '${value || "NOT LOADED"}'`);
    if (!value) {
      console.error(`[Firebase Init ERROR] Required environment variable ${varName} is missing or empty!`);
      allConfigVarsPresent = false;
    }
  });

  if (!allConfigVarsPresent) {
    console.error("CRITICAL: One or more required Firebase environment variables are missing. Firebase will LIKELY FAIL to initialize correctly.");
    console.error("Please ensure all NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file and that the file is saved and the server restarted.");
  } else {
    console.log("[Firebase Init] All required Firebase config environment variables appear to be present.");
  }
  console.log("============================================================");
}

if (allConfigVarsPresent) {
  if (getApps().length === 0) {
    try {
      app = initializeApp(firebaseConfigValues);
      console.log("Firebase app initialized successfully.");
    } catch (e) {
      console.error("CRITICAL: Firebase app initialization FAILED.", e);
      app = null; // Sicherstellen, dass app null ist bei Fehler
    }
  } else {
    app = getApps()[0];
    console.log("Firebase app already initialized (retrieved existing instance).");
  }

  if (app) {
    try {
      db = getFirestore(app);
      console.log("Firestore initialized successfully.");
    } catch (e) {
      console.error("CRITICAL: Firestore initialization FAILED.", e);
      db = null;
    }

    try {
      storage = getStorage(app);
      console.log("Firebase Storage initialized successfully.");
    } catch (e) {
      console.error("CRITICAL: Firebase Storage initialization FAILED.", e);
      storage = null;
    }

    if (db && storage) { // Firebase als korrekt initialisiert betrachten, wenn db und storage da sind
      firebaseInitializedCorrectly = true;
      console.log("Firebase Core, Firestore, and Storage initialized and configured correctly.");
    } else {
      firebaseInitializedCorrectly = false;
      console.error("Firebase initialized but Firestore or Storage FAILED to initialize. Check specific errors above.");
    }
  } else {
    firebaseInitializedCorrectly = false;
    console.error("Firebase app object is not available. Firestore and Storage cannot be initialized.");
  }
} else {
  firebaseInitializedCorrectly = false;
  console.error("Firebase initialization SKIPPED due to missing critical environment variables.");
}

export { app, db, storage, firebaseInitializedCorrectly };
