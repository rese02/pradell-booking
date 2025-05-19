
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
  const dateFieldsToConvert: (keyof Booking | keyof GuestSubmittedData)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt', 'submittedAt', 'zahlungsdatum', 'geburtsdatum'];

  const processField = (obj: any, field: string) => {
    if (obj && obj[field]) {
      if (obj[field] instanceof Timestamp) {
        obj[field] = obj[field].toDate().toISOString();
      } else if (typeof obj[field] === 'string') {
        // Ensure ISO strings are correctly formatted, especially for dates from guestSubmittedData
        // For YYYY-MM-DD dates, we might not want to convert them to full ISO Timestamps here
        // unless they are meant to be treated as such.
        // For this function's purpose, if it's already a string, we assume it's correctly formatted or handled by consumer.
      }
    }
  };

  dateFieldsToConvert.forEach(field => {
    if (field === 'submittedAt' || field === 'zahlungsdatum' || field === 'geburtsdatum') {
      if (newBookingData.guestSubmittedData) {
        processField(newBookingData.guestSubmittedData, field as string);
      }
    } else {
      processField(newBookingData, field as string);
    }
  });
  return newBookingData;
}

// Helper to convert date strings or Date objects to Firestore Timestamps for saving
function convertDatesToTimestamps(data: any): any {
  const newData = JSON.parse(JSON.stringify(data)); // Deep clone to avoid mutating original
  
  const fieldsToConvertToTimestamp: (keyof Booking | keyof GuestSubmittedData)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt', 'submittedAt'];
  // Fields that are YYYY-MM-DD strings and should remain as such (or handled specifically if conversion is needed)
  // const stringDateFields: (keyof GuestSubmittedData)[] = ['geburtsdatum', 'zahlungsdatum'];


  const processField = (obj: any, field: string) => {
    if (obj && obj[field]) {
      const dateValue = (typeof obj[field] === 'string' || obj[field] instanceof Date) ? new Date(obj[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        obj[field] = Timestamp.fromDate(dateValue);
      } else if (obj[field] instanceof Timestamp) {
        // Already a timestamp, do nothing
      } else {
        console.warn(`[Firestore Helper] Invalid date value for field ${field}: ${obj[field]}. It might be an intentional string date. Keeping as is or removing if problematic.`);
        // Depending on strictness, you might delete obj[field] or ensure it's a valid string date.
        // For now, we assume if it's not convertible, it's either a specific string date or an error already handled.
      }
    }
  };
  
  fieldsToConvertToTimestamp.forEach(field => {
     if (field === 'submittedAt') {
      if (newData.guestSubmittedData) {
        processField(newData.guestSubmittedData, field as string);
      }
    } else {
      processField(newData, field as string);
    }
  });

  // For YYYY-MM-DD fields like 'geburtsdatum' & 'zahlungsdatum', ensure they are strings if present
  // This part depends on how they are intended to be stored. If they are strictly YYYY-MM-DD, no conversion to Timestamp is needed.
  // The current logic primarily handles fields intended to be Timestamps.

  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  const operationName = "[getBookingsFromFirestore]";
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs. Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
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
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes("missing or insufficient permissions")) {
        console.error(`${operationName} Error fetching bookings from Firestore: "Missing or insufficient permissions."`, error);
        throw new Error(`Fehler beim Laden der Buchungen: Fehlende oder unzureichende Berechtigungen für Firestore. Bitte überprüfen Sie Ihre Firebase Firestore Sicherheitsregeln. (Originalfehler: ${error.message})`);
    }
    console.error(`${operationName} Error fetching bookings from Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to fetch bookings: ${error.message}`);
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking | null> {
  const operationName = "[addBookingToFirestore]";
   if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot add booking. Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      createdAt: now, 
      updatedAt: now, 
    });
    console.log(`${operationName} Attempting to add booking to Firestore. Data (partial):`, JSON.stringify(dataToSave, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2).substring(0, 500) + "...");
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    const newBookingDoc = await getDoc(docRef);
    if (newBookingDoc.exists()) {
        return convertTimestampsToISO({ ...newBookingDoc.data(), id: newBookingDoc.id }) as Booking;
    }
    console.warn(`${operationName} Failed to retrieve newly added booking with ID: ${docRef.id}`);
    return null; 
  } catch (error: any) {
    console.error(`${operationName} Error adding booking to Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to add booking: ${error.message}`);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  console.log(`${operationName} Attempting to find booking in Firestore by token: "${token}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Token: "${token}". Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    return null;
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
    return null;
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  console.log(`${operationName} Attempting to find booking in Firestore by ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
     const errorMessage = `${operationName} FATAL: Firestore is not initialized. ID: "${id}". Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    return null;
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
    return null;
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. ID: "${id}". Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const dataToUpdateLog = { ...updates };
    Object.keys(dataToUpdateLog).forEach(key => {
        if ((dataToUpdateLog as any)[key] instanceof File) {
            delete (dataToUpdateLog as any)[key];
        }
        if (key === 'guestSubmittedData' && (dataToUpdateLog as any)[key]) {
            const guestData = (dataToUpdateLog as any)[key];
            Object.keys(guestData).forEach(gKey => {
                 if (guestData[gKey] instanceof File) {
                    delete guestData[gKey];
                }
            });
        }
    });

    console.log(`${operationName} Attempting to update booking in Firestore with ID: "${id}". Updates (partial, pre-conversion, sanitized for log):`, JSON.stringify(dataToUpdateLog, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2).substring(0, 800) + "...");
    
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), 
    });
    
    if (updates.guestSubmittedData) {
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };
            const mergedGuestData = {
                ...currentGuestData,
                ...dataToUpdate.guestSubmittedData, 
            };
            dataToUpdate.guestSubmittedData = mergedGuestData;
            console.log(`${operationName} Merged guestSubmittedData for booking ID "${id}".`);
        } else {
            console.warn(`${operationName} Document with ID ${id} not found for guestSubmittedData merge. Proceeding with direct update of guestSubmittedData.`);
        }
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
    const errorMessage = `${operationName} FATAL: Firebase (Firestore or Storage) is not initialized. Cannot delete bookings. Initialization error: ${firebaseInitializationError || "Unknown (db/storage instance is null or firebaseInitializedCorrectly is false)"}`;
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
                        console.warn(`${operationName} WARN: Failed to delete file ${url} from Storage for booking ${id}: ${fileDeleteError.message} (Code: ${fileDeleteError.code}). Continuing with Firestore deletion.`);
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

    