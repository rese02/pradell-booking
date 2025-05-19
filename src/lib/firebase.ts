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
let firebaseInitializationError: string | null = null;

// This block should only run once, ideally on server start.
if (typeof window === 'undefined') { // Ensure this runs only server-side during initialization
  console.log("============================================================");
  console.log("Firebase Initialization Configuration Check (Server-Side):");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const firebaseConfigValues = getFirebaseConfigValues();
  let allCriticalConfigVarsPresent = true;
  const missingCriticalVars: string[] = [];
  const loadedConfigForLogging: Record<string, string | undefined> = {};

  console.log("--- Checking Environment Variables ---");
  REQUIRED_ENV_VARS_CONFIG.forEach(configEntry => {
    const value = firebaseConfigValues[configEntry.key];
    loadedConfigForLogging[configEntry.key] = value;
    const status = (value && value.trim() !== "")
      ? `Value: '${value.length > 40 && !['storageBucket', 'authDomain'].includes(configEntry.key) ? value.substring(0, 30) + '...' : value}'`
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
        console.log("[Firebase Init] Attempting to initialize Firebase app with provided config...");
        app = initializeApp(firebaseConfigValues);
        console.log(`[Firebase Init OK] Firebase app initialized successfully for project: ${app.options.projectId}`);
      } catch (e: any) {
        firebaseInitializationError = `CRITICAL: Firebase app initialization FAILED. Error: ${e.message}. Ensure firebaseConfig values from .env.local are correct and present.`;
        console.error(`[Firebase Init FAIL] ${firebaseInitializationError}`, e.stack?.substring(0,500));
        app = null;
      }
    } else {
      app = getApps()[0];
      console.log(`[Firebase Init OK] Firebase app already initialized (retrieved existing instance for project: ${app.options.projectId}).`);
    }

    let dbInitSuccess = false;
    let storageInitSuccess = false;

    if (app) {
      // Initialize Firestore
      try {
        console.log("[Firebase Init] Attempting to initialize Firestore (db)...");
        db = getFirestore(app);
        // At this point, `db` is an object. Connection errors (like 5 NOT_FOUND or PERMISSION_DENIED for the API)
        // usually occur on the first actual database operation (e.g., getDocs, addDoc).
        console.log("[Firebase Init OK] Firestore (db) service instance GET successful. Actual connection will be tested on first DB operation.");
        dbInitSuccess = true;
      } catch (e: any) {
        const firestoreErrorMsg = `CRITICAL: Firestore (db) service instance GET FAILED. Error: ${e.message}. This often means the Cloud Firestore API is not enabled for project '${firebaseConfigValues.projectId}' or the database instance hasn't been created in the Firebase Console (check Firestore Database section, click 'Create database' if prompted).`;
        firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + "; " : "") + firestoreErrorMsg;
        console.error(`[Firebase Init FAIL] ${firestoreErrorMsg}`, e.stack?.substring(0,500));
        db = null;
      }

      // Initialize Storage
      try {
        console.log("[Firebase Init] Attempting to initialize Firebase Storage...");
        storage = getStorage(app);
        console.log("[Firebase Init OK] Firebase Storage service instance GET successful.");
        storageInitSuccess = true;
      } catch (e: any) {
        const storageErrorMsg = `CRITICAL: Firebase Storage service instance GET FAILED. Error: ${e.message}. This often means 'storageBucket' ("${firebaseConfigValues.storageBucket}") in config is missing/incorrect, or Storage service not enabled/configured in Firebase console.`;
        firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + "; " : "") + storageErrorMsg;
        console.error(`[Firebase Init FAIL] ${storageErrorMsg}`, e.stack?.substring(0,500));
        storage = null;
      }

      // Final check for overall success
      if (app && dbInitSuccess && storageInitSuccess) {
        firebaseInitializedCorrectly = true;
        firebaseInitializationError = null; // Clear any previous non-critical warnings if all services are now up.
        console.log("[Firebase Init OK] Firebase Core App, Firestore Service, and Storage Service ALL INITIALIZED AND READY.");
      } else {
        firebaseInitializedCorrectly = false;
        if (!firebaseInitializationError) { // Generic error if specific ones weren't caught
            let reasons = [];
            if (!app) reasons.push("Firebase App (app) object is null");
            if (!dbInitSuccess) reasons.push("Firestore (db) service instance failed to get");
            if (!storageInitSuccess) reasons.push("Firebase Storage service instance failed to get");
            firebaseInitializationError = `One or more Firebase services failed to initialize. Reason(s): ${reasons.join('; ')}. Check logs above.`;
        }
        console.error(`[Firebase Init FAIL] Overall initialization failed. 'firebaseInitializedCorrectly' is FALSE. Error details: ${firebaseInitializationError}`);
      }
    } else { // app is null
      firebaseInitializedCorrectly = false;
      if (!firebaseInitializationError) { // Ensure there's an error message if app init failed silently
        firebaseInitializationError = "Firebase app object is null after initialization attempt. Firestore and Storage cannot be initialized.";
      }
      console.error(`[Firebase Init FAIL] ${firebaseInitializationError}. 'firebaseInitializedCorrectly' is FALSE.`);
    }
  } else { // Missing critical environment variables
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
  // Client-side: attempt to re-initialize if not already done, or get existing instances.
  // This path is less critical for server-side data fetching errors but good for consistency.
  if (getApps().length > 0) {
    if (!app) app = getApps()[0];
    if (app && !db) {
      try { db = getFirestore(app); } catch (e) { /* Client-side init errors are less critical here, server state is primary */ }
    }
    if (app && !storage) {
      try { storage = getStorage(app); } catch (e) { /* Client-side init errors */ }
    }
    // Note: firebaseInitializedCorrectly reflects server's state. No need to re-evaluate here.
  }
}

export { app, db, storage, firebaseInitializedCorrectly, firebaseInitializationError };

    