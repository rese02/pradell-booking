
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
                     path: issue.path.join('.'),
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
  
  function logSafeStep(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = actionContext; 
    let simplifiedData;
    const maxLogLength = 2000; 
    const replacer = (key: string, value: any) => {
        if (value instanceof File) { return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }; }
        if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack ? value.stack.substring(0,300) + "...[TRUNCATED_STACK]" : "No stack" }; }
        if (typeof value === 'string' && value.length > 150 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) { return value.substring(0, 100) + "...[TRUNCATED_STRING_LOG]"; }
        if ((key.toLowerCase().includes('url') || key.toLowerCase().includes('datauri')) && typeof value === 'string' && value.startsWith('data:image')) { return value.substring(0,80) + "...[TRUNCATED_DATA_URI_LOG]";}
        if (key === 'arrayBuffer' && value instanceof ArrayBuffer) { return `[ArrayBuffer size: ${value.byteLength}]`;}
        return value;
    };
    try {
        simplifiedData = JSON.stringify(data, replacer, 2);
    } catch (e: any) {
        simplifiedData = `[Log data could not be stringified: ${(e instanceof Error ? e.message : String(e))}]`;
    }
    const logMessage = `${operationName} [${new Date().toISOString()}] ${context} ${simplifiedData.length > maxLogLength ? simplifiedData.substring(0, maxLogLength) + `...[LOG_TRUNCATED]` : simplifiedData}`;
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
  }

  logSafeStep(`BEGIN - Processing step.`, { formDataKeys: Array.from(formData.keys()), additionalDataToMergeKeys: additionalDataToMerge ? Object.keys(additionalDataToMerge) : 'N/A' });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafeStep(`FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
    return {
      message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. Bitte Admin kontaktieren. (Details: ${initErrorMsg}) (Aktions-ID: ${forActionToken}) (Code: UBS-FNI)`,
      errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI-G)`] },
      success: false, actionToken: forActionToken, currentStep: stepNumber, updatedGuestData: null
    };
  }

  let bookingDoc: Booking | null = null;
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;
  
  try { // Global try-catch for the entire step update logic
    logSafeStep(`Fetching booking document with ID: ${bookingId}`, {});
    bookingDoc = await findBookingByIdFromFirestore(bookingId);
    if (!bookingDoc) {
      logSafeStep(`FAIL - Booking NOT FOUND with ID:`, { bookingId }, 'error');
      return {
        message: `Buchung mit ID ${bookingId} nicht gefunden. (Code: UBS-BNF-${forActionToken.substring(0,4)})`,
        errors: { global: [`Buchung nicht gefunden. (Aktions-ID: ${forActionToken}) (Code: UBS-BNF-G)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber, updatedGuestData: null
      };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }));
    logSafeStep(`Current guest data snapshot fetched`, { lastCompletedStep: currentGuestDataSnapshot.lastCompletedStep });

    const rawFormData = Object.fromEntries(formData.entries());
    logSafeStep(`Raw form data for Zod validation:`, { keys: Object.keys(rawFormData) });
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const formErrors: Record<string, string[]> = {};
      const zodErrors = validatedFields.error.flatten().fieldErrors;
      for (const key in zodErrors) {
          if (zodErrors[key as keyof typeof zodErrors]) {
            formErrors[key] = zodErrors[key as keyof typeof zodErrors]!;
          }
      }
      logSafeStep(`Zod Validation FAILED`, { errors: formErrors, zodErrorDetails: validatedFields.error.issues, rawFormDataKeys: Object.keys(rawFormData) }, 'warn');
      return {
          message: "Validierungsfehler. Bitte Eingaben prüfen. (Code: UBS-ZVF)", errors: formErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber,
          updatedGuestData: convertTimestampsToISO(currentGuestDataSnapshot)
      };
    }
    const dataFromForm = validatedFields.data;
    logSafeStep(`Zod Validation SUCCESSFUL. Data keys from form:`, { keys: Object.keys(dataFromForm) });

    let updatedGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(currentGuestDataSnapshot));
    
    for (const key in dataFromForm) {
        if (!(dataFromForm[key] instanceof File) && key !== 'mitreisendeMeta' && key !== 'mitreisende') {
            (updatedGuestData as any)[key] = dataFromForm[key];
        }
    }
    if (additionalDataToMerge) {
        updatedGuestData = { ...updatedGuestData, ...additionalDataToMerge };
    }
    
    const formErrorsFromProcessing: Record<string, string[]> = {};

    const fileFieldsToProcess: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string; 
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
    }> = [];

    if (stepName === "Hauptgast & Ausweis") {
        fileFieldsToProcess.push(
            { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl' },
            { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl' }
        );
    } else if (stepName === "Mitreisende") {
      try {
          const mitreisendeMetaRaw = formData.get('mitreisendeMeta');
          const mitreisendeMetaParsed = typeof mitreisendeMetaRaw === 'string' && mitreisendeMetaRaw.trim() !== ""
            ? JSON.parse(mitreisendeMetaRaw)
            : [];

          (mitreisendeMetaParsed as Array<{id:string; vorname: string; nachname: string}>).forEach((mitreisenderClient) => {
              if (mitreisenderClient.id) {
                  logSafeStep(`Configuring file fields for companion ID: ${mitreisenderClient.id} (${mitreisenderClient.vorname} ${mitreisenderClient.nachname})`, {});
                  fileFieldsToProcess.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl'});
                  fileFieldsToProcess.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl'});
              }
          });
      } catch(e: any) {
          const err = e instanceof Error ? e : new Error(String(e));
          logSafeStep(`WARN: Failed to parse mitreisendeMeta for file config.`, { error: err.message, meta: formData.get('mitreisendeMeta') }, 'warn');
          if (!formErrorsFromProcessing.mitreisendeMeta) formErrorsFromProcessing.mitreisendeMeta = [];
          formErrorsFromProcessing.mitreisendeMeta.push("Fehler beim Verarbeiten der Mitreisenden-Daten für Datei-Uploads.");
      }
    } else if (stepName === "Zahlungsinfo") {
        fileFieldsToProcess.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl' });
    }

    logSafeStep("File processing START", { relevantFileFieldsCount: fileFieldsToProcess.length });

    for (const config of fileFieldsToProcess) {
      const file = rawFormData[config.formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined | null = null;
      
      const originalBookingSnapshotForOldUrl = bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }; 
      if (config.mitreisenderId && config.mitreisenderUrlKey && originalBookingSnapshotForOldUrl?.mitreisende) {
          const companion = originalBookingSnapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (originalBookingSnapshotForOldUrl as any)?.[config.guestDataUrlKey];
      }

      logSafeStep(`Processing file field: ${config.formDataKey}. File present: ${!!(file instanceof File && file.size > 0)}. Old URL: ${oldFileUrl ? String(oldFileUrl).substring(0, 80) + '...' : 'N/A'}`);

      if (file instanceof File && file.size > 0) {
        const originalFileName = file.name;

        if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === "") {
            const errorMsg = `Datei für Feld ${config.formDataKey} hat einen ungültigen oder leeren Namen. (Code: UBS-IFN)`;
            logSafeStep(`WARN: Skipping file for ${config.formDataKey} due to invalid name.`, { originalFileName }, 'warn');
            if (!formErrorsFromProcessing[config.formDataKey]) formErrorsFromProcessing[config.formDataKey] = [];
            formErrorsFromProcessing[config.formDataKey].push(errorMsg);
            continue;
        }
        
        let arrayBuffer: ArrayBuffer;
        try {
            const bufferStartTime = Date.now();
            arrayBuffer = await file.arrayBuffer();
            logSafeStep(`ArrayBuffer for "${originalFileName}" (Size: ${arrayBuffer.byteLength} B) read in ${Date.now() - bufferStartTime}ms`, { field: config.formDataKey});
        } catch (bufferError: any) {
            const err = bufferError instanceof Error ? bufferError : new Error(String(bufferError));
            const errorMsg = `Fehler beim Lesen der Datei "${originalFileName}" für Feld ${config.formDataKey}: ${err.message} (Code: UBS-FBF)`;
            logSafeStep(`FILE BUFFER FAIL for "${originalFileName}"`, { field: config.formDataKey, errorName: err.name, errorMessage: err.message }, 'error');
            if (!formErrorsFromProcessing[config.formDataKey]) formErrorsFromProcessing[config.formDataKey] = [];
            formErrorsFromProcessing[config.formDataKey].push(errorMsg);
            continue; 
        }

        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
            try {
                logSafeStep(`Attempting to delete OLD file from Storage: ${oldFileUrl} for ${config.formDataKey}.`);
                const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
                await deleteObject(oldFileStorageRefHandle);
                logSafeStep(`OLD file ${oldFileUrl} deleted from Storage for ${config.formDataKey}.`);
            } catch (deleteError: any) {
                const err = deleteError instanceof Error ? deleteError : new Error(String(deleteError));
                const fbErrorCode = (err as any)?.code;
                if (fbErrorCode === 'storage/object-not-found') {
                    logSafeStep(`WARN: Old file for ${config.formDataKey} not found in Storage, skipping deletion. URL: ${oldFileUrl}`, {}, 'warn');
                } else {
                    logSafeStep(`WARN: Failed to delete OLD file for ${config.formDataKey} from Storage. URL: ${oldFileUrl}. Code: ${fbErrorCode}`, { errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'warn');
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
                filePathPrefix += `/other_uploads/${config.formDataKey.replace('File', '')}`;
            }
            const filePath = `${filePathPrefix}/${uniqueFileName}`;

            logSafeStep(`Uploading "${originalFileName}" to Storage path: ${filePath}. Content-Type: ${file.type}`, { field: config.formDataKey});
            const fileStorageRefHandle = storageRefFB(storage, filePath);
            const uploadStartTime = Date.now();
            await uploadBytes(fileStorageRefHandle, arrayBuffer, { contentType: file.type });
            logSafeStep(`File "${originalFileName}" uploaded in ${Date.now() - uploadStartTime}ms`, { field: config.formDataKey});
          
            const getUrlStartTime = Date.now();
            downloadURL = await getDownloadURL(fileStorageRefHandle);
            logSafeStep(`Got download URL for "${originalFileName}" in ${Date.now() - getUrlStartTime}ms`, { urlPreview: downloadURL.substring(0,80)+'...', field: config.formDataKey});

        } catch (fileUploadError: any) {
            const err = fileUploadError instanceof Error ? fileUploadError : new Error(String(fileUploadError));
            let userMessage = `Dateiupload für "${originalFileName}" (${config.formDataKey}) fehlgeschlagen.`;
            const fbErrorCode = (err as any)?.code;
            logSafeStep(`FIREBASE STORAGE UPLOAD/GET_URL FAIL for "${originalFileName}"`, { field: config.formDataKey, errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'error');
            if (fbErrorCode === 'storage/unauthorized') userMessage = `Berechtigungsfehler: Upload für "${originalFileName}" verweigert. Firebase Storage Regeln prüfen. (Code: UBS-FSU-${forActionToken.substring(0,4)})`;
            else if (fbErrorCode === 'storage/canceled') userMessage = `Upload für "${originalFileName}" abgebrochen. Bitte erneut versuchen. (Code: UBS-FSC-${forActionToken.substring(0,4)})`;
            else if (fbErrorCode === 'storage/quota-exceeded') userMessage = `Speicherlimit überschritten beim Upload von "${originalFileName}". (Code: UBS-FSQ-${forActionToken.substring(0,4)})`;
            else userMessage += ` Details: ${err.message || "Unbekannter Upload-Fehler"}`;
            
            if (!formErrorsFromProcessing[config.formDataKey]) formErrorsFromProcessing[config.formDataKey] = [];
            formErrorsFromProcessing[config.formDataKey].push(userMessage);
            continue;
        }

        if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey) {
                if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (companion) { 
                    (companion as any)[config.mitreisenderUrlKey] = downloadURL; 
                    logSafeStep(`Assigned download URL to companion ${config.mitreisenderId}, field ${config.mitreisenderUrlKey}`, {});
                } else {
                  logSafeStep(`WARN: Companion with ID ${config.mitreisenderId} for file ${config.formDataKey} not found in updatedGuestData.mitreisende. File URL not assigned.`, { mitreisendeCount: updatedGuestData.mitreisende?.length || 0 }, 'warn');
                }
            } else if (config.guestDataUrlKey) { 
                (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL; 
                logSafeStep(`Assigned download URL to guestData field ${config.guestDataUrlKey}`, {});
            }
        }
      } else if (file instanceof File && file.size === 0 && rawFormData[config.formDataKey]) {
         logSafeStep(`File field ${config.formDataKey} submitted empty/cleared. Old URL was: ${oldFileUrl ? String(oldFileUrl).substring(0, 80) + '...' : 'N/A'}`);
         if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
           try {
             logSafeStep(`Attempting to delete OLD file from Storage due to empty submission for ${config.formDataKey}: ${oldFileUrl}`);
             const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
             await deleteObject(oldFileStorageRefHandle);
             logSafeStep(`OLD file ${oldFileUrl} deleted from Storage for ${config.formDataKey} (due to clearing).`);
           } catch (deleteError: any) {
              const err = deleteError instanceof Error ? deleteError : new Error(String(deleteError));
              const fbErrorCode = (err as any)?.code;
              if (fbErrorCode === 'storage/object-not-found') {
                logSafeStep(`WARN: Old file for ${config.formDataKey} not found in Storage (when clearing), skipping deletion. URL: ${oldFileUrl}`, {}, 'warn');
              } else {
                logSafeStep(`WARN: Failed to delete OLD file for ${config.formDataKey} from Storage (when clearing). URL: ${oldFileUrl}. Code: ${fbErrorCode}`, { errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'warn');
              }
           }
         }
         if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
              let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
              if (companion) { (companion as any)[config.mitreisenderUrlKey] = undefined; }
         } else if (config.guestDataUrlKey) {
              (updatedGuestData as any)[config.guestDataUrlKey] = undefined;
         }
      }
    }

    logSafeStep("File processing END", { fileProcessingErrorsCount: Object.keys(formErrorsFromProcessing).length });

    if (stepName === "Mitreisende") {
        try {
          const mitreisendeMetaRaw = formData.get('mitreisendeMeta');
          const clientMitreisende = typeof mitreisendeMetaRaw === 'string' && mitreisendeMetaRaw.trim() !== ""
            ? JSON.parse(mitreisendeMetaRaw)
            : [];
          
          const serverMitreisende: MitreisenderData[] = [];
          const existingOrFileProcessedCompanions = Array.isArray(updatedGuestData.mitreisende) ? [...updatedGuestData.mitreisende] : [];

          for (const cm of clientMitreisende as Array<{id:string; vorname: string; nachname: string}>) {
              const existingServerCompanion = existingOrFileProcessedCompanions.find(sm => sm.id === cm.id);
              serverMitreisende.push({
                  id: String(cm.id || generateActionToken()),
                  vorname: String(cm.vorname || ''),
                  nachname: String(cm.nachname || ''),
                  ausweisVorderseiteUrl: existingServerCompanion?.ausweisVorderseiteUrl,
                  ausweisRückseiteUrl: existingServerCompanion?.ausweisRückseiteUrl,
              });
          }
          updatedGuestData.mitreisende = serverMitreisende;
          logSafeStep(`Processed mitreisendeMeta. Resulting count: ${serverMitreisende.length}`, { serverMitreisende: serverMitreisende.map(m => ({id: m.id, name: m.vorname})) });
        } catch(e: any) {
            const err = e instanceof Error ? e : new Error(String(e));
            logSafeStep(`WARN: Failed to process mitreisendeMeta.`, { error: err.message, meta: formData.get('mitreisendeMeta') }, 'warn');
            if (!formErrorsFromProcessing.mitreisendeMeta) formErrorsFromProcessing.mitreisendeMeta = [];
            formErrorsFromProcessing.mitreisendeMeta.push("Fehler beim Verarbeiten der Mitreisenden-Daten.");
        }
    }

    if (Object.keys(formErrorsFromProcessing).length > 0) {
        logSafeStep(`Returning due to accumulated form errors (mostly file processing).`, { errors: formErrorsFromProcessing });
        return {
            message: "Einige Felder oder Dateien konnten nicht verarbeitet werden. Bitte prüfen Sie die Meldungen. (Code: UBS-FPE)",
            errors: formErrorsFromProcessing, success: false, actionToken: forActionToken,
            currentStep: stepNumber,
            updatedGuestData: convertTimestampsToISO(currentGuestDataSnapshot),
        };
    }

    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber);
    logSafeStep(`Updated lastCompletedStep to: ${updatedGuestData.lastCompletedStep}`);

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") { 
      const agbAkzeptiertRaw = formData.get("agbAkzeptiert");
      const datenschutzAkzeptiertRaw = formData.get("datenschutzAkzeptiert");
      const agbAkzeptiert = agbAkzeptiertRaw === "on" || agbAkzeptiertRaw === true;
      const datenschutzAkzeptiert = datenschutzAkzeptiertRaw === "on" || datenschutzAkzeptiertRaw === true;


      updatedGuestData.agbAkzeptiert = agbAkzeptiert;
      updatedGuestData.datenschutzAkzeptiert = datenschutzAkzeptiert;
      logSafeStep(`Consent values: AGB=${agbAkzeptiert}, Datenschutz=${datenschutzAkzeptiert}`);

      if (agbAkzeptiert && datenschutzAkzeptiert) {
        updatedGuestData.submittedAt = Timestamp.now(); 
        bookingStatusUpdate.status = "Confirmed";
        logSafeStep(`Consent given, setting status to Confirmed and submittedAt.`);
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(!agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        logSafeStep(`Consent Error`, { errors: consentErrors });
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert. (Code: UBS-CE)", errors: consentErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber,
          updatedGuestData: convertTimestampsToISO(updatedGuestData), 
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
            logSafeStep(`Hauptgast Name auf Buchung aktualisiert zu: ${newFirstName} ${newLastName}`);
        }
    }
    
    logSafeStep(`Attempting to update booking in Firestore. Path: ${bookingDoc.id!}. Update keys:`, {keys: Object.keys(bookingUpdatesFirestore)});
    const firestoreUpdateStartTime = Date.now();
    try {
      await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
      logSafeStep(`Firestore update successful in ${Date.now() - firestoreUpdateStartTime}ms.`);
    } catch (firestoreUpdateError: any) {
        const err = firestoreUpdateError instanceof Error ? firestoreUpdateError : new Error(String(firestoreUpdateError));
        logSafeStep(`FIRESTORE UPDATE FAIL`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
        return {
            message: `Fehler beim Speichern der Daten in Firestore: ${err.message}. (Aktions-ID: ${forActionToken}) (Code: UBS-FSUF)`,
            errors: { global: [`Datenbankfehler: ${err.message}. (Code: UBS-FSUF-G)`] },
            success: false, actionToken: forActionToken,
            currentStep: stepNumber,
            updatedGuestData: convertTimestampsToISO(currentGuestDataSnapshot),
        };
    }

    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${bookingDoc.id!}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber + 1} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    const finalUpdatedGuestDataForClient = convertTimestampsToISO(updatedGuestData);
    logSafeStep(`SUCCESS - Step ${stepNumber + 1} processed.`, { finalMessage: message });
    return {
        message, errors: null, success: true, actionToken: forActionToken,
        updatedGuestData: finalUpdatedGuestDataForClient,
        currentStep: stepNumber 
    };

  } catch (error: any) { 
    const err = error instanceof Error ? error : new Error(String(error));
    logSafeStep(`GLOBAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch (after bookingDoc fetch)`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,1200) }, 'error');
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${err.message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-GUEH)`,
        errors: { global: [`Serverfehler (Schritt ${stepName}): ${err.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support. (Code: UBS-GUEH-G)`] },
        success: false, actionToken: forActionToken,
        currentStep: stepNumber,
        updatedGuestData: currentGuestDataSnapshot ? convertTimestampsToISO(currentGuestDataSnapshot) : null,
    };
  } finally {
     logSafeStep(`END. Total time: ${Date.now() - startTime}ms.`);
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
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-GUEH)`, errors: { global: [`Serverfehler (Stammdaten): ${err.message} (Code: SGA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 2: Mitreisende ---
const mitreisenderClientSchema = z.object({
  id: z.string(), 
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
});

const mitreisendeStepSchema = z.object({
  mitreisendeMeta: z.preprocess(
    (val) => {
      if (typeof val === 'string' && val.trim() !== "") {
        try { 
          const parsed = JSON.parse(val);
          logSafe("[mitreisendeStepSchema] Parsed mitreisendeMeta:", parsed);
          return parsed;
        } catch (e) { 
          logSafe("[mitreisendeStepSchema] Error parsing mitreisendeMeta:", { error: (e as Error).message, value: val }, 'warn');
          return []; 
        }
      }
      return []; 
    },
    z.array(mitreisenderClientSchema).optional().default([])
  ),
}).catchall(fileSchema); 

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
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SMA-GUEH)`, errors: { global: [`Serverfehler (Mitreisende): ${err.message} (Code: SMA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag, paymentAmountSelection: selectedAmount } as Partial<GuestSubmittedData>;
    return await updateBookingStep(serverActionToken, booking.id, 2, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-GUEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${err.message} (Code: SPASA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now() });
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-GUEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${err.message} (Code: SZIA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-GUEH)`, errors: { global: [`Serverfehler (Bestätigung): ${err.message} (Code: SEBA-GUEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}


// --- Create Booking Dialog (Admin) ---
const RoomSchema = z.object({
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
  roomsData: z.string({ required_error: "Zimmerdaten (String) sind erforderlich.", invalid_type_error: "Zimmerdaten müssen als String übergeben werden." })
    .min(1, "Zimmerdaten String darf nicht leer sein. (Code: CBA-RD-EMPTYSTR)")
    .pipe(
      z.string().transform((str, ctx) => {
        try {
          const parsed = JSON.parse(str);
          logSafe("[createBookingServerSchema] roomsData parsed for Zod array validation:", parsed);
          return parsed;
        } catch (e: any) {
          const err = e instanceof Error ? e : new Error(String(e));
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Die Zimmerdaten sind nicht im korrekten JSON-Format: ${err.message} (Code: CBA-RD-JSON)` });
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
  
  // --- Defensive pre-checks for critical formData fields ---
  const rawCheckInDate = formData.get("checkInDate");
  const rawCheckOutDate = formData.get("checkOutDate");
  const rawRoomsData = formData.get("roomsData");

  logSafe(actionContext + " Raw form data values:", { rawCheckInDate, rawCheckOutDate, rawRoomsData_type: typeof rawRoomsData });

  if (!rawCheckInDate || typeof rawCheckInDate !== 'string' || rawCheckInDate.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: 'checkInDate' fehlt oder ist kein gültiger String.", {value: rawCheckInDate}, 'warn');
    return { success: false, message: "Anreisedatum ist erforderlich und muss ein gültiger String sein. (Code: CBA-PRE-CID-INV)", errors: { checkInDate: ["Anreisedatum ist erforderlich."] }, actionToken: serverActionToken, bookingToken: null, updatedGuestData: null, currentStep: -1 };
  }
  if (!rawCheckOutDate || typeof rawCheckOutDate !== 'string' || rawCheckOutDate.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: 'checkOutDate' fehlt oder ist kein gültiger String.", {value: rawCheckOutDate}, 'warn');
    return { success: false, message: "Abreisedatum ist erforderlich und muss ein gültiger String sein. (Code: CBA-PRE-COD-INV)", errors: { checkOutDate: ["Abreisedatum ist erforderlich."] }, actionToken: serverActionToken, bookingToken: null, updatedGuestData: null, currentStep: -1 };
  }
  if (!rawRoomsData || typeof rawRoomsData !== 'string' || rawRoomsData.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: 'roomsData' fehlt oder ist kein gültiger String.", {value: rawRoomsData}, 'warn');
    return { success: false, message: "Zimmerdaten sind erforderlich und müssen ein gültiger JSON-String sein. (Code: CBA-PRE-RD-INVSTR)", errors: { roomsData: ["Zimmerdaten sind erforderlich."] }, actionToken: serverActionToken, bookingToken: null, updatedGuestData: null, currentStep: -1 };
  }

  let parsedRoomsForPreCheck;
  try {
    parsedRoomsForPreCheck = JSON.parse(rawRoomsData);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logSafe(actionContext + " Pre-check FAIL: 'roomsData' JSON.parse error.", {rawRoomsDataString: rawRoomsData, error: err.message}, 'warn');
    return { success: false, message: `Zimmerdaten sind kein gültiges JSON-Format: ${err.message}. (Code: CBA-PRE-RD-JSONERR)`, errors: { roomsData: [`Zimmerdaten sind kein gültiges JSON: ${err.message}`] }, actionToken: serverActionToken, bookingToken: null, updatedGuestData: null, currentStep: -1 };
  }

  if (!Array.isArray(parsedRoomsForPreCheck)) {
    logSafe(actionContext + " Pre-check FAIL: 'roomsData' (parsed) is not an array.", {parsedRoomsForPreCheck}, 'warn');
    return { success: false, message: "Zimmerdaten müssen ein Array sein. (Code: CBA-PRE-RD-NOTARR)", errors: { roomsData: ["Zimmerdaten müssen ein Array sein."] }, actionToken: serverActionToken, bookingToken: null, updatedGuestData: null, currentStep: -1 };
  }
  if (parsedRoomsForPreCheck.length === 0) {
    logSafe(actionContext + " Pre-check FAIL: 'roomsData' array is empty.", {parsedRoomsForPreCheck}, 'warn');
    return { success: false, message: "Es muss mindestens ein Zimmer angegeben werden. (Code: CBA-PRE-RD-EMPTYARR)", errors: { roomsData: ["Mindestens ein Zimmer angeben."] }, actionToken: serverActionToken, bookingToken: null, updatedGuestData: null, currentStep: -1 };
  }
  // --- End of defensive pre-checks ---

  const dataForZod = {
      guestFirstName: formData.get("guestFirstName"),
      guestLastName: formData.get("guestLastName"),
      price: formData.get("price"),
      checkInDate: rawCheckInDate, // Use pre-checked value
      checkOutDate: rawCheckOutDate, // Use pre-checked value
      verpflegung: formData.get("verpflegung"),
      interneBemerkungen: formData.get("interneBemerkungen"),
      roomsData: rawRoomsData, // Pass the original raw string to Zod for its full pipeline
  };
  logSafe(actionContext + " Data prepared for Zod validation:", dataForZod);

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

      const errorMessagesList: string[] = [];
      Object.entries(allErrors).forEach(([key, messages]) => {
          if (messages && Array.isArray(messages) && messages.length > 0) {
              const keyDisplay = key === 'global' ? 'Allgemeiner Fehler' : `Feld '${key}'`;
              errorMessagesList.push(`${keyDisplay}: ${messages.join(', ')}`);
          }
      });
      const errorMessage = errorMessagesList.length > 0 ? errorMessagesList.join('; ') : "Unbekannter Validierungsfehler.";
      logSafe(actionContext + " Zod Validation FAILED", { errors: allErrors, zodErrorObject: validatedFields.error.format(), dataForZod }, 'warn');

      return {
        success: false, actionToken: serverActionToken,
        message: `Fehler bei der Validierung: ${errorMessage} (Code: CBA-ZOD-VAL-${serverActionToken.substring(0,4)})`,
        errors: allErrors, bookingToken: null, updatedGuestData: null, currentStep: -1
      };
    }

    const bookingData = validatedFields.data;
    logSafe(`${actionContext} Zod validation successful. Validated bookingData (interneBemerkungen type: ${typeof bookingData.interneBemerkungen}, value: ${bookingData.interneBemerkungen}; roomsData isArray: ${Array.isArray(bookingData.roomsData)}, length: ${Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'N/A'})`, 
        { roomsPreview: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.map(r => ({z: r.zimmertyp, akType: typeof r.alterKinder, akVal: r.alterKinder})) : 'N/A' }
    );
    
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const msg = "Interner Fehler: Zimmerdaten (roomsData) sind nach Zod-Validierung ungültig (kein Array oder leer). (Code: CBA-POSTZOD-RD)";
        logSafe(`${actionContext} CRITICAL ERROR: bookingData.roomsData is not a valid array after Zod.`, { roomsData: bookingData.roomsData }, 'error');
        return { success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] }, bookingToken: null, updatedGuestData: null, currentStep: -1 };
    }

    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || '');

    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'Standard'), 
        erwachsene: Number(room.erwachsene || 0),    
        kinder: Number(room.kinder || 0),          
        kleinkinder: Number(room.kleinkinder || 0),  
        alterKinder: String(room.alterKinder || ''), 
    }));
    
    const firstRoom = finalRoomsData[0]; 
    const zimmertypForIdentifier = String(firstRoom.zimmertyp || 'Standard');
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
    
    logSafe(actionContext + " Attempting to add booking to Firestore. Payload preview (dates as ISO for logging):", { ...newBookingPayload, checkInDate: newBookingPayload.checkInDate?.toISOString(), checkOutDate: newBookingPayload.checkOutDate?.toISOString(), roomsCount: newBookingPayload.rooms?.length });
    
    let createdBookingId: string | null = null;
    try {
        const addDbStartTime = Date.now();
        createdBookingId = await addBookingToFirestore(newBookingPayload);
        logSafe(`${actionContext} addBookingToFirestore completed in ${Date.now() - addDbStartTime}ms. Result ID: ${createdBookingId}.`);
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
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in createBookingAction`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,1200) }, 'error');
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
  const serverActionToken = generateActionToken();
  const actionContext = `[deleteBookingsAction(Action:${serverActionToken.substring(0,8)})]`;

  logSafe(actionContext + " BEGIN", { bookingIdsParamType: typeof bookingIds, bookingIdsParamIsArray: Array.isArray(bookingIds), bookingIdsParamValue: bookingIds });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { 
        success: false, 
        message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: DBA-FNI)`, 
        actionToken: serverActionToken 
    };
  }

  // Ensure bookingIds is an array and filter out any non-string or empty string IDs
  const validBookingIds = Array.isArray(bookingIds) 
    ? bookingIds.filter(id => typeof id === 'string' && id.trim() !== '') 
    : [];
  
  logSafe(actionContext + " Valid booking IDs to process:", { count: validBookingIds.length, ids: validBookingIds });


  if (validBookingIds.length === 0) {
    logSafe(`${actionContext} No valid booking IDs provided for deletion. Original input:`, { bookingIdsInput: bookingIds }, 'warn');
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
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in deleteBookingsAction`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return {
        success: false,
        message: `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: DBA-GUEH)`,
        actionToken: serverActionToken
    };
  }
}

    
