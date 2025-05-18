
// src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfigValues = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
};

let app: FirebaseApp;
let db: Firestore;
let storage: FirebaseStorage;

// Überprüfen, ob die Umgebungsvariablen geladen wurden (nur serverseitig beim Build/Start)
if (typeof window === 'undefined') {
    console.log("============================================================");
    console.log("Firebase Initialization Configuration Check (Server-Side):");
    console.log("Attempting to load Firebase config from .env.local variables.");
    let allConfigGood = true;
    for (const [key, value] of Object.entries(firebaseConfigValues)) {
        const envVarName = `NEXT_PUBLIC_FIREBASE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
        if (!value && key !== 'measurementId') { // measurementId is optional
            console.error(`[Firebase Init ERROR] ${envVarName} for '${key}' is missing or empty in .env.local!`);
            allConfigGood = false;
        } else {
            console.log(`[Firebase Init OK] ${envVarName} for '${key}': ${value ? 'Loaded' : 'NOT LOADED (but optional if measurementId)'}`);
        }
    }
    if (!allConfigGood) {
        console.error("CRITICAL: One or more required Firebase environment variables are missing. Firebase will likely fail to initialize correctly.");
        console.error("Please ensure all NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file and that the file is saved.");
    }
    if (!firebaseConfigValues.storageBucket) {
        console.error("CRITICAL: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is NOT LOADED or EMPTY. This is the likely cause of 'no-default-bucket' errors.");
    }
    console.log("============================================================");
}


if (getApps().length === 0) {
  // Nur initialisieren, wenn alle kritischen Werte vorhanden sind
  if (firebaseConfigValues.projectId && firebaseConfigValues.storageBucket && firebaseConfigValues.apiKey) {
    app = initializeApp(firebaseConfigValues);
    console.log("Firebase app initialized successfully.");
  } else {
    console.error("Firebase app initialization SKIPPED due to missing critical configuration. Uploads and Firestore operations will fail.");
    // @ts-ignore // app, db, storage might not be assigned, leading to runtime errors if used.
    // This is intentional to make the failure explicit.
    // Alternatively, provide mock objects or throw, but for now, log and skip.
  }
} else {
  app = getApps()[0];
  console.log("Firebase app already initialized.");
}

// @ts-ignore
if (app) {
  db = getFirestore(app);
  storage = getStorage(app); // This will fail if app is not initialized correctly or storageBucket is missing
} else {
  console.error("Firebase 'app' object is not available. Firestore and Storage cannot be initialized.");
  // @ts-ignore
  db = null; 
  // @ts-ignore
  storage = null;
}


export { app, db, storage };
