
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
} from "./mock-db"; // Corrected to mock-db which now handles Firestore
import { storage, firebaseInitializedCorrectly, db, firebaseInitializationError } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number; // 0-indexed
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
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE_BYTES, { message: `Maximale Dateigröße ist ${MAX_FILE_SIZE_MB}MB.`})
  .refine(
    (file) => !file || file.size === 0 || ACCEPTED_FILE_TYPES.includes(file.type),
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );


function convertTimestampsInGuestData(data?: GuestSubmittedData | null): GuestSubmittedData | null | undefined {
  if (!data) return data;
  
  const newGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(data)); // Deep copy

  const processTimestampField = (obj: any, field: string) => {
    if (obj && obj[field]) {
      if (obj[field] instanceof Timestamp) { // If it's a Firestore Timestamp from direct DB read
        obj[field] = obj[field].toDate().toISOString();
      } else if (typeof obj[field] === 'object' && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) { // If it's a Timestamp-like object from previous serialization
        obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
      } else if (obj[field] instanceof Date) {
        obj[field] = obj[field].toISOString();
      }
      // If it's already an ISO string, leave it.
    }
  };

  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
  for (const field of dateFields) {
    processTimestampField(newGuestData, field);
  }

  if (newGuestData.mitreisende && Array.isArray(newGuestData.mitreisende)) {
    newGuestData.mitreisende = newGuestData.mitreisende.map(mitreisender => {
      const newMitreisender = { ...mitreisender };
      // Potentially process date fields within mitreisender if any
      return newMitreisender;
    });
  }
  return newGuestData;
}

function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    let simplifiedData;
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
            if (value instanceof File) { return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }; }
            if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack?.substring(0,150) + "...[TRUNCATED_STACK]" }; }
            if (typeof value === 'string' && value.length > 300 && !key.toLowerCase().includes('url')) { return value.substring(0, 150) + "...[TRUNCATED_STRING]"; }
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 20) { return "[TRUNCATED_OBJECT_TOO_LARGE]"; }
            return value;
        }, 0); 
    } catch (e) {
        simplifiedData = "[Log data could not be stringified]";
    }
    const logMessage = `[ Server ] [${new Date().toISOString()}] ${context} ${simplifiedData.length > 5000 ? simplifiedData.substring(0, 5000) + '... [LOG TRUNCATED]' : simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}

async function updateBookingStep(
  forActionToken: string,
  bookingTokenParam: string,
  stepNumber: number, // 1-indexed
  stepName: string, // For logging and error messages
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `updateBookingStep(Token:${bookingTokenParam}, Step:${stepNumber}-${stepName}, Action:${forActionToken})`;
  const startTime = Date.now();
  logSafe(`${actionContext} BEGIN`, { formDataKeys: Array.from(formData.keys()) });

  let formErrors: Record<string, string[]> = {};
  let currentGuestDataSnapshot: GuestSubmittedData | null = null;
  let bookingDoc: Booking | null = null;

  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const errorMsg = firebaseInitializationError || `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UBS-FIREBASE-CRITICAL).`;
      logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: errorMsg }, 'error');
      return {
        message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Server-Logs prüfen."] },
        success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
      };
    }
    
    bookingDoc = await findBookingByTokenFromFirestore(bookingTokenParam);
    if (!bookingDoc || !bookingDoc.id) {
      logSafe(`${actionContext} FAIL - Booking NOT FOUND with Token:`, { bookingTokenParam }, 'warn');
      return { message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }));

    const rawFormData = Object.fromEntries(formData.entries());
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      formErrors = { ...formErrors, ...validatedFields.error.flatten().fieldErrors };
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors }, 'warn');
      return {
          message: "Validierungsfehler. Eingaben prüfen.", errors: formErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot)
      };
    }
    const dataFromForm = validatedFields.data;
    let updatedGuestData: GuestSubmittedData = { ...currentGuestDataSnapshot, ...(additionalDataToMerge || {}), ...dataFromForm };
    
    const fileFieldsConfig: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
    }> = [
      { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl' },
      { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl' },
      { formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl' },
    ];
    
    if ((stepNumber === 2 || stepName === "Mitreisende") && dataFromForm.mitreisendeMeta) {
        try {
            const mitreisendeMetaParsed = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id: string}[];
            mitreisendeMetaParsed.forEach((mitreisenderClient) => {
                if (mitreisenderClient.id) {
                    fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl' });
                    fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl' });
                }
            });
        } catch(e: any) { logSafe(`${actionContext} WARN: Failed to parse mitreisendeMeta for file config.`, { error: e.message }, 'warn'); }
    }

    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsConfig.length });
    const timestamp = Date.now();

    for (const config of fileFieldsConfig) {
      const file = rawFormData[config.formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined = undefined;

      if (config.mitreisenderId && config.mitreisenderUrlKey && currentGuestDataSnapshot?.mitreisende) {
          const companion = currentGuestDataSnapshot.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (currentGuestDataSnapshot as any)?.[config.guestDataUrlKey];
      }
      
      if (file instanceof File && file.size > 0) {
        const originalFileName = file.name;

        // --- START Robust file name check ---
        if (typeof originalFileName !== 'string') {
            logSafe(`${actionContext} CRITICAL_WARN: File for ${config.formDataKey} has a non-string name. Skipping.`, { fileNameValue: originalFileName, fileNameType: typeof originalFileName, fileSize: file.size }, 'warn');
            formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), `Datei für Feld ${config.formDataKey} hat einen ungültigen Namenstyp.`];
            continue; 
        }
        if (originalFileName.trim() === '') {
            logSafe(`${actionContext} WARN: File for ${config.formDataKey} has an empty name after trimming. Skipping.`, { originalFileName, fileSize: file.size }, 'warn');
            formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), `Datei für Feld ${config.formDataKey} hat einen leeren Namen.`];
            continue; 
        }
        // --- END Robust file name check ---

        logSafe(`${actionContext} Processing new file for ${config.formDataKey}: "${originalFileName}"`, { size: file.size, type: file.type, oldUrl: oldFileUrl });
        
        let arrayBuffer;
        try {
            const bufferStartTime = Date.now();
            arrayBuffer = await file.arrayBuffer();
            logSafe(`${actionContext} ArrayBuffer for "${originalFileName}" read in ${Date.now() - bufferStartTime}ms`);
        } catch (bufferError: any) {
            logSafe(`${actionContext} FILE BUFFER FAIL for "${originalFileName}"`, { error: bufferError.message, code: bufferError.code }, 'error');
            formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), `Fehler beim Lesen der Datei "${originalFileName}": ${bufferError.message}`];
            continue;
        }

        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
          try {
            logSafe(`${actionContext} Attempting to delete old file: ${oldFileUrl} for ${config.formDataKey}.`);
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            logSafe(`${actionContext} Old file ${oldFileUrl} deleted for ${config.formDataKey}.`);
          } catch (deleteError: any) {
            if ((deleteError as any)?.code === 'storage/object-not-found') {
                logSafe(`${actionContext} WARN: Old file ${oldFileUrl} for ${config.formDataKey} not found. Skipping deletion.`, {}, 'warn');
            } else {
                logSafe(`${actionContext} WARN: Failed to delete old file ${oldFileUrl} for ${config.formDataKey}. Code: ${(deleteError as any)?.code}`, { error: (deleteError as Error).message }, 'warn');
            }
          }
        }
        
        let downloadURL: string | undefined;
        try {
          const originalFileNameCleaned = originalFileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
          const uniqueFileName = `${timestamp}_${originalFileNameCleaned}`;
          let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;
          if (config.mitreisenderId) {
              filePathPrefix += `/mitreisende/${config.mitreisenderId}/${(config.mitreisenderUrlKey || 'file').replace('Url', '')}`;
          } else if (config.guestDataUrlKey) {
              filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`;
          }
          const filePath = `${filePathPrefix}/${uniqueFileName}`;
          
          logSafe(`${actionContext} Uploading "${originalFileName}" to Storage path: ${filePath}. ContentType: ${file.type}`);
          const fileStorageRef = storageRefFB(storage, filePath);
          const uploadStartTime = Date.now();
          await uploadBytes(fileStorageRef, arrayBuffer, { contentType: file.type });
          logSafe(`${actionContext} File "${originalFileName}" uploaded in ${Date.now() - uploadStartTime}ms`);
          
          const getUrlStartTime = Date.now();
          downloadURL = await getDownloadURL(fileStorageRef);
          logSafe(`${actionContext} Got download URL for "${originalFileName}" in ${Date.now() - getUrlStartTime}ms: ${downloadURL}`);
          
        } catch (fileUploadError: any) {
          let userMessage = `Dateiupload für "${originalFileName}" fehlgeschlagen.`;
          const fbErrorCode = fileUploadError?.code;
          logSafe(`${actionContext} FIREBASE STORAGE UPLOAD/GET_URL FAIL for "${originalFileName}"`, { error: fileUploadError?.message, code: fbErrorCode, stack: fileUploadError?.stack?.substring(0,300) }, 'error');
          if (fbErrorCode === 'storage/unauthorized') userMessage = `Berechtigungsfehler: Upload für "${originalFileName}" verweigert. Firebase Storage Regeln prüfen.`;
          else if (fbErrorCode) userMessage += ` Fehlercode: ${fbErrorCode}`;
          else userMessage += ` Details: ${fileUploadError?.message}`;
          
          formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), userMessage];
          if (oldFileUrl) { 
             if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) { 
                const comp = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if(comp) (comp as any)[config.mitreisenderUrlKey] = oldFileUrl;
            }
            else if (config.guestDataUrlKey) { (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl; }
          }
          continue; 
        }

        if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey) {
                if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                 if (!companion && (stepNumber === 2 || stepName === "Mitreisende") && dataFromForm.mitreisendeMeta) { 
                    try {
                        const metaArray = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id:string, vorname:string, nachname:string}[];
                        const meta = metaArray.find(m => m.id === config.mitreisenderId);
                        if(meta) { 
                            companion = { id: meta.id, vorname: meta.vorname, nachname: meta.nachname }; 
                            updatedGuestData.mitreisende.push(companion); 
                        }
                    } catch(e) { /* ignore parsing error */ }
                }
                if (companion) (companion as any)[config.mitreisenderUrlKey] = downloadURL;
                else { logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} not found to assign URL for ${config.formDataKey}`, {}, 'warn'); }
            } else if (config.guestDataUrlKey) {
                (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
            }
        }
      } else if (oldFileUrl) { 
        if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
            const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion && !(companion as any)[config.mitreisenderUrlKey]) { (companion as any)[config.mitreisenderUrlKey] = oldFileUrl; }
        } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
            (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
        }
      }
      delete (dataFromForm as any)[config.formDataKey]; 
    }
    logSafe(actionContext + " File processing END", { formErrorsCount: Object.keys(formErrors).length });
    
    if (Object.keys(formErrors).length > 0) {
        logSafe(`${actionContext} Returning due to file processing errors.`, { errors: formErrors });
        return {
            message: "Einige Dateien konnten nicht verarbeitet werden. Bitte prüfen Sie die Meldungen unten.",
            errors: formErrors, success: false, actionToken: forActionToken,
            currentStep: stepNumber - 1,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
        };
    }

    if ((stepNumber === 2 || stepName === "Mitreisende") && dataFromForm.mitreisendeMeta) {
        try {
          const clientMitreisende = JSON.parse(dataFromForm.mitreisendeMeta as string) as {id: string, vorname: string, nachname: string}[];
          const serverMitreisende: MitreisenderData[] = [];
          for (const cm of clientMitreisende) {
              const existingOrFileProcessedCompanion = updatedGuestData.mitreisende?.find(sm => sm.id === cm.id);
              serverMitreisende.push({
                  id: cm.id, vorname: cm.vorname, nachname: cm.nachname,
                  ausweisVorderseiteUrl: existingOrFileProcessedCompanion?.ausweisVorderseiteUrl,
                  ausweisRückseiteUrl: existingOrFileProcessedCompanion?.ausweisRückseiteUrl,
              });
          }
          updatedGuestData.mitreisende = serverMitreisende;
        } catch(e: any) { logSafe(`${actionContext} WARN: Failed to process mitreisendeMeta. Mitreisende data might be incomplete.`, { error: e.message }, 'warn'); }
        delete (updatedGuestData as any).mitreisendeMeta;
    }
    
    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1);
    
    const bookingUpdatesFirestore: Partial<Booking> = { guestSubmittedData: updatedGuestData };
    
    if ((stepNumber === 1 || stepName === "Stammdaten") && dataFromForm.gastVorname && dataFromForm.gastNachname && bookingDoc) {
        bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname;
        bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname;
    }

    if ((stepNumber === 5 || stepName === "Bestätigung")) { 
      if (updatedGuestData.agbAkzeptiert === true && updatedGuestData.datenschutzAkzeptiert === true) {
        updatedGuestData.submittedAt = Timestamp.now(); // Set as Firestore Timestamp
        bookingUpdatesFirestore.status = "Confirmed"; 
        bookingUpdatesFirestore.guestSubmittedData!.submittedAt = updatedGuestData.submittedAt;
      } else {
        const consentErrors: Record<string, string[]> = {};
        if(!updatedGuestData.agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!updatedGuestData.datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert.", errors: { ...formErrors, ...consentErrors },
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
        };
      }
    }
    
    logSafe(`${actionContext} Attempting Firestore update for booking ID: ${bookingDoc.id}.`);
    const firestoreUpdateStartTime = Date.now();
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    logSafe(`${actionContext} Firestore update successful in ${Date.now() - firestoreUpdateStartTime}ms.`);
    
    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "layout");
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
        currentStep: stepNumber - 1 
    };

  } catch (error: any) { 
    logSafe(`${actionContext} CRITICAL UNHANDLED EXCEPTION in updateBookingStep`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,800) }, 'error');
    const guestDataForError = currentGuestDataSnapshot ? convertTimestampsInGuestData(currentGuestDataSnapshot) : (bookingDoc?.guestSubmittedData ? convertTimestampsInGuestData(bookingDoc.guestSubmittedData) : null);
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepName}): ${error.message}.`,
        errors: { ...formErrors, global: [`Serverfehler (Schritt ${stepName}): ${error.message}`] }, success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: guestDataForError,
    };
  } finally {
     logSafe(`${actionContext} END. Total time: ${Date.now() - startTime}ms.`);
  }
}

// --- GastStammdaten (Step 1) ---
const gastStammdatenSchema = z.object({
  anrede: z.enum(["Frau", "Herr", "Divers"], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => !val || !isNaN(Date.parse(val)) || val === '', { message: "Ungültiges Geburtsdatum."}).transform(val => val === '' ? undefined : val),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
  alterHauptgast: z.string().optional()
    .transform(val => val && val.trim() !== "" ? parseInt(val, 10) : undefined)
    .refine(val => val === undefined || (typeof val === 'number' && !isNaN(val) && val > 0 && val < 120), { message: "Alter muss eine plausible Zahl sein." }),
  hauptgastAusweisVorderseiteFile: fileSchema,
  hauptgastAusweisRückseiteFile: fileSchema,
});

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitGastStammdatenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  try {
    logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
               message: `Kritischer Serverfehler: ${initErrorMsg}`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, bookingToken, 1, "Stammdaten", gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${error.message}`, errors: { global: [`Serverfehler (Stammdaten): ${error.message}`] }, updatedGuestData: prevState.updatedGuestData };
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta muss ein Array sein." });
        return z.NEVER;
      }
      const result = z.array(mitreisenderClientSchema).safeParse(parsed);
      if (!result.success) {
        const fieldErrors = result.error.flatten().fieldErrors;
        let errorMessages: string[] = [];
        Object.entries(fieldErrors).forEach(([key, messages]) => {
            if (Array.isArray(messages)) { messages.forEach(msg => errorMessages.push(`Mitreisender ${key}: ${msg}`)); }
        });
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehler in Mitreisenden-Daten: " + errorMessages.join('; ') });
        return z.NEVER;
      }
      return result.data;
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON." });
      return z.NEVER;
    }
  }).optional().default([]),
}).catchall(fileSchema); 

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken})`;
   try {
    logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
               message: `Kritischer Serverfehler: ${initErrorMsg}`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, bookingToken, 2, "Mitreisende", mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${error.message}`, errors: { global: [`Serverfehler (Mitreisende): ${error.message}`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 3: Zahlungssumme wählen ---
const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(["downpayment", "full_amount"], { required_error: "Auswahl der Zahlungssumme ist erforderlich." }),
});
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken})`;
  try {
    logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
               message: `Kritischer Serverfehler: ${initErrorMsg}`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, bookingToken, 3, "Zahlungssumme", paymentAmountSelectionSchema, formData, { zahlungsart: 'Überweisung' });
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungssumme): ${error.message}`, errors: { global: [`Serverfehler (Zahlungssumme): ${error.message}`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 4: Zahlungsinformationen (Banküberweisung) ---
const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});
export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  try {
    logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3, 
               message: `Kritischer Serverfehler: ${initErrorMsg}`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, bookingToken, 4, "Zahlungsinformationen", zahlungsinformationenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${error.message}`, errors: { global: [`Serverfehler (Zahlungsinformationen): ${error.message}`] }, updatedGuestData: prevState.updatedGuestData };
  }
}

// --- Step 5: Übersicht & Bestätigung ---
const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});
export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken})`;
  try {
    logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4, 
               message: `Kritischer Serverfehler: ${initErrorMsg}`, errors: { global: [initErrorMsg] }, updatedGuestData: prevState.updatedGuestData };
    }
    return await updateBookingStep(serverActionToken, bookingToken, 5, "Bestätigung", uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 4,
             message: `Unerwarteter Serverfehler (Bestätigung): ${error.message}`, errors: { global: [`Serverfehler (Bestätigung): ${error.message}`] }, updatedGuestData: prevState.updatedGuestData };
  }
}


// --- Admin Actions ---
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
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mindestens ein Zimmer muss hinzugefügt werden." });
            return z.NEVER;
          }
          return parsed;
        } catch (e) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Die Zimmerdaten sind nicht im korrekten JSON-Format." });
          return z.NEVER; 
        }
      }).pipe( 
        z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden.")
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
  try {
    const startTime = Date.now();
    logSafe(actionContext + " BEGIN", { hasPrevState: !!prevState, formDataKeys: Array.from(formData.keys()) });

    if (!firebaseInitializedCorrectly || !db) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { ...initialFormState, success: false, actionToken: serverActionToken, bookingToken: null,
               message: `Kritischer Serverfehler: ${initErrorMsg}`, errors: { global: [initErrorMsg] } };
    }

    const rawFormData = Object.fromEntries(formData.entries());
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

      return { ...initialFormState, errors: errorsOutput, message: "Fehler bei der Validierung.", success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const bookingData = validatedFields.data;
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
      checkInDate: new Date(bookingData.checkInDate),
      checkOutDate: new Date(bookingData.checkOutDate),
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
      logSafe(`${actionContext} FAIL - addBookingToFirestore returned null or no ID.`, {}, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    logSafe(`${actionContext} SUCCESS - New booking added. Token: ${newBookingToken}. ID: ${createdBookingId}. Time: ${Date.now() - startTime}ms.`);

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
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION`, { errorName: e.name, errorMessage: e.message, stack: e.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler: ${e.message}`, errors: { global: ["Serverfehler."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction(IDs: ${bookingIds.join(',') || 'N/A'}, Action:${serverActionToken})`;
  try {
    const startTime = Date.now();
    logSafe(actionContext + " BEGIN", { bookingIdsCount: bookingIds.length });
    
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const initErrorMsg = firebaseInitializationError || "Firebase nicht initialisiert.";
      return { success: false, message: `Kritischer Serverfehler: ${initErrorMsg}`, actionToken: serverActionToken };
    }

    if (!bookingIds || bookingIds.length === 0) {
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const deleteResult = await deleteBookingsFromFirestoreByIds(bookingIds); 
    
    if (deleteResult) {
        logSafe(`${actionContext} SUCCESS - ${bookingIds.length} booking(s) handled. Time: ${Date.now() - startTime}ms.`);
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
        logSafe(`${actionContext} PARTIAL FAIL or UNKNOWN ERROR - Some ops may have failed. Time: ${Date.now() - startTime}ms.`, {}, 'warn');
        revalidatePath("/admin/dashboard", "layout"); 
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: false, message: "Fehler beim Löschen der Buchung(en). Server-Logs prüfen.", actionToken: serverActionToken };
    }

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen: ${error.message}`, actionToken: serverActionToken };
  }
}
    
