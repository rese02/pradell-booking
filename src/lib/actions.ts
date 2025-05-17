
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
// import { redirect } from "next/navigation"; // Not used yet, but good to have for later

// Define Zod schemas for validation
const createBookingSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  // roomIdentifier is removed, replaced by zimmertyp etc.
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich."),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich."),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number().int().min(0, "Anzahl Erwachsene muss positiv sein."), // Typically min 1 for a booking, but 0 might be allowed if only children
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
    path: ["checkOutDate"], // or a general path if preferred
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

// For document upload, we'd handle File objects, but that's more complex for pure server actions without client-side preprocessing or direct API calls.
// For now, this placeholder won't directly handle file uploads.

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
    // Simulate database operation
    console.log("Creating booking with new details:", bookingData);
    const bookingToken = Math.random().toString(36).substring(2, 15); // Generate mock token
    console.log("Generated booking token:", bookingToken);
    
    // In a real app, save to DB and get ID and token
    // await db.bookings.create({ 
    //   guestFirstName: bookingData.guestFirstName,
    //   guestLastName: bookingData.guestLastName,
    //   price: bookingData.price,
    //   checkInDate: new Date(bookingData.checkInDate),
    //   checkOutDate: new Date(bookingData.checkOutDate),
    //   bookingToken, 
    //   status: "Pending Guest Information",
    //   // Add other new fields like:
    //   // verpflegung: bookingData.verpflegung,
    //   // zimmertyp: bookingData.zimmertyp,
    //   // erwachsene: bookingData.erwachsene,
    //   // kinder: bookingData.kinder,
    //   // kleinkinder: bookingData.kleinkinder,
    //   // alterKinder: bookingData.alterKinder,
    //   // interneBemerkungen: bookingData.interneBemerkungen,
    //   // roomIdentifier: bookingData.zimmertyp, // Or a combination, or handle room assignment differently
    // });

    revalidatePath("/admin/dashboard"); // Revalidate to show new booking
    revalidatePath("/admin/bookings"); // Ensure the bookings list page is also revalidated
    
    return { message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${bookingToken}`, bookingToken, errors: null };
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
    console.log(`Submitting personal data for booking ${bookingToken}:`, validatedFields.data);
    // In a real app, find booking by token and update it with guest data
    // await db.bookings.update({ where: { token: bookingToken }, data: { guestSubmittedData: { ...validatedFields.data }, status: "Awaiting Confirmation" } });
    
    revalidatePath(`/buchung/${bookingToken}`);
    revalidatePath("/admin/dashboard"); // Also revalidate admin views
    revalidatePath("/admin/bookings");

    return { message: "Persönliche Daten erfolgreich übermittelt.", errors: null, success: true };
  } catch (e) {
    console.error("Error submitting personal data:", e);
    return { message: "Datenbankfehler: Persönliche Daten konnten nicht übermittelt werden.", errors: null, success: false };
  }
}

export async function submitGuestDocumentsAction(bookingToken: string, prevState: any, formData: FormData) {
  const documents = formData.getAll('documents'); 
  console.log(`Uploading documents for booking ${bookingToken}:`, documents);

  let success = true;
  let message = "Dokumente 'simuliert' hochgeladen.";

  if (documents.length === 0 || (documents[0] instanceof File && (documents[0] as File).size === 0)) {
    console.log("No documents uploaded or empty file.");
    message = "Keine Dokumente zum Hochladen ausgewählt.";
    // success can remain true if documents are optional. If required, set success = false.
  } else {
    const uploadedDocumentUrls: string[] = [];
    for (const doc of documents) {
      if(doc instanceof File && doc.size > 0) {
        // Simulate upload and get URL
        const mockUrl = `https://placehold.co/uploads/mock_${doc.name.replace(/\s+/g, '_')}`;
        uploadedDocumentUrls.push(mockUrl);
        console.log(`Uploaded ${doc.name} to ${mockUrl}`);
      } else if (doc instanceof File && doc.size === 0) {
        console.log(`Skipped empty file: ${doc.name}`);
      } else {
        console.warn("Item in documents is not a file or has no size:", doc);
      }
    }
    // In a real app, update booking with document URLs
    // await db.bookings.update({ where: { token: bookingToken }, data: { guestSubmittedData: { documentUrls: uploadedDocumentUrls } } });
  }

  revalidatePath(`/buchung/${bookingToken}`);
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
    console.log(`Submitting special requests for booking ${bookingToken}:`, validatedFields.data);
    // In a real app, update booking with special requests and potentially change status to "Confirmed" or "Awaiting Confirmation"
    // await db.bookings.update({ where: { token: bookingToken }, data: { guestSubmittedData: { specialRequests: validatedFields.data.specialRequests }, status: "Confirmed" } });

    revalidatePath(`/buchung/${bookingToken}`);
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/bookings");
    
    return { message: "Sonderwünsche erfolgreich übermittelt. Buchung abgeschlossen!", success: true, errors: null };
  } catch (e) {
    console.error("Error submitting special requests:", e);
    return { message: "Datenbankfehler: Sonderwünsche konnten nicht übermittelt werden.", success: false, errors: null };
  }
}

    