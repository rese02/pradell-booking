
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, GuestSubmittedDataFromForm } from "@/lib/definitions";
import { 
  findMockBookingByToken, 
  updateMockBookingByToken,
  addMockBooking,
  deleteMockBookingsByIds,
  // getMockBookings // Not used directly in this file anymore
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
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 10MB.`)
  .refine(
    (file) => {
      if (!file || file.size === 0) return true; // Allow empty or no file
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur ${ACCEPTED_FILE_TYPES.map(t => t.split('/')[1]).join(', ').toUpperCase()} Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => {
    if (!val || val === "") return true; 
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
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den AGB zustimmen.",
  })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
  })),
});

// --- Form State Type (imported by components) ---
export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string; // To prevent duplicate submissions or navigation issues
  updatedGuestData?: GuestSubmittedData | null; // To send back the latest data
};

// --- Helper Functions ---
function generateActionToken() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

// --- Server Actions ---

export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  const rawFormData = Object.fromEntries(formData.entries());
  console.log("[Action createBookingAction] Received form data:", rawFormData);
  const validatedFields = createBookingSchema.safeParse(rawFormData);
  const newActionToken = generateActionToken(); 

  if (!validatedFields.success) {
    console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      success: false,
      actionToken: newActionToken,
      updatedGuestData: null,
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
      roomIdentifier: `${bookingData.zimmertyp || 'Zimmer'}`, 
      guestSubmittedData: { 
        lastCompletedStep: -1, // 0-indexed, -1 means no steps completed
      }
    };

    addMockBooking(newBooking); // Add to our mock DB
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout"); // Revalidate the guest page if it was already visited

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      errors: null,
      success: true,
      actionToken: newActionToken,
      updatedGuestData: newBooking.guestSubmittedData, // Send initial guest data structure
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction] Error creating booking:", error.message, error.stack);
    return { 
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", 
        errors: null, 
        success: false,
        actionToken: newActionToken,
        updatedGuestData: null,
    };
  }
}


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-based for human readability, will be converted to 0-based for lastCompletedStep
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  
  const newServerActionToken = generateActionToken();
  const rawFormData = Object.fromEntries(formData.entries());
  
  console.log(`[Action updateBookingStep BEGIN - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${newServerActionToken}.`);
  // console.log(`[Action updateBookingStep - Step ${stepNumber}] Raw FormData (files as objects):`, 
  //   JSON.stringify(Object.fromEntries(
  //     Object.entries(rawFormData).map(([key, value]) => {
  //       if (value instanceof File) return [key, { name: value.name, size: value.size, type: value.type }];
  //       return [key, value];
  //     })
  //   ), null, 2).substring(0, 1000) // Limit log length
  // );

  let currentBookingDataSnapshot: GuestSubmittedData | null = null;

  try {
    if (!bookingToken || typeof bookingToken !== 'string') {
        console.error(`[Action updateBookingStep - Step ${stepNumber}] Invalid or missing bookingToken: "${bookingToken}"`);
        return { 
            message: "Ungültiger oder fehlender Buchungs-Token.", 
            errors: null, 
            success: false, 
            actionToken: newServerActionToken, 
            updatedGuestData: null
        };
    }

    console.log(`[Action updateBookingStep - Step ${stepNumber}] Validating form data for token "${bookingToken}"...`);
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Validation failed for token "${bookingToken}":`, JSON.stringify(fieldErrors));
      return {
        errors: fieldErrors,
        message: `Fehler bei der Validierung für Schritt ${stepNumber}. Bitte überprüfen Sie Ihre Eingaben.`,
        success: false,
        actionToken: newServerActionToken,
        updatedGuestData: null, // Or potentially currentGuestData if fetched before validation
      };
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Validation successful for token "${bookingToken}".`);
    const dataFromForm = validatedFields.data as GuestSubmittedDataFromForm; // Type assertion
    
    // Logging validated data (excluding file objects for brevity)
    const loggableDataFromForm = {...dataFromForm};
    for (const key of ['hauptgastAusweisVorderseite', 'hauptgastAusweisRückseite', 'zahlungsbeleg'] as (keyof GuestSubmittedDataFromForm)[]) {
        if (loggableDataFromForm[key] instanceof File) {
            const file = loggableDataFromForm[key] as File;
            (loggableDataFromForm as any)[key] = { name: file.name, size: file.size, type: file.type };
        }
    }
    // console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data for token "${bookingToken}":`, JSON.stringify(loggableDataFromForm, null, 2));

    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: "${bookingToken}"`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking found for token "${bookingToken}". Current status: ${booking.status}`);

    currentBookingDataSnapshot = JSON.parse(JSON.stringify(booking.guestSubmittedData || { lastCompletedStep: -1 }));
    
    let updatedGuestData: GuestSubmittedData = {
      ...currentBookingDataSnapshot,
      ...additionalDataToMerge, 
      ...dataFromForm, 
    };
    
    // lastCompletedStep is 0-indexed, stepNumber is 1-based
    updatedGuestData.lastCompletedStep = Math.max(currentBookingDataSnapshot.lastCompletedStep ?? -1, stepNumber - 1);
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data for token "${bookingToken}". New lastCompletedStep: ${updatedGuestData.lastCompletedStep}`);

    const fileFields: { formDataKey: keyof GuestSubmittedDataFromForm; urlKey: keyof GuestSubmittedData }[] = [
      { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
      { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
      { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
    ];

    for (const field of fileFields) {
      const file = rawFormData[String(field.formDataKey)] as File | undefined | null;
      if (file instanceof File && file.size > 0) {
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing new file for ${String(field.formDataKey)}: ${file.name} (${file.size} bytes, type: ${file.type})`);
        // In a real app, upload to cloud storage here and get URL
        // For mock: store a marker with the filename
        updatedGuestData[field.urlKey] = `mock-file-url:${encodeURIComponent(file.name)}`;
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Stored MOCK URL for ${file.name}: ${updatedGuestData[field.urlKey]}`);
      } else if (currentBookingDataSnapshot && currentBookingDataSnapshot[field.urlKey]) {
        // No new file uploaded for this field, keep the existing URL if one exists
        updatedGuestData[field.urlKey] = currentBookingDataSnapshot[field.urlKey];
        // console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(field.formDataKey)}, keeping old URL: ${updatedGuestData[field.urlKey]}`);
      } else {
        // No new file and no old URL, ensure the field is not present or is undefined
        delete updatedGuestData[field.urlKey];
        // console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file and no old URL for ${String(field.formDataKey)}.`);
      }
    }
     
    if (stepNumber === 4) { // Übersicht & Bestätigung
        // Zod schema with preprocess ensures these are booleans if validation passed
        updatedGuestData.agbAkzeptiert = dataFromForm.agbAkzeptiert; 
        updatedGuestData.datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert;
        
        if (updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
            updatedGuestData.submittedAt = new Date().toISOString();
            console.log(`[Action updateBookingStep - Step 4] AGB & Datenschutz akzeptiert. SubmittedAt gesetzt for token "${bookingToken}".`);
        } else {
            // This case should ideally not be reached if Zod validation is strict for these fields being true.
             console.warn(`[Action updateBookingStep - Step 4] AGB und/oder Datenschutz nicht akzeptiert for token "${bookingToken}". SubmittedAt nicht gesetzt.`);
        }
    }
    
    // Safer logging for potentially large string values in guest data
    const guestDataForLogging = { ...updatedGuestData };
    for (const key in guestDataForLogging) {
        if (Object.prototype.hasOwnProperty.call(guestDataForLogging, key)) {
            const value = (guestDataForLogging as any)[key];
            if (typeof value === 'string' && value.length > 200) { // Shortened threshold for logging
                 (guestDataForLogging as any)[key] = `${value.substring(0,50)}...[truncated ${value.length} bytes]`;
            }
        }
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final updated guest data for token "${bookingToken}":`, JSON.stringify(guestDataForLogging, null, 2));

    const bookingUpdates: Partial<Booking> = {
        guestSubmittedData: updatedGuestData,
        updatedAt: new Date().toISOString(),
    };

    if (stepNumber === 1 && updatedGuestData.gastVorname && updatedGuestData.gastNachname) {
        bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
        bookingUpdates.guestLastName = updatedGuestData.gastNachname;
    }
   
    if (stepNumber === 4 && updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
      bookingUpdates.status = "Confirmed";
      console.log(`[Action updateBookingStep - Step 4] Booking status for token "${bookingToken}" to be set to Confirmed.`);
    }
    
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Attempting to update mock DB for token "${bookingToken}" with updates:`, JSON.stringify(bookingUpdates, (k,v) => (typeof v === 'string' && v.length > 50 ? v.substring(0,50) + '...' : v) , 2 ));
    const updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates);

    if (updateSuccess) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: "${bookingToken}". Booking status: ${bookingUpdates.status || booking.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); 
      if (booking.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
      
      let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
      if (bookingUpdates.status === "Confirmed") {
          message = "Buchung erfolgreich abgeschlossen und bestätigt!";
      }

      return { 
        message,
        errors: null, 
        success: true, 
        actionToken: newServerActionToken,
        updatedGuestData: updatedGuestData 
      };
    } else {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: "${bookingToken}" in mock DB.`);
      return { 
        message: "Fehler beim Speichern der Daten in der Mock-DB.", 
        errors: null, 
        success: false, 
        actionToken: newServerActionToken, 
        updatedGuestData: currentBookingDataSnapshot // Return snapshot before failed update
      };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL UNEXPECTED OUTER ERROR for token "${bookingToken}":`, error.message, error.stack);
    return { 
        message: `Unerwarteter Serverfehler in Schritt ${stepNumber}: ${error.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.`, 
        errors: null, 
        success: false, 
        actionToken: newServerActionToken, 
        updatedGuestData: currentBookingDataSnapshot // Return snapshot if available
    };
  } finally {
    console.log(`[Action updateBookingStep END - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${newServerActionToken}.`);
  }
}

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log("[Action submitGastStammdatenAction] Called for bookingToken:", bookingToken);
  return updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData);
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log("[Action submitAusweisdokumenteAction] Called for bookingToken:", bookingToken);
  return updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData);
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log("[Action submitZahlungsinformationenAction] Called for bookingToken:", bookingToken);
  const booking = findMockBookingByToken(bookingToken);
  let anzahlungsbetrag = 0;
  if (booking && typeof booking.price === 'number') {
    anzahlungsbetrag = parseFloat((booking.price * 0.3).toFixed(2));
  } else {
     console.warn(`[Action submitZahlungsinformationenAction] Booking not found or price not a number for token "${bookingToken}". Anzahlungsbetrag ist 0.`);
  }
  
  return updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {
    zahlungsbetrag: anzahlungsbetrag, 
  });
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log("[Action submitEndgueltigeBestaetigungAction] Called for bookingToken:", bookingToken);
  return updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData);
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const actionToken = generateActionToken();
  console.log(`[Action deleteBookingsAction] Attempting to delete bookings with IDs: ${bookingIds.join(', ')}`);
  
  if (!bookingIds || bookingIds.length === 0) {
    return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken };
  }

  try {
    const deleteSuccess = deleteMockBookingsByIds(bookingIds); 

    if (deleteSuccess) {
      revalidatePath("/admin/dashboard", "layout"); 
      console.log(`[Action deleteBookingsAction] Successfully deleted bookings. Revalidating dashboard.`);
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken };
    } else {
      // This branch is unlikely if deleteMockBookingsByIds always returns true from mock-db
      console.warn(`[Action deleteBookingsAction] deleteMockBookingsByIds reported no success for IDs: ${bookingIds.join(', ')}`);
      return { success: false, message: "Buchungen konnten nicht aus der Mock-DB gelöscht werden (interne Logik).", actionToken };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
    console.error(`[Action deleteBookingsAction] Error deleting bookings: ${errorMessage}`);
    return { success: false, message: `Fehler beim Löschen der Buchungen: ${errorMessage}`, actionToken };
  }
}

    