
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { 
  addMockBooking, 
  findMockBookingByToken, 
  updateMockBookingByToken,
  getMockBookings 
} from "@/lib/mock-db";

// --- Zod Schemas ---

const createBookingSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich."),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich."),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number().int().min(0, "Anzahl Erwachsene muss positiv sein."),
  kinder: z.coerce.number().int().min(0, "Anzahl Kinder muss positiv sein.").optional(),
  kleinkinder: z.coerce.number().int().min(0, "Anzahl Kleinkinder muss positiv sein.").optional(),
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

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

const fileSchema = z.instanceof(File)
  .refine((file) => file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 5MB.`)
  .refine(
    (file) => file.size === 0 || ACCEPTED_IMAGE_TYPES.includes(file.type),
    "Nur .jpg, .png und .pdf Dateien sind erlaubt."
  ).optional();


const hauptgastSchema = z.object({
  fullName: z.string().min(1, "Vorname ist erforderlich."),
  lastName: z.string().min(1, "Nachname ist erforderlich."),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  phone: z.string().min(1, "Telefonnummer ist erforderlich."),
  alter: z.coerce.number().int().positive("Alter muss eine positive Zahl sein.").optional().or(z.literal("")), // Allow empty string for optional number
  ausweisVorderseite: fileSchema,
  ausweisRückseite: fileSchema,
  specialRequests: z.string().optional(),
  datenschutz: z.literal("on", { // Checkbox value is "on" when checked
    errorMap: () => ({ message: "Sie müssen den Datenschutzbestimmungen zustimmen." }),
  }),
  // addressLine1: z.string().min(1, "Adresse Zeile 1 ist erforderlich."), // These were from old form
  // addressLine2: z.string().optional(),
  // city: z.string().min(1, "Stadt ist erforderlich."),
  // postalCode: z.string().min(1, "Postleitzahl ist erforderlich."),
  // country: z.string().min(1, "Land ist erforderlich."),
});


// --- Server Actions ---

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
      roomIdentifier: `${bookingData.zimmertyp}`, // Simplified identifier
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath("/admin/bookings", "page");
    revalidatePath(`/admin/bookings/${newBookingId}`, "page"); 
    revalidatePath(`/buchung/${newBookingToken}`, "layout"); // Revalidate layout for guest page too

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

// Renamed and updated action for the "Hauptgast" step
export async function submitHauptgastAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitHauptgastAction] For token: ${bookingToken}. Data Entries:`, Array.from(formData.entries()));
  
  const rawFormData = Object.fromEntries(formData.entries());
  console.log("[Action submitHauptgastAction] Raw form data for validation:", rawFormData);

  const validatedFields = hauptgastSchema.safeParse(rawFormData);

  if (!validatedFields.success) {
    console.error("[Action submitHauptgastAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Daten des Hauptgastes.",
      success: false,
    };
  }
  
  const data = validatedFields.data;
  console.log("[Action submitHauptgastAction] Validated data:", data);

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action submitHauptgastAction] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    const guestSubmittedDataUpdate: Partial<GuestSubmittedData> = {
      fullName: data.fullName, // This should be the Hauptbucher's full name, or we split guestFirstName/LastName
      guestFirstName: data.fullName, // Assuming fullName is for the first name for now
      guestLastName: data.lastName,
      email: data.email,
      phone: data.phone,
      alter: data.alter,
      specialRequests: data.specialRequests,
      datenschutzAkzeptiert: data.datenschutz === "on",
      submittedAt: new Date().toISOString(),
      // addressLine1: data.addressLine1, // Keep if needed, but not on new form
      // city: data.city,
      // postalCode: data.postalCode,
      // country: data.country,
    };

    const documentUrls = booking.guestSubmittedData?.documentUrls || [];
    // Simulate file upload for Vorderseite
    if (data.ausweisVorderseite && data.ausweisVorderseite.size > 0) {
        const vorderseiteUrl = `https://placehold.co/uploads/mock_${Date.now()}_vorderseite_${data.ausweisVorderseite.name.replace(/\s+/g, '_')}`;
        documentUrls.push(vorderseiteUrl);
        console.log(`[Action submitHauptgastAction] Mock uploaded ausweisVorderseite to ${vorderseiteUrl}`);
    }
    // Simulate file upload for Rückseite
    if (data.ausweisRückseite && data.ausweisRückseite.size > 0) {
        const rueckseiteUrl = `https://placehold.co/uploads/mock_${Date.now()}_rueckseite_${data.ausweisRückseite.name.replace(/\s+/g, '_')}`;
        documentUrls.push(rueckseiteUrl);
        console.log(`[Action submitHauptgastAction] Mock uploaded ausweisRückseite to ${rueckseiteUrl}`);
    }
    guestSubmittedDataUpdate.documentUrls = documentUrls;
    
    const success = updateMockBookingByToken(bookingToken, { 
      guestFirstName: data.fullName, // Update top-level booking names too
      guestLastName: data.lastName,
      guestSubmittedData: {
        ...(booking.guestSubmittedData || {}),
        ...guestSubmittedDataUpdate
      }
      // Status is not changed yet, only after the final step.
    });

    if (success) {
      console.log(`[Action submitHauptgastAction] Hauptgast data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); // Revalidate layout for potential display changes
      revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: "Daten des Hauptgastes erfolgreich übermittelt.", errors: null, success: true };
    } else {
      console.error(`[Action submitHauptgastAction] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung.", errors: null, success: false };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action submitHauptgastAction] Error submitting Hauptgast data:", error.message, error.stack);
    return { message: "Datenbankfehler: Daten konnten nicht übermittelt werden.", errors: null, success: false };
  }
}


// --- Legacy Actions (keep for now or remove if fully replaced) ---

// This action is likely replaced by submitHauptgastAction logic
export async function submitGuestDocumentsAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitGuestDocumentsAction] For token: ${bookingToken}`);
  // ... (This logic needs to be merged or deprecated)
  return { message: "Dokument-Upload-Aktion ist veraltet. Logik in Hauptgast-Aktion integriert.", errors: null, success: true };
}


export async function submitGuestSpecialRequestsAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitGuestSpecialRequestsAction] For token: ${bookingToken}`);
  // ... (This logic needs to be merged or deprecated)
  // For now, let's assume this is the final step and confirms the booking.
  const booking = findMockBookingByToken(bookingToken);
  if (!booking) return { message: "Buchung nicht gefunden", success: false };

  const success = updateMockBookingByToken(bookingToken, { status: "Confirmed" });
  if (success) {
    revalidatePath(`/buchung/${bookingToken}`, "layout");
    revalidatePath(`/admin/bookings/${booking.id}`, "page");
    return { message: "Buchung abgeschlossen (via Placeholder).", success: true, errors: null };
  }
  return { message: "Fehler beim Bestätigen (Placeholder).", success: false, errors: null };
}
