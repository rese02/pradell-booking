
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
let firebaseInitializedCorrectly = false;
let firebaseInitializationError: string | null = null;

// This block should only run once, ideally on server start.
if (typeof window === 'undefined') { // Ensure this runs only server-side during initialization
  console.log("============================================================");
  console.log("Firebase Initialization Configuration Check (Server-Side):");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const firebaseConfigValues = getFirebaseConfigValues();
  let allCriticalConfigVarsPresent = true;
  const missingCriticalVars: string[] = [];

  console.log("--- Checking Environment Variables ---");
  REQUIRED_ENV_VARS_CONFIG.forEach(configEntry => {
    const value = firebaseConfigValues[configEntry.key];
    const displayValue = (value && value.length > 40 && !['storageBucket', 'authDomain'].includes(configEntry.key))
      ? value.substring(0, 30) + '...'
      : value;
    const status = (value && value.trim() !== "")
      ? `Value: '${displayValue}'`
      : "NOT LOADED or EMPTY";
    console.log(`[Firebase Env Check] ${configEntry.envVarName} for '${configEntry.key}': ${status}${configEntry.isCritical ? ' (Required)' : ' (Optional)'}`);
    if (configEntry.isCritical && (!value || value.trim() === "")) {
      allCriticalConfigVarsPresent = false;
      missingCriticalVars.push(configEntry.envVarName);
    }
  });
  
  const measurementIdValue = firebaseConfigValues.measurementId;
  const measurementIdStatus = (measurementIdValue && measurementIdValue.trim() !== "") ? `Value: '${measurementIdValue}'` : "Not set or empty";
  console.log(`[Firebase Env Check] NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID for 'measurementId': ${measurementIdStatus} (Optional)`);
  
  console.log("--- Firebase Services Initialization ---");
  console.log(`[Firebase Config Used] projectId for app initialization: '${firebaseConfigValues.projectId || 'MISSING_PROJECT_ID_IN_ENV'}'`);

  if (allCriticalConfigVarsPresent) {
    if (getApps().length === 0) {
      try {
        app = initializeApp(firebaseConfigValues);
        console.log("[Firebase Init OK] Firebase app initialized successfully.");
      } catch (e: any) {
        firebaseInitializationError = `CRITICAL: Firebase app initialization FAILED. Error: ${e.message}. Ensure firebaseConfig values from .env.local are correct.`;
        console.error(`[Firebase Init FAIL] ${firebaseInitializationError}`, e.stack?.substring(0,500));
        app = null;
      }
    } else {
      app = getApps()[0];
      console.log("[Firebase Init OK] Firebase app already initialized (retrieved existing instance).");
    }

    let dbInitSuccess = false;
    let storageInitSuccess = false;

    if (app) {
      try {
        db = getFirestore(app);
        console.log("[Firebase Init OK] Firestore (db) initialized successfully.");
        dbInitSuccess = true;
      } catch (e: any) {
        const firestoreErrorMsg = `CRITICAL: Firestore (db) initialization FAILED. Error: ${e.message}. This often means the Cloud Firestore API is not enabled for project '${firebaseConfigValues.projectId}' or the database instance hasn't been created in the Firebase Console (check Firestore Database section, click 'Create database' if prompted).`;
        firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + "; " : "") + firestoreErrorMsg;
        console.error(`[Firebase Init FAIL] ${firestoreErrorMsg}`, e.stack?.substring(0,500));
        db = null;
      }

      try {
        storage = getStorage(app);
        console.log("[Firebase Init OK] Firebase Storage initialized successfully.");
        storageInitSuccess = true;
      } catch (e: any) {
        const storageErrorMsg = `CRITICAL: Firebase Storage initialization FAILED. Error: ${e.message}. This often means 'storageBucket' ("${firebaseConfigValues.storageBucket}") in config is missing/incorrect, or Storage service not enabled/configured in Firebase console.`;
        firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + "; " : "") + storageErrorMsg;
        console.error(`[Firebase Init FAIL] ${storageErrorMsg}`, e.stack?.substring(0,500));
        storage = null;
      }

      if (app && dbInitSuccess && storageInitSuccess) {
        firebaseInitializedCorrectly = true;
        console.log("[Firebase Init OK] Firebase Core, Firestore, and Storage ALL INITIALIZED AND CONFIGURED CORRECTLY.");
      } else {
        firebaseInitializedCorrectly = false;
        if (!firebaseInitializationError) {
            let reasons = [];
            if (!app) reasons.push("Firebase App (app) object is null");
            if (!dbInitSuccess) reasons.push("Firestore (db) object is null or init failed");
            if (!storageInitSuccess) reasons.push("Firebase Storage object is null or init failed");
            firebaseInitializationError = `One or more Firebase services failed to initialize cleanly. Reason(s): ${reasons.join('; ')}. Check logs above.`;
        }
        console.error(`[Firebase Init FAIL] Overall initialization failed. 'firebaseInitializedCorrectly' is FALSE. Error details: ${firebaseInitializationError}`);
      }
    } else {
      firebaseInitializedCorrectly = false;
      if (!firebaseInitializationError) {
        firebaseInitializationError = "Firebase app object is null after initialization attempt. Firestore and Storage cannot be initialized.";
      }
      console.error(`[Firebase Init FAIL] ${firebaseInitializationError}. 'firebaseInitializedCorrectly' is FALSE.`);
    }
  } else {
    firebaseInitializedCorrectly = false;
    firebaseInitializationError = `CRITICAL: One or more required Firebase environment variables are missing or empty: ${missingCriticalVars.join(', ')}. Firebase initialization SKIPPED.`;
    console.error(`[Firebase Init FAIL] ${firebaseInitializationError} 'firebaseInitializedCorrectly' is FALSE.`);
    console.error("[Firebase Init INFO] Please ensure all NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file, the file is saved, and the server is RESTARTED.");
  }
  console.log(`[Firebase Init Final Status] firebaseInitializedCorrectly: ${firebaseInitializedCorrectly}`);
  if (firebaseInitializationError && !firebaseInitializedCorrectly) {
    console.error(`[Firebase Init Summary Error] ${firebaseInitializationError}`);
  }
  console.log("============================================================");
} else {
  // Client-side re-check (less critical, but good for consistency if module is somehow re-evaluated on client)
  // This won't re-log all the details, but ensures instances are available if server init was ok.
  if (getApps().length > 0) {
      if (!app) app = getApps()[0];
      if (app && !db) {
          try { db = getFirestore(app); } catch (e) { /* ignore client-side re-init errors if server failed */ }
      }
      if (app && !storage) {
          try { storage = getStorage(app); } catch (e) { /* ignore client-side re-init errors if server failed */ }
      }
      // firebaseInitializedCorrectly should reflect server's state, not re-evaluated here.
  }
}

export { app, db, storage, firebaseInitializedCorrectly, firebaseInitializationError };
