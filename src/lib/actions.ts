
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import {
  findMockBookingByToken,
  updateMockBookingByToken,
  addMockBooking,
  deleteMockBookingsByIds,
  getMockBookings,
} from "@/lib/mock-db"; // Will be replaced by Firestore later
import { storage } from "@/lib/firebase"; // Import Firebase Storage instance
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

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
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
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
    const age = new Date().getFullYear() - date.getFullYear();
    return !isNaN(date.getTime()) && age >=0 && age < 120; // Basic age check
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

function stringifyReplacer(key: string, value: any) {
  if (value === undefined) {
    return 'undefined';
  }
  if (value instanceof File) {
    return { name: value.name, size: value.size, type: value.type };
  }
  if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) {
    return value.substring(0, 200) + `...[truncated ${value.length} bytes]`;
  }
  return value;
}

function logSafe(context: string, data: any) {
    try {
        // For very large objects, log only top-level keys or a summary
        if (typeof data === 'object' && data !== null && Object.keys(data).length > 10) {
            console.log(`${context} (Object with ${Object.keys(data).length} keys, logging summary):`, {
                keys: Object.keys(data),
                // Log small parts of potentially large data like guestSubmittedData
                guestSubmittedDataSummary: data.guestSubmittedData ? JSON.stringify(data.guestSubmittedData, (k,v) => (v instanceof File ? {name:v.name, size:v.size, type:v.type} : v), 2).substring(0, 300) + "..." : "N/A"
            });
        } else {
            console.log(context, JSON.stringify(data, stringifyReplacer, 2));
        }
    } catch (e) {
        console.error(`${context} FAILED TO STRINGIFY/LOG:`, e);
        if (typeof data === 'object' && data !== null) {
            console.log(`${context} Logging keys of problematic object:`, Object.keys(data));
        } else {
            console.log(`${context} Problematic data is not an object or is null.`);
        }
    }
}


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-indexed
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>,
  forActionToken?: string
): Promise<FormState> {
  const serverActionToken = forActionToken || generateActionToken();
  console.log(`[Action updateBookingStep BEGIN - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${serverActionToken}. Timestamp: ${new Date().toISOString()}`);

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
    logSafe(`[Action updateBookingStep - Step ${stepNumber}] Raw FormData for token "${bookingToken}" (minimal):`, rawFormData);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error converting FormData for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler: Formularverarbeitung fehlgeschlagen (Code UDB-FDCONV) für Schritt ${stepNumber}.`,
      errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: serverActionToken, updatedGuestData: null, currentStep: stepNumber -1,
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
       errors: { global: ["Datenvalidierung fehlgeschlagen."] }, success: false, actionToken: serverActionToken, updatedGuestData: null, currentStep: stepNumber -1,
     };
  }

  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    logSafe(`[Action updateBookingStep - Step ${stepNumber}] Validation FAILED for token "${bookingToken}":`, fieldErrors);
    return {
      errors: fieldErrors,
      message: `Validierungsfehler für Schritt ${stepNumber}. Bitte Eingaben prüfen.`,
      success: false, actionToken: serverActionToken, updatedGuestData: null, currentStep: stepNumber -1,
    };
  }
  
  const dataFromForm = validatedFields.data;
  const fileFieldsInForm = Object.keys(dataFromForm).filter(key => dataFromForm[key] instanceof File && dataFromForm[key].size > 0);
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Zod validation successful for token "${bookingToken}". File fields found: ${fileFieldsInForm.join(', ') || 'None'}.`);


  let booking: Booking | undefined;
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;

  try {
    // In the future, this will fetch from Firestore. For now, mock DB.
    booking = findMockBookingByToken(bookingToken); 
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking NOT FOUND for token: "${bookingToken}"`);
      return { message: "Buchung nicht gefunden (Code UDB-BNF).", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: serverActionToken, updatedGuestData: null, currentStep: stepNumber - 1 };
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking found for token "${bookingToken}". Status: ${booking.status}.`);
    currentGuestDataSnapshot = booking.guestSubmittedData ? JSON.parse(JSON.stringify(booking.guestSubmittedData)) : { lastCompletedStep: -1 };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error fetching/preparing booking for token "${bookingToken}":`, err.message, err.stack?.substring(0,500));
    return {
      message: `Serverfehler: Buchungsdaten konnten nicht geladen werden (Code UDB-LOADFAIL) für Schritt ${stepNumber}.`,
      errors: { global: ["Fehler beim Laden der Buchung."] }, success: false, actionToken: serverActionToken, updatedGuestData: null, currentStep: stepNumber -1,
    };
  }

  let updatedGuestData: GuestSubmittedData = {
    ...(currentGuestDataSnapshot || { lastCompletedStep: -1 }),
    ...(additionalDataToMerge || {}),
    ...dataFromForm,
  };
  // Remove File objects from updatedGuestData before logging/saving, URLs will be added
  fileFieldsInForm.forEach(key => delete (updatedGuestData as any)[key]);
  logSafe(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data (files removed for now) for token "${bookingToken}":`, updatedGuestData);

  // Define which form fields correspond to which URL keys in GuestSubmittedData
  const fileFieldsDefinition: { formDataKey: keyof typeof dataFromForm; urlKey: keyof GuestSubmittedData }[] = [
    { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
    { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
    { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
  ];
  
  for (const fieldDef of fileFieldsDefinition) {
    const file = dataFromForm[fieldDef.formDataKey] as File | undefined | null;
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing file field: ${String(fieldDef.formDataKey)} for token "${bookingToken}". File in validated data: ${!!(file && file.size > 0)}`);

    if (file instanceof File && file.size > 0) {
      try {
        const filePath = `bookings/${bookingToken}/${String(fieldDef.formDataKey)}/${Date.now()}_${file.name}`;
        const fileStorageRef = storageRef(storage, filePath);
        
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Attempting to upload ${file.name} (size: ${file.size}, type: ${file.type}) to Firebase Storage at ${filePath} for token "${bookingToken}"`);
        const fileBuffer = await file.arrayBuffer();
        await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
        const downloadURL = await getDownloadURL(fileStorageRef);
        
        (updatedGuestData as any)[fieldDef.urlKey] = downloadURL;
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Successfully uploaded ${file.name}. Download URL: ${downloadURL} stored in ${String(fieldDef.urlKey)} for token "${bookingToken}"`);

      } catch (fileProcessingError: any) {
        console.error(`[Action updateBookingStep - Step ${stepNumber}] Firebase Storage upload/processing FAILED for ${String(fieldDef.formDataKey)} (Token "${bookingToken}"):`, fileProcessingError.message, fileProcessingError.stack?.substring(0, 500));
        return {
          message: `Serverfehler: Dateiverarbeitung für ${String(fieldDef.formDataKey)} fehlgeschlagen: ${fileProcessingError.message}. (Code UDB-FIREBASE-UPLOAD)`,
          errors: { [String(fieldDef.formDataKey)]: [`Hochladen fehlgeschlagen: ${fileProcessingError.message}`] },
          success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
        };
      }
    } else if ((currentGuestDataSnapshot as any)?.[fieldDef.urlKey]) {
      (updatedGuestData as any)[fieldDef.urlKey] = (currentGuestDataSnapshot as any)[fieldDef.urlKey];
      console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(fieldDef.formDataKey)}, kept old URL: ${(updatedGuestData as any)[fieldDef.urlKey]?.substring(0,80)}... for token "${bookingToken}"`);
    } else {
      delete (updatedGuestData as any)[fieldDef.urlKey];
      console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file and no old URL for ${String(fieldDef.formDataKey)}. Ensured key ${String(fieldDef.urlKey)} is not present for token "${bookingToken}".`);
    }
  }
  
  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1);
  logSafe(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data POST-FILE-PROCESSING for token "${bookingToken}". New lastCompletedStep: ${updatedGuestData.lastCompletedStep}. Final guest data:`, updatedGuestData);
  
  if (stepNumber === 4) { // Final confirmation step
    if (updatedGuestData.agbAkzeptiert === true && updatedGuestData.datenschutzAkzeptiert === true) {
      updatedGuestData.submittedAt = new Date().toISOString();
      console.log(`[Action updateBookingStep - Step ${stepNumber}] AGB & Datenschutz akzeptiert. SubmittedAt gesetzt für Token "${bookingToken}".`);
    } else {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] AGB und/oder Datenschutz NICHT akzeptiert (nach Zod-Validierung!) für Token "${bookingToken}". SubmittedAt NICHT gesetzt.`);
       return {
        message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
        errors: { 
            agbAkzeptiert: updatedGuestData.agbAkzeptiert ? undefined : ["AGB müssen akzeptiert werden."],
            datenschutzAkzeptiert: updatedGuestData.datenschutzAkzeptiert ? undefined : ["Datenschutz muss akzeptiert werden."],
         },
        success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
      };
    }
  }

  const bookingUpdates: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
    updatedAt: new Date().toISOString(),
  };

  if (updatedGuestData.gastVorname && updatedGuestData.gastNachname && stepNumber === 1) {
    bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
    bookingUpdates.guestLastName = updatedGuestData.gastNachname;
  }

  if (stepNumber === 4 && updatedGuestData.submittedAt && booking.status !== "Cancelled") {
    bookingUpdates.status = "Confirmed";
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking status für Token "${bookingToken}" wird auf "Confirmed" gesetzt.`);
  }
  
  let updateSuccess = false;
  try {
    logSafe(`[Action updateBookingStep - Step ${stepNumber}] Attempting to update mock DB for token "${bookingToken}" with data:`, bookingUpdates);
    // Replace with Firestore update in the future
    updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates); 
  } catch (e: any) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error during DB update for token "${bookingToken}":`, e.message, e.stack?.substring(0,500));
    return {
      message: `Serverfehler: Buchung konnte nicht gespeichert werden (Code UDB-DBSAVE) für Schritt ${stepNumber}.`,
      errors: {global: ["Fehler beim Speichern der Buchung."]}, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
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
    console.log(`[Action updateBookingStep - Step ${stepNumber}] ENDING successfully for token "${bookingToken}". ActionToken: ${serverActionToken}`);
    return {
      message, errors: null, success: true, actionToken: serverActionToken, updatedGuestData: updatedGuestData, currentStep: stepNumber -1,
    };
  } else {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: "${bookingToken}" in mock DB (updateMockBookingByToken returned false).`);
    return {
      message: "Fehler beim Speichern der Daten (Code UDB-DBNOSAVE). Buchung konnte nicht gefunden oder aktualisiert werden.",
      errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
    };
  }
}

// --- Exported Server Actions ---
// Wrapper functions with top-level try-catch
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
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0
    };
  }
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitAusweisdokumenteAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    return await updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitAusweisdokumenteAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: `Ein schwerwiegender Serverfehler ist beim Verarbeiten der Ausweisdokumente aufgetreten (Code SA-AUSWEIS-CATCH).`,
      errors: { global: ["Serverfehler bei Ausweisdokument-Verarbeitung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0
    };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitZahlungsinformationenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    const booking = findMockBookingByToken(bookingToken);
    let anzahlungsbetrag = 0;
    if (booking?.price) {
        anzahlungsbetrag = parseFloat((booking.price * 0.3).toFixed(2));
    }
    // Pass anzahlungsbetrag explicitly if it's not part of the form,
    // or ensure zahlungsinformationenSchema includes it and it's correctly parsed from formData.
    // The schema now includes zahlungsbetrag, so no need for additionalDataToMerge here.
    return await updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitZahlungsinformationenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Verarbeiten der Zahlungsinformationen aufgetreten (Code SA-ZAHLUNG-CATCH).",
      errors: { global: ["Serverfehler bei Zahlungsinformationen-Verarbeitung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0
    };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitEndgueltigeBestaetigungAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}. Prev Step: ${prevState.currentStep}`);
  try {
    return await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitEndgueltigeBestaetigungAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return {
      message: "Ein schwerwiegender Serverfehler ist beim Abschließen der Buchung aufgetreten (Code SA-FINAL-CATCH).",
      errors: { global: ["Serverfehler beim Abschluss der Buchung."] },
      success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0
    };
  }
}


export async function createBookingAction(prevState: FormState | any, formData: FormData): Promise<FormState & { bookingToken?: string | null }> {
  const serverActionToken = generateActionToken();
  console.log(`[Action createBookingAction BEGIN] Action Token: ${serverActionToken}`);
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    logSafe("[Action createBookingAction Raw FormData]", rawFormData);
    const validatedFields = createBookingSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      console.error("[Action createBookingAction] Validation FAILED:", JSON.stringify(fieldErrors, stringifyReplacer, 2));
      return {
        errors: fieldErrors,
        message: "Fehler bei der Validierung der Buchungsdaten.",
        success: false,
        actionToken: serverActionToken,
        bookingToken: null, 
      };
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
      roomIdentifier: `${bookingData.zimmertyp || 'Zimmer'} (${bookingData.erwachsene} Erw.)`, // Example
      guestSubmittedData: {
        lastCompletedStep: -1,
      }
    };
    // Replace with Firestore add in the future
    addMockBooking(newBooking); 
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);

    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout"); 

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      errors: null,
      success: true,
      actionToken: serverActionToken,
      updatedGuestData: newBooking.guestSubmittedData, 
      bookingToken: newBookingToken,
    };
  } catch (e: any) {
    console.error("[Action createBookingAction CRITICAL UNCAUGHT ERROR]:", e.message, e.stack?.substring(0,800));
    return {
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden (Code SA-CREATE-CATCH).",
        errors: { global: ["Serverfehler beim Erstellen der Buchung."] },
        success: false,
        actionToken: serverActionToken,
        bookingToken: null,
    };
  }
}


export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  console.log(`[Action deleteBookingsAction BEGIN] Attempting to delete bookings with IDs: ${bookingIds.join(', ')}. Action Token: ${serverActionToken}`);
  
  if (!bookingIds || bookingIds.length === 0) {
    console.warn("[Action deleteBookingsAction] No booking IDs provided for deletion.");
    return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
  }

  try {
    // Replace with Firestore delete in the future
    const deleteSuccess = deleteMockBookingsByIds(bookingIds); 

    if (deleteSuccess) {
      revalidatePath("/admin/dashboard", "layout"); 
      console.log(`[Action deleteBookingsAction] Successfully deleted bookings. Revalidating dashboard.`);
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
      console.warn(`[Action deleteBookingsAction] deleteMockBookingsByIds reported NO success for IDs: ${bookingIds.join(', ')}`);
      return { success: false, message: "Buchungen konnten nicht aus der Mock-DB gelöscht werden (interne Logik).", actionToken: serverActionToken };
    }
  } catch (error: any) {
    console.error(`[Action deleteBookingsAction CRITICAL UNCAUGHT ERROR] Error deleting bookings: ${error.message}`, error.stack?.substring(0, 800));
    return { success: false, message: `Fehler beim Löschen der Buchungen (Code SA-DELETE-CATCH): ${error.message}`, actionToken: serverActionToken };
  }
}
