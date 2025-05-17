
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking } from "@/lib/definitions";
import { MOCK_BOOKINGS_DB } from "@/lib/mock-db";

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
  const validatedFields = createBookingSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      bookingToken: null,
    };
  }

  const bookingData = validatedFields.data;

  try {
    const newBookingId = (MOCK_BOOKINGS_DB.length + 1).toString(); // Simple mock ID
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
      roomIdentifier: `${bookingData.zimmertyp} (Details folgen)`, // Or more sophisticated logic
      // guestSubmittedData is initially undefined
    };

    MOCK_BOOKINGS_DB.unshift(newBooking); // Add to the beginning of the array
    console.log("Updated MOCK_BOOKINGS_DB:", MOCK_BOOKINGS_DB);


    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${newBookingId}`); // Revalidate detail page too if someone navigates there
    revalidatePath(`/buchung/${newBookingToken}`); // Revalidate guest page

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      bookingToken: newBookingToken,
      errors: null
    };
  } catch (e) {
    console.error("Error creating booking:", e);
    return { message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", errors: null, bookingToken: null };
  }
}

export async function submitGuestPersonalDataAction(bookingToken: string, prevState: any, formData: FormData) {
  const validatedFields = guestPersonalDataSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der persönlichen Daten.",
      success: false,
    };
  }

  try {
    const bookingIndex = MOCK_BOOKINGS_DB.findIndex(b => b.bookingToken === bookingToken);
    if (bookingIndex === -1) {
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData = {
      ...(MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData || {}),
      ...validatedFields.data,
      submittedAt: new Date().toISOString(),
    };
    // MOCK_BOOKINGS_DB[bookingIndex].status = "Awaiting Confirmation"; // Or "Confirmed" depending on flow

    console.log(`Submitted personal data for booking ${bookingToken}:`, validatedFields.data);
    
    revalidatePath(`/buchung/${bookingToken}`);
    revalidatePath("/admin/dashboard"); 
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${MOCK_BOOKINGS_DB[bookingIndex].id}`);


    return { message: "Persönliche Daten erfolgreich übermittelt.", errors: null, success: true };
  } catch (e) {
    console.error("Error submitting personal data:", e);
    return { message: "Datenbankfehler: Persönliche Daten konnten nicht übermittelt werden.", errors: null, success: false };
  }
}

export async function submitGuestDocumentsAction(bookingToken: string, prevState: any, formData: FormData) {
  const documents = formData.getAll('documents'); 
  console.log(`Uploading documents for booking ${bookingToken}:`, documents);

  const bookingIndex = MOCK_BOOKINGS_DB.findIndex(b => b.bookingToken === bookingToken);
  if (bookingIndex === -1) {
    return { message: "Buchung nicht gefunden.", errors: null, success: false };
  }

  let success = true;
  let message = "Dokumente 'simuliert' hochgeladen.";
  const uploadedDocumentUrls: string[] = MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData?.documentUrls || [];

  if (documents.length === 0 || (documents[0] instanceof File && (documents[0] as File).size === 0)) {
    console.log("No documents uploaded or empty file.");
    // If documents are optional, this is not an error. If required, handle accordingly.
    // For now, we assume optional means no change if no files.
    message = "Keine neuen Dokumente zum Hochladen ausgewählt.";
  } else {
    for (const doc of documents) {
      if(doc instanceof File && doc.size > 0) {
        const mockUrl = `https://placehold.co/uploads/mock_${Date.now()}_${doc.name.replace(/\s+/g, '_')}`;
        uploadedDocumentUrls.push(mockUrl);
        console.log(`Uploaded ${doc.name} to ${mockUrl}`);
      } else if (doc instanceof File && doc.size === 0) {
        console.log(`Skipped empty file: ${doc.name}`);
      } else {
        console.warn("Item in documents is not a file or has no size:", doc);
      }
    }
    MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData = {
        ...(MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData || {}),
        documentUrls: uploadedDocumentUrls,
        submittedAt: MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData?.submittedAt || new Date().toISOString(),
    };
    message = "Dokumente erfolgreich aktualisiert.";
  }

  revalidatePath(`/buchung/${bookingToken}`);
  revalidatePath(`/admin/bookings/${MOCK_BOOKINGS_DB[bookingIndex].id}`);
  return { message, errors: null, success };
}


export async function submitGuestSpecialRequestsAction(bookingToken: string, prevState: any, formData: FormData) {
  const validatedFields = guestSpecialRequestsSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Sonderwünsche.",
      success: false,
    };
  }

  try {
    const bookingIndex = MOCK_BOOKINGS_DB.findIndex(b => b.bookingToken === bookingToken);
    if (bookingIndex === -1) {
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData = {
      ...(MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData || {}),
      specialRequests: validatedFields.data.specialRequests || '',
      submittedAt: MOCK_BOOKINGS_DB[bookingIndex].guestSubmittedData?.submittedAt || new Date().toISOString(),
    };
    MOCK_BOOKINGS_DB[bookingIndex].status = "Confirmed";

    console.log(`Submitting special requests for booking ${bookingToken}:`, validatedFields.data);
    
    revalidatePath(`/buchung/${bookingToken}`);
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${MOCK_BOOKINGS_DB[bookingIndex].id}`);
    
    return { message: "Sonderwünsche erfolgreich übermittelt. Buchung abgeschlossen!", success: true, errors: null };
  } catch (e) {
    console.error("Error submitting special requests:", e);
    return { message: "Datenbankfehler: Sonderwünsche konnten nicht übermittelt werden.", success: false, errors: null };
  }
}
