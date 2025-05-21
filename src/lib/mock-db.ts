
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
  type DocumentData,
  type QuerySnapshot,
  type DocumentSnapshot,
} from "firebase/firestore";
import { ref as storageRefFB, deleteObject } from "firebase/storage";

// Helper to convert Firestore Timestamps to ISO strings in booking objects
function convertTimestampsToISO(bookingData: any): any {
  if (!bookingData) return null;
  
  // Ensure no circular references if bookingData is complex
  let newBookingData: any;
  try {
    newBookingData = JSON.parse(JSON.stringify(bookingData)); // Deep copy
  } catch (e) {
    console.error("[convertTimestampsToISO] Error deep cloning bookingData, potential circular reference or non-serializable data:", e);
    return bookingData; // Return original if cloning fails, to avoid crash
  }


  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
        if (obj[field] instanceof Timestamp) {
            obj[field] = obj[field].toDate().toISOString();
        } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
            // This handles cases where Timestamps might have been stringified and parsed back
            // or come from a non-Firestore source in a compatible format.
            try {
                obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
            } catch (tsError) {
                console.warn(`[convertTimestampsToISO] Error converting pseudo-Timestamp object for field ${field}:`, tsError, obj[field]);
                // Keep original value if conversion fails
            }
        } else if (obj[field] instanceof Date) {
             obj[field] = obj[field].toISOString();
        }
        // No action for other types, they remain as is.
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newBookingData, field as string));

  if (newBookingData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => processField(newBookingData.guestSubmittedData, field as string));
    
    if (newBookingData.guestSubmittedData.mitreisende && Array.isArray(newBookingData.guestSubmittedData.mitreisende)) {
        newBookingData.guestSubmittedData.mitreisende.forEach((mitreisender: any) => {
            // Example: processField(mitreisender, 'geburtstagMitreisender'); // If Mitreisender had date fields
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
      } else if (obj[field] === '' || obj[field] === null) {
         // Keep null as null for Firestore, delete empty strings if they shouldn't be stored
         if (obj[field] === '') delete obj[field];
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
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage); // Throw error to be caught by page component
  }
  try {
    const collectionName = "bookings";
    const bookingsCol = collection(db, collectionName);
    // Add orderBy createdAt descending to get newest bookings first
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc")); 
    console.log(`${operationName} Executing Firestore query on path: ${bookingsCol.path}, ordered by createdAt desc`);
    const bookingSnapshot: QuerySnapshot<DocumentData> = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    console.log(`${operationName} Successfully fetched ${bookingList.length} bookings from collection '${collectionName}'.`);
    return bookingList;
  } catch (error: any) {
    const baseErrorMsg = `${operationName} Error fetching bookings from Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(baseErrorMsg, error.stack?.substring(0, 500));
    if (String(error.message).toLowerCase().includes("missing or insufficient permissions")) {
        const permissionErrorMsg = `${baseErrorMsg} "FirebaseError: Missing or insufficient permissions." Check Firebase Firestore security rules.`;
        console.error(permissionErrorMsg);
        throw new Error(permissionErrorMsg);
    } else if (String(error.message).toLowerCase().includes("query requires an index")) {
        const indexErrorMsg = `${baseErrorMsg} Query requires an index (likely on 'createdAt'). Firestore may suggest creating one in the Firebase Console or server logs.`;
        console.error(indexErrorMsg);
        throw new Error(indexErrorMsg);
    }
    throw new Error(baseErrorMsg); // Re-throw the original or wrapped error
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  const operationName = "[addBookingToFirestore]";
  console.log(`${operationName} Attempting to add booking...`);
   if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot add booking. Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      guestSubmittedData: bookingData.guestSubmittedData || { lastCompletedStep: -1 },
      createdAt: Timestamp.fromDate(now), // Use Firestore Timestamp directly
      updatedAt: Timestamp.fromDate(now), // Use Firestore Timestamp directly
    });
    console.log(`${operationName} Adding booking to Firestore. Collection: "bookings". Data (partial):`, { guest: dataToSave.guestFirstName, token: dataToSave.bookingToken, price: dataToSave.price });
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    return docRef.id;
  } catch (error: any) {
    const errorMessage = `${operationName} Error adding booking to Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    throw new Error(errorMessage);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  console.log(`${operationName} Attempting to find booking by token: "${token}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot find booking. Token: "${token}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  const collectionName = "bookings";
  const fieldNameToQuery = "bookingToken";
  console.log(`${operationName} Querying collection "${collectionName}" for field "${fieldNameToQuery}" == "${token}"`);

  try {
    const bookingsCol = collection(db, collectionName);
    const q = query(bookingsCol, where(fieldNameToQuery, "==", token));
    console.log(`${operationName} Executing Firestore query for token: "${token}" on path: ${bookingsCol.path}`);
    const querySnapshot: QuerySnapshot<DocumentData> = await getDocs(q);
    console.log(`${operationName} Query for token "${token}" executed. Found ${querySnapshot.size} documents in collection '${collectionName}'.`);

    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with token "${token}", ID: ${booking.id}, Status: ${booking.status}`);
      return booking;
    }
    console.warn(`${operationName} Booking with token "${token}" NOT FOUND in Firestore collection '${collectionName}'.`);
    return null;
  } catch (error: any) {
    const errorMessage = `${operationName} Error finding booking by token "${token}" in Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    if (String(error.message).toLowerCase().includes("missing or insufficient permissions")) {
        throw new Error(`Firestore Permission Denied: Cannot read booking with token ${token}. Check Firestore rules. Original error: ${error.message}`);
    } else if (String(error.message).toLowerCase().includes("query requires an index")) {
        throw new Error(`Firestore Index Missing: Query for booking token ${token} requires an index on 'bookingToken'. Check Firebase console. Original error: ${error.message}`);
    }
    throw new Error(errorMessage);
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  console.log(`${operationName} Attempting to find booking by ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
     const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
     const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID. ID: "${id}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    if (typeof id !== 'string' || id.trim() === '') {
        console.warn(`${operationName} Invalid ID provided: "${id}". Returning null.`);
        return null;
    }
    const docRef = doc(db, "bookings", id);
    console.log(`${operationName} Getting document from Firestore with path: ${docRef.path}`);
    const docSnap: DocumentSnapshot<DocumentData> = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`${operationName} Successfully found booking with ID "${id}"`);
      return booking;
    }
    console.warn(`${operationName} Booking with ID "${id}" NOT FOUND in Firestore.`);
    return null;
  } catch (error: any) {
    const errorMessage = `${operationName} Error finding booking by ID "${id}" in Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    throw new Error(errorMessage);
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  console.log(`${operationName} Attempting to update booking with ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot update booking. ID: "${id}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: Timestamp.now(), // Use Firestore Timestamp directly for updates
    });
    
    // Smart merge for guestSubmittedData if it's part of updates
    if (updates.guestSubmittedData) {
        console.log(`${operationName} guestSubmittedData is part of updates for booking ID "${id}". Merging...`);
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };
            
            const newGuestDataUpdates = typeof dataToUpdate.guestSubmittedData === 'object' && dataToUpdate.guestSubmittedData !== null
                ? dataToUpdate.guestSubmittedData
                : {};

            // Ensure mitreisende array is handled correctly (merge or replace)
            let mergedMitreisende = currentGuestData.mitreisende || [];
            if (newGuestDataUpdates.mitreisende && Array.isArray(newGuestDataUpdates.mitreisende)) {
                // This will replace the entire mitreisende array if new one is provided.
                // If you need to merge individual mitreisende, more complex logic is needed.
                mergedMitreisende = newGuestDataUpdates.mitreisende;
            }


            const mergedGuestData = {
                ...currentGuestData,
                ...newGuestDataUpdates, // New updates take precedence
                mitreisende: mergedMitreisende, // Use the merged/replaced array
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
    const errorMessage = `${operationName} Error updating booking with ID "${id}" in Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    throw new Error(errorMessage);
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<{ success: boolean; message: string }> {
  const operationName = "[deleteBookingsFromFirestoreByIds]";
  let successfulDeletes = 0;
  let failedDeletes = 0;
  const errorMessagesAccumulator: string[] = [];

  console.log(`${operationName} Attempting to delete ${ids.length} bookings. IDs: ${ids.join(', ')}`);

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorDetail = firebaseInitializationError || "DB/Storage instance is null or firebaseInitializedCorrectly is false.";
    const initErrorMsg = `${operationName} FATAL: Firebase not initialized. Cannot delete. Detail: ${errorDetail}`;
    console.error(initErrorMsg);
    return { success: false, message: initErrorMsg };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: true, message: "Keine IDs zum Löschen angegeben." };
  }

  const batch = writeBatch(db);
  const fileDeletionPromises: Promise<void>[] = [];

  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      console.warn(`${operationName} Skipping invalid ID for deletion: "${id}"`);
      failedDeletes++;
      errorMessagesAccumulator.push(`ID "${id}" ist ungültig.`);
      continue;
    }

    const docRef = doc(db, "bookings", id);
    try {
      console.log(`${operationName} [ID: ${id}] Fetching booking to identify associated files...`);
      const bookingDoc: DocumentSnapshot<DocumentData> = await getDoc(docRef);

      if (bookingDoc.exists()) {
        const bookingData = bookingDoc.data() as Booking;
        const urlsToDelete: string[] = [];

        if (bookingData.guestSubmittedData) {
          const gsData = bookingData.guestSubmittedData;
          if (gsData.hauptgastAusweisVorderseiteUrl) urlsToDelete.push(gsData.hauptgastAusweisVorderseiteUrl);
          if (gsData.hauptgastAusweisRückseiteUrl) urlsToDelete.push(gsData.hauptgastAusweisRückseiteUrl);
          if (gsData.zahlungsbelegUrl) urlsToDelete.push(gsData.zahlungsbelegUrl);
          if (gsData.mitreisende && Array.isArray(gsData.mitreisende)) {
            gsData.mitreisende.forEach(m => {
              if (m.ausweisVorderseiteUrl) urlsToDelete.push(m.ausweisVorderseiteUrl);
              if (m.ausweisRückseiteUrl) urlsToDelete.push(m.ausweisRückseiteUrl);
            });
          }
        }

        console.log(`${operationName} [ID: ${id}] Found ${urlsToDelete.length} potential file URLs to delete.`);
        for (const url of urlsToDelete) {
          if (url && typeof url === 'string' && url.startsWith("https://firebasestorage.googleapis.com")) {
            fileDeletionPromises.push(
              (async () => {
                try {
                  const fileRef = storageRefFB(storage, url); // storage is FirebaseStorage instance
                  await deleteObject(fileRef);
                  console.log(`${operationName} [ID: ${id}] Deleted file from Storage: ${url}`);
                } catch (fileError: any) {
                  if (String(fileError.message).includes('storage/object-not-found')) {
                    console.warn(`${operationName} [ID: ${id}] File not found in Storage, skipping deletion: ${url}`);
                  } else {
                    const fileErrorMsg = `${operationName} [ID: ${id}] Failed to delete file ${url}: ${fileError.message} (Code: ${fileError.code || 'N/A'})`;
                    console.error(fileErrorMsg);
                    errorMessagesAccumulator.push(`Fehler beim Löschen von Datei ${url.substring(url.lastIndexOf('/')+1)} für Buchung ${id}.`);
                  }
                }
              })()
            );
          }
        }
        batch.delete(docRef);
        console.log(`${operationName} [ID: ${id}] Firestore document added to batch delete.`);
        // successfulDeletes increment will happen after batch commit or if no files to delete
      } else {
        console.warn(`${operationName} [ID: ${id}] Document not found in Firestore. Cannot delete.`);
        failedDeletes++;
        errorMessagesAccumulator.push(`Buchung mit ID "${id}" nicht gefunden.`);
      }
    } catch (error: any) {
      const errorMsg = `${operationName} [ID: ${id}] Error processing for deletion: ${error.message} (Code: ${error.code || 'N/A'})`;
      console.error(errorMsg);
      failedDeletes++;
      errorMessagesAccumulator.push(`Fehler beim Verarbeiten von ID "${id}": ${error.message}`);
    }
  }

  try {
    if (fileDeletionPromises.length > 0) {
      console.log(`${operationName} Waiting for ${fileDeletionPromises.length} file deletion promises to settle...`);
      const settledPromises = await Promise.allSettled(fileDeletionPromises);
      settledPromises.forEach((result, index) => {
          if (result.status === 'rejected') {
              console.error(`${operationName} A file deletion promise was rejected:`, result.reason);
              // Error already logged and potentially added to errorMessagesAccumulator inside the async IIFE
          }
      });
      console.log(`${operationName} All file deletion attempts completed.`);
    }

    let batchCommitted = false;
    if (ids.length - failedDeletes > 0) { // Only commit if there are documents actually marked for deletion
      console.log(`${operationName} Committing batch delete for ${ids.length - failedDeletes} Firestore documents.`);
      await batch.commit();
      successfulDeletes = ids.length - failedDeletes; // Set successful deletes based on batch commit
      batchCommitted = true;
      console.log(`${operationName} Batch commit successful for deletion of ${successfulDeletes} booking(s).`);
    } else if (ids.length > 0 && failedDeletes === ids.length) {
      console.log(`${operationName} No documents were eligible for batch deletion (all failed or not found).`);
    } else {
      console.log(`${operationName} No documents to commit in batch (either ids array was empty or all initial checks failed).`);
    }
    
    let message = "";
    if (successfulDeletes > 0) message += `${successfulDeletes} Buchung(en) erfolgreich gelöscht. `;
    if (failedDeletes > 0) {
         message += `${failedDeletes} Buchung(en) konnten nicht in Firestore gefunden oder initial verarbeitet werden. `;
    }
    if (errorMessagesAccumulator.length > 0) {
        message += `Zusätzliche Fehler: ${errorMessagesAccumulator.join('; ')}`;
    }
    
    if (successfulDeletes === 0 && failedDeletes === 0 && ids.length > 0) message = "Keine der ausgewählten Buchungen konnte gefunden oder verarbeitet werden.";
    if (ids.length === 0 && successfulDeletes === 0 && failedDeletes === 0) message = "Keine Buchungen zum Löschen ausgewählt.";

    return { success: successfulDeletes > 0 && errorMessagesAccumulator.length === 0 && failedDeletes === 0, message: message || "Löschvorgang abgeschlossen." };

  } catch (batchCommitError: any) {
    const errorMessage = `${operationName} Error committing batch delete: ${batchCommitError.message} (Code: ${batchCommitError.code || 'N/A'})`;
    console.error(errorMessage, batchCommitError.stack?.substring(0,500));
    errorMessagesAccumulator.push(`Fehler beim Bestätigen der Löschung in Firestore: ${batchCommitError.message}`);
    return { 
        success: false, 
        message: `${errorMessage}. ${errorMessagesAccumulator.join('; ')}`
    };
  }
}
