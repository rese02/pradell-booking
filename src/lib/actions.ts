
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, GuestSubmittedDataFromForm } from "@/lib/definitions";
import {
  findMockBookingByToken,
  updateMockBookingByToken,
  addMockBooking,
  deleteMockBookingsByIds,
  getMockBookings, // For logging/debugging in actions
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
      if (!file || file.size === 0) return true;
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur ${[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES].map(t => t.split('/')[1]).join(', ').toUpperCase()} Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
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
  zahlungsbetrag: z.coerce.number().nonnegative("Anzahlungsbetrag muss eine nicht-negative Zahl sein."),
});

const uebersichtBestaetigungSchema = z.object({
    agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
        message: "Sie müssen den AGB zustimmen.",
    })),
    datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
        message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
    })),
});


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
};

function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// Helper function to log FormData safely and minimally
function logFormDataMinimal(context: string, bookingToken: string, rawFormDataEntries: Record<string, any>) {
  try {
    const loggableEntries: Record<string, any> = {};
    for (const key in rawFormDataEntries) {
      if (Object.prototype.hasOwnProperty.call(rawFormDataEntries, key)) {
        const value = rawFormDataEntries[key];
        if (value instanceof File) {
          loggableEntries[key] = { name: value.name, size: value.size, type: value.type };
        } else if (typeof value === 'string' && value.length > 100 && key !== 'currentActionToken') {
          loggableEntries[key] = value.substring(0, 100) + "...[truncated]";
        } else {
          loggableEntries[key] = value;
        }
      }
    }
    console.log(`${context} FormData for token "${bookingToken}" (minimal):`, JSON.stringify(loggableEntries, null, 2));
  } catch (e) {
    console.error(`${context} Error logging FormData for token "${bookingToken}":`, e);
  }
}

// Helper to stringify safely for logging, avoiding circular refs and truncating long strings
function stringifyReplacer(key: string, value: any) {
  if (value === undefined) {
    return 'undefined'; // Stringify undefined
  }
  if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url')) { // Don't truncate URLs too early
    return value.substring(0, 200) + `...[truncated ${value.length} bytes]`;
  }
  return value;
}


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-indexed
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>,
  forActionToken?: string // To ensure the response matches the request
): Promise<FormState> {
  const currentActionToken = forActionToken || generateActionToken();
  console.log(`[Action updateBookingStep BEGIN - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${currentActionToken}.`);

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
    logFormDataMinimal(`[Action updateBookingStep - Step ${stepNumber}]`, bookingToken, rawFormData);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL ERROR converting FormData for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler bei der Formularverarbeitung (Code 1) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: currentActionToken, updatedGuestData: null,
    };
  }

  let validatedFields: z.SafeParseReturnType<any, any>;
  try {
    validatedFields = actionSchema.safeParse(rawFormData);
  } catch (e) {
     const err = e instanceof Error ? e : new Error(String(e));
     console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL ERROR during Zod parsing for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
     return {
       message: `Serverfehler bei der Datenvalidierung (Code 2) für Schritt ${stepNumber}.`,
       errors: null, success: false, actionToken: currentActionToken, updatedGuestData: null,
     };
  }

  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    console.warn(`[Action updateBookingStep - Step ${stepNumber}] Validation failed for token "${bookingToken}":`, JSON.stringify(fieldErrors, stringifyReplacer, 2));
    return {
      errors: fieldErrors,
      message: `Validierungsfehler für Schritt ${stepNumber}. Bitte Eingaben prüfen.`,
      success: false, actionToken: currentActionToken, updatedGuestData: null,
    };
  }
  
  const dataFromForm = validatedFields.data as GuestSubmittedDataFromForm;
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Zod validation successful for token "${bookingToken}".`);
  
  // Log validated file fields specifically
  const fileFieldsToLog: Record<string, any> = {};
  if ('hauptgastAusweisVorderseite' in dataFromForm && dataFromForm.hauptgastAusweisVorderseite instanceof File) fileFieldsToLog.hauptgastAusweisVorderseite = {name: dataFromForm.hauptgastAusweisVorderseite.name, size: dataFromForm.hauptgastAusweisVorderseite.size, type: dataFromForm.hauptgastAusweisVorderseite.type};
  if ('hauptgastAusweisRückseite' in dataFromForm && dataFromForm.hauptgastAusweisRückseite instanceof File) fileFieldsToLog.hauptgastAusweisRückseite = {name: dataFromForm.hauptgastAusweisRückseite.name, size: dataFromForm.hauptgastAusweisRückseite.size, type: dataFromForm.hauptgastAusweisRückseite.type};
  if ('zahlungsbeleg' in dataFromForm && dataFromForm.zahlungsbeleg instanceof File) fileFieldsToLog.zahlungsbeleg = {name: dataFromForm.zahlungsbeleg.name, size: dataFromForm.zahlungsbeleg.size, type: dataFromForm.zahlungsbeleg.type};
  if(Object.keys(fileFieldsToLog).length > 0) console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated file objects:`, JSON.stringify(fileFieldsToLog));


  let booking: Booking | undefined;
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;

  try {
    booking = findMockBookingByToken(bookingToken); // Uses global store
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: "${bookingToken}"`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: currentActionToken, updatedGuestData: null };
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking found for token "${bookingToken}". Status: ${booking.status}.`);
    // Create a deep copy of existing guest data to avoid modifying it directly if an error occurs later
    currentGuestDataSnapshot = booking.guestSubmittedData ? JSON.parse(JSON.stringify(booking.guestSubmittedData)) : { lastCompletedStep: -1 };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Error fetching/preparing booking for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler beim Laden der Buchungsdaten (Code 3) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: currentActionToken, updatedGuestData: null,
    };
  }

  let updatedGuestData: GuestSubmittedData = {
    ...(currentGuestDataSnapshot ?? { lastCompletedStep: -1 }), // Start with a deep copy of previous or initial state
    ...(additionalDataToMerge ?? {}), // Merge additional data passed to the function
    ...dataFromForm, // Merge validated data from the current form step
  };

  // File processing
  const fileFields: { formDataKey: keyof GuestSubmittedDataFromForm; urlKey: keyof GuestSubmittedData }[] = [
    { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
    { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
    { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
  ];

  for (const field of fileFields) {
    const file = rawFormData[String(field.formDataKey)] as File | undefined | null; // Get file from original raw form data
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing file field: ${String(field.formDataKey)} for token "${bookingToken}". File present in rawFormData: ${!!file}`);

    try {
      if (file instanceof File && file.size > 0) {
        // File was already validated by Zod for type and size.
        // For mock DB, store a marker URL. In a real app, upload to cloud storage here.
        const fileUrl = `mock-file-url:${encodeURIComponent(file.name)}`;
        (updatedGuestData as any)[field.urlKey] = fileUrl;
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Stored mock URL for ${file.name}: ${fileUrl} for token "${bookingToken}" into key ${String(field.urlKey)}`);
      } else if ((currentGuestDataSnapshot as any)?.[field.urlKey]) {
        // No new file uploaded for this field, retain the existing URL from the snapshot
        (updatedGuestData as any)[field.urlKey] = (currentGuestDataSnapshot as any)[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(field.formDataKey)}, keeping old URL: ${(updatedGuestData as any)[field.urlKey]?.substring(0,50)}... for token "${bookingToken}"`);
      } else {
        // No new file and no existing URL, so delete the field from updatedGuestData
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file and no old URL for ${String(field.formDataKey)} for token "${bookingToken}". Deleting key ${String(field.urlKey)}.`);
        delete (updatedGuestData as any)[field.urlKey];
      }
    } catch (fileProcessingError) {
      const err = fileProcessingError instanceof Error ? fileProcessingError : new Error(String(fileProcessingError));
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Error processing file for ${String(field.formDataKey)} (Token "${bookingToken}"):`, err.message, err.stack?.substring(0, 500));
      return {
        message: `Fehler bei Dateiverarbeitung für ${String(field.formDataKey)}: ${err.message}.`,
        errors: { [String(field.formDataKey)]: [err.message] },
        success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot,
      };
    }
  }
  
  // Update lastCompletedStep: 0-indexed
  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1);
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data for token "${bookingToken}". New lastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);


  if (stepNumber === 4) { // Endgültige Bestätigung step
    // AGB and Datenschutz are already booleans due to Zod preprocess
    if (updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
      updatedGuestData.submittedAt = new Date().toISOString();
      console.log(`[Action updateBookingStep - Step ${stepNumber}] AGB & Datenschutz akzeptiert. SubmittedAt gesetzt für Token "${bookingToken}".`);
    } else {
      // This case should be caught by Zod validation, but as a safeguard:
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] AGB und/oder Datenschutz nicht akzeptiert für Token "${bookingToken}". SubmittedAt nicht gesetzt.`);
      // Zod refine should prevent this state, but if it occurs, it's a validation failure.
      // The return below for Zod failure handles this path.
    }
  }

  const bookingUpdates: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
    updatedAt: new Date().toISOString(),
  };

  if (stepNumber === 1 && updatedGuestData.gastVorname && updatedGuestData.gastNachname) {
    bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
    bookingUpdates.guestLastName = updatedGuestData.gastNachname;
  }

  // If it's the final confirmation step and everything is accepted, update booking status
  if (stepNumber === 4 && updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert && updatedGuestData.submittedAt) {
    bookingUpdates.status = "Confirmed";
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking status for token "${bookingToken}" wird auf "Confirmed" gesetzt.`);
  }
  
  let updateSuccess = false;
  try {
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Attempting to update mock DB for token "${bookingToken}" with bookingUpdates (guestSubmittedData part logged separately).`);
    console.log(`[Action updateBookingStep - Step ${stepNumber}] GuestSubmittedData to be saved (partial for brevity): ${JSON.stringify(updatedGuestData, (k,v) => (typeof v === 'string' && v.length > 50 ? v.substring(0,50)+'...' : v) , 2).substring(0,500)}...`);

    updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL ERROR during updateMockBookingByToken for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler beim Speichern der Buchung (Code 4) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot,
    };
  }

  if (updateSuccess) {
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: "${bookingToken}". Booking status: ${bookingUpdates.status || booking?.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);
    revalidatePath(`/buchung/${bookingToken}`, "layout");
    if (booking?.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
    if (bookingUpdates.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return {
      message, errors: null, success: true, actionToken: currentActionToken, updatedGuestData: updatedGuestData,
    };
  } else {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: "${bookingToken}" in mock DB (updateMockBookingByToken returned false).`);
    // This usually means the booking token wasn't found by updateMockBookingByToken
    return {
      message: "Fehler beim Speichern der Daten (Code 5). Buchung konnte nicht gefunden werden.",
      errors: null, success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot,
    };
  }
}


export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitGastStammdatenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}`);
  try {
    return await updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {}, serverActionToken);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Action submitGastStammdatenAction CRITICAL ERROR] Token: "${bookingToken}". Error:`, err.message, err.stack?.substring(0,500));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Verarbeiten der Stammdaten aufgetreten.",
      errors: null,
      success: false,
      actionToken: serverActionToken,
      updatedGuestData: prevState.updatedGuestData || null,
    };
  }
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitAusweisdokumenteAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}`);
  try {
    const rawFormDataEntries = Object.fromEntries(formData.entries());
    logFormDataMinimal('[Action submitAusweisdokumenteAction]', bookingToken, rawFormDataEntries);
    return await updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData, {}, serverActionToken);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Action submitAusweisdokumenteAction CRITICAL ERROR] Token: "${bookingToken}". Error:`, err.message, err.stack?.substring(0,500));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Verarbeiten der Ausweisdokumente aufgetreten.",
      errors: null,
      success: false,
      actionToken: serverActionToken,
      updatedGuestData: prevState.updatedGuestData || null,
    };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitZahlungsinformationenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}`);
  try {
    const rawFormDataEntries = Object.fromEntries(formData.entries());
    logFormDataMinimal('[Action submitZahlungsinformationenAction]', bookingToken, rawFormDataEntries);
    
    // zahlungsbetrag is now part of the schema and will be in formData
    return await updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {}, serverActionToken);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Action submitZahlungsinformationenAction CRITICAL ERROR] Token: "${bookingToken}". Error:`, err.message, err.stack?.substring(0,500));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Verarbeiten der Zahlungsinformationen aufgetreten.",
      errors: null,
      success: false,
      actionToken: serverActionToken,
      updatedGuestData: prevState.updatedGuestData || null,
    };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitEndgueltigeBestaetigungAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}`);
  try {
    return await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData, {}, serverActionToken);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Action submitEndgueltigeBestaetigungAction CRITICAL ERROR] Token: "${bookingToken}". Error:`, err.message, err.stack?.substring(0,500));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Abschließen der Buchung aufgetreten.",
      errors: null,
      success: false,
      actionToken: serverActionToken,
      updatedGuestData: prevState.updatedGuestData || null,
    };
  }
}


export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log("[Action createBookingAction BEGIN]");
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    logFormDataMinimal("[Action createBookingAction]", "N/A - new booking", rawFormData);
    const validatedFields = createBookingSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Fehler bei der Validierung der Buchungsdaten.",
        success: false,
        actionToken: serverActionToken,
        updatedGuestData: null,
      };
    }

    const bookingData = validatedFields.data;

    const newBookingId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const newBookingToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2,10);

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
        lastCompletedStep: -1,
      }
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);

    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout");

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      errors: null,
      success: true,
      actionToken: serverActionToken, // Pass serverActionToken here
      updatedGuestData: newBooking.guestSubmittedData, // Include initial guest data for consistency
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction CRITICAL ERROR]:", error.message, error.stack?.substring(0,500));
    return {
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden.",
        errors: null,
        success: false,
        actionToken: serverActionToken, // Also here
        updatedGuestData: null,
    };
  }
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
      // This case should ideally not be reached if deleteMockBookingsByIds always returns true or throws.
      console.warn(`[Action deleteBookingsAction] deleteMockBookingsByIds reported no success for IDs: ${bookingIds.join(', ')}`);
      return { success: false, message: "Buchungen konnten nicht aus der Mock-DB gelöscht werden (interne Logik).", actionToken };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
    console.error(`[Action deleteBookingsAction CRITICAL ERROR] Error deleting bookings: ${errorMessage}`, error);
    return { success: false, message: `Fehler beim Löschen der Buchungen: ${errorMessage}`, actionToken };
  }
}
