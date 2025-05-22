
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, Mitreisender as MitreisenderData, RoomDetail } from "@/lib/definitions";
import {
  addBookingToFirestore,
  findBookingByTokenFromFirestore,
  findBookingByIdFromFirestore,
  updateBookingInFirestore,
  deleteBookingsFromFirestoreByIds,
} from "./mock-db"; // Now points to Firestore operations
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


// Helper for logging large/sensitive data
function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = "[Server Action LogSafe]";
    let simplifiedData;
    const maxLogLength = 15000; 
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
            if (value instanceof File) { return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }; }
            if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack ? value.stack.substring(0,400) + "...[TRUNCATED_STACK]" : "No stack" }; }
            if (typeof value === 'string' && value.length > 400 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) { return value.substring(0, 200) + "...[TRUNCATED_STRING_LOG]"; }
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 40 && !key.toLowerCase().includes('guestsubmitteddata')) { return "[TRUNCATED_OBJECT_LOG_TOO_MANY_KEYS]"; }
            if ((key.toLowerCase().includes('url') || key.toLowerCase().includes('datauri')) && typeof value === 'string' && value.startsWith('data:image')) { return value.substring(0,150) + "...[TRUNCATED_DATA_URI_LOG]";}
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


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | string | undefined> | null;
  success?: boolean;
  actionToken?: string | undefined;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number; // 0-indexed
  bookingToken?: string | null;
};

const initialFormState: FormState = { message: null, errors: null, success: false, actionToken: undefined, updatedGuestData: null, bookingToken: null, currentStep: -1 };

function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function convertTimestampsInGuestData(data?: GuestSubmittedData | null): GuestSubmittedData | null | undefined {
  if (!data) return data;
  // Defensive deep copy to avoid mutating the original object from Firestore cache
  const newGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(data)); 

  const processTimestampField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
      if (obj[field] instanceof Timestamp) { 
        obj[field] = obj[field].toDate().toISOString();
      } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
        // This handles cases where Firestore Timestamps might be passed around as plain objects
        // before being fully converted by Firestore SDK, or if they come from a non-Firestore source
        // that mimics Timestamps.
        obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
      } else if (obj[field] instanceof Date) {
        obj[field] = obj[field].toISOString();
      }
      // If it's already an ISO string, do nothing.
    }
  };

  const dateFieldsInGuestData: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
  for (const field of dateFieldsInGuestData) {
    processTimestampField(newGuestData, field as string);
  }
  return newGuestData;
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE_BYTES, { message: `Maximale Dateigröße ist ${MAX_FILE_SIZE_MB}MB.`})
  .refine(
    (file) => !file || file.size === 0 || ACCEPTED_FILE_TYPES.includes(file.type),
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

// Helper function to update booking and handle guest submitted data, including file uploads
async function updateBookingStep(
  forActionToken: string,
  bookingId: string,
  stepNumber: number, 
  stepName: string, 
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `[updateBookingStep(BookingID:${bookingId}, Step:${stepNumber}-${stepName}, ActionToken:${forActionToken.substring(0,8)})]`;
  const startTime = Date.now();
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;
  let bookingDoc: Booking | null = null; // To store the fetched booking document
  const formErrors: Record<string, string[]> = {}; // To accumulate Zod and custom file errors

  logSafe(`${actionContext} BEGIN`, { 
    formDataKeys: Array.from(formData.keys()), 
    additionalDataToMergeKeys: additionalDataToMerge ? Object.keys(additionalDataToMerge) : 'N/A' 
  });
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
    return {
      message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. Bitte Admin kontaktieren. (Details: ${initErrorMsg}) (Aktions-ID: ${forActionToken}) (Code: UBS-FNI)`,
      errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI-G)`] },
      success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
    };
  }

  // --- Global try-catch for updateBookingStep ---
  try {
    bookingDoc = await findBookingByIdFromFirestore(bookingId); // Fetch booking by ID
    if (!bookingDoc) {
      logSafe(`${actionContext} FAIL - Booking NOT FOUND with ID:`, { bookingId }, 'warn');
      return {
        message: `Buchung mit ID ${bookingId} nicht gefunden. (Code: UBS-BNF-${forActionToken.substring(0,4)})`,
        errors: { global: [`Buchung nicht gefunden. (Aktions-ID: ${forActionToken}) (Code: UBS-BNF-G)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
      };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }));
    logSafe(`${actionContext} Current guest data snapshot fetched`, { lastCompletedStep: currentGuestDataSnapshot.lastCompletedStep });

    const rawFormData = Object.fromEntries(formData.entries());
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const zodErrors = validatedFields.error.flatten().fieldErrors;
      for (const key in zodErrors) {
          if (zodErrors[key]) formErrors[key] = zodErrors[key]!;
      }
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors, rawFormDataKeys: Object.keys(rawFormData) }, 'warn');
      return {
          message: "Validierungsfehler. Bitte Eingaben prüfen. (Code: UBS-ZVF)", errors: formErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot) // Return old data on validation fail
      };
    }
    const dataFromForm = validatedFields.data;
    logSafe(`${actionContext} Zod Validation SUCCESSFUL. Data keys from form:`, { keys: Object.keys(dataFromForm) });

    // Initialize updatedGuestData with a deep copy of the current state from Firestore
    let updatedGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(currentGuestDataSnapshot));
    
    // Merge additional data first (e.g., zahlungsart, zahlungsbetrag from step 3 selection)
    if (additionalDataToMerge) {
        updatedGuestData = { ...updatedGuestData, ...additionalDataToMerge };
    }
    
    // Merge data from the current form step (non-file fields)
    const formKeys = Object.keys(dataFromForm);
    for (const key of formKeys) {
        // Only merge non-file fields here; files are handled separately
        if (!(dataFromForm[key] instanceof File)) {
            (updatedGuestData as any)[key] = dataFromForm[key];
        }
    }
    
    const fileFieldsConfig: Array<{
      formDataKey: string; 
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
    }> = [];

    // Define which file fields are relevant for the current step
    if (stepName === "Hauptgast & Ausweis") {
        fileFieldsConfig.push(
            { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl' },
            { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl' }
        );
    } else if (stepName === "Mitreisende" && dataFromForm.mitreisendeMeta) {
      try {
          const mitreisendeMetaParsed = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id: string}[];
          mitreisendeMetaParsed.forEach((mitreisenderClient) => {
              if (mitreisenderClient.id) {
                  fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl'});
                  fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl'});
              }
          });
      } catch(e: any) {
          const err = e instanceof Error ? e : new Error(String(e));
          logSafe(`${actionContext} WARN: Failed to parse mitreisendeMeta for file config.`, { error: err.message, meta: dataFromForm.mitreisendeMeta }, 'warn');
          formErrors['mitreisendeMeta'] = ['Fehler beim Verarbeiten der Mitreisenden-Metadaten. (Code: UBS-MPM)'];
          // Potentially return error here if this is critical
      }
    } else if (stepName === "Zahlungsinfo") {
        fileFieldsConfig.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl' });
    }

    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsConfig.length });

    for (const config of fileFieldsConfig) {
      const file = rawFormData[config.formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined | null = null;
      
      // Get old URL from the most up-to-date snapshot (bookingDoc) before any local changes
      const snapshotForOldUrl = bookingDoc.guestSubmittedData || { lastCompletedStep: -1 };
      if (config.mitreisenderId && config.mitreisenderUrlKey && snapshotForOldUrl?.mitreisende) {
          const companion = snapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (snapshotForOldUrl as any)?.[config.guestDataUrlKey];
      }

      // --- Individual try-catch for each file operation ---
      try {
        if (file instanceof File && file.size > 0) {
          const originalFileName = file.name;

          if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === "") {
              const errorMsg = `Datei für Feld ${config.formDataKey} hat einen ungültigen oder leeren Namen. (Code: UBS-IFN)`;
              logSafe(`${actionContext} WARN: Skipping file for ${config.formDataKey} due to invalid name. Original name: "${originalFileName}"`, { originalFileName }, 'warn');
              formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), errorMsg];
              continue; // Skip this file, process next
          }

          logSafe(`${actionContext} Processing NEW file for ${config.formDataKey}: "${originalFileName}" (Size: ${file.size}, Type: ${file.type}). Old URL: ${oldFileUrl ? String(oldFileUrl).substring(0, 80) + '...' : 'N/A'}`);
          
          let arrayBuffer: ArrayBuffer;
          try {
              const bufferStartTime = Date.now();
              arrayBuffer = await file.arrayBuffer();
              logSafe(`${actionContext} ArrayBuffer for "${originalFileName}" (Size: ${arrayBuffer.byteLength}) read in ${Date.now() - bufferStartTime}ms`);
          } catch (bufferError: any) {
              const err = bufferError instanceof Error ? bufferError : new Error(String(bufferError));
              const errorMsg = `Fehler beim Lesen der Datei "${originalFileName}": ${err.message} (Code: UBS-FBF)`;
              logSafe(`${actionContext} FILE BUFFER FAIL for "${originalFileName}"`, { errorName: err.name, errorMessage: err.message }, 'error');
              formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), errorMsg];
              continue; // Skip this file
          }

          // Delete old file from Firebase Storage if it exists
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
                // Don't add to formErrors here, as it's not a user input error for the NEW file.
              }
            }
          }

          let downloadURL: string | undefined;
          try {
              const cleanedFileName = originalFileName.replace(/[^a-zA-Z0-9_.\-]/g, '_');
              const uniqueFileName = `${Date.now()}_${cleanedFileName}`;
              let filePathPrefix = `bookings/${bookingDoc.bookingToken}`; // Use bookingDoc for consistent token

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
              formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), userMessage];
              continue; // Skip this file
          }

          // If upload successful, update the URL in our working updatedGuestData object
          if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey) {
                if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (companion) { (companion as any)[config.mitreisenderUrlKey] = downloadURL; }
                else { 
                    // This case should ideally not happen if mitreisendeMeta is processed correctly first
                    logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} not found in updatedGuestData.mitreisende for URL assignment. This can happen if mitreisendeMeta processing failed or Mitreisender was removed client-side but file was still submitted.`, {}, 'warn'); 
                }
            } else if (config.guestDataUrlKey) { (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL; }
          }
        } else if (file instanceof File && file.size === 0 && rawFormData[config.formDataKey]) {
             // Handle case where user explicitly cleared a file input (file field present but empty)
             logSafe(`${actionContext} File field ${config.formDataKey} submitted empty/cleared. Old URL was: ${oldFileUrl ? String(oldFileUrl).substring(0, 80) + '...' : 'N/A'}`);
             // Clear the URL in our working updatedGuestData
             if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                  let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                  if (companion) { (companion as any)[config.mitreisenderUrlKey] = undefined; }
             } else if (config.guestDataUrlKey) {
                  (updatedGuestData as any)[config.guestDataUrlKey] = undefined;
             }
             // Delete old file from Firebase Storage
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
        } else if (oldFileUrl && typeof oldFileUrl === 'string') { 
            // No new file submitted, and an old URL exists, so retain it in updatedGuestData.
            // This ensures that if a field was not touched, its existing value from Firestore is preserved.
            // This logic is implicitly handled by initially copying currentGuestDataSnapshot to updatedGuestData,
            // and only overwriting with new URLs if a new file is successfully uploaded.
            // No explicit action needed here if oldFileUrl should be kept and no new file was provided.
        }
      } catch (fileProcessingError: any) {
        // Catch-all for any unexpected error during this specific file's processing
        const err = fileProcessingError instanceof Error ? fileProcessingError : new Error(String(fileProcessingError));
        const errorMsg = `Unerwarteter Fehler bei Verarbeitung von Datei für Feld ${config.formDataKey}: ${err.message}`;
        logSafe(`${actionContext} UNEXPECTED FILE PROCESSING FAIL for ${config.formDataKey}`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,300) }, 'error');
        formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), errorMsg];
        // Continue to next file if possible
      }
    } // End of for...of fileFieldsConfig loop

    logSafe(actionContext + " File processing END", { formErrorsCount: Object.keys(formErrors).length });

    // If there were any file processing errors, return them
    if (Object.keys(formErrors).length > 0) {
        logSafe(`${actionContext} Returning due to file processing errors.`, { errors: formErrors });
        return {
            message: "Einige Dateien konnten nicht verarbeitet werden. (Code: UBS-FPE)",
            errors: formErrors, success: false, actionToken: forActionToken,
            currentStep: stepNumber - 1,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), // Return snapshot before errors
        };
    }

    // Process mitreisendeMeta if it's the "Mitreisende" step
    // This should happen *after* file uploads for mitreisende are processed, so URLs are part of updatedGuestData
    if (stepName === "Mitreisende" && dataFromForm.mitreisendeMeta) {
        try {
          const clientMitreisende = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id: string, vorname: string, nachname: string}[];
          const serverMitreisende: MitreisenderData[] = [];
          
          for (const cm of clientMitreisende) {
              // Find the companion in updatedGuestData to get their potentially updated URLs
              const existingOrFileProcessedCompanion = updatedGuestData.mitreisende?.find(sm => sm.id === cm.id);
              serverMitreisende.push({
                  id: cm.id, 
                  vorname: cm.vorname || '',
                  nachname: cm.nachname || '',
                  // Use URLs from updatedGuestData which now includes newly uploaded file URLs
                  ausweisVorderseiteUrl: existingOrFileProcessedCompanion?.ausweisVorderseiteUrl, 
                  ausweisRückseiteUrl: existingOrFileProcessedCompanion?.ausweisRückseiteUrl, 
              });
          }
          updatedGuestData.mitreisende = serverMitreisende;
          logSafe(`${actionContext} Processed mitreisendeMeta. Resulting count: ${serverMitreisende.length}`);
        } catch(e: any) {
            const err = e instanceof Error ? e : new Error(String(e));
            logSafe(`${actionContext} WARN: Failed to process mitreisendeMeta.`, { error: err.message, meta: dataFromForm.mitreisendeMeta }, 'warn');
            // Add error to formErrors and return
            formErrors['mitreisendeMeta'] = ['Fehler beim Verarbeiten der Mitreisenden-Daten. (Code: UBS-MPM2)'];
             return {
                message: "Fehler beim Verarbeiten der Mitreisenden-Daten. (Code: UBS-MPM2-MSG)",
                errors: formErrors, success: false, actionToken: forActionToken,
                currentStep: stepNumber - 1,
                updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), // Return snapshot before error
            };
        }
        delete (updatedGuestData as any).mitreisendeMeta; // Clean up meta field
    }

    // Update lastCompletedStep: stepNumber is 1-indexed, lastCompletedStep is 0-indexed
    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1);
    logSafe(`${actionContext} Updated lastCompletedStep to: ${updatedGuestData.lastCompletedStep}`);

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") { 
      // Zod schema already ensures these are booleans if present
      const agbAkzeptiert = dataFromForm.agbAkzeptiert === true;
      const datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true;

      updatedGuestData.agbAkzeptiert = agbAkzeptiert;
      updatedGuestData.datenschutzAkzeptiert = datenschutzAkzeptiert;
      logSafe(`${actionContext} Consent values: AGB=${agbAkzeptiert}, Datenschutz=${datenschutzAkzeptiert}`);

      if (agbAkzeptiert && datenschutzAkzeptiert) {
        updatedGuestData.submittedAt = Timestamp.now(); // Use Firestore Timestamp for writing
        bookingStatusUpdate.status = "Confirmed";
        logSafe(`${actionContext} Consent given, setting status to Confirmed and submittedAt.`);
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(!agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        logSafe(`${actionContext} Consent Error`, { errors: consentErrors });
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert. (Code: UBS-CE)", errors: { ...formErrors, ...consentErrors },
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          // Return updatedGuestData as it is, as it contains data from current form attempt
          updatedGuestData: convertTimestampsInGuestData(updatedGuestData), 
        };
      }
    }
    
    // Prepare the final data to be written to Firestore.
    // Only include guestSubmittedData and status if it's being updated.
    const bookingUpdatesFirestore: Partial<Booking> = {
        guestSubmittedData: updatedGuestData, 
        ...(bookingStatusUpdate.status && { status: bookingStatusUpdate.status })
    };
    
    // If Hauptgast & Ausweis step, and name changed, update top-level guest name on Booking
    if (stepName === "Hauptgast & Ausweis" && dataFromForm.gastVorname && dataFromForm.gastNachname && bookingDoc) {
        if(bookingDoc.guestFirstName !== dataFromForm.gastVorname || bookingDoc.guestLastName !== dataFromForm.gastNachname) {
            bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname as string;
            bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname as string;
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
            currentStep: stepNumber - 1,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), // Revert to snapshot before attempt
        };
    }

    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    // Crucial: Return the fully updated guest data (with converted timestamps) to the client
    const finalUpdatedGuestData = convertTimestampsInGuestData(updatedGuestData);
    logSafe(`${actionContext} SUCCESS - Step ${stepNumber} processed.`, { finalMessage: message });
    return {
        message, errors: null, success: true, actionToken: forActionToken,
        updatedGuestData: finalUpdatedGuestData, // Send the latest state
        currentStep: stepNumber -1 // lastCompletedStep is 0-indexed
    };

  // --- Global catch for updateBookingStep ---
  } catch (error: any) { 
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,1200) }, 'error');
    const guestDataForErrorState = currentGuestDataSnapshot ? convertTimestampsInGuestData(currentGuestDataSnapshot) : (bookingDoc?.guestSubmittedData ? convertTimestampsInGuestData(bookingDoc.guestSubmittedData) : null);
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${err.message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-GUEH)`,
        errors: { global: [`Serverfehler (Schritt ${stepName}): ${err.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support. (Code: UBS-GUEH-G)`] },
        success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: guestDataForErrorState,
    };
  } finally {
     logSafe(`${actionContext} END. Total time: ${Date.now() - startTime}ms.`);
  }
}


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
  // anmerkungenGast: z.string().optional(), // Already part of GuestSubmittedData, not specific to this step's direct schema
});

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken(); // Use this for unique action tracking
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
    // Pass booking.id instead of bookingToken to updateBookingStep, as it expects Firestore document ID
    return await updateBookingStep(serverActionToken, booking.id, 1, "Hauptgast & Ausweis", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-GUEH)`, errors: { global: [`Serverfehler (Stammdaten): ${err.message} (Code: SGA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

const mitreisenderClientSchema = z.object({
  id: z.string(), // Client-side ID for React keys
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
  // Optional: alter, ausweisVorderseiteUrl, ausweisRückseiteUrl - diese werden serverseitig aus den File-Uploads und anderen Daten gemerged
});

const mitreisendeStepSchema = z.object({
  // This meta field contains the structure of companions (name, nachname, client-side ID)
  // Files for companions are handled by their specific form field names (e.g., mitreisende_CLIENTID_ausweisVorderseiteFile)
  mitreisendeMeta: z.string().transform((str, ctx) => {
    if (!str || str.trim() === "") return []; // No companions submitted is valid
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta muss ein Array sein. (Code: UBS-MM-ARR)" });
        return z.NEVER; // Stop validation
      }
      // Validate each object in the array against the client schema
      const result = z.array(mitreisenderClientSchema).safeParse(parsed);
      if (!result.success) {
        // Aggregate specific errors from array items
        const fieldErrors = result.error.flatten().fieldErrors;
        let errorMessages: string[] = [];
        // fieldErrors might look like: { "0.vorname": ["Error message"], "1.nachname": ["Another error"] }
        // We need to format this nicely.
        result.error.issues.forEach(issue => {
            const path = issue.path.join('.');
            errorMessages.push(`Mitreisender (Pfad ${path}): ${issue.message}`);
        });
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehler in Mitreisenden-Daten: " + errorMessages.join('; ') + " (Code: UBS-MM-FLD)" });
        return z.NEVER; // Stop validation
      }
      return result.data; // Return validated array of {id, vorname, nachname}
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON. (Code: UBS-MM-JSON)" });
      return z.NEVER; // Stop validation
    }
  }).optional().default([]), 
  // Use catchall for dynamic file fields like mitreisende_XYZ_ausweisVorderseiteFile
}).catchall(fileSchema); 

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1, // Assume step 1 is Mitreisende if 0-indexed
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

const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(["downpayment", "full_amount"], { required_error: "Auswahl der Zahlungssumme ist erforderlich." }),
});
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `[submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2, // Assume step 2
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SPASA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SPASA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    const rawFormData = Object.fromEntries(formData.entries());
    const selectedAmount = rawFormData.paymentAmountSelection as "downpayment" | "full_amount";
    let zahlungsbetrag;
    if (selectedAmount === 'downpayment') { zahlungsbetrag = parseFloat(((booking.price || 0) * 0.3).toFixed(2)); }
    else { zahlungsbetrag = booking.price || 0; }
    
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag } as Partial<GuestSubmittedData>;
    // Pass booking.id
    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-GUEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${err.message} (Code: SPASA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

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
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3, // Assume step 3
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SZIA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }

  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SZIA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
    }
    // Pass booking.id
    return await updateBookingStep(serverActionToken, booking.id, 4, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now() });
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-GUEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${err.message} (Code: SZIA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

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
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4, // Assume step 4
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SEBA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }

  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SEBA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
    }
    // Pass booking.id
    return await updateBookingStep(serverActionToken, booking.id, 5, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-GUEH)`, errors: { global: [`Serverfehler (Bestätigung): ${err.message} (Code: SEBA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

const RoomSchema = z.object({
  // id is client-side only, not part of the data to be saved for a room
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich.").default('Standard'),
  erwachsene: z.coerce.number({invalid_type_error: "Anzahl Erwachsene muss eine Zahl sein."}).int().min(0, "Anzahl Erwachsene darf nicht negativ sein.").default(1),
  kinder: z.coerce.number({invalid_type_error: "Anzahl Kinder muss eine Zahl sein."}).int().min(0, "Anzahl Kinder darf nicht negativ sein.").optional().default(0),
  kleinkinder: z.coerce.number({invalid_type_error: "Anzahl Kleinkinder muss eine Zahl sein."}).int().min(0, "Anzahl Kleinkinder darf nicht negativ sein.").optional().default(0),
  alterKinder: z.string().optional().default(''),
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
  interneBemerkungen: z.string().optional().default(''),
  roomsData: z.string({ required_error: "Zimmerdaten sind erforderlich." })
    .min(1, "Zimmerdaten String darf nicht leer sein. (Code: CBA-RD-EMPTYSTR)")
    .pipe(
      z.string().transform((str, ctx) => {
        try {
          const parsed = JSON.parse(str);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mindestens ein Zimmer muss hinzugefügt werden (Array-Prüfung). (Code: CBA-RD-NOZ)" });
            return z.NEVER;
          }
          return parsed;
        } catch (e: any) {
          const err = e instanceof Error ? e : new Error(String(e));
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Die Zimmerdaten sind nicht im korrekten JSON-Format: ${err.message} (Code: CBA-RD-JSON)` });
          return z.NEVER;
        }
      }).pipe(
        z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden (Zod-Array-Prüfung). (Code: CBA-RD-MIN1)")
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
  path: ["dateRange"], // Path for form-level error if using react-hook-form
});

export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[createBookingAction(Action:${serverActionToken.substring(0,8)})]`;
  const startTime = Date.now();

  // Debug: Log all incoming FormData keys
  console.log(`${actionContext} Incoming FormData keys:`, Array.from(formData.keys()));

  if (!firebaseInitializedCorrectly || !db) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db }, 'error');
    return {
        ...initialFormState, success: false, actionToken: serverActionToken,
        message: `Serverfehler: Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL). Details: ${initErrorMsg}. Bitte Admin kontaktieren und Server-Logs prüfen.`,
        errors: { global: [`Firebase Initialisierungsfehler. (Code: CBA-FNI-${serverActionToken.substring(0,4)})`] },
    };
  }
  
  try {
    // --- Defensive pre-validation of critical FormData fields ---
    const rawRoomsData = formData.get("roomsData");
    if (typeof rawRoomsData !== "string" || rawRoomsData.trim() === "") {
      logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' fehlt, ist kein String oder ist leer.`, {rawRoomsData}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, message: "Fehler: Zimmerdaten fehlen oder sind ungültig. (Code: CBA-PRE-RD-STR)", errors: { roomsData: ["Zimmerdaten sind erforderlich."] } };
    }

    let parsedRooms;
    try {
      parsedRooms = JSON.parse(rawRoomsData);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' ist kein gültiges JSON.`, {rawRoomsData, error: err.message}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, message: `Fehler: Zimmerdaten sind kein gültiges JSON. ${err.message} (Code: CBA-PRE-RD-JSON)`, errors: { roomsData: ["Ungültiges Format der Zimmerdaten."] } };
    }

    if (!Array.isArray(parsedRooms)) {
      logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' (geparst) ist kein Array.`, {parsedRooms}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, message: "Fehler: Zimmerdaten sind kein Array. (Code: CBA-PRE-RD-ARR)", errors: { roomsData: ["Zimmerdaten müssen ein Array sein."] } };
    }
    if (parsedRooms.length === 0) {
      logSafe(`${actionContext} Pre-validation FAIL: 'roomsData' Array ist leer.`, {parsedRooms}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, message: "Fehler: Es muss mindestens ein Zimmer angegeben werden. (Code: CBA-PRE-RD-EMPTYARR)", errors: { roomsData: ["Mindestens ein Zimmer ist erforderlich."] } };
    }

    const rawCheckInDate = formData.get("checkInDate");
    if (!rawCheckInDate || typeof rawCheckInDate !== 'string' || rawCheckInDate.trim() === '') {
      logSafe(`${actionContext} Pre-validation FAIL: 'checkInDate' fehlt oder ist leer.`, {rawCheckInDate}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, message: "Fehler: Anreisedatum ist erforderlich. (Code: CBA-PRE-CID)", errors: { checkInDate: ["Anreisedatum ist erforderlich."] } };
    }
    const rawCheckOutDate = formData.get("checkOutDate");
    if (!rawCheckOutDate || typeof rawCheckOutDate !== 'string' || rawCheckOutDate.trim() === '') {
      logSafe(`${actionContext} Pre-validation FAIL: 'checkOutDate' fehlt oder ist leer.`, {rawCheckOutDate}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, message: "Fehler: Abreisedatum ist erforderlich. (Code: CBA-PRE-COD)", errors: { checkOutDate: ["Abreisedatum ist erforderlich."] } };
    }

    // Prepare data for Zod validation
    const rawFormDataForZod: {[k: string]: any} = {};
    const expectedFields = ["guestFirstName", "guestLastName", "price", "checkInDate", "checkOutDate", "verpflegung", "interneBemerkungen", "roomsData"];
    for (const key of formData.keys()) {
        if (expectedFields.includes(key)) {
             rawFormDataForZod[key] = formData.get(key);
        }
    }
    // Ensure roomsData is passed as a string to Zod as the schema expects to parse it
    rawFormDataForZod.roomsData = rawRoomsData; 


    logSafe(actionContext + " Raw form data prepared for Zod validation (after pre-checks):", {
        guestFirstName: rawFormDataForZod.guestFirstName,
        price: rawFormDataForZod.price,
        checkInDate: rawFormDataForZod.checkInDate,
        roomsDataStringLength: typeof rawFormDataForZod.roomsData === 'string' ? rawFormDataForZod.roomsData.length : 'N/A',
    });

    const validatedFields = createBookingServerSchema.safeParse(rawFormDataForZod);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      const formErrorsFromZod = validatedFields.error.flatten().formErrors;
      const allErrors = {...fieldErrors, ...(formErrorsFromZod.length > 0 && { global: formErrorsFromZod })};
      logSafe(actionContext + " Zod Validation FAILED", { errors: allErrors }, 'warn');
      
      const errorMessagesList: string[] = [];
      Object.entries(allErrors).forEach(([key, messages]) => {
        if (messages && Array.isArray(messages)) {
          errorMessagesList.push(`${key}: ${messages.join(', ')}`);
        } else if (messages) {
          errorMessagesList.push(`${key}: ${String(messages)}`);
        }
      });
      const errorMessage = errorMessagesList.length > 0 ? errorMessagesList.join('; ') : "Unbekannter Validierungsfehler.";

      return {
        ...initialFormState, success: false, actionToken: serverActionToken,
        message: `Fehler bei der Validierung: ${errorMessage} (Code: CBA-ZOD-VAL-${serverActionToken.substring(0,4)})`,
        errors: allErrors,
      };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Zod Validation SUCCESSFUL. Validated bookingData types and values:", {
      guestFirstName: `${typeof bookingData.guestFirstName} - "${bookingData.guestFirstName}"`,
      guestLastName: `${typeof bookingData.guestLastName} - "${bookingData.guestLastName}"`,
      interneBemerkungen: `Typ: ${typeof bookingData.interneBemerkungen}, Wert: "${String(bookingData.interneBemerkungen || '')}"`,
      roomsDataIsArray: Array.isArray(bookingData.roomsData),
      roomsDataLength: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'N/A',
    });
     
    // Defensive check for roomsData structure after Zod (should be guaranteed by Zod's .pipe)
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const errMsg = "Fehler: Nach Zod-Validierung sind keine gültigen Zimmerdaten vorhanden. Mindestens ein Zimmer ist erforderlich.";
        logSafe(actionContext + " FAIL - bookingData.roomsData is not a valid array or is empty AFTER Zod parsing. This should not happen if Zod schema is correct.", { roomsData: bookingData.roomsData }, 'error');
        return {
            ...initialFormState, success: false, actionToken: serverActionToken,
            message: errMsg + ` (Code: CBA-RD-POST-ZOD-EMPTY-${serverActionToken.substring(0,4)})`, errors: { roomsData: [errMsg] },
        };
    }
    
    bookingData.roomsData.forEach((room, index) => {
        logSafe(actionContext + ` Validated Room ${index} details from Zod:`, {
            zimmertyp: `Typ: ${typeof room.zimmertyp}, Wert: "${String(room.zimmertyp || 'Standard')}"`,
            erwachsene: `Typ: ${typeof room.erwachsene}, Wert: ${Number(room.erwachsene || 0)}`,
            alterKinder: `Typ: ${typeof room.alterKinder}, Wert: "${String(room.alterKinder || '')}"`,
        });
    });
    
    const firstRoom = bookingData.roomsData[0]; // Safe to access due to previous checks
    const zimmertypForIdentifier = String(firstRoom.zimmertyp || 'Standard');
    let personenSummary = `${Number(firstRoom.erwachsene || 0)} Erw.`;
    if (Number(firstRoom.kinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kinder || 0)} Ki.`;
    if (Number(firstRoom.kleinkinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kleinkinder || 0)} Kk.`;
    const roomIdentifierString = `${zimmertypForIdentifier} (${personenSummary})`;

    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || ''); // Ensure string
    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'Standard'), // Ensure string
        erwachsene: Number(room.erwachsene || 0),     // Ensure number
        kinder: Number(room.kinder || 0),           // Ensure number
        kleinkinder: Number(room.kleinkinder || 0),   // Ensure number
        alterKinder: String(room.alterKinder || ''),  // Ensure string
    }));

    const newBookingToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const newBookingPayload: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> = {
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: new Date(bookingData.checkInDate), 
      checkOutDate: new Date(bookingData.checkOutDate), 
      bookingToken: newBookingToken,
      status: "Pending Guest Information", 
      verpflegung: String(bookingData.verpflegung || 'ohne'), // Ensure string
      rooms: finalRoomsData,
      interneBemerkungen: finalInterneBemerkungen,
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 } 
    };
    
    logSafe(actionContext + " Attempting to add booking to Firestore. Payload (first room for brevity):", {
        ...newBookingPayload,
        checkInDate: newBookingPayload.checkInDate?.toISOString(), 
        checkOutDate: newBookingPayload.checkOutDate?.toISOString(), 
        rooms: newBookingPayload.rooms ? [newBookingPayload.rooms[0]] : "No rooms", 
    });
    
    let createdBookingId: string | null = null;
    try {
        createdBookingId = await addBookingToFirestore(newBookingPayload);
    } catch (dbError: any) {
        const err = dbError instanceof Error ? dbError : new Error(String(dbError));
        logSafe(`${actionContext} FAIL - addBookingToFirestore threw an error.`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,800) }, 'error');
        return {
            ...initialFormState, success: false, actionToken: serverActionToken,
            message: `Datenbankfehler beim Erstellen der Buchung: ${err.message}. (Code: CBA-DBF-ADD-${serverActionToken.substring(0,4)})`, 
            errors: { global: [`Fehler beim Speichern der Buchung: ${err.message}`] },
        };
    }

    if (!createdBookingId) {
      const errorMsg = `Datenbankfehler: Buchung konnte nicht erstellt werden (keine ID zurückgegeben). (Code: CBA-DBF-NOID-${serverActionToken.substring(0,4)})`;
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null or empty ID.`, {}, 'error');
      return {
        ...initialFormState, success: false, actionToken: serverActionToken,
        message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] },
      };
    }
    logSafe(`${actionContext} SUCCESS - New booking. Token: ${newBookingToken}. ID: ${createdBookingId}. Time: ${Date.now() - startTime}ms.`);
    revalidatePath("/admin/dashboard", "page");
    revalidatePath(`/admin/bookings/${createdBookingId}`, "page");
    revalidatePath(`/buchung/${newBookingToken}`, "page"); 
    
    return {
      ...initialFormState, success: true, actionToken: serverActionToken,
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      bookingToken: newBookingToken,
    };
  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    // This is the outermost catch, should ideally not be reached if inner catches are good.
    logSafe(actionContext + " GLOBAL UNHANDLED EXCEPTION in createBookingAction", { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,1500) }, 'error');
    return {
      ...initialFormState, success: false, actionToken: serverActionToken,
      message: `Unerwarteter Serverfehler: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: CBA-GUEH)`,
      errors: { global: [`Serverfehler: ${error.message}. Bitte Admin kontaktieren. (Code: CBA-GUEH-G-${serverActionToken.substring(0,4)})`] },
    };
  }
}

export async function deleteBookingsAction(
  prevState: { success: boolean; message: string; actionToken?: string | undefined },
  bookingIds: string[]
): Promise<{ success: boolean; message: string; actionToken: string }> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[deleteBookingsAction(Action:${serverActionToken.substring(0,8)})]`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { success: false, message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: DBA-FNI)`, actionToken: serverActionToken };
  }
  
  // Ensure bookingIds is an array before filtering
  const validBookingIds = Array.isArray(bookingIds) 
    ? bookingIds.filter(id => typeof id === 'string' && id.trim() !== '') 
    : [];
  
  logSafe(actionContext + " BEGIN", { receivedCount: Array.isArray(bookingIds) ? bookingIds.length : 'N/A', validCount: validBookingIds.length, idsToProcess: validBookingIds });

  if (validBookingIds.length === 0) {
    const originalInputType = Array.isArray(bookingIds) ? 'Array (empty or all invalid)' : typeof bookingIds;
    logSafe(`${actionContext} No valid booking IDs provided for deletion. Original input type: ${originalInputType}`, { bookingIds }, 'warn');
    return { success: false, message: "Keine gültigen Buchungs-IDs zum Löschen angegeben. (Code: DBA-NVID)", actionToken: serverActionToken };
  }

  try {
    const result = await deleteBookingsFromFirestoreByIds(validBookingIds);
    logSafe(`${actionContext} deleteBookingsFromFirestoreByIds result:`, { result });

    if (result.success) {
      revalidatePath("/admin/dashboard", "page");
      validBookingIds.forEach(id => { 
        revalidatePath(`/admin/bookings/${id}`, "page"); 
        // Revalidate guest page if token was associated (complex to get token here without more reads)
        // For simplicity, we might rely on users navigating away or a periodic refresh for guest links if one was active.
      });
    }
    return { ...result, actionToken: serverActionToken };
  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in deleteBookingsAction`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,800) }, 'error');
    // Ensure a structured response even for unexpected errors
    let errorMessage = "Ein unerwarteter Fehler ist beim Löschen aufgetreten.";
    if (error.message && typeof error.message === 'string' && error.message.includes("length")) { // Check if it's the 'length' error
        errorMessage = `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken})`;
    } else if (error.message) {
        errorMessage = `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken})`;
    }
    return { success: false, message: errorMessage + ` (Code: DBA-GUEH)`, actionToken: serverActionToken };
  }
}
    
    

    