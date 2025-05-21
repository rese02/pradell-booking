
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
const initializationErrorMessages: string[] = [];

if (typeof window === 'undefined') { // Ensure this runs only server-side during initialization
  console.log("============================================================");
  console.log("Firebase Initialization Configuration Check (Server-Side):");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const firebaseConfigValues = getFirebaseConfigValues();
  let allCriticalConfigVarsPresent = true;
  const missingCriticalVars: string[] = [];
  const loadedConfigForLogging: Record<string, string | undefined | null> = {};

  console.log("--- Checking Environment Variables ---");
  REQUIRED_ENV_VARS_CONFIG.forEach(configEntry => {
    const value = firebaseConfigValues[configEntry.key];
    loadedConfigForLogging[configEntry.key] = value;
    const status = (value && value.trim() !== "")
      ? `Value: '${configEntry.key === 'apiKey' || configEntry.key === 'appId' || configEntry.key === 'messagingSenderId' ? value.substring(0,10) + '...' : value}'`
      : "NOT LOADED or EMPTY";
    console.log(`[Firebase Env Check] ${configEntry.envVarName} for '${configEntry.key}': ${status}${configEntry.isCritical ? ' (Required)' : ' (Optional)'}`);
    if (configEntry.isCritical && (!value || value.trim() === "")) {
      allCriticalConfigVarsPresent = false;
      missingCriticalVars.push(configEntry.envVarName);
    }
  });
  
  loadedConfigForLogging.measurementId = firebaseConfigValues.measurementId;
  const measurementIdValue = firebaseConfigValues.measurementId;
  const measurementIdStatus = (measurementIdValue && measurementIdValue.trim() !== "") ? `Value: '${measurementIdValue}'` : "Not set or empty";
  console.log(`[Firebase Env Check] NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID for 'measurementId': ${measurementIdStatus} (Optional)`);
  
  console.log("--- Firebase Services Initialization ---");
  console.log(`[Firebase Config Used] Effective Project ID for app initialization: '${firebaseConfigValues.projectId || 'MISSING_OR_EMPTY_PROJECT_ID_IN_ENV'}'`);
  console.log(`[Firebase Config Used] Effective Storage Bucket: '${firebaseConfigValues.storageBucket || 'MISSING_OR_EMPTY_STORAGE_BUCKET_IN_ENV'}'`);

  if (allCriticalConfigVarsPresent) {
    if (getApps().length === 0) {
      try {
        console.log("[Firebase Init Attempt] Initializing Firebase app with provided config...");
        app = initializeApp(firebaseConfigValues);
        console.log(`[Firebase Init OK] Firebase app initialized successfully. Project ID: ${app.options.projectId}`);
      } catch (e: any) {
        const appErrorMsg = `CRITICAL: Firebase app initialization FAILED. Error: ${e.message}. Ensure firebaseConfig values from .env.local are correct and present.`;
        initializationErrorMessages.push(appErrorMsg);
        console.error(`[Firebase Init FAIL - App] ${appErrorMsg}`, e.stack?.substring(0,500));
        app = null;
      }
    } else {
      app = getApps()[0];
      console.log(`[Firebase Init OK] Firebase app already initialized (retrieved existing instance). Project ID: ${app.options.projectId}`);
    }

    let dbInitSuccess = false;
    let storageInitSuccess = false;

    if (app) {
      // Initialize Firestore
      try {
        console.log("[Firebase Init Attempt] Initializing Firestore (db)...");
        db = getFirestore(app);
        console.log("[Firebase Init OK] Firestore (db) service instance GET successful.");
        dbInitSuccess = true;
      } catch (e: any) {
        const firestoreErrorMsg = `CRITICAL: Firestore (db) service instance GET FAILED. Error: ${e.message}. Possible causes: Cloud Firestore API not enabled for project '${firebaseConfigValues.projectId}', or database instance not created in Firebase Console.`;
        initializationErrorMessages.push(firestoreErrorMsg);
        console.error(`[Firebase Init FAIL - Firestore] ${firestoreErrorMsg}`, e.stack?.substring(0,500));
        db = null;
      }

      // Initialize Storage
      try {
        console.log("[Firebase Init Attempt] Initializing Firebase Storage (storage)...");
        storage = getStorage(app);
        console.log("[Firebase Init OK] Firebase Storage (storage) service instance GET successful.");
        storageInitSuccess = true;
      } catch (e: any) {
        const storageErrorMsg = `CRITICAL: Firebase Storage (storage) service instance GET FAILED. Error: ${e.message}. Possible causes: 'storageBucket' ("${firebaseConfigValues.storageBucket}") in config is missing/incorrect, or Storage service not enabled/configured in Firebase console.`;
        initializationErrorMessages.push(storageErrorMsg);
        console.error(`[Firebase Init FAIL - Storage] ${storageErrorMsg}`, e.stack?.substring(0,500));
        storage = null;
      }

      if (app && dbInitSuccess && storageInitSuccess) {
        firebaseInitializedCorrectly = true;
        console.log("[Firebase Init OK] Firebase Core App, Firestore Service, and Storage Service ALL INITIALIZED AND READY.");
      } else {
        // firebaseInitializedCorrectly remains false
        if (initializationErrorMessages.length === 0) { // Should not happen if one of them failed
            initializationErrorMessages.push("Unknown error: One or more Firebase services (App, DB, Storage) are null after initialization attempt without specific error logged.");
        }
        console.error(`[Firebase Init FAIL] Overall initialization failed. 'firebaseInitializedCorrectly' is FALSE.`);
      }
    } else { // app is null, critical failure during initializeApp
      // firebaseInitializedCorrectly remains false
      if (initializationErrorMessages.length === 0) {
        initializationErrorMessages.push("Firebase app object is null after initialization attempt. Firestore and Storage cannot be initialized.");
      }
      console.error(`[Firebase Init FAIL] ${initializationErrorMessages.join("; ")}. 'firebaseInitializedCorrectly' is FALSE.`);
    }
  } else { // Critical failure: Missing required environment variables
    // firebaseInitializedCorrectly remains false
    const envErrorMsg = `CRITICAL: One or more required Firebase environment variables are missing or empty: ${missingCriticalVars.join(', ')}. Firebase initialization SKIPPED.`;
    initializationErrorMessages.push(envErrorMsg);
    console.error(`[Firebase Init FAIL - Env Vars] ${envErrorMsg} 'firebaseInitializedCorrectly' is FALSE.`);
    console.error("[Firebase Init INFO] Please ensure all NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file, the file is saved, and the server is RESTARTED.");
  }
  
  if (initializationErrorMessages.length > 0) {
    firebaseInitializationError = initializationErrorMessages.join("; ");
  }

  console.log(`[Firebase Init Final Status] firebaseInitializedCorrectly: ${firebaseInitializedCorrectly}`);
  if (firebaseInitializationError && !firebaseInitializedCorrectly) {
    console.error(`[Firebase Init Summary Error Message] ${firebaseInitializationError}`);
  }
  console.log("============================================================");
} else {
  // Client-side: Minimal re-init or get existing instances if needed
  if (getApps().length > 0) {
    if (!app) app = getApps()[0];
    if (app && !db) { 
      try { db = getFirestore(app); } catch (e) { /* Client-side init errors less critical here */ }
    }
    if (app && !storage) { 
      try { storage = getStorage(app); } catch (e) { /* Client-side init errors */ }
    }
  }
}

export { app, db, storage, firebaseInitializedCorrectly, firebaseInitializationError };
