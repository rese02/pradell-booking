
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, Mitreisender, RoomDetail } from "@/lib/definitions";
import {
  addBookingToFirestore,
  findBookingByTokenFromFirestore,
  findBookingByIdFromFirestore,
  updateBookingInFirestore,
  deleteBookingsFromFirestoreByIds,
} from "./mock-db"; // Should be firestore-db.ts conceptually
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string; // To prevent re-processing on refresh if state persists
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number; // Optional: to help stepper sync if needed
  bookingToken?: string | null; // For createBookingAction response
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
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE_BYTES, `Maximale Dateigröße ist ${MAX_FILE_SIZE_MB}MB.`)
  .refine(
    (file) => {
      if (!file || file.size === 0) return true;
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

// Schema for Step 1: Gast-Stammdaten & Ausweis Hauptgast
const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers']).optional(),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => !val || !isNaN(Date.parse(val)), {message: "Ungültiges Geburtsdatum."}),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
  alterHauptgast: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined).refine(val => val === undefined || (typeof val === 'number' && val > 0), { message: "Alter muss eine positive Zahl sein."}),
  hauptgastAusweisVorderseiteFile: fileSchema,
  hauptgastAusweisRückseiteFile: fileSchema,
});

// Schema for Step 2: Mitreisende
const mitreisenderEinzelschema = z.object({
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
  // Optional: Add age or other fields if needed for companions
  // alter: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined).refine(val => val === undefined || (typeof val === 'number' && val > 0), { message: "Alter muss eine positive Zahl sein."}),
});
// Files for Mitreisende will be handled separately due to FormData structure for arrays of files

const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(['downpayment', 'full_amount'], { required_error: "Bitte wählen Sie eine Zahlungssumme." }),
});

const zahlungsinformationenSchema = z.object({
  zahlungsart: z.literal('Überweisung', { required_error: "Zahlungsart ist erforderlich."}),
  zahlungsdatum: z.string().min(1, "Zahlungsdatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), {
    message: "Ungültiges Zahlungsdatum."
  }),
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich."}),
  zahlungsbetrag: z.string().transform(val => parseFloat(val)).refine(val => val > 0, "Zahlungsbetrag muss positiv sein."),
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
    if (value instanceof File) {
      return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified };
    }
    if (typeof value === 'string' && value.length > 300 && !['url', 'token', 'dataUri', 'message', 'description', 'stack', 'svg'].some(k => key.toLowerCase().includes(k))) {
      return value.substring(0, 150) + `...[truncated ${value.length} chars]`;
    }
    return value;
  }, 2);
  const logMessage = `[Action ${context}] ${simplifiedData.length > 1500 ? simplifiedData.substring(0,1500) + '... [LOG TRUNCATED]' : simplifiedData}`;

  if (process.env.NODE_ENV === 'development') { // Only log extensively in development
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
  } else { // For production, only log errors or critical warnings
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn' && context.includes("CRITICAL")) console.warn(logMessage);
  }
}


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-basiert
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>,
  mitreisendeDaten?: Partial<Mitreisender>[], // For step 2
  mitreisendeFiles?: Record<string, Record<string, File | null>> // For step 2 files e.g. { 'mitreisender_0_ausweisVorderseite': File }
): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `updateBookingStep - Step ${stepNumber} - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  console.log(`[Action ${actionContext} BEGIN] Timestamp: ${new Date().toISOString()}`);
  const startTime = Date.now();

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL). DB: ${!!db}, Storage: ${!!storage}, InitializedCorrectly: ${firebaseInitializedCorrectly}. Error during init: ${firebaseInitializationError || "N/A"}`;
    logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
    return {
      message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] },
      success: false, actionToken: serverActionToken, currentStep: stepNumber -1, updatedGuestData: null
    };
  }

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
     // Log only keys for Mitreisende files for brevity
    const displayFormData = {...rawFormData};
    if (mitreisendeFiles && Object.keys(mitreisendeFiles).length > 0) {
        displayFormData.mitreisendeFiles = Object.keys(mitreisendeFiles);
    }
    logSafe(`${actionContext} Raw FormData (File objects not fully logged)`, displayFormData);
  } catch (e: any) {
    logSafe(`${actionContext} CRITICAL] Error converting FormData:`, { error: e.message, stack: e.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: "Serverfehler: Formularverarbeitung fehlgeschlagen.", errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber -1, updatedGuestData: null };
  }

  const validatedFields = actionSchema.safeParse(rawFormData);
  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    logSafe(`${actionContext} Validation FAILED`, { errors: fieldErrors }, 'warn');
    return { ...initialFormState, errors: fieldErrors, message: "Validierungsfehler. Bitte Eingaben prüfen.", success: false, actionToken: serverActionToken, currentStep: stepNumber -1, updatedGuestData: null };
  }

  const dataFromForm = validatedFields.data;
  logSafe(`${actionContext} Zod validation successful. DataFromForm`, dataFromForm);

  const bookingDoc = await findBookingByTokenFromFirestore(bookingToken);
  if (!bookingDoc || !bookingDoc.id) {
    logSafe(`${actionContext} FAIL] Booking NOT FOUND in Firestore with Token:`, { bookingToken }, 'warn');
    return { ...initialFormState, message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber -1, updatedGuestData: null };
  }
  logSafe(`${actionContext} Booking found. ID: ${bookingDoc.id}, Status: ${bookingDoc.status}. Current guestData`, bookingDoc.guestSubmittedData);

  let currentGuestDataSnapshot: GuestSubmittedData = bookingDoc.guestSubmittedData ? JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData)) : { lastCompletedStep: -1 };
  
  let updatedGuestData: GuestSubmittedData = {
    ...currentGuestDataSnapshot,
    ...(additionalDataToMerge || {}),
    ...dataFromForm
  };

  // Handle Mitreisende data if provided (for Step 2)
  if (mitreisendeDaten) {
    updatedGuestData.mitreisende = mitreisendeDaten as Mitreisender[]; // Assuming conversion happens before
    logSafe(`${actionContext} Merged Mitreisende data (metadata)`, updatedGuestData.mitreisende);
  }

  // --- File handling logic for Firebase Storage ---
  const fileUploadPromises: Promise<void>[] = [];

  const processFile = async (file: File | undefined | null, fieldUrlKey: keyof GuestSubmittedData, companionIndex?: number, companionFileFieldKey?: keyof Mitreisender) => {
    if (file instanceof File && file.size > 0) {
      const fileProcessingStartTime = Date.now();
      const originalFileName = file.name;
      const fileExtension = originalFileName.split('.').pop();
      const safeFileName = originalFileName.substring(0, originalFileName.length - (fileExtension ? fileExtension.length + 1 : 0)).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const timestamp = Date.now();
      const uniqueFileName = `${timestamp}_${safeFileName}${fileExtension ? '.' + fileExtension : ''}`;
      
      let filePathPrefix = `bookings/${bookingToken}`;
      if (typeof companionIndex === 'number' && companionFileFieldKey) {
          filePathPrefix += `/mitreisende/${companionIndex}/${companionFileFieldKey}`;
      } else {
          filePathPrefix += `/${String(fieldUrlKey).replace('Url', 'File')}`; // e.g. /hauptgastAusweisVorderseiteFile
      }
      const filePath = `${filePathPrefix}/${uniqueFileName}`;
      
      logSafe(`${actionContext} Processing NEW file for ${companionFileFieldKey || fieldUrlKey}: ${originalFileName} (${file.size} bytes) to path ${filePath}`, {});
      
      const oldFileUrl = companionIndex !== undefined && companionFileFieldKey && updatedGuestData.mitreisende && updatedGuestData.mitreisende[companionIndex]
        ? (updatedGuestData.mitreisende[companionIndex] as any)[companionFileFieldKey]
        : (currentGuestDataSnapshot as any)[fieldUrlKey];

      if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.includes("firebasestorage.googleapis.com")) {
        try {
          const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
          await deleteObject(oldFileStorageRef);
          logSafe(`${actionContext} Old file ${oldFileUrl} deleted successfully.`, {});
        } catch (deleteError: any) {
          logSafe(`${actionContext} Failed to delete old file ${oldFileUrl} for ${fieldUrlKey}: ${deleteError.message} (Code: ${deleteError.code}). Continuing.`, {}, 'warn');
        }
      }
      
      try {
        const fileStorageRef = storageRefFB(storage, filePath);
        const fileBuffer = await file.arrayBuffer();
        logSafe(`${actionContext} File buffer created for ${originalFileName}. Uploading... Duration: ${Date.now() - fileProcessingStartTime}ms. Size: ${fileBuffer.byteLength}`, {});
        const uploadStartTime = Date.now();
        await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
        logSafe(`${actionContext} Successfully uploaded ${originalFileName} to Firebase Storage. Duration: ${Date.now() - uploadStartTime}ms. Getting download URL...`, {});
        const urlStartTime = Date.now();
        const downloadURL = await getDownloadURL(fileStorageRef);
        logSafe(`${actionContext} Got download URL for ${originalFileName} in ${Date.now() - urlStartTime}ms. URL: ${downloadURL}`, {});

        if (typeof companionIndex === 'number' && companionFileFieldKey && updatedGuestData.mitreisende && updatedGuestData.mitreisende[companionIndex]) {
            (updatedGuestData.mitreisende[companionIndex] as any)[companionFileFieldKey] = downloadURL;
        } else {
            (updatedGuestData as any)[fieldUrlKey] = downloadURL;
        }

      } catch (fileUploadError: any) {
        let userMessage = `Dateiupload für ${originalFileName} fehlgeschlagen.`;
        let errorCode = fileUploadError.code || "upload-error";
         switch (errorCode) {
            case 'storage/unauthorized': userMessage = `Berechtigungsfehler: ${originalFileName}. (Code: ${errorCode})`; break;
            case 'storage/canceled': userMessage = `Upload abgebrochen: ${originalFileName}. (Code: ${errorCode})`; break;
            case 'storage/no-default-bucket': userMessage = `Firebase Storage Bucket nicht gefunden. Bitte Konfiguration prüfen. (Code: ${errorCode})`; break;
            default: userMessage += ` (Details: ${fileUploadError.message}, Code: ${errorCode})`;
        }
        logSafe(`${actionContext} FILE UPLOAD FAIL] Firebase Storage error for ${originalFileName}: ${userMessage}`, { error: fileUploadError, stack: (fileUploadError as Error).stack?.substring(0,500) }, 'error');
        // Re-throw to be caught by the main try-catch of updateBookingStep
        throw new Error(userMessage); 
      }
    } else if (oldFileUrl) {
        if (typeof companionIndex === 'number' && companionFileFieldKey && updatedGuestData.mitreisende && updatedGuestData.mitreisende[companionIndex]) {
             (updatedGuestData.mitreisende[companionIndex] as any)[companionFileFieldKey] = oldFileUrl;
        } else {
            (updatedGuestData as any)[fieldUrlKey] = oldFileUrl;
        }
      logSafe(`${actionContext} No new file for ${companionFileFieldKey || fieldUrlKey}, kept old URL: ${oldFileUrl}`, {});
    }
  };

  try {
    // Process Hauptgast files (Step 1)
    if (stepNumber === 1) {
        const vorderseiteFile = rawFormData['hauptgastAusweisVorderseiteFile'] as File | undefined | null;
        const rueckseiteFile = rawFormData['hauptgastAusweisRückseiteFile'] as File | undefined | null;
        fileUploadPromises.push(processFile(vorderseiteFile, 'hauptgastAusweisVorderseiteUrl'));
        fileUploadPromises.push(processFile(rueckseiteFile, 'hauptgastAusweisRückseiteUrl'));
    }

    // Process Mitreisende files (Step 2)
    if (stepNumber === 2 && mitreisendeFiles && updatedGuestData.mitreisende) {
        for (let i = 0; i < updatedGuestData.mitreisende.length; i++) {
            const vorderseiteKey = `mitreisende_${i}_ausweisVorderseiteFile`;
            const rueckseiteKey = `mitreisende_${i}_ausweisRückseiteFile`;
            
            const vorderseiteFile = mitreisendeFiles[vorderseiteKey]?.file as File | undefined | null;
            const rueckseiteFile = mitreisendeFiles[rueckseiteKey]?.file as File | undefined | null;

            if (vorderseiteFile) fileUploadPromises.push(processFile(vorderseiteFile, 'hauptgastAusweisVorderseiteUrl', i, 'hauptgastAusweisVorderseiteUrl'));
            if (rueckseiteFile) fileUploadPromises.push(processFile(rueckseiteFile, 'hauptgastAusweisRückseiteUrl', i, 'hauptgastAusweisRückseiteUrl'));
        }
    }

    // Process Zahlungsbeleg file (Step 4 - Zahlungsinformationen)
    if (stepNumber === 4) { // Assuming Zahlungsinformationen is step 4
        const belegFile = rawFormData['zahlungsbelegFile'] as File | undefined | null;
        fileUploadPromises.push(processFile(belegFile, 'zahlungsbelegUrl'));
    }

    await Promise.all(fileUploadPromises);
    logSafe(`${actionContext} All file uploads processed successfully.`, {});

  } catch (error: any) { // Catch errors from processFile
    logSafe(`${actionContext} Error during file processing stage:`, { error: error.message }, 'error');
    return { ...initialFormState, message: error.message, errors: { global: [error.message] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1 };
  }
  
  // Remove File objects from dataFromForm and updatedGuestData after processing
  ['hauptgastAusweisVorderseiteFile', 'hauptgastAusweisRückseiteFile', 'zahlungsbelegFile'].forEach(key => {
    delete (dataFromForm as any)[key];
    delete (updatedGuestData as any)[key];
  });
  if (updatedGuestData.mitreisende) {
    updatedGuestData.mitreisende = updatedGuestData.mitreisende.map(m => {
        const newM = {...m};
        delete (newM as any).file_vorderseite; // remove temporary file holders if any
        delete (newM as any).file_rueckseite;
        return newM;
    });
  }


  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1);
  logSafe(`${actionContext} Final merged guest data before save (file objects removed, URLs set)`, updatedGuestData);

  const bookingUpdatesFirestore: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
  };

  if (stepNumber === 1 && dataFromForm.gastVorname && dataFromForm.gastNachname) {
     if (bookingDoc.guestFirstName !== dataFromForm.gastVorname || bookingDoc.guestLastName !== dataFromForm.gastNachname) {
        bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname;
        bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname;
        logSafe(`${actionContext} Updated top-level guest name.`, {});
    }
  }

  if (stepNumber === 5) { // Final step: Übersicht & Bestätigung (assuming 5 steps now)
    if (updatedGuestData.agbAkzeptiert === true && updatedGuestData.datenschutzAkzeptiert === true) {
      updatedGuestData.submittedAt = new Date().toISOString();
      bookingUpdatesFirestore.status = "Confirmed";
      logSafe(`${actionContext} Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed".`, {});
    } else {
      logSafe(`${actionContext} Final step, but AGB/Datenschutz NICHT akzeptiert. Status bleibt: ${bookingDoc.status}.`, {}, 'warn');
       return {
          ...initialFormState, message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
          errors: {
              agbAkzeptiert: !updatedGuestData.agbAkzeptiert ? ["AGB müssen akzeptiert werden."] : undefined,
              datenschutzAkzeptiert: !updatedGuestData.datenschutzAkzeptiert ? ["Datenschutz muss akzeptiert werden."] : undefined,
           },
          success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
        };
    }
  }

  const dbUpdateStartTime = Date.now();
  const updateSuccess = await updateBookingInFirestore(bookingDoc.id, bookingUpdatesFirestore);
  logSafe(`${actionContext} Firestore updateDoc duration: ${Date.now() - dbUpdateStartTime}ms. Success: ${updateSuccess}`, {});

  if (updateSuccess) {
    logSafe(`${actionContext} SUCCESS] Data submitted successfully to Firestore. Booking status: ${bookingUpdatesFirestore.status || bookingDoc.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}. Total time: ${Date.now() - startTime}ms.`, {});
    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "layout");
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return { ...initialFormState, message, errors: null, success: true, actionToken: serverActionToken, updatedGuestData: updatedGuestData, currentStep: stepNumber -1 };
  } else {
    logSafe(`${actionContext} FAIL] Failed to update booking in Firestore.`, {}, 'error');
    return {
      ...initialFormState, message: "Fehler beim Speichern der Daten in Firestore. Buchung konnte nicht aktualisiert werden.",
      errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
    };
  }
}


export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitGastStammdatenAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys())});
    // Log file details if present
    const vorderseiteFile = formData.get('hauptgastAusweisVorderseiteFile') as File | null;
    const rueckseiteFile = formData.get('hauptgastAusweisRückseiteFile') as File | null;
    if (vorderseiteFile) logSafe(actionContext, { vorderseiteFileName: vorderseiteFile.name, vorderseiteFileSize: vorderseiteFile.size });
    if (rueckseiteFile) logSafe(actionContext, { rueckseiteFileName: rueckseiteFile.name, rueckseiteFileSize: rueckseiteFile.size });

    const result = await updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: "Serverfehler bei Stammdaten-Verarbeitung (Code SA-STAMM-CATCH).", errors: { global: ["Serverfehler bei Stammdaten-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 0 };
  }
}

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });

  try {
    const mitreisendeMetaJson = formData.get('mitreisendeMeta') as string;
    if (!mitreisendeMetaJson) {
      logSafe(actionContext + " No mitreisendeMeta found, treating as empty list submission.", {}, 'warn');
      // Proceed as if an empty list of companions was submitted, effectively just updating the step
      const result = await updateBookingStep(bookingToken, 2, z.object({}), formData, { mitreisende: [] });
      logSafe(actionContext + " END (no mitreisendeMeta)", { success: result.success, message: result.message });
      return result;
    }

    const mitreisendeMeta: { id: string; vorname: string; nachname: string; }[] = JSON.parse(mitreisendeMetaJson);
    
    // Validate metadata for each companion
    const validatedMetas: Mitreisender[] = [];
    const errors: Record<string, string[]> = {};

    for (let i = 0; i < mitreisendeMeta.length; i++) {
        const meta = mitreisendeMeta[i];
        const validationResult = mitreisenderEinzelschema.safeParse(meta);
        if (validationResult.success) {
            validatedMetas.push({ id: meta.id, ...validationResult.data });
        } else {
            validationResult.error.flatten().fieldErrors;
            Object.entries(validationResult.error.flatten().fieldErrors).forEach(([key, msgs]) => {
                errors[`mitreisende_${i}_${key}`] = msgs as string[];
            });
        }
    }

    if (Object.keys(errors).length > 0) {
        logSafe(actionContext + " Validation FAILED for Mitreisende metadata", { errors }, 'warn');
        return { ...initialFormState, errors, message: "Validierungsfehler bei Mitreisenden.", success: false, actionToken: serverActionToken, currentStep: 1 };
    }

    // Prepare files for updateBookingStep
    const mitreisendeFilesForUpdate: Record<string, Record<string, File | null>> = {};
     mitreisendeMeta.forEach((meta, index) => {
        const vorderseiteFile = formData.get(`mitreisende_${index}_ausweisVorderseiteFile`) as File | null;
        const rueckseiteFile = formData.get(`mitreisende_${index}_ausweisRückseiteFile`) as File | null;
        
        if (vorderseiteFile || rueckseiteFile) {
           mitreisendeFilesForUpdate[`mitreisende_${index}`] = {
                ausweisVorderseiteFile: vorderseiteFile,
                ausweisRückseiteFile: rueckseiteFile,
           };
        }
        if (vorderseiteFile) logSafe(actionContext, { [`mitreisende_${index}_vorderseiteName`]: vorderseiteFile.name, [`mitreisende_${index}_vorderseiteSize`]: vorderseiteFile.size });
        if (rueckseiteFile) logSafe(actionContext, { [`mitreisende_${index}_rueckseiteName`]: rueckseiteFile.name, [`mitreisende_${index}_rueckseiteSize`]: rueckseiteFile.size });
    });
    

    // Using a minimal schema for formData itself as files are handled inside updateBookingStep
    const result = await updateBookingStep(bookingToken, 2, z.object({}), formData, {}, validatedMetas, mitreisendeFilesForUpdate);
    logSafe(actionContext + " END", { success: result.success, message: result.message });
    return result;

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: "Serverfehler bei Mitreisenden-Verarbeitung (Code SA-MITR-CATCH).", errors: { global: ["Serverfehler bei Mitreisenden-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 1 };
  }
}


export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitPaymentAmountSelectionAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const result = await updateBookingStep(bookingToken, 3, paymentAmountSelectionSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: "Serverfehler bei Auswahl Zahlungssumme (Code SA-PAYSEL-CATCH).", errors: { global: ["Serverfehler bei Auswahl Zahlungssumme."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 2 };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const zahlungsbelegFile = formData.get('zahlungsbelegFile') as File | null;
    if (zahlungsbelegFile) logSafe(actionContext, { zahlungsbelegFileName: zahlungsbelegFile.name, zahlungsbelegFileSize: zahlungsbelegFile.size });
    
    const result = await updateBookingStep(bookingToken, 4, zahlungsinformationenSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: "Serverfehler bei Zahlungsinformationen-Verarbeitung (Code SA-ZAHLUNG-CATCH).", errors: { global: ["Serverfehler bei Zahlungsinformationen-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 3 };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const result = await updateBookingStep(bookingToken, 5, uebersichtBestaetigungSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: "Serverfehler beim Abschluss der Buchung (Code SA-FINAL-CATCH).", errors: { global: ["Serverfehler bei Abschluss der Buchung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 4 };
  }
}


const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number().int().min(0, "Anzahl Erwachsene muss eine nicht-negative Zahl sein.").default(1),
  kinder: z.coerce.number().int().min(0, "Anzahl Kinder muss eine nicht-negative Zahl sein.").optional().default(0),
  kleinkinder: z.coerce.number().int().min(0, "Anzahl Kleinkinder muss eine nicht-negative Zahl sein.").optional().default(0),
  alterKinder: z.string().optional().default(''),
});

const createBookingServerSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Anreisedatum."}),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Abreisedatum."}),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  interneBemerkungen: z.string().optional(),
  roomsData: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      const roomsArraySchema = z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden.");
      const validationResult = roomsArraySchema.safeParse(parsed);
      if (!validationResult.success) {
        validationResult.error.issues.forEach(issue => {
            const path = ['roomsData', ...(issue.path.map(p => typeof p === 'number' ? `Zimmer ${p+1}`: p))];
            ctx.addIssue({...issue, path })
        });
        return z.NEVER;
      }
      return validationResult.data;
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ungültiges JSON-Format für Zimmerdaten.",
        path: ["roomsData"],
      });
      return z.NEVER;
    }
  }),
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
  const actionContext = `createBookingAction - ActionToken: ${serverActionToken}`;
  logSafe(actionContext + " BEGIN", { hasPrevState: !!prevState });
  const startTime = Date.now();

  try {
    if (!firebaseInitializedCorrectly || !db) {
        const errorMsg = `Serverfehler: Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL). DB: ${!!db}, InitializedCorrectly: ${firebaseInitializedCorrectly}. Error during init: ${firebaseInitializationError || "N/A"}`;
        logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
        return { ...initialFormState, message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(actionContext + " Raw FormData", rawFormData);
    const validatedFields = createBookingServerSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      logSafe(actionContext + " Validation FAILED", { errors: fieldErrors }, 'warn');
        const errorsOutput: Record<string, string[]> = {};
        for (const key in fieldErrors) {
            const newKey = key.startsWith('roomsData.Zimmer') ? 'roomsData' : key;
            if (!errorsOutput[newKey]) errorsOutput[newKey] = [];
            (errorsOutput[newKey] as string[]).push(...(fieldErrors[key as keyof typeof fieldErrors] || []));
        }
      return { ...initialFormState, errors: errorsOutput, message: "Fehler bei der Validierung.", success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Validation successful. Parsed BookingData", bookingData);

    const newBookingToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2,10);

    const firstRoom = bookingData.roomsData[0];
    let personenSummary = `${firstRoom.erwachsene} Erw.`;
    if (firstRoom.kinder && firstRoom.kinder > 0) personenSummary += `, ${firstRoom.kinder} Ki.`;
    if (firstRoom.kleinkinder && firstRoom.kleinkinder > 0) personenSummary += `, ${firstRoom.kleinkinder} Kk.`;
    const roomIdentifierString = `${firstRoom.zimmertyp || 'Zimmer'} (${personenSummary})`;


    const newBookingPayload: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> = {
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: bookingData.verpflegung,
      zimmertyp: firstRoom.zimmertyp,
      erwachsene: firstRoom.erwachsene,
      kinder: firstRoom.kinder,
      kleinkinder: firstRoom.kleinkinder,
      alterKinder: firstRoom.alterKinder,
      rooms: bookingData.roomsData,
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 } // Initial empty guest data
    };

    const createdBookingId = await addBookingToFirestore(newBookingPayload);

    if (!createdBookingId) {
      const errorMsg = "Datenbankfehler: Buchung konnte nicht erstellt werden.";
      logSafe(`${actionContext} FAIL]`, { error: errorMsg, details: "addBookingToFirestore returned null or no ID." }, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    logSafe(`${actionContext} SUCCESS] New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBookingId}. Total time: ${Date.now() - startTime}ms.`, {});

    revalidatePath("/admin/dashboard", "layout");
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
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR]:`, { message: e.message, stack: e.stack?.substring(0,800) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler beim Erstellen der Buchung (Code SA-CREATE-CATCH): ${e.message}`, errors: { global: ["Serverfehler beim Erstellen der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction - IDs: ${bookingIds.join(', ') || 'N/A'} - ActionToken: ${serverActionToken}`;
  logSafe(actionContext + " BEGIN", { bookingIdsCount: bookingIds.length });
  const startTime = Date.now();

  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
        const errorMsg = `Serverfehler: Firebase ist nicht korrekt initialisiert (Code DBA-FIREBASE-INIT-FAIL). DB: ${!!db}, Storage: ${!!storage}, InitializedCorrectly: ${firebaseInitializedCorrectly}. Error during init: ${firebaseInitializationError || "N/A"}`;
        logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
        return { success: false, message: errorMsg, actionToken: serverActionToken };
    }
    if (!bookingIds || bookingIds.length === 0) {
      logSafe(`${actionContext} WARN] No booking IDs provided for deletion.`, {}, 'warn');
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const deleteSuccess = await deleteBookingsFromFirestoreByIds(bookingIds); // This now also handles Storage file deletions

    if (deleteSuccess) {
      logSafe(`${actionContext} SUCCESS] ${bookingIds.length} booking(s) and associated files handled. Total time: ${Date.now() - startTime}ms.`, {});
      revalidatePath("/admin/dashboard", "layout");
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
      const errorMsg = "Fehler beim Löschen der Buchungen aus Firestore.";
      logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
      return { success: false, message: errorMsg, actionToken: serverActionToken };
    }
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error deleting bookings:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen (Code SA-DELETE-CATCH): ${error.message}`, actionToken: serverActionToken };
  }
}
