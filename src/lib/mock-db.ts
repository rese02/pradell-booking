
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
  deleteDoc,
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
    
    if (newBookingData.guestSubmittedData.mitreisende && Array.isArray(newBookingData.guestSubmittedData.mitreisende)) {
        newBookingData.guestSubmittedData.mitreisende.forEach((mitreisender: any) => {
            // Assuming mitreisende might have date fields in the future, none are currently defined in Mitreisender interface.
            // Example: processField(mitreisender, 'geburtstagMitreisender');
        });
    }
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

     if (newData.guestSubmittedData.mitreisende && Array.isArray(newData.guestSubmittedData.mitreisende)) {
        newData.guestSubmittedData.mitreisende.forEach((mitreisender: any) => {
            // Example: processField(mitreisender, 'geburtstagMitreisender');
        });
    }
  }
  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  const operationName = "[getBookingsFromFirestore]";
  console.log(`${operationName} Attempting to fetch bookings...`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs. Detail: ${errorDetail}`);
    throw new Error(`FATAL: Firestore is not initialized. Cannot fetch bookings. Detail: ${errorDetail}`);
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
    console.error(baseErrorMsg, error.stack?.substring(0, 500));
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
    throw new Error(`FATAL: Firestore is not initialized. Cannot add booking. Detail: ${errorDetail}`);
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      guestSubmittedData: bookingData.guestSubmittedData || { lastCompletedStep: -1 }, // Ensure guestSubmittedData exists
      createdAt: now, // Set by server
      updatedAt: now, // Set by server
    });
    console.log(`${operationName} Adding booking to Firestore. Collection: "bookings". Data (partial):`, { guest: dataToSave.guestFirstName, token: dataToSave.bookingToken, price: dataToSave.price });
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    return docRef.id;
  } catch (error: any) {
    console.error(`${operationName} Error adding booking to Firestore: "${error.message}"`, error.stack?.substring(0, 500));
    throw new Error(`Failed to add booking: ${error.message}`);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  console.log(`${operationName} Attempting to find booking by token: "${token}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot find booking. Token: "${token}". Detail: ${errorDetail}`);
    throw new Error(`FATAL: Firestore is not initialized. Cannot find booking by token. Detail: ${errorDetail}`);
  }
  const collectionName = "bookings";
  const fieldNameToQuery = "bookingToken";
  console.log(`${operationName} Querying collection "${collectionName}" for field "${fieldNameToQuery}" == "${token}"`);

  try {
    const bookingsCol = collection(db, collectionName);
    const q = query(bookingsCol, where(fieldNameToQuery, "==", token));
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
    console.error(`${operationName} Error finding booking by token "${token}" in Firestore: "${error.message}" (Code: ${(error as any).code})`, error.stack?.substring(0, 500));
    // Do not re-throw an overly generic error here, let the page handle the null return.
    // If it's a permission error, it will be logged.
    return null;
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  console.log(`${operationName} Attempting to find booking by ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
     const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID. ID: "${id}". Detail: ${errorDetail}`);
    throw new Error(`FATAL: Firestore is not initialized. Cannot find booking by ID. Detail: ${errorDetail}`);
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
    console.error(`${operationName} Error finding booking by ID "${id}" in Firestore: "${error.message}" (Code: ${(error as any).code})`, error.stack?.substring(0, 500));
    return null;
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  console.log(`${operationName} Attempting to update booking with ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    console.error(`${operationName} FATAL: Firestore is not initialized. Cannot update booking. ID: "${id}". Detail: ${errorDetail}`);
    throw new Error(`FATAL: Firestore is not initialized. Cannot update booking. Detail: ${errorDetail}`);
  }
  try {
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), 
    });
    
    if (updates.guestSubmittedData) {
        console.log(`${operationName} guestSubmittedData is part of updates for booking ID "${id}". Merging...`);
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };
            
            const newGuestDataUpdates = typeof dataToUpdate.guestSubmittedData === 'object' && dataToUpdate.guestSubmittedData !== null
                ? dataToUpdate.guestSubmittedData
                : {};

            // Ensure mitreisende array is handled correctly during merge
            let mergedMitreisende = currentGuestData.mitreisende || [];
            if (newGuestDataUpdates.mitreisende) {
                // Simple overwrite for now, can be made more sophisticated (e.g., merge by ID) if needed
                mergedMitreisende = newGuestDataUpdates.mitreisende;
            }

            const mergedGuestData = {
                ...currentGuestData,
                ...newGuestDataUpdates,
                mitreisende: mergedMitreisende, // Use the merged/updated mitreisende array
            };
            dataToUpdate.guestSubmittedData = mergedGuestData;
            console.log(`${operationName} Smart-merged guestSubmittedData for booking ID "${id}". Last completed step: ${mergedGuestData.lastCompletedStep}, Mitreisende count: ${mergedGuestData.mitreisende?.length || 0}`);
        } else {
            console.warn(`${operationName} Document with ID ${id} not found for guestSubmittedData merge. Proceeding with direct update of guestSubmittedData as provided.`);
        }
    }

    console.log(`${operationName} Updating document in Firestore. Path: ${docRef.path}. Update keys (top-level): ${Object.keys(dataToUpdate).join(', ')}`);
    await updateDoc(docRef, dataToUpdate);
    console.log(`${operationName} Booking with ID "${id}" updated successfully in Firestore.`);
    return true;
  } catch (error: any) {
    console.error(`${operationName} Error updating booking with ID "${id}" in Firestore: "${error.message}" (Code: ${(error as any).code})`, error.stack?.substring(0, 500));
    throw new Error(`Failed to update booking ${id}: ${error.message}`);
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<{ success: boolean; message: string }> {
  const operationName = "[deleteBookingsFromFirestoreByIds]";
  console.log(`${operationName} Attempting to delete ${ids.length} bookings from Firestore. IDs: ${ids.join(', ')}`);

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorDetail = firebaseInitializationError || "DB/Storage instance is null or firebaseInitializedCorrectly is false.";
    const errorMsg = `${operationName} FATAL: Firebase (Firestore or Storage) is not initialized. Detail: ${errorDetail}`;
    console.error(errorMsg);
    return { success: false, message: errorMsg };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    console.warn(`${operationName} No valid IDs provided for deletion.`);
    return { success: true, message: "Keine IDs zum Löschen angegeben." };
  }

  const batch = writeBatch(db);
  const filesToDeletePromises: Promise<void>[] = [];
  let successfulFirestoreDeletes = 0;
  let failedProcessingCount = 0;

  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      console.warn(`${operationName} Skipping invalid ID for deletion: "${id}"`);
      failedProcessingCount++;
      continue;
    }

    const docRef = doc(db, "bookings", id);
    try {
      console.log(`${operationName} [ID: ${id}] Fetching booking to identify associated files for deletion...`);
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
        
        console.log(`${operationName} [ID: ${id}] Found ${urlsToDelete.length} potential file URLs to delete.`);

        for (const url of urlsToDelete) {
          if (url && typeof url === 'string' && url.startsWith('https://firebasestorage.googleapis.com')) {
            const fileRefPromise = (async () => {
              try {
                console.log(`${operationName} [ID: ${id}] Attempting to delete file from Storage: ${url.substring(url.lastIndexOf('/') + 1)}`);
                const fileStorageRefHandle = storageRefFB(storage, url);
                await deleteObject(fileStorageRefHandle);
                console.log(`${operationName} [ID: ${id}] File ${url.substring(url.lastIndexOf('/') + 1)} deleted successfully from Storage.`);
              } catch (fileDeleteError: any) {
                if (fileDeleteError?.code === 'storage/object-not-found') {
                  console.warn(`${operationName} [ID: ${id}] WARN: File not found in Storage, skipping deletion: ${url.substring(url.lastIndexOf('/') + 1)}. Error: ${fileDeleteError.message}`);
                } else {
                  console.error(`${operationName} [ID: ${id}] ERROR: Failed to delete file ${url.substring(url.lastIndexOf('/') + 1)} from Storage: ${fileDeleteError.message} (Code: ${fileDeleteError?.code}). Continuing...`, fileDeleteError.stack?.substring(0,300));
                }
              }
            })();
            filesToDeletePromises.push(fileRefPromise);
          }
        }
        batch.delete(docRef);
        console.log(`${operationName} [ID: ${id}] Firestore document added to batch delete.`);
        successfulFirestoreDeletes++;
      } else {
        console.warn(`${operationName} [ID: ${id}] Booking document not found. Cannot delete or process associated files.`);
        failedProcessingCount++;
      }
    } catch (loopError: any) {
      console.error(`${operationName} [ID: ${id}] Error processing for deletion: ${loopError.message}. This ID will be skipped in the batch.`, { stack: loopError.stack?.substring(0, 300) });
      failedProcessingCount++;
    }
  }

  try {
    if (filesToDeletePromises.length > 0) {
        console.log(`${operationName} Waiting for ${filesToDeletePromises.length} file deletion promises to settle...`);
        await Promise.allSettled(filesToDeletePromises); 
        console.log(`${operationName} All file deletion attempts completed.`);
    }

    if (successfulFirestoreDeletes > 0) {
        console.log(`${operationName} Committing batch delete for ${successfulFirestoreDeletes} Firestore documents.`);
        await batch.commit();
        console.log(`${operationName} Batch commit successful for deletion of ${successfulFirestoreDeletes} booking(s).`);
        let message = `${successfulFirestoreDeletes} Buchung(en) erfolgreich gelöscht.`;
        if (failedProcessingCount > 0) {
            message += ` ${failedProcessingCount} Buchung(en) konnten nicht gefunden oder verarbeitet werden.`;
        }
        return { success: true, message };
    } else if (failedProcessingCount > 0) {
         console.warn(`${operationName} No bookings were successfully processed for Firestore deletion, and ${failedProcessingCount} failures occurred during processing.`);
         return { success: false, message: `Keine der ausgewählten Buchungen konnte aus Firestore gelöscht werden. ${failedProcessingCount} Fehler beim Verarbeiten der IDs.` };
    } else {
        console.log(`${operationName} No bookings were selected or processed for deletion (no valid IDs found or no documents existed).`);
        return { success: true, message: "Keine Buchungen zum Löschen ausgewählt oder verarbeitet." };
    }

  } catch (error: any) // Catches errors from Promise.allSettled (unlikely) or batch.commit()
  {
     console.error(`${operationName} Error during final file deletion processing or Firestore batch commit. IDs: ${ids.join(', ')}. Error: "${error.message}" (Code: ${(error as any).code})`, error.stack?.substring(0,500));
     return { success: false, message: `Fehler beim Löschen der Buchungen oder zugehöriger Dateien aus Firestore: ${error.message}` };
  }
}
