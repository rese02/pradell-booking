
// This file now handles Firestore operations and should ideally be renamed,
// e.g., to firestore-service.ts, but keeping name for diff clarity for now.
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { db, firebaseInitializedCorrectly } from "./firebase"; // Import Firestore instance
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
  if (newBookingData.createdAt instanceof Timestamp) {
    newBookingData.createdAt = newBookingData.createdAt.toDate().toISOString();
  }
  if (newBookingData.updatedAt instanceof Timestamp) {
    newBookingData.updatedAt = newBookingData.updatedAt.toDate().toISOString();
  }
  if (newBookingData.checkInDate instanceof Timestamp) {
    newBookingData.checkInDate = newBookingData.checkInDate.toDate().toISOString();
  }
  if (newBookingData.checkOutDate instanceof Timestamp) {
    newBookingData.checkOutDate = newBookingData.checkOutDate.toDate().toISOString();
  }
  if (newBookingData.guestSubmittedData?.submittedAt instanceof Timestamp) {
    newBookingData.guestSubmittedData.submittedAt = newBookingData.guestSubmittedData.submittedAt.toDate().toISOString();
  }
  // Convert other potential Timestamps as needed
  return newBookingData;
}

// Helper to convert date strings or Date objects to Firestore Timestamps for saving
function convertDatesToTimestamps(data: any): any {
  const newData = { ...data };
  const dateFields = ['checkInDate', 'checkOutDate', 'createdAt', 'updatedAt'];
  dateFields.forEach(field => {
    if (newData[field]) {
      const dateValue = (typeof newData[field] === 'string' || newData[field] instanceof Date) ? new Date(newData[field]) : null;
      if (dateValue && !isNaN(dateValue.getTime())) {
        newData[field] = Timestamp.fromDate(dateValue);
      } else {
        delete newData[field]; // Remove invalid date fields
      }
    }
  });

  if (newData.guestSubmittedData) {
    newData.guestSubmittedData = { ...newData.guestSubmittedData }; // Clone to avoid modifying original
    if (newData.guestSubmittedData.submittedAt) {
       const submittedAtDate = (typeof newData.guestSubmittedData.submittedAt === 'string' || newData.guestSubmittedData.submittedAt instanceof Date) ? new Date(newData.guestSubmittedData.submittedAt) : null;
       if (submittedAtDate && !isNaN(submittedAtDate.getTime())) {
          newData.guestSubmittedData.submittedAt = Timestamp.fromDate(submittedAtDate);
       } else {
         delete newData.guestSubmittedData.submittedAt;
       }
    }
     if (newData.guestSubmittedData.geburtsdatum && typeof newData.guestSubmittedData.geburtsdatum === 'string') {
        // Geburtsdatum wird als String 'YYYY-MM-DD' gespeichert, nicht als Timestamp
     }
     if (newData.guestSubmittedData.zahlungsdatum && typeof newData.guestSubmittedData.zahlungsdatum === 'string') {
        // Zahlungsdatum wird als String 'YYYY-MM-DD' gespeichert, nicht als Timestamp
     }
  }
  return newData;
}


export async function getBookingsFromFirestore(): Promise<Booking[]> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[getBookingsFromFirestore] Firestore is not initialized.");
    return [];
  }
  try {
    const bookingsCol = collection(db, "bookings");
    // Order by creation date, newest first
    const bookingsQuery = query(bookingsCol, orderBy("createdAt", "desc"));
    const bookingSnapshot = await getDocs(bookingsQuery);
    const bookingList = bookingSnapshot.docs.map(docSnap =>
      convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking
    );
    console.log(`[getBookingsFromFirestore] Fetched ${bookingList.length} bookings.`);
    return bookingList;
  } catch (error) {
    console.error("[getBookingsFromFirestore] Error fetching bookings:", error);
    return [];
  }
}

export async function addBookingToFirestore(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking | null> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[addBookingToFirestore] Firestore is not initialized.");
    return null;
  }
  try {
    const now = new Date();
    const dataToSave = convertDatesToTimestamps({
      ...bookingData,
      createdAt: now, // Firestore will convert to Timestamp
      updatedAt: now, // Firestore will convert to Timestamp
    });

    const docRef = await addDoc(collection(db, "bookings"), dataToSave);
    console.log("[addBookingToFirestore] Booking added with ID:", docRef.id);
    return { ...bookingData, id: docRef.id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  } catch (error) {
    console.error("[addBookingToFirestore] Error adding booking:", error);
    return null;
  }
}

export async function findBookingByTokenFromFirestore(token: string): Promise<Booking | null> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[findBookingByTokenFromFirestore] Firestore is not initialized.");
    return null;
  }
  try {
    const bookingsCol = collection(db, "bookings");
    const q = query(bookingsCol, where("bookingToken", "==", token));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`[findBookingByTokenFromFirestore] Found booking with token "${token}", ID: ${booking.id}`);
      return booking;
    }
    console.warn(`[findBookingByTokenFromFirestore] Booking with token "${token}" NOT FOUND.`);
    return null;
  } catch (error) {
    console.error(`[findBookingByTokenFromFirestore] Error finding booking by token "${token}":`, error);
    return null;
  }
}

export async function findBookingByIdFromFirestore(id: string): Promise<Booking | null> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[findBookingByIdFromFirestore] Firestore is not initialized.");
    return null;
  }
  try {
    const docRef = doc(db, "bookings", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const booking = convertTimestampsToISO({ ...docSnap.data(), id: docSnap.id }) as Booking;
      console.log(`[findBookingByIdFromFirestore] Found booking with ID "${id}"`);
      return booking;
    }
    console.warn(`[findBookingByIdFromFirestore] Booking with ID "${id}" NOT FOUND.`);
    return null;
  } catch (error) {
    console.error(`[findBookingByIdFromFirestore] Error finding booking by ID "${id}":`, error);
    return null;
  }
}

export async function updateBookingInFirestore(id: string, updates: Partial<Booking>): Promise<boolean> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[updateBookingInFirestore] Firestore is not initialized.");
    return false;
  }
  try {
    const docRef = doc(db, "bookings", id);
    const dataToUpdate = convertDatesToTimestamps({
        ...updates,
        updatedAt: new Date(), // Firestore will convert to Timestamp
    });

    // Ensure guestSubmittedData is handled correctly
    if (updates.guestSubmittedData) {
        const currentBooking = await findBookingByIdFromFirestore(id);
        if (currentBooking && currentBooking.guestSubmittedData) {
            dataToUpdate.guestSubmittedData = {
                ...currentBooking.guestSubmittedData,
                ...updates.guestSubmittedData,
            };
        }
        // Convert dates within guestSubmittedData if necessary
        if (dataToUpdate.guestSubmittedData?.submittedAt) {
             dataToUpdate.guestSubmittedData.submittedAt = Timestamp.fromDate(new Date(dataToUpdate.guestSubmittedData.submittedAt));
        }
    }


    await updateDoc(docRef, dataToUpdate);
    console.log(`[updateBookingInFirestore] Booking with ID "${id}" updated successfully.`);
    return true;
  } catch (error) {
    console.error(`[updateBookingInFirestore] Error updating booking with ID "${id}":`, error);
    return false;
  }
}

export async function deleteBookingsFromFirestoreByIds(ids: string[]): Promise<boolean> {
  if (!firebaseInitializedCorrectly || !db) {
    console.error("[deleteBookingsFromFirestoreByIds] Firestore is not initialized.");
    return false;
  }
  if (!ids || ids.length === 0) {
    console.warn("[deleteBookingsFromFirestoreByIds] No IDs provided for deletion.");
    return true; // No operation needed, consider it a success.
  }

  try {
    const batch = writeBatch(db);
    ids.forEach(id => {
      const docRef = doc(db, "bookings", id);
      batch.delete(docRef);
    });
    await batch.commit();
    console.log(`[deleteBookingsFromFirestoreByIds] Successfully deleted ${ids.length} bookings from Firestore: ${ids.join(', ')}`);
    return true;
  } catch (error) {
    console.error(`[deleteBookingsFromFirestoreByIds] Error deleting bookings: ${ids.join(', ')}`, error);
    return false;
  }
}
