
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
} from "./mock-db"; // This file now contains Firestore operations
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number;
  bookingToken?: string | null;
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
      if (!file || file.size === 0) return true; // Allow empty or no file
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => !val || !isNaN(Date.parse(val)), { message: "Ungültiges Geburtsdatum." }),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
  alterHauptgast: z.string().optional()
    .transform(val => val ? parseInt(val, 10) : undefined)
    .refine(val => val === undefined || (typeof val === 'number' && val > 0 && val < 120), { message: "Alter muss eine plausible Zahl sein." }),
  hauptgastAusweisVorderseiteFile: fileSchema,
  hauptgastAusweisRückseiteFile: fileSchema,
});

const mitreisenderEinzelschema = z.object({
  id: z.string(),
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
  // Optional: Ausweis-Uploads für Mitreisende
  // hauptgastAusweisVorderseiteFile: fileSchema, // Name hier ist irreführend, sollte mitreisenderAusweis... sein
  // hauptgastAusweisRückseiteFile: fileSchema,
});

const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(['downpayment', 'full_amount'], { required_error: "Bitte wählen Sie eine Zahlungssumme." }),
});

const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
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
  const logMessage = `[Action ${context}] ${simplifiedData.length > 1500 ? simplifiedData.substring(0, 1500) + '... [LOG TRUNCATED]' : simplifiedData}`;

  if (process.env.NODE_ENV === 'development') {
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
  } else {
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
  mitreisendeMetaDaten?: Mitreisender[] // Für Schritt 2
): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `updateBookingStep - Step ${stepNumber} - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  logSafe(`${actionContext} BEGIN] Timestamp: ${new Date().toISOString()}`, { stepNumber, formDataKeys: Array.from(formData.keys()), hasAdditionalData: !!additionalDataToMerge, hasMitreisendeMeta: !!mitreisendeMetaDaten });
  const startTime = Date.now();

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL). DB: ${!!db}, Storage: ${!!storage}, InitializedCorrectly: ${firebaseInitializedCorrectly}. Init Error: ${firebaseInitializationError || "N/A"}`;
    logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
    return {
      message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] },
      success: false, actionToken: serverActionToken, currentStep: stepNumber - 1, updatedGuestData: null
    };
  }

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
    logSafe(`${actionContext} Raw FormData (File objects not fully logged)`, rawFormData);
  } catch (e: any) {
    logSafe(`${actionContext} CRITICAL] Error converting FormData:`, { error: e.message, stack: e.stack?.substring(0, 300) }, 'error');
    return { ...initialFormState, message: "Serverfehler: Formularverarbeitung fehlgeschlagen.", errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
  }

  const validatedFields = actionSchema.safeParse(rawFormData);
  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    logSafe(`${actionContext} Validation FAILED`, { errors: fieldErrors }, 'warn');
    return { ...initialFormState, errors: fieldErrors, message: "Validierungsfehler. Bitte Eingaben prüfen.", success: false, actionToken: serverActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
  }

  const dataFromForm = validatedFields.data;
  logSafe(`${actionContext} Zod validation successful. DataFromForm`, dataFromForm);

  const bookingDoc = await findBookingByTokenFromFirestore(bookingToken);
  if (!bookingDoc || !bookingDoc.id) {
    logSafe(`${actionContext} FAIL] Booking NOT FOUND in Firestore with Token:`, { bookingToken }, 'warn');
    return { ...initialFormState, message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
  }
  logSafe(`${actionContext} Booking found. ID: ${bookingDoc.id}, Status: ${bookingDoc.status}. Current guestData`, bookingDoc.guestSubmittedData);

  const currentGuestDataSnapshot: GuestSubmittedData = bookingDoc.guestSubmittedData ? JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData)) : { lastCompletedStep: -1 };

  let updatedGuestData: GuestSubmittedData = {
    ...currentGuestDataSnapshot,
    ...(additionalDataToMerge || {}),
    ...dataFromForm // Formulardaten des aktuellen Schritts überschreiben ggf. vorherige/zusätzliche Daten
  };

  if (mitreisendeMetaDaten) {
    updatedGuestData.mitreisende = mitreisendeMetaDaten.map(meta => ({
        ...meta, // Enthält id, vorname, nachname
        // URLs werden unten durch File-Uploads gesetzt, oder bleiben leer/alt, falls keine neuen Dateien
        hauptgastAusweisVorderseiteUrl: currentGuestDataSnapshot.mitreisende?.find(m => m.id === meta.id)?.hauptgastAusweisVorderseiteUrl || undefined,
        hauptgastAusweisRückseiteUrl: currentGuestDataSnapshot.mitreisende?.find(m => m.id === meta.id)?.hauptgastAusweisRückseiteUrl || undefined,
    }));
  }


  // Define which form fields correspond to which file uploads
  const fileFieldsToProcess: { formDataKey: string; guestDataUrlKey: keyof GuestSubmittedData; companionId?: string; companionUrlKey?: keyof Mitreisender }[] = [];

  if (stepNumber === 1) { // Hauptgast & Ausweis
    fileFieldsToProcess.push({ formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl' });
    fileFieldsToProcess.push({ formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl' });
  } else if (stepNumber === 2 && updatedGuestData.mitreisende) { // Mitreisende
    updatedGuestData.mitreisende.forEach((mitreisender) => {
      if (mitreisender.id) { // Sicherstellen, dass Mitreisender eine ID hat
        fileFieldsToProcess.push({ formDataKey: `mitreisende_${mitreisender.id}_ausweisVorderseiteFile`, guestDataUrlKey: 'NA', companionId: mitreisender.id, companionUrlKey: 'hauptgastAusweisVorderseiteUrl' });
        fileFieldsToProcess.push({ formDataKey: `mitreisende_${mitreisender.id}_ausweisRückseiteFile`, guestDataUrlKey: 'NA', companionId: mitreisender.id, companionUrlKey: 'hauptgastAusweisRückseiteUrl' });
      }
    });
  } else if (stepNumber === 3) { // Zahlungsinformationen (Beleg) - Schritt 3 ist jetzt Zahlungswahl, Schritt 4 ist Zahlungsinformationen
    // No files in step 3
  } else if (stepNumber === 4) { // Zahlungsinformationen
    fileFieldsToProcess.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl' });
  }

  logSafe(`${actionContext} Identified file fields to process`, { fileFieldsToProcess });


  try {
    for (const { formDataKey, guestDataUrlKey, companionId, companionUrlKey } of fileFieldsToProcess) {
      const file = rawFormData[formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined = undefined;

      // Determine old file URL
      if (companionId && companionUrlKey && updatedGuestData.mitreisende) {
        const companion = updatedGuestData.mitreisende.find(m => m.id === companionId);
        if (companion) oldFileUrl = (companion as any)[companionUrlKey];
      } else if (guestDataUrlKey !== 'NA') { // 'NA' for companion files not directly on guestData
        oldFileUrl = (currentGuestDataSnapshot as any)[guestDataUrlKey];
      }
      logSafe(`${actionContext} For field ${formDataKey}, oldFileUrl is: ${oldFileUrl}`, {});


      if (file instanceof File && file.size > 0) {
        const fileProcessingStartTime = Date.now();
        const originalFileName = file.name;
        const fileExtension = originalFileName.split('.').pop();
        const safeFileName = originalFileName.substring(0, originalFileName.length - (fileExtension ? fileExtension.length + 1 : 0)).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}_${safeFileName}${fileExtension ? '.' + fileExtension : ''}`;

        let filePathPrefix = `bookings/${bookingToken}`;
        if (companionId && companionUrlKey) {
          filePathPrefix += `/mitreisende/${companionId}/${String(companionUrlKey).replace('Url', 'File')}`;
        } else if (guestDataUrlKey !== 'NA') {
          filePathPrefix += `/${String(guestDataUrlKey).replace('Url', 'File')}`;
        } else {
          filePathPrefix += `/unknown_field_path/${formDataKey}`; // Fallback, sollte nicht passieren
        }
        const filePath = `${filePathPrefix}/${uniqueFileName}`;

        logSafe(`${actionContext} Processing NEW file for ${formDataKey}: ${originalFileName} (${file.size} bytes, type: ${file.type}) to path ${filePath}. Uploading...`, {});

        // Delete old file if exists
        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
          try {
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            logSafe(`${actionContext} Old file ${oldFileUrl} deleted successfully.`, {});
          } catch (deleteError: any) {
            logSafe(`${actionContext} Failed to delete old file ${oldFileUrl} for ${formDataKey}: ${deleteError.message} (Code: ${deleteError.code}). Continuing.`, {}, 'warn');
          }
        }

        try {
          const fileStorageRef = storageRefFB(storage, filePath);
          const fileBuffer = await file.arrayBuffer();
          logSafe(`${actionContext} File buffer created for ${originalFileName} in ${Date.now() - fileProcessingStartTime}ms. Size: ${fileBuffer.byteLength}. Uploading to Storage...`, {});

          const uploadStartTime = Date.now();
          await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
          logSafe(`${actionContext} Uploaded ${originalFileName} to Firebase Storage in ${Date.now() - uploadStartTime}ms. Getting download URL...`, {});

          const urlStartTime = Date.now();
          const downloadURL = await getDownloadURL(fileStorageRef);
          logSafe(`${actionContext} Got download URL for ${originalFileName} in ${Date.now() - urlStartTime}ms. URL: ${downloadURL}`, {});

          if (companionId && companionUrlKey && updatedGuestData.mitreisende) {
            const companionIndex = updatedGuestData.mitreisende.findIndex(m => m.id === companionId);
            if (companionIndex !== -1) {
              (updatedGuestData.mitreisende[companionIndex] as any)[companionUrlKey] = downloadURL;
            }
          } else if (guestDataUrlKey !== 'NA') {
            (updatedGuestData as any)[guestDataUrlKey] = downloadURL;
          }

        } catch (fileUploadError: any) {
          let userMessage = `Dateiupload für ${originalFileName} fehlgeschlagen.`;
          let errorCode = (fileUploadError as any).code || "upload-error";
          switch (errorCode) {
            case 'storage/unauthorized': userMessage = `Berechtigungsfehler: ${originalFileName}. Bitte Storage Regeln prüfen. (Code: ${errorCode})`; break;
            case 'storage/canceled': userMessage = `Upload abgebrochen: ${originalFileName}. (Code: ${errorCode})`; break;
            case 'storage/object-not-found': userMessage = `Fehler beim Löschen der alten Datei (nicht gefunden): ${originalFileName}. (Code: ${errorCode})`; break;
            case 'storage/no-default-bucket': userMessage = `Firebase Storage Bucket nicht gefunden. Bitte Konfiguration prüfen. (Code: ${errorCode})`; break;
            default: userMessage += ` (Details: ${(fileUploadError as Error).message}, Code: ${errorCode})`;
          }
          logSafe(`${actionContext} FILE UPLOAD FAIL] Firebase Storage error for ${originalFileName}: ${userMessage}`, { error: fileUploadError, stack: (fileUploadError as Error).stack?.substring(0, 500) }, 'error');
          // Do not throw here, collect errors and return them in FormState
          return { ...initialFormState, message: userMessage, errors: { [formDataKey]: [userMessage] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber - 1 };
        }
      } else if (oldFileUrl) {
        // No new file, keep the old URL if it exists
        if (companionId && companionUrlKey && updatedGuestData.mitreisende) {
            const companionIndex = updatedGuestData.mitreisende.findIndex(m => m.id === companionId);
            if (companionIndex !== -1 && !(updatedGuestData.mitreisende[companionIndex] as any)[companionUrlKey]) { // Only set if not already set by new file
              (updatedGuestData.mitreisende[companionIndex] as any)[companionUrlKey] = oldFileUrl;
            }
        } else if (guestDataUrlKey !== 'NA' && !(updatedGuestData as any)[guestDataUrlKey]) { // Only set if not already set by new file
            (updatedGuestData as any)[guestDataUrlKey] = oldFileUrl;
        }
        logSafe(`${actionContext} No new file for ${formDataKey}, kept old URL if present: ${oldFileUrl}`, {});
      }
      // Remove File object from dataFromForm and updatedGuestData after processing to avoid Firestore issues
      delete (dataFromForm as any)[formDataKey];
      delete (updatedGuestData as any)[formDataKey];
    }
    logSafe(`${actionContext} All file uploads processed or skipped.`, {});

  } catch (error: any) {
    logSafe(`${actionContext} Error during file processing stage:`, { error: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Dateiverarbeitung: ${error.message}`, errors: { global: [`Serverfehler bei Dateiverarbeitung: ${error.message}`] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber - 1 };
  }

  // Clean up mitreisende data: remove file objects before saving to Firestore
  if (updatedGuestData.mitreisende) {
    updatedGuestData.mitreisende = updatedGuestData.mitreisende.map(m => {
        const newM = {...m};
        // Remove any temporary file-related fields that might have been added for form handling
        // This assumes Zod schema for Mitreisender only includes serializable fields
        Object.keys(newM).forEach(key => {
            if (key.includes('File') || key.includes('fileName_')) { // Example of fields to remove
                delete (newM as any)[key];
            }
        });
        return newM;
    });
  }

  updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot.lastCompletedStep ?? -1, stepNumber - 1);
  logSafe(`${actionContext} Final merged guest data before Firestore save (file objects removed, URLs set)`, updatedGuestData);

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
  
  if (stepNumber === 4) { // Zahlungsinformationen
    updatedGuestData.zahlungsart = 'Überweisung'; // Already set in dataFromForm if schema used correctly, or set it here if needed
    bookingUpdatesFirestore.updatedAt = new Date().toISOString(); // Ensure updatedAt is set
  }


  if (stepNumber === 5) { // Final step: Übersicht & Bestätigung
    if (updatedGuestData.agbAkzeptiert === true && updatedGuestData.datenschutzAkzeptiert === true) {
      updatedGuestData.submittedAt = new Date().toISOString();
      bookingUpdatesFirestore.status = "Confirmed"; // Status auf Confirmed setzen
      bookingUpdatesFirestore.updatedAt = new Date().toISOString();
      logSafe(`${actionContext} Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed".`, {});
    } else {
      logSafe(`${actionContext} Final step, but AGB/Datenschutz NICHT akzeptiert. Status bleibt: ${bookingDoc.status}.`, {}, 'warn');
      return {
        ...initialFormState, message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
        errors: {
          agbAkzeptiert: !updatedGuestData.agbAkzeptiert ? ["AGB müssen akzeptiert werden."] : undefined,
          datenschutzAkzeptiert: !updatedGuestData.datenschutzAkzeptiert ? ["Datenschutz muss akzeptiert werden."] : undefined,
        },
        success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber - 1,
      };
    }
  }

  const dbUpdateStartTime = Date.now();
  let updateSuccess = false;
  try {
    updateSuccess = await updateBookingInFirestore(bookingDoc.id, bookingUpdatesFirestore);
  } catch (dbError: any) {
     logSafe(`${actionContext} Firestore updateDoc FAILED. Duration: ${Date.now() - dbUpdateStartTime}ms.`, { error: dbError.message, stack: dbError.stack?.substring(0,500) }, 'error');
     return {
        ...initialFormState, message: `Fehler beim Speichern der Daten in Firestore: ${dbError.message}`,
        errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber - 1,
      };
  }
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
    logSafe(`${actionContext} FAIL] updateBookingInFirestore returned false.`, {}, 'error');
    return {
      ...initialFormState, message: "Fehler beim Speichern der Daten in Firestore. Buchung konnte nicht aktualisiert werden (Update-Funktion gab false zurück).",
      errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber - 1,
    };
  }
}


export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitGastStammdatenAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const result = await updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Stammdaten-Verarbeitung (Code SA-STAMM-CATCH): ${error.message}`, errors: { global: ["Serverfehler bei Stammdaten-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 0 };
  }
}

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const mitreisendeMetaJson = formData.get('mitreisendeMeta') as string;
    let parsedMitreisendeMeta: Mitreisender[] = [];

    if (mitreisendeMetaJson) {
      try {
        parsedMitreisendeMeta = JSON.parse(mitreisendeMetaJson);
        logSafe(actionContext, { parsedMitreisendeMeta });
      } catch (e) {
        logSafe(actionContext + " Failed to parse mitreisendeMeta JSON", { error: (e as Error).message }, 'error');
        return { ...initialFormState, message: "Fehler beim Verarbeiten der Mitreisenden-Daten.", errors: { global: ["Ungültiges Format für Mitreisende."] }, success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
      }
    }

    const errors: Record<string, string[]> = {};
    const validatedMetas: Mitreisender[] = [];

    for (let i = 0; i < parsedMitreisendeMeta.length; i++) {
      const meta = parsedMitreisendeMeta[i];
      const validationResult = mitreisenderEinzelschema.safeParse(meta);
      if (validationResult.success) {
        validatedMetas.push({ id: meta.id, ...validationResult.data });
      } else {
        Object.entries(validationResult.error.flatten().fieldErrors).forEach(([key, msgs]) => {
          errors[`mitreisende_${meta.id}_${key}`] = msgs as string[];
        });
      }
    }

    if (Object.keys(errors).length > 0) {
      logSafe(actionContext + " Validation FAILED for Mitreisende metadata", { errors }, 'warn');
      return { ...initialFormState, errors, message: "Validierungsfehler bei Mitreisenden.", success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    
    // Hier übergeben wir die validierten Metadaten an updateBookingStep
    const result = await updateBookingStep(bookingToken, 2, z.object({}), formData, {}, validatedMetas);
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Mitreisenden-Verarbeitung (Code SA-MITR-CATCH): ${error.message}`, errors: { global: ["Serverfehler bei Mitreisenden-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 1 };
  }
}


export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitPaymentAmountSelectionAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
   try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const result = await updateBookingStep(bookingToken, 3, paymentAmountSelectionSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Auswahl Zahlungssumme (Code SA-PAYSEL-CATCH): ${error.message}`, errors: { global: ["Serverfehler bei Auswahl Zahlungssumme."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 2 };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    // Der 'zahlungsbetrag' wird nun aus dem Zod-Schema validiert
    const result = await updateBookingStep(bookingToken, 4, zahlungsinformationenSchema, formData, { zahlungsart: 'Überweisung'});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Zahlungsinformationen-Verarbeitung (Code SA-ZAHLUNG-CATCH): ${error.message}`, errors: { global: ["Serverfehler bei Zahlungsinformationen-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 3 };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken, formDataKeys: Array.from(formData.keys()) });
    const result = await updateBookingStep(bookingToken, 5, uebersichtBestaetigungSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: `Serverfehler beim Abschluss der Buchung (Code SA-FINAL-CATCH): ${error.message}`, errors: { global: ["Serverfehler bei Abschluss der Buchung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState?.updatedGuestData || null, currentStep: prevState?.currentStep ?? 4 };
  }
}

const RoomSchema = z.object({
  id: z.string(), // ID for React key, not necessarily for Firestore document ID of room
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
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Anreisedatum." }),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Abreisedatum." }),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  interneBemerkungen: z.string().optional(),
  roomsData: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      const roomsArraySchema = z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden.");
      const validationResult = roomsArraySchema.safeParse(parsed);
      if (!validationResult.success) {
        validationResult.error.issues.forEach(issue => {
          const path = ['roomsData', ...(issue.path.map(p => typeof p === 'number' ? `Zimmer ${p + 1}` : p))];
          ctx.addIssue({ ...issue, path })
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
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { hasPrevState: !!prevState, formDataKeys: Array.from(formData.keys()) });

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
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: bookingData.verpflegung,
      zimmertyp: firstRoom.zimmertyp, // For quick display, full details in rooms array
      erwachsene: firstRoom.erwachsene,
      kinder: firstRoom.kinder,
      kleinkinder: firstRoom.kleinkinder,
      alterKinder: firstRoom.alterKinder,
      rooms: bookingData.roomsData.map(({id, ...rest}) => rest), // Remove client-side id from rooms before saving
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 }
    };

    const createdBooking = await addBookingToFirestore(newBookingPayload);

    if (!createdBooking || !createdBooking.id) {
      const errorMsg = "Datenbankfehler: Buchung konnte nicht erstellt werden.";
      logSafe(`${actionContext} FAIL]`, { error: errorMsg, details: "addBookingToFirestore returned null or no ID." }, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    logSafe(`${actionContext} SUCCESS] New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBooking.id}. Total time: ${Date.now() - startTime}ms.`, {});

    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "page");
    revalidatePath(`/admin/bookings/${createdBooking.id}`, "page");


    return {
      ...initialFormState,
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      success: true,
      actionToken: serverActionToken,
      bookingToken: newBookingToken,
    };
  } catch (e: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR]:`, { message: e.message, stack: e.stack?.substring(0, 800) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler beim Erstellen der Buchung (Code SA-CREATE-CATCH): ${e.message}`, errors: { global: ["Serverfehler beim Erstellen der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction - IDs: ${bookingIds.join(', ') || 'N/A'} - ActionToken: ${serverActionToken}`;
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { bookingIdsCount: bookingIds.length });

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

    // Fetch all bookings to be deleted to get their file URLs
    const bookingsToDeletePromises = bookingIds.map(id => findBookingByIdFromFirestore(id));
    const bookingsToDelete = await Promise.all(bookingsToDeletePromises);

    for (const booking of bookingsToDelete) {
        if (booking?.guestSubmittedData) {
            const guestData = booking.guestSubmittedData;
            const urlsToDelete: (string | undefined)[] = [
                guestData.hauptgastAusweisVorderseiteUrl,
                guestData.hauptgastAusweisRückseiteUrl,
                guestData.zahlungsbelegUrl,
            ];
            if (guestData.mitreisende) {
                guestData.mitreisende.forEach(mitreisender => {
                    urlsToDelete.push(mitreisender.hauptgastAusweisVorderseiteUrl);
                    urlsToDelete.push(mitreisender.hauptgastAusweisRückseiteUrl);
                });
            }

            for (const url of urlsToDelete) {
                if (url && url.startsWith("https://firebasestorage.googleapis.com")) {
                    try {
                        const fileRef = storageRefFB(storage, url);
                        await deleteObject(fileRef);
                        logSafe(actionContext, { message: `File ${url} deleted from Storage for booking ${booking.id}` });
                    } catch (deleteError: any) {
                        // Log error but continue deletion of Firestore doc
                        logSafe(actionContext + ` WARN: Failed to delete file ${url} for booking ${booking.id}`, { error: deleteError.message, code: (deleteError as any).code }, 'warn');
                    }
                }
            }
        }
    }


    const deleteSuccess = await deleteBookingsFromFirestoreByIds(bookingIds);

    if (deleteSuccess) {
      logSafe(`${actionContext} SUCCESS] ${bookingIds.length} booking(s) and associated files handled. Total time: ${Date.now() - startTime}ms.`, {});
      revalidatePath("/admin/dashboard", "layout");
      bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
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

