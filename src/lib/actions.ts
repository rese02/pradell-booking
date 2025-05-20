
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, Mitreisender as MitreisenderData, RoomDetail } from "@/lib/definitions";
import {
  addBookingToFirestore,
  findBookingByTokenFromFirestore,
  // findBookingByIdFromFirestore, // Not directly used by guest actions but by deleteBookingsAction
  updateBookingInFirestore,
  deleteBookingsFromFirestoreByIds,
} from "./mock-db"; 
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase"; // Added db and firebaseInitializationError
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string; // Unique token for this specific action invocation
  updatedGuestData?: GuestSubmittedData | null; // The full, updated guest data after successful action
  currentStep?: number; // 0-indexed, for UI to know which step's state this is
  bookingToken?: string | null; // For createBookingAction
};

const initialFormState: FormState = { message: null, errors: null, success: false, actionToken: undefined, updatedGuestData: null, bookingToken: null };

function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE_BYTES, { message: `Maximale Dateigröße ist ${MAX_FILE_SIZE_MB}MB.`})
  .refine(
    (file) => {
      if (!file || file.size === 0) return true; 
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

// Helper to convert Firestore Timestamps in GuestSubmittedData to ISO strings for client
function convertTimestampsInGuestData(data?: GuestSubmittedData | null): GuestSubmittedData | null | undefined {
  if (!data) return data;
  const newGuestData: GuestSubmittedData = { ...data }; // Create a mutable copy

  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum']; 

  for (const field of dateFields) {
    const value = newGuestData[field];
    if (value instanceof Timestamp) {
      (newGuestData[field] as any) = value.toDate().toISOString();
    } else if (value instanceof Date) { // Should ideally be Timestamps from Firestore, but handle if Date
      (newGuestData[field] as any) = value.toISOString();
    }
  }
  if (newGuestData.mitreisende) {
    newGuestData.mitreisende = newGuestData.mitreisende.map(m => {
        const newM = {...m};
        // Add timestamp conversions for mitreisende if they have date fields in future
        return newM;
    });
  }
  return newGuestData;
}


// Schemas for each step of the guest booking form
const gastStammdatenSchema = z.object({
  anrede: z.enum(["Frau", "Herr", "Divers"], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => !val || !isNaN(Date.parse(val)) || val === '', { message: "Ungültiges Geburtsdatum."}).transform(val => val === '' ? undefined : val), // Allow empty string, then convert to undefined
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
  alterHauptgast: z.string().optional()
    .transform(val => val && val.trim() !== "" ? parseInt(val, 10) : undefined)
    .refine(val => val === undefined || (typeof val === 'number' && !isNaN(val) && val > 0 && val < 120), { message: "Alter muss eine plausible Zahl sein." }),
  hauptgastAusweisVorderseiteFile: fileSchema,
  hauptgastAusweisRückseiteFile: fileSchema,
});

const mitreisenderEinzelschema = z.object({
  id: z.string(), // Used for client-side list management, not stored directly in Mitreisender object in DB
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
  // Ausweis files are handled by name convention in FormData, not explicitly in this meta object
});

const mitreisendeSchema = z.object({
  // This string contains JSON of {id: string, vorname: string, nachname: string}[]
  mitreisendeMeta: z.string().transform((str, ctx) => {
    if (!str) return []; // Handle empty string for no companions
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta muss ein Array sein." });
        return z.NEVER;
      }
      // Validate each item in the array against mitreisenderEinzelschema
      const result = z.array(mitreisenderEinzelschema).safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehler in einzelnen Mitreisenden-Daten: " + result.error.flatten().fieldErrors });
        return z.NEVER;
      }
      return result.data;
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON." });
      return z.NEVER;
    }
  }).optional(), // Optional if no companions are added
  // File fields for companions are handled dynamically based on IDs in mitreisendeMeta
});


const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(['downpayment', 'full_amount'], { required_error: "Bitte wählen Sie eine Zahlungssumme." }),
});

const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.string().transform(val => parseFloat(val)).refine(val => !isNaN(val) && val > 0, "Überwiesener Betrag muss eine positive Zahl sein."),
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den AGB zustimmen.",
  })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
  })),
});


function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const simplifiedData = JSON.stringify(data, (key, value) => {
        if (value instanceof File) { return { name: value.name, size: value.size, type: value.type }; }
        if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url')) { return value.substring(0, 100) + "...[TRUNCATED]"; }
        if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack?.substring(0,100) + "...[TRUNCATED]" }; }
        return value;
    }, 0); // Using 0 for indentation for more compact logs.
    const logMessage = `[Action ${context}] ${simplifiedData.length > 2000 ? simplifiedData.substring(0, 2000) + '... [LOG TRUNCATED]' : simplifiedData}`;
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}


// Core function to update booking data for each step of the guest form
async function updateBookingStep(
  forActionToken: string, // The unique token for this action invocation
  bookingTokenParam: string, // The booking token from the URL
  stepNumber: number, // 1-indexed step number (e.g., 1 for GastStammdaten)
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>, // For data not directly from form fields of this step
  mitreisendeMetaForFileHandling?: MitreisenderData[] // Only for step 2 to handle companion files
): Promise<FormState> {
  const actionContext = `updateBookingStep(Token:${bookingTokenParam}, Step:${stepNumber}, Action:${forActionToken})`;
  logSafe(`${actionContext} BEGIN]`, { formDataKeys: Array.from(formData.keys()) });
  const startTime = Date.now();

  // 1. Check Firebase Initialization
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL). DB: ${!!db}, Storage: ${!!storage}, InitializedCorrectly: ${firebaseInitializedCorrectly}. Init Error: ${firebaseInitializationError || "N/A"}`;
    logSafe(`${actionContext} FAIL] Firebase Not Initialized`, { error: errorMsg }, 'error');
    return {
      message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] },
      success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
    };
  }

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
  } catch (e: any) {
    logSafe(`${actionContext} CRITICAL] Error converting FormData`, { error: e.message }, 'error');
    return { ...initialFormState, message: "Serverfehler: Formularverarbeitung fehlgeschlagen.", errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: forActionToken, currentStep: stepNumber -1, updatedGuestData: null };
  }

  // 2. Validate Form Data
  const validatedFields = actionSchema.safeParse(rawFormData);
  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    logSafe(`${actionContext} Validation FAILED`, { errors: fieldErrors }, 'warn');
    const bookingForErrorState = await findBookingByTokenFromFirestore(bookingTokenParam);
    return { 
        message: "Validierungsfehler. Bitte Eingaben prüfen.", errors: fieldErrors, 
        success: false, actionToken: forActionToken, 
        currentStep: stepNumber - 1, 
        updatedGuestData: convertTimestampsInGuestData(bookingForErrorState?.guestSubmittedData || null) 
    };
  }
  const dataFromForm = validatedFields.data;
  logSafe(`${actionContext} Zod validation successful.`, {dataKeys: Object.keys(dataFromForm)});

  // 3. Fetch current booking data
  let bookingDoc: Booking | null;
  try {
    bookingDoc = await findBookingByTokenFromFirestore(bookingTokenParam);
  } catch (fetchError: any) {
    logSafe(`${actionContext} FAIL] Error fetching booking from Firestore`, { error: fetchError.message }, 'error');
    return { ...initialFormState, message: `Fehler beim Abrufen der Buchung: ${fetchError.message}`, success: false, actionToken: forActionToken, currentStep: stepNumber -1 };
  }

  if (!bookingDoc || !bookingDoc.id) {
    logSafe(`${actionContext} FAIL] Booking NOT FOUND in Firestore with Token:`, { bookingTokenParam }, 'warn');
    return { ...initialFormState, message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: forActionToken, currentStep: stepNumber - 1 };
  }
  const currentGuestDataSnapshot: GuestSubmittedData = bookingDoc.guestSubmittedData ? JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData)) : { lastCompletedStep: -1 };
  
  // 4. Prepare updated guest data (merge existing, additional, and form data)
  let updatedGuestData: GuestSubmittedData = {
    ...currentGuestDataSnapshot,
    ...(additionalDataToMerge || {}),
    ...dataFromForm, // Data from the current form step
  };
  logSafe(`${actionContext} Merged base guest data.`, { keys: Object.keys(updatedGuestData) });

  // 5. Handle File Uploads to Firebase Storage
  const fileFieldsConfig: Array<{
    formDataKey: string; // Key in FormData (e.g., 'hauptgastAusweisVorderseiteFile')
    guestDataUrlKey?: keyof GuestSubmittedData; // Key in GuestSubmittedData to store the URL (e.g., 'hauptgastAusweisVorderseiteUrl')
    mitreisenderId?: string; // For companion documents
    mitreisenderUrlKey?: keyof MitreisenderData; // Key in MitreisenderData for URL
    stepAffiliation: number; // Which step this file belongs to
  }> = [
    { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl', stepAffiliation: 1 },
    { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl', stepAffiliation: 1 },
    { formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl', stepAffiliation: 4 },
  ];

  // Dynamically add file field configs for companions if this is step 2
  if (stepNumber === 2 && mitreisendeMetaForFileHandling) {
    mitreisendeMetaForFileHandling.forEach((mitreisender) => {
      if (mitreisender.id) {
        fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisender.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisender.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl', stepAffiliation: 2 });
        fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisender.id}_ausweisRückseiteFile`, mitreisenderId: mitreisender.id, mitreisenderUrlKey: 'ausweisRückseiteUrl', stepAffiliation: 2 });
      }
    });
  }
  
  for (const config of fileFieldsConfig) {
    if (config.stepAffiliation !== stepNumber) continue; // Only process files for the current step

    const file = rawFormData[config.formDataKey] as File | undefined | null;
    let oldFileUrl: string | undefined = undefined;

    // Determine old file URL for potential deletion
    if (config.mitreisenderId && config.mitreisenderUrlKey && currentGuestDataSnapshot.mitreisende) {
        const companion = currentGuestDataSnapshot.mitreisende.find(m => m.id === config.mitreisenderId);
        if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
    } else if (config.guestDataUrlKey) {
        oldFileUrl = (currentGuestDataSnapshot as any)[config.guestDataUrlKey];
    }

    if (file instanceof File && file.size > 0) { // New file uploaded
      const fileProcessingStartTime = Date.now();
      const originalFileName = file.name;
      logSafe(`${actionContext} Processing new file for ${config.formDataKey}: ${originalFileName}`, { size: file.size, type: file.type });

      // Delete old file from Firebase Storage if it exists
      if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
        try {
          const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
          await deleteObject(oldFileStorageRef);
          logSafe(`${actionContext} Old file ${oldFileUrl} deleted for ${config.formDataKey}.`);
        } catch (deleteError: any) {
          logSafe(`${actionContext} WARN: Failed to delete old file ${oldFileUrl} for ${config.formDataKey}`, { error: deleteError.message, code: deleteError.code }, 'warn');
          // Non-critical, continue with new file upload
        }
      }
      
      // Upload new file
      let downloadURL: string | undefined;
      try {
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}_${originalFileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
        let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;
        if (config.mitreisenderId) {
            filePathPrefix += `/mitreisende/${config.mitreisenderId}/${config.mitreisenderUrlKey!.replace('Url', '')}`;
        } else if (config.guestDataUrlKey) {
            filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`;
        }
        const filePath = `${filePathPrefix}/${uniqueFileName}`;
        
        logSafe(`${actionContext} Reading ArrayBuffer for ${originalFileName}...`);
        const fileBufferStartTime = Date.now();
        const fileBuffer = await file.arrayBuffer();
        logSafe(`${actionContext} ArrayBuffer for ${originalFileName} read in ${Date.now() - fileBufferStartTime}ms. Size: ${fileBuffer.byteLength}`);

        const fileStorageRef = storageRefFB(storage, filePath);
        logSafe(`${actionContext} Uploading ${originalFileName} to ${filePath}...`);
        const uploadStartTime = Date.now();
        await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
        logSafe(`${actionContext} Uploaded ${originalFileName} in ${Date.now() - uploadStartTime}ms.`);

        const getUrlStartTime = Date.now();
        downloadURL = await getDownloadURL(fileStorageRef);
        logSafe(`${actionContext} Got download URL for ${originalFileName} in ${Date.now() - getUrlStartTime}ms.`);
        
      } catch (fileUploadError: any) {
        let userMessage = `Dateiupload für ${originalFileName} fehlgeschlagen.`;
        const fbErrorCode = (fileUploadError as any).code;
        logSafe(`${actionContext} FILE UPLOAD FAIL] Firebase Storage error for ${originalFileName}`, { error: fileUploadError.message, code: fbErrorCode }, 'error');
         if (fbErrorCode === 'storage/unauthorized') {
          userMessage = `Berechtigungsfehler beim Upload von ${originalFileName}. Bitte Firebase Storage Regeln prüfen. (Code: ${fbErrorCode})`;
        } else if (fbErrorCode === 'storage/canceled') {
          userMessage = `Upload von ${originalFileName} abgebrochen. (Code: ${fbErrorCode})`;
        } // Other specific errors can be handled here
        return { 
            message: userMessage, errors: { [config.formDataKey]: [userMessage] }, 
            success: false, actionToken: forActionToken, 
            currentStep: stepNumber - 1, 
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot) 
        };
      }

      // Update URL in guestData
      if (downloadURL) {
          if (config.mitreisenderId && config.mitreisenderUrlKey) {
              if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
              let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
              if (!companion && mitreisendeMetaForFileHandling) { // Create companion entry if it doesn't exist from meta
                  const meta = mitreisendeMetaForFileHandling.find(m => m.id === config.mitreisenderId);
                  if(meta) {
                    companion = { id: meta.id, vorname: meta.vorname, nachname: meta.nachname };
                    updatedGuestData.mitreisende.push(companion);
                  }
              }
              if (companion) (companion as any)[config.mitreisenderUrlKey] = downloadURL;
          } else if (config.guestDataUrlKey) {
              (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
          }
      }
      logSafe(`${actionContext} File ${originalFileName} processed in ${Date.now() - fileProcessingStartTime}ms. URL: ${downloadURL}`);
    } else if (oldFileUrl) {
      // No new file, keep the old URL if it exists
      if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
          const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion && !(companion as any)[config.mitreisenderUrlKey]) { // Only set if not already set (e.g. by a previous new file in this same action)
               (companion as any)[config.mitreisenderUrlKey] = oldFileUrl;
          }
      } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
          (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
      }
      logSafe(`${actionContext} No new file for ${config.formDataKey}, kept old URL: ${oldFileUrl}`);
    }
    // Clean up the File object from dataFromForm as we store URL or nothing
    if (config.guestDataUrlKey) delete (updatedGuestData as any)[config.formDataKey];
    // For mitreisende, file fields are not part of mitreisendeMeta, so direct deletion from updatedGuestData based on formDataKey is fine.
    delete (updatedGuestData as any)[config.formDataKey]; 
  }
  logSafe(`${actionContext} All file uploads for step ${stepNumber} processed.`);

  // 6. Finalize data specific to steps
  updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot.lastCompletedStep ?? -1, stepNumber - 1);
  
  if (stepNumber === 4) { // Zahlungsinformationen
    updatedGuestData.zahlungsart = 'Überweisung'; // Set fixed for this step
  }

  const bookingUpdatesFirestore: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
    updatedAt: Timestamp.now(), // Firestore server timestamp
  };
  
  if (stepNumber === 1 && dataFromForm.gastVorname && dataFromForm.gastNachname) {
      bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname;
      bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname;
  }

  if (stepNumber === 5) { // Endgültige Bestätigung (AGB/Datenschutz)
    if (updatedGuestData.agbAkzeptiert === true && updatedGuestData.datenschutzAkzeptiert === true) {
      updatedGuestData.submittedAt = Timestamp.now(); // Firestore server timestamp
      bookingUpdatesFirestore.status = "Confirmed"; 
      bookingUpdatesFirestore.guestSubmittedData!.submittedAt = updatedGuestData.submittedAt; // Ensure it's in guestSubmittedData too
      logSafe(`${actionContext} Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed".`);
    } else {
      logSafe(`${actionContext} Final step, but AGB/Datenschutz NICHT akzeptiert. Status bleibt: ${bookingDoc.status}.`, {}, 'warn');
      return {
        message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
        errors: {
          agbAkzeptiert: !updatedGuestData.agbAkzeptiert ? ["AGB müssen akzeptiert werden."] : undefined,
          datenschutzAkzeptiert: !updatedGuestData.datenschutzAkzeptiert ? ["Datenschutz muss akzeptiert werden."] : undefined,
        },
        success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
      };
    }
  }

  // 7. Update Firestore
  try {
    const dbUpdateStartTime = Date.now();
    logSafe(`${actionContext} Updating Firestore with booking ID: ${bookingDoc.id}. Update keys: ${Object.keys(bookingUpdatesFirestore)}`);
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    logSafe(`${actionContext} Firestore update successful in ${Date.now() - dbUpdateStartTime}ms.`);
    
    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "layout");
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`; 
    if (bookingUpdatesFirestore.status === "Confirmed" && stepNumber === 5) { 
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return { 
        message, errors: null, success: true, actionToken: forActionToken, 
        updatedGuestData: convertTimestampsInGuestData(updatedGuestData), 
        currentStep: stepNumber - 1 
    };
  } catch (dbError: any) {
    logSafe(`${actionContext} Firestore update FAILED`, { error: dbError.message, code: dbError.code }, 'error');
    return {
        message: `Fehler beim Speichern der Daten: ${dbError.message}`,
        errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
    };
  } finally {
     logSafe(`${actionContext} END]. Total time: ${Date.now() - startTime}ms.`);
  }
}


// --- Server Actions for each step ---

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitGastStammdatenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 1, gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Stammdaten): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    const validatedMeta = mitreisendeSchema.safeParse(rawFormData); 

    if (!validatedMeta.success) {
        const fieldErrors = validatedMeta.error.flatten().fieldErrors;
        logSafe(actionContext + " Validation FAILED for Mitreisende metadata", { errors: fieldErrors }, 'warn');
        return { ...initialFormState, errors: fieldErrors, message: "Validierungsfehler bei Mitreisenden-Daten.", success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    // Pass the parsed mitreisendeMeta array for file handling logic in updateBookingStep
    return await updateBookingStep(serverActionToken, bookingToken, 2, z.object({}), formData, {}, validatedMeta.data.mitreisendeMeta);
  } catch (error: any) {
    logSafe(`${actionContext} UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Mitreisende): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
   const actionContext = `submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 3, paymentAmountSelectionSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Zahlungssumme): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    // zahlungsbetrag is now part of the schema, so additionalDataToMerge is not strictly needed for it here
    // but we set zahlungsart explicitly
    return await updateBookingStep(serverActionToken, bookingToken, 4, zahlungsinformationenSchema, formData, { zahlungsart: 'Überweisung' });
  } catch (error: any) {
    logSafe(`${actionContext} UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 5, uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Bestätigung): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
  }
}


const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number({invalid_type_error: "Anzahl Erwachsene muss eine Zahl sein."}).int().min(0, "Anzahl Erwachsene muss eine nicht-negative Zahl sein.").default(1),
  kinder: z.coerce.number({invalid_type_error: "Anzahl Kinder muss eine Zahl sein."}).int().min(0, "Anzahl Kinder muss eine nicht-negative Zahl sein.").optional().default(0),
  kleinkinder: z.coerce.number({invalid_type_error: "Anzahl Kleinkinder muss eine Zahl sein."}).int().min(0, "Anzahl Kleinkinder muss eine nicht-negative Zahl sein.").optional().default(0),
  alterKinder: z.string().optional().default(''),
});


const createBookingServerSchema = z.object({
  guestFirstName: z.string({required_error: "Vorname ist ein Pflichtfeld."}).min(1, "Vorname ist erforderlich."),
  guestLastName: z.string({required_error: "Nachname ist ein Pflichtfeld."}).min(1, "Nachname ist erforderlich."),
  price: z.coerce.number({invalid_type_error: "Preis muss eine Zahl sein.", required_error: "Preis ist ein Pflichtfeld."}).positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string({required_error: "Anreisedatum ist ein Pflichtfeld."}).min(1, "Anreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Anreisedatum." }),
  checkOutDate: z.string({required_error: "Abreisedatum ist ein Pflichtfeld."}).min(1, "Abreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Abreisedatum." }),
  verpflegung: z.string({required_error: "Verpflegung ist ein Pflichtfeld."}).min(1, "Verpflegung ist erforderlich."),
  interneBemerkungen: z.string().optional(),
  roomsData: z.string({ required_error: "Zimmerdaten sind erforderlich." })
    .min(1, "Zimmerdaten dürfen nicht leer sein.") 
    .pipe( 
      z.string().transform((str, ctx) => { 
        try {
          const parsed = JSON.parse(str);
           if (!Array.isArray(parsed) || parsed.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Mindestens ein Zimmer muss hinzugefügt werden und die Daten müssen als Liste von Zimmern übergeben werden.",
            });
            return z.NEVER;
          }
          return parsed;
        } catch (e) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Die Zimmerdaten sind nicht im korrekten JSON-Format. Bitte überprüfen Sie die Eingaben für alle Zimmer.",
          });
          return z.NEVER; 
        }
      }).pipe( 
        z.array(RoomSchema, {
          invalid_type_error: "Zimmerdaten müssen als Liste von Zimmern übergeben werden.",
          required_error: "Mindestens ein Zimmer muss angegeben werden."
        }).min(1, "Mindestens ein Zimmer muss hinzugefügt werden.")
      )
    ),
}).refine(data => {
  if (data.checkInDate && data.checkOutDate) {
    return new Date(data.checkOutDate) > new Date(data.checkInDate);
  }
  return true;
}, {
  message: "Abreisedatum muss nach dem Anreisedatum liegen.",
  path: ["dateRange"], 
});

export async function createBookingAction(prevState: FormState | any, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `createBookingAction(Action:${serverActionToken})`;
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { hasPrevState: !!prevState });

  try {
    if (!firebaseInitializedCorrectly || !db) {
      const errorMsg = firebaseInitializationError || "Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL).";
      logSafe(`${actionContext} FAIL]`, { error: errorMsg, dbExists: !!db, storageExists: !!storage, firebaseInitialized: firebaseInitializedCorrectly }, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(actionContext + " Raw FormData (keys)", {keys: Object.keys(rawFormData)});
    const validatedFields = createBookingServerSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      logSafe(actionContext + " Validation FAILED", { errors: fieldErrors }, 'warn');
      const errorsOutput: Record<string, string[]> = {};
      for (const key in fieldErrors) {
          if (key.startsWith('roomsData.') || key === 'roomsData') { 
             if (!errorsOutput['roomsData']) errorsOutput['roomsData'] = [];
             (errorsOutput['roomsData'] as string[]).push(...(fieldErrors[key as keyof typeof fieldErrors] || []).map(e => String(e)));
          } else {
            errorsOutput[key] = (fieldErrors[key as keyof typeof fieldErrors] || []).map(e => String(e));
          }
      }
      if (errorsOutput.roomsData) errorsOutput.roomsData = [...new Set(errorsOutput.roomsData)]; 

      return { ...initialFormState, errors: errorsOutput, message: "Fehler bei der Validierung. Bitte überprüfen Sie die Eingabefelder.", success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Validation successful.", {dataKeys: Object.keys(bookingData)});

    const newBookingToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

    const firstRoom = bookingData.roomsData[0];
    let personenSummary = `${firstRoom.erwachsene} Erw.`;
    if (firstRoom.kinder && firstRoom.kinder > 0) personenSummary += `, ${firstRoom.kinder} Ki.`;
    if (firstRoom.kleinkinder && firstRoom.kleinkinder > 0) personenSummary += `, ${firstRoom.kleinkinder} Kk.`;
    const roomIdentifierString = `${firstRoom.zimmertyp || 'Zimmer'} (${personenSummary})`;

    const newBookingPayload: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> = {
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: bookingData.checkInDate, // Already string, convertDatesToTimestamps will handle it
      checkOutDate: bookingData.checkOutDate, // Already string
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: bookingData.verpflegung,
      rooms: bookingData.roomsData.map((room: RoomDetail) => ({ 
        zimmertyp: room.zimmertyp,
        erwachsene: room.erwachsene,
        kinder: room.kinder,
        kleinkinder: room.kleinkinder,
        alterKinder: room.alterKinder,
      })), 
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 } 
    };

    const createdBookingId = await addBookingToFirestore(newBookingPayload);

    if (!createdBookingId) {
      const errorMsg = "Datenbankfehler: Buchung konnte nicht erstellt werden.";
      logSafe(`${actionContext} FAIL]`, { error: errorMsg, details: "addBookingToFirestore returned null or no ID." }, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    logSafe(`${actionContext} SUCCESS] New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBookingId}. Total time: ${Date.now() - startTime}ms.`);

    revalidatePath("/admin/dashboard", "layout"); // Revalidate layout to refresh data for pages using this layout
    revalidatePath(`/buchung/${newBookingToken}`, "page"); 
    revalidatePath(`/admin/bookings/${createdBookingId}`, "page"); 

    return {
      ...initialFormState,
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      success: true,
      actionToken: serverActionToken,
      bookingToken: newBookingToken, 
    };
  } catch (e: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION]:`, { error: e.message, stack: e.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler beim Erstellen der Buchung: ${e.message}`, errors: { global: ["Serverfehler beim Erstellen."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction(IDs: ${bookingIds.join(',') || 'N/A'}, Action:${serverActionToken})`;
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { bookingIdsCount: bookingIds.length });
  
  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const errorMsg = firebaseInitializationError || `Serverfehler: Firebase ist nicht korrekt initialisiert (Code DBA-FIREBASE-INIT-FAIL).`;
      logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
      return { success: false, message: errorMsg, actionToken: serverActionToken };
    }
    if (!bookingIds || bookingIds.length === 0) {
      logSafe(`${actionContext} WARN] No booking IDs provided for deletion.`, {}, 'warn');
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const deleteResult = await deleteBookingsFromFirestoreByIds(bookingIds);
    
    if (deleteResult) {
        logSafe(`${actionContext} SUCCESS] ${bookingIds.length} booking(s) and associated files handled. Total time: ${Date.now() - startTime}ms.`);
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
        logSafe(`${actionContext} PARTIAL FAIL or UNKNOWN ERROR] Some operations may have failed. Total time: ${Date.now() - startTime}ms.`, {}, 'warn');
        revalidatePath("/admin/dashboard", "layout"); // Revalidate even on partial failure
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: false, message: "Fehler beim Löschen der Buchung(en). Überprüfen Sie die Server-Logs.", actionToken: serverActionToken };
    }

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION] Error deleting bookings:`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen: ${error.message}`, actionToken: serverActionToken };
  }
}
