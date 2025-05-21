
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
} from "./mock-db"; 
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | string | undefined> | null; // Allow string for global errors
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

function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    let simplifiedData;
    const maxLogLength = 15000; 
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
            if (value instanceof File) { return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }; }
            if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack?.substring(0,400) + "...[TRUNCATED_STACK]" }; }
            if (typeof value === 'string' && value.length > 400 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) { return value.substring(0, 200) + "...[TRUNCATED_STRING_LOG]"; }
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 40 && !key.toLowerCase().includes('guestsubmitteddata')) { return "[TRUNCATED_OBJECT_LOG_TOO_MANY_KEYS]"; }
            if ((key.toLowerCase().includes('url') || key.toLowerCase().includes('datauri')) && typeof value === 'string' && value.startsWith('data:image')) { return value.substring(0,150) + "...[TRUNCATED_DATA_URI_LOG]";}
            return value;
        }, 2);
    } catch (e: any) {
        simplifiedData = `[Log data could not be stringified: ${e?.message || 'Unknown stringification error'}]`;
    }

    const logMessage = `[ Server Action ] [${new Date().toISOString()}] ${context} ${simplifiedData.length > maxLogLength ? simplifiedData.substring(0, maxLogLength) + `... [LOG_DATA_TRUNCATED_AT_${maxLogLength}_CHARS]` : simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
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


function convertTimestampsInGuestData(data?: GuestSubmittedData | null): GuestSubmittedData | null | undefined {
  if (!data) return data;
  const newGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(data)); // Deep copy to avoid mutating original

  const processTimestampField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
      if (obj[field] instanceof Timestamp) {
        obj[field] = obj[field].toDate().toISOString();
      } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
        obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
      } else if (obj[field] instanceof Date) {
        obj[field] = obj[field].toISOString();
      }
      // If it's already an ISO string, it will remain as is.
    }
  };

  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
  for (const field of dateFields) {
    processTimestampField(newGuestData, field as string);
  }

  if (newGuestData.mitreisende && Array.isArray(newGuestData.mitreisende)) {
    // No date fields to convert for Mitreisender in current definition
  }
  return newGuestData;
}


async function updateBookingStep(
  forActionToken: string, // Changed from actionId for clarity
  bookingId: string,
  stepNumber: number, // 1-based
  stepName: string,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `updateBookingStep(BookingID:${bookingId}, Step:${stepNumber}-${stepName}, ActionToken:${forActionToken.substring(0,8)})`;
  const startTime = Date.now();
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;
  let bookingDoc: Booking | null = null;

  logSafe(`${actionContext} BEGIN`, { formDataKeys: Array.from(formData.keys()), additionalDataToMergeKeys: additionalDataToMerge ? Object.keys(additionalDataToMerge) : 'N/A' });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler (UBS-CRIT).";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
    return {
      message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${forActionToken})`,
      errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI)`] },
      success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
    };
  }

  try { // Outer try-catch for the entire function logic AFTER initial checks
    bookingDoc = await findBookingByIdFromFirestore(bookingId);
    if (!bookingDoc) {
      logSafe(`${actionContext} FAIL - Booking NOT FOUND with ID:`, { bookingId }, 'warn');
      return {
        message: `Buchung mit ID ${bookingId} nicht gefunden.`,
        errors: { global: [`Buchung nicht gefunden. (Aktions-ID: ${forActionToken}) (Code: UBS-BNF)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
      };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }));
    logSafe(`${actionContext} Current guest data snapshot fetched`, { lastCompletedStep: currentGuestDataSnapshot.lastCompletedStep });

    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(`${actionContext} Raw form data (keys only for brevity):`, { keys: Object.keys(rawFormData) });
    const validatedFields = actionSchema.safeParse(rawFormData);
    let formErrors: Record<string, string[]> = {};

    if (!validatedFields.success) {
      formErrors = { ...formErrors, ...validatedFields.error.flatten().fieldErrors };
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors }, 'warn');
      return {
          message: "Validierungsfehler. Bitte Eingaben prüfen. (Code: UBS-ZVF)", errors: formErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot) 
      };
    }
    const dataFromForm = validatedFields.data;
    logSafe(`${actionContext} Zod Validation SUCCESSFUL. Data from form (keys only):`, { keys: Object.keys(dataFromForm) });

    let updatedGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(currentGuestDataSnapshot));
    if (additionalDataToMerge) {
        updatedGuestData = { ...updatedGuestData, ...additionalDataToMerge };
    }
    updatedGuestData = { ...updatedGuestData, ...dataFromForm };

    // Define file fields based on step
    const fileFieldsConfig: Array<{
      formDataKey: string; // e.g., "hauptgastAusweisVorderseiteFile"
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
      step: string; // To identify which step this file belongs to
    }> = [];

    if (stepName === "Hauptgast & Ausweis") {
        fileFieldsConfig.push(
            { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl', step: stepName },
            { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl', step: stepName }
        );
    } else if (stepName === "Mitreisende" && dataFromForm.mitreisendeMeta) {
        try {
            const mitreisendeMetaParsed = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id: string}[];
            mitreisendeMetaParsed.forEach((mitreisenderClient) => {
                if (mitreisenderClient.id) {
                    fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl', step: stepName });
                    fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl', step: stepName });
                }
            });
        } catch(e: any) {
            logSafe(`${actionContext} WARN: Failed to parse mitreisendeMeta for file config.`, { error: e.message, meta: dataFromForm.mitreisendeMeta }, 'warn');
            formErrors['mitreisendeMeta'] = ['Fehler beim Verarbeiten der Mitreisenden-Metadaten. (Code: UBS-MPM)'];
        }
    } else if (stepName === "Zahlungsinfo") {
        fileFieldsConfig.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl', step: stepName });
    }

    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsConfig.length });
    
    for (const config of fileFieldsConfig) {
        const file = rawFormData[config.formDataKey] as File | undefined | null;
        let oldFileUrl: string | undefined = undefined;
        
        // Determine old file URL from the snapshot
        const snapshotForOldUrl = bookingDoc.guestSubmittedData || { lastCompletedStep: -1 };
        if (config.mitreisenderId && config.mitreisenderUrlKey && snapshotForOldUrl?.mitreisende) {
            const companion = snapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
        } else if (config.guestDataUrlKey) {
            oldFileUrl = (snapshotForOldUrl as any)?.[config.guestDataUrlKey];
        }

        if (file instanceof File && file.size > 0) {
            let originalFileName = file.name;
            if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === "") {
                const errorMsg = `Datei für Feld ${config.formDataKey} hat einen ungültigen oder leeren Namen. (Code: UBS-IFN)`;
                logSafe(`${actionContext} WARN: Skipping file due to invalid name.`, { formDataKey: config.formDataKey, originalFileName }, 'warn');
                formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), errorMsg];
                continue;
            }
            logSafe(`${actionContext} Processing new file for ${config.formDataKey}: "${originalFileName}" (Size: ${file.size}, Type: ${file.type}). Old URL: ${oldFileUrl ? oldFileUrl.substring(0, 60) + '...' : 'N/A'}`);
            
            let arrayBuffer: ArrayBuffer;
            try {
                const bufferStartTime = Date.now();
                arrayBuffer = await file.arrayBuffer();
                logSafe(`${actionContext} ArrayBuffer for "${originalFileName}" (size: ${arrayBuffer.byteLength}) read in ${Date.now() - bufferStartTime}ms`);
            } catch (bufferError: any) {
                const errorMsg = `Fehler beim Lesen der Datei "${originalFileName}": ${bufferError.message} (Code: UBS-FBF)`;
                logSafe(`${actionContext} FILE BUFFER FAIL for "${originalFileName}"`, { error: bufferError.message, code: bufferError.code, stack: bufferError.stack?.substring(0,300) }, 'error');
                formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), errorMsg];
                continue; // Skip to next file
            }

            // Delete old file from Firebase Storage if it exists
            if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
                try {
                    logSafe(`${actionContext} Attempting to delete old file: ${oldFileUrl} for ${config.formDataKey}.`);
                    const oldFileStorageRefHandle = storageRefFB(storage!, oldFileUrl); // Use storage! as we've checked it
                    await deleteObject(oldFileStorageRefHandle);
                    logSafe(`${actionContext} Old file ${oldFileUrl} deleted for ${config.formDataKey}.`);
                } catch (deleteError: any) {
                    if (deleteError?.code === 'storage/object-not-found') {
                        logSafe(`${actionContext} WARN: Old file for ${config.formDataKey} not found in Storage. Skipping deletion.`, {url: oldFileUrl}, 'warn');
                    } else {
                        logSafe(`${actionContext} WARN: Failed to delete old file for ${config.formDataKey}. Code: ${deleteError?.code}`, { error: (deleteError as Error).message, url: oldFileUrl }, 'warn');
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
                    filePathPrefix += `/other/${config.formDataKey}`; // Fallback path
                }
                const filePath = `${filePathPrefix}/${uniqueFileName}`;

                logSafe(`${actionContext} Uploading "${originalFileName}" to Storage path: ${filePath}. ContentType: ${file.type}`);
                const fileStorageRefHandle = storageRefFB(storage!, filePath);
                const uploadStartTime = Date.now();
                await uploadBytes(fileStorageRefHandle, arrayBuffer, { contentType: file.type });
                logSafe(`${actionContext} File "${originalFileName}" uploaded in ${Date.now() - uploadStartTime}ms`);
                
                const getUrlStartTime = Date.now();
                downloadURL = await getDownloadURL(fileStorageRefHandle);
                logSafe(`${actionContext} Got download URL for "${originalFileName}" in ${Date.now() - getUrlStartTime}ms: ${downloadURL ? downloadURL.substring(0,100) + "..." : "UNDEFINED"}`);

            } catch (fileUploadError: any) {
                let userMessage = `Dateiupload für "${originalFileName}" fehlgeschlagen.`;
                const fbErrorCode = fileUploadError?.code;
                logSafe(`${actionContext} FIREBASE STORAGE UPLOAD/GET_URL FAIL for "${originalFileName}"`, { error: fileUploadError?.message, code: fbErrorCode, stack: fileUploadError?.stack?.substring(0,300) }, 'error');
                
                if (fbErrorCode === 'storage/unauthorized') userMessage = `Berechtigungsfehler: Upload für "${originalFileName}" verweigert. Firebase Storage Regeln prüfen. (Code: UBS-FSU)`;
                else if (fbErrorCode === 'storage/canceled') userMessage = `Upload für "${originalFileName}" wurde abgebrochen. Bitte erneut versuchen. (Code: UBS-FSC)`;
                else if (fbErrorCode) userMessage += ` Fehlercode: ${fbErrorCode}`;
                else userMessage += ` Details: ${fileUploadError?.message || "Unbekannter Upload-Fehler"}`;

                formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), userMessage];
                // Restore old URL if upload failed and an old one existed
                if (oldFileUrl) {
                   if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                      const comp = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                      if(comp) (comp as any)[config.mitreisenderUrlKey] = oldFileUrl;
                  }
                  else if (config.guestDataUrlKey) { (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl; }
                }
                continue; // Skip to next file
            }

            if (downloadURL) {
                if (config.mitreisenderId && config.mitreisenderUrlKey) {
                    if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                    let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                    if (!companion && stepName === "Mitreisende" && dataFromForm.mitreisendeMeta) { // If companion doesn't exist, create from meta
                        try {
                            const metaArray = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id:string, vorname:string, nachname:string}[];
                            const meta = metaArray.find(m => m.id === config.mitreisenderId);
                            if(meta) {
                                companion = { id: meta.id, vorname: meta.vorname, nachname: meta.nachname };
                                updatedGuestData.mitreisende.push(companion);
                            }
                        } catch(e) { /* ignore parsing error */ }
                    }
                    if (companion) {
                        (companion as any)[config.mitreisenderUrlKey] = downloadURL;
                    } else {
                         logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} not found to assign URL for ${config.formDataKey}`, {}, 'warn');
                    }
                } else if (config.guestDataUrlKey) {
                    (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
                }
            }
        } else if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
            // Retain old URL if no new file is uploaded for this field
            // AND the field in updatedGuestData is not already set by the current form submission (which it shouldn't be if file is null/undefined)
            if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (companion && !(companion as any)[config.mitreisenderUrlKey]) { // Check if not already set by a new file
                    (companion as any)[config.mitreisenderUrlKey] = oldFileUrl;
                }
            } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
                (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
            }
        } else if (!file && oldFileUrl) {
             // If no new file AND oldFileUrl was something else (e.g. mock), clear it unless explicitly retained
             if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (companion) delete (companion as any)[config.mitreisenderUrlKey];
            } else if (config.guestDataUrlKey) {
                delete (updatedGuestData as any)[config.guestDataUrlKey];
            }
        }
    }
    logSafe(actionContext + " File processing END", { formErrorsCount: Object.keys(formErrors).length });

    if (Object.keys(formErrors).length > 0) {
        logSafe(`${actionContext} Returning due to file processing errors.`, { errors: formErrors });
        return {
            message: "Einige Dateien konnten nicht verarbeitet werden. Bitte prüfen Sie die Meldungen. (Code: UBS-FPE)",
            errors: formErrors, success: false, actionToken: forActionToken,
            currentStep: stepNumber - 1,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), 
        };
    }

    if (stepName === "Mitreisende" && dataFromForm.mitreisendeMeta) {
        try {
          const clientMitreisende = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id: string, vorname: string, nachname: string}[];
          const serverMitreisende: MitreisenderData[] = [];
          for (const cm of clientMitreisende) {
              // Find the companion that might have been updated with file URLs
              const existingOrFileProcessedCompanion = updatedGuestData.mitreisende?.find(sm => sm.id === cm.id);
              serverMitreisende.push({
                  id: cm.id,
                  vorname: cm.vorname || '',
                  nachname: cm.nachname || '',
                  // Use URLs from the companion object that was potentially updated by file processing
                  ausweisVorderseiteUrl: existingOrFileProcessedCompanion?.ausweisVorderseiteUrl,
                  ausweisRückseiteUrl: existingOrFileProcessedCompanion?.ausweisRückseiteUrl,
              });
          }
          updatedGuestData.mitreisende = serverMitreisende;
          logSafe(`${actionContext} Processed mitreisendeMeta successfully. Count: ${serverMitreisende.length}`);
        } catch(e: any) {
            logSafe(`${actionContext} WARN: Failed to process mitreisendeMeta. Mitreisende data might be incomplete.`, { error: e.message }, 'warn');
            formErrors['mitreisendeMeta'] = ['Fehler beim Verarbeiten der Mitreisenden-Daten. (Code: UBS-MPM2)'];
             return {
                message: "Fehler beim Verarbeiten der Mitreisenden-Daten. (Code: UBS-MPM2-MSG)",
                errors: formErrors, success: false, actionToken: forActionToken,
                currentStep: stepNumber - 1,
                updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
            };
        }
        delete (updatedGuestData as any).mitreisendeMeta; // Clean up meta field if it was part of dataFromForm
    }


    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1); 

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") { 
      // Ensure agbAkzeptiert and datenschutzAkzeptiert are booleans from Zod validation
      if (dataFromForm.agbAkzeptiert === true && dataFromForm.datenschutzAkzeptiert === true) {
        updatedGuestData.submittedAt = Timestamp.now(); // Use Firestore Timestamp for direct saving
        bookingStatusUpdate.status = "Confirmed";
        logSafe(`${actionContext} Consent given, setting status to Confirmed and submittedAt.`);
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(dataFromForm.agbAkzeptiert !== true) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(dataFromForm.datenschutzAkzeptiert !== true) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        logSafe(`${actionContext} Consent Error`, { errors: consentErrors });
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert. (Code: UBS-CE)", errors: { ...formErrors, ...consentErrors },
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(updatedGuestData), 
        };
      }
    }

    const bookingUpdatesFirestore: Partial<Booking> = {
        guestSubmittedData: updatedGuestData, 
        ...(bookingStatusUpdate.status && { status: bookingStatusUpdate.status })
    };
    
    if (stepName === "Hauptgast & Ausweis" && dataFromForm.gastVorname && dataFromForm.gastNachname && bookingDoc) {
        // Update top-level guest names if this is the first step where they are provided
        if(bookingDoc.guestFirstName !== dataFromForm.gastVorname || bookingDoc.guestLastName !== dataFromForm.gastNachname) {
            bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname as string;
            bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname as string;
        }
    }

    logSafe(`${actionContext} Attempting Firestore update for booking ID: ${bookingDoc.id}. Update keys:`, { keys: Object.keys(bookingUpdatesFirestore) });
    const firestoreUpdateStartTime = Date.now();
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    logSafe(`${actionContext} Firestore update successful in ${Date.now() - firestoreUpdateStartTime}ms.`);

    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page"); // Changed to 'page' for specific route
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    const finalUpdatedGuestData = convertTimestampsInGuestData(updatedGuestData);
    logSafe(`${actionContext} SUCCESS - Step ${stepNumber} processed.`, { finalMessage: message, updatedGuestDataSummary: { lastStep: finalUpdatedGuestData?.lastCompletedStep, hasEmail: !!finalUpdatedGuestData?.email } });
    return {
        message, errors: null, success: true, actionToken: forActionToken,
        updatedGuestData: finalUpdatedGuestData,
        currentStep: stepNumber -1 
    };

  } catch (error: any) { // Global catch for updateBookingStep
    logSafe(`${actionContext} CRITICAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,1200) }, 'error');
    const guestDataForErrorState = currentGuestDataSnapshot ? convertTimestampsInGuestData(currentGuestDataSnapshot) : (bookingDoc?.guestSubmittedData ? convertTimestampsInGuestData(bookingDoc.guestSubmittedData) : null);
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${error.message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-UEH)`,
        errors: { global: [`Serverfehler (Schritt ${stepName}): ${error.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support. (Code: UBS-UEH-G)`] },
        success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: guestDataForErrorState,
    };
  } finally {
     logSafe(`${actionContext} END. Total time: ${Date.now() - startTime}ms.`);
  }
}

// --- GastStammdaten (Step 1: Hauptgast & Ausweis) ---
const gastStammdatenSchema = z.object({
  anrede: z.enum(["Herr", "Frau", "Divers"], {required_error: "Anrede ist erforderlich."}),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().nullable()
    .refine(val => !val || val.trim() === '' || !isNaN(Date.parse(val)), { message: "Ungültiges Geburtsdatum." })
    .transform(val => val && val.trim() !== '' ? new Date(val).toISOString().split('T')[0] : undefined),
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
  const actionContext = `submitGastStammdatenAction(BookingToken:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code SGA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage, initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SGA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()), prevStateActionToken: prevState?.actionToken?.substring(0,8) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
       logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
       return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SGA-BNF)", actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 1, "Hauptgast & Ausweis", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-UEH)`, errors: { global: [`Serverfehler (Stammdaten): ${error.message} (Code: SGA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Mitreisende (Step 2) ---
const mitreisenderClientSchema = z.object({
  id: z.string(),
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
});
const mitreisendeStepSchema = z.object({
  mitreisendeMeta: z.string().transform((str, ctx) => { // JSON string of {id, vorname, nachname}[]
    if (!str || str.trim() === "") return []; // No companions is valid
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta muss ein Array sein. (Code: UBS-MM-ARR)" });
        return z.NEVER;
      }
      const result = z.array(mitreisenderClientSchema).safeParse(parsed);
      if (!result.success) {
        // Aggregate all nested errors into a single message for mitreisendeMeta if needed
        const fieldErrors = result.error.flatten().fieldErrors;
        let errorMessages: string[] = [];
        Object.entries(fieldErrors).forEach(([key, messages]) => {
            if (Array.isArray(messages)) { messages.forEach(msg => errorMessages.push(`Mitreisender ${key}: ${msg}`)); }
        });
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehler in Mitreisenden-Daten: " + errorMessages.join('; ') + " (Code: UBS-MM-FLD)" });
        return z.NEVER;
      }
      return result.data;
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON. (Code: UBS-MM-JSON)" });
      return z.NEVER;
    }
  }).optional().default([]), // Mitreisende are optional
}).catchall(fileSchema); // Allows dynamic file fields like `mitreisende_comp1_ausweisVorderseiteFile`

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code SMA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage, initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SMA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
   try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()), prevStateActionToken: prevState?.actionToken?.substring(0,8) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SMA-BNF)", actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 2, "Mitreisende", mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SMA-UEH)`, errors: { global: [`Serverfehler (Mitreisende): ${error.message} (Code: SMA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 3: Zahlungssumme wählen ---
const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(["downpayment", "full_amount"], { required_error: "Auswahl der Zahlungssumme ist erforderlich." }),
});
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code SPASA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage, initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SPASA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()), prevStateActionToken: prevState?.actionToken?.substring(0,8) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SPASA-BNF)", actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    
    // Prepare additional data for merging
    const rawFormData = Object.fromEntries(formData.entries());
    const selectedAmount = rawFormData.paymentAmountSelection as "downpayment" | "full_amount";
    let zahlungsbetrag;
    if (selectedAmount === 'downpayment') {
        zahlungsbetrag = parseFloat(((booking.price || 0) * 0.3).toFixed(2));
    } else {
        zahlungsbetrag = booking.price || 0;
    }
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag } as Partial<GuestSubmittedData>;

    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-UEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${error.message} (Code: SPASA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 4: Zahlungsinformationen (Banküberweisung) ---
const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});
export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code SZIA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage, initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SZIA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()), prevStateActionToken: prevState?.actionToken?.substring(0,8) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SZIA-BNF)", actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 4, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now().toDate().toISOString() });
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-UEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${error.message} (Code: SZIA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 5: Übersicht & Bestätigung ---
const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});
export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code SEBA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage, initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SEBA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()), prevStateActionToken: prevState?.actionToken?.substring(0,8) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SEBA-BNF)", actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 5, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-UEH)`, errors: { global: [`Serverfehler (Bestätigung): ${error.message} (Code: SEBA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}


// --- Admin Actions ---
const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich.").default('standard'),
  erwachsene: z.coerce.number({invalid_type_error: "Anzahl Erwachsene muss eine Zahl sein."}).int().min(0, "Anzahl Erwachsene darf nicht negativ sein.").default(1),
  kinder: z.coerce.number({invalid_type_error: "Anzahl Kinder muss eine Zahl sein."}).int().min(0, "Anzahl Kinder darf nicht negativ sein.").optional().default(0),
  kleinkinder: z.coerce.number({invalid_type_error: "Anzahl Kleinkinder muss eine Zahl sein."}).int().min(0, "Anzahl Kleinkinder darf nicht negativ sein.").optional().default(0),
  alterKinder: z.string().optional().default(''),
});

const createBookingServerSchema = z.object({
  guestFirstName: z.string({required_error: "Vorname ist ein Pflichtfeld."}).min(1, "Vorname ist erforderlich."),
  guestLastName: z.string({required_error: "Nachname ist ein Pflichtfeld."}).min(1, "Nachname ist erforderlich."),
  price: z.coerce.number({invalid_type_error: "Preis muss eine Zahl sein.", required_error: "Preis ist ein Pflichtfeld."}).positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string({required_error: "Anreisedatum ist ein Pflichtfeld."}).min(1, "Anreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Anreisedatum." }),
  checkOutDate: z.string({required_error: "Abreisedatum ist ein Pflichtfeld."}).min(1, "Abreisedatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), { message: "Ungültiges Abreisedatum." }),
  verpflegung: z.string({required_error: "Verpflegung ist ein Pflichtfeld."}).min(1, "Verpflegung ist erforderlich.").default('ohne'),
  interneBemerkungen: z.string().optional().default(''),
  roomsData: z.string({ required_error: "Zimmerdaten sind erforderlich." })
    .min(1, "Zimmerdaten dürfen nicht leer sein. Bitte mindestens ein Zimmer hinzufügen. (Code: CBA-RD-EMPTYSTR)")
    .pipe(
      z.string().transform((str, ctx) => {
        try {
          const parsed = JSON.parse(str);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mindestens ein Zimmer muss hinzugefügt werden. (Code: CBA-RD-NOZ)" });
            return z.NEVER;
          }
          return parsed;
        } catch (e: any) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Die Zimmerdaten sind nicht im korrekten JSON-Format. (Code: CBA-RD-JSON)" });
          return z.NEVER;
        }
      }).pipe(
        z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden. (Code: CBA-RD-MIN1)")
          .refine(rooms => rooms.every(room => (room.erwachsene || 0) >= 0 && (room.kinder ?? 0) >= 0 && (room.kleinkinder ?? 0) >= 0), {
            message: "Personenanzahlen in Zimmern dürfen nicht negativ sein. (Code: CBA-RD-PERS)"
          })
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

export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `createBookingAction(Action:${serverActionToken.substring(0,8)})`;
  const startTime = Date.now();
  
  logSafe(actionContext + " BEGIN", { formDataKeys: Array.from(formData.keys()) });

  if (!firebaseInitializedCorrectly || !db) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code CBA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage, initErrorMsg }, 'error');
    return {
        message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: CBA-FIREBASE-INIT-FAIL)`,
        errors: { global: [initErrorMsg] }, success: false, actionToken: serverActionToken, bookingToken: null,
    };
  }

  const rawFormData = Object.fromEntries(formData.entries());
  logSafe(actionContext + " Raw form data received (keys only):", { keys: Object.keys(rawFormData) });
  logSafe(actionContext + " Raw interneBemerkungen:", { value: rawFormData.interneBemerkungen, type: typeof rawFormData.interneBemerkungen });
  logSafe(actionContext + " Raw roomsData:", { value: rawFormData.roomsData, type: typeof rawFormData.roomsData });

  try {
    const validatedFields = createBookingServerSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      logSafe(actionContext + " Zod Validation FAILED", { errors: fieldErrors }, 'warn');
      const errorsOutput: Record<string, string[]> = {};
      for (const key in fieldErrors) {
          const messages = (fieldErrors[key as keyof typeof fieldErrors] || []).map(e => String(e));
          if (key.startsWith('roomsData.') || key === 'roomsData') {
             if (!errorsOutput['roomsData']) errorsOutput['roomsData'] = [];
             (errorsOutput['roomsData'] as string[]).push(...messages);
          } else {
            errorsOutput[key] = messages;
          }
      }
      if (errorsOutput.roomsData) errorsOutput.roomsData = [...new Set(errorsOutput.roomsData)]; // Deduplicate room errors

      return {
        message: "Fehler bei der Validierung. " + (errorsOutput.roomsData ? `Zimmer: ${errorsOutput.roomsData.join('; ')}` : "Prüfen Sie alle Felder."),
        errors: errorsOutput, success: false, actionToken: serverActionToken, bookingToken: null,
      };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Zod Validation SUCCESSFUL. Validated Booking data (partial):", {
        guestFirstName: bookingData.guestFirstName,
        interneBemerkungenType: typeof bookingData.interneBemerkungen,
        interneBemerkungenValue: bookingData.interneBemerkungen,
        roomsDataIsArray: Array.isArray(bookingData.roomsData),
        roomsDataLength: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'N/A',
    });
     if (Array.isArray(bookingData.roomsData)) {
        bookingData.roomsData.forEach((room, index) => {
            logSafe(actionContext + ` Validated Room ${index} data:`, {
                zimmertypType: typeof room.zimmertyp, zimmertypValue: room.zimmertyp,
                alterKinderType: typeof room.alterKinder, alterKinderValue: room.alterKinder,
            });
        });
    }
    
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const errMsg = "Validierung erfolgreich, aber keine Zimmerdaten gefunden. Mindestens ein Zimmer ist erforderlich.";
        logSafe(actionContext + " FAIL - roomsData is not an array or is empty after validation.", { roomsData: bookingData.roomsData }, 'error');
        return {
            message: errMsg + " (Code: CBA-RD-INV2)", errors: { roomsData: [errMsg] },
            success: false, actionToken: serverActionToken, bookingToken: null,
        };
    }
    const firstRoom = bookingData.roomsData[0];

    const zimmertypForIdentifier = String(firstRoom.zimmertyp || 'Standard');
    let personenSummary = `${Number(firstRoom.erwachsene || 0)} Erw.`;
    if (Number(firstRoom.kinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kinder || 0)} Ki.`;
    if (Number(firstRoom.kleinkinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kleinkinder || 0)} Kk.`;
    const roomIdentifierString = `${zimmertypForIdentifier} (${personenSummary})`;

    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || '');
    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'standard'),
        erwachsene: Number(room.erwachsene || 0),
        kinder: Number(room.kinder || 0),
        kleinkinder: Number(room.kleinkinder || 0),
        alterKinder: String(room.alterKinder || ''),
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
      verpflegung: String(bookingData.verpflegung || 'ohne'),
      rooms: finalRoomsData,
      interneBemerkungen: finalInterneBemerkungen,
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 } 
    };
    logSafe(actionContext + " Prepared newBookingPayload for Firestore (partial):", { guestFirstName: newBookingPayload.guestFirstName, roomIdentifier: newBookingPayload.roomIdentifier, roomsCount: newBookingPayload.rooms?.length, interneBemerkungen: newBookingPayload.interneBemerkungen });

    let createdBookingId: string | null = null;
    try {
        createdBookingId = await addBookingToFirestore(newBookingPayload);
    } catch (dbError: any) {
        logSafe(`${actionContext} Firestore addBookingToFirestore FAILED`, { error: dbError.message, code: dbError.code, stack: dbError.stack?.substring(0,500) }, 'error');
        return {
            message: `Datenbankfehler beim Erstellen der Buchung: ${dbError.message}. (Aktions-ID: ${serverActionToken}) (Code: CBA-DBF)`,
            errors: { global: ["Fehler beim Speichern der Buchung in der Datenbank."] },
            success: false, actionToken: serverActionToken, bookingToken: null,
        };
    }

    if (!createdBookingId) {
      const errorMsg = "Datenbankfehler: Buchung konnte nicht erstellt werden (keine ID zurückgegeben). (Code: CBA-DBF-NOID)";
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null or no ID.`, {}, 'error');
      return {
        message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] },
        success: false, actionToken: serverActionToken, bookingToken: null,
      };
    }
    logSafe(`${actionContext} SUCCESS - New booking added. Token: ${newBookingToken}. ID: ${createdBookingId}. Time: ${Date.now() - startTime}ms.`);

    revalidatePath("/admin/dashboard", "page");
    revalidatePath(`/buchung/${newBookingToken}`, "page"); // Changed to 'page'
    revalidatePath(`/admin/bookings/${createdBookingId}`, "page");

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erfolgreich erstellt. Token: ${newBookingToken}`,
      errors: null, success: true, actionToken: serverActionToken,
      bookingToken: newBookingToken,
    };
  } catch (e: any) { // Global catch for createBookingAction
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION in createBookingAction`, { errorName: e.name, errorMessage: e.message, stack: e.stack?.substring(0, 800) }, 'error');
    return {
      message: `Unerwarteter Serverfehler: ${e.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: CBA-UEH)`,
      errors: { global: [`Serverfehler: ${e.message} (Code: CBA-UEH-G)`] },
      success: false, actionToken: serverActionToken, bookingToken: null,
    };
  }
}


export async function deleteBookingsAction(prevState: {success: boolean; message: string; actionToken?: string}, bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction(Action:${serverActionToken.substring(0,8)})`;
  const startTime = Date.now();

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert (Code DBA-FI-01).";
    logSafe(`${actionContext} FAIL - Firebase not initialized correctly.`, { firebaseInitializedCorrectly, dbExists: !!db, storageExists:!!storage, initErrorMsg }, 'error');
    return { success: false, message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: DBA-FNI)`, actionToken: serverActionToken };
  }

  const validBookingIds = Array.isArray(bookingIds) ? bookingIds.filter(id => typeof id === 'string' && id.trim() !== '') : [];
  logSafe(actionContext + " BEGIN", { receivedBookingIdsCount: bookingIds?.length, validBookingIdsCount: validBookingIds.length, idsToProcess: validBookingIds });

  if (validBookingIds.length === 0) {
    logSafe(`${actionContext} No valid booking IDs provided for deletion. Original input:`, { bookingIds }, 'warn');
    return { success: false, message: "Keine gültigen Buchungs-IDs zum Löschen angegeben. (Code: DBA-NVID)", actionToken: serverActionToken };
  }

  try {
    const result = await deleteBookingsFromFirestoreByIds(validBookingIds);

    if (result.success) {
        logSafe(`${actionContext} SUCCESS - ${validBookingIds.length} booking(s) handled for deletion. Message: ${result.message}. Time: ${Date.now() - startTime}ms.`);
        revalidatePath("/admin/dashboard", "page");
        validBookingIds.forEach(id => {
             revalidatePath(`/admin/bookings/${id}`, "page");
        });
    } else {
        logSafe(`${actionContext} OPERATION INDICATED FAILURE or partial failure from deleteBookingsFromFirestoreByIds. Message: ${result.message}. Time: ${Date.now() - startTime}ms.`, {}, 'warn');
        // Revalidate even on partial failure as some might have been deleted
        revalidatePath("/admin/dashboard", "page");
         validBookingIds.forEach(id => {
             revalidatePath(`/admin/bookings/${id}`, "page");
        });
    }
    return { ...result, actionToken: serverActionToken };

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION in deleteBookingsAction`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    let userMessage = `Unerwarteter Serverfehler beim Löschen. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: DBA-UEH)`;
    if (error instanceof Error) {
        userMessage = `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: DBA-UEH)`;
    }
    return { success: false, message: userMessage, actionToken: serverActionToken };
  }
}
