
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
  const newBookingData = JSON.parse(JSON.stringify(bookingData));

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
    if (newBookingData.guestSubmittedData.mitreisende) {
      // No specific date fields for Mitreisender in current definition
    }
  }
  return newBookingData;
}

// Helper to convert date strings or Date objects to Firestore Timestamps for saving
function convertDatesToTimestamps(data: any): any {
  if (!data) return data;
  const newData = JSON.parse(JSON.stringify(data));

  const processField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
      if (obj[field] instanceof Timestamp) {
        return;
      }
      const dateValue = (typeof obj[field] === 'string' || obj[field] instanceof Date) ? new Date(obj[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        obj[field] = Timestamp.fromDate(dateValue);
      } else if (obj[field] !== null && obj[field] !== '') {
        console.warn(`[Firestore Helper] Invalid or unhandled date value for field ${field}:`, obj[field], ". Kept as is.");
      } else if (obj[field] === '' || obj[field] === null) {
         delete obj[field];
      }
    }
  };

  const bookingDateFields: (keyof Booking)[] = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  bookingDateFields.forEach(field => processField(newData, field as string));

  if (newData.guestSubmittedData) {
    const guestDataFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
    guestDataFields.forEach(field => processField(newData.guestSubmittedData, field as string));
     if (newData.guestSubmittedData.mitreisende) {
      // No specific date fields for Mitreisender in current definition
    }
  }

  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  const operationName = "[getBookingsFromFirestore]";
  console.log(`${operationName} Attempting to fetch bookings...`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorMsg = `${operationName} FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs. Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
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
    console.error(baseErrorMsg, error);
    if ((error as any).code === 'permission-denied' || error.message.toLowerCase().includes("missing or insufficient permissions")) {
        const permissionErrorMsg = `${baseErrorMsg} "FirebaseError: Missing or insufficient permissions." Check Firebase Firestore security rules.`;
        console.error(permissionErrorMsg, error);
        throw new Error(permissionErrorMsg);
    } else if ((error as any).code === 'unimplemented' || error.message.toLowerCase().includes("query requires an index")) {
        const indexErrorMsg = `${baseErrorMsg} Query requires an index. Firestore may suggest creating one in the Firebase Console or server logs.`;
        console.error(indexErrorMsg, error);
        throw new Error(indexErrorMsg);
    }
    throw new Error(baseErrorMsg);
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  const operationName = "[addBookingToFirestore]";
  console.log(`${operationName} Attempting to add booking...`);
   if (!firebaseInitializedCorrectly || !db) {
    const errorMsg = `${operationName} FATAL: Firestore is not initialized. Cannot add booking. Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      guestSubmittedData: bookingData.guestSubmittedData || { lastCompletedStep: -1 },
      createdAt: now,
      updatedAt: now,
    });
    console.log(`${operationName} Adding booking to Firestore. Data (partial):`, { guest: dataToSave.guestFirstName, token: dataToSave.bookingToken });
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log(`${operationName} Booking successfully added to Firestore with ID:`, docRef.id);
    return docRef.id;
  } catch (error: any) {
    console.error(`${operationName} Error adding booking to Firestore: "${error.message}"`, error);
    throw new Error(`${operationName} Failed to add booking: ${error.message}`);
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  const operationName = "[findBookingByTokenFromFirestore]";
  console.log(`${operationName} Attempting to find booking by token: "${token}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorMsg = `${operationName} FATAL: Firestore is not initialized. Cannot find booking by token. Token: "${token}". Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMsg);
    // Returning null or throwing an error depends on how the caller handles it.
    // For GuestBookingPage, throwing might be better to trigger error boundaries or notFound.
    throw new Error(errorMsg);
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
    console.error(`${operationName} Error finding booking by token "${token}" in Firestore: "${error.message}"`, error);
    throw new Error(`${operationName} Failed to find booking by token "${token}": ${error.message}`);
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  const operationName = "[findBookingByIdFromFirestore]";
  console.log(`${operationName} Attempting to find booking by ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
     const errorMsg = `${operationName} FATAL: Firestore is not initialized. Cannot find booking by ID. ID: "${id}". Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
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
    console.error(`${operationName} Error finding booking by ID "${id}" in Firestore: "${error.message}"`, error);
    throw new Error(`${operationName} Failed to find booking by ID "${id}": ${error.message}`);
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  const operationName = "[updateBookingInFirestore]";
  console.log(`${operationName} Attempting to update booking with ID: "${id}"`);
  if (!firebaseInitializedCorrectly || !db) {
    const errorMsg = `${operationName} FATAL: Firestore is not initialized. Cannot update booking. ID: "${id}". Init error: ${firebaseInitializationError || "Unknown (db instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  try {
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(),
    });

    if (updates.guestSubmittedData) {
        console.log(`${operationName} guestSubmittedData is part of updates for booking ID "${id}".`);
        const currentBookingSnap = await getDoc(docRef);
        if (currentBookingSnap.exists()) {
            const currentBookingData = currentBookingSnap.data() as Booking;
            const currentGuestData = currentBookingData.guestSubmittedData || { lastCompletedStep: -1 };

            // Ensure dataToUpdate.guestSubmittedData is an object before spreading
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
    } else {
        console.log(`${operationName} guestSubmittedData is NOT part of updates for booking ID "${id}".`);
    }

    console.log(`${operationName} Updating document in Firestore with path: ${docRef.path}. Update keys: ${Object.keys(dataToUpdate).join(', ')}`);
    await updateDoc(docRef, dataToUpdate);
    console.log(`${operationName} Booking with ID "${id}" updated successfully in Firestore.`);
    return true;
  } catch (error: any) {
    console.error(`${operationName} Error updating booking with ID "${id}" in Firestore: "${error.message}"`, error);
    throw new Error(`${operationName} Failed to update booking ${id}: ${error.message}`);
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<boolean> {
  const operationName = "[deleteBookingsFromFirestoreByIds]";
  if (!Array.isArray(ids)) {
    console.warn(`${operationName} Invalid 'ids' parameter: not an array. Received:`, ids);
    return false; // Or throw an error
  }
  console.log(`${operationName} Attempting to delete ${ids.length} bookings...`);
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = `${operationName} FATAL: Firebase (Firestore or Storage) is not initialized. Cannot delete bookings. Init error: ${firebaseInitializationError || "Unknown (db/storage instance is null or firebaseInitializedCorrectly is false)"}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  if (ids.length === 0) {
    console.warn(`${operationName} No IDs provided for deletion.`);
    return true;
  }

  const batch = writeBatch(db);
  let filesToDeletePromises: Promise<void>[] = [];

  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      console.warn(`${operationName} Skipping invalid ID for deletion: "${id}"`);
      continue;
    }
    const docRef = doc(db, "bookings", id);
    try {
      console.log(`${operationName} Fetching booking ${id} to delete associated files...`);
      const bookingToDeleteSnap = await getDoc(docRef);

      if (bookingToDeleteSnap.exists()) {
          const bookingToDelete = bookingToDeleteSnap.data() as Booking;
          const urlsToDelete: (string | undefined)[] = [];
          if (bookingToDelete?.guestSubmittedData) {
              const guestData = bookingToDelete.guestSubmittedData;
              urlsToDelete.push(
                  guestData.hauptgastAusweisVorderseiteUrl,
                  guestData.hauptgastAusweisRückseiteUrl,
                  guestData.zahlungsbelegUrl,
              );
              if (guestData.mitreisende && Array.isArray(guestData.mitreisende)) {
                guestData.mitreisende.forEach(mitreisender => {
                    if (mitreisender) {
                      urlsToDelete.push(mitreisender.ausweisVorderseiteUrl);
                      urlsToDelete.push(mitreisender.ausweisRückseiteUrl);
                    }
                });
              }
          }
          for (const url of urlsToDelete) {
              if (url && typeof url === 'string' && url.startsWith('https://firebasestorage.googleapis.com')) {
                  const fileRefPromise = (async () => {
                      try {
                          console.log(`${operationName} Attempting to delete file from Storage: ${url.substring(0,100)}... for booking ${id}.`);
                          const fileStorageRef = storageRefFB(storage, url);
                          await deleteObject(fileStorageRef);
                          console.log(`${operationName} File ${url.substring(0,100)}... deleted from Storage for booking ${id}.`);
                      } catch (fileDeleteError: any) {
                          if ((fileDeleteError as any).code === 'storage/object-not-found') {
                            console.warn(`${operationName} WARN: File ${url.substring(0,100)}... for booking ${id} not found in Storage, skipping deletion: ${fileDeleteError.message}`);
                          } else {
                            console.error(`${operationName} ERROR: Failed to delete file ${url.substring(0,100)}... from Storage for booking ${id}: ${fileDeleteError.message} (Code: ${(fileDeleteError as any).code}). Continuing...`, fileDeleteError);
                          }
                      }
                  })();
                  filesToDeletePromises.push(fileRefPromise);
              }
          }
          batch.delete(docRef);
          console.log(`${operationName} Firestore document ID ${id} added to batch delete.`);
      } else {
          console.warn(`${operationName} Booking document with ID ${id} not found, cannot delete associated files or Firestore doc.`);
      }
    } catch (loopError: any) {
      console.error(`${operationName} Error processing ID "${id}" for deletion: ${loopError.message}. This ID will be skipped in the batch.`, { stack: loopError.stack?.substring(0, 300), bookingId: id });
    }
  }

  try {
    await Promise.all(filesToDeletePromises); // Wait for all file deletions to attempt
    console.log(`${operationName} All file deletion attempts completed.`);
    await batch.commit();
    console.log(`${operationName} Batch commit successful for deletion of relevant booking(s).`);
    return true;
  } catch (error: any) {
     console.error(`${operationName} Error during file deletion or batch commit: ${ids.join(', ')}. Error: "${error.message}"`, error);
     throw new Error(`${operationName} Failed to delete bookings or associated files: ${error.message}`);
  }
}

    