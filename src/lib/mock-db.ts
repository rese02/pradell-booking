
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
  const dateFieldsToConvert = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];

  dateFieldsToConvert.forEach(field => {
    if (newBookingData[field] instanceof Timestamp) {
      newBookingData[field] = newBookingData[field].toDate().toISOString();
    }
  });

  if (newBookingData.guestSubmittedData) {
    const newGuestData = { ...newBookingData.guestSubmittedData };
    if (newGuestData.submittedAt instanceof Timestamp) {
        newGuestData.submittedAt = newGuestData.submittedAt.toDate().toISOString();
    }
    // geburtsdatum and zahlungsdatum are stored as YYYY-MM-DD strings
    newBookingData.guestSubmittedData = newGuestData;
  }
  return newBookingData;
}

// Helper to convert date strings or Date objects to Firestore Timestamps for saving
function convertDatesToTimestamps(data: any): any {
  const newData = JSON.parse(JSON.stringify(data)); // Deep clone to avoid mutating original
  const dateFieldsToConvert = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  
  dateFieldsToConvert.forEach(field => {
    if (newData[field]) {
      const dateValue = (typeof newData[field] === 'string' || newData[field] instanceof Date) ? new Date(newData[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        newData[field] = Timestamp.fromDate(dateValue);
      } else if (newData[field] instanceof Timestamp) {
        // Already a timestamp, do nothing
      } else {
        console.warn(`[Firestore Helper] Invalid date value for field ${field}: ${newData[field]}. Removing from data to save.`);
        delete newData[field]; 
      }
    }
  });

  if (newData.guestSubmittedData) {
    if (newData.guestSubmittedData.submittedAt) {
       const submittedAtDate = (typeof newData.guestSubmittedData.submittedAt === 'string' || newData.guestSubmittedData.submittedAt instanceof Date) ? new Date(newData.guestSubmittedData.submittedAt) : null;
       if (submittedAtDate && !isNaN(submittedAtDate.getTime())) {
          newData.guestSubmittedData.submittedAt = Timestamp.fromDate(submittedAtDate);
       } else if (newData.guestSubmittedData.submittedAt instanceof Timestamp) {
         // Already a timestamp
       } else {
         console.warn(`[Firestore Helper] Invalid date value for guestSubmittedData.submittedAt: ${newData.guestSubmittedData.submittedAt}. Removing from data to save.`);
         delete newData.guestSubmittedData.submittedAt;
       }
    }
  }
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
    console.log(`${operationName} Attempting to add booking to Firestore. Data (partial):`, JSON.stringify(dataToSave, null, 2).substring(0, 500) + "...");
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    const newBookingDoc = await getDoc(docRef);
    if (newBookingDoc.exists()) {
        return convertTimestampsToISO({ ...newBookingDoc.data(), id: newBookingDoc.id }) as Booking;
    }
    return null; 
  } catch (error: any) {
    console.error(`${operationName} Error adding booking to Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to add booking: ${error.message}`);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  if (!firebaseInitializedCorrectly || !db) {
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Token: "${token}". Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    console.log(`${operationName} Attempting to find booking in Firestore by token: "${token}"`);
    const bookingsCol = collection(db, "bookings");
    const q = query(bookingsCol, where("bookingToken", "==", token));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with token "${token}", ID: ${booking.id}`);
      return booking;
    }
    console.warn(`${operationName} Booking with token "${token}" NOT FOUND in Firestore.`);
    return null;
  } catch (error: any) {
    console.error(`${operationName} Error finding booking by token "${token}" in Firestore:`, error.message, error.stack?.substring(0,500));
    throw new Error(`${operationName} Failed to find booking by token ${token}: ${error.message}`);
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  if (!firebaseInitializedCorrectly || !db) {
     const errorMessage = `${operationName} FATAL: Firestore is not initialized. ID: "${id}". Initialization error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    console.log(`${operationName} Attempting to find booking in Firestore by ID: "${id}"`);
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
    throw new Error(`${operationName} Failed to find booking by ID ${id}: ${error.message}`);
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
    delete (dataToUpdateLog as any).guestSubmittedData?.hauptgastAusweisVorderseiteFile; // Avoid logging File object
    delete (dataToUpdateLog as any).guestSubmittedData?.hauptgastAusweisRückseiteFile;
    delete (dataToUpdateLog as any).guestSubmittedData?.zahlungsbelegFile;
    console.log(`${operationName} Attempting to update booking in Firestore with ID: "${id}". Updates (partial, pre-conversion):`, JSON.stringify(dataToUpdateLog, null, 2).substring(0, 500) + "...");
    
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), 
    });
    
    if (updates.guestSubmittedData) {
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data();
            const mergedGuestData = {
                ...(currentBookingData.guestSubmittedData || {}),
                ...dataToUpdate.guestSubmittedData,
            };
            dataToUpdate.guestSubmittedData = mergedGuestData;
        } else {
            console.warn(`${operationName} Document with ID ${id} not found for guestSubmittedData merge. Proceeding with direct update.`);
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
          const urlsToDelete: (string | undefined)[] = [
              bookingToDelete.guestSubmittedData.hauptgastAusweisVorderseiteUrl,
              bookingToDelete.guestSubmittedData.hauptgastAusweisRückseiteUrl,
              bookingToDelete.guestSubmittedData.zahlungsbelegUrl,
          ];
          for (const url of urlsToDelete) {
              if (url && url.includes('firebasestorage.googleapis.com')) {
                  try {
                      const fileStorageRef = storageRefFB(storage, url);
                      await deleteObject(fileStorageRef);
                      console.log(`${operationName} File ${url} deleted from Firebase Storage.`);
                  } catch (fileDeleteError: any) {
                      console.warn(`${operationName} WARN: Failed to delete file ${url} from Storage: ${fileDeleteError.message} (Code: ${fileDeleteError.code}). Continuing with Firestore deletion.`);
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
