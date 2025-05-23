
// src/lib/mock-db.ts
import type { Booking, GuestSubmittedData, Mitreisender } from "@/lib/definitions";
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
import { ref as storageRefFB, deleteObject, getBlob } from "firebase/storage"; // Added getBlob for potential future use

// Centralized logging function for this module
function logDb(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = "[FirestoreDB]";
    // Simplified logging for brevity, adapt as needed
    let simplifiedData = "";
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
             if (value instanceof Error) { return { message: value.message, name: value.name, code: (value as any).code }; }
             if (typeof value === 'string' && value.length > 150 && !key.toLowerCase().includes('url')) { return value.substring(0,100) + "...[TRUNCATED_STRING_LOG]"; }
             return value;
        }, 2).substring(0, 1500); // Limit overall log length
    } catch (e) {
        simplifiedData = "[Log data could not be stringified]";
    }

    const logMessage = `${operationName} [${new Date().toISOString()}] ${context} ${simplifiedData}`;
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
    logDb("[convertTimestampsToISO] Error deep cloning bookingData:", { message: (e as Error).message, bookingDataPreview: String(bookingData).substring(0,100) }, 'error');
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
                logDb(`[convertTimestampsToISO] Error converting pseudo-Timestamp object for field ${field}:`, { error: (tsError as Error).message, value: obj[field] }, 'warn');
            }
        } else if (obj[field] instanceof Date) {
             obj[field] = obj[field].toISOString();
        }
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newBookingData, field as string));

  if (newBookingData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum']; // Added zahlungsdatum
    guestDataFields.forEach(field => processField(newBookingData.guestSubmittedData, field as string));
    
    if (newBookingData.guestSubmittedData.mitreisende && Array.isArray(newBookingData.guestSubmittedData.mitreisende)) {
        // No date fields currently defined in Mitreisender for conversion in the provided definitions
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
      }
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newData, field as string));

  if (newData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum']; // Added zahlungsdatum
    guestDataFields.forEach(field => processField(newData.guestSubmittedData, field as string));
  }
  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  const operationName = "[getBookingsFromFirestore]";
  logDb(`${operationName} Attempting to fetch bookings...`, {});
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Detail: ${errorDetail}`;
    console.error(errorMessage); // Keep console.error for FATAL
    throw new Error(errorMessage); 
  }
  try {
    const collectionName = "bookings";
    const bookingsCol = collection(db, collectionName);
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc")); 
    logDb(`${operationName} Executing Firestore query`, { path: bookingsCol.path, orderBy: "createdAt desc" });
    const bookingSnapshot: QuerySnapshot<DocumentData> = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    logDb(`${operationName} Successfully fetched ${bookingList.length} bookings.`, { collectionName });
    return bookingList;
  } catch (error: any) {
    const fbErrorCode = error.code; // Firebase errors often have a 'code' property
    const baseErrorMsg = `${operationName} Error fetching bookings from Firestore: "${error.message}" (Code: ${fbErrorCode || 'N/A'})`;
    console.error(baseErrorMsg, error.stack?.substring(0, 500)); // Keep console.error for actual errors
    if (String(error.message).toLowerCase().includes("missing or insufficient permissions") || fbErrorCode === 'permission-denied') {
        const permissionErrorMsg = `${baseErrorMsg} "FirebaseError: Missing or insufficient permissions." Check Firebase Firestore security rules.`;
        throw new Error(permissionErrorMsg);
    } else if (String(error.message).toLowerCase().includes("query requires an index") || fbErrorCode === 'failed-precondition') {
        // 'failed-precondition' is often the code for a missing index
        const indexErrorMsg = `${baseErrorMsg} Query requires an index (likely on 'createdAt'). Firestore may suggest creating one in the Firebase Console or server logs.`;
        throw new Error(indexErrorMsg);
    }
    throw new Error(baseErrorMsg);
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  const operationName = "[addBookingToFirestore]";
  logDb(`${operationName} Attempting to add booking`, { dataKeys: Object.keys(bookingData) });
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
      createdAt: Timestamp.fromDate(now), 
      updatedAt: Timestamp.fromDate(now), 
    });
    logDb(`${operationName} Adding booking to Firestore. Collection: "bookings".`, { dataKeysToSave: Object.keys(dataToSave).slice(0,10) }); // Log only first 10 keys
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    logDb(`${operationName} Booking successfully added to Firestore`, { id: docRef.id });
    return docRef.id;
  } catch (error: any) {
    const fbErrorCode = error.code;
    const errorMessage = `${operationName} Error adding booking to Firestore: "${error.message}" (Code: ${fbErrorCode || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    throw new Error(errorMessage);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  logDb(`${operationName} Attempting to find booking by token: "${token}"`, {});
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot find booking. Token: "${token}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  const collectionName = "bookings";
  const fieldNameToQuery = "bookingToken";
  logDb(`${operationName} Querying collection "${collectionName}" for field "${fieldNameToQuery}" == "${token}"`, { path: collection(db, collectionName).path });

  try {
    const bookingsCol = collection(db, collectionName);
    const q = query(bookingsCol, where(fieldNameToQuery, "==", token));
    logDb(`${operationName} Executing Firestore query for token: "${token}" on path: ${bookingsCol.path}`, {});
    const querySnapshot: QuerySnapshot<DocumentData> = await getDocs(q);
    logDb(`${operationName} Query for token "${token}" executed. Found ${querySnapshot.size} documents.`, {});

    if (!querySnapshot.empty) {
      if (querySnapshot.size > 1) {
        logDb(`${operationName} WARNING: Found ${querySnapshot.size} bookings with the same token "${token}". Returning the first one.`, {}, 'warn');
      }
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      logDb(`${operationName} Successfully found booking with token "${token}"`, { id: booking.id, status: booking.status });
      return booking;
    }
    logDb(`${operationName} Booking with token "${token}" NOT FOUND in Firestore collection '${collectionName}'.`, {}, 'warn');
    return null;
  } catch (error: any) {
    const fbErrorCode = error.code;
    const errorMessage = `${operationName} Error finding booking by token "${token}" in Firestore: "${error.message}" (Code: ${fbErrorCode || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    if (fbErrorCode === 'permission-denied') {
        throw new Error(`Firestore Permission Denied: Cannot read booking with token ${token}. Check Firestore rules. Original error: ${error.message} (Code: ${fbErrorCode})`);
    } else if (fbErrorCode === 'failed-precondition') {
        throw new Error(`Firestore Query Error (likely Index Missing): Query for booking token ${token} requires an index or has other issues. Check Firebase console. Original error: ${error.message} (Code: ${fbErrorCode})`);
    }
    throw new Error(errorMessage); // Generic fallback
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  logDb(`${operationName} Attempting to find booking by ID: "${id}"`, {});
  if (!firebaseInitializedCorrectly || !db) {
     const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
     const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID. ID: "${id}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    if (typeof id !== 'string' || id.trim() === '') {
        logDb(`${operationName} Invalid ID provided: "${id}"`, {}, 'warn');
        return null;
    }
    const docRef = doc(db, "bookings", id);
    logDb(`${operationName} Getting document from Firestore`, { path: docRef.path });
    const docSnap: DocumentSnapshot<DocumentData> = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      logDb(`${operationName} Successfully found booking with ID "${id}"`, { status: booking.status });
      return booking;
    }
    logDb(`${operationName} Booking with ID "${id}" NOT FOUND in Firestore.`, {}, 'warn');
    return null;
  } catch (error: any) {
    const fbErrorCode = error.code;
    const errorMessage = `${operationName} Error finding booking by ID "${id}" in Firestore: "${error.message}" (Code: ${fbErrorCode || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    if (fbErrorCode === 'permission-denied') {
        throw new Error(`Firestore Permission Denied: Cannot read booking with ID ${id}. Check Firestore rules. (Code: ${fbErrorCode})`);
    }
    throw new Error(errorMessage);
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  logDb(`${operationName} Attempting to update booking with ID: "${id}"`, { updateKeys: Object.keys(updates) });
  if (!firebaseInitializedCorrectly || !db) {
    const errorDetail = firebaseInitializationError || "DB instance is null or firebaseInitializedCorrectly is false.";
    const errorMessage = `${operationName} FATAL: Firestore is not initialized. Cannot update booking. ID: "${id}". Detail: ${errorDetail}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    const docRef = doc(db, "bookings", id);
    const dataToUpdateWithAppTimestamp = { // Ensure all updates use app-generated server timestamp
        ...updates,
        updatedAt: Timestamp.now(), 
    };
    const dataToSave = convertDatesToTimestamps(dataToUpdateWithAppTimestamp);
    
    logDb(`${operationName} Using runTransaction for update on booking ID: "${id}"`, { dataToSaveKeys: Object.keys(dataToSave).slice(0,10) });
    await runTransaction(db, async (transaction) => {
        const currentBookingDoc = await transaction.get(docRef);
        if (!currentBookingDoc.exists()) {
            logDb(`${operationName} Document with ID "${id}" not found for transaction update.`, {}, 'error');
            throw new Error(`Dokument mit ID ${id} nicht gefunden für Transaktions-Update. (Code: UBF-DNE)`);
        }
        
        const currentBookingData = currentBookingDoc.data() as Booking;
        let mergedGuestData = { ...(currentBookingData.guestSubmittedData || { lastCompletedStep: -1 }) };

        if (dataToSave.guestSubmittedData && typeof dataToSave.guestSubmittedData === 'object') {
            logDb(`${operationName} Merging guestSubmittedData for booking ID: "${id}"`, { newKeys: Object.keys(dataToSave.guestSubmittedData) });
            mergedGuestData = {
                ...mergedGuestData,
                ...dataToSave.guestSubmittedData,
            };
            // Ensure mitreisende array is handled correctly (overwrite or merge based on needs)
            // Current logic simply overwrites if `dataToSave.guestSubmittedData.mitreisende` is present
            if (dataToSave.guestSubmittedData.mitreisende !== undefined) {
                mergedGuestData.mitreisende = dataToSave.guestSubmittedData.mitreisende;
            }
        }
        
        const finalUpdatesForTransaction = {
            ...dataToSave, // Contains other top-level updates and updatedAt
            guestSubmittedData: mergedGuestData,
        };
        transaction.update(docRef, finalUpdatesForTransaction);
        logDb(`${operationName} Transactional update for booking ID "${id}" prepared.`, { finalUpdateKeys: Object.keys(finalUpdatesForTransaction).slice(0,10) });
    });
    
    logDb(`${operationName} Booking with ID "${id}" updated successfully via transaction in Firestore.`, {});
    return true;
  } catch (error: any) {
    const fbErrorCode = error.code;
    const errorMessage = `${operationName} Error updating booking with ID "${id}" in Firestore: "${error.message}" (Code: ${fbErrorCode || 'N/A'})`;
    console.error(errorMessage, error.stack?.substring(0, 500));
    if (fbErrorCode === 'permission-denied') {
        throw new Error(`Firestore Permission Denied: Cannot update booking with ID ${id}. Check Firestore rules. (Code: ${fbErrorCode})`);
    }
    throw new Error(errorMessage);
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<{ success: boolean; message: string, successfulDeletes: number, failedDeletes: number }> {
  const operationName = "[deleteBookingsFromFirestoreByIds]";
  let successfulDeletes = 0;
  let failedDeletes = 0;
  const errorMessagesAccumulator: string[] = [];

  logDb(`${operationName} Attempting to delete ${ids.length} bookings from Firestore.`, { ids });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorDetail = firebaseInitializationError || "DB/Storage instance is null or firebaseInitializedCorrectly is false.";
    const initErrorMsg = `${operationName} FATAL: Firebase not initialized. Cannot delete. Detail: ${errorDetail}`;
    console.error(initErrorMsg);
    return { success: false, message: initErrorMsg, successfulDeletes, failedDeletes };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: true, message: "Keine IDs zum Löschen angegeben.", successfulDeletes, failedDeletes };
  }

  const batch = writeBatch(db);
  const fileDeletionPromises: Promise<{url: string, status: 'fulfilled' | 'rejected', reason?: any}>[] = [];

  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      logDb(`${operationName} Skipping invalid ID for deletion: "${id}"`, {}, 'warn');
      failedDeletes++;
      errorMessagesAccumulator.push(`ID "${id}" ist ungültig.`);
      continue;
    }

    const docRef = doc(db, "bookings", id);
    try {
      logDb(`${operationName} [ID: ${id}] Fetching booking to identify associated files...`, {});
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

        logDb(`${operationName} [ID: ${id}] Found ${urlsToDelete.length} potential file URLs to delete from Storage.`, { urlsPreview: urlsToDelete.map(u => u.substring(u.lastIndexOf('/')+1)).slice(0,3) });
        for (const url of urlsToDelete) {
          if (url && typeof url === 'string' && url.startsWith("https://firebasestorage.googleapis.com")) {
            const promise = (async () => {
                const fileRef = storageRefFB(storage, url); 
                await deleteObject(fileRef);
                logDb(`${operationName} [ID: ${id}] Deleted file from Storage`, { fileUrl: url.substring(url.lastIndexOf('/')+1) });
                return {url, status: 'fulfilled' as const};
            })().catch(fileError => {
                const fbFileErrorCode = (fileError as any).code;
                if (String(fbFileErrorCode).includes('storage/object-not-found')) {
                  logDb(`${operationName} [ID: ${id}] File not found in Storage, skipping deletion: ${url.substring(url.lastIndexOf('/')+1)}`, {}, 'warn');
                } else {
                  const fileErrorMsg = `Failed to delete file ${url.substring(url.lastIndexOf('/')+1)} for booking ${id}: ${(fileError as Error).message} (Code: ${fbFileErrorCode || 'N/A'})`;
                  logDb(`${operationName} [ID: ${id}] ${fileErrorMsg}`, {}, 'error');
                  errorMessagesAccumulator.push(fileErrorMsg);
                }
                return {url, status: 'rejected' as const, reason: fileError};
            });
            fileDeletionPromises.push(promise);
          }
        }
        batch.delete(docRef);
        logDb(`${operationName} [ID: ${id}] Firestore document added to batch delete.`, {});
      } else {
        logDb(`${operationName} [ID: ${id}] Document not found in Firestore. Cannot delete.`, {}, 'warn');
        failedDeletes++;
        errorMessagesAccumulator.push(`Buchung mit ID "${id}" nicht gefunden.`);
      }
    } catch (error: any) {
      const fbErrorCode = error.code;
      const errorMsg = `${operationName} [ID: ${id}] Error processing for deletion: ${error.message} (Code: ${fbErrorCode || 'N/A'})`;
      console.error(errorMsg);
      failedDeletes++;
      errorMessagesAccumulator.push(`Fehler beim Verarbeiten von ID "${id}": ${error.message}`);
    }
  }

  try {
    if (fileDeletionPromises.length > 0) {
      logDb(`${operationName} Waiting for ${fileDeletionPromises.length} file deletion promises to settle...`, {});
      await Promise.allSettled(fileDeletionPromises); // Error messages are already pushed to accumulator
      logDb(`${operationName} All file deletion attempts completed.`, {});
    }

    const docsInBatch = ids.length - failedDeletes - errorMessagesAccumulator.filter(msg => msg.includes("nicht gefunden")).length; // More accurate count of docs to be deleted in batch
    if (docsInBatch > 0) {
      logDb(`${operationName} Committing batch delete for ${docsInBatch} Firestore documents.`, {});
      await batch.commit();
      successfulDeletes = docsInBatch; 
      logDb(`${operationName} Batch commit successful for deletion of ${successfulDeletes} booking(s).`, {});
    } else if (ids.length > 0) {
      logDb(`${operationName} No documents were eligible for batch deletion (all failed pre-check or not found).`, {}, 'warn');
    }
    
    let message = "";
    if (successfulDeletes > 0) message += `${successfulDeletes} Buchung(en) erfolgreich gelöscht. `;
    if (failedDeletes > 0 && ids.length > 0) {
         message += `${failedDeletes} Buchung(en) konnten nicht in Firestore gefunden oder initial verarbeitet werden. `;
    }
    if (errorMessagesAccumulator.length > 0) {
        message += `Fehler bei Dateilöschungen: ${errorMessagesAccumulator.join('; ')}`;
    }
    
    const overallSuccess = successfulDeletes > 0 && failedDeletes === 0 && errorMessagesAccumulator.length === 0;
    return { 
        success: overallSuccess, 
        message: message || (ids.length === 0 ? "Keine IDs zum Löschen angegeben." : "Löschvorgang abgeschlossen."),
        successfulDeletes,
        failedDeletes
    };

  } catch (batchCommitError: any) {
    const fbErrorCode = batchCommitError.code;
    const errorMessage = `${operationName} Error committing batch delete to Firestore: ${batchCommitError.message} (Code: ${fbErrorCode || 'N/A'})`;
    console.error(errorMessage, batchCommitError.stack?.substring(0,500));
    errorMessagesAccumulator.push(`Fehler beim Bestätigen der Löschung in Firestore: ${batchCommitError.message}`);
    return { 
        success: false, 
        message: `${errorMessage}. ${errorMessagesAccumulator.join('; ')}`,
        successfulDeletes,
        failedDeletes
    };
  }
}
