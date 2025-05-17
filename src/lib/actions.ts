
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, Mitreisender, PaymentAmountSelectionFormData } from "@/lib/definitions";
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
  ).optional().nullable();


const hauptgastSchema = z.object({
  fullName: z.string().min(1, "Vorname ist erforderlich."),
  lastName: z.string().min(1, "Nachname ist erforderlich."),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  phone: z.string().min(1, "Telefonnummer ist erforderlich."),
  alter: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : Number(val)),
    z.number().int().positive("Alter muss eine positive Zahl sein.").optional().nullable()
  ),
  ausweisVorderseite: fileSchema,
  ausweisRückseite: fileSchema,
  specialRequests: z.string().optional(),
  datenschutz: z.literal("on", { 
    errorMap: () => ({ message: "Sie müssen den Datenschutzbestimmungen zustimmen." }),
  }),
});

const mitreisenderSchema = z.object({
  id: z.string().optional(), 
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
  alter: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : Number(val)),
    z.number().int().positive("Alter muss eine positive Zahl sein.").optional().nullable()
  ),
  ausweisVorderseite: fileSchema,
  ausweisRückseite: fileSchema,
});

const paymentAmountSelectionSchema = z.object({
  paymentSelection: z.enum(['downpayment', 'full_amount'], {
    errorMap: () => ({ message: "Bitte wählen Sie eine Zahlungsoption." }),
  }),
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
      success: false,
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
      roomIdentifier: `${bookingData.zimmertyp}`, 
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath("/admin/bookings", "page"); 
    revalidatePath(`/admin/bookings/${newBookingId}`, "page"); 
    revalidatePath(`/buchung/${newBookingToken}`, "layout");

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      bookingToken: newBookingToken,
      errors: null,
      success: true,
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction] Error creating booking:", error.message, error.stack);
    return { message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", errors: null, bookingToken: null, success: false };
  }
}


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
  console.log("[Action submitHauptgastAction] Validated data (Hauptgast):", data);

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action submitHauptgastAction] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    const currentGuestData = booking.guestSubmittedData || {};
    const existingDocumentUrls = currentGuestData.documentUrls || [];

    const guestSubmittedDataUpdate: GuestSubmittedData = {
      ...currentGuestData,
      fullName: `${data.fullName} ${data.lastName}`,
      guestFirstName: data.fullName,
      guestLastName: data.lastName,
      email: data.email,
      phone: data.phone,
      alter: data.alter ? Number(data.alter) : undefined,
      specialRequests: data.specialRequests,
      datenschutzAkzeptiert: data.datenschutz === "on",
      submittedAt: new Date().toISOString(),
      documentUrls: [...existingDocumentUrls], // Start with existing URLs
    };
    
    if (data.ausweisVorderseite && data.ausweisVorderseite.size > 0) {
        const vorderseiteUrl = `https://placehold.co/uploads/mock_hg_${Date.now()}_v_${data.ausweisVorderseite.name.replace(/\s+/g, '_')}`;
        guestSubmittedDataUpdate.documentUrls!.push(vorderseiteUrl);
        console.log(`[Action submitHauptgastAction] Mock uploaded Hauptgast ausweisVorderseite to ${vorderseiteUrl}`);
    }
    if (data.ausweisRückseite && data.ausweisRückseite.size > 0) {
        const rueckseiteUrl = `https://placehold.co/uploads/mock_hg_${Date.now()}_r_${data.ausweisRückseite.name.replace(/\s+/g, '_')}`;
        guestSubmittedDataUpdate.documentUrls!.push(rueckseiteUrl);
        console.log(`[Action submitHauptgastAction] Mock uploaded Hauptgast ausweisRückseite to ${rueckseiteUrl}`);
    }
    
    const success = updateMockBookingByToken(bookingToken, { 
      guestFirstName: data.fullName, 
      guestLastName: data.lastName,
      guestSubmittedData: guestSubmittedDataUpdate,
    });

    if (success) {
      console.log(`[Action submitHauptgastAction] Hauptgast data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); 
      revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: "Daten des Hauptgastes erfolgreich übermittelt.", errors: null, success: true };
    } else {
      console.error(`[Action submitHauptgastAction] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung.", errors: null, success: false };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action submitHauptgastAction] Error submitting Hauptgast data:", error.message, error.stack);
    return { message: "Serverfehler: Daten konnten nicht übermittelt werden.", errors: null, success: false };
  }
}

export async function submitMitreisendeAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitMitreisendeAction] For token: ${bookingToken}. Data Entries:`, Array.from(formData.entries()));

  const parsedMitreisende: Partial<Mitreisender & { ausweisVorderseite?: File, ausweisRückseite?: File }>[] = [];
  const tempMitreisendeMap: Record<string, Partial<Mitreisender & { ausweisVorderseite?: File, ausweisRückseite?: File }>> = {};

  for (const [key, value] of formData.entries()) {
    const match = key.match(/^mitreisende\[(\d+)\]\[(.+?)\]$/);
    if (match) {
      const index = match[1];
      const field = match[2] as keyof Mitreisender;

      if (!tempMitreisendeMap[index]) {
        tempMitreisendeMap[index] = {};
      }

      if (value instanceof File) {
        if (field === 'ausweisVorderseite' || field === 'ausweisRückseite') {
          (tempMitreisendeMap[index] as any)[field] = value;
        }
      } else if (field === 'alter' && typeof value === 'string') {
         tempMitreisendeMap[index][field] = value === "" ? undefined : Number(value);
      } else if (typeof value === 'string') {
        (tempMitreisendeMap[index] as any)[field] = value;
      }
    }
  }
  Object.keys(tempMitreisendeMap).sort((a,b) => Number(a) - Number(b)).forEach(index => {
    parsedMitreisende.push(tempMitreisendeMap[index]);
  });

  console.log("[Action submitMitreisendeAction] Parsed Mitreisende data before validation:", JSON.stringify(parsedMitreisende.map(p => ({...p, ausweisVorderseite: p.ausweisVorderseite?.name, ausweisRückseite: p.ausweisRückseite?.name })), null, 2));
  
  const validationResults = parsedMitreisende.map((m, idx) => {
    return { index: idx, result: mitreisenderSchema.safeParse(m) };
  });

  const errors: Record<string, string[]> = {};
  let hasErrors = false;
  validationResults.forEach(vr => {
    if (!vr.result.success) {
      hasErrors = true;
      for (const [field, fieldErrors] of Object.entries(vr.result.error.flatten().fieldErrors)) {
        errors[`mitreisende[${vr.index}].${field}`] = fieldErrors as string[];
      }
    }
  });
  
  if (hasErrors) {
    console.error("[Action submitMitreisendeAction] Validation failed for Mitreisende:", errors);
    return {
      errors,
      message: "Fehler bei der Validierung der Daten der Mitreisenden.",
      success: false,
    };
  }

  const validMitreisendeInput = validationResults.map(vr => (vr.result as z.SafeParseSuccess<z.infer<typeof mitreisenderSchema>>).data);
  console.log("[Action submitMitreisendeAction] Validated Mitreisende input data:", validMitreisendeInput);

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action submitMitreisendeAction] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    const finalMitreisende: Mitreisender[] = [];
    for (const m of validMitreisendeInput) {
        const mitreisenderEntry: Mitreisender = {
            id: m.id || `mit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            vorname: m.vorname,
            nachname: m.nachname,
            alter: m.alter ? Number(m.alter) : undefined,
            ausweisVorderseiteUrl: undefined,
            ausweisRückseiteUrl: undefined,
        };

        // Files were parsed into the `m` object by the FormData loop
        const vorderseiteFile = m.ausweisVorderseite;
        const rueckseiteFile = m.ausweisRückseite;

        if (vorderseiteFile && vorderseiteFile.size > 0) {
            mitreisenderEntry.ausweisVorderseiteUrl = `https://placehold.co/uploads/mock_m_${Date.now()}_v_${vorderseiteFile.name.replace(/\s+/g, '_')}`;
            console.log(`[Action submitMitreisendeAction] Mock uploaded Mitreisender ausweisVorderseite to ${mitreisenderEntry.ausweisVorderseiteUrl}`);
        }
        if (rueckseiteFile && rueckseiteFile.size > 0) {
            mitreisenderEntry.ausweisRückseiteUrl = `https://placehold.co/uploads/mock_m_${Date.now()}_r_${rueckseiteFile.name.replace(/\s+/g, '_')}`;
            console.log(`[Action submitMitreisendeAction] Mock uploaded Mitreisender ausweisRückseite to ${mitreisenderEntry.ausweisRückseiteUrl}`);
        }
        finalMitreisende.push(mitreisenderEntry);
    }

    const success = updateMockBookingByToken(bookingToken, {
      guestSubmittedData: {
        ...(booking.guestSubmittedData || {}),
        mitreisende: finalMitreisende,
        submittedAt: new Date().toISOString(), 
      }
    });

    if (success) {
      console.log(`[Action submitMitreisendeAction] Mitreisende data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout");
      revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: "Daten der Mitreisenden erfolgreich übermittelt.", errors: null, success: true };
    } else {
      console.error(`[Action submitMitreisendeAction] Failed to update booking with Mitreisende for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung mit Mitreisenden.", errors: null, success: false };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action submitMitreisendeAction] Error submitting Mitreisende data:", error.message, error.stack);
    return { message: "Serverfehler: Daten der Mitreisenden konnten nicht übermittelt werden.", errors: null, success: false };
  }
}

export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitPaymentAmountSelectionAction] For token: ${bookingToken}. Data:`, Object.fromEntries(formData));
  
  const validatedFields = paymentAmountSelectionSchema.safeParse(Object.fromEntries(formData));

  if (!validatedFields.success) {
    console.error("[Action submitPaymentAmountSelectionAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Zahlungsauswahl.",
      success: false,
    };
  }

  const { paymentSelection } = validatedFields.data;

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action submitPaymentAmountSelectionAction] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false };
    }

    const updatedGuestData: GuestSubmittedData = {
      ...(booking.guestSubmittedData || {}),
      paymentAmountSelection: paymentSelection,
      submittedAt: new Date().toISOString(), // Update submittedAt timestamp
    };

    const success = updateMockBookingByToken(bookingToken, {
      guestSubmittedData: updatedGuestData,
    });

    if (success) {
      console.log(`[Action submitPaymentAmountSelectionAction] Payment amount selection '${paymentSelection}' submitted for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout");
      revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: "Auswahl der Zahlungssumme erfolgreich übermittelt.", errors: null, success: true };
    } else {
      console.error(`[Action submitPaymentAmountSelectionAction] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung mit Zahlungsauswahl.", errors: null, success: false };
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action submitPaymentAmountSelectionAction] Error:", error.message, error.stack);
    return { message: "Serverfehler: Zahlungsauswahl konnte nicht übermittelt werden.", errors: null, success: false };
  }
}


// Placeholder for the final step if needed
export async function submitBookingCompletionAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log(`[Action submitBookingCompletionAction] Finalizing booking for token: ${bookingToken}`);
  const booking = findMockBookingByToken(bookingToken);
  if (!booking) {
      return { message: "Buchung nicht gefunden.", success: false, errors: null };
  }

  // In a real app, this might involve payment processing confirmation, etc.
  // For now, we just update the status to "Confirmed".
  const success = updateMockBookingByToken(bookingToken, { status: "Confirmed" });
  
  if (success) {
    revalidatePath(`/buchung/${bookingToken}`, "layout"); // For the guest page to show confirmation
    revalidatePath(`/admin/dashboard`, "layout"); // For dashboard stats
    revalidatePath(`/admin/bookings/${booking.id}`, "page"); // For specific admin booking page
    console.log(`[Action submitBookingCompletionAction] Booking ${bookingToken} confirmed.`);
    return { message: "Buchung erfolgreich abgeschlossen und bestätigt!", success: true, errors: null };
  }
  return { message: "Fehler beim Bestätigen der Buchung.", success: false, errors: null };
}

