
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { 
  addMockBooking, 
  findMockBookingByToken, 
  updateMockBookingByToken 
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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 10MB.`)
  .refine(
    (file) => !file || file.size === 0 || ACCEPTED_FILE_TYPES.includes(file.type),
    "Nur .jpg, .jpeg, .png und .pdf Dateien sind erlaubt."
  );

// --- Schemas für die einzelnen Schritte des Gästebuchungsformulars ---

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => {
    if (!val) return true; 
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, { message: "Ungültiges Geburtsdatum." }),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
});

const ausweisdokumenteSchema = z.object({
  hauptgastDokumenttyp: z.enum(['Reisepass', 'Personalausweis', 'Führerschein'], { required_error: "Dokumenttyp ist erforderlich."}),
  hauptgastAusweisVorderseite: fileSchema,
  hauptgastAusweisRückseite: fileSchema,
});

const zahlungsinformationenSchema = z.object({
  zahlungsart: z.literal('Überweisung', { required_error: "Zahlungsart ist erforderlich (aktuell nur Überweisung)."}),
  zahlungsdatum: z.string().min(1, "Zahlungsdatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), {
    message: "Ungültiges Zahlungsdatum."
  }),
  zahlungsbeleg: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich."}),
  zahlungsbetrag: z.coerce.number(), // Wird vom Client mitgeschickt, aber serverseitig kalkuliert/validiert
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.literal("on", { 
    errorMap: () => ({ message: "Sie müssen den AGB zustimmen." }),
  }),
  datenschutzAkzeptiert: z.literal("on", { 
    errorMap: () => ({ message: "Sie müssen den Datenschutzbestimmungen zustimmen." }),
  }),
});


// --- Server Actions ---

function generateActionToken() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

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
      actionToken: prevState?.actionToken 
    };
  }

  const bookingData = validatedFields.data;
  const actionToken = generateActionToken();

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
      guestSubmittedData: { 
        lastCompletedStep: 0,
      }
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout");

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      bookingToken: newBookingToken,
      errors: null,
      success: true,
      actionToken,
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction] Error creating booking:", error.message, error.stack);
    return { 
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", 
        errors: null, 
        bookingToken: null, 
        success: false,
        actionToken: prevState?.actionToken 
    };
  }
}

type GuestSubmittedDataAsFormData = Omit<GuestSubmittedData, 
  'hauptgastAusweisVorderseiteUrl' | 
  'hauptgastAusweisRückseiteUrl' | 
  'zahlungsbelegUrl' |
  'agbAkzeptiert' | // Diese kommen als "on" oder undefined
  'datenschutzAkzeptiert'
> & {
  hauptgastAusweisVorderseite?: File | null;
  hauptgastAusweisRückseite?: File | null;
  zahlungsbeleg?: File | null;
  agbAkzeptiert?: "on";
  datenschutzAkzeptiert?: "on";
};


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData> 
) {
  const rawFormData = Object.fromEntries(formData.entries());
  console.log(`[Action updateBookingStep - Step ${stepNumber}] For token: ${bookingToken}. Raw FormData:`, rawFormData);

  const validatedFields = actionSchema.safeParse(rawFormData);
  const clientActionToken = formData.get("currentActionToken") as string | undefined; // This is not standard for useActionState
  const newServerActionToken = generateActionToken();

  if (!validatedFields.success) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Validation failed:`, validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: `Fehler bei der Validierung für Schritt ${stepNumber}.`,
      success: false,
      actionToken: newServerActionToken, // Send new token even on validation failure for client tracking
      updatedGuestData: null,
    };
  }
  
  const dataFromForm = validatedFields.data as GuestSubmittedDataAsFormData; // Cast to include File types for TS
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data from form:`, dataFromForm);

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }

    const currentGuestData = booking.guestSubmittedData || {};
    
    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestData,
      ...additionalDataToMerge, 
      ...dataFromForm, // This will initially overwrite file fields with File objects
      lastCompletedStep: Math.max(currentGuestData.lastCompletedStep || 0, stepNumber),
      // submittedAt will be set at the very end (confirmation step)
    };
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data (before file handling):`, updatedGuestData);

    // Handle File Uploads (Simulated)
    const fileFields: { formDataKey: keyof GuestSubmittedDataAsFormData; urlKey: keyof GuestSubmittedData }[] = [
      { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
      { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
      { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
    ];

    for (const field of fileFields) {
      const file = dataFromForm[field.formDataKey] as File | undefined | null; // File from validated data
      if (file && file.size > 0) {
        if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          const buffer = Buffer.from(await file.arrayBuffer());
          const base64 = buffer.toString('base64');
          updatedGuestData[field.urlKey] = `data:${file.type};base64,${base64}`;
          console.log(`[Action updateBookingStep - Step ${stepNumber}] Generated data URI for ${file.name}`);
        } else if (ACCEPTED_PDF_TYPES.includes(file.type)) {
          updatedGuestData[field.urlKey] = `mock-pdf-url:${encodeURIComponent(file.name)}`;
          console.log(`[Action updateBookingStep - Step ${stepNumber}] Generated PDF marker for ${file.name}`);
        } else {
          // Should not happen due to schema validation, but as a fallback
          updatedGuestData[field.urlKey] = `https://placehold.co/200x100.png?text=Unsupported_File:${encodeURIComponent(file.name)}`;
        }
      } else if (currentGuestData && currentGuestData[field.urlKey]) {
        // Preserve existing URL if no new file is uploaded for this specific field
        updatedGuestData[field.urlKey] = currentGuestData[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Preserved existing URL for ${String(field.urlKey)}`);
      } else {
        // No new file and no existing file, so ensure the URL key is removed or undefined
        delete updatedGuestData[field.urlKey];
         console.log(`[Action updateBookingStep - Step ${stepNumber}] Cleared URL for ${String(field.urlKey)}`);
      }
    }
     
    // Handle Checkboxes for the final step
    if (stepNumber === 4) { // Assuming step 4 is Uebersicht & Bestaetigung
        updatedGuestData.agbAkzeptiert = dataFromForm.agbAkzeptiert === 'on';
        updatedGuestData.datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === 'on';
        updatedGuestData.submittedAt = new Date().toISOString(); // Set submittedAt on final confirmation
    }
    
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final updated guest data (after file handling):`, JSON.stringify(updatedGuestData, (key, value) => typeof value === 'string' && value.startsWith('data:image') && value.length > 100 ? value.substring(0,100) + '...' : value ));


    const success = updateMockBookingByToken(bookingToken, { 
      guestSubmittedData: updatedGuestData,
      ...(stepNumber === 1 && { guestFirstName: dataFromForm.gastVorname, guestLastName: dataFromForm.gastNachname })
    });

    if (success) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); 
      if (booking.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { 
        message: `Schritt ${stepNumber} erfolgreich übermittelt.`, 
        errors: null, 
        success: true, 
        actionToken: newServerActionToken,
        updatedGuestData: updatedGuestData 
      };
    } else {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Error submitting data:`, error.message, error.stack);
    return { message: "Serverfehler: Daten konnten nicht übermittelt werden.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
  }
}

// --- Aktionen für die einzelnen Schritte ---

export async function submitGastStammdatenAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitGastStammdatenAction] Called.");
  return updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData);
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitAusweisdokumenteAction] Called.");
  return updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData);
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitZahlungsinformationenAction] Called.");
  const booking = findMockBookingByToken(bookingToken);
  const anzahlungsbetrag = booking ? parseFloat((booking.price * 0.3).toFixed(2)) : 0;
  
  return updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {
    zahlungsbetrag: anzahlungsbetrag, // Dies wird serverseitig hinzugefügt/überschrieben
  });
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitEndgueltigeBestaetigungAction] Called.");
  const result = await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData);

  if (result.success && result.updatedGuestData) {
    const successConfirmation = updateMockBookingByToken(bookingToken, { 
        status: "Confirmed", // Booking is confirmed by guest
        guestSubmittedData: { 
            ...result.updatedGuestData,
            agbAkzeptiert: true, 
            datenschutzAkzeptiert: true,
        }
    });
    if (successConfirmation) {
       console.log(`[Action submitEndgueltigeBestaetigungAction] Booking ${bookingToken} status set to Confirmed.`);
       const booking = findMockBookingByToken(bookingToken);
       if (booking?.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
       revalidatePath("/admin/dashboard", "layout");
       return { ...result, message: "Buchung erfolgreich abgeschlossen und bestätigt!" };
    } else {
        console.error(`[Action submitEndgueltigeBestaetigungAction] Failed to set booking ${bookingToken} to Confirmed.`);
        return { ...result, success: false, message: "Fehler beim finalen Bestätigen der Buchung.", updatedGuestData: result.updatedGuestData };
    }
  }
  return result;
}

