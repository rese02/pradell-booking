
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
  query,
  where,
  Timestamp,
  orderBy,
  writeBatch,
  deleteDoc, // Import deleteDoc for single document deletion if needed, though batch is preferred for multiple
} from "firebase/firestore";
import { ref as storageRefFB, deleteObject } from "firebase/storage";

// Helper to convert Firestore Timestamps to ISO strings in booking objects
function convertTimestampsToISO(bookingData: any): any {
  if (!bookingData) return null;
  const newBookingData: any = JSON.parse(JSON.stringify(bookingData)); // Deep copy

  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
        if (obj[field] instanceof Timestamp) {
            obj[field] = obj[field].toDate().toISOString();
        } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
            // This handles cases where Timestamp might be serialized from server actions
            obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
        } else if (obj[field] instanceof Date) {
             obj[field] = obj[field].toISOString();
        }
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newBookingData, field as string));

  if (newBookingData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => processField(newBookingData.guestSubmittedData, field as string));
  }
  return newBookingData;
}

// Helper to convert date strings or Date objects to Firestore Timestamps for saving
function convertDatesToTimestamps(data: any): any {
  if (!data) return data;
  const newData: any = JSON.parse(JSON.stringify(data)); // Deep copy to avoid mutating original

  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
      if (obj[field] instanceof Timestamp) {
        return; // Already a Timestamp
      }
      const dateValue = (typeof obj[field] === 'string' || obj[field] instanceof Date) ? new Date(obj[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        obj[field] = Timestamp.fromDate(dateValue);
      } else if (obj[field] !== null && obj[field] !== '') {
        // console.warn(`[Firestore Helper] Invalid or unhandled date value for field ${field}:`, obj[field], ". Kept as is for Firestore, might cause issues if not a Date, ISO string or Timestamp.");
      } else if (obj[field] === '' || obj[field] === null) {
         delete obj[field]; // Remove empty or null fields to keep Firestore clean
      }
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newData, field as string));

  if (newData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => processField(newData.guestSubmittedData, field as string));
  }
  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  const operationName = "[getBookingsFromFirestore]";
  console.log(`${operationName} Attempting to fetch bookings...`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs. Detail: ${errorDetail}`);
    throw new Error(`${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs.`);
  }
  try {
    const bookingsCol = collection(db, "bookings");
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc"));
    console.log(`${operationName} Executing Firestore query on path: ${bookingsCol.path}`);
    const bookingSnapshot = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    console.log(`${operationName} Successfully fetched ${bookingList.length} bookings.`);
    return bookingList;
  } catch (error: any) {
    const baseErrorMsg = `${operationName} Error fetching bookings from Firestore: "${error.message}"`;
    console.error(baseErrorMsg, error.stack);
    if ((error as any).code === 'permission-denied' || error.message.toLowerCase().includes("missing or insufficient permissions")) {
        const permissionErrorMsg = `${baseErrorMsg} "FirebaseError: Missing or insufficient permissions." Check Firebase Firestore security rules.`;
        console.error(permissionErrorMsg);
        throw new Error(permissionErrorMsg);
    } else if (error.message.toLowerCase().includes("query requires an index")) {
        const indexErrorMsg = `${baseErrorMsg} Query requires an index. Firestore may suggest creating one in the Firebase Console or server logs.`;
        console.error(indexErrorMsg);
        throw new Error(indexErrorMsg);
    }
    throw new Error(baseErrorMsg);
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  const operationName = "[addBookingToFirestore]";
  console.log(`${operationName} Attempting to add booking...`);
   if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot add booking. Detail: ${errorDetail}`);
    throw new Error(`${operationName} FATAL: Firestore is not initialized. Cannot add booking.`);
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      guestSubmittedData: bookingData.guestSubmittedData || { lastCompletedStep: -1 }, // Ensure guestSubmittedData exists
      createdAt: now, // Set by server
      updatedAt: now, // Set by server
    });
    console.log(`${operationName} Adding booking to Firestore. Data (partial):`, { guest: dataToSave.guestFirstName, token: dataToSave.bookingToken, price: dataToSave.price });
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    return docRef.id;
  } catch (error: any) {
    console.error(`${operationName} Error adding booking to Firestore: "${error.message}"`, error.stack);
    throw new Error(`${operationName} Failed to add booking: ${error.message}`);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  console.log(`${operationName} Attempting to find booking by token: "${token}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot find booking. Token: "${token}". Detail: ${errorDetail}`);
    throw new Error(`${operationName} FATAL: Firestore is not initialized. Cannot find booking by token.`);
  }
  try {
    const bookingsCol = collection(db, "bookings");
    const q = query(bookingsCol, where("bookingToken", "==", token));
    console.log(`${operationName} Executing Firestore query for token: "${token}" on path: ${bookingsCol.path}`);
    const querySnapshot = await getDocs(q);
    console.log(`${operationName} Query for token "${token}" executed. Found ${querySnapshot.size} documents.`);

    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with token "${token}", ID: ${booking.id}, Status: ${booking.status}`);
      return booking;
    }
    console.warn(`${operationName} Booking with token "${token}" NOT FOUND in Firestore.`);
    return null;
  } catch (error: any) {
    console.error(`${operationName} Error finding booking by token "${token}" in Firestore: "${error.message}"`, error.stack);
    throw new Error(`${operationName} Failed to find booking by token "${token}": ${error.message}`);
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  console.log(`${operationName} Attempting to find booking by ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
     const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID. ID: "${id}". Detail: ${errorDetail}`);
    throw new Error(`${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID.`);
  }
  try {
    if (typeof id !== 'string' || id.trim() === '') {
        console.warn(`${operationName} Invalid ID provided: "${id}". Returning null.`);
        return null;
    }
    const docRef = doc(db, "bookings", id);
    console.log(`${operationName} Getting document from Firestore with path: ${docRef.path}`);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with ID "${id}"`);
      return booking;
    }
    console.warn(`${operationName} Booking with ID "${id}" NOT FOUND in Firestore.`);
    return null;
  } catch (error: any) {
    console.error(`${operationName} Error finding booking by ID "${id}" in Firestore: "${error.message}"`, error.stack);
    throw new Error(`${operationName} Failed to find booking by ID "${id}": ${error.message}`);
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  console.log(`${operationName} Attempting to update booking with ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot update booking. ID: "${id}". Detail: ${errorDetail}`);
    throw new Error(`${operationName} FATAL: Firestore is not initialized. Cannot update booking.`);
  }
  try {
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), // Always update 'updatedAt' timestamp
    });
    
    // Smart merging for guestSubmittedData if it's part of the updates
    if (updates.guestSubmittedData) {
        console.log(`${operationName} guestSubmittedData is part of updates for booking ID "${id}".`);
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };
            
            const newGuestDataUpdates = typeof dataToUpdate.guestSubmittedData === 'object' && dataToUpdate.guestSubmittedData !== null
                ? dataToUpdate.guestSubmittedData
                : {};

            const mergedGuestData = {
                ...currentGuestData,
                ...newGuestDataUpdates,
            };
            dataToUpdate.guestSubmittedData = mergedGuestData;
            console.log(`${operationName} Smart-merged guestSubmittedData for booking ID "${id}". Last completed step in merge: ${mergedGuestData.lastCompletedStep}`);
        } else {
            console.warn(`${operationName} Document with ID ${id} not found for guestSubmittedData merge. Proceeding with direct update of guestSubmittedData as provided.`);
        }
    }

    console.log(`${operationName} Updating document in Firestore with path: ${docRef.path}. Update keys: ${Object.keys(dataToUpdate).join(', ')}`);
    await updateDoc(docRef, dataToUpdate);
    console.log(`${operationName} Booking with ID "${id}" updated successfully in Firestore.`);
    return true;
  } catch (error: any) {
    console.error(`${operationName} Error updating booking with ID "${id}" in Firestore: "${error.message}"`, error.stack);
    throw new Error(`${operationName} Failed to update booking ${id}: ${error.message}`);
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<{ success: boolean; message: string }> {
  const operationName = "[deleteBookingsFromFirestoreByIds]";
  console.log(`${operationName} Attempting to delete ${ids.length} bookings. IDs: ${ids.join(', ')}`);

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorDetail = firebaseInitializationError || "DB/Storage instance is null or firebaseInitializedCorrectly is false.";
    const errorMsg = `${operationName} FATAL: Firebase (Firestore or Storage) is not initialized. Cannot delete bookings. Detail: ${errorDetail}`;
    console.error(errorMsg);
    return { success: false, message: errorMsg };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    console.warn(`${operationName} No valid IDs provided for deletion.`);
    return { success: true, message: "Keine IDs zum Löschen angegeben." }; // No error, but nothing to do
  }

  const batch = writeBatch(db);
  const filesToDeletePromises: Promise<void>[] = [];
  let successfulDeletes = 0;
  let failedDeletes = 0;

  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      console.warn(`${operationName} Skipping invalid ID for deletion: "${id}"`);
      failedDeletes++;
      continue;
    }

    const docRef = doc(db, "bookings", id);
    try {
      console.log(`${operationName} Fetching booking ${id} to identify associated files for deletion...`);
      const bookingToDeleteSnap = await getDoc(docRef);

      if (bookingToDeleteSnap.exists()) {
        const bookingToDelete = bookingToDeleteSnap.data() as Booking;
        const urlsToDelete: string[] = [];

        if (bookingToDelete?.guestSubmittedData) {
          const { guestSubmittedData } = bookingToDelete;
          if (guestSubmittedData.hauptgastAusweisVorderseiteUrl) urlsToDelete.push(guestSubmittedData.hauptgastAusweisVorderseiteUrl);
          if (guestSubmittedData.hauptgastAusweisRückseiteUrl) urlsToDelete.push(guestSubmittedData.hauptgastAusweisRückseiteUrl);
          if (guestSubmittedData.zahlungsbelegUrl) urlsToDelete.push(guestSubmittedData.zahlungsbelegUrl);

          if (guestSubmittedData.mitreisende && Array.isArray(guestSubmittedData.mitreisende)) {
            guestSubmittedData.mitreisende.forEach(mitreisender => {
              if (mitreisender?.ausweisVorderseiteUrl) urlsToDelete.push(mitreisender.ausweisVorderseiteUrl);
              if (mitreisender?.ausweisRückseiteUrl) urlsToDelete.push(mitreisender.ausweisRückseiteUrl);
            });
          }
        }
        
        console.log(`${operationName} For booking ${id}, found ${urlsToDelete.length} potential file URLs to delete.`);

        for (const url of urlsToDelete) {
          if (url && typeof url === 'string' && url.startsWith('https://firebasestorage.googleapis.com')) {
            const fileRefPromise = (async () => {
              try {
                console.log(`${operationName} Attempting to delete file from Storage: ${url} for booking ${id}.`);
                const fileStorageRefHandle = storageRefFB(storage!, url); // Use storage! as we've checked it
                await deleteObject(fileStorageRefHandle);
                console.log(`${operationName} File ${url} deleted successfully from Storage for booking ${id}.`);
              } catch (fileDeleteError: any) {
                if (fileDeleteError?.code === 'storage/object-not-found') {
                  console.warn(`${operationName} WARN: File for booking ${id} not found in Storage, skipping deletion: ${url}. Error: ${fileDeleteError.message}`);
                } else {
                  console.error(`${operationName} ERROR: Failed to delete file ${url} from Storage for booking ${id}: ${fileDeleteError.message} (Code: ${fileDeleteError?.code}). Continuing...`, fileDeleteError.stack);
                  // Optionally, you might want to stop the whole process or collect these errors
                }
              }
            })();
            filesToDeletePromises.push(fileRefPromise);
          }
        }
        batch.delete(docRef);
        console.log(`${operationName} Firestore document ID ${id} added to batch delete.`);
        successfulDeletes++;
      } else {
        console.warn(`${operationName} Booking document with ID ${id} not found. Cannot delete or process associated files.`);
        failedDeletes++;
      }
    } catch (loopError: any) {
      console.error(`${operationName} Error processing ID "${id}" for deletion: ${loopError.message}. This ID will be skipped in the batch.`, { stack: loopError.stack?.substring(0, 300), bookingId: id });
      failedDeletes++;
    }
  }

  try {
    console.log(`${operationName} Waiting for ${filesToDeletePromises.length} file deletion promises to settle...`);
    await Promise.allSettled(filesToDeletePromises); // Wait for all file deletions to attempt (settle)
    console.log(`${operationName} All file deletion attempts completed.`);

    if (successfulDeletes > 0) {
        console.log(`${operationName} Committing batch delete for ${successfulDeletes} Firestore documents.`);
        await batch.commit();
        console.log(`${operationName} Batch commit successful for deletion of ${successfulDeletes} booking(s).`);
        let message = `${successfulDeletes} Buchung(en) erfolgreich gelöscht.`;
        if (failedDeletes > 0) {
            message += ` ${failedDeletes} Buchung(en) konnten nicht gefunden oder verarbeitet werden.`;
        }
        return { success: true, message };
    } else if (failedDeletes > 0) {
         console.warn(`${operationName} No bookings were successfully processed for deletion, but ${failedDeletes} failures occurred.`);
         return { success: false, message: `Keine der ausgewählten Buchungen konnte gelöscht werden. ${failedDeletes} Fehler beim Verarbeiten der IDs.` };
    } else {
        console.log(`${operationName} No bookings were selected or processed for deletion.`);
        return { success: true, message: "Keine Buchungen zum Löschen ausgewählt oder verarbeitet." };
    }

  } catch (error: any) {
     console.error(`${operationName} Error during final file deletion processing or batch commit for IDs: ${ids.join(', ')}. Error: "${error.message}"`, error.stack);
     return { success: false, message: `${operationName} Fehler beim Löschen der Buchungen oder zugehöriger Dateien: ${error.message}` };
  }
}
