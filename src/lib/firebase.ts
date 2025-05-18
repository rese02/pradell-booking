
// src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Explicitly list required environment variables for Firebase config
const REQUIRED_ENV_VARS_CONFIG: { key: keyof ReturnType<typeof getFirebaseConfigValues>; envVarName: string; isCritical: boolean }[] = [
  { key: "apiKey", envVarName: "NEXT_PUBLIC_FIREBASE_API_KEY", isCritical: true },
  { key: "authDomain", envVarName: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", isCritical: true },
  { key: "projectId", envVarName: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", isCritical: true },
  { key: "storageBucket", envVarName: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", isCritical: true },
  { key: "messagingSenderId", envVarName: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", isCritical: true },
  { key: "appId", envVarName: "NEXT_PUBLIC_FIREBASE_APP_ID", isCritical: true },
];

function getFirebaseConfigValues() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
  };
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let firebaseInitializedCorrectly = false; // Default to false

if (typeof window === 'undefined') { // Log only on server-side during initialization
  console.log("============================================================");
  console.log("Firebase Initialization Configuration Check (Server-Side):");

  const firebaseConfigValues = getFirebaseConfigValues();
  let allCriticalConfigVarsPresent = true;
  const missingCriticalVars: string[] = [];

  REQUIRED_ENV_VARS_CONFIG.forEach(configEntry => {
    const value = firebaseConfigValues[configEntry.key];
    const status = (value && value.trim() !== "") ? `Value: '${value}'` : "NOT LOADED or EMPTY";
    console.log(`[Firebase Init Check] ${configEntry.envVarName} for '${configEntry.key}': ${status}${configEntry.isCritical ? ' (Required)' : ' (Optional)'}`);
    if (configEntry.isCritical && (!value || value.trim() === "")) {
      allCriticalConfigVarsPresent = false;
      missingCriticalVars.push(configEntry.envVarName);
    }
  });

  const measurementIdValue = firebaseConfigValues.measurementId;
  if (measurementIdValue && measurementIdValue.trim() !== "") {
    console.log(`[Firebase Init Check] NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID for 'measurementId': Value: '${measurementIdValue}' (Optional)`);
  } else {
    console.log(`[Firebase Init Check] NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID for 'measurementId': Not set or empty (Optional)`);
  }
  console.log("------------------------------------------------------------");

  if (allCriticalConfigVarsPresent) {
    if (getApps().length === 0) {
      try {
        console.log("[Firebase Init Attempt] Initializing Firebase app with config:", firebaseConfigValues);
        app = initializeApp(firebaseConfigValues);
        console.log("[Firebase Init OK] Firebase app initialized successfully.");
      } catch (e: any) {
        console.error("[Firebase Init FAIL] CRITICAL: Firebase app initialization FAILED.", e.message, e.stack?.substring(0,300));
        app = null;
      }
    } else {
      app = getApps()[0];
      console.log("[Firebase Init OK] Firebase app already initialized (retrieved existing instance).");
    }

    if (app) {
      let dbInitSuccess = false;
      let storageInitSuccess = false;
      try {
        console.log("[Firebase Init Attempt] Getting Firestore instance...");
        db = getFirestore(app);
        console.log("[Firebase Init OK] Firestore initialized successfully.");
        dbInitSuccess = true;
      } catch (e: any) {
        console.error("[Firebase Init FAIL] CRITICAL: Firestore initialization FAILED.", e.message, e.stack?.substring(0,300));
        db = null;
      }

      try {
        console.log("[Firebase Init Attempt] Getting Firebase Storage instance...");
        storage = getStorage(app);
        console.log("[Firebase Init OK] Firebase Storage initialized successfully.");
        storageInitSuccess = true;
      } catch (e: any) {
        console.error("[Firebase Init FAIL] CRITICAL: Firebase Storage initialization FAILED.", e.message, e.stack?.substring(0,300));
        console.error("[Firebase Init INFO] Common cause for Storage init fail: 'storageBucket' in config is missing/incorrect, or Storage service not enabled in Firebase console.");
        storage = null;
      }

      if (dbInitSuccess && storageInitSuccess) { // app is already confirmed to be non-null here
        firebaseInitializedCorrectly = true;
        console.log("[Firebase Init OK] Firebase Core, Firestore, and Storage INITIALIZED AND CONFIGURED CORRECTLY.");
      } else {
        firebaseInitializedCorrectly = false;
        let reason = [];
        if (!dbInitSuccess) reason.push("Firestore (db) not initialized");
        if (!storageInitSuccess) reason.push("Storage not initialized");
        console.error(`[Firebase Init FAIL] One or more Firebase services failed to initialize. Reason(s): ${reason.join(', ')}. 'firebaseInitializedCorrectly' is FALSE.`);
      }
    } else {
      firebaseInitializedCorrectly = false;
      console.error("[Firebase Init FAIL] Firebase app object is not available. Firestore and Storage cannot be initialized. 'firebaseInitializedCorrectly' is FALSE.");
    }
  } else {
    firebaseInitializedCorrectly = false;
    console.error(`CRITICAL: One or more required Firebase environment variables are missing or empty: ${missingCriticalVars.join(', ')}. Firebase initialization SKIPPED. 'firebaseInitializedCorrectly' is FALSE.`);
    console.error("Please ensure all NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file, the file is saved, and the server is RESTARTED.");
  }
  console.log(`[Firebase Init Final Status] firebaseInitializedCorrectly: ${firebaseInitializedCorrectly}`);
  console.log("============================================================");
}


export { app, db, storage, firebaseInitializedCorrectly };
