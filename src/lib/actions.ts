
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
  convertTimestampsToISO,
} from "./mock-db";
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";

// Helper for logging (simplified for brevity, ensure your full version is used if more complex)
function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = "[Server Action LogSafe]";
    let simplifiedData;
    const maxLogLength = 3000; // Adjusted for potentially larger objects
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
            if (value instanceof File) { return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }; }
            if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack ? value.stack.substring(0,400) + "...[TRUNCATED_STACK]" : "No stack" }; }
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

export type FormState = GlobalFormState; // Use the more detailed definition from definitions.ts

const initialFormState: FormState = { message: null, errors: null, success: false, actionToken: undefined, updatedGuestData: null, bookingToken: null, currentStep: -1 };

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

// Helper to convert Firestore Timestamps in GuestSubmittedData to ISO strings for client
function convertTimestampsInGuestData(guestData: GuestSubmittedData | null | undefined): GuestSubmittedData | null | undefined {
  if (!guestData) return guestData;
  const newGuestData = { ...guestData }; // Shallow copy
  if (newGuestData.submittedAt instanceof Timestamp) {
    newGuestData.submittedAt = newGuestData.submittedAt.toDate().toISOString();
  }
  if (newGuestData.zahlungsdatum && !(typeof newGuestData.zahlungsdatum === 'string')) { // Assuming zahlungsdatum could be Date or Timestamp
    try {
        newGuestData.zahlungsdatum = (newGuestData.zahlungsdatum instanceof Timestamp ? newGuestData.zahlungsdatum.toDate() : new Date(newGuestData.zahlungsdatum as any)).toISOString().split('T')[0];
    } catch (e) {
        logSafe('[convertTimestampsInGuestData] Error converting zahlungsdatum', { zahlungsdatum: newGuestData.zahlungsdatum, error: e }, 'warn');
        // leave as is or set to undefined if conversion fails
    }
  }
  // geburtsdatum is already expected as string YYYY-MM-DD
  return newGuestData;
}


async function updateBookingStep(
  forActionToken: string,
  bookingId: string,
  stepNumber: number, // 1-indexed for current step being processed
  stepName: string,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `[updateBookingStep(BookingID:${bookingId}, Step:${stepNumber}-${stepName}, ActionToken:${forActionToken.substring(0,8)})]`;
  const startTime = Date.now();
  logSafe(`${actionContext} BEGIN`, { formDataKeys: Array.from(formData.keys()), additionalDataToMergeKeys: additionalDataToMerge ? Object.keys(additionalDataToMerge) : 'N/A' });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
    return {
      message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. Bitte Admin kontaktieren. (Details: ${initErrorMsg}) (Aktions-ID: ${forActionToken}) (Code: UBS-FNI)`,
      errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI-G)`] },
      success: false, actionToken: forActionToken, currentStep: stepNumber > 0 ? stepNumber - 1 : 0, updatedGuestData: null
    };
  }

  let bookingDoc: Booking | null = null;
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;

  try { // Global try-catch for the entire step update logic
    bookingDoc = await findBookingByIdFromFirestore(bookingId);
    if (!bookingDoc) {
      logSafe(`${actionContext} FAIL - Booking NOT FOUND with ID:`, { bookingId }, 'warn');
      return {
        message: `Buchung mit ID ${bookingId} nicht gefunden. (Code: UBS-BNF-${forActionToken.substring(0,4)})`,
        errors: { global: [`Buchung nicht gefunden. (Aktions-ID: ${forActionToken}) (Code: UBS-BNF-G)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber > 0 ? stepNumber - 1 : 0, updatedGuestData: null
      };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 })); // Deep clone
    logSafe(`${actionContext} Current guest data snapshot fetched`, { lastCompletedStep: currentGuestDataSnapshot.lastCompletedStep });

    const rawFormData = Object.fromEntries(formData.entries());
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const formErrors: Record<string, string[]> = {};
      const zodErrors = validatedFields.error.flatten().fieldErrors;
      for (const key in zodErrors) {
          if (zodErrors[key]) formErrors[key] = zodErrors[key]!;
      }
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors, rawFormDataKeys: Object.keys(rawFormData) }, 'warn');
      return {
          message: "Validierungsfehler. Bitte Eingaben prüfen. (Code: UBS-ZVF)", errors: formErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber > 0 ? stepNumber - 1 : 0,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot)
      };
    }
    const dataFromForm = validatedFields.data;
    logSafe(`${actionContext} Zod Validation SUCCESSFUL. Data keys from form:`, { keys: Object.keys(dataFromForm) });

    let updatedGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(currentGuestDataSnapshot)); // Deep clone again for this update cycle
    
    if (additionalDataToMerge) {
        updatedGuestData = { ...updatedGuestData, ...additionalDataToMerge };
    }
    
    const formKeys = Object.keys(dataFromForm);
    const formErrors: Record<string, string[]> = {};

    // Apply non-file data first
    for (const key of formKeys) {
        if (!(dataFromForm[key] instanceof File) && key !== 'mitreisendeMeta' && key !== 'mitreisende') {
            (updatedGuestData as any)[key] = dataFromForm[key];
        }
    }

    // Define file fields based on stepName or a more generic approach
    const fileFieldsToProcess: Array<{
      formDataKey: string; // Key in formData (e.g., "hauptgastAusweisVorderseiteFile")
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string; // For mitreisende files
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
    }> = [];

    if (stepName === "Hauptgast & Ausweis") { // Step 1
        fileFieldsToProcess.push(
            { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl' },
            { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl' }
        );
    } else if (stepName === "Mitreisende") { // Step 2
      try {
          const mitreisendeMetaRaw = formData.get('mitreisendeMeta');
          const mitreisendeMetaParsed = typeof mitreisendeMetaRaw === 'string' && mitreisendeMetaRaw.trim() !== ""
            ? JSON.parse(mitreisendeMetaRaw)
            : [];

          (mitreisendeMetaParsed as Array<{id:string}>).forEach((mitreisenderClient) => {
              if (mitreisenderClient.id) {
                  fileFieldsToProcess.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl'});
                  fileFieldsToProcess.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl'});
              }
          });
      } catch(e: any) {
          logSafe(`${actionContext} WARN: Failed to parse mitreisendeMeta for file config.`, { error: e.message, meta: formData.get('mitreisendeMeta') }, 'warn');
          formErrors.mitreisendeMeta = ["Fehler beim Verarbeiten der Mitreisenden-Daten für Datei-Uploads."];
      }
    } else if (stepName === "Zahlungsinfo") { // Step 4
        fileFieldsToProcess.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl' });
    }

    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsToProcess.length });

    for (const config of fileFieldsToProcess) {
      const file = rawFormData[config.formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined | null = null;
      
      const snapshotForOldUrl = bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }; // Use original bookingDoc for old URLs
      if (config.mitreisenderId && config.mitreisenderUrlKey && snapshotForOldUrl?.mitreisende) {
          const companion = snapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (snapshotForOldUrl as any)?.[config.guestDataUrlKey];
      }

      if (file instanceof File && file.size > 0) {
        const originalFileName = file.name;
        logSafe(`${actionContext} Processing NEW file for ${config.formDataKey}: "${originalFileName}" (Size: ${file.size}, Type: ${file.type}). Old URL: ${oldFileUrl ? String(oldFileUrl).substring(0, 80) + '...' : 'N/A'}`);

        if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === "") {
            const errorMsg = `Datei für Feld ${config.formDataKey} hat einen ungültigen oder leeren Namen. (Code: UBS-IFN)`;
            logSafe(`${actionContext} WARN: Skipping file for ${config.formDataKey} due to invalid name. Original name: "${originalFileName}"`, { originalFileName }, 'warn');
            if (!formErrors[config.formDataKey]) formErrors[config.formDataKey] = [];
            formErrors[config.formDataKey].push(errorMsg);
            continue;
        }
        
        let arrayBuffer: ArrayBuffer;
        try {
            const bufferStartTime = Date.now();
            arrayBuffer = await file.arrayBuffer();
            logSafe(`${actionContext} ArrayBuffer for "${originalFileName}" (Size: ${arrayBuffer.byteLength}) read in ${Date.now() - bufferStartTime}ms`);
        } catch (bufferError: any) {
            const err = bufferError instanceof Error ? bufferError : new Error(String(bufferError));
            const errorMsg = `Fehler beim Lesen der Datei "${originalFileName}": ${err.message} (Code: UBS-FBF)`;
            logSafe(`${actionContext} FILE BUFFER FAIL for "${originalFileName}"`, { errorName: err.name, errorMessage: err.message }, 'error');
            if (!formErrors[config.formDataKey]) formErrors[config.formDataKey] = [];
            formErrors[config.formDataKey].push(errorMsg);
            continue;
        }

        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
            try {
                logSafe(`${actionContext} Attempting to delete OLD file from Storage: ${oldFileUrl} for ${config.formDataKey}.`);
                const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
                await deleteObject(oldFileStorageRefHandle);
                logSafe(`${actionContext} OLD file ${oldFileUrl} deleted from Storage for ${config.formDataKey}.`);
            } catch (deleteError: any) {
                const err = deleteError instanceof Error ? deleteError : new Error(String(deleteError));
                const fbErrorCode = (err as any)?.code;
                if (fbErrorCode === 'storage/object-not-found') {
                    logSafe(`${actionContext} WARN: Old file for ${config.formDataKey} not found in Storage, skipping deletion. URL: ${oldFileUrl}`, {}, 'warn');
                } else {
                    logSafe(`${actionContext} WARN: Failed to delete OLD file for ${config.formDataKey} from Storage. URL: ${oldFileUrl}. Code: ${fbErrorCode}`, { errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'warn');
                    // Non-critical, so don't add to formErrors unless desired
                }
            }
        }

        let downloadURL: string | undefined;
        try {
            const cleanedFileName = originalFileName.replace(/[^a-zA-Z0-9_.\-]/g, '_');
            const uniqueFileName = `${Date.now()}_${cleanedFileName}`;
            let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;

            if(config.mitreisenderId) {
                filePathPrefix += `/mitreisende/${config.mitreisenderId}/${(config.mitreisenderUrlKey || 'file').replace('Url', '')}`;
            } else if (config.guestDataUrlKey) {
                filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`;
            } else {
                filePathPrefix += `/other_uploads/${config.formDataKey}`;
            }
            const filePath = `${filePathPrefix}/${uniqueFileName}`;

            logSafe(`${actionContext} Uploading "${originalFileName}" to Storage path: ${filePath}. Content-Type: ${file.type}`);
            const fileStorageRefHandle = storageRefFB(storage, filePath);
            const uploadStartTime = Date.now();
            await uploadBytes(fileStorageRefHandle, arrayBuffer, { contentType: file.type });
            logSafe(`${actionContext} File "${originalFileName}" uploaded in ${Date.now() - uploadStartTime}ms`);
          
            const getUrlStartTime = Date.now();
            downloadURL = await getDownloadURL(fileStorageRefHandle);
            logSafe(`${actionContext} Got download URL for "${originalFileName}" in ${Date.now() - getUrlStartTime}ms: ${downloadURL.substring(0,80)}...`);

        } catch (fileUploadError: any) {
            const err = fileUploadError instanceof Error ? fileUploadError : new Error(String(fileUploadError));
            let userMessage = `Dateiupload für "${originalFileName}" fehlgeschlagen.`;
            const fbErrorCode = (err as any)?.code;
            logSafe(`${actionContext} FIREBASE STORAGE UPLOAD/GET_URL FAIL for "${originalFileName}"`, { errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'error');
            if (fbErrorCode === 'storage/unauthorized') userMessage = `Berechtigungsfehler: Upload für "${originalFileName}" verweigert. Firebase Storage Regeln prüfen. (Code: UBS-FSU-${forActionToken.substring(0,4)})`;
            else if (fbErrorCode === 'storage/canceled') userMessage = `Upload für "${originalFileName}" abgebrochen. Bitte erneut versuchen. (Code: UBS-FSC-${forActionToken.substring(0,4)})`;
            else if (fbErrorCode === 'storage/quota-exceeded') userMessage = `Speicherlimit überschritten beim Upload von "${originalFileName}". (Code: UBS-FSQ-${forActionToken.substring(0,4)})`;
            else userMessage += ` Details: ${err.message || "Unbekannter Upload-Fehler"}`;
            
            if (!formErrors[config.formDataKey]) formErrors[config.formDataKey] = [];
            formErrors[config.formDataKey].push(userMessage);
            continue;
        }

        if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey) {
                if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (companion) { (companion as any)[config.mitreisenderUrlKey] = downloadURL; }
                else {
                  // This case might happen if client-side `mitreisendeMeta` is out of sync with actual file fields being sent
                  logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} for file ${config.formDataKey} not found in updatedGuestData.mitreisende array. File URL not assigned to a companion.`, { mitreisendeCount: updatedGuestData.mitreisende.length }, 'warn');
                }
            } else if (config.guestDataUrlKey) { (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL; }
        }
      } else if (file instanceof File && file.size === 0 && rawFormData[config.formDataKey]) {
         // File field was submitted but empty (e.g., user cleared it)
         logSafe(`${actionContext} File field ${config.formDataKey} submitted empty/cleared. Old URL was: ${oldFileUrl ? String(oldFileUrl).substring(0, 80) + '...' : 'N/A'}`);
         if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
           try {
             logSafe(`${actionContext} Attempting to delete OLD file from Storage due to empty submission for ${config.formDataKey}: ${oldFileUrl}`);
             const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
             await deleteObject(oldFileStorageRefHandle);
             logSafe(`${actionContext} OLD file ${oldFileUrl} deleted from Storage for ${config.formDataKey} (due to clearing).`);
           } catch (deleteError: any) {
              const err = deleteError instanceof Error ? deleteError : new Error(String(deleteError));
              const fbErrorCode = (err as any)?.code;
              if (fbErrorCode === 'storage/object-not-found') {
                logSafe(`${actionContext} WARN: Old file for ${config.formDataKey} not found in Storage (when clearing), skipping deletion. URL: ${oldFileUrl}`, {}, 'warn');
              } else {
                logSafe(`${actionContext} WARN: Failed to delete OLD file for ${config.formDataKey} from Storage (when clearing). URL: ${oldFileUrl}. Code: ${fbErrorCode}`, { errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'warn');
              }
           }
         }
         // Clear the URL in updatedGuestData if it was an empty submission
         if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
              let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
              if (companion) { (companion as any)[config.mitreisenderUrlKey] = undefined; }
         } else if (config.guestDataUrlKey) {
              (updatedGuestData as any)[config.guestDataUrlKey] = undefined;
         }
      }
      // If no file, no empty file, old URL is retained implicitly from currentGuestDataSnapshot
    }

    logSafe(actionContext + " File processing END", { fileProcessingErrorsCount: Object.keys(formErrors).length });

    if (stepName === "Mitreisende") {
        try {
          const mitreisendeMetaRaw = formData.get('mitreisendeMeta');
          const clientMitreisende = typeof mitreisendeMetaRaw === 'string' && mitreisendeMetaRaw.trim() !== ""
            ? JSON.parse(mitreisendeMetaRaw)
            : [];
          
          const serverMitreisende: MitreisenderData[] = [];
          const existingServerMitreisende = Array.isArray(updatedGuestData.mitreisende) ? updatedGuestData.mitreisende : [];

          for (const cm of clientMitreisende) {
              const existingOrFileProcessedCompanion = existingServerMitreisende.find(sm => sm.id === cm.id);
              serverMitreisende.push({
                  id: String(cm.id || generateActionToken()), // Ensure ID is always a string
                  vorname: String(cm.vorname || ''),
                  nachname: String(cm.nachname || ''),
                  // URLs are set during file processing loop above or retained if no new file
                  ausweisVorderseiteUrl: existingOrFileProcessedCompanion?.ausweisVorderseiteUrl,
                  ausweisRückseiteUrl: existingOrFileProcessedCompanion?.ausweisRückseiteUrl,
              });
          }
          updatedGuestData.mitreisende = serverMitreisende;
          logSafe(`${actionContext} Processed mitreisendeMeta. Resulting count: ${serverMitreisende.length}`);
        } catch(e: any) {
            const err = e instanceof Error ? e : new Error(String(e));
            logSafe(`${actionContext} WARN: Failed to process mitreisendeMeta.`, { error: err.message, meta: formData.get('mitreisendeMeta') }, 'warn');
            if (!formErrors.mitreisendeMeta) formErrors.mitreisendeMeta = [];
            formErrors.mitreisendeMeta.push("Fehler beim Verarbeiten der Mitreisenden-Daten.");
        }
        delete (updatedGuestData as any).mitreisendeMeta;
    }

    if (Object.keys(formErrors).length > 0) {
        logSafe(`${actionContext} Returning due to accumulated form errors (mostly file processing).`, { errors: formErrors });
        return {
            message: "Einige Felder oder Dateien konnten nicht verarbeitet werden. Bitte prüfen Sie die Meldungen. (Code: UBS-FPE)",
            errors: formErrors, success: false, actionToken: forActionToken,
            currentStep: stepNumber > 0 ? stepNumber - 1 : 0,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
        };
    }

    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1);
    logSafe(`${actionContext} Updated lastCompletedStep to: ${updatedGuestData.lastCompletedStep}`);

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") {
      const agbAkzeptiert = dataFromForm.agbAkzeptiert === true;
      const datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true;

      updatedGuestData.agbAkzeptiert = agbAkzeptiert;
      updatedGuestData.datenschutzAkzeptiert = datenschutzAkzeptiert;
      logSafe(`${actionContext} Consent values: AGB=${agbAkzeptiert}, Datenschutz=${datenschutzAkzeptiert}`);

      if (agbAkzeptiert && datenschutzAkzeptiert) {
        updatedGuestData.submittedAt = Timestamp.now();
        bookingStatusUpdate.status = "Confirmed";
        logSafe(`${actionContext} Consent given, setting status to Confirmed and submittedAt.`);
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(!agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        logSafe(`${actionContext} Consent Error`, { errors: consentErrors });
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert. (Code: UBS-CE)", errors: consentErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber > 0 ? stepNumber - 1 : 0,
          updatedGuestData: convertTimestampsInGuestData(updatedGuestData),
        };
      }
    }
    
    const bookingUpdatesFirestore: Partial<Booking> = {
        guestSubmittedData: updatedGuestData,
        ...(bookingStatusUpdate.status && { status: bookingStatusUpdate.status })
    };
    
    if (stepName === "Hauptgast & Ausweis" && dataFromForm.gastVorname && dataFromForm.gastNachname && bookingDoc) {
        if(bookingDoc.guestFirstName !== dataFromForm.gastVorname || bookingDoc.guestLastName !== dataFromForm.gastNachname) {
            bookingUpdatesFirestore.guestFirstName = String(dataFromForm.gastVorname);
            bookingUpdatesFirestore.guestLastName = String(dataFromForm.gastNachname);
            logSafe(`${actionContext} Hauptgast Name auf Buchung aktualisiert zu: ${dataFromForm.gastVorname} ${dataFromForm.gastNachname}`);
        }
    }
    
    logSafe(`${actionContext} Attempting to update booking in Firestore. Path: ${bookingDoc.id!}. Update keys:`, Object.keys(bookingUpdatesFirestore));
    const firestoreUpdateStartTime = Date.now();
    try {
      await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
      logSafe(`${actionContext} Firestore update successful in ${Date.now() - firestoreUpdateStartTime}ms.`);
    } catch (firestoreUpdateError: any) {
        const err = firestoreUpdateError instanceof Error ? firestoreUpdateError : new Error(String(firestoreUpdateError));
        logSafe(`${actionContext} FIRESTORE UPDATE FAIL`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
        return {
            message: `Fehler beim Speichern der Daten in Firestore: ${err.message}. (Aktions-ID: ${forActionToken}) (Code: UBS-FSUF)`,
            errors: { global: [`Datenbankfehler: ${err.message}. (Code: UBS-FSUF-G)`] },
            success: false, actionToken: forActionToken,
            currentStep: stepNumber > 0 ? stepNumber - 1 : 0,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
        };
    }

    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    const finalUpdatedGuestDataForClient = convertTimestampsInGuestData(updatedGuestData);
    logSafe(`${actionContext} SUCCESS - Step ${stepNumber} processed.`, { finalMessage: message });
    return {
        message, errors: null, success: true, actionToken: forActionToken,
        updatedGuestData: finalUpdatedGuestDataForClient,
        currentStep: stepNumber -1
    };

  } catch (error: any) { // Global catch for updateBookingStep's main try-catch (after fetching bookingDoc)
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch (after bookingDoc fetch)`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,1200) }, 'error');
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${err.message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-GUEH)`,
        errors: { global: [`Serverfehler (Schritt ${stepName}): ${err.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support. (Code: UBS-GUEH-G)`] },
        success: false, actionToken: forActionToken,
        currentStep: stepNumber > 0 ? stepNumber - 1 : 0,
        updatedGuestData: currentGuestDataSnapshot ? convertTimestampsInGuestData(currentGuestDataSnapshot) : null,
    };
  } finally {
     logSafe(`${actionContext} END. Total time: ${Date.now() - startTime}ms.`);
  }
}


// --- Schema for Hauptgast & Ausweis step ---
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
});

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitGastStammdatenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SGA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }

  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
       logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
       return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SGA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 1, "Hauptgast & Ausweis", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-GUEH)`, errors: { global: [`Serverfehler (Stammdaten): ${err.message} (Code: SGA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Schema for Mitreisende step ---
const mitreisenderClientSchema = z.object({
  id: z.string(),
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
  // Alter und Dokumente sind optional für den Client-Teil der Meta-Daten, werden serverseitig validiert, falls Dateien gesendet werden.
});

const mitreisendeStepSchema = z.object({
  mitreisendeMeta: z.preprocess(
    (val) => {
      if (typeof val === 'string' && val.trim() !== "") {
        try { return JSON.parse(val); } catch (e) { return []; /* Bei Parsing-Fehler leeres Array */ }
      }
      return []; // Handle empty string or non-string as empty array
    },
    z.array(mitreisenderClientSchema).optional().default([])
  ),
  // Dynamische Felder für Dateien der Mitreisenden (z.B. mitreisende_ID_ausweisVorderseiteFile)
  // werden durch .catchall(fileSchema) abgedeckt.
}).catchall(fileSchema);

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SMA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }

   try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SMA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 2, "Mitreisende", mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SMA-GUEH)`, errors: { global: [`Serverfehler (Mitreisende): ${err.message} (Code: SMA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Schema for Zahlungssumme wählen step ---
const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(["downpayment", "full_amount"], { required_error: "Auswahl der Zahlungssumme ist erforderlich." }),
});
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SPASA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SPASA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    
    const validatedFields = paymentAmountSelectionSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!validatedFields.success) {
        return { message: "Validierungsfehler bei Zahlungssummenauswahl.", errors: validatedFields.error.flatten().fieldErrors, success: false, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    const selectedAmount = validatedFields.data.paymentAmountSelection;
    let zahlungsbetrag = booking.price || 0;
    if (selectedAmount === 'downpayment') {
      zahlungsbetrag = parseFloat(((booking.price || 0) * 0.3).toFixed(2));
    }
    
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag, paymentAmountSelection: selectedAmount } as Partial<GuestSubmittedData>;
    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-GUEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${err.message} (Code: SPASA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Schema for Zahlungsinformationen step ---
const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});
export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SZIA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }

  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SZIA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 4, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now() });
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-GUEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${err.message} (Code: SZIA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Schema for Übersicht & Bestätigung step ---
const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});
export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SEBA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }

  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SEBA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 5, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-GUEH)`, errors: { global: [`Serverfehler (Bestätigung): ${err.message} (Code: SEBA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Schema for Create Booking Dialog (Admin) ---
const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich.").default('Standard'),
  erwachsene: z.coerce.number({invalid_type_error: "Anzahl Erwachsene muss eine Zahl sein."}).int().min(0, "Anzahl Erwachsene darf nicht negativ sein.").default(1),
  kinder: z.coerce.number({invalid_type_error: "Anzahl Kinder muss eine Zahl sein."}).int().min(0, "Anzahl Kinder darf nicht negativ sein.").optional().default(0),
  kleinkinder: z.coerce.number({invalid_type_error: "Anzahl Kleinkinder muss eine Zahl sein."}).int().min(0, "Anzahl Kleinkinder darf nicht negativ sein.").optional().default(0),
  alterKinder: z.string().optional().default(''), // Default to empty string
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
  interneBemerkungen: z.string().optional().default(''), // Default to empty string
  roomsData: z.string({ required_error: "Zimmerdaten (String) sind erforderlich.", invalid_type_error: "Zimmerdaten müssen als String übergeben werden." })
    .min(1, "Zimmerdaten String darf nicht leer sein. (Code: CBA-RD-EMPTYSTR)")
    .pipe(
      z.string().transform((str, ctx) => {
        try {
          const parsed = JSON.parse(str);
          // Log the parsed structure to ensure it's an array of objects as expected by RoomSchema
          logSafe("[createBookingAction] Parsed roomsData for Zod array validation:", parsed, "info");
          return parsed;
        } catch (e: any) {
          const err = e instanceof Error ? e : new Error(String(e));
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Die Zimmerdaten sind nicht im korrekten JSON-Format: ${err.message} (Code: CBA-RD-JSON)` });
          return z.NEVER;
        }
      }).pipe(
        z.array(RoomSchema, {
           errorMap: (issue, ctx) => {
                if (issue.code === z.ZodIssueCode.too_small && issue.path.length === 0) {
                    return { message: "Mindestens ein Zimmer muss hinzugefügt werden." };
                }
                // For errors within room objects, issue.path would be [index, fieldName] e.g. [0, "zimmertyp"]
                // It could also be just [index] if the whole object is invalid
                let fieldMessage = `Fehler im Zimmer ${Number(issue.path[0]) + 1}`;
                if (issue.path.length > 1) {
                  fieldMessage += `, Feld '${issue.path[1]}'`;
                }
                fieldMessage += `: ${issue.message || ctx.defaultError}`;
                return { message: fieldMessage };
            }
        }).min(1, "Mindestens ein Zimmer muss hinzugefügt werden. (Code: CBA-RD-MIN1)")
      )
    ),
}).refine(data => {
  if (data.checkInDate && data.checkOutDate) {
    try {
        return new Date(data.checkOutDate) > new Date(data.checkInDate);
    } catch (e) { return false; }
  }
  return true;
}, {
  message: "Abreisedatum muss nach dem Anreisedatum liegen.",
  path: ["dateRange"],
});


export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[createBookingAction(Action:${serverActionToken.substring(0,8)})]`;
  const startTime = Date.now();

  logSafe(actionContext + " BEGIN", { formDataKeys: Array.from(formData.keys())});

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
  
  const rawCheckInDate = formData.get("checkInDate");
  const rawCheckOutDate = formData.get("checkOutDate");
  const rawRoomsData = formData.get("roomsData");

  logSafe(`${actionContext} Raw form data values from FormData:`, {
      guestFirstName: formData.get("guestFirstName"),
      guestLastName: formData.get("guestLastName"),
      price: formData.get("price"),
      checkInDate: rawCheckInDate,
      checkOutDate: rawCheckOutDate,
      verpflegung: formData.get("verpflegung"),
      interneBemerkungen: formData.get("interneBemerkungen"),
      roomsData_type: typeof rawRoomsData,
      roomsData_value_preview: typeof rawRoomsData === 'string' ? rawRoomsData.substring(0,100) + '...' : rawRoomsData,
  });

  if (typeof rawCheckInDate !== "string" || rawCheckInDate.trim() === "") {
    const msg = "Anreisedatum ist erforderlich und muss ein String sein. (Code: CBA-PRE-CID)";
    logSafe(`${actionContext} Pre-validation FAIL`, { field: 'checkInDate', value: rawCheckInDate, error: msg }, 'warn');
    return { success: false, actionToken: serverActionToken, message: msg, errors: { checkInDate: [msg] }, bookingToken: null };
  }
  if (typeof rawCheckOutDate !== "string" || rawCheckOutDate.trim() === "") {
    const msg = "Abreisedatum ist erforderlich und muss ein String sein. (Code: CBA-PRE-COD)";
    logSafe(`${actionContext} Pre-validation FAIL`, { field: 'checkOutDate', value: rawCheckOutDate, error: msg }, 'warn');
    return { success: false, actionToken: serverActionToken, message: msg, errors: { checkOutDate: [msg] }, bookingToken: null };
  }
  if (typeof rawRoomsData !== "string" || rawRoomsData.trim() === "") {
    const msg = "Zimmerdaten sind erforderlich, müssen als JSON-String übergeben werden und dürfen nicht leer sein. (Code: CBA-PRE-RD-STR)";
    logSafe(`${actionContext} Pre-validation FAIL`, { field: 'roomsData', value: rawRoomsData, error: msg }, 'warn');
    return { success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] }, bookingToken: null };
  }

  let parsedRoomsForPreCheck;
  try {
    parsedRoomsForPreCheck = JSON.parse(rawRoomsData);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const msg = `Zimmerdaten sind kein gültiges JSON-Format: ${err.message}. (Code: CBA-PRE-RD-JSON)`;
    logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' JSON.parse error.`, {rawRoomsData, error: msg}, 'warn');
    return { success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] }, bookingToken: null };
  }

  if (!Array.isArray(parsedRoomsForPreCheck)) {
    const msg = "Zimmerdaten müssen ein Array sein nach dem Parsen des JSON-Strings. (Code: CBA-PRE-RD-ARR)";
    logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' (parsed) is not an array.`, {parsedRoomsForPreCheck}, 'warn');
    return { success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] }, bookingToken: null };
  }
  if (parsedRoomsForPreCheck.length === 0) {
    const msg = "Es muss mindestens ein Zimmer in den Zimmerdaten angegeben werden. (Code: CBA-PRE-RD-EMPTYARR)";
    logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' array is empty.`, {parsedRoomsForPreCheck}, 'warn');
    return { success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] }, bookingToken: null };
  }

  const dataForZod = {
      guestFirstName: formData.get("guestFirstName"),
      guestLastName: formData.get("guestLastName"),
      price: formData.get("price"),
      checkInDate: rawCheckInDate,
      checkOutDate: rawCheckOutDate,
      verpflegung: formData.get("verpflegung"),
      interneBemerkungen: formData.get("interneBemerkungen"), // Will be defaulted by Zod if null/undefined
      roomsData: rawRoomsData, // Pass the raw string to Zod for its full pipeline
  };
  logSafe(actionContext + " Data prepared for Zod validation:", dataForZod);

  try {
    const validatedFields = createBookingServerSchema.safeParse(dataForZod);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      const formErrorsFromZod = validatedFields.error.flatten().formErrors; // Global form errors from Zod
      
      // Combine field errors and global form errors
      const allErrors: Record<string, string[]> = {};
      for (const key in fieldErrors) {
          if (fieldErrors[key as keyof typeof fieldErrors]) {
              allErrors[key] = fieldErrors[key as keyof typeof fieldErrors]!;
          }
      }
      if (formErrorsFromZod.length > 0) {
          allErrors.global = formErrorsFromZod;
      }

      const errorMessagesList: string[] = [];
        Object.entries(allErrors).forEach(([key, messages]) => {
            if (messages && Array.isArray(messages)) {
                errorMessagesList.push(`${key}: ${messages.join(', ')}`);
            }
        });
      const errorMessage = errorMessagesList.length > 0 ? errorMessagesList.join('; ') : "Unbekannter Validierungsfehler.";
      logSafe(actionContext + " Zod Validation FAILED", { errors: allErrors, detailedErrorMessage: errorMessage, dataForZod }, 'warn');

      return {
        success: false, actionToken: serverActionToken,
        message: `Fehler bei der Validierung: ${errorMessage} (Code: CBA-ZOD-VAL-${serverActionToken.substring(0,4)})`,
        errors: allErrors, bookingToken: null, updatedGuestData: null, currentStep: -1
      };
    }

    const bookingData = validatedFields.data;
    logSafe(`${actionContext} Zod validation successful. Validated bookingData:`, {
      interneBemerkungen_type: typeof bookingData.interneBemerkungen,
      interneBemerkungen_value: bookingData.interneBemerkungen,
      roomsData_is_array: Array.isArray(bookingData.roomsData),
      roomsData_length: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'Not an array',
      roomsData_content_preview: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.map(r => ({z: r.zimmertyp, aK: r.alterKinder})) : 'Not an array',
    });
    
    // Further check after Zod validation, this should ideally be caught by Zod's .min(1) on the array.
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const msg = "Interner Fehler: Zimmerdaten sind nach Zod-Validierung ungültig (kein Array oder leer). (Code: CBA-POSTZOD-RD)";
        logSafe(`${actionContext} CRITICAL ERROR: bookingData.roomsData is not a valid array after Zod.`, { roomsData: bookingData.roomsData }, 'error');
        return { success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] }, bookingToken: null };
    }

    // Explicitly ensure optional strings are empty strings, not undefined, before constructing final payload
    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || '');

    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'Standard'), // Default if zimmertyp is undefined (should be caught by Zod's .default)
        erwachsene: Number(room.erwachsene || 0),    // Default if erwachsene is undefined
        kinder: Number(room.kinder || 0),          // Default if kinder is undefined
        kleinkinder: Number(room.kleinkinder || 0),  // Default if kleinkinder is undefined
        alterKinder: String(room.alterKinder || ''), // Default if alterKinder is undefined
    }));
    
    const firstRoom = finalRoomsData[0]; // Safe due to Zod .min(1) and prior checks
    const zimmertypForIdentifier = String(firstRoom.zimmertyp || 'Standard'); // Again, defensive
    let personenSummary = `${Number(firstRoom.erwachsene || 0)} Erw.`;
    if (Number(firstRoom.kinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kinder || 0)} Ki.`;
    if (Number(firstRoom.kleinkinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kleinkinder || 0)} Kk.`;
    const roomIdentifierString = `${zimmertypForIdentifier} (${personenSummary})`;

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
    
    logSafe(actionContext + " Attempting to add booking to Firestore. Payload preview:", { ...newBookingPayload, checkInDate: newBookingPayload.checkInDate?.toISOString(), checkOutDate: newBookingPayload.checkOutDate?.toISOString(), roomsCount: newBookingPayload.rooms?.length });
    
    let createdBookingId: string | null = null;
    try {
        createdBookingId = await addBookingToFirestore(newBookingPayload);
    } catch (dbError: any) {
        const err = dbError instanceof Error ? dbError : new Error(String(dbError));
        logSafe(`${actionContext} FAIL - addBookingToFirestore threw an error.`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,800) }, 'error');
        return {
            success: false, actionToken: serverActionToken,
            message: `Datenbankfehler beim Erstellen der Buchung: ${err.message}. (Code: CBA-DBF-ADD-${serverActionToken.substring(0,4)})`, 
            errors: { global: [`Fehler beim Speichern der Buchung: ${err.message}`] },
            bookingToken: null, updatedGuestData: null, currentStep: -1
        };
    }

    if (!createdBookingId) {
      const errorMsg = `Datenbankfehler: Buchung konnte nicht erstellt werden (keine ID zurückgegeben). (Code: CBA-DBF-NOID-${serverActionToken.substring(0,4)})`;
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null or empty ID.`, {}, 'error');
      return {
        success: false, actionToken: serverActionToken,
        message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] },
        bookingToken: null, updatedGuestData: null, currentStep: -1
      };
    }
    logSafe(`${actionContext} SUCCESS - New booking. Token: ${newBookingToken}. ID: ${createdBookingId}. Time: ${Date.now() - startTime}ms.`);
    revalidatePath("/admin/dashboard", "page");
    // revalidatePath(`/admin/bookings/${createdBookingId}`, "page"); // Less critical for immediate user feedback
    // revalidatePath(`/buchung/${newBookingToken}`, "page"); // Guest page revalidation
    
    return {
      success: true, actionToken: serverActionToken,
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      bookingToken: newBookingToken, // Send token back to client
      updatedGuestData: null, errors: null, currentStep: -1
    };
  } catch (e: any) {
    // This is the global catch block for unexpected errors within the main try.
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[${actionContext}] GLOBAL UNHANDLED EXCEPTION in createBookingAction: ${error.message}`, error.stack);
    return {
      success: false,
      actionToken: serverActionToken,
      message: `Unerwarteter Serverfehler: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken.substring(0,8)}) (Code: CBA-GUEH)`,
      errors: { global: [`Serverfehler: ${error.message}. Bitte Admin kontaktieren. (Code: CBA-GUEH-G-${serverActionToken.substring(0,4)})`] },
      bookingToken: null,
    };
  }
}


// Delete Bookings Action
export async function deleteBookingsAction(
  prevState: FormState, // Expect a FormState-like object, even if not fully used by useActionState here
  bookingIdsArg: string[]
): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[deleteBookingsAction(Action:${serverActionToken.substring(0,8)})]`;

  logSafe(actionContext + " BEGIN", { bookingIdsArg });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { success: false, message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: DBA-FNI)`, actionToken: serverActionToken };
  }

  // Ensure bookingIdsArg is treated as an array, even if called incorrectly
  const bookingIds = Array.isArray(bookingIdsArg) ? bookingIdsArg : [];
  const validBookingIds = bookingIds.filter(id => typeof id === 'string' && id.trim() !== '');

  if (validBookingIds.length === 0) {
    logSafe(`${actionContext} No valid booking IDs provided for deletion. Original input:`, { bookingIdsArg }, 'warn');
    return { success: false, message: "Keine gültigen Buchungs-IDs zum Löschen angegeben. (Code: DBA-NVID)", actionToken: serverActionToken };
  }

  try {
    const result = await deleteBookingsFromFirestoreByIds(validBookingIds);
    logSafe(`${actionContext} deleteBookingsFromFirestoreByIds result:`, { result });

    if (result.success) {
      revalidatePath("/admin/dashboard", "page");
      // No need to revalidate individual booking pages here as they are deleted.
    }
    return { ...result, actionToken: serverActionToken };
  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[${actionContext}] GLOBAL UNHANDLED EXCEPTION in deleteBookingsAction: ${error.message}`, error.stack);
    return {
        success: false,
        message: `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: DBA-GUEH)`,
        actionToken: serverActionToken
    };
  }
}
