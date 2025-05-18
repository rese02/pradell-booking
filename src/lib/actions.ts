
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, CreateBookingFormData as AdminCreateBookingFormData } from "@/lib/definitions";
import {
  findMockBookingByToken,
  updateMockBookingByToken,
  addMockBooking,
  deleteMockBookingsByIds,
  getMockBookings,
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
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"]; // Removed GIF for simplicity with Data URI
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
  currentStep?: number; 
};

function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function logFormDataMinimal(context: string, bookingToken: string, rawFormDataEntries: Record<string, any>) {
  try {
    const loggableEntries: Record<string, any> = {};
    for (const key in rawFormDataEntries) {
      if (Object.prototype.hasOwnProperty.call(rawFormDataEntries, key)) {
        const value = rawFormDataEntries[key];
        if (value instanceof File) {
          loggableEntries[key] = { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified };
        } else if (typeof value === 'string' && value.length > 100 && key !== 'currentActionToken') {
          loggableEntries[key] = value.substring(0, 100) + "...[truncated]";
        } else {
          loggableEntries[key] = value;
        }
      }
    }
    console.log(`${context} FormData for token "${bookingToken}" (minimal):`, JSON.stringify(loggableEntries, null, 2));
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`${context} Error logging FormData for token "${bookingToken}":`, err.message, err.stack?.substring(0,200));
  }
}

function stringifyReplacer(key: string, value: any) {
  if (value === undefined) {
    return 'undefined';
  }
  if (value instanceof File) {
    return { name: value.name, size: value.size, type: value.type };
  }
  if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token')) {
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
  forActionToken?: string
): Promise<FormState> {
  const currentActionToken = forActionToken || generateActionToken();
  console.log(`[Action updateBookingStep BEGIN - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${currentActionToken}. Timestamp: ${new Date().toISOString()}`);

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error converting FormData for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler: Formularverarbeitung fehlgeschlagen (Code UDB-FDCONV) für Schritt ${stepNumber}.`,
      errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: currentActionToken, updatedGuestData: null, currentStep: stepNumber -1,
    };
  }

  let validatedFields: z.SafeParseReturnType<any, any>;
  try {
    validatedFields = actionSchema.safeParse(rawFormData);
  } catch (e) {
     const err = e instanceof Error ? e : new Error(String(e));
     console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Zod parsing error for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
     return {
       message: `Serverfehler: Datenvalidierung fehlgeschlagen (Code UDB-ZODPARSE) für Schritt ${stepNumber}.`,
       errors: { global: ["Datenvalidierung fehlgeschlagen."] }, success: false, actionToken: currentActionToken, updatedGuestData: null, currentStep: stepNumber -1,
     };
  }

  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    console.warn(`[Action updateBookingStep - Step ${stepNumber}] Validation FAILED for token "${bookingToken}":`, JSON.stringify(fieldErrors, stringifyReplacer, 2));
    return {
      errors: fieldErrors,
      message: `Validierungsfehler für Schritt ${stepNumber}. Bitte Eingaben prüfen.`,
      success: false, actionToken: currentActionToken, updatedGuestData: null, currentStep: stepNumber -1,
    };
  }
  
  const dataFromForm = validatedFields.data;
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Zod validation successful for token "${bookingToken}". Validated data (first 500 chars):`, JSON.stringify(dataFromForm, stringifyReplacer, 2).substring(0, 500) + "...");
  
  const fileFieldsToLog: Record<string, any> = {};
  const fileFieldsDefinition: { formDataKey: keyof typeof dataFromForm; urlKey: keyof GuestSubmittedData }[] = [
    { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
    { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
    { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
  ];

  fileFieldsDefinition.forEach(fieldDef => {
    if (fieldDef.formDataKey in dataFromForm && dataFromForm[fieldDef.formDataKey] instanceof File) {
      const file = dataFromForm[fieldDef.formDataKey] as File;
      fileFieldsToLog[String(fieldDef.formDataKey)] = { name: file.name, size: file.size, type: file.type };
    }
  });
  if(Object.keys(fileFieldsToLog).length > 0) console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated File objects from Zod:`, JSON.stringify(fileFieldsToLog));


  let booking: Booking | undefined;
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;

  try {
    booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking NOT FOUND for token: "${bookingToken}"`);
      return { message: "Buchung nicht gefunden (Code UDB-BNF).", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: currentActionToken, updatedGuestData: null, currentStep: stepNumber - 1 };
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking found for token "${bookingToken}". Status: ${booking.status}.`);
    currentGuestDataSnapshot = booking.guestSubmittedData ? JSON.parse(JSON.stringify(booking.guestSubmittedData)) : { lastCompletedStep: -1 };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error fetching/preparing booking for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler: Buchungsdaten konnten nicht geladen werden (Code UDB-LOADFAIL) für Schritt ${stepNumber}.`,
      errors: { global: ["Fehler beim Laden der Buchung."] }, success: false, actionToken: currentActionToken, updatedGuestData: null, currentStep: stepNumber -1,
    };
  }

  let updatedGuestData: GuestSubmittedData = {
    ...(currentGuestDataSnapshot || { lastCompletedStep: -1 }),
    ...(additionalDataToMerge || {}),
    ...dataFromForm,
  };

  for (const field of fileFieldsDefinition) {
    const file = dataFromForm[field.formDataKey as keyof typeof dataFromForm] as File | undefined | null;
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing file field: ${String(field.formDataKey)} for token "${bookingToken}". File in validated data: ${!!(file && file.size > 0)}`);

    try {
      if (file instanceof File && file.size > 0) {
        // WARNING: Converting images to Data URIs can be resource-intensive and lead to server overload
        // for large files or multiple uploads. This is a mock implementation for development.
        // For production, upload directly to cloud storage (e.g., Firebase Storage).
        if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          console.log(`[Action updateBookingStep - Step ${stepNumber}] Converting image ${file.name} (size: ${file.size}, type: ${file.type}) to Data URI for token "${bookingToken}"`);
          const arrayBuffer = await file.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          (updatedGuestData as any)[field.urlKey] = `data:${file.type};base64,${base64}`;
          console.log(`[Action updateBookingStep - Step ${stepNumber}] Image ${file.name} converted to Data URI (length: ${ (updatedGuestData as any)[field.urlKey].length }) for token "${bookingToken}"`);
        } else if (ACCEPTED_PDF_TYPES.includes(file.type)) {
          (updatedGuestData as any)[field.urlKey] = `mock-file-url:${encodeURIComponent(file.name)}`;
           console.log(`[Action updateBookingStep - Step ${stepNumber}] Stored MOCK PDF URL for ${file.name}: ${(updatedGuestData as any)[field.urlKey]} into key ${String(field.urlKey)} for token "${bookingToken}"`);
        } else {
          // This case should ideally be caught by Zod validation earlier
          console.warn(`[Action updateBookingStep - Step ${stepNumber}] Unsupported file type ${file.type} for ${file.name} encountered for token "${bookingToken}". Storing as generic mock file.`);
          (updatedGuestData as any)[field.urlKey] = `mock-file-url:UNSUPPORTED_${encodeURIComponent(file.name)}`;
        }
      } else if ((currentGuestDataSnapshot as any)?.[field.urlKey]) {
        // No new file provided, keep the existing URL if there is one
        (updatedGuestData as any)[field.urlKey] = (currentGuestDataSnapshot as any)[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(field.formDataKey)}, kept old URL: ${(updatedGuestData as any)[field.urlKey]?.substring(0,80)}... for token "${bookingToken}"`);
      } else {
        // No new file and no old file URL, so ensure the key is not present or is null
        delete (updatedGuestData as any)[field.urlKey];
         console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file and no old URL for ${String(field.formDataKey)}. Deleted key ${String(field.urlKey)} for token "${bookingToken}".`);
      }
    } catch (fileProcessingError: any) {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error during file processing for ${String(field.formDataKey)} (Token "${bookingToken}"):`, fileProcessingError.message, fileProcessingError.stack?.substring(0, 500));
      return {
        message: `Serverfehler: Dateiverarbeitung für ${String(field.formDataKey)} fehlgeschlagen (Code UDB-FILEPROC): ${fileProcessingError.message}.`,
        errors: { [String(field.formDataKey)]: [fileProcessingError.message] },
        success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
      };
    }
  }
  
  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1); 
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data POST-FILE-PROCESSING for token "${bookingToken}". New lastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);
  
  if (stepNumber === 4) { // Endgültige Bestätigung (Schritt 4 ist der letzte interaktive Schritt)
    if (updatedGuestData.agbAkzeptiert === true && updatedGuestData.datenschutzAkzeptiert === true) {
      updatedGuestData.submittedAt = new Date().toISOString();
      console.log(`[Action updateBookingStep - Step ${stepNumber}] AGB & Datenschutz akzeptiert. SubmittedAt gesetzt für Token "${bookingToken}".`);
    } else {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] AGB und/oder Datenschutz NICHT akzeptiert für Token "${bookingToken}". SubmittedAt NICHT gesetzt.`);
       return {
        message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
        errors: { 
            agbAkzeptiert: updatedGuestData.agbAkzeptiert ? undefined : ["AGB müssen akzeptiert werden."],
            datenschutzAkzeptiert: updatedGuestData.datenschutzAkzeptiert ? undefined : ["Datenschutz muss akzeptiert werden."],
         },
        success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
      };
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

  if (stepNumber === 4 && updatedGuestData.submittedAt && booking.status !== "Cancelled") {
    bookingUpdates.status = "Confirmed";
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking status für Token "${bookingToken}" wird auf "Confirmed" gesetzt.`);
  }
  
  let updateSuccess = false;
  try {
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Attempting to update mock DB for token "${bookingToken}" with data (first 800 chars): ${JSON.stringify(bookingUpdates, stringifyReplacer, 2).substring(0, 800)}...`);
    updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates);
  } catch (e: any) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error during updateMockBookingByToken for token "${bookingToken}":`, e.message, e.stack?.substring(0,500));
    return {
      message: `Serverfehler: Buchung konnte nicht gespeichert werden (Code UDB-DBSAVE) für Schritt ${stepNumber}.`,
      errors: {global: ["Fehler beim Speichern der Buchung."]}, success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
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
    console.log(`[Action updateBookingStep - Step ${stepNumber}] ENDING successfully for token "${bookingToken}". ActionToken: ${currentActionToken}`);
    return {
      message, errors: null, success: true, actionToken: currentActionToken, updatedGuestData: updatedGuestData, currentStep: stepNumber -1,
    };
  } else {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: "${bookingToken}" in mock DB (updateMockBookingByToken returned false).`);
    return {
      message: "Fehler beim Speichern der Daten (Code UDB-DBNOSAVE). Buchung konnte nicht gefunden oder aktualisiert werden.",
      errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: currentActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
    };
  }
}

// --- Exported Server Actions ---
// Outer try-catch for each action to ensure a FormState is always returned

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitGastStammdatenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    return await updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitGastStammdatenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Verarbeiten der Stammdaten aufgetreten (Code SA-STAMM-CATCH).",
      errors: { global: ["Serverfehler bei Stammdaten-Verarbeitung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep
    };
  }
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitAusweisdokumenteAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    logFormDataMinimal(`[Action submitAusweisdokumenteAction FormData BEFORE updateBookingStep]`, bookingToken, Object.fromEntries(formData.entries()));
    const result = await updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData, {}, serverActionToken);
    console.log(`[Action submitAusweisdokumenteAction AFTER updateBookingStep] Result for token "${bookingToken}" (first 300 chars):`, JSON.stringify(result, stringifyReplacer, 2).substring(0,300)+"...");
    return result;
  } catch (error: any) {
    console.error(`[Action submitAusweisdokumenteAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: `Ein schwerwiegender Serverfehler ist beim Verarbeiten der Ausweisdokumente aufgetreten (Code SA-AUSWEIS-CATCH).`,
      errors: { global: ["Serverfehler bei Ausweisdokument-Verarbeitung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep
    };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitZahlungsinformationenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    logFormDataMinimal(`[Action submitZahlungsinformationenAction FormData BEFORE updateBookingStep]`, bookingToken, Object.fromEntries(formData.entries()));
    const result = await updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {}, serverActionToken);
    console.log(`[Action submitZahlungsinformationenAction AFTER updateBookingStep] Result for token "${bookingToken}" (first 300 chars):`, JSON.stringify(result, stringifyReplacer, 2).substring(0,300)+"...");
    return result;
  } catch (error: any) {
    console.error(`[Action submitZahlungsinformationenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Verarbeiten der Zahlungsinformationen aufgetreten (Code SA-ZAHLUNG-CATCH).",
      errors: { global: ["Serverfehler bei Zahlungsinformationen-Verarbeitung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep
    };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitEndgueltigeBestaetigungAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    logFormDataMinimal(`[Action submitEndgueltigeBestaetigungAction FormData BEFORE updateBookingStep]`, bookingToken, Object.fromEntries(formData.entries()));
    const result = await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData, {}, serverActionToken);
    console.log(`[Action submitEndgueltigeBestaetigungAction AFTER updateBookingStep] Result for token "${bookingToken}" (first 300 chars):`, JSON.stringify(result, stringifyReplacer, 2).substring(0,300)+"...");
    return result;
  } catch (error: any) {
    console.error(`[Action submitEndgueltigeBestaetigungAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Abschließen der Buchung aufgetreten (Code SA-FINAL-CATCH).",
      errors: { global: ["Serverfehler beim Abschluss der Buchung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep
    };
  }
}


export async function createBookingAction(prevState: FormState | any, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action createBookingAction BEGIN] Action Token: ${serverActionToken}`);
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    logFormDataMinimal("[Action createBookingAction Raw FormData]", "N/A - new booking", rawFormData);
    const validatedFields = createBookingSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      console.error("[Action createBookingAction] Validation FAILED:", JSON.stringify(fieldErrors, stringifyReplacer, 2));
      return {
        errors: fieldErrors,
        message: "Fehler bei der Validierung der Buchungsdaten.",
        success: false,
        actionToken: serverActionToken,
        bookingToken: null, // Hinzugefügt für Konsistenz mit dem erwarteten Rückgabetyp
      } as any; // Type assertion to satisfy broader FormState while including bookingToken for this specific action
    }

    const bookingData = validatedFields.data;
    console.log("[Action createBookingAction] Validation successful. Data:", JSON.stringify(bookingData, stringifyReplacer, 2));

    const newBookingId = Date.now().toString(36).slice(-6) + Math.random().toString(36).substring(2, 8);
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
      roomIdentifier: `${bookingData.zimmertyp || 'Zimmer'} (${bookingData.erwachsene} Erw.)`,
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
      actionToken: serverActionToken,
      updatedGuestData: newBooking.guestSubmittedData, 
      bookingToken: newBookingToken, // For CreateBookingDialog to access
    } as any; // Type assertion
  } catch (e: any) {
    console.error("[Action createBookingAction CRITICAL UNCAUGHT ERROR]:", e.message, e.stack?.substring(0,800));
    return {
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden (Code SA-CREATE-CATCH).",
        errors: { global: ["Serverfehler beim Erstellen der Buchung."] },
        success: false,
        actionToken: serverActionToken,
        bookingToken: null,
    } as any; // Type assertion
  }
}


export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const actionToken = generateActionToken();
  console.log(`[Action deleteBookingsAction BEGIN] Attempting to delete bookings with IDs: ${bookingIds.join(', ')}. Action Token: ${actionToken}`);
  
  if (!bookingIds || bookingIds.length === 0) {
    console.warn("[Action deleteBookingsAction] No booking IDs provided for deletion.");
    return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken };
  }

  try {
    const deleteSuccess = deleteMockBookingsByIds(bookingIds);

    if (deleteSuccess) {
      revalidatePath("/admin/dashboard", "layout"); 
      console.log(`[Action deleteBookingsAction] Successfully deleted bookings. Revalidating dashboard.`);
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken };
    } else {
      console.warn(`[Action deleteBookingsAction] deleteMockBookingsByIds reported NO success for IDs: ${bookingIds.join(', ')}`);
      return { success: false, message: "Buchungen konnten nicht aus der Mock-DB gelöscht werden (interne Logik).", actionToken };
    }
  } catch (error: any) {
    console.error(`[Action deleteBookingsAction CRITICAL UNCAUGHT ERROR] Error deleting bookings: ${error.message}`, error.stack?.substring(0, 800));
    return { success: false, message: `Fehler beim Löschen der Buchungen (Code SA-DELETE-CATCH): ${error.message}`, actionToken };
  }
}
