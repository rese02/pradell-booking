
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { 
  addMockBooking, 
  findMockBookingByToken, 
  updateMockBookingByToken,
  getMockBookings // For logging/debugging if needed
} from "@/lib/mock-db";

// Define Zod schemas for validation
const createBookingSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich."),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich."),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number().int().min(0, "Anzahl Erwachsene muss positiv sein."),
  kinder: z.coerce.number().int().min(0, "Anzahl Kinder muss positiv sein."),
  kleinkinder: z.coerce.number().int().min(0, "Anzahl Kleinkinder muss positiv sein."),
  alterKinder: z.string().optional(),
  interneBemerkungen: z.string().optional(),
}).refine(data => {
    if (data.checkInDate && data.checkOutDate) {
        return new Date(data.checkOutDate) > new Date(data.checkInDate);
    }
    return true;
}, {
    message: "Abreisedatum muss nach dem Anreisedatum liegen.",
    path: ["checkOutDate"],
});


const guestPersonalDataSchema = z.object({
  fullName: z.string().min(1, "Vollständiger Name ist erforderlich."),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  phone: z.string().min(1, "Telefonnummer ist erforderlich."),
  addressLine1: z.string().min(1, "Adresse Zeile 1 ist erforderlich."),
  addressLine2: z.string().optional(),
  city: z.string().min(1, "Stadt ist erforderlich."),
  postalCode: z.string().min(1, "Postleitzahl ist erforderlich."),
  country: z.string().min(1, "Land ist erforderlich."),
});

const guestSpecialRequestsSchema = z.object({
  specialRequests: z.string().optional(),
});


export async function createBookingAction(prevState: any, formData: FormData) {
  console.log("[Action createBookingAction] Received form data:", Object.fromEntries(formData.entries()));
  const validatedFields = createBookingSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      bookingToken: null,
    };
  }

  const bookingData = validatedFields.data;

  try {
    // Generate ID and Token
    // For ID, ensure it's unique. Using timestamp + random for mock.
    const newBookingId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    const newBookingToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const newBooking: Booking = {
      id: newBookingId,
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      verpflegung: bookingData.verpflegung,
      zimmertyp: bookingData.zimmertyp,
      erwachsene: bookingData.erwachsene,
      kinder: bookingData.kinder,
      kleinkinder: bookingData.kleinkinder,
      alterKinder: bookingData.alterKinder || '',
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: `${bookingData.zimmertyp}`,
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added to mock DB. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    // Log current state of DB after adding
    const currentBookings = getMockBookings();
    console.log(`[Action createBookingAction] Mock DB state after add. Count: ${currentBookings.length}. Tokens: ${currentBookings.map(b => b.bookingToken).join(', ')}`);


    revalidatePath("/admin/dashboard", "layout"); // Revalidate layout to ensure dashboard data is fresh
    revalidatePath("/admin/bookings", "page");
    revalidatePath(`/admin/bookings/${newBookingId}`, "page"); 
    revalidatePath(`/buchung/${newBookingToken}`, "page"); 

    console.log(`[Action createBookingAction] Revalidation triggered for relevant paths.`);

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      bookingToken: newBookingToken,
      errors: null
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction] Error creating booking:", error.message, error.stack);
    return { message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", errors: null, bookingToken: null };
  }
}

export async function submitGuestPersonalDataAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitGuestPersonalDataAction] For token: ${bookingToken}. Data:`, Object.fromEntries(formData.entries()));
  const validatedFields = guestPersonalDataSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    console.error("[Action submitGuestPersonalDataAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der persönlichen Daten.",
      success: false,
    };
  }

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action submitGuestPersonalDataAction] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    const guestSubmittedDataUpdate: Partial<GuestSubmittedData> = {
      ...validatedFields.data,
      submittedAt: new Date().toISOString(),
    };
    
    const success = updateMockBookingByToken(bookingToken, { 
      guestSubmittedData: {
        ...(booking.guestSubmittedData || {}),
        ...guestSubmittedDataUpdate
      }
    });

    if (success) {
      console.log(`[Action submitGuestPersonalDataAction] Personal data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "page");
      revalidatePath("/admin/dashboard", "layout"); 
      revalidatePath("/admin/bookings", "page");
      revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: "Persönliche Daten erfolgreich übermittelt.", errors: null, success: true };
    } else {
      console.error(`[Action submitGuestPersonalDataAction] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung.", errors: null, success: false };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action submitGuestPersonalDataAction] Error submitting personal data:", error.message, error.stack);
    return { message: "Datenbankfehler: Persönliche Daten konnten nicht übermittelt werden.", errors: null, success: false };
  }
}

export async function submitGuestDocumentsAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitGuestDocumentsAction] For token: ${bookingToken}`);
  const documents = formData.getAll('documents') as File[]; 
  console.log(`[Action submitGuestDocumentsAction] Uploading documents:`, documents.map(d => ({name: d.name, size: d.size})));

  const booking = findMockBookingByToken(bookingToken);
  if (!booking) {
    console.warn(`[Action submitGuestDocumentsAction] Booking not found for token: ${bookingToken}`);
    return { message: "Buchung nicht gefunden.", errors: null, success: false };
  }

  let message = "Dokumente 'simuliert' hochgeladen.";
  const uploadedDocumentUrls: string[] = booking.guestSubmittedData?.documentUrls || [];

  if (documents.length === 0 || documents.every(doc => doc.size === 0)) {
    console.log("[Action submitGuestDocumentsAction] No documents uploaded or all files are empty.");
    message = "Keine neuen Dokumente zum Hochladen ausgewählt.";
  } else {
    for (const doc of documents) {
      if(doc.size > 0) { // Only process files with content
        // In a real app, upload to cloud storage here and get URL
        const mockUrl = `https://placehold.co/uploads/mock_${Date.now()}_${doc.name.replace(/\s+/g, '_')}`;
        uploadedDocumentUrls.push(mockUrl);
        console.log(`[Action submitGuestDocumentsAction] Mock uploaded ${doc.name} to ${mockUrl}`);
      } else {
        console.log(`[Action submitGuestDocumentsAction] Skipped empty file: ${doc.name}`);
      }
    }
  }
  
  const success = updateMockBookingByToken(bookingToken, { 
    guestSubmittedData: {
      ...(booking.guestSubmittedData || {}),
      documentUrls: uploadedDocumentUrls,
      submittedAt: booking.guestSubmittedData?.submittedAt || new Date().toISOString()
    }
  });

  if (success) {
    console.log(`[Action submitGuestDocumentsAction] Documents updated for token: ${bookingToken}`);
    revalidatePath(`/buchung/${bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${booking.id}`, "page");
    return { message, errors: null, success: true };
  } else {
    console.error(`[Action submitGuestDocumentsAction] Failed to update documents for token: ${bookingToken}`);
    return { message: "Fehler beim Aktualisieren der Dokumente.", errors: null, success: false };
  }
}


export async function submitGuestSpecialRequestsAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitGuestSpecialRequestsAction] For token: ${bookingToken}. Data:`, Object.fromEntries(formData.entries()));
  const validatedFields = guestSpecialRequestsSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    console.error("[Action submitGuestSpecialRequestsAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Sonderwünsche.",
      success: false,
    };
  }

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action submitGuestSpecialRequestsAction] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    const success = updateMockBookingByToken(bookingToken, {
      guestSubmittedData: {
        ...(booking.guestSubmittedData || {}),
        specialRequests: validatedFields.data.specialRequests || '',
        submittedAt: booking.guestSubmittedData?.submittedAt || new Date().toISOString(),
      },
      status: "Confirmed" // Final step, so confirm the booking
    });

    if (success) {
      console.log(`[Action submitGuestSpecialRequestsAction] Special requests submitted and booking confirmed for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "page");
      revalidatePath("/admin/dashboard", "layout");
      revalidatePath("/admin/bookings", "page");
      revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: "Sonderwünsche erfolgreich übermittelt. Buchung abgeschlossen!", success: true, errors: null };
    } else {
      console.error(`[Action submitGuestSpecialRequestsAction] Failed to update special requests for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Sonderwünsche.", success: false, errors: null };
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action submitGuestSpecialRequestsAction] Error submitting special requests:", error.message, error.stack);
    return { message: "Datenbankfehler: Sonderwünsche konnten nicht übermittelt werden.", success: false, errors: null };
  }
}
