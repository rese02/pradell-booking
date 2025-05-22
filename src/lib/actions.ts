
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, Mitreisender as MitreisenderData, RoomDetail, FormState as GlobalFormState } from "@/lib/definitions";
import {
  addBookingToFirestore,
  findBookingByTokenFromFirestore,
  findBookingByIdFromFirestore,
  updateBookingInFirestore,
  deleteBookingsFromFirestoreByIds,
  convertTimestampsToISO, // Added this as it's used in updateBookingStep
} from "./mock-db"; 
import { storage, firebaseInitializedCorrectly, firebaseInitializationError, db } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";

// Helper for logging
function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = "[Server Action LogSafe]";
    let simplifiedData;
    const maxLogLength = 3000; 
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
            if (value instanceof File) { return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }; }
            if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack ? value.stack.substring(0,400) + "...[TRUNCATED_STACK]" : "No stack" }; }
            if (key === 'issues' && Array.isArray(value)) {
                 return value.map(issue => ({
                     code: issue.code,
                     message: issue.message,
                     path: Array.isArray(issue.path) ? issue.path.join('.') : 'N/A',
                     received: typeof issue.received === 'string' && issue.received.length > 100 ? issue.received.substring(0, 100) + '...' : issue.received
                 }));
            }
            if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) { return value.substring(0, 150) + "...[TRUNCATED_STRING_LOG]"; }
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 30 && !key.toLowerCase().includes('guestsubmitteddata')) { return "[TRUNCATED_OBJECT_LOG_TOO_MANY_KEYS]"; }
            if ((key.toLowerCase().includes('url') || key.toLowerCase().includes('datauri')) && typeof value === 'string' && value.startsWith('data:image')) { return value.substring(0,100) + "...[TRUNCATED_DATA_URI_LOG]";}
            if (key === 'arrayBuffer' && value instanceof ArrayBuffer) { return `[ArrayBuffer size: ${value.byteLength}]`;}
            return value;
        }, 2);
    } catch (e: any) {
        simplifiedData = `[Log data could not be stringified: ${(e instanceof Error ? e.message : String(e))}]`;
    }

    const logMessage = `${operationName} [${new Date().toISOString()}] ${context} ${simplifiedData.length > maxLogLength ? simplifiedData.substring(0, maxLogLength) + `... [LOG_DATA_TRUNCATED_AT_${maxLogLength}_CHARS]` : simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}


export type FormState = GlobalFormState;

const initialFormState: FormState = { 
  message: null, 
  errors: null, 
  success: false, 
  actionToken: undefined, 
  updatedGuestData: null, 
  bookingToken: null, 
  currentStep: -1 
};

function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File, { message: "Datei-Upload ist erforderlich oder ungültig." }).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE_BYTES, { message: `Maximale Dateigröße ist ${MAX_FILE_SIZE_MB}MB.`})
  .refine(
    (file) => !file || file.size === 0 || ACCEPTED_FILE_TYPES.includes(file.type),
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );


async function updateBookingStep(
  forActionToken: string,
  bookingId: string,
  stepNumber: number, 
  stepName: string,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `[updateBookingStep(BookingID:${bookingId}, Step:${stepNumber + 1}-${stepName}, ActionToken:${forActionToken.substring(0,8)})]`;
  const startTime = Date.now();
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;

  logSafe(actionContext + ` BEGIN - FormData keys: ${Array.from(formData.keys()).join(', ')}`, { additionalDataToMergeKeys: additionalDataToMerge ? Object.keys(additionalDataToMerge) : 'N/A' });
  
  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
      logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
      return {
        message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. Bitte Admin kontaktieren. (Details: ${initErrorMsg}) (Aktions-ID: ${forActionToken}) (Code: UBS-FNI)`,
        errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI-G)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber, updatedGuestData: null
      };
    }

    const bookingDoc = await findBookingByIdFromFirestore(bookingId);
    if (!bookingDoc) {
      logSafe(actionContext + ` FAIL - Booking NOT FOUND with ID:`, { bookingId }, 'error');
      return {
        message: `Buchung mit ID ${bookingId} nicht gefunden. (Code: UBS-BNF-${forActionToken.substring(0,4)})`,
        errors: { global: [`Buchung nicht gefunden. (Aktions-ID: ${forActionToken}) (Code: UBS-BNF-G)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber, updatedGuestData: null
      };
    }
    currentGuestDataSnapshot = bookingDoc.guestSubmittedData ? { ...bookingDoc.guestSubmittedData } : { lastCompletedStep: -1 };
    logSafe(actionContext + ` Current guest data snapshot fetched`, { lastCompletedStep: currentGuestDataSnapshot?.lastCompletedStep, hasMitreisende: !!currentGuestDataSnapshot?.mitreisende });

    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(actionContext + ` Raw form data for Zod validation (keys):`, { keys: Object.keys(rawFormData) });
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const formErrors: Record<string, string[]> = {};
      const zodErrors = validatedFields.error.flatten().fieldErrors;
      for (const key in zodErrors) {
        if (zodErrors[key as keyof typeof zodErrors]) {
          formErrors[key] = zodErrors[key as keyof typeof zodErrors]!;
        }
      }
      logSafe(actionContext + ` Zod Validation FAILED`, { errors: formErrors, zodErrorDetails: validatedFields.error.issues, rawFormDataKeys: Object.keys(rawFormData) }, 'warn');
      return {
        message: "Validierungsfehler. Bitte Eingaben prüfen. (Code: UBS-ZVF)", errors: formErrors,
        success: false, actionToken: forActionToken,
        currentStep: stepNumber,
        updatedGuestData: convertTimestampsToISO(currentGuestDataSnapshot) // Send back previous state
      };
    }
    const dataFromForm = validatedFields.data;
    logSafe(actionContext + ` Zod Validation SUCCESSFUL. Data keys from form:`, { keys: Object.keys(dataFromForm) });

    let updatedGuestData: GuestSubmittedData = { ...(currentGuestDataSnapshot || { lastCompletedStep: -1 }) };
    
    // Merge non-file data from form
    for (const key in dataFromForm) {
      if (!(dataFromForm[key] instanceof File) && key !== 'mitreisendeMeta' && key !== 'mitreisende') {
        (updatedGuestData as any)[key] = dataFromForm[key];
      }
    }
    // Merge additional data (e.g., paymentAmountSelection calculated in the action)
    if (additionalDataToMerge) {
      updatedGuestData = { ...updatedGuestData, ...additionalDataToMerge };
    }
    
    const formErrorsFromProcessing: Record<string, string[]> = {};

    const fileFieldsConfigs: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string; // For Mitreisende files
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
    }> = [];

    // Define file fields based on the current step
    if (stepName === "Hauptgast & Ausweis") {
      fileFieldsConfigs.push(
        { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl' },
        { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl' }
      );
    } else if (stepName === "Mitreisende") {
      try {
        const mitreisendeMetaRaw = formData.get('mitreisendeMeta');
        const mitreisendeMetaParsed = typeof mitreisendeMetaRaw === 'string' && mitreisendeMetaRaw.trim() !== ""
          ? JSON.parse(mitreisendeMetaRaw) : [];
        
        (mitreisendeMetaParsed as Array<{id:string; vorname: string; nachname: string}>).forEach((mitreisenderClient) => {
          if (mitreisenderClient.id) {
            fileFieldsConfigs.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl'});
            fileFieldsConfigs.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl'});
          }
        });
      } catch(e: any) {
        logSafe(actionContext + ` WARN: Failed to parse mitreisendeMeta for file config.`, { error: (e as Error).message, meta: formData.get('mitreisendeMeta') }, 'warn');
        (formErrorsFromProcessing.mitreisendeMeta = formErrorsFromProcessing.mitreisendeMeta || []).push("Fehler beim Verarbeiten der Mitreisenden-Daten für Datei-Uploads.");
      }
    } else if (stepName === "Zahlungsinfo") {
      fileFieldsConfigs.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl' });
    }

    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsConfigs.length });

    for (const config of fileFieldsConfigs) {
        const file = rawFormData[config.formDataKey] as File | undefined | null;
        let oldFileUrl: string | undefined | null = null;
        const originalBookingSnapshotForOldUrl = bookingDoc.guestSubmittedData || { lastCompletedStep: -1 };

        // Determine old file URL
        if (config.mitreisenderId && config.mitreisenderUrlKey && originalBookingSnapshotForOldUrl?.mitreisende) {
            const companion = originalBookingSnapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
        } else if (config.guestDataUrlKey) {
            oldFileUrl = (originalBookingSnapshotForOldUrl as any)?.[config.guestDataUrlKey];
        }
        logSafe(actionContext + ` Processing file field: ${config.formDataKey}. File present: ${!!(file instanceof File && file.size > 0)}. Old URL exists: ${!!oldFileUrl}`);

        if (file instanceof File && file.size > 0) { // New file uploaded
            const originalFileName = file.name;
            if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === "") {
                const errorMsg = `Datei für Feld ${config.formDataKey} hat einen ungültigen oder leeren Namen. (Code: UBS-IFN)`;
                logSafe(actionContext + ` WARN: Skipping file for ${config.formDataKey} due to invalid name.`, { originalFileName }, 'warn');
                (formErrorsFromProcessing[config.formDataKey] = formErrorsFromProcessing[config.formDataKey] || []).push(errorMsg);
                continue;
            }

            let arrayBuffer: ArrayBuffer;
            try {
                const bufferStartTime = Date.now();
                arrayBuffer = await file.arrayBuffer();
                logSafe(actionContext + ` ArrayBuffer for "${originalFileName}" (Size: ${arrayBuffer.byteLength} B) read in ${Date.now() - bufferStartTime}ms`, { field: config.formDataKey});
            } catch (bufferError: any) {
                const errorMsg = `Fehler beim Lesen der Datei "${originalFileName}" für Feld ${config.formDataKey}: ${(bufferError as Error).message} (Code: UBS-FBF)`;
                logSafe(actionContext + ` FILE BUFFER FAIL for "${originalFileName}"`, { field: config.formDataKey, error: (bufferError as Error).message }, 'error');
                (formErrorsFromProcessing[config.formDataKey] = formErrorsFromProcessing[config.formDataKey] || []).push(errorMsg);
                continue;
            }
            
            // Delete old file from Firebase Storage if it exists
            if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
                try {
                    logSafe(actionContext + ` Attempting to delete OLD file from Storage: ${oldFileUrl} for ${config.formDataKey}.`);
                    const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
                    await deleteObject(oldFileStorageRefHandle);
                    logSafe(actionContext + ` OLD file ${oldFileUrl} deleted from Storage for ${config.formDataKey}.`);
                } catch (deleteError: any) {
                    const fbErrorCode = (deleteError as any)?.code;
                    if (fbErrorCode === 'storage/object-not-found') {
                        logSafe(actionContext + ` WARN: Old file for ${config.formDataKey} not found in Storage, skipping deletion. URL: ${oldFileUrl}`, {}, 'warn');
                    } else {
                        logSafe(actionContext + ` WARN: Failed to delete OLD file for ${config.formDataKey} from Storage. URL: ${oldFileUrl}. Code: ${fbErrorCode}`, { error: (deleteError as Error).message, code: fbErrorCode }, 'warn');
                    }
                }
            }

            let downloadURL: string | undefined;
            try {
                const cleanedFileName = originalFileName.replace(/[^a-zA-Z0-9_.\-]/g, '_');
                const uniqueFileName = `${Date.now()}_${cleanedFileName}`;
                let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;
                if(config.mitreisenderId) filePathPrefix += `/mitreisende/${config.mitreisenderId}/${(config.mitreisenderUrlKey || 'file').replace('Url', '')}`;
                else if (config.guestDataUrlKey) filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`;
                else filePathPrefix += `/other_uploads/${config.formDataKey.replace('File', '')}`;
                const filePath = `${filePathPrefix}/${uniqueFileName}`;

                logSafe(actionContext + ` Uploading "${originalFileName}" to Storage path: ${filePath}. Content-Type: ${file.type}`, { field: config.formDataKey});
                const fileStorageRefHandle = storageRefFB(storage, filePath);
                const uploadStartTime = Date.now();
                await uploadBytes(fileStorageRefHandle, arrayBuffer, { contentType: file.type });
                logSafe(actionContext + ` File "${originalFileName}" uploaded in ${Date.now() - uploadStartTime}ms`, { field: config.formDataKey});
                
                const getUrlStartTime = Date.now();
                downloadURL = await getDownloadURL(fileStorageRefHandle);
                logSafe(actionContext + ` Got download URL for "${originalFileName}" in ${Date.now() - getUrlStartTime}ms`, { urlPreview: downloadURL.substring(0,80)+'...', field: config.formDataKey});
            } catch (fileUploadError: any) {
                const fbErrorCode = (fileUploadError as any)?.code;
                let userMessage = `Dateiupload für "${originalFileName}" (${config.formDataKey}) fehlgeschlagen.`;
                if (fbErrorCode === 'storage/unauthorized') userMessage = `Berechtigungsfehler: Upload für "${originalFileName}" verweigert. Firebase Storage Regeln prüfen. (Code: UBS-FSU-${forActionToken.substring(0,4)})`;
                else if (fbErrorCode === 'storage/retry-limit-exceeded') userMessage = `Upload für "${originalFileName}" hat das Zeitlimit überschritten. Bitte erneut versuchen. (Code: UBS-FSR-${forActionToken.substring(0,4)})`;
                else userMessage += ` Details: ${(fileUploadError as Error).message || "Unbekannter Upload-Fehler"}`;
                logSafe(actionContext + ` FIREBASE STORAGE UPLOAD/GET_URL FAIL for "${originalFileName}"`, { field: config.formDataKey, error: (fileUploadError as Error).message, code: fbErrorCode }, 'error');
                (formErrorsFromProcessing[config.formDataKey] = formErrorsFromProcessing[config.formDataKey] || []).push(userMessage);
                continue;
            }

            if (downloadURL) {
                if (config.mitreisenderId && config.mitreisenderUrlKey) {
                    if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                    let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                    if (companion) (companion as any)[config.mitreisenderUrlKey] = downloadURL;
                    else { // If companion doesn't exist in updatedGuestData, create and add
                        const newCompanion: MitreisenderData = { id: config.mitreisenderId, vorname: '', nachname: '' }; // Placeholder names
                        (newCompanion as any)[config.mitreisenderUrlKey] = downloadURL;
                        updatedGuestData.mitreisende.push(newCompanion);
                        logSafe(actionContext + ` INFO: New companion entry created for ID ${config.mitreisenderId} to store file ${config.formDataKey}.`, {}, 'info');
                    }
                } else if (config.guestDataUrlKey) (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
            }
        } else if (!(file instanceof File) || file.size === 0) {
            // No new file uploaded, keep the old URL if it exists
            if (oldFileUrl) {
                 if (config.mitreisenderId && config.mitreisenderUrlKey) {
                    if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                    let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                     if (companion) (companion as any)[config.mitreisenderUrlKey] = oldFileUrl;
                     else {
                        const newCompanion: MitreisenderData = { id: config.mitreisenderId, vorname: '', nachname: '' };
                        (newCompanion as any)[config.mitreisenderUrlKey] = oldFileUrl;
                        updatedGuestData.mitreisende.push(newCompanion);
                     }
                } else if (config.guestDataUrlKey) (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
                 logSafe(actionContext + ` No new file for ${config.formDataKey}, kept old URL: ${oldFileUrl.substring(0,80)}...`);
            } else {
                // No new file and no old file, ensure the field is cleared in updatedGuestData
                if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                    let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                    if (companion) (companion as any)[config.mitreisenderUrlKey] = undefined;
                } else if (config.guestDataUrlKey) (updatedGuestData as any)[config.guestDataUrlKey] = undefined;
                logSafe(actionContext + ` No new file for ${config.formDataKey} and no old URL. Field cleared.`);
            }
        }
    }
    logSafe(actionContext + " File processing END", { fileProcessingErrorsCount: Object.keys(formErrorsFromProcessing).length });

    // Special handling for Mitreisende names if this is the Mitreisende step
    if (stepName === "Mitreisende") {
      try {
        const mitreisendeMetaRaw = formData.get('mitreisendeMeta');
        const clientMitreisende = typeof mitreisendeMetaRaw === 'string' && mitreisendeMetaRaw.trim() !== "" 
            ? JSON.parse(mitreisendeMetaRaw) 
            : [];

        const serverMitreisende: MitreisenderData[] = [];
        
        // Ensure updatedGuestData.mitreisende is an array
        if (!Array.isArray(updatedGuestData.mitreisende)) {
            updatedGuestData.mitreisende = [];
        }

        for (const cm of clientMitreisende as Array<{id:string; vorname: string; nachname: string}>) {
          const existingServerCompanion = updatedGuestData.mitreisende.find(sm => sm.id === cm.id);
          serverMitreisende.push({
            id: String(cm.id || generateActionToken()),
            vorname: String(cm.vorname || ''), 
            nachname: String(cm.nachname || ''),
            ausweisVorderseiteUrl: existingServerCompanion?.ausweisVorderseiteUrl, // Keep URL from file processing
            ausweisRückseiteUrl: existingServerCompanion?.ausweisRückseiteUrl,   // Keep URL from file processing
          });
        }
        // Remove companions from updatedGuestData.mitreisende that are not in clientMitreisende
        // (This handles deletion of companions from UI)
        updatedGuestData.mitreisende = updatedGuestData.mitreisende.filter(sm => 
            clientMitreisende.some((cm: any) => cm.id === sm.id)
        ).map(sm => { // Ensure names are updated from clientMitreisende
            const clientVersion: any = clientMitreisende.find((cm: any) => cm.id === sm.id);
            return {
                ...sm,
                vorname: clientVersion?.vorname || sm.vorname,
                nachname: clientVersion?.nachname || sm.nachname,
            }
        });

        // Add any new companions from clientMitreisende that weren't processed for files (e.g., added but no files uploaded yet)
        for (const cm of clientMitreisende as Array<{id:string; vorname: string; nachname: string}>) {
            if (!updatedGuestData.mitreisende.some(sm => sm.id === cm.id)) {
                updatedGuestData.mitreisende.push({
                    id: String(cm.id),
                    vorname: String(cm.vorname || ''),
                    nachname: String(cm.nachname || ''),
                });
            }
        }

      } catch(e: any) {
        logSafe(actionContext + ` WARN: Failed to process mitreisendeMeta.`, { error: (e as Error).message }, 'warn');
        (formErrorsFromProcessing.mitreisendeMeta = formErrorsFromProcessing.mitreisendeMeta || []).push("Fehler beim Verarbeiten der Mitreisenden-Daten.");
      }
    }


    if (Object.keys(formErrorsFromProcessing).length > 0) {
      logSafe(actionContext + ` Returning due to accumulated form errors.`, { errors: formErrorsFromProcessing });
      return {
        message: "Einige Felder oder Dateien konnten nicht verarbeitet werden. Bitte prüfen. (Code: UBS-FPE)",
        errors: formErrorsFromProcessing, success: false, actionToken: forActionToken,
        currentStep: stepNumber,
        updatedGuestData: convertTimestampsToISO(currentGuestDataSnapshot), // Send back previous state
      };
    }

    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber);

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") {
      const agbAkzeptiert = dataFromForm.agbAkzeptiert === true || dataFromForm.agbAkzeptiert === "on";
      const datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true || dataFromForm.datenschutzAkzeptiert === "on";
      
      updatedGuestData.agbAkzeptiert = agbAkzeptiert;
      updatedGuestData.datenschutzAkzeptiert = datenschutzAkzeptiert;

      if (agbAkzeptiert && datenschutzAkzeptiert) {
        updatedGuestData.submittedAt = Timestamp.now(); // Use Firestore Timestamp
        bookingStatusUpdate.status = "Confirmed";
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(!agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert. (Code: UBS-CE)", errors: consentErrors,
          success: false, actionToken: forActionToken, currentStep: stepNumber,
          updatedGuestData: convertTimestampsToISO(updatedGuestData), // Send current (but unsubmitted) state
        };
      }
    }
    
    const bookingUpdatesFirestore: Partial<Booking> = {
      guestSubmittedData: updatedGuestData,
      ...(bookingStatusUpdate.status && { status: bookingStatusUpdate.status })
    };
    
    if (stepName === "Hauptgast & Ausweis" && dataFromForm.gastVorname && dataFromForm.gastNachname && bookingDoc) {
      const currentFirstName = bookingDoc.guestFirstName || '';
      const currentLastName = bookingDoc.guestLastName || '';
      const newFirstName = String(dataFromForm.gastVorname || '');
      const newLastName = String(dataFromForm.gastNachname || '');
      if(currentFirstName !== newFirstName || currentLastName !== newLastName) {
        bookingUpdatesFirestore.guestFirstName = newFirstName;
        bookingUpdatesFirestore.guestLastName = newLastName;
      }
    }
    
    logSafe(actionContext + ` Attempting to update booking in Firestore. Path: ${bookingDoc.id!}.`, { updateKeys: Object.keys(bookingUpdatesFirestore) });
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    
    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${bookingDoc.id!}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber + 1} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    
    logSafe(actionContext + ` SUCCESS - Step ${stepNumber + 1} processed.`, { finalMessage: message });
    return {
      message, errors: null, success: true, actionToken: forActionToken,
      updatedGuestData: convertTimestampsToISO(updatedGuestData), // Send the fully updated data
      currentStep: stepNumber
    };

  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch`, { error: (error as Error).message, stack: (error as Error).stack?.substring(0,500) }, 'error');
    return {
      message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${(error as Error).message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-GUEH)`,
      errors: { global: [`Serverfehler (Schritt ${stepName}): ${(error as Error).message}. Bitte Admin kontaktieren. (Code: UBS-GUEH-G)`] },
      success: false, actionToken: forActionToken,
      currentStep: stepNumber,
      updatedGuestData: currentGuestDataSnapshot ? convertTimestampsToISO(currentGuestDataSnapshot) : null,
    };
  } finally {
     logSafe(actionContext + ` END. Total time: ${Date.now() - startTime}ms.`);
  }
}

// --- Step 1: Gast-Stammdaten & Ausweis ---
const gastStammdatenSchema = z.object({
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  email: z.string().email("Ungültige E-Mail-Adresse.").min(1, "E-Mail ist erforderlich."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
  alterHauptgast: z.string().optional().nullable()
    .transform(val => val && val.trim() !== "" ? parseInt(val, 10) : undefined)
    .refine(val => val === undefined || (typeof val === 'number' && !isNaN(val) && val > 0 && val < 120), { message: "Alter muss eine plausible Zahl sein." }),
  hauptgastAusweisVorderseiteFile: fileSchema,
  hauptgastAusweisRückseiteFile: fileSchema,
  anmerkungenGast: z.string().optional(), // For guest's own notes
});

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitGastStammdatenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SGA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
       logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
       return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SGA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 0, "Hauptgast & Ausweis", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { error: (error as Error).message, stack: (error as Error).stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${(error as Error).message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-GUEH)`, errors: { global: [`Serverfehler (Stammdaten): ${(error as Error).message} (Code: SGA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 2: Mitreisende ---
const mitreisenderClientSchema = z.object({ // Schema for each item in mitreisendeMeta
  id: z.string(), 
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
});

const mitreisendeStepSchema = z.object({
  mitreisendeMeta: z.preprocess( // Preprocess mitreisendeMeta string to JSON
    (val) => {
      if (typeof val === 'string' && val.trim() !== "") {
        try { return JSON.parse(val); } catch (e) { 
            logSafe("[mitreisendeStepSchema] Failed to parse mitreisendeMeta JSON", {value: val, error: (e as Error).message}, "warn");
            return []; 
        }
      }
      return []; 
    },
    z.array(mitreisenderClientSchema).optional().default([]) // Validate as array of mitreisenderClientSchema
  ),
}).catchall(fileSchema); // Allow other keys for file uploads (e.g., mitreisende_XYZ_ausweisVorderseiteFile)

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
   if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SMA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
   try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SMA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 1, "Mitreisende", mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { error: (error as Error).message, stack: (error as Error).stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${(error as Error).message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SMA-GUEH)`, errors: { global: [`Serverfehler (Mitreisende): ${(error as Error).message} (Code: SMA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 3: Zahlungssumme wählen ---
const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(["downpayment", "full_amount"], { required_error: "Auswahl der Zahlungssumme ist erforderlich." }),
});
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
   if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SPASA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SPASA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    
    const validatedFields = paymentAmountSelectionSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!validatedFields.success) {
        logSafe(actionContext + ` Zod Validation FAILED`, { errors: validatedFields.error.flatten().fieldErrors }, 'warn');
        return { message: "Validierungsfehler bei Zahlungssummenauswahl.", errors: validatedFields.error.flatten().fieldErrors, success: false, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    const selectedAmount = validatedFields.data.paymentAmountSelection;
    let zahlungsbetrag = booking.price || 0;
    if (selectedAmount === 'downpayment') {
      zahlungsbetrag = parseFloat(((booking.price || 0) * 0.3).toFixed(2));
    }
    // We pass 'zahlungsbetrag' to additionalDataToMerge. 'updateBookingStep' will merge it.
    // 'paymentAmountSelection' is already in dataFromForm from validatedFields.data.
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag } as Partial<GuestSubmittedData>;
    return await updateBookingStep(serverActionToken, booking.id, 2, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { error: (error as Error).message, stack: (error as Error).stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${(error as Error).message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-GUEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${(error as Error).message} (Code: SPASA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 4: Zahlungsinformationen (Banküberweisung) ---
const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});
export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SZIA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SZIA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
    }
    // zahlungsdatum is added in additionalDataToMerge
    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now() });
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { error: (error as Error).message, stack: (error as Error).stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${(error as Error).message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-GUEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${(error as Error).message} (Code: SZIA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 5: Übersicht & Bestätigung ---
const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});
export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SEBA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SEBA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 4, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { error: (error as Error).message, stack: (error as Error).stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${(error as Error).message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-GUEH)`, errors: { global: [`Serverfehler (Bestätigung): ${(error as Error).message} (Code: SEBA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Create Booking Dialog (Admin) ---
const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich.").default('Standard'),
  erwachsene: z.coerce.number({invalid_type_error: "Anzahl Erwachsene muss eine Zahl sein."}).int().min(0, "Anzahl Erwachsene darf nicht negativ sein.").default(1),
  kinder: z.coerce.number({invalid_type_error: "Anzahl Kinder muss eine Zahl sein."}).int().min(0, "Anzahl Kinder darf nicht negativ sein.").optional().default(0),
  kleinkinder: z.coerce.number({invalid_type_error: "Anzahl Kleinkinder muss eine Zahl sein."}).int().min(0, "Anzahl Kleinkinder darf nicht negativ sein.").optional().default(0),
  alterKinder: z.string().optional(), // No .default('') here to distinguish between not provided and empty
});

const createBookingServerSchema = z.object({
  guestFirstName: z.string({required_error: "Vorname ist ein Pflichtfeld."}).min(1, "Vorname ist erforderlich."),
  guestLastName: z.string({required_error: "Nachname ist ein Pflichtfeld."}).min(1, "Nachname ist erforderlich."),
  price: z.coerce.number({invalid_type_error: "Preis muss eine Zahl sein.", required_error: "Preis ist ein Pflichtfeld."}).positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string({required_error: "Anreisedatum ist ein Pflichtfeld."})
    .min(1, "Anreisedatum ist erforderlich.")
    .refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Anreisedatum." }),
  checkOutDate: z.string({required_error: "Abreisedatum ist ein Pflichtfeld."})
    .min(1, "Abreisedatum ist erforderlich.")
    .refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Abreisedatum." }),
  verpflegung: z.string({required_error: "Verpflegung ist ein Pflichtfeld."}).min(1, "Verpflegung ist erforderlich.").default('ohne'),
  interneBemerkungen: z.string().optional(), // No .default('') here
  roomsData: z.string() 
    .pipe(
      z.string().transform((str, ctx) => {
        try {
          const parsed = JSON.parse(str);
          return parsed;
        } catch (e: any) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Die Zimmerdaten sind nicht im korrekten JSON-Format: ${(e as Error).message} (Code: CBA-RD-JSON)` });
          return z.NEVER;
        }
      }).pipe(
        z.array(RoomSchema, {
           errorMap: (issue, ctx) => {
                let baseMessage = issue.message || ctx.defaultError;
                let pathMessage = "";
                if (issue.path.length > 0) {
                    pathMessage = ` (Zimmer ${Number(issue.path[0]) + 1}${issue.path.length > 1 ? `, Feld '${issue.path[1]}'` : ''})`;
                }
                 if (issue.code === z.ZodIssueCode.too_small && issue.path.length === 0 && issue.minimum === 1) {
                    baseMessage = "Mindestens ein Zimmer muss hinzugefügt werden.";
                }
                return { message: `${baseMessage}${pathMessage}` };
            }
        }).min(1, "Mindestens ein Zimmer muss hinzugefügt werden. (Code: CBA-RD-MIN1)")
      )
    ),
}).refine(data => {
  if (data.checkInDate && data.checkOutDate) {
    try { return new Date(data.checkOutDate) > new Date(data.checkInDate); } catch (e) { return false; }
  }
  return true;
}, {
  message: "Abreisedatum muss nach dem Anreisedatum liegen.",
  path: ["dateRange"], 
});

export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[createBookingAction(Action:${serverActionToken.substring(0,8)})]`;
  const startTime = Date.now();

  logSafe(actionContext + " BEGIN - FormData keys:", Array.from(formData.keys()));

  if (!firebaseInitializedCorrectly || !db) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return {
        success: false, actionToken: serverActionToken,
        message: `Serverfehler: Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL). Details: ${initErrorMsg}.`,
        errors: { global: [`Firebase Initialisierungsfehler. (Code: CBA-FNI-${serverActionToken.substring(0,4)})`] },
        bookingToken: null, updatedGuestData: null, currentStep: -1
    };
  }
  
  const rawGuestFirstName = formData.get("guestFirstName");
  const rawGuestLastName = formData.get("guestLastName");
  const rawPrice = formData.get("price");
  const rawCheckInDate = formData.get("checkInDate");
  const rawCheckOutDate = formData.get("checkOutDate");
  const rawRoomsData = formData.get("roomsData");
  const rawVerpflegung = formData.get("verpflegung");
  const rawInterneBemerkungen = formData.get("interneBemerkungen");

  logSafe(actionContext + " Raw values from formData:", {
      rawGuestFirstName: String(rawGuestFirstName), rawGuestLastName: String(rawGuestLastName),
      rawPrice: String(rawPrice), rawCheckInDate: String(rawCheckInDate), rawCheckOutDate: String(rawCheckOutDate),
      rawRoomsDataIsString: typeof rawRoomsData === 'string', rawRoomsDataLength: typeof rawRoomsData === 'string' ? rawRoomsData.length : 'N/A',
      rawVerpflegung: String(rawVerpflegung), rawInterneBemerkungenIsString: typeof rawInterneBemerkungen === 'string'
  });

  // Defensive pre-checks for critical fields before Zod
  if (typeof rawCheckInDate !== 'string' || rawCheckInDate.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: checkInDate missing or not a string.", {value: rawCheckInDate});
    return { ...initialFormState, success: false, message: "Anreisedatum ist erforderlich und muss ein String sein. (Code: CBA-PRE-CID)", errors: { checkInDate: ["Anreisedatum ist erforderlich."] }, actionToken: serverActionToken };
  }
  if (typeof rawCheckOutDate !== 'string' || rawCheckOutDate.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: checkOutDate missing or not a string.", {value: rawCheckOutDate});
    return { ...initialFormState, success: false, message: "Abreisedatum ist erforderlich und muss ein String sein. (Code: CBA-PRE-COD)", errors: { checkOutDate: ["Abreisedatum ist erforderlich."] }, actionToken: serverActionToken };
  }
  if (typeof rawRoomsData !== 'string' || rawRoomsData.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: roomsData missing, not a string, or empty.", {value: rawRoomsData});
    return { ...initialFormState, success: false, message: "Zimmerdaten sind erforderlich (als JSON-String). (Code: CBA-PRE-RD-STR)", errors: { roomsData: ["Zimmerdaten sind erforderlich."] }, actionToken: serverActionToken };
  }
  let parsedRoomsForPreCheck;
  try {
    parsedRoomsForPreCheck = JSON.parse(rawRoomsData);
  } catch (e) {
    logSafe(actionContext + " Pre-check FAIL: roomsData is not valid JSON.", {error: (e as Error).message, rawRoomsDataPreview: rawRoomsData.substring(0,100)});
    return { ...initialFormState, success: false, message: `Zimmerdaten sind kein gültiges JSON: ${(e as Error).message}. (Code: CBA-PRE-RD-JSON)`, errors: { roomsData: [`Zimmerdaten sind kein gültiges JSON: ${(e as Error).message}`] }, actionToken: serverActionToken };
  }
  if (!Array.isArray(parsedRoomsForPreCheck)) {
    logSafe(actionContext + " Pre-check FAIL: parsed roomsData is not an array.", {parsedRoomsForPreCheck});
    return { ...initialFormState, success: false, message: "Zimmerdaten müssen ein Array sein. (Code: CBA-PRE-RD-ARR)", errors: { roomsData: ["Zimmerdaten müssen ein Array sein."] }, actionToken: serverActionToken };
  }
  if (parsedRoomsForPreCheck.length === 0) {
    logSafe(actionContext + " Pre-check FAIL: parsed roomsData array is empty.");
    return { ...initialFormState, success: false, message: "Es muss mindestens ein Zimmer angegeben werden. (Code: CBA-PRE-RD-EMPTY)", errors: { roomsData: ["Mindestens ein Zimmer angeben."] }, actionToken: serverActionToken };
  }


  const dataForZod = {
      guestFirstName: rawGuestFirstName,
      guestLastName: rawGuestLastName,
      price: rawPrice,
      checkInDate: rawCheckInDate,
      checkOutDate: rawCheckOutDate,
      verpflegung: rawVerpflegung,
      interneBemerkungen: rawInterneBemerkungen, // Pass as is, Zod will handle optional
      roomsData: rawRoomsData, // Pass the string for Zod to parse and validate
  };
  logSafe(actionContext + " Data prepared for Zod validation (keys):", Object.keys(dataForZod));

  try {
    const validatedFields = createBookingServerSchema.safeParse(dataForZod);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      const formErrorsFromZod = validatedFields.error.flatten().formErrors;
      
      const allErrors: Record<string, string[]> = {};
      for (const key in fieldErrors) {
        if (fieldErrors[key as keyof typeof fieldErrors]) {
          allErrors[key] = fieldErrors[key as keyof typeof fieldErrors]!;
        }
      }
      if (formErrorsFromZod.length > 0) {
        allErrors.global = (allErrors.global || []).concat(formErrorsFromZod);
      }
      const errorMessagesList = Object.entries(allErrors).map(([key, messages]) => `${key === 'global' ? 'Allgemein' : `Feld '${key}'`}: ${messages.join(', ')}`);
      const errorMessage = errorMessagesList.length > 0 ? errorMessagesList.join('; ') : "Unbekannter Validierungsfehler.";
      
      logSafe(actionContext + " Zod Validation FAILED", { errors: allErrors, zodErrorObject: validatedFields.error.format() }, 'warn');
      return {
        success: false, actionToken: serverActionToken,
        message: `Fehler bei der Validierung: ${errorMessage} (Code: CBA-ZOD-VAL-${serverActionToken.substring(0,4)})`,
        errors: allErrors, bookingToken: null, updatedGuestData: null, currentStep: -1
      };
    }

    const bookingData = validatedFields.data;
    logSafe(`${actionContext} Zod validation successful. Validated bookingData (types and sample values):`, {
        guestFirstName_type: typeof bookingData.guestFirstName, guestFirstName_val: bookingData.guestFirstName,
        guestLastName_type: typeof bookingData.guestLastName, guestLastName_val: bookingData.guestLastName,
        price_type: typeof bookingData.price, price_val: bookingData.price,
        interneBemerkungen_type: typeof bookingData.interneBemerkungen, interneBemerkungen_val: bookingData.interneBemerkungen, // Will be string or undefined
        roomsData_isArray: Array.isArray(bookingData.roomsData), roomsData_length: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'N/A'
    });
    
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const msg = "Interner Fehler: Zimmerdaten (roomsData) sind nach Zod-Validierung ungültig oder leer. (Code: CBA-POSTZOD-RD)";
        logSafe(`${actionContext} CRITICAL ERROR: bookingData.roomsData is not a valid array or is empty after Zod.`, { roomsData: bookingData.roomsData }, 'error');
        return { ...initialFormState, success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] } };
    }
    
    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || ''); // Ensure string

    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'Standard'), 
        erwachsene: Number(room.erwachsene || 0),    
        kinder: Number(room.kinder || 0),          
        kleinkinder: Number(room.kleinkinder || 0),  
        alterKinder: String(room.alterKinder || ''), // Ensure string
    }));
    logSafe(actionContext + " finalRoomsData created:", finalRoomsData);
    
    const firstRoom = finalRoomsData[0]; 
    if (!firstRoom) { // Should be caught by roomsData.length === 0 check earlier, but defensive
        const msg = "Interner Fehler: Keine Zimmerdaten für 'firstRoom' verfügbar. (Code: CBA-NOFIRSTROOM)";
        logSafe(`${actionContext} CRITICAL ERROR: No first room data available.`, { finalRoomsData }, 'error');
        return { ...initialFormState, success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] } };
    }

    const zimmertypForIdentifier = String(firstRoom.zimmertyp || 'Standard');
    let personenSummary = `${Number(firstRoom.erwachsene || 0)} Erw.`;
    if (Number(firstRoom.kinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kinder || 0)} Ki.`;
    if (Number(firstRoom.kleinkinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kleinkinder || 0)} Kk.`;
    const roomIdentifierString = `${zimmertypForIdentifier} (${personenSummary})`;
    logSafe(actionContext + " roomIdentifierString created:", { roomIdentifierString });

    const newBookingToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const newBookingPayload: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> = {
      guestFirstName: String(bookingData.guestFirstName),
      guestLastName: String(bookingData.guestLastName),
      price: Number(bookingData.price),
      checkInDate: new Date(bookingData.checkInDate), 
      checkOutDate: new Date(bookingData.checkOutDate), 
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: String(bookingData.verpflegung || 'ohne'),
      rooms: finalRoomsData,
      interneBemerkungen: finalInterneBemerkungen,
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 } 
    };
    
    logSafe(actionContext + " Attempting to add booking to Firestore. Payload (keys):", { payloadKeys: Object.keys(newBookingPayload) });
    
    let createdBookingId: string | null = null;
    try {
        createdBookingId = await addBookingToFirestore(newBookingPayload);
    } catch (dbError: any) {
        logSafe(`${actionContext} FAIL - addBookingToFirestore threw an error.`, { error: (dbError as Error).message, stack: (dbError as Error).stack?.substring(0,500) }, 'error');
        return {
            success: false, actionToken: serverActionToken,
            message: `Datenbankfehler beim Erstellen der Buchung: ${(dbError as Error).message}. (Code: CBA-DBF-ADD-${serverActionToken.substring(0,4)})`, 
            errors: { global: [`Fehler beim Speichern der Buchung: ${(dbError as Error).message}`] },
            bookingToken: null, updatedGuestData: null, currentStep: -1
        };
    }

    if (!createdBookingId) {
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null or empty ID.`, {}, 'error');
      return {
        success: false, actionToken: serverActionToken,
        message: `Datenbankfehler: Buchung konnte nicht erstellt werden (keine ID zurückgegeben). (Code: CBA-DBF-NOID-${serverActionToken.substring(0,4)})`, 
        errors: { global: ["Fehler beim Speichern der Buchung."] },
        bookingToken: null, updatedGuestData: null, currentStep: -1
      };
    }
    logSafe(`${actionContext} SUCCESS - New booking. Token: ${newBookingToken}. ID: ${createdBookingId}. Total Time: ${Date.now() - startTime}ms.`);
    
    revalidatePath("/admin/dashboard", "page");
    
    return {
      success: true, actionToken: serverActionToken,
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      bookingToken: newBookingToken,
      errors: null,
      updatedGuestData: null, 
      currentStep: -1 
    };

  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in createBookingAction`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return {
      success: false,
      actionToken: serverActionToken,
      message: `Unerwarteter Serverfehler: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken.substring(0,8)}) (Code: CBA-GUEH)`,
      errors: { global: [`Serverfehler: ${error.message}. Bitte Admin kontaktieren. (Code: CBA-GUEH-G-${serverActionToken.substring(0,4)})`] },
      bookingToken: null, updatedGuestData: null, currentStep: -1
    };
  } finally {
     logSafe(`${actionContext} END. Total time: ${Date.now() - startTime}ms.`);
  }
}


// --- Delete Bookings Action ---
export async function deleteBookingsAction(
  prevState: {success: boolean; message: string; actionToken?: string},
  bookingIds: string[]
): Promise<{ success: boolean; message: string, actionToken: string }> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[deleteBookingsAction(Action:${serverActionToken.substring(0,8)})]`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { success: false, message: `Kritischer Serverfehler: Firebase nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Code: DBA-FNI-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken };
  }

  logSafe(actionContext + " BEGIN", { bookingIdsParamType: typeof bookingIds, bookingIdsParamIsArray: Array.isArray(bookingIds), bookingIdsParamValue: bookingIds });

  // Ensure bookingIds is an array, even if it's passed incorrectly (though the DataTable should send an array)
  const idsToProcess = Array.isArray(bookingIds) ? bookingIds : [];
  const validBookingIds = idsToProcess.filter(id => typeof id === 'string' && id.trim() !== '');
  
  logSafe(actionContext + " Valid booking IDs to process:", { count: validBookingIds.length, ids: validBookingIds });

  if (validBookingIds.length === 0) {
    logSafe(`${actionContext} No valid booking IDs provided for deletion. Original input:`, { bookingIds }, 'warn');
    return { success: false, message: "Keine gültigen Buchungs-IDs zum Löschen angegeben. (Code: DBA-NVID)", actionToken: serverActionToken };
  }

  try {
    const result = await deleteBookingsFromFirestoreByIds(validBookingIds);
    logSafe(`${actionContext} deleteBookingsFromFirestoreByIds result:`, { result });

    if (result.success) {
      revalidatePath("/admin/dashboard", "page");
    }
    return { ...result, actionToken: serverActionToken }; 
  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in deleteBookingsAction`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return {
        success: false,
        message: `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: DBA-GUEH)`,
        actionToken: serverActionToken
    };
  }
}
    

    

    