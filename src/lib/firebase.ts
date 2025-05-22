
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

// This block will run once when the module is first imported on the server.
if (typeof window === 'undefined') {
  const operationName = "[FirebaseInit]";
  console.log("============================================================");
  console.log(`${operationName} Firebase Initialization Sequence START (Server-Side)`);
  console.log(`${operationName} Timestamp: ${new Date().toISOString()}`);

  const firebaseConfigValues = getFirebaseConfigValues();
  let allCriticalConfigVarsPresent = true;
  const missingCriticalVars: string[] = [];
  const loadedConfigForLogging: Record<string, string | boolean> = {};

  console.log(`${operationName} --- Checking Environment Variables ---`);
  REQUIRED_ENV_VARS_CONFIG.forEach(configEntry => {
    const value = firebaseConfigValues[configEntry.key];
    const isLoaded = !!(value && value.trim() !== "");
    loadedConfigForLogging[configEntry.envVarName] = isLoaded ? `Loaded (Value: ${configEntry.key === 'apiKey' || configEntry.key === 'appId' || configEntry.key === 'messagingSenderId' ? value.substring(0,5) + '...' : value})` : 'NOT LOADED or EMPTY';
    console.log(`${operationName} ${configEntry.envVarName} for '${configEntry.key}': ${loadedConfigForLogging[configEntry.envVarName]}${configEntry.isCritical ? ' (Required)' : ' (Optional)'}`);
    if (configEntry.isCritical && !isLoaded) {
      allCriticalConfigVarsPresent = false;
      missingCriticalVars.push(configEntry.envVarName);
    }
  });
  
  const measurementIdValue = firebaseConfigValues.measurementId;
  const measurementIdStatus = (measurementIdValue && measurementIdValue.trim() !== "") ? `Loaded (Value: '${measurementIdValue}')` : "Not set or empty";
  console.log(`${operationName} NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID for 'measurementId': ${measurementIdStatus} (Optional)`);

  if (allCriticalConfigVarsPresent) {
    console.log(`${operationName} All critical Firebase environment variables are present.`);
    try {
      if (getApps().length === 0) {
        console.log(`${operationName} Initializing Firebase app...`);
        app = initializeApp(firebaseConfigValues);
        console.log(`${operationName} Firebase app INITIALIZED successfully. Project ID: ${app.options.projectId}`);
      } else {
        app = getApps()[0];
        console.log(`${operationName} Firebase app ALREADY INITIALIZED (retrieved existing instance). Project ID: ${app.options.projectId}`);
      }

      let dbInitSuccess = false;
      try {
        console.log(`${operationName} Initializing Firestore (db)...`);
        db = getFirestore(app);
        console.log(`${operationName} Firestore (db) service instance GET successful.`);
        dbInitSuccess = true;
      } catch (e: any) {
        firebaseInitializationError = `${firebaseInitializationError || ""}Firestore (db) initialization FAILED: ${e.message}. Ensure Cloud Firestore API is enabled and a database instance exists. `;
        console.error(`${operationName} CRITICAL: ${firebaseInitializationError}`, e.stack?.substring(0,300));
      }

      let storageInitSuccess = false;
      try {
        console.log(`${operationName} Initializing Firebase Storage (storage)...`);
        storage = getStorage(app);
        console.log(`${operationName} Firebase Storage (storage) service instance GET successful. Bucket: ${storage.app.options.storageBucket}`);
        storageInitSuccess = true;
      } catch (e: any) {
        firebaseInitializationError = `${firebaseInitializationError || ""}Firebase Storage (storage) initialization FAILED: ${e.message}. Ensure 'storageBucket' in config is correct and Storage service is enabled. `;
        console.error(`${operationName} CRITICAL: ${firebaseInitializationError}`, e.stack?.substring(0,300));
      }

      if (app && dbInitSuccess && storageInitSuccess) {
        firebaseInitializedCorrectly = true;
        console.log(`${operationName} Firebase Core App, Firestore Service, and Storage Service ALL INITIALIZED AND READY.`);
      } else {
        if (!firebaseInitializationError) firebaseInitializationError = "Unknown error: One or more Firebase services are null after initialization attempt.";
        console.error(`${operationName} Overall Firebase initialization FAILED. 'firebaseInitializedCorrectly' is FALSE. Error(s): ${firebaseInitializationError}`);
      }

    } catch (e: any) { // Catch errors from initializeApp itself
      firebaseInitializationError = `${firebaseInitializationError || ""}Firebase app initialization (initializeApp) FAILED: ${e.message}. `;
      console.error(`${operationName} CRITICAL: ${firebaseInitializationError}`, e.stack?.substring(0,300));
    }
  } else {
    firebaseInitializationError = `One or more required Firebase environment variables are missing: ${missingCriticalVars.join(', ')}. Firebase initialization SKIPPED.`;
    console.error(`${operationName} CRITICAL: ${firebaseInitializationError}`);
    console.error(`${operationName} Please ensure all NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file and the server is RESTARTED.`);
  }
  console.log(`${operationName} Final Status: firebaseInitializedCorrectly = ${firebaseInitializedCorrectly}`);
  if (firebaseInitializationError && !firebaseInitializedCorrectly) {
    console.error(`${operationName} Summary of Initialization Errors: ${firebaseInitializationError}`);
  }
  console.log("============================================================");
}

export { app, db, storage, firebaseInitializedCorrectly, firebaseInitializationError };
