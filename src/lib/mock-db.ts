
// This file now handles Firestore operations.
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { db, firebaseInitializedCorrectly, storage, firebaseInitializationError } from "./firebase"; 
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { ref as storageRefFB, deleteObject } from "firebase/storage";

// Helper to convert Firestore Timestamps to ISO strings in booking objects
function convertTimestampsToISO(bookingData: any): any {
  if (!bookingData) return null;
  const newBookingData = { ...bookingData };
  
  // Fields directly in Booking
  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => {
    if (newBookingData[field] && newBookingData[field] instanceof Timestamp) {
      newBookingData[field] = newBookingData[field].toDate().toISOString();
    }
  });

  // Fields in GuestSubmittedData
  if (newBookingData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => {
      if (newBookingData.guestSubmittedData[field] && newBookingData.guestSubmittedData[field] instanceof Timestamp) {
        newBookingData.guestSubmittedData[field] = newBookingData.guestSubmittedData[field].toDate().toISOString();
      }
    });
  }
  return newBookingData;
}

// Helper to convert date strings or Date objects to Firestore Timestamps for saving
function convertDatesToTimestamps(data: any): any {
  if (!data) return data;
  const newData = JSON.parse(JSON.stringify(data)); // Deep clone
  
  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined') { // Check if field exists
      if (obj[field] instanceof Timestamp) { // Already a timestamp
        return; 
      }
      const dateValue = (typeof obj[field] === 'string' || obj[field] instanceof Date) ? new Date(obj[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        obj[field] = Timestamp.fromDate(dateValue);
      } else if (obj[field] !== null && obj[field] !== '') { // Avoid converting empty strings or null to invalid Timestamps
        console.warn(`[Firestore Helper] Invalid or unhandled date value for field ${field}:`, obj[field], ". Keeping as is or consider removing if problematic.");
      } else if (obj[field] === '' || obj[field] === null) { // Remove if empty or null and meant to be a Timestamp
         delete obj[field]; 
      }
    }
  };
  
  // Fields in Booking
  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newData, field as string));

  // Fields in GuestSubmittedData
  if (newData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => processField(newData.guestSubmittedData, field as string));
  }
  
  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  const operationName = "[getBookingsFromFirestore]";
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs. Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage); 
  }
  try {
    console.log(`${operationName} Attempting to fetch bookings from Firestore...`);
    const bookingsCol = collection(db, "bookings");
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc"));
    const bookingSnapshot = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    console.log(`${operationName} Successfully fetched ${bookingList.length} bookings.`);
    return bookingList;
  } catch (error: any) {
    const errorMessageText = error.message.toLowerCase();
    if (errorMessageText.includes("missing or insufficient permissions")) {
        console.error(`${operationName} Error fetching bookings from Firestore: "Missing or insufficient permissions."`, error);
        throw new Error(`Fehler beim Laden der Buchungen: Fehlende oder unzureichende Berechtigungen für Firestore. Bitte überprüfen Sie Ihre Firebase Firestore Sicherheitsregeln. (Originalfehler: ${error.message})`);
    }
    console.error(`${operationName} Error fetching bookings from Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to fetch bookings: ${error.message}`);
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  const operationName = "[addBookingToFirestore]";
   if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot add booking. Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      guestSubmittedData: bookingData.guestSubmittedData || { lastCompletedStep: -1 }, // Ensure guestSubmittedData exists
      createdAt: now, 
      updatedAt: now, 
    });
    console.log(`${operationName} Attempting to add booking to Firestore. Data (partial):`, JSON.stringify(dataToSave, null, 2).substring(0, 500) + "...");
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    return docRef.id;
  } catch (error: any) {
    console.error(`${operationName} Error adding booking to Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to add booking: ${error.message}`);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  console.log(`${operationName} Attempting to find booking in Firestore by token: "${token}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Token: "${token}". Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    // throw new Error(errorMessage); // Throwing error to be caught by page component
    return null; // Or throw to be caught by the page
  }
  try {
    const bookingsCol = collection(db, "bookings");
    const q = query(bookingsCol, where("bookingToken", "==", token));
    console.log(`${operationName} Executing Firestore query for token: "${token}" with path: ${bookingsCol.path}`);
    const querySnapshot = await getDocs(q);
    console.log(`${operationName} Query for token "${token}" executed. Found ${querySnapshot.size} documents.`);

    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with token "${token}", ID: ${booking.id}, Status: ${booking.status}`);
      return booking;
    }
    console.warn(`${operationName} Booking with token "${token}" NOT FOUND in Firestore (querySnapshot empty).`);
    return null;
  } catch (error: any) {
    console.error(`${operationName} Error finding booking by token "${token}" in Firestore:`, error.message, error.stack?.substring(0,800));
    // throw new Error(`${operationName} Failed to find booking by token "${token}": ${error.message}`);
    return null; // Or throw to be caught by the page
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  console.log(`${operationName} Attempting to find booking in Firestore by ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
     const errorMessage = `${operationName} FATAL: Firestore is not initialized. ID: "${id}". Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const docRef = doc(db, "bookings", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with ID "${id}"`);
      return booking;
    }
    console.warn(`${operationName} Booking with ID "${id}" NOT FOUND in Firestore.`);
    return null;
  } catch (error: any) {
    console.error(`${operationName} Error finding booking by ID "${id}" in Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to find booking by ID "${id}": ${error.message}`);
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. ID: "${id}". Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const dataToUpdateLog = { ...updates };
    // Sanitize log by removing File objects if any were accidentally passed
    Object.keys(dataToUpdateLog).forEach(key => {
        if ((dataToUpdateLog as any)[key] instanceof File) {
            delete (dataToUpdateLog as any)[key];
        }
        if (key === 'guestSubmittedData' && typeof (dataToUpdateLog as any)[key] === 'object' && (dataToUpdateLog as any)[key] !== null) {
            const guestData = (dataToUpdateLog as any)[key];
            Object.keys(guestData).forEach(gKey => {
                 if (guestData[gKey] instanceof File) { // Should not happen with current logic but good for safety
                    delete guestData[gKey];
                }
            });
        }
    });

    console.log(`${operationName} Attempting to update booking in Firestore with ID: "${id}". Updates (partial, pre-conversion, sanitized for log):`, JSON.stringify(dataToUpdateLog, null, 2).substring(0, 800) + "...");
    
    const docRef = doc(db, "bookings", id);
    
    // Ensure updatedAt is always set
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), 
    });
    
    // Smart merging of guestSubmittedData if it's part of the updates
    if (updates.guestSubmittedData) {
        console.log(`${operationName} guestSubmittedData is part of updates for booking ID "${id}". Attempting merge.`);
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };
            
            // Ensure timestamps from currentGuestData are converted before merge if they are Timestamps
            const normalizedCurrentGuestData = convertTimestampsToISO({ ...currentGuestData });

            const mergedGuestData = {
                ...normalizedCurrentGuestData, // Existing data (potentially with ISO string dates)
                ...dataToUpdate.guestSubmittedData, // New data (dates already converted to Timestamps by convertDatesToTimestamps)
            };
            dataToUpdate.guestSubmittedData = mergedGuestData;
            console.log(`${operationName} Merged guestSubmittedData for booking ID "${id}".`);
        } else {
            console.warn(`${operationName} Document with ID ${id} not found for guestSubmittedData merge. Proceeding with direct update of guestSubmittedData as provided.`);
        }
    } else {
        console.log(`${operationName} guestSubmittedData is NOT part of updates for booking ID "${id}".`);
    }
    
    await updateDoc(docRef, dataToUpdate);
    console.log(`${operationName} Booking with ID "${id}" updated successfully in Firestore.`);
    return true;
  } catch (error: any) {
    console.error(`${operationName} Error updating booking with ID "${id}" in Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to update booking ${id}: ${error.message}`);
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<boolean> {
  const operationName = "[deleteBookingsFromFirestoreByIds]";
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMessage = `${operationName} FATAL: Firebase (Firestore or Storage) is not initialized. Cannot delete bookings. Init error: ${firebaseInitializationError || "Unknown (db/storage instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  if (!ids || ids.length === 0) {
    console.warn(`${operationName} No IDs provided for deletion.`);
    return true; 
  }

  try {
    console.log(`${operationName} Attempting to delete ${ids.length} bookings from Firestore: ${ids.join(', ')}`);
    const batch = writeBatch(db);

    for (const id of ids) {
      const bookingToDelete = await findBookingByIdFromFirestore(id); 
      if (bookingToDelete?.guestSubmittedData) {
          const guestData = bookingToDelete.guestSubmittedData;
          const urlsToDelete: (string | undefined)[] = [
              guestData.hauptgastAusweisVorderseiteUrl,
              guestData.hauptgastAusweisRückseiteUrl,
              guestData.zahlungsbelegUrl,
          ];
          if (guestData.mitreisende) {
            guestData.mitreisende.forEach(mitreisender => {
                urlsToDelete.push(mitreisender.ausweisVorderseiteUrl);
                urlsToDelete.push(mitreisender.ausweisRückseiteUrl);
            });
          }

          for (const url of urlsToDelete) {
              if (url && typeof url === 'string' && url.includes('firebasestorage.googleapis.com')) {
                  try {
                      const fileStorageRef = storageRefFB(storage, url); 
                      await deleteObject(fileStorageRef);
                      console.log(`${operationName} File ${url} deleted from Firebase Storage for booking ${id}.`);
                  } catch (fileDeleteError: any) {
                      if (fileDeleteError.code === 'storage/object-not-found') {
                        console.warn(`${operationName} WARN: File ${url} for booking ${id} not found in Storage, skipping deletion: ${fileDeleteError.message}`);
                      } else {
                        console.error(`${operationName} ERROR: Failed to delete file ${url} from Storage for booking ${id}: ${fileDeleteError.message} (Code: ${fileDeleteError.code}). Continuing with Firestore deletion.`, fileDeleteError);
                        // Decide if this should make the whole operation fail. For now, it continues.
                      }
                  }
              }
          }
      }
      const docRef = doc(db, "bookings", id);
      batch.delete(docRef);
    }
    await batch.commit();
    console.log(`${operationName} Successfully deleted ${ids.length} booking(s) from Firestore.`);
    return true;
  } catch (error: any) {
    console.error(`${operationName} Error deleting bookings from Firestore: ${ids.join(', ')}`, error.message, error.stack?.substring(0,500));
     throw new Error(`${operationName} Failed to delete bookings: ${error.message}`);
  }
}
