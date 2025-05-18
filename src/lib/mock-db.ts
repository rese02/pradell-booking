
// This file now handles Firestore operations.
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { db, firebaseInitializedCorrectly } from "./firebase"; 
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

// Helper to convert Firestore Timestamps to ISO strings in booking objects
function convertTimestampsToISO(bookingData: any): any {
  const newBookingData = { ...bookingData };
  for (const key in newBookingData) {
    if (newBookingData[key] instanceof Timestamp) {
      newBookingData[key] = newBookingData[key].toDate().toISOString();
    }
  }
  if (newBookingData.guestSubmittedData) {
    for (const key in newBookingData.guestSubmittedData) {
        if (newBookingData.guestSubmittedData[key] instanceof Timestamp) {
            newBookingData.guestSubmittedData[key] = newBookingData.guestSubmittedData[key].toDate().toISOString();
        }
    }
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
       } else {
         console.warn(`[Firestore Helper] Invalid date value for guestSubmittedData.submittedAt: ${newData.guestSubmittedData.submittedAt}. Removing from data to save.`);
         delete newData.guestSubmittedData.submittedAt;
       }
    }
     // geburtsdatum and zahlungsdatum are kept as YYYY-MM-DD strings as per current logic
  }
  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[getBookingsFromFirestore] FATAL: Firestore is not initialized. Cannot fetch bookings. Check Firebase config and server logs.");
    return []; // Return empty or throw error, depending on desired strictness
  }
  try {
    console.log("[getBookingsFromFirestore] Attempting to fetch bookings from Firestore...");
    const bookingsCol = collection(db, "bookings");
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc"));
    const bookingSnapshot = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    console.log(`[getBookingsFromFirestore] Successfully fetched ${bookingList.length} bookings.`);
    return bookingList;
  } catch (error) {
    console.error("[getBookingsFromFirestore] Error fetching bookings from Firestore:", error);
    return [];
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking | null> {
   if (!firebaseInitializedCorrectly || !db) {
    console.error("[addBookingToFirestore] FATAL: Firestore is not initialized. Cannot add booking.");
    return null;
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      createdAt: now, 
      updatedAt: now, 
    });
    console.log("[addBookingToFirestore] Attempting to add booking to Firestore. Data to save (pre-conversion):", bookingData);
    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log("[addBookingToFirestore] Booking successfully added to Firestore with ID:", docRef.id);
    return { ...bookingData, id: docRef.id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  } catch (error) {
    console.error("[addBookingToFirestore] Error adding booking to Firestore:", error);
    return null;
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error(`[findBookingByTokenFromFirestore] FATAL: Firestore is not initialized. Cannot find booking for token: "${token}".`);
    return null;
  }
  try {
    console.log(`[findBookingByTokenFromFirestore] Attempting to find booking in Firestore by token: "${token}"`);
    const bookingsCol = collection(db, "bookings");
    const q = query(bookingsCol, where("bookingToken", "==", token));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`[findBookingByTokenFromFirestore] Successfully found booking with token "${token}", ID: ${booking.id}`);
      return booking;
    }
    console.warn(`[findBookingByTokenFromFirestore] Booking with token "${token}" NOT FOUND in Firestore.`);
    return null;
  } catch (error) {
    console.error(`[findBookingByTokenFromFirestore] Error finding booking by token "${token}" in Firestore:`, error);
    return null;
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error(`[findBookingByIdFromFirestore] FATAL: Firestore is not initialized. Cannot find booking for ID: "${id}".`);
    return null;
  }
  try {
    console.log(`[findBookingByIdFromFirestore] Attempting to find booking in Firestore by ID: "${id}"`);
    const docRef = doc(db, "bookings", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`[findBookingByIdFromFirestore] Successfully found booking with ID "${id}"`);
      return booking;
    }
    console.warn(`[findBookingByIdFromFirestore] Booking with ID "${id}" NOT FOUND in Firestore.`);
    return null;
  } catch (error) {
    console.error(`[findBookingByIdFromFirestore] Error finding booking by ID "${id}" in Firestore:`, error);
    return null;
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error(`[updateBookingInFirestore] FATAL: Firestore is not initialized. Cannot update booking with ID: "${id}".`);
    return false;
  }
  try {
    console.log(`[updateBookingInFirestore] Attempting to update booking in Firestore with ID: "${id}". Updates (pre-conversion):`, updates);
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), 
    });

    // Ensure guestSubmittedData is handled correctly (merge if it exists)
    if (updates.guestSubmittedData) {
        const currentBookingDoc = await getDoc(docRef); // Get current document to merge guestSubmittedData
        if (currentBookingDoc.exists()) {
            const currentBookingData = currentBookingDoc.data() as Booking;
            dataToUpdate.guestSubmittedData = {
                ...(currentBookingData.guestSubmittedData || {}), // Merge with existing guest data
                ...dataToUpdate.guestSubmittedData, // Apply new updates to guest data
            };
        }
    }
    
    await updateDoc(docRef, dataToUpdate);
    console.log(`[updateBookingInFirestore] Booking with ID "${id}" updated successfully in Firestore.`);
    return true;
  } catch (error) {
    console.error(`[updateBookingInFirestore] Error updating booking with ID "${id}" in Firestore:`, error);
    return false;
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<boolean> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[deleteBookingsFromFirestoreByIds] FATAL: Firestore is not initialized. Cannot delete bookings.");
    return false;
  }
  if (!ids || ids.length === 0) {
    console.warn("[deleteBookingsFromFirestoreByIds] No IDs provided for deletion.");
    return true; 
  }

  try {
    console.log(`[deleteBookingsFromFirestoreByIds] Attempting to delete ${ids.length} bookings from Firestore: ${ids.join(', ')}`);
    const batch = writeBatch(db);
    ids.forEach(id => {
      const docRef = doc(db, "bookings", id);
      batch.delete(docRef);
    });
    await batch.commit();
    console.log(`[deleteBookingsFromFirestoreByIds] Successfully deleted ${ids.length} bookings from Firestore.`);
    return true;
  } catch (error) {
    console.error(`[deleteBookingsFromFirestoreByIds] Error deleting bookings from Firestore: ${ids.join(', ')}`, error);
    return false;
  }
}
