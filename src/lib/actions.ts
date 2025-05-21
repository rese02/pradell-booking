
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

// Simplified logging for sensitive or large data, focusing on structure and existence.
function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
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
  const newGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(data)); // Deep clone

  const processTimestampField = (obj: any, field: string) => {
    if (obj && typeof obj[field] !== 'undefined' && obj[field] !== null) {
      if (obj[field] instanceof Timestamp) { 
        obj[field] = obj[field].toDate().toISOString();
      } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
        obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
      } else if (obj[field] instanceof Date) {
        obj[field] = obj[field].toISOString();
      }
    }
  };

  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
  for (const field of dateFields) {
    processTimestampField(newGuestData, field as string);
  }
  return newGuestData;
}


async function updateBookingStep(
  forActionToken: string,
  bookingId: string,
  stepNumber: number, 
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
  
  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler (UBS-CRIT).";
      logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db, storageExists: !!storage }, 'error');
      return {
        message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${forActionToken})`,
        errors: { global: [`Firebase Konfigurationsfehler. Server-Logs prüfen. (Code: UBS-FNI)`] },
        success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
      };
    }

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
    const validatedFields = actionSchema.safeParse(rawFormData);
    let formErrors: Record<string, string[]> = {};

    if (!validatedFields.success) {
      formErrors = { ...formErrors, ...validatedFields.error.flatten().fieldErrors };
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors, rawFormDataKeys: Object.keys(rawFormData) }, 'warn');
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

    const fileFieldsConfig: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
      step: string;
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
          const err = e instanceof Error ? e : new Error(String(e));
          logSafe(`${actionContext} WARN: Failed to parse mitreisendeMeta for file config.`, { error: err.message, meta: dataFromForm.mitreisendeMeta }, 'warn');
          formErrors['mitreisendeMeta'] = ['Fehler beim Verarbeiten der Mitreisenden-Metadaten. (Code: UBS-MPM)'];
      }
    } else if (stepName === "Zahlungsinfo") {
        fileFieldsConfig.push({ formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl', step: stepName });
    }

    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsConfig.length });

    for (const config of fileFieldsConfig) {
        const file = rawFormData[config.formDataKey] as File | undefined | null;
        let oldFileUrl: string | undefined = undefined;
        const snapshotForOldUrl = bookingDoc.guestSubmittedData || { lastCompletedStep: -1 };
  
        if (config.mitreisenderId && config.mitreisenderUrlKey && snapshotForOldUrl?.mitreisende) {
            const companion = snapshotForOldUrl.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
        } else if (config.guestDataUrlKey) {
            oldFileUrl = (snapshotForOldUrl as any)?.[config.guestDataUrlKey];
        }
  
        if (file instanceof File && file.size > 0) {
            const originalFileName = file.name;

            if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === "") {
                const errorMsg = `Datei für Feld ${config.formDataKey} hat einen ungültigen oder leeren Namen. (Code: UBS-IFN)`;
                logSafe(`${actionContext} WARN: Skipping file for ${config.formDataKey} due to invalid name. Original name: "${originalFileName}"`, { originalFileName }, 'warn');
                formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), errorMsg];
                continue; 
            }
            logSafe(`${actionContext} Processing new file for ${config.formDataKey}: "${originalFileName}" (Size: ${file.size}, Type: ${file.type}). Old URL: ${oldFileUrl ? oldFileUrl.substring(0, 60) + '...' : 'N/A'}`);
            
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
                continue;
            }
  
            if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
                try {
                    logSafe(`${actionContext} Attempting to delete old file: ${oldFileUrl} for ${config.formDataKey}.`);
                    const oldFileStorageRefHandle = storageRefFB(storage, oldFileUrl);
                    await deleteObject(oldFileStorageRefHandle);
                    logSafe(`${actionContext} Old file ${oldFileUrl} deleted for ${config.formDataKey}.`);
                } catch (deleteError: any) {
                    const err = deleteError instanceof Error ? deleteError : new Error(String(deleteError));
                    if (err.message.includes('storage/object-not-found')) { // Check specific error code if available
                        logSafe(`${actionContext} WARN: Old file for ${config.formDataKey} not found in Storage, skipping deletion. URL: ${oldFileUrl}`, {}, 'warn');
                    } else {
                        logSafe(`${actionContext} WARN: Failed to delete old file for ${config.formDataKey} from Storage. URL: ${oldFileUrl}. Code: ${(err as any)?.code}`, { errorName: err.name, errorMessage: err.message }, 'warn');
                    }
                }
            }
  
            let downloadURL: string | undefined;
            try {
                const cleanedFileName = originalFileName.replace(/[^a-zA-Z0-9_.\-]/g, '_');
                const uniqueFileName = `${Date.now()}_${cleanedFileName}`;
                let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;
                if(config.mitreisenderId) { filePathPrefix += `/mitreisende/${config.mitreisenderId}/${(config.mitreisenderUrlKey || 'file').replace('Url', '')}`; }
                else if (config.guestDataUrlKey) { filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`; }
                else { filePathPrefix += `/other/${config.formDataKey}`; }
                const filePath = `${filePathPrefix}/${uniqueFileName}`;
  
                logSafe(`${actionContext} Uploading "${originalFileName}" to Storage path: ${filePath}. Content-Type: ${file.type}`);
                const fileStorageRefHandle = storageRefFB(storage, filePath);
                const uploadStartTime = Date.now();
                await uploadBytes(fileStorageRefHandle, arrayBuffer, { contentType: file.type });
                logSafe(`${actionContext} File "${originalFileName}" uploaded in ${Date.now() - uploadStartTime}ms`);
                
                const getUrlStartTime = Date.now();
                downloadURL = await getDownloadURL(fileStorageRefHandle);
                logSafe(`${actionContext} Got download URL for "${originalFileName}" in ${Date.now() - getUrlStartTime}ms`);
  
            } catch (fileUploadError: any) {
                const err = fileUploadError instanceof Error ? fileUploadError : new Error(String(fileUploadError));
                let userMessage = `Dateiupload für "${originalFileName}" fehlgeschlagen.`;
                const fbErrorCode = (err as any)?.code;
                logSafe(`${actionContext} FIREBASE STORAGE UPLOAD/GET_URL FAIL for "${originalFileName}"`, { errorName: err.name, errorMessage: err.message, code: fbErrorCode }, 'error');
                if (fbErrorCode === 'storage/unauthorized') userMessage = `Berechtigungsfehler: Upload verweigert. Firebase Storage Regeln prüfen. (Code: UBS-FSU)`;
                else if (fbErrorCode === 'storage/canceled') userMessage = `Upload abgebrochen. Bitte erneut versuchen. (Code: UBS-FSC)`;
                else userMessage += ` Details: ${err.message || "Unbekannter Upload-Fehler"}`;
                formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), userMessage];
                continue; 
            }
  
            if (downloadURL) {
              if (config.mitreisenderId && config.mitreisenderUrlKey) {
                  if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                  let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                  if (!companion && stepName === "Mitreisende" && dataFromForm.mitreisendeMeta) {
                      try {
                          const metaArray = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id:string, vorname:string, nachname:string}[];
                          const meta = metaArray.find(m => m.id === config.mitreisenderId);
                          if(meta) {
                              companion = { id: meta.id, vorname: meta.vorname, nachname: meta.nachname };
                              updatedGuestData.mitreisende.push(companion);
                          }
                      } catch(e: any) { /* ignore parsing error */ }
                  }
                  if (companion) { (companion as any)[config.mitreisenderUrlKey] = downloadURL; }
                  else { logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} not found in updatedGuestData.mitreisende for URL assignment.`, {}, 'warn'); }
              } else if (config.guestDataUrlKey) { (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL; }
            }
        } else if (oldFileUrl && typeof oldFileUrl === 'string') {
            if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (companion && !(companion as any)[config.mitreisenderUrlKey]) { (companion as any)[config.mitreisenderUrlKey] = oldFileUrl; }
            } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
                (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
            }
        }
    }
    logSafe(actionContext + " File processing END", { formErrorsCount: Object.keys(formErrors).length });

    if (Object.keys(formErrors).length > 0) {
        logSafe(`${actionContext} Returning due to file processing errors.`, { errors: formErrors });
        return {
            message: "Einige Dateien konnten nicht verarbeitet werden. (Code: UBS-FPE)",
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
              const existingOrFileProcessedCompanion = updatedGuestData.mitreisende?.find(sm => sm.id === cm.id);
              serverMitreisende.push({
                  id: cm.id,
                  vorname: cm.vorname || '',
                  nachname: cm.nachname || '',
                  ausweisVorderseiteUrl: existingOrFileProcessedCompanion?.ausweisVorderseiteUrl,
                  ausweisRückseiteUrl: existingOrFileProcessedCompanion?.ausweisRückseiteUrl,
              });
          }
          updatedGuestData.mitreisende = serverMitreisende;
          logSafe(`${actionContext} Processed mitreisendeMeta. Count: ${serverMitreisende.length}`);
        } catch(e: any) {
            const err = e instanceof Error ? e : new Error(String(e));
            logSafe(`${actionContext} WARN: Failed to process mitreisendeMeta.`, { error: err.message }, 'warn');
            formErrors['mitreisendeMeta'] = ['Fehler beim Verarbeiten der Mitreisenden-Daten. (Code: UBS-MPM2)'];
             return {
                message: "Fehler beim Verarbeiten der Mitreisenden-Daten. (Code: UBS-MPM2-MSG)",
                errors: formErrors, success: false, actionToken: forActionToken,
                currentStep: stepNumber - 1,
                updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
            };
        }
        delete (updatedGuestData as any).mitreisendeMeta;
    }

    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1);

    let bookingStatusUpdate: Partial<Booking> = {};
    if (stepName === "Bestätigung") {
      const agbAkzeptiert = dataFromForm.agbAkzeptiert === true || dataFromForm.agbAkzeptiert === 'on';
      const datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true || dataFromForm.datenschutzAkzeptiert === 'on';

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
        if(bookingDoc.guestFirstName !== dataFromForm.gastVorname || bookingDoc.guestLastName !== dataFromForm.gastNachname) {
            bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname as string;
            bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname as string;
            logSafe(`${actionContext} Hauptgast Name aktualisiert zu: ${dataFromForm.gastVorname} ${dataFromForm.gastNachname}`);
        }
    }
    
    logSafe(`${actionContext} Attempting to update booking in Firestore. Path: ${bookingDoc.id!}. Update keys:`, Object.keys(bookingUpdatesFirestore));
    const firestoreUpdateStartTime = Date.now();
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    logSafe(`${actionContext} Firestore update successful in ${Date.now() - firestoreUpdateStartTime}ms.`);

    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "page");
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} (${stepName}) erfolgreich übermittelt.`;
    if (bookingUpdatesFirestore.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    const finalUpdatedGuestData = convertTimestampsInGuestData(updatedGuestData);
    logSafe(`${actionContext} SUCCESS - Step ${stepNumber} processed.`, { finalMessage: message });
    return {
        message, errors: null, success: true, actionToken: forActionToken,
        updatedGuestData: finalUpdatedGuestData,
        currentStep: stepNumber -1 
    };

  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} CRITICAL UNHANDLED EXCEPTION in updateBookingStep's main try-catch`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,1200) }, 'error');
    const guestDataForErrorState = currentGuestDataSnapshot ? convertTimestampsInGuestData(currentGuestDataSnapshot) : (bookingDoc?.guestSubmittedData ? convertTimestampsInGuestData(bookingDoc.guestSubmittedData) : null);
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${err.message}. Details in Server-Logs. (Aktions-ID: ${forActionToken}) (Code: UBS-UEH)`,
        errors: { global: [`Serverfehler (Schritt ${stepName}): ${err.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support. (Code: UBS-UEH-G)`] },
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
  const actionContext = `submitGastStammdatenAction(BookingToken:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SGA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
       logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
       return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SGA-BNF)", actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 1, "Hauptgast & Ausweis", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SGA-UEH)`, errors: { global: [`Serverfehler (Stammdaten): ${err.message} (Code: SGA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Mitreisende (Step 2) ---
const mitreisenderClientSchema = z.object({
  id: z.string(),
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
});
const mitreisendeStepSchema = z.object({
  mitreisendeMeta: z.string().transform((str, ctx) => {
    if (!str || str.trim() === "") return []; 
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta muss ein Array sein. (Code: UBS-MM-ARR)" });
        return z.NEVER;
      }
      const result = z.array(mitreisenderClientSchema).safeParse(parsed);
      if (!result.success) {
        const fieldErrors = result.error.flatten().fieldErrors;
        let errorMessages: string[] = [];
        Object.entries(fieldErrors).forEach(([key, messages]) => { 
            if (Array.isArray(messages)) { messages.forEach(msg => errorMessages.push(`Mitreisender Index ${key.split('.')[1] || '?'}: ${msg}`)); }
        });
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehler in Mitreisenden-Daten: " + errorMessages.join('; ') + " (Code: UBS-MM-FLD)" });
        return z.NEVER;
      }
      return result.data;
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON. (Code: UBS-MM-JSON)" });
      return z.NEVER;
    }
  }).optional().default([]), 
}).catchall(fileSchema); 

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken.substring(0,8)})`;
   if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SMA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
   try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SMA-BNF)", actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 2, "Mitreisende", mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SMA-UEH)`, errors: { global: [`Serverfehler (Mitreisende): ${err.message} (Code: SMA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SPASA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SPASA-BNF)", actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
    }
    const rawFormData = Object.fromEntries(formData.entries());
    const selectedAmount = rawFormData.paymentAmountSelection as "downpayment" | "full_amount";
    let zahlungsbetrag;
    if (selectedAmount === 'downpayment') { zahlungsbetrag = parseFloat(((booking.price || 0) * 0.3).toFixed(2)); }
    else { zahlungsbetrag = booking.price || 0; }
    
    const additionalData = { zahlungsart: 'Überweisung', zahlungsbetrag } as Partial<GuestSubmittedData>;
    return await updateBookingStep(serverActionToken, booking.id, 3, "Zahlungswahl", paymentAmountSelectionSchema, formData, additionalData);
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SPASA-UEH)`, errors: { global: [`Serverfehler (Zahlungssumme): ${err.message} (Code: SPASA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SZIA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SZIA-BNF)", actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 4, "Zahlungsinfo", zahlungsinformationenSchema, formData, { zahlungsdatum: Timestamp.now().toDate().toISOString() });
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SZIA-UEH)`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${err.message} (Code: SZIA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: SEBA-FNI)`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    logSafe(`${actionContext} Invoked`, { formDataKeys: Array.from(formData.keys()) });
    const booking = await findBookingByTokenFromFirestore(bookingToken);
    if (!booking || !booking.id) {
        logSafe(`${actionContext} Booking with token ${bookingToken} not found.`, {}, 'warn');
        return { ...initialFormState, success: false, message: "Buchung nicht gefunden. (Code: SEBA-BNF)", actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, booking.id, 5, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: err.name, errorMessage: err.message, stack: err.stack?.substring(0,500) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${err.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: SEBA-UEH)`, errors: { global: [`Serverfehler (Bestätigung): ${err.message} (Code: SEBA-UEH-G)`] }, updatedGuestData: prevState.updatedGuestData };
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
    .min(1, "Zimmerdaten dürfen nicht leer sein.")
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
          const err = e instanceof Error ? e : new Error(String(e));
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Die Zimmerdaten sind nicht im korrekten JSON-Format: ${err.message} (Code: CBA-RD-JSON)` });
          return z.NEVER;
        }
      }).pipe(
        z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden. (Code: CBA-RD-MIN1)")
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
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg, firebaseInitializedCorrectly, dbExists: !!db }, 'error');
    return {
        message: `Kritischer Serverfehler: Firebase ist nicht korrekt initialisiert (Code: CBA-FIREBASE-INIT-FAIL). Details: ${initErrorMsg}`,
        errors: { global: [initErrorMsg] }, success: false, actionToken: serverActionToken, bookingToken: null,
    };
  }
  
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(actionContext + " Raw form data received", { interneBemerkungen: rawFormData.interneBemerkungen, roomsDataStringLength: String(rawFormData.roomsData)?.length });

    const validatedFields = createBookingServerSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      const formErrors = validatedFields.error.flatten().formErrors;
      const allErrors = {...fieldErrors, ...(formErrors.length > 0 && { global: formErrors })};
      logSafe(actionContext + " Zod Validation FAILED", { errors: allErrors }, 'warn');
      const errorMessages = Object.entries(allErrors)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('; ');
      return {
        message: `Fehler bei der Validierung. ${errorMessages} (Code: CBA-ZOD-VAL)`,
        errors: allErrors, success: false, actionToken: serverActionToken, bookingToken: null,
      };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Zod Validation SUCCESSFUL. Validated data (types and lengths):", {
      guestFirstName: typeof bookingData.guestFirstName,
      guestLastName: typeof bookingData.guestLastName,
      price: typeof bookingData.price,
      checkInDate: typeof bookingData.checkInDate,
      checkOutDate: typeof bookingData.checkOutDate,
      verpflegung: typeof bookingData.verpflegung,
      interneBemerkungen_type: typeof bookingData.interneBemerkungen,
      interneBemerkungen_length: typeof bookingData.interneBemerkungen === 'string' ? bookingData.interneBemerkungen.length : 'N/A',
      roomsData_type: typeof bookingData.roomsData,
      roomsData_isArray: Array.isArray(bookingData.roomsData),
      roomsData_length: Array.isArray(bookingData.roomsData) ? bookingData.roomsData.length : 'N/A',
    });
    
    if (!Array.isArray(bookingData.roomsData) || bookingData.roomsData.length === 0) {
        const errMsg = "Fehler: Keine gültigen Zimmerdaten nach Validierung gefunden. Mindestens ein Zimmer ist erforderlich.";
        logSafe(actionContext + " FAIL - bookingData.roomsData is not a valid array or is empty after Zod parsing.", { roomsData: bookingData.roomsData }, 'error');
        return {
            message: errMsg + " (Code: CBA-RD-POST-ZOD-EMPTY)", errors: { roomsData: [errMsg] },
            success: false, actionToken: serverActionToken, bookingToken: null,
        };
    }
    
    const firstRoom = bookingData.roomsData[0]; // Safe to access due to the check above
    logSafe(actionContext + " First room details (types and lengths):", { 
        zimmertyp_type: typeof firstRoom.zimmertyp,
        zimmertyp_length: typeof firstRoom.zimmertyp === 'string' ? firstRoom.zimmertyp.length : 'N/A',
        alterKinder_type: typeof firstRoom.alterKinder,
        alterKinder_length: typeof firstRoom.alterKinder === 'string' ? firstRoom.alterKinder.length : 'N/A',
        erwachsene_type: typeof firstRoom.erwachsene,
        kinder_type: typeof firstRoom.kinder,
        kleinkinder_type: typeof firstRoom.kleinkinder,
    });

    const zimmertypForIdentifier = String(firstRoom.zimmertyp || 'Standard');
    let personenSummary = `${Number(firstRoom.erwachsene || 0)} Erw.`;
    if (Number(firstRoom.kinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kinder || 0)} Ki.`;
    if (Number(firstRoom.kleinkinder || 0) > 0) personenSummary += `, ${Number(firstRoom.kleinkinder || 0)} Kk.`;
    const roomIdentifierString = `${zimmertypForIdentifier} (${personenSummary})`;

    const finalInterneBemerkungen = String(bookingData.interneBemerkungen || '');
    const finalRoomsData: RoomDetail[] = bookingData.roomsData.map(room => ({
        zimmertyp: String(room.zimmertyp || 'Standard'),
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
    
    logSafe(actionContext + " Attempting to add booking to Firestore. Payload (key check):", { 
        hasGuestFirstName: 'guestFirstName' in newBookingPayload,
        hasRooms: 'rooms' in newBookingPayload && Array.isArray(newBookingPayload.rooms) && newBookingPayload.rooms.length > 0,
        interneBemerkungenLength: typeof newBookingPayload.interneBemerkungen === 'string' ? newBookingPayload.interneBemerkungen.length : 'N/A',
    });

    const createdBookingId = await addBookingToFirestore(newBookingPayload);
    if (!createdBookingId) {
      const errorMsg = "Datenbankfehler: Buchung konnte nicht erstellt werden (keine ID zurückgegeben). (Code: CBA-DBF-NOID)";
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null.`, {}, 'error');
      return {
        message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] },
        success: false, actionToken: serverActionToken, bookingToken: null,
      };
    }
    logSafe(`${actionContext} SUCCESS - New booking. Token: ${newBookingToken}. ID: ${createdBookingId}. Time: ${Date.now() - startTime}ms.`);
    revalidatePath("/admin/dashboard", "page");
    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Gast-Link kopieren und senden. Token: ${newBookingToken}`,
      errors: null, success: true, actionToken: serverActionToken,
      bookingToken: newBookingToken,
    };
  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Server Action createBookingAction] CRITICAL UNHANDLED EXCEPTION: ${error.message}`, error.stack);
    return {
      message: `Unerwarteter Serverfehler: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: CBA-UEH)`,
      errors: { global: [`Serverfehler: ${error.message} (Code: CBA-UEH-G)`] },
      success: false, actionToken: serverActionToken, bookingToken: null,
    };
  }
}

export async function deleteBookingsAction(
    prevState: {success: boolean; message: string; actionToken?: string}, 
    bookingIds: string[]
): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction(Action:${serverActionToken.substring(0,8)})`;
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: initErrorMsg }, 'error');
    return { success: false, message: `Kritischer Serverfehler: ${initErrorMsg}. (Aktions-ID: ${serverActionToken}) (Code: DBA-FNI)`, actionToken: serverActionToken };
  }

  // Ensure bookingIds is always an array, even if it's passed incorrectly.
  const validBookingIds = Array.isArray(bookingIds) ? bookingIds.filter(id => typeof id === 'string' && id.trim() !== '') : [];
  logSafe(actionContext + " BEGIN", { receivedCount: bookingIds?.length, validCount: validBookingIds.length, ids: validBookingIds });


  if (validBookingIds.length === 0) {
    logSafe(`${actionContext} No valid booking IDs provided for deletion. Original input:`, { bookingIds }, 'warn');
    return { success: false, message: "Keine gültigen Buchungs-IDs zum Löschen angegeben. (Code: DBA-NVID)", actionToken: serverActionToken };
  }

  try {
    const result = await deleteBookingsFromFirestoreByIds(validBookingIds);
    logSafe(`${actionContext} deleteBookingsFromFirestoreByIds result:`, { result });

    if (result.success) {
        revalidatePath("/admin/dashboard", "page");
        validBookingIds.forEach(id => { revalidatePath(`/admin/bookings/${id}`, "page"); });
    }
    return { ...result, actionToken: serverActionToken };

  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Server Action deleteBookingsAction] CRITICAL UNHANDLED EXCEPTION: ${error.message}`, error.stack);
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen: ${error.message}. Details in Server-Logs. (Aktions-ID: ${serverActionToken}) (Code: DBA-UEH)`, actionToken: serverActionToken };
  }
}
