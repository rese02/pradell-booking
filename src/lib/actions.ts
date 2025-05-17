"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
// import { redirect } from "next/navigation"; // Not used yet, but good to have for later

// Define Zod schemas for validation
const createBookingSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  roomIdentifier: z.string().min(1, "Zimmernummer/-auswahl ist erforderlich."),
  checkInDate: z.string().optional(),
  checkOutDate: z.string().optional(),
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
      message: "Fehler bei der Validierung.",
    };
  }

  const { guestFirstName, guestLastName, price, roomIdentifier, checkInDate, checkOutDate } = validatedFields.data;

  try {
    // Simulate database operation
    console.log("Creating booking:", { guestFirstName, guestLastName, price, roomIdentifier, checkInDate, checkOutDate });
    const bookingToken = Math.random().toString(36).substring(2, 15); // Generate mock token
    console.log("Generated booking token:", bookingToken);
    
    // In a real app, save to DB and get ID and token
    // await db.bookings.create({ ...validatedFields.data, bookingToken, status: "Pending Guest Information" });

    revalidatePath("/admin/dashboard"); // Revalidate to show new booking
    revalidatePath("/admin/bookings");
    
    return { message: `Buchung für ${guestFirstName} ${guestLastName} erstellt. Token: ${bookingToken}`, bookingToken, errors: {} };
  } catch (e) {
    console.error("Error creating booking:", e);
    return { message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", errors: {} };
  }
}

export async function submitGuestPersonalDataAction(bookingToken: string, prevState: any, formData: FormData) {
  const validatedFields = guestPersonalDataSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der persönlichen Daten.",
    };
  }

  try {
    console.log(`Submitting personal data for booking ${bookingToken}:`, validatedFields.data);
    // In a real app, find booking by token and update it with guest data
    // await db.bookings.update({ where: { token: bookingToken }, data: { guestSubmittedData: { ...validatedFields.data }, status: "Awaiting Confirmation" } });
    
    revalidatePath(`/buchung/${bookingToken}`);
    revalidatePath("/admin/dashboard"); // Also revalidate admin views
    revalidatePath("/admin/bookings");

    return { message: "Persönliche Daten erfolgreich übermittelt.", errors: {} };
  } catch (e) {
    console.error("Error submitting personal data:", e);
    return { message: "Datenbankfehler: Persönliche Daten konnten nicht übermittelt werden.", errors: {} };
  }
}

export async function submitGuestDocumentsAction(bookingToken: string, prevState: any, formData: FormData) {
  // formData here would contain File objects for 'documents'
  // This is a placeholder for document upload logic.
  // Actual implementation requires file handling, storage (e.g., Firebase Storage), and saving URLs to DB.
  
  const documents = formData.getAll('documents'); // Assuming input name is 'documents'
  console.log(`Uploading documents for booking ${bookingToken}:`, documents);

  if (documents.length === 0 || (documents[0] as File).size === 0) {
     // No files uploaded, this might be acceptable or an error depending on requirements
     // For now, let's say it's okay and proceed.
    console.log("No documents uploaded or empty file.");
    // return { message: "Keine Dokumente hochgeladen.", errors: {} };
  } else {
    // Simulate document upload process
    const uploadedDocumentUrls: string[] = [];
    for (const doc of documents) {
      if((doc as File).size > 0) {
        // Simulate upload and get URL
        const mockUrl = `https://placehold.co/uploads/mock_${(doc as File).name}`;
        uploadedDocumentUrls.push(mockUrl);
        console.log(`Uploaded ${(doc as File).name} to ${mockUrl}`);
      }
    }
    // In a real app, update booking with document URLs
    // await db.bookings.update({ where: { token: bookingToken }, data: { guestSubmittedData: { documentUrls: uploadedDocumentUrls } } });
  }


  revalidatePath(`/buchung/${bookingToken}`);
  return { message: "Dokumente 'simuliert' hochgeladen.", errors: {} };
}


export async function submitGuestSpecialRequestsAction(bookingToken: string, prevState: any, formData: FormData) {
  const validatedFields = guestSpecialRequestsSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Sonderwünsche.",
    };
  }

  try {
    console.log(`Submitting special requests for booking ${bookingToken}:`, validatedFields.data);
    // In a real app, update booking with special requests and potentially change status to "Confirmed" or "Awaiting Confirmation"
    // await db.bookings.update({ where: { token: bookingToken }, data: { guestSubmittedData: { specialRequests: validatedFields.data.specialRequests }, status: "Confirmed" } });

    revalidatePath(`/buchung/${bookingToken}`);
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/bookings");
    
    return { message: "Sonderwünsche erfolgreich übermittelt. Buchung abgeschlossen!", success: true, errors: {} };
  } catch (e) {
    console.error("Error submitting special requests:", e);
    return { message: "Datenbankfehler: Sonderwünsche konnten nicht übermittelt werden.", success: false, errors: {} };
  }
}
