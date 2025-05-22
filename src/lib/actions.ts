
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
import { storage, firebaseInitializedCorrectly, firebaseInitializationError, db } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";

// Helper for logging - Global scope for all actions in this file
function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const operationName = "[Server Action LogSafe]";
    let simplifiedData: string = ""; // Initialize to empty string
    const maxLogLength = 3000; 
    try {
        const jsonData = JSON.stringify(data, (key, value) => {
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
        simplifiedData = jsonData === undefined ? "[JSON.stringify returned undefined]" : jsonData;
    } catch (e: any) {
        simplifiedData = `[Log data could not be stringified: ${(e instanceof Error ? e.message : String(e))}]`;
    }

    const logMessage = `${operationName} [${new Date().toISOString()}] ${context} ${typeof simplifiedData === 'string' && simplifiedData.length > maxLogLength ? simplifiedData.substring(0, maxLogLength) + `... [LOG_DATA_TRUNCATED_AT_${maxLogLength}_CHARS]` : simplifiedData}`;

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

// Helper to convert Firestore Timestamps to ISO strings for client-side display
function convertTimestampsInGuestData(guestData: GuestSubmittedData | null | undefined): GuestSubmittedData | null | undefined {
  if (!guestData) return guestData;
  const dataCopy = JSON.parse(JSON.stringify(guestData)); // Deep copy to avoid mutating original
  
  const toISOIfTimestamp = (value: any): string | any => {
    if (value && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
      return new Timestamp(value.seconds, value.nanoseconds).toDate().toISOString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  };

  if (dataCopy.geburtsdatum) dataCopy.geburtsdatum = toISOIfTimestamp(dataCopy.geburtsdatum);
  if (dataCopy.zahlungsdatum) dataCopy.zahlungsdatum = toISOIfTimestamp(dataCopy.zahlungsdatum);
  if (dataCopy.submittedAt) dataCopy.submittedAt = toISOIfTimestamp(dataCopy.submittedAt);
  
  return dataCopy;
}


async function updateBookingStep(
  forActionToken: string,
  bookingId: string,
  stepNumber: number, // 1-basiert für den aktuellen Schritt, der gerade übermittelt wird
  stepName: string,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `[updateBookingStep(BookingID:${bookingId}, Step:${stepNumber}-${stepName}, ActionToken:${forActionToken.substring(0,8)})]`;
  const startTime = Date.now();
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;

  logSafe(actionContext + ` BEGIN - FormData keys: ${Array.from(formData.keys()).join(', ')}`, { additionalDataToMergeKeys: additionalDataToMerge ? Object.keys(additionalDataToMerge) : 'N/A' });
  
  try { // Global try-catch for updateBookingStep
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
      logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
      return {
        ...initialFormState, success: false, actionToken: forActionToken, currentStep: stepNumber -1, // currentStep is 0-indexed
        message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. Bitte Admin kontaktieren. (Details: ${initErrorMsg}) (Aktions-ID: ${forActionToken}) (Code: UBS-FNI)`,
        errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI-G)`] },
      };
    }

    const bookingDoc = await findBookingByIdFromFirestore(bookingId);
    if (!bookingDoc) {
      logSafe(actionContext + ` FAIL - Booking NOT FOUND with ID:`, { bookingId }, 'error');
      return {
        ...initialFormState, success: false, actionToken: forActionToken, currentStep: stepNumber -1,
        message: `Buchung mit ID ${bookingId} nicht gefunden. (Code: UBS-BNF-${forActionToken.substring(0,4)})`,
        errors: { global: [`Buchung nicht gefunden. (Aktions-ID: ${forActionToken}) (Code: UBS-BNF-G)`] },
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
        ...initialFormState, success: false, actionToken: forActionToken, currentStep: stepNumber -1,
        message: "Validierungsfehler. Bitte Eingaben prüfen. (Code: UBS-ZVF)", errors: formErrors,
        updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot) 
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
      formDataKey: string; // e.g., "hauptgastAusweisVorderseiteFile"
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
    }> = [];

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

        if (config.mitreisenderId && config.mitreisenderUrlKey && originalBookingSnapshotForOldUrl?.mitreisende) {
            const companion = originalBookingSnapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
        } else if (config.guestDataUrlKey) {
            oldFileUrl = (originalBookingSnapshotForOldUrl as any)?.[config.guestDataUrlKey];
        }
        logSafe(actionContext + ` Processing file field: ${config.formDataKey}. File present: ${!!(file instanceof File && file.size > 0)}. Old URL exists: ${!!oldFileUrl}`);

        if (file instanceof File && file.size > 0) { 
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
            
            if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
                try {
                    logSafe(actionContext + ` Attempting to delete OLD file from Storage: ${oldFileUrl.substring(oldFileUrl.lastIndexOf('/') + 1)} for ${config.formDataKey}.`);
                    const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
                    await deleteObject(oldFileStorageRefHandle);
                    logSafe(actionContext + ` OLD file ${oldFileUrl.substring(oldFileUrl.lastIndexOf('/') + 1)} deleted from Storage for ${config.formDataKey}.`);
                } catch (deleteError: any) {
                    const fbErrorCode = (deleteError as any)?.code;
                    if (fbErrorCode === 'storage/object-not-found') {
                        logSafe(actionContext + ` WARN: Old file for ${config.formDataKey} not found in Storage, skipping deletion. URL: ${oldFileUrl.substring(oldFileUrl.lastIndexOf('/') + 1)}`, {}, 'warn');
                    } else {
                        logSafe(actionContext + ` WARN: Failed to delete OLD file for ${config.formDataKey} from Storage. URL: ${oldFileUrl.substring(oldFileUrl.lastIndexOf('/') + 1)}. Code: ${fbErrorCode}`, { error: (deleteError as Error).message, code: fbErrorCode }, 'warn');
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

                logSafe(actionContext + ` Uploading "${originalFileName}" (Content-Type: ${file.type}) to Storage path: ${filePath}.`, { field: config.formDataKey});
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
                else if (fbErrorCode === 'storage/canceled') userMessage = `Upload für "${originalFileName}" wurde abgebrochen (möglicherweise Netzwerkproblem). Bitte erneut versuchen. (Code: UBS-FSC-${forActionToken.substring(0,4)})`;
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
                    else { 
                        const newCompanion: MitreisenderData = { id: config.mitreisenderId, vorname: '', nachname: '' }; // Placeholder names
                        (newCompanion as any)[config.mitreisenderUrlKey] = downloadURL;
                        updatedGuestData.mitreisende.push(newCompanion);
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
                    if (companion) (companion as any)[config.mitreisenderUrlKey] = undefined; // Clear the URL
                } else if (config.guestDataUrlKey) (updatedGuestData as any)[config.guestDataUrlKey] = undefined; // Clear the URL
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
        
        // Ensure updatedGuestData.mitreisende is an array
        if (!Array.isArray(updatedGuestData.mitreisende)) {
            updatedGuestData.mitreisende = [];
        }

        // Sync names and ensure all client-side companions are represented server-side
        const finalServerMitreisende: MitreisenderData[] = [];
        for (const cm of clientMitreisende as Array<{id:string; vorname: string; nachname: string}>) {
          const existingServerCompanion = updatedGuestData.mitreisende.find(sm => sm.id === cm.id);
          finalServerMitreisende.push({
            id: String(cm.id || generateActionToken()), // Ensure ID is always a string
            vorname: String(cm.vorname || ''), 
            nachname: String(cm.nachname || ''),
            // Preserve URLs from file processing, otherwise undefined
            ausweisVorderseiteUrl: existingServerCompanion?.ausweisVorderseiteUrl, 
            ausweisRückseiteUrl: existingServerCompanion?.ausweisRückseiteUrl,   
          });
        }
        updatedGuestData.mitreisende = finalServerMitreisende;
        logSafe(actionContext + " Mitreisende data merged/synced.", { count: updatedGuestData.mitreisende.length});

      } catch(e: any) {
        logSafe(actionContext + ` WARN: Failed to process mitreisendeMeta.`, { error: (e as Error).message }, 'warn');
        (formErrorsFromProcessing.mitreisendeMeta = formErrorsFromProcessing.mitreisendeMeta || []).push("Fehler beim Verarbeiten der Mitreisenden-Daten.");
      }
    }


    if (Object.keys(formErrorsFromProcessing).length > 0) {
      logSafe(actionContext + ` Returning due to accumulated form errors.`, { errors: formErrorsFromProcessing });
      return {
        ...initialFormState, success: false, actionToken: forActionToken, currentStep: stepNumber -1,
        message: "Einige Felder oder Dateien konnten nicht verarbeitet werden. Bitte prüfen. (Code: UBS-FPE)",
        errors: formErrorsFromProcessing, 
        updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), 
      };
    }

    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber -1); // 0-indexed

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") {
      // Zod schema already ensures these are booleans if they exist
      const agbAkzeptiert = !!dataFromForm.agbAkzeptiert;
      const datenschutzAkzeptiert = !!dataFromForm.datenschutzAkzeptiert;
      
      updatedGuestData.agbAkzeptiert = agbAkzeptiert;
      updatedGuestData.datenschutzAkzeptiert = datenschutzAkzeptiert;

      if (agbAkzeptiert && datenschutzAkzeptiert) {
        updatedGuestData.submittedAt = Timestamp.now(); 
        bookingStatusUpdate.status = "Confirmed";
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(!agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        logSafe(actionContext + " Consent validation FAILED.", { errors: consentErrors });
        return {
          ...initialFormState, success: false, actionToken: forActionToken, currentStep: stepNumber -1,
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert. (Code: UBS-CE)", errors: consentErrors,
          updatedGuestData: convertTimestampsInGuestData(updatedGuestData), 
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
        logSafe(actionContext + " Main guest name updated in booking.", { oldName: `${currentFirstName} ${currentLastName}`, newName: `${newFirstName} ${newLastName}`});
      }
    }
    
    logSafe(actionContext + ` Attempting to update booking in Firestore. Path: ${bookingDoc.id!}.`, { updateKeys: Object.keys(bookingUpdatesFirestore) });
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    
    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${bookingDoc.id!}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    
    logSafe(actionContext + ` SUCCESS - Step ${stepNumber} processed.`, { finalMessage: message });
    return {
      ...initialFormState, success: true, actionToken: forActionToken, currentStep: stepNumber -1, 
      message, errors: null, 
      updatedGuestData: convertTimestampsInGuestData(updatedGuestData), 
    };

  } catch (error: any) { // Global catch for updateBookingStep
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return {
      ...initialFormState, success: false, actionToken: forActionToken, currentStep: stepNumber -1,
      message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${error.message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-GUEH)`,
      errors: { global: [`Serverfehler (Schritt ${stepName}): ${error.message}. Bitte Admin kontaktieren. (Code: UBS-GUEH-G)`] },
      updatedGuestData: currentGuestDataSnapshot ? convertTimestampsInGuestData(currentGuestDataSnapshot) : null,
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
});

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[submitGastStammdatenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SGA-FNI)`, errors: { global: [initErrorMsg] }};
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
       logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
       return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SGA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 0 };
    }
    return await updateBookingStep(serverActionToken, booking.id, 1, "Hauptgast & Ausweis", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-GUEH)`, errors: { global: [`Serverfehler (Stammdaten): ${error.message} (Code: SGA-GUEH-G)`] }};
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
        try { return JSON.parse(val); } catch (e) { 
            logSafe("[mitreisendeStepSchema] Failed to parse mitreisendeMeta JSON", {value: val, error: (e as Error).message}, "warn");
            return []; 
        }
      }
      return []; 
    },
    z.array(mitreisenderClientSchema).optional().default([]) 
  ),
}).catchall(fileSchema); 

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
   if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SMA-FNI)`, errors: { global: [initErrorMsg] }};
  }
   try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SMA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 1 };
    }
    return await updateBookingStep(serverActionToken, booking.id, 2, "Mitreisende", mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SMA-GUEH)`, errors: { global: [`Serverfehler (Mitreisende): ${error.message} (Code: SMA-GUEH-G)`] }};
  }
}

// --- Step 3: Zahlungssumme wählen ---
const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(["downpayment", "full_amount"], { required_error: "Auswahl der Zahlungssumme ist erforderlich." }),
});
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
   if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SPASA-FNI)`, errors: { global: [initErrorMsg] }};
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SPASA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 2 };
    }
    
    const validatedFields = paymentAmountSelectionSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!validatedFields.success) {
        logSafe(actionContext + ` Zod Validation FAILED`, { errors: validatedFields.error.flatten().fieldErrors }, 'warn');
        return { ...initialFormState, message: "Validierungsfehler bei Zahlungssummenauswahl.", errors: validatedFields.error.flatten().fieldErrors, success: false, actionToken: serverActionToken, currentStep: 2 };
    }
    const selectedAmount = validatedFields.data.paymentAmountSelection;
    let zahlungsbetrag = booking.price || 0;
    if (selectedAmount === 'downpayment') {
      zahlungsbetrag = parseFloat(((booking.price || 0) * 0.3).toFixed(2));
    }
    
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag, paymentAmountSelection: selectedAmount } as Partial<GuestSubmittedData>;
    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-GUEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${error.message} (Code: SPASA-GUEH-G)`] }};
  }
}

// --- Step 4: Zahlungsinformationen (Banküberweisung) ---
const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});
export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SZIA-FNI)`, errors: { global: [initErrorMsg] }};
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SZIA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 3 };
    }
    return await updateBookingStep(serverActionToken, booking.id, 4, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now() });
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-GUEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${error.message} (Code: SZIA-GUEH-G)`] }};
  }
}

// --- Step 5: Übersicht & Bestätigung ---
const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});
export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})]`;
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(actionContext + ` FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Aktions-ID: ${serverActionToken}) (Code: SEBA-FNI)`, errors: { global: [initErrorMsg] }};
  }
  try {
    logSafe(actionContext + ` Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(actionContext + ` Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: `Buchung nicht gefunden. (Code: SEBA-BNF-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken, currentStep: 4 };
    }
    return await updateBookingStep(serverActionToken, booking.id, 5, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(actionContext + ` GLOBAL UNHANDLED EXCEPTION`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-GUEH)`, errors: { global: [`Serverfehler (Bestätigung): ${error.message} (Code: SEBA-GUEH-G)`] }};
  }
}

// --- Create Booking Dialog (Admin) ---
const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich.").optional().default('Standard'),
  erwachsene: z.coerce.number({invalid_type_error: "Anzahl Erwachsene muss eine Zahl sein."}).int().min(0, "Anzahl Erwachsene darf nicht negativ sein.").optional().default(1),
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
  roomsData: z.string({required_error: "Zimmerdaten sind ein Pflichtfeld."})
    .min(1, "Zimmerdaten dürfen nicht leer sein (JSON-String erwartet). (Code: CBA-RD-EMPTYSTR)")
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
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return {
        ...initialFormState, success: false, actionToken: serverActionToken,
        message: `Serverfehler: Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL). Details: ${initErrorMsg}.`,
        errors: { global: [`Firebase Initialisierungsfehler. (Code: CBA-FNI-${serverActionToken.substring(0,4)})`] },
    };
  }
  
  // --- Defensive Pre-checks for critical formData fields BEFORE Zod ---
  const rawGuestFirstName = formData.get("guestFirstName");
  const rawGuestLastName = formData.get("guestLastName");
  const rawPrice = formData.get("price");
  const rawCheckInDate = formData.get("checkInDate");
  const rawCheckOutDate = formData.get("checkOutDate");
  const rawRoomsDataString = formData.get("roomsData");
  const rawVerpflegung = formData.get("verpflegung");
  const rawInterneBemerkungen = formData.get("interneBemerkungen");

  logSafe(actionContext + " Raw values from formData:", {
      rawGuestFirstName: String(rawGuestFirstName), rawGuestLastName: String(rawGuestLastName),
      rawPrice: String(rawPrice), rawCheckInDate: String(rawCheckInDate), rawCheckOutDate: String(rawCheckOutDate),
      rawRoomsDataIsString: typeof rawRoomsDataString === 'string', rawRoomsDataLength: typeof rawRoomsDataString === 'string' ? rawRoomsDataString.length : 'N/A',
      rawVerpflegung: String(rawVerpflegung), rawInterneBemerkungenIsString: typeof rawInterneBemerkungen === 'string'
  });
  
  if (typeof rawCheckInDate !== 'string' || rawCheckInDate.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: checkInDate missing or not a string.", {value: rawCheckInDate});
    return { ...initialFormState, success: false, message: "Anreisedatum ist erforderlich. (Code: CBA-PRE-CID)", errors: { checkInDate: ["Anreisedatum ist erforderlich."] }, actionToken: serverActionToken };
  }
  if (typeof rawCheckOutDate !== 'string' || rawCheckOutDate.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: checkOutDate missing or not a string.", {value: rawCheckOutDate});
    return { ...initialFormState, success: false, message: "Abreisedatum ist erforderlich. (Code: CBA-PRE-COD)", errors: { checkOutDate: ["Abreisedatum ist erforderlich."] }, actionToken: serverActionToken };
  }
  if (typeof rawRoomsDataString !== 'string' || rawRoomsDataString.trim() === '') {
    logSafe(actionContext + " Pre-check FAIL: roomsData missing, not a string, or empty.", {value: rawRoomsDataString});
    return { ...initialFormState, success: false, message: "Zimmerdaten sind erforderlich. (Code: CBA-PRE-RD-STR)", errors: { roomsData: ["Zimmerdaten sind erforderlich."] }, actionToken: serverActionToken };
  }
  
  let parsedRoomsForPreCheck;
  try {
    parsedRoomsForPreCheck = JSON.parse(rawRoomsDataString);
  } catch (e) {
    logSafe(actionContext + " Pre-check FAIL: roomsData is not valid JSON.", {error: (e as Error).message, rawRoomsDataPreview: rawRoomsDataString.substring(0,100)});
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
  // --- End of Defensive Pre-checks ---

  const dataForZod = {
      guestFirstName: rawGuestFirstName,
      guestLastName: rawGuestLastName,
      price: rawPrice,
      checkInDate: rawCheckInDate,
      checkOutDate: rawCheckOutDate,
      verpflegung: rawVerpflegung,
      interneBemerkungen: rawInterneBemerkungen, 
      roomsData: rawRoomsDataString, 
  };
  logSafe(actionContext + " Data prepared for Zod validation (keys):", Object.keys(dataForZod));

  try { // Global try-catch for createBookingAction
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
        ...initialFormState, success: false, actionToken: serverActionToken,
        message: `Fehler bei der Validierung: ${errorMessage} (Code: CBA-ZOD-VAL-${serverActionToken.substring(0,4)})`,
        errors: allErrors, 
      };
    }

    const bookingData = validatedFields.data;
    logSafe(`${actionContext} Zod validation successful. Validated bookingData types:`, {
        guestFirstName_type: typeof bookingData.guestFirstName,
        guestLastName_type: typeof bookingData.guestLastName,
        price_type: typeof bookingData.price,
        interneBemerkungen_type: typeof bookingData.interneBemerkungen, // Should be string due to .default('')
        roomsData_isArray: Array.isArray(bookingData.roomsData), 
        roomsData_length: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'N/A'
    });
    logSafe(`${actionContext} Validated bookingData (sample values):`, {
        guestFirstName_val: bookingData.guestFirstName,
        price_val: bookingData.price,
        interneBemerkungen_val: bookingData.interneBemerkungen,
        firstRoom_zimmertyp: Array.isArray(bookingData.roomsData) && bookingData.roomsData.length > 0 ? bookingData.roomsData[0].zimmertyp : 'N/A',
        firstRoom_alterKinder: Array.isArray(bookingData.roomsData) && bookingData.roomsData.length > 0 ? bookingData.roomsData[0].alterKinder : 'N/A',
    });
    
    // This check should now be redundant due to pre-checks and Zod's .min(1) on the array.
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const msg = "Interner Fehler: Zimmerdaten (roomsData) sind nach Zod-Validierung ungültig oder leer. (Code: CBA-POSTZOD-RD)";
        logSafe(`${actionContext} CRITICAL ERROR: bookingData.roomsData is not a valid array or is empty after Zod. This should have been caught earlier.`, { roomsData: bookingData.roomsData }, 'error');
        return { ...initialFormState, success: false, actionToken: serverActionToken, message: msg, errors: { roomsData: [msg] } };
    }
    
    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || ''); 

    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'Standard'), 
        erwachsene: Number(room.erwachsene || 0),    
        kinder: Number(room.kinder || 0),          
        kleinkinder: Number(room.kleinkinder || 0),  
        alterKinder: String(room.alterKinder || ''), 
    }));
    logSafe(actionContext + " finalRoomsData created:", { finalRoomsDataPreview: finalRoomsData.slice(0,1) });
    
    const firstRoom = finalRoomsData[0]; 
    // Redundant check already performed, firstRoom will exist if roomsData passed validation.
    
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
            ...initialFormState, success: false, actionToken: serverActionToken,
            message: `Datenbankfehler beim Erstellen der Buchung: ${(dbError as Error).message}. (Code: CBA-DBF-ADD-${serverActionToken.substring(0,4)})`, 
            errors: { global: [`Fehler beim Speichern der Buchung: ${(dbError as Error).message}`] },
        };
    }

    if (!createdBookingId) {
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null or empty ID.`, {}, 'error');
      return {
        ...initialFormState, success: false, actionToken: serverActionToken,
        message: `Datenbankfehler: Buchung konnte nicht erstellt werden (keine ID zurückgegeben). (Code: CBA-DBF-NOID-${serverActionToken.substring(0,4)})`, 
        errors: { global: ["Fehler beim Speichern der Buchung."] },
      };
    }
    logSafe(`${actionContext} SUCCESS - New booking. Token: ${newBookingToken}. ID: ${createdBookingId}. Total Time: ${Date.now() - startTime}ms.`);
    
    revalidatePath("/admin/dashboard", "page");
    revalidatePath(`/admin/bookings/${createdBookingId}`, "page"); // Revalidate detail page of new booking
    
    return {
      ...initialFormState, success: true, actionToken: serverActionToken,
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      bookingToken: newBookingToken,
    };

  } catch (e: any) { // Global catch for createBookingAction
    const error = e instanceof Error ? e : new Error(String(e));
    logSafe(`${actionContext} GLOBAL UNHANDLED EXCEPTION in createBookingAction`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.substring(0,500) }, 'error');
    return {
      ...initialFormState, success: false, actionToken: serverActionToken,
      message: `Unerwarteter Serverfehler: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken.substring(0,8)}) (Code: CBA-GUEH)`,
      errors: { global: [`Serverfehler: ${error.message}. Bitte Admin kontaktieren. (Code: CBA-GUEH-G-${serverActionToken.substring(0,4)})`] },
    };
  } finally {
     logSafe(actionContext + ` END. Total time: ${Date.now() - startTime}ms.`);
  }
}


// --- Delete Bookings Action ---
export async function deleteBookingsAction(
  prevState: {success: boolean; message: string; actionToken?: string} | null, // Allow null for first call
  bookingIds: string[]
): Promise<{ success: boolean; message: string, actionToken: string }> {
  "use server";
  const serverActionToken = generateActionToken();
  const actionContext = `[deleteBookingsAction(Action:${serverActionToken.substring(0,8)})]`;

  logSafe(actionContext + " BEGIN", { bookingIdsParamType: typeof bookingIds, bookingIdsParamIsArray: Array.isArray(bookingIds), bookingIdsParamValue: bookingIds });
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { success: false, message: `Kritischer Serverfehler: Firebase nicht korrekt initialisiert. (Details: ${initErrorMsg}) (Code: DBA-FNI-${serverActionToken.substring(0,4)})`, actionToken: serverActionToken };
  }

  const validBookingIds = Array.isArray(bookingIds) ? bookingIds.filter(id => typeof id === 'string' && id.trim() !== '') : [];
  
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
      // Potentially revalidate individual booking pages if needed, though they won't exist anymore
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
    

    

    

    