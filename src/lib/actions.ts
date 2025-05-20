
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
} from "./mock-db"; // Points to Firestore operations
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
  const newGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(data)); // Deep clone

  const processTimestampField = (obj: any, field: string) => {
    if (obj && obj[field]) {
      if (typeof obj[field] === 'object' && obj[field] !== null && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
        obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
      } else if (obj[field] instanceof Date) {
        obj[field] = obj[field].toISOString();
      }
    }
  };

  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
  for (const field of dateFields) {
    processTimestampField(newGuestData, field);
  }

  if (newGuestData.mitreisende && Array.isArray(newGuestData.mitreisende)) {
    newGuestData.mitreisende = newGuestData.mitreisende.map(mitreisender => {
      const newMitreisender = { ...mitreisender };
      return newMitreisender;
    });
  }
  return newGuestData;
}

function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const simplifiedData = JSON.stringify(data, (key, value) => {
        if (value instanceof File) { return { name: value.name, size: value.size, type: value.type }; }
        if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack?.substring(0,150) + "...[TRUNCATED_STACK]" }; }
        if (typeof value === 'string' && value.length > 300 && !key.toLowerCase().includes('url')) { return value.substring(0, 150) + "...[TRUNCATED_STRING]"; }
        return value;
    }, 0); // Use 0 for no pretty printing to save space on long logs if needed
    const logMessage = `[ Server ] [${new Date().toISOString()}] ${context} ${simplifiedData.length > 3000 ? simplifiedData.substring(0, 3000) + '... [LOG TRUNCATED]' : simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}

async function updateBookingStep(
  forActionToken: string,
  bookingTokenParam: string,
  stepNumber: number, // 1-indexed for user display, but will be 0-indexed internally for lastCompletedStep
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `updateBookingStep(BookingToken:${bookingTokenParam}, Step:${stepNumber}, ActionToken:${forActionToken})`;
  const startTime = Date.now();
  logSafe(`${actionContext} BEGIN`, { formDataKeys: Array.from(formData.keys()) });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = firebaseInitializationError || `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL).`;
    logSafe(`${actionContext} FAIL - Firebase Not Initialized`, { error: errorMsg }, 'error');
    return {
      message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] },
      success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
    };
  }

  let currentGuestDataSnapshot: GuestSubmittedData | null = null;
  let formErrors: Record<string, string[]> = {};
  const rawFormData = Object.fromEntries(formData.entries());

  try {
    logSafe(`${actionContext} Raw FormData (keys only)`, {keys: Object.keys(rawFormData)});
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      formErrors = { ...formErrors, ...validatedFields.error.flatten().fieldErrors };
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors }, 'warn');
      const bookingForErrorState = await findBookingByTokenFromFirestore(bookingTokenParam);
      currentGuestDataSnapshot = bookingForErrorState?.guestSubmittedData || null;
      return {
          message: "Validierungsfehler. Bitte Eingaben prüfen.", errors: formErrors,
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot)
      };
    }
    const dataFromForm = validatedFields.data;
    logSafe(`${actionContext} Zod validation successful.`, {dataKeys: Object.keys(dataFromForm)});

    const bookingDoc = await findBookingByTokenFromFirestore(bookingTokenParam);
    if (!bookingDoc || !bookingDoc.id) {
      logSafe(`${actionContext} FAIL - Booking NOT FOUND in Firestore with Token:`, { bookingTokenParam }, 'warn');
      return { message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }));

    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestDataSnapshot,
      ...(additionalDataToMerge || {}),
      ...dataFromForm,
    };
    logSafe(`${actionContext} Merged base guest data. Current lastCompletedStep: ${currentGuestDataSnapshot?.lastCompletedStep}`, { mergedKeys: Object.keys(updatedGuestData) });

    const fileFieldsConfig: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
      stepAffiliation: number;
    }> = [
      { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl', stepAffiliation: 1 },
      { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl', stepAffiliation: 1 },
      { formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl', stepAffiliation: 3 }, // Step 3 for Zahlungsinfo
    ];

    if (stepNumber === 2 && dataFromForm.mitreisendeMeta) {
      (dataFromForm.mitreisendeMeta as MitreisenderData[]).forEach((mitreisenderClient) => {
        if (mitreisenderClient.id) {
          fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl', stepAffiliation: 2 });
          fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisenderClient.id}_ausweisRückseiteFile`, mitreisenderId: mitreisenderClient.id, mitreisenderUrlKey: 'ausweisRückseiteUrl', stepAffiliation: 2 });
        }
      });
    }
    
    logSafe(actionContext + " File processing START", { relevantFileFieldsCount: fileFieldsConfig.filter(c => c.stepAffiliation === stepNumber).length });

    for (const config of fileFieldsConfig) {
      if (config.stepAffiliation !== stepNumber) continue;

      const file = rawFormData[config.formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined = undefined;

      if (config.mitreisenderId && config.mitreisenderUrlKey && currentGuestDataSnapshot?.mitreisende) {
          const companion = currentGuestDataSnapshot.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (currentGuestDataSnapshot as any)?.[config.guestDataUrlKey];
      }
      logSafe(`${actionContext} Checking File Field: ${config.formDataKey}`, { hasFile: !!(file && file.size > 0), oldUrl: oldFileUrl });

      if (file instanceof File && file.size > 0) {
        const originalFileName = file.name;

        if (!originalFileName || typeof originalFileName !== 'string' || originalFileName.trim() === '') {
            logSafe(`${actionContext} WARN: File object for ${config.formDataKey} is missing a valid name. Skipping this file.`, { fileObject: file }, 'warn');
            formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), `Datei für ${config.formDataKey} hat keinen gültigen Namen.`];
            continue; // Skip this file
        }
        
        logSafe(`${actionContext} Processing new file for ${config.formDataKey}: ${originalFileName}`, { size: file.size, type: file.type, originalFileNameLength: originalFileName.length });

        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
          try {
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            logSafe(`${actionContext} Old file ${oldFileUrl} deleted for ${config.formDataKey}.`);
          } catch (deleteError: any) {
            logSafe(`${actionContext} WARN: Failed to delete old file ${oldFileUrl} for ${config.formDataKey}. Code: ${deleteError.code}`, { error: deleteError.message }, 'warn');
            // Non-critical, proceed with upload
          }
        }
        
        let downloadURL: string | undefined;
        try {
          const timestamp = Date.now();
          const uniqueFileName = `${timestamp}_${originalFileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
          let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;
          if (config.mitreisenderId) {
              filePathPrefix += `/mitreisende/${config.mitreisenderId}/${(config.mitreisenderUrlKey || 'file').replace('Url', '')}`;
          } else if (config.guestDataUrlKey) {
              filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`;
          }
          const filePath = `${filePathPrefix}/${uniqueFileName}`;
          
          const fileBuffer = await file.arrayBuffer();
          logSafe(`${actionContext} Uploading ${originalFileName} to ${filePath}. Size: ${fileBuffer.byteLength}`);
          
          const fileStorageRef = storageRefFB(storage, filePath);
          await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
          logSafe(`${actionContext} Uploaded ${originalFileName}. Getting download URL...`);

          downloadURL = await getDownloadURL(fileStorageRef);
          logSafe(`${actionContext} Got download URL for ${originalFileName}: ${downloadURL.substring(0,100)}...`);
          
        } catch (fileUploadError: any) {
          let userMessage = `Dateiupload für ${originalFileName} fehlgeschlagen.`;
          const fbErrorCode = (fileUploadError as any).code;
          logSafe(`${actionContext} FILE UPLOAD FAIL for ${originalFileName}`, { error: (fileUploadError as any).message, code: fbErrorCode }, 'error');
          if (fbErrorCode === 'storage/unauthorized') {
            userMessage = `Berechtigungsfehler beim Upload von ${originalFileName}. Bitte Firebase Storage Regeln prüfen.`;
          } else { userMessage += ` Details: ${(fileUploadError as any).message}`; }
          formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), userMessage];
          if (oldFileUrl) { /* Preserve old URL if new upload fails */
            if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) { /* ... */ }
            else if (config.guestDataUrlKey) { (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl; }
          }
          continue; 
        }

        if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey) {
                if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (!companion && stepNumber === 2 && dataFromForm.mitreisendeMeta) {
                    const meta = (dataFromForm.mitreisendeMeta as MitreisenderData[]).find(m => m.id === config.mitreisenderId);
                    if(meta) { companion = { id: meta.id, vorname: meta.vorname, nachname: meta.nachname }; updatedGuestData.mitreisende.push(companion); }
                }
                if (companion) (companion as any)[config.mitreisenderUrlKey] = downloadURL;
                else { logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} not found in updatedGuestData to assign URL for ${config.formDataKey}`, {}, 'warn'); }
            } else if (config.guestDataUrlKey) {
                (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
            }
        }
      } else if (oldFileUrl) { // No new file, old one exists, preserve it
        if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
            const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion && !(companion as any)[config.mitreisenderUrlKey]) { (companion as any)[config.mitreisenderUrlKey] = oldFileUrl; }
        } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
            (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
        }
        logSafe(`${actionContext} No new file for ${config.formDataKey}, kept old URL: ${oldFileUrl ? oldFileUrl.substring(0,100)+'...' : 'N/A'}`);
      }
      delete (dataFromForm as any)[config.formDataKey]; // Clean up File object from dataFromForm
    }
    logSafe(actionContext + " File processing END", { formErrorsCount: Object.keys(formErrors).length });
    
    if (Object.keys(formErrors).length > 0) {
        logSafe(`${actionContext} Returning due to file processing errors.`, { errors: formErrors });
        return {
            message: "Einige Dateien konnten nicht verarbeitet werden.",
            errors: formErrors, success: false, actionToken: forActionToken,
            currentStep: stepNumber - 1,
            updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
        };
    }

    if (stepNumber === 2 && dataFromForm.mitreisendeMeta) {
        const clientMitreisende = dataFromForm.mitreisendeMeta as MitreisenderData[];
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
        delete (updatedGuestData as any).mitreisendeMeta;
        logSafe(`${actionContext} Processed Mitreisende data. Count: ${serverMitreisende.length}`);
    }
    
    // Set lastCompletedStep (0-indexed)
    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1);
    logSafe(`${actionContext} Updated lastCompletedStep to: ${updatedGuestData.lastCompletedStep}`);
    
    const bookingUpdatesFirestore: Partial<Booking> = {
      guestSubmittedData: updatedGuestData,
      updatedAt: Timestamp.now(),
    };
    
    if (stepNumber === 1 && dataFromForm.gastVorname && dataFromForm.gastNachname && bookingDoc) {
        bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname;
        bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname;
    }

    if (stepNumber === 4) { // Final Step: Uebersicht & Bestaetigung
      if (dataFromForm.agbAkzeptiert === true && dataFromForm.datenschutzAkzeptiert === true) {
        updatedGuestData.submittedAt = Timestamp.now();
        bookingUpdatesFirestore.status = "Confirmed"; 
        bookingUpdatesFirestore.guestSubmittedData!.submittedAt = updatedGuestData.submittedAt;
        logSafe(`${actionContext} Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed".`);
      } else {
        logSafe(`${actionContext} Final step, aber AGB/Datenschutz NICHT akzeptiert.`, {}, 'warn');
        const consentErrors: Record<string, string[]> = {};
        if(!dataFromForm.agbAkzeptiert) consentErrors.agbAkzeptiert = ["AGB müssen akzeptiert werden."];
        if(!dataFromForm.datenschutzAkzeptiert) consentErrors.datenschutzAkzeptiert = ["Datenschutz muss akzeptiert werden."];
        return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert.", errors: { ...formErrors, ...consentErrors },
          success: false, actionToken: forActionToken,
          currentStep: stepNumber - 1,
          updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot),
        };
      }
    }
    
    logSafe(`${actionContext} Attempting Firestore update for booking ID: ${bookingDoc.id}.`);
    await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    logSafe(`${actionContext} Firestore update successful.`);
    
    revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "layout");
    revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
    revalidatePath(`/admin/dashboard`, "page");

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`; 
    if (bookingUpdatesFirestore.status === "Confirmed" && stepNumber === 4) { 
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
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION in updateBookingStep`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,500) }, 'error');
    // Ensure currentGuestDataSnapshot is loaded if not already
    if (!currentGuestDataSnapshot) {
        try {
            const bookingOnError = await findBookingByTokenFromFirestore(bookingTokenParam);
            currentGuestDataSnapshot = bookingOnError?.guestSubmittedData || null;
        } catch (fetchError: any) {
            logSafe(`${actionContext} CRITICAL - Failed to fetch booking data even for error recovery`, { fetchError: fetchError.message }, 'error');
        }
    }
    return {
        message: `Unerwarteter Serverfehler (Schritt ${stepNumber}): ${error.message}.`,
        errors: { ...formErrors, global: [`Serverfehler: ${error.message}`] }, success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot || null),
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
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, 
             errors: { global: ["Firebase Initialisierungsfehler"] },
             updatedGuestData: prevState.updatedGuestData 
           };
  }
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 1, gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 0,
             message: `Unerwarteter Serverfehler (Stammdaten): ${error.message}`, 
             errors: { global: [`Serverfehler (Stammdaten): ${error.message}`] },
             updatedGuestData: prevState.updatedGuestData 
           };
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
    if (!str) return [];
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fehler in einzelnen Mitreisenden-Daten: " + errorMessages.join('; ') });
        return z.NEVER;
      }
      return result.data;
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON." });
      return z.NEVER;
    }
  }).optional(),
}).catchall(fileSchema); // Catches all file inputs like `mitreisende_[id]_ausweisVorderseiteFile`

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
   if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, 
             errors: { global: ["Firebase Initialisierungsfehler"] },
             updatedGuestData: prevState.updatedGuestData 
           };
  }
   try {
    return await updateBookingStep(serverActionToken, bookingToken, 2, mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 1,
             message: `Unerwarteter Serverfehler (Mitreisende): ${error.message}`, 
             errors: { global: [`Serverfehler (Mitreisende): ${error.message}`] },
             updatedGuestData: prevState.updatedGuestData 
           };
  }
}

// --- Zahlungsinformationen (Step 3) ---
const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});
export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, 
             errors: { global: ["Firebase Initialisierungsfehler"] },
             updatedGuestData: prevState.updatedGuestData 
           };
  }
  // Determine payment amount based on previous step (paymentAmountSelection)
  const bookingForPayment = await findBookingByTokenFromFirestore(bookingToken);
  if (!bookingForPayment || !bookingForPayment.guestSubmittedData) {
      logSafe(`${actionContext} WARN - Booking or guestSubmittedData not found for payment amount calculation.`, {}, 'warn');
      return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
               message: "Fehler: Buchungsdaten für Zahlungsbetrag nicht gefunden.", errors: {global: ["Buchungsdaten nicht gefunden."]},
               updatedGuestData: prevState.updatedGuestData };
  }
  const price = bookingForPayment.price;
  const paymentAmountSelection = bookingForPayment.guestSubmittedData.paymentAmountSelection;
  const anzahlungsbetrag = parseFloat((price * 0.3).toFixed(2));
  const zuZahlenderBetrag = paymentAmountSelection === 'downpayment' ? anzahlungsbetrag : price;

  const additionalData: Partial<GuestSubmittedData> = {
    zahlungsart: 'Überweisung', // Set by this step
    // zahlungsbetrag: zuZahlenderBetrag, // This is now part of the form and will be validated by Zod
  };

  try {
    return await updateBookingStep(serverActionToken, bookingToken, 3, zahlungsinformationenSchema, formData, additionalData);
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 2,
             message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${error.message}`, 
             errors: { global: [`Serverfehler (Zahlungsinformationen): ${error.message}`] },
             updatedGuestData: prevState.updatedGuestData 
           };
  }
}

// --- Uebersicht & Bestaetigung (Step 4) ---
const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});
export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken?.substring(0,10) });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, 
             errors: { global: ["Firebase Initialisierungsfehler"] },
             updatedGuestData: prevState.updatedGuestData 
           };
  }
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 4, uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, currentStep: 3,
             message: `Unerwarteter Serverfehler (Bestätigung): ${error.message}`, 
             errors: { global: [`Serverfehler (Bestätigung): ${error.message}`] },
             updatedGuestData: prevState.updatedGuestData 
           };
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
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { hasPrevState: !!prevState, formDataKeys: Array.from(formData.keys()) });

  if (!firebaseInitializedCorrectly || !db) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, success: false, actionToken: serverActionToken, bookingToken: null,
             message: `Kritischer Serverfehler: Firebase nicht initialisiert (Code CBA-FIREBASE-INIT-FAIL). Details: ${initErrorMsg}`, 
             errors: { global: ["Firebase Konfigurationsfehler."] }
           };
  }

  try {
    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(actionContext + " Raw FormData (keys)", {keys: Object.keys(rawFormData)});
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

      return { ...initialFormState, errors: errorsOutput, message: "Fehler bei der Validierung. Bitte überprüfen Sie die Eingabefelder.", success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Validation successful.", {dataKeys: Object.keys(bookingData)});

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
    logSafe(`${actionContext} SUCCESS - New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBookingId}. Total time: ${Date.now() - startTime}ms.`);

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
    return { ...initialFormState, message: `Unerwarteter Serverfehler beim Erstellen der Buchung: ${e.message}`, errors: { global: ["Serverfehler beim Erstellen."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction(IDs: ${bookingIds.join(',') || 'N/A'}, Action:${serverActionToken})`;
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { bookingIdsCount: bookingIds.length });
  
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL - Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { success: false, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, actionToken: serverActionToken };
  }

  try {
    if (!bookingIds || bookingIds.length === 0) {
      logSafe(`${actionContext} WARN - No booking IDs provided for deletion.`, {}, 'warn');
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const deleteResult = await deleteBookingsFromFirestoreByIds(bookingIds);
    
    if (deleteResult) {
        logSafe(`${actionContext} SUCCESS - ${bookingIds.length} booking(s) and associated files handled. Total time: ${Date.now() - startTime}ms.`);
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
        logSafe(`${actionContext} PARTIAL FAIL or UNKNOWN ERROR - Some operations may have failed. Total time: ${Date.now() - startTime}ms.`, {}, 'warn');
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: false, message: "Fehler beim Löschen der Buchung(en). Überprüfen Sie die Server-Logs.", actionToken: serverActionToken };
    }

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION - Error deleting bookings:`, { errorName: error.name, errorMessage: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen: ${error.message}`, actionToken: serverActionToken };
  }
}
  

    