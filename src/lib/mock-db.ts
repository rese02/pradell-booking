
// src/lib/mock-db.ts
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
  runTransaction
} from "firebase/firestore";
import { ref as storageRefFB, deleteObject } from "firebase/storage";

function logSafeDB(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = "[FirestoreDB LogSafe]";
    // Simplified logging for brevity, adapt as needed
    const logMessage = `${operationName} [${new Date().toISOString()}] ${context} ${JSON.stringify(data, null, 2).substring(0,1000)}`;
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}


export function convertTimestampsToISO(bookingData: any): any {
  if (!bookingData || typeof bookingData !== 'object') return bookingData;
  
  let newBookingData: any;
  try {
    newBookingData = JSON.parse(JSON.stringify(bookingData)); 
  } catch (e) {
    console.error("[convertTimestampsToISO] Error deep cloning bookingData:", e, bookingData);
    return bookingData; 
  }

  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
        if (obj[field] instanceof Timestamp) {
            obj[field] = obj[field].toDate().toISOString();
        } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
            try {
                obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
            } catch (tsError) {
                console.warn(`[convertTimestampsToISO] Error converting pseudo-Timestamp object for field ${field}:`, tsError, obj[field]);
            }
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
    
    // Convert dates in mitreisende if present
    if (newBookingData.guestSubmittedData.mitreisende && Array.isArray(newBookingData.guestSubmittedData.mitreisende)) {
        // No date fields currently defined in Mitreisender for conversion
    }
  }
  return newBookingData;
}

function convertDatesToTimestamps(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const newData: any = JSON.parse(JSON.stringify(data)); 

  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
      if (obj[field] instanceof Timestamp) {
        return; 
      }
      const dateValue = (typeof obj[field] === 'string' || obj[field] instanceof Date) ? new Date(obj[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        obj[field] = Timestamp.fromDate(dateValue);
      } else if (obj[field] === '' || obj[field] === null) {
         // Allow explicit nulls to be set, remove empty strings if they are not intended as valid values for date fields.
         // For now, if it's an empty string, it won't be converted to Timestamp and might cause issues if Firestore expects a Timestamp or null.
         // Firestore handles null values correctly for optional date fields.
         // If an empty string '' is passed for a date field, Firestore might reject it or store it as an empty string.
         // It's usually better to explicitly set to null if the date is not provided.
         // For this function, if it's not a valid date string/object, it's left as is.
         // The Zod schema should ideally ensure dates are valid strings or convert them.
      }
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newData, field as string));

  if (newData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => processField(newData.guestSubmittedData, field as string));
    // Convert dates in mitreisende if present
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
    throw new Error(errorMessage); 
  }
  try {
    const collectionName = "bookings";
    const bookingsCol = collection(db, collectionName);
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc")); 
    logSafeDB(`${operationName} Executing Firestore query`, { path: bookingsCol.path, orderBy: "createdAt desc" });
    const bookingSnapshot: QuerySnapshot<DocumentData> = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    logSafeDB(`${operationName} Successfully fetched bookings`, { count: bookingList.length, collectionName });
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
    throw new Error(baseErrorMsg);
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  const operationName = "[addBookingToFirestore]";
  logSafeDB(`${operationName} Attempting to add booking`, { dataKeys: Object.keys(bookingData) });
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
      // Ensure guestSubmittedData is an object, even if empty, for consistency.
      // If bookingData might not have it, provide a default.
      guestSubmittedData: bookingData.guestSubmittedData || { lastCompletedStep: -1 },
      createdAt: Timestamp.fromDate(now), 
      updatedAt: Timestamp.fromDate(now), 
    });
    logSafeDB(`${operationName} Adding booking to Firestore. Collection: "bookings".`, { dataKeysToSave: Object.keys(dataToSave) });
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    logSafeDB(`${operationName} Booking successfully added to Firestore`, { id: docRef.id });
    return docRef.id;
  } catch (error: any) {
    const errorMessage = `${operationName} Error adding booking to Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    throw new Error(errorMessage);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  logSafeDB(`${operationName} Attempting to find booking by token`, { token });
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot find booking. Token: "${token}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  const collectionName = "bookings";
  const fieldNameToQuery = "bookingToken";
  logSafeDB(`${operationName} Querying collection "${collectionName}" for field "${fieldNameToQuery}" == "${token}"`, {});

  try {
    const bookingsCol = collection(db, collectionName);
    const q = query(bookingsCol, where(fieldNameToQuery, "==", token));
    logSafeDB(`${operationName} Executing Firestore query for token: "${token}"`, { path: bookingsCol.path });
    const querySnapshot: QuerySnapshot<DocumentData> = await getDocs(q);
    logSafeDB(`${operationName} Query for token "${token}" executed. Found ${querySnapshot.size} documents.`, {});

    if (!querySnapshot.empty) {
      if (querySnapshot.size > 1) {
        logSafeDB(`${operationName} WARNING: Found ${querySnapshot.size} bookings with the same token "${token}". Returning the first one.`, {}, 'warn');
      }
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      logSafeDB(`${operationName} Successfully found booking with token "${token}"`, { id: booking.id, status: booking.status });
      return booking;
    }
    logSafeDB(`${operationName} Booking with token "${token}" NOT FOUND in Firestore collection '${collectionName}'.`, {}, 'warn');
    return null;
  } catch (error: any) {
    const errorMessage = `${operationName} Error finding booking by token "${token}" in Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    if (String(error.message).toLowerCase().includes("missing or insufficient permissions")) {
        throw new Error(`Firestore Permission Denied: Cannot read booking with token ${token}. Check Firestore rules. Original error: ${error.message}`);
    } else if (String(error.message).toLowerCase().includes("query requires an index")) {
        // This error usually appears in the Firebase console or server logs directly if an index is needed
        throw new Error(`Firestore Index Missing: Query for booking token ${token} requires an index on 'bookingToken'. Check Firebase console. Original error: ${error.message}`);
    }
    throw new Error(errorMessage);
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  logSafeDB(`${operationName} Attempting to find booking by ID`, { id });
  if (!firebaseInitializedCorrectly || !db) {
     const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
     const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID. ID: "${id}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    if (typeof id !== 'string' || id.trim() === '') {
        logSafeDB(`${operationName} Invalid ID provided`, { id }, 'warn');
        return null;
    }
    const docRef = doc(db, "bookings", id);
    logSafeDB(`${operationName} Getting document from Firestore`, { path: docRef.path });
    const docSnap: DocumentSnapshot<DocumentData> = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      logSafeDB(`${operationName} Successfully found booking with ID "${id}"`, {});
      return booking;
    }
    logSafeDB(`${operationName} Booking with ID "${id}" NOT FOUND in Firestore.`, {}, 'warn');
    return null;
  } catch (error: any) {
    const errorMessage = `${operationName} Error finding booking by ID "${id}" in Firestore: "${error.message}" (Code: ${error.code || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    throw new Error(errorMessage);
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  logSafeDB(`${operationName} Attempting to update booking with ID`, { id, updateKeys: Object.keys(updates) });
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
        updatedAt: Timestamp.now(), 
    });
    
    // Smart merging of guestSubmittedData to avoid overwriting sub-fields unintentionally
    if (updates.guestSubmittedData && typeof updates.guestSubmittedData === 'object') {
        logSafeDB(`${operationName} guestSubmittedData is part of updates. Merging with transaction.`, { bookingId: id });
        await runTransaction(db, async (transaction) => {
            const currentBookingDoc = await transaction.get(docRef);
            if (!currentBookingDoc.exists()) {
                throw new Error(`Dokument mit ID ${id} nicht gefunden für Transaktions-Update.`);
            }
            const currentBookingData = currentBookingDoc.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };
            
            const newGuestDataUpdates = dataToUpdate.guestSubmittedData;

            // Merge mitreisende array specifically if present in updates
            let mergedMitreisende = currentGuestData.mitreisende || [];
            if (newGuestDataUpdates.mitreisende && Array.isArray(newGuestDataUpdates.mitreisende)) {
                // This will overwrite the entire mitreisende array. If fine-grained merge is needed, more complex logic is required.
                mergedMitreisende = newGuestDataUpdates.mitreisende;
            }
            
            const mergedGuestData = {
                ...currentGuestData,
                ...newGuestDataUpdates,
                mitreisende: mergedMitreisende, // Ensure mitreisende is correctly merged/overwritten
            };
            
            const finalUpdatesForTransaction = {
                ...dataToUpdate, // Contains other top-level updates and updatedAt
                guestSubmittedData: mergedGuestData,
            };
            transaction.update(docRef, finalUpdatesForTransaction);
            logSafeDB(`${operationName} Transactional update for guestSubmittedData prepared.`, { keys: Object.keys(finalUpdatesForTransaction) });
        });
        logSafeDB(`${operationName} Transactional update successful for booking ID "${id}".`, {});

    } else {
        // If guestSubmittedData is not part of the update or not an object, proceed with normal update
        logSafeDB(`${operationName} Updating document in Firestore (non-transactional for guestSubmittedData or no guestSubmittedData in update).`, { path: docRef.path, updateKeys: Object.keys(dataToUpdate) });
        await updateDoc(docRef, dataToUpdate);
    }
    
    logSafeDB(`${operationName} Booking with ID "${id}" updated successfully in Firestore.`, {});
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

  logSafeDB(`${operationName} Attempting to delete bookings from Firestore.`, { count: ids.length, ids });

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
      logSafeDB(`${operationName} Skipping invalid ID for deletion`, { id }, 'warn');
      failedDeletes++;
      errorMessagesAccumulator.push(`ID "${id}" ist ungültig.`);
      continue;
    }

    const docRef = doc(db, "bookings", id);
    try {
      logSafeDB(`${operationName} [ID: ${id}] Fetching booking to identify associated files...`, {});
      const bookingDocSnap: DocumentSnapshot<DocumentData> = await getDoc(docRef);

      if (bookingDocSnap.exists()) {
        const bookingData = bookingDocSnap.data() as Booking;
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

        logSafeDB(`${operationName} [ID: ${id}] Found ${urlsToDelete.length} potential file URLs to delete from Storage.`, { urls: urlsToDelete.map(u => u.substring(u.lastIndexOf('/')+1)) });
        for (const url of urlsToDelete) {
          if (url && typeof url === 'string' && url.startsWith("https://firebasestorage.googleapis.com")) {
            fileDeletionPromises.push(
              (async () => {
                try {
                  const fileRef = storageRefFB(storage, url); 
                  await deleteObject(fileRef);
                  logSafeDB(`${operationName} [ID: ${id}] Deleted file from Storage`, { fileUrl: url.substring(url.lastIndexOf('/')+1) });
                } catch (fileError: any) {
                  if (String(fileError.code).includes('storage/object-not-found')) { // Firebase Storage error codes are strings
                    logSafeDB(`${operationName} [ID: ${id}] File not found in Storage, skipping deletion`, { fileUrl: url.substring(url.lastIndexOf('/')+1) }, 'warn');
                  } else {
                    const fileErrorMsg = `${operationName} [ID: ${id}] Failed to delete file ${url.substring(url.lastIndexOf('/')+1)} from Storage: ${fileError.message} (Code: ${fileError.code || 'N/A'})`;
                    console.error(fileErrorMsg);
                    errorMessagesAccumulator.push(`Fehler beim Löschen von Datei ${url.substring(url.lastIndexOf('/')+1)} für Buchung ${id}.`);
                  }
                }
              })()
            );
          }
        }
        batch.delete(docRef);
        logSafeDB(`${operationName} [ID: ${id}] Firestore document added to batch delete.`, {});
      } else {
        logSafeDB(`${operationName} [ID: ${id}] Document not found in Firestore. Cannot delete.`, {}, 'warn');
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
      logSafeDB(`${operationName} Waiting for ${fileDeletionPromises.length} file deletion promises to settle...`, {});
      const settledPromises = await Promise.allSettled(fileDeletionPromises);
      settledPromises.forEach((result, index) => {
          if (result.status === 'rejected') {
              console.error(`${operationName} A file deletion promise was rejected:`, result.reason);
          }
      });
      logSafeDB(`${operationName} All file deletion attempts completed.`, {});
    }

    const docsInBatch = ids.length - failedDeletes;
    if (docsInBatch > 0) {
      logSafeDB(`${operationName} Committing batch delete for ${docsInBatch} Firestore documents.`, {});
      await batch.commit();
      successfulDeletes = docsInBatch; 
      logSafeDB(`${operationName} Batch commit successful for deletion of ${successfulDeletes} booking(s).`, {});
    } else if (ids.length > 0) {
      logSafeDB(`${operationName} No documents were eligible for batch deletion (all failed pre-check or not found).`, {}, 'warn');
    } else { // ids.length === 0, already handled
    }
    
    let message = "";
    if (successfulDeletes > 0) message += `${successfulDeletes} Buchung(en) erfolgreich gelöscht. `;
    if (failedDeletes > 0 && ids.length > 0) { // Only report failedDeletes if there were IDs to process
         message += `${failedDeletes} Buchung(en) konnten nicht in Firestore gefunden oder initial verarbeitet werden. `;
    }
    if (errorMessagesAccumulator.length > 0) {
        message += `Zusätzliche Fehler (meist bei Dateilöschungen): ${errorMessagesAccumulator.join('; ')}`;
    }
    
    if (successfulDeletes === 0 && failedDeletes === 0 && ids.length > 0 && errorMessagesAccumulator.length === 0) {
        message = "Keine der ausgewählten Buchungen konnte gefunden oder verarbeitet werden.";
    }
    if (ids.length === 0 && successfulDeletes === 0 && failedDeletes === 0) {
        message = "Keine Buchungen zum Löschen ausgewählt."; // Should be caught by action layer
    }

    return { success: successfulDeletes > 0 && errorMessagesAccumulator.length === 0 && failedDeletes === 0, message: message || "Löschvorgang abgeschlossen." };

  } catch (batchCommitError: any) {
    const errorMessage = `${operationName} Error committing batch delete to Firestore: ${batchCommitError.message} (Code: ${batchCommitError.code || 'N/A'})`;
    console.error(errorMessage, batchCommitError.stack?.substring(0,500));
    errorMessagesAccumulator.push(`Fehler beim Bestätigen der Löschung in Firestore: ${batchCommitError.message}`);
    return { 
        success: false, 
        message: `${errorMessage}. ${errorMessagesAccumulator.join('; ')}`
    };
  }
}

    
