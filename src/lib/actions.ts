
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
} from "./mock-db"; // This now contains Firestore operations
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

// Helper to convert Firestore Timestamps in GuestSubmittedData to ISO strings for client
function convertTimestampsInGuestData(data?: GuestSubmittedData | null): GuestSubmittedData | null | undefined {
  if (!data) return data;
  
  // Deep clone to avoid modifying the original object, especially Timestamps which are objects
  const newGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(data));

  const processTimestampField = (obj: any, field: string) => {
    if (obj && obj[field]) {
      // Firestore Timestamps might be plain objects with seconds/nanoseconds after stringify/parse
      if (typeof obj[field] === 'object' && obj[field] !== null && 'seconds' in obj[field] && 'nanoseconds' in obj[field]) {
        obj[field] = new Timestamp(obj[field].seconds, obj[field].nanoseconds).toDate().toISOString();
      } else if (obj[field] instanceof Date) {
        obj[field] = obj[field].toISOString();
      }
      // If it's already a string, assume it's correctly formatted or null/undefined
    }
  };

  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum'];
  for (const field of dateFields) {
    processTimestampField(newGuestData, field);
  }

  if (newGuestData.mitreisende && Array.isArray(newGuestData.mitreisende)) {
    newGuestData.mitreisende = newGuestData.mitreisende.map(mitreisender => {
      const newMitreisender = { ...mitreisender };
      // Add any date fields for Mitreisender here if they exist
      return newMitreisender;
    });
  }
  return newGuestData;
}

// Schemas for GuestBookingFormStepper
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

const mitreisenderClientSchema = z.object({
  id: z.string(),
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
});
type MitreisenderClientData = z.infer<typeof mitreisenderClientSchema>;

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
            if (Array.isArray(messages)) {
              messages.forEach(msg => errorMessages.push(`Mitreisender ${key}: ${msg}`));
            }
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
}).catchall(fileSchema);

const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(['downpayment', 'full_amount'], { required_error: "Bitte wählen Sie eine Zahlungssumme." }),
});

const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.coerce.number({invalid_type_error: "Überwiesener Betrag ist ungültig."}).positive("Überwiesener Betrag muss eine positive Zahl sein."),
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den AGB zustimmen." })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, { message: "Sie müssen den Datenschutzbestimmungen zustimmen." })),
});


function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const simplifiedData = JSON.stringify(data, (key, value) => {
        if (value instanceof File) { return { name: value.name, size: value.size, type: value.type }; }
        if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack?.substring(0,150) + "...[TRUNCATED_STACK]" }; }
        if (typeof value === 'string' && value.length > 300 && !key.toLowerCase().includes('url')) { return value.substring(0, 150) + "...[TRUNCATED_STRING]"; }
        return value;
    }, 0);
    const logMessage = `[Action ${context}] ${simplifiedData.length > 3000 ? simplifiedData.substring(0, 3000) + '... [LOG TRUNCATED]' : simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}

async function updateBookingStep(
  forActionToken: string,
  bookingTokenParam: string,
  stepNumber: number, // 1-indexed
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const actionContext = `updateBookingStep(Token:${bookingTokenParam}, Step:${stepNumber}, ActionToken:${forActionToken})`;
  const startTime = Date.now();
  logSafe(`${actionContext} BEGIN]`, { formDataKeys: Array.from(formData.keys()) });

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = firebaseInitializationError || `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL).`;
    logSafe(`${actionContext} FAIL] Firebase Not Initialized`, { error: errorMsg }, 'error');
    return {
      message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] },
      success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
    };
  }

  let currentGuestDataSnapshot: GuestSubmittedData | null | undefined = null;
  let formErrors: Record<string, string[]> = {};

  try {
    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(`${actionContext} Raw FormData (keys)`, {keys: Object.keys(rawFormData)});
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      formErrors = { ...formErrors, ...validatedFields.error.flatten().fieldErrors };
      logSafe(`${actionContext} Zod Validation FAILED`, { errors: formErrors }, 'warn');
      const bookingForErrorState = await findBookingByTokenFromFirestore(bookingTokenParam);
      currentGuestDataSnapshot = bookingForErrorState?.guestSubmittedData;
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
      logSafe(`${actionContext} FAIL] Booking NOT FOUND in Firestore with Token:`, { bookingTokenParam }, 'warn');
      return { message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
    }
    currentGuestDataSnapshot = JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData || { lastCompletedStep: -1 }));

    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestDataSnapshot,
      ...(additionalDataToMerge || {}),
      ...dataFromForm,
    };
    logSafe(`${actionContext} Merged base guest data.`, { keys: Object.keys(updatedGuestData) });

    const fileFieldsConfig: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof Pick<GuestSubmittedData, 'hauptgastAusweisVorderseiteUrl' | 'hauptgastAusweisRückseiteUrl' | 'zahlungsbelegUrl'>;
      mitreisenderId?: string;
      mitreisenderUrlKey?: keyof Pick<MitreisenderData, 'ausweisVorderseiteUrl' | 'ausweisRückseiteUrl'>;
      stepAffiliation: number;
    }> = [
      { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl', stepAffiliation: 1 },
      { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl', stepAffiliation: 1 },
      { formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl', stepAffiliation: 4 },
    ];

    if (stepNumber === 2 && dataFromForm.mitreisendeMeta) {
      (dataFromForm.mitreisendeMeta as MitreisenderClientData[]).forEach((mitreisenderClient) => {
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

      // Determine old file URL
      if (config.mitreisenderId && config.mitreisenderUrlKey && currentGuestDataSnapshot?.mitreisende) {
          const companion = currentGuestDataSnapshot.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (currentGuestDataSnapshot as any)?.[config.guestDataUrlKey];
      }
      logSafe(`${actionContext} File Field: ${config.formDataKey}`, { hasFile: !!(file && file.size > 0), oldUrl: oldFileUrl });

      if (file instanceof File && file.size > 0) {
        const originalFileName = file.name;
        logSafe(`${actionContext} Processing new file for ${config.formDataKey}: ${originalFileName}`, { size: file.size, type: file.type });

        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
          try {
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            logSafe(`${actionContext} Old file ${oldFileUrl} deleted for ${config.formDataKey}.`);
          } catch (deleteError: any) {
            logSafe(`${actionContext} WARN: Failed to delete old file ${oldFileUrl} for ${config.formDataKey}`, { error: deleteError.message, code: deleteError.code }, 'warn');
            formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), `Alte Datei ${originalFileName} konnte nicht gelöscht werden: ${deleteError.message}`];
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
          
          logSafe(`${actionContext} Reading ArrayBuffer for ${originalFileName}.`);
          const fileBuffer = await file.arrayBuffer();
          logSafe(`${actionContext} Uploading ${originalFileName} to ${filePath}. Size: ${fileBuffer.byteLength}`);
          
          const fileStorageRef = storageRefFB(storage, filePath);
          await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
          logSafe(`${actionContext} Uploaded ${originalFileName}.`);

          downloadURL = await getDownloadURL(fileStorageRef);
          logSafe(`${actionContext} Got download URL for ${originalFileName}: ${downloadURL}`);
          
        } catch (fileUploadError: any) {
          let userMessage = `Dateiupload für ${originalFileName} fehlgeschlagen.`;
          const fbErrorCode = (fileUploadError as any).code;
          logSafe(`${actionContext} FILE UPLOAD FAIL for ${originalFileName}`, { error: (fileUploadError as any).message, code: fbErrorCode }, 'error');
          if (fbErrorCode === 'storage/unauthorized') {
            userMessage = `Berechtigungsfehler beim Upload von ${originalFileName}. Bitte Firebase Storage Regeln prüfen.`;
          } else if (fbErrorCode === 'storage/canceled') {
            userMessage = `Upload von ${originalFileName} abgebrochen.`;
          } else if (fbErrorCode === 'storage/unknown') {
             userMessage = `Unbekannter Fehler beim Upload von ${originalFileName}.`;
          } else {
            userMessage += ` Details: ${(fileUploadError as any).message}`;
          }
          formErrors[config.formDataKey] = [...(formErrors[config.formDataKey] || []), userMessage];
          // Keep old URL if upload fails and old one existed
          if (oldFileUrl) {
            if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
              const comp = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
              if (comp) (comp as any)[config.mitreisenderUrlKey] = oldFileUrl;
            } else if (config.guestDataUrlKey) {
              (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
            }
          }
          continue; 
        }

        if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey) {
                if (!updatedGuestData.mitreisende) updatedGuestData.mitreisende = [];
                let companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
                if (!companion && stepNumber === 2 && dataFromForm.mitreisendeMeta) {
                    const meta = (dataFromForm.mitreisendeMeta as MitreisenderClientData[]).find(m => m.id === config.mitreisenderId);
                    if(meta) {
                      companion = { id: meta.id, vorname: meta.vorname, nachname: meta.nachname };
                      updatedGuestData.mitreisende.push(companion);
                    }
                }
                if (companion) (companion as any)[config.mitreisenderUrlKey] = downloadURL;
                else { logSafe(`${actionContext} WARN: Companion with ID ${config.mitreisenderId} not found in updatedGuestData to assign URL for ${config.formDataKey}`, {}, 'warn'); }
            } else if (config.guestDataUrlKey) {
                (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
            }
        }
      } else if (oldFileUrl) {
        // No new file, but an old one exists. Ensure it's preserved if not already set by a (failed) new upload attempt.
        if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
            const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
            if (companion && !(companion as any)[config.mitreisenderUrlKey]) {
                 (companion as any)[config.mitreisenderUrlKey] = oldFileUrl;
            }
        } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
            (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
        }
        logSafe(`${actionContext} No new file for ${config.formDataKey}, kept old URL: ${oldFileUrl}`);
      }
      // Remove the temporary file field from dataFromForm to prevent it being directly merged into updatedGuestData
      delete (dataFromForm as any)[config.formDataKey];
    }
    logSafe(actionContext + " File processing END", {});
    
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
        const clientMitreisende = dataFromForm.mitreisendeMeta as MitreisenderClientData[];
        const serverMitreisende: MitreisenderData[] = [];

        for (const cm of clientMitreisende) {
            const existingOrFileProcessedCompanion = updatedGuestData.mitreisende?.find(sm => sm.id === cm.id);
            serverMitreisende.push({
                id: cm.id,
                vorname: cm.vorname,
                nachname: cm.nachname,
                ausweisVorderseiteUrl: existingOrFileProcessedCompanion?.ausweisVorderseiteUrl,
                ausweisRückseiteUrl: existingOrFileProcessedCompanion?.ausweisRückseiteUrl,
            });
        }
        updatedGuestData.mitreisende = serverMitreisende;
        delete (updatedGuestData as any).mitreisendeMeta; // Clean up meta field
        logSafe(`${actionContext} Processed Mitreisende data. Count: ${serverMitreisende.length}`);
    }
    
    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot?.lastCompletedStep ?? -1, stepNumber - 1);
    
    if (stepNumber === 3) { // "Zahlungssumme wählen"
      // paymentAmountSelection is already in dataFromForm and merged
    } else if (stepNumber === 4) { // "Zahlungsinformationen"
      updatedGuestData.zahlungsart = 'Überweisung';
      // zahlungsbetrag and zahlungsbelegUrl are handled by dataFromForm and file processing
    }

    const bookingUpdatesFirestore: Partial<Booking> = {
      guestSubmittedData: updatedGuestData,
      updatedAt: Timestamp.now(),
    };
    
    if (stepNumber === 1 && dataFromForm.gastVorname && dataFromForm.gastNachname) {
        bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname;
        bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname;
    }

    if (stepNumber === 5) { // Übersicht & Bestätigung (last step)
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
    if (bookingUpdatesFirestore.status === "Confirmed" && stepNumber === 5) { 
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return { 
        message, errors: null, success: true, actionToken: forActionToken, 
        updatedGuestData: convertTimestampsInGuestData(updatedGuestData),
        currentStep: stepNumber - 1 
    };

  } catch (error: any) { 
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION in updateBookingStep`, { error: error.message, stack: error.stack?.substring(0,500) }, 'error');
    return {
        message: `Unerwarteter Serverfehler in Schritt ${stepNumber}: ${error.message}. Bitte versuchen Sie es erneut oder kontaktieren Sie den Support.`,
        errors: { ...formErrors, global: [`Serverfehler: ${error.message}`] }, success: false, actionToken: forActionToken,
        currentStep: stepNumber - 1,
        updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot || null),
    };
  } finally {
     logSafe(`${actionContext} END]. Total time: ${Date.now() - startTime}ms.`);
  }
}

// --- Server Actions for each step ---
export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitGastStammdatenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, success: false, actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 1, gastStammdatenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Stammdaten): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 0, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
  }
   try {
    return await updateBookingStep(serverActionToken, bookingToken, 2, mitreisendeStepSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Mitreisende): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitPaymentAmountSelectionAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, success: false, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 3, paymentAmountSelectionSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Zahlungssumme): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 2, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, success: false, actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 4, zahlungsinformationenSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Zahlungsinformationen): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 3, updatedGuestData: prevState.updatedGuestData };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction(Token:${bookingToken}, Action:${serverActionToken})`;
  logSafe(`${actionContext} Invoked`, { prevStateActionToken: prevState?.actionToken });
  if (!firebaseInitializedCorrectly || !db || !storage) {
    const initErrorMsg = firebaseInitializationError || "Unbekannter Firebase Initialisierungsfehler.";
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, success: false, actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
  }
  try {
    return await updateBookingStep(serverActionToken, bookingToken, 5, uebersichtBestaetigungSchema, formData, {});
  } catch (error: any) {
    logSafe(`${actionContext} TOP-LEVEL UNCAUGHT EXCEPTION`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler (Bestätigung): ${error.message}`, success: false, actionToken: serverActionToken, currentStep: 4, updatedGuestData: prevState.updatedGuestData };
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
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Mindestens ein Zimmer muss hinzugefügt werden.",
            });
            return z.NEVER;
          }
          return parsed;
        } catch (e) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Die Zimmerdaten sind nicht im korrekten JSON-Format.",
          });
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
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { ...initialFormState, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, errors: { global: ["Firebase Konfigurationsfehler."] }, success: false, actionToken: serverActionToken, bookingToken: null };
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
      logSafe(`${actionContext} FAIL] addBookingToFirestore returned null or no ID.`, {}, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    logSafe(`${actionContext} SUCCESS] New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBookingId}. Total time: ${Date.now() - startTime}ms.`);

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
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION]:`, { error: e.message, stack: e.stack?.substring(0,300) }, 'error');
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
    logSafe(`${actionContext} FAIL] Firebase not initialized. Error: ${initErrorMsg}`, {}, 'error');
    return { success: false, message: `Kritischer Serverfehler: Firebase nicht initialisiert. Details: ${initErrorMsg}`, actionToken: serverActionToken };
  }

  try {
    if (!bookingIds || bookingIds.length === 0) {
      logSafe(`${actionContext} WARN] No booking IDs provided for deletion.`, {}, 'warn');
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const deleteResult = await deleteBookingsFromFirestoreByIds(bookingIds);
    
    if (deleteResult) {
        logSafe(`${actionContext} SUCCESS] ${bookingIds.length} booking(s) and associated files handled. Total time: ${Date.now() - startTime}ms.`);
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
        logSafe(`${actionContext} PARTIAL FAIL or UNKNOWN ERROR] Some operations may have failed. Total time: ${Date.now() - startTime}ms.`, {}, 'warn');
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: false, message: "Fehler beim Löschen der Buchung(en). Überprüfen Sie die Server-Logs.", actionToken: serverActionToken };
    }

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT EXCEPTION] Error deleting bookings:`, { error: error.message, stack: error.stack?.substring(0,300) }, 'error');
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen: ${error.message}`, actionToken: serverActionToken };
  }
}
  