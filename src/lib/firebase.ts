// src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
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

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  console.log("Firebase initialized.");
} else {
  app = getApps()[0];
  console.log("Firebase app already initialized.");
}

db = getFirestore(app);
storage = getStorage(app);

export { app, db, storage };

// Überprüfen, ob die Umgebungsvariablen geladen wurden
// Diese Logs erscheinen nur serverseitig beim Build oder beim ersten Start
if (typeof window === 'undefined') { // Nur serverseitig loggen
    console.log("[Firebase Init] NEXT_PUBLIC_FIREBASE_PROJECT_ID:", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? "Loaded" : "NOT LOADED");
    if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
        console.error("CRITICAL: Firebase Project ID environment variable is missing. Firebase will not work.");
        console.error("Ensure your .env.local file is correctly set up with NEXT_PUBLIC_FIREBASE_PROJECT_ID and other Firebase config variables.");
    }
}
