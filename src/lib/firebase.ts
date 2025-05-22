
// src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Explicitly list required environment variables for Firebase config
const CORE_REQUIRED_ENV_VARS: { key: keyof FirebaseConfigValues; envVarName: string }[] = [
  { key: "apiKey", envVarName: "NEXT_PUBLIC_FIREBASE_API_KEY" },
  { key: "authDomain", envVarName: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" },
  { key: "projectId", envVarName: "NEXT_PUBLIC_FIREBASE_PROJECT_ID" },
];

const ALL_ENV_VARS_CONFIG: { key: keyof FirebaseConfigValues; envVarName: string; isCritical: boolean }[] = [
  ...CORE_REQUIRED_ENV_VARS.map(v => ({ ...v, isCritical: true })),
  { key: "storageBucket", envVarName: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", isCritical: true }, // Critical for storage operations
  { key: "messagingSenderId", envVarName: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", isCritical: true },
  { key: "appId", envVarName: "NEXT_PUBLIC_FIREBASE_APP_ID", isCritical: true },
  { key: "measurementId", envVarName: "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID", isCritical: false }, // Optional
];

interface FirebaseConfigValues {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

function getFirebaseConfigValues(): FirebaseConfigValues {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let firebaseInitializedCorrectly = false;
let firebaseInitializationError: string | null = null;

// This block will run once when the module is first imported, primarily on the server.
if (typeof window === 'undefined') {
  const operationName = "[FirebaseInit]";
  console.log("============================================================");
  console.log(`${operationName} Firebase Initialization Sequence START (Server-Side)`);
  console.log(`${operationName} Timestamp: ${new Date().toISOString()}`);

  const firebaseConfigValues = getFirebaseConfigValues();
  const loadedConfigForLogging: Record<string, string> = {};
  const missingCriticalVars: string[] = [];

  console.log(`${operationName} --- Checking Environment Variables ---`);
  ALL_ENV_VARS_CONFIG.forEach(configEntry => {
    const value = firebaseConfigValues[configEntry.key];
    const isLoaded = !!(value && value.trim() !== "");
    const displayValue = isLoaded ? (configEntry.key === 'apiKey' || configEntry.key === 'appId' || configEntry.key === 'messagingSenderId' ? value!.substring(0,5) + '...' : value!) : 'NOT LOADED or EMPTY';
    loadedConfigForLogging[configEntry.envVarName] = displayValue;
    console.log(`${operationName} ${configEntry.envVarName} for '${configEntry.key}': ${displayValue}${configEntry.isCritical ? ' (Required)' : ' (Optional)'}`);
    if (configEntry.isCritical && !isLoaded) {
      missingCriticalVars.push(configEntry.envVarName);
    }
  });

  if (missingCriticalVars.length > 0) {
    firebaseInitializationError = `Missing critical Firebase environment variables: ${missingCriticalVars.join(', ')}. Firebase initialization SKIPPED.`;
    console.error(`${operationName} CRITICAL: ${firebaseInitializationError}`);
    console.error(`${operationName} Please ensure all required NEXT_PUBLIC_FIREBASE_... variables are correctly set in your .env.local file or workspace environment settings, and the server is RESTARTED.`);
  } else {
    console.log(`${operationName} All critical Firebase environment variables appear to be present.`);
    try {
      if (getApps().length === 0) {
        console.log(`${operationName} Attempting to initialize Firebase app with Project ID: '${firebaseConfigValues.projectId}' and Storage Bucket: '${firebaseConfigValues.storageBucket}'...`);
        // We cast to 'any' because the Firebase SDK expects all keys to be present,
        // but we've already checked the critical ones. Optional ones like measurementId might be undefined.
        app = initializeApp(firebaseConfigValues as any);
        console.log(`${operationName} Firebase app INITIALIZED successfully. Project ID from app options: ${app.options.projectId}`);
      } else {
        app = getApps()[0];
        console.log(`${operationName} Firebase app ALREADY INITIALIZED (retrieved existing instance). Project ID from app options: ${app.options.projectId}`);
      }

      let dbInitSuccess = false;
      if (app) {
        try {
          console.log(`${operationName} Attempting to initialize Firestore (db)...`);
          db = getFirestore(app);
          console.log(`${operationName} Firestore (db) service instance GET successful.`);
          dbInitSuccess = true;
        } catch (e: any) {
          firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + " " : "") + `Firestore (db) initialization FAILED: ${e.message}. Ensure Cloud Firestore API is enabled and a database instance exists.`;
          console.error(`${operationName} CRITICAL: Error initializing Firestore:`, e.message, e.stack?.substring(0,300));
        }
      } else {
         firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + " " : "") + `Firebase app is null, cannot initialize Firestore.`;
         console.error(`${operationName} CRITICAL: Firebase app is null, cannot initialize Firestore.`);
      }


      let storageInitSuccess = false;
      if (app) {
         if (!firebaseConfigValues.storageBucket || firebaseConfigValues.storageBucket.trim() === '') {
            firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + " " : "") + `Firebase Storage Bucket is not configured (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is missing or empty). Storage cannot be initialized.`;
            console.error(`${operationName} CRITICAL: ${firebaseInitializationError}`);
        } else {
            try {
                console.log(`${operationName} Attempting to initialize Firebase Storage (storage) with bucket: '${firebaseConfigValues.storageBucket}'...`);
                storage = getStorage(app);
                console.log(`${operationName} Firebase Storage (storage) service instance GET successful. Bucket from app options: ${storage.app.options.storageBucket}`);
                storageInitSuccess = true;
            } catch (e: any) {
                firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + " " : "") + `Firebase Storage (storage) initialization FAILED: ${e.message}. Ensure 'storageBucket' in config is correct and Storage service is enabled.`;
                console.error(`${operationName} CRITICAL: Error initializing Firebase Storage:`, e.message, e.stack?.substring(0,300));
            }
        }
      } else {
        firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + " " : "") + `Firebase app is null, cannot initialize Storage.`;
        console.error(`${operationName} CRITICAL: Firebase app is null, cannot initialize Storage.`);
      }


      if (app && dbInitSuccess && storageInitSuccess) {
        firebaseInitializedCorrectly = true;
        console.log(`${operationName} Firebase Core App, Firestore Service, and Storage Service ALL INITIALIZED AND READY.`);
      } else {
        if (!firebaseInitializationError) firebaseInitializationError = "Unknown error: One or more Firebase services are null or failed to initialize after an attempt.";
        console.error(`${operationName} Overall Firebase initialization FAILED. 'firebaseInitializedCorrectly' is FALSE. Error(s): ${firebaseInitializationError}`);
      }

    } catch (e: any) { // Catch errors from initializeApp itself or other unexpected issues
      firebaseInitializationError = (firebaseInitializationError ? firebaseInitializationError + " " : "") + `Firebase app initialization (initializeApp or other critical step) FAILED: ${e.message}.`;
      console.error(`${operationName} CRITICAL: Unhandled exception during Firebase init sequence:`, e.message, e.stack?.substring(0,300));
    }
  }
  console.log(`${operationName} Final Status - firebaseInitializedCorrectly: ${firebaseInitializedCorrectly}`);
  if (firebaseInitializationError && !firebaseInitializedCorrectly) {
    console.error(`${operationName} Summary of Initialization Errors: ${firebaseInitializationError}`);
  }
  console.log("============================================================");
}

export { app, db, storage, firebaseInitializedCorrectly, firebaseInitializationError };

