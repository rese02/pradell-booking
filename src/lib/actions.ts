
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, Mitreisender, RoomDetail } from "@/lib/definitions";
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
    (file) => {
      if (!file || file.size === 0) return true; 
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur JPG, PNG, WEBP, PDF Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

const gastStammdatenSchema = z.object({
  anrede: z.enum(["Frau", "Herr", "Divers"], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => !val || !isNaN(Date.parse(val)), { message: "Ungültiges Geburtsdatum."}),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
  alterHauptgast: z.string().optional()
    .transform(val => val && val.trim() !== "" ? parseInt(val, 10) : undefined)
    .refine(val => val === undefined || (typeof val === 'number' && !isNaN(val) && val > 0 && val < 120), { message: "Alter muss eine plausible Zahl sein." }),
  hauptgastAusweisVorderseiteFile: fileSchema,
  hauptgastAusweisRückseiteFile: fileSchema,
});

const mitreisenderEinzelschema = z.object({
  id: z.string(),
  vorname: z.string().min(1, "Vorname des Mitreisenden ist erforderlich."),
  nachname: z.string().min(1, "Nachname des Mitreisenden ist erforderlich."),
});

const mitreisendeSchema = z.object({
  mitreisendeMeta: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta muss ein Array sein." });
        return z.NEVER;
      }
      return parsed;
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MitreisendeMeta ist kein gültiges JSON." });
      return z.NEVER;
    }
  }).pipe(z.array(mitreisenderEinzelschema).optional()),
});


const paymentAmountSelectionSchema = z.object({
  paymentAmountSelection: z.enum(['downpayment', 'full_amount'], { required_error: "Bitte wählen Sie eine Zahlungssumme." }),
});

const zahlungsinformationenSchema = z.object({
  zahlungsbelegFile: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich." }),
  zahlungsbetrag: z.string().transform(val => parseFloat(val)).refine(val => !isNaN(val) && val > 0, "Überwiesener Betrag muss eine positive Zahl sein."),
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den AGB zustimmen.",
  })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
  })),
});


function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const simplifiedData = JSON.stringify(data, (key, value) => {
        if (value instanceof File) { return { name: value.name, size: value.size, type: value.type }; }
        if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url')) { return value.substring(0, 100) + "...[TRUNCATED]"; }
        if (value instanceof Error) { return { message: value.message, name: value.name, stack: value.stack?.substring(0,100) + "...[TRUNCATED]" }; }
        return value;
    }, 2);
    const logMessage = `[Action ${context}] ${simplifiedData.length > 2000 ? simplifiedData.substring(0, 2000) + '... [LOG TRUNCATED]' : simplifiedData}`;
    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}

// Helper function to convert Firestore Timestamps in GuestSubmittedData to ISO strings
function convertTimestampsInGuestData(data?: GuestSubmittedData | null): GuestSubmittedData | null | undefined {
  if (!data) return data;
  const newGuestData = { ...data };
  const dateFields: (keyof GuestSubmittedData)[] = ['submittedAt', 'geburtsdatum', 'zahlungsdatum']; 

  for (const field of dateFields) {
    const value = newGuestData[field];
    if (value instanceof Timestamp) {
      (newGuestData[field] as any) = value.toDate().toISOString();
    } else if (value instanceof Date) {
      (newGuestData[field] as any) = value.toISOString();
    }
  }
  if (newGuestData.mitreisende) {
    newGuestData.mitreisende = newGuestData.mitreisende.map(m => {
        const newM = {...m};
        // Assuming mitreisende might have date fields to convert in future
        return newM;
    });
  }
  return newGuestData;
}


async function updateBookingStep(
  forActionToken: string,
  bookingTokenParam: string, // Changed from bookingId to bookingTokenParam
  stepNumber: number, // 1-indexed step number
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>,
  mitreisendeMetaDaten?: Mitreisender[]
): Promise<FormState> {
  const actionContext = `updateBookingStep - Token: "${bookingTokenParam}" - Step ${stepNumber} - ActionToken: ${forActionToken}`;
  logSafe(`${actionContext} BEGIN] Timestamp: ${new Date().toISOString()}`, { stepNumber, formDataKeys: Array.from(formData.keys()), hasAdditionalData: !!additionalDataToMerge });
  const startTime = Date.now();

  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const errorMsg = `Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL). DB: ${!!db}, Storage: ${!!storage}, InitializedCorrectly: ${firebaseInitializedCorrectly}. Init Error: ${firebaseInitializationError || "N/A"}`;
      logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
      return {
        message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] },
        success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null
      };
    }

    let rawFormData: Record<string, any>;
    try {
      rawFormData = Object.fromEntries(formData.entries());
    } catch (e: any) {
      logSafe(`${actionContext} CRITICAL] Error converting FormData:`, { error: e.message }, 'error');
      return { ...initialFormState, message: "Serverfehler: Formularverarbeitung fehlgeschlagen.", errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: forActionToken, currentStep: stepNumber -1, updatedGuestData: null };
    }

    const validatedFields = actionSchema.safeParse(rawFormData);
    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      logSafe(`${actionContext} Validation FAILED`, { errors: fieldErrors }, 'warn');
      return { ...initialFormState, errors: fieldErrors, message: "Validierungsfehler. Bitte Eingaben prüfen.", success: false, actionToken: forActionToken, currentStep: stepNumber -1, updatedGuestData: null };
    }

    const dataFromForm = validatedFields.data;
    logSafe(`${actionContext} Zod validation successful.`, {dataKeys: Object.keys(dataFromForm)});

    const bookingDoc = await findBookingByTokenFromFirestore(bookingTokenParam); 
    if (!bookingDoc || !bookingDoc.id) {
      logSafe(`${actionContext} FAIL] Booking NOT FOUND in Firestore with Token:`, { bookingTokenParam }, 'warn');
      return { ...initialFormState, message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: forActionToken, currentStep: stepNumber - 1, updatedGuestData: null };
    }
    logSafe(`${actionContext} Booking found. ID: ${bookingDoc.id}, Status: ${bookingDoc.status}. Current guest data:`, bookingDoc.guestSubmittedData || {});

    const currentGuestDataSnapshot: GuestSubmittedData = bookingDoc.guestSubmittedData ? JSON.parse(JSON.stringify(bookingDoc.guestSubmittedData)) : { lastCompletedStep: -1 };
    
    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestDataSnapshot,
      ...(additionalDataToMerge || {}),
      ...dataFromForm,
    };

    if (mitreisendeMetaDaten && stepNumber === 2) { 
        updatedGuestData.mitreisende = mitreisendeMetaDaten.map(meta => {
            const existingMitreisender = currentGuestDataSnapshot.mitreisende?.find(m => m.id === meta.id);
            return {
                ...meta, 
                ausweisVorderseiteUrl: existingMitreisender?.ausweisVorderseiteUrl || undefined,
                ausweisRückseiteUrl: existingMitreisender?.ausweisRückseiteUrl || undefined,
            };
        });
        logSafe(actionContext, { message: "Mitreisende metadata prepared.", mitreisendeCount: updatedGuestData.mitreisende?.length });
    }

    const fileFieldsConfig: Array<{
      formDataKey: string;
      guestDataUrlKey?: keyof GuestSubmittedData;
      mitreisenderId?: string; 
      mitreisenderUrlKey?: keyof Mitreisender;
      step: number; 
    }> = [
      { formDataKey: 'hauptgastAusweisVorderseiteFile', guestDataUrlKey: 'hauptgastAusweisVorderseiteUrl', step: 1 },
      { formDataKey: 'hauptgastAusweisRückseiteFile', guestDataUrlKey: 'hauptgastAusweisRückseiteUrl', step: 1 },
      { formDataKey: 'zahlungsbelegFile', guestDataUrlKey: 'zahlungsbelegUrl', step: 4 },
    ];
    
    if (updatedGuestData.mitreisende && stepNumber === 2) {
        updatedGuestData.mitreisende.forEach((mitreisender) => {
            if (mitreisender.id) {
                fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisender.id}_ausweisVorderseiteFile`, mitreisenderId: mitreisender.id, mitreisenderUrlKey: 'ausweisVorderseiteUrl', step: 2 });
                fileFieldsConfig.push({ formDataKey: `mitreisende_${mitreisender.id}_ausweisRückseiteFile`, mitreisenderId: mitreisender.id, mitreisenderUrlKey: 'ausweisRückseiteUrl', step: 2 });
            }
        });
    }
    logSafe(actionContext, {message: `Processing files for step ${stepNumber}. File fields count: ${fileFieldsConfig.filter(fc => fc.step === stepNumber).length}`});

    for (const config of fileFieldsConfig) {
      if (config.step !== stepNumber) continue; 

      const file = rawFormData[config.formDataKey] as File | undefined | null;
      let oldFileUrl: string | undefined = undefined;

      if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
          const companion = updatedGuestData.mitreisende.find(m => m.id === config.mitreisenderId);
          if (companion) oldFileUrl = (companion as any)[config.mitreisenderUrlKey];
      } else if (config.guestDataUrlKey) {
          oldFileUrl = (currentGuestDataSnapshot as any)[config.guestDataUrlKey];
      }

      if (file instanceof File && file.size > 0) {
        const fileProcessingStartTime = Date.now();
        const originalFileName = file.name;
        const fileExtension = originalFileName.split('.').pop();
        const safeFileNameBase = originalFileName.substring(0, originalFileName.length - (fileExtension ? fileExtension.length + 1 : 0)).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}_${safeFileNameBase}${fileExtension ? '.' + fileExtension : ''}`;
        
        let filePathPrefix = `bookings/${bookingDoc.bookingToken}`;
        if (config.mitreisenderId && config.mitreisenderUrlKey) {
            filePathPrefix += `/mitreisende/${config.mitreisenderId}/${config.mitreisenderUrlKey.replace('Url', '')}`;
        } else if (config.guestDataUrlKey) {
            filePathPrefix += `/${config.guestDataUrlKey.replace('Url', '')}`;
        }
        const filePath = `${filePathPrefix}/${uniqueFileName}`;
        logSafe(`${actionContext} File for ${config.formDataKey}: ${originalFileName} (Size: ${file.size} bytes, Type: ${file.type}). Path: ${filePath}. Old URL: ${oldFileUrl}`);

        if (oldFileUrl && typeof oldFileUrl === 'string' && oldFileUrl.startsWith("https://firebasestorage.googleapis.com")) {
          try {
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            logSafe(`${actionContext} Old file ${oldFileUrl} deleted successfully from Firebase Storage.`);
          } catch (deleteError: any) {
            logSafe(`${actionContext} WARN: Failed to delete old file ${oldFileUrl} for ${config.formDataKey} from Firebase Storage: ${deleteError.message} (Code: ${deleteError.code}). Continuing.`, {}, 'warn');
          }
        }
        
        let downloadURL: string | undefined;
        try {
          logSafe(actionContext, { message: `Uploading ${originalFileName} to Firebase Storage... ArrayBuffer read start.`});
          const fileBuffer = await file.arrayBuffer();
          logSafe(actionContext, { message: `ArrayBuffer read complete for ${originalFileName} in ${Date.now() - fileProcessingStartTime}ms. Uploading to Firebase Storage...`});
          
          const fileStorageRef = storageRefFB(storage, filePath);
          const uploadTaskStartTime = Date.now();
          await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
          logSafe(actionContext, { message: `Uploaded ${originalFileName} to Storage in ${Date.now() - uploadTaskStartTime}ms.`});

          const getUrlStartTime = Date.now();
          downloadURL = await getDownloadURL(fileStorageRef);
          logSafe(actionContext, { message: `Got download URL for ${originalFileName} in ${Date.now() - getUrlStartTime}ms.`});
          
        } catch (fileUploadError: any) {
          let userMessage = `Dateiupload für ${originalFileName} fehlgeschlagen.`;
          const errorCode = (fileUploadError as any).code || "upload-error";
           if (errorCode === 'storage/unauthorized') {
            userMessage = `Berechtigungsfehler beim Upload von ${originalFileName}. Bitte Firebase Storage Regeln prüfen. (Code: ${errorCode})`;
          } else if (errorCode === 'storage/canceled') {
            userMessage = `Upload von ${originalFileName} abgebrochen. (Code: ${errorCode})`;
          } else if (errorCode === 'storage/object-not-found' && oldFileUrl) {
             userMessage = `Fehler beim Löschen der alten Datei ${originalFileName} (nicht gefunden). Der neue Upload könnte dennoch erfolgreich sein. (Code: ${errorCode})`;
          } else if (errorCode === 'storage/no-default-bucket') { // Should be caught by firebaseInitializedCorrectly
            userMessage = `Firebase Storage Bucket nicht gefunden für ${originalFileName}. Konfiguration prüfen. (Code: ${errorCode})`;
          } else {
            userMessage += ` (Details: ${(fileUploadError as Error).message}, Code: ${errorCode})`;
          }
          logSafe(`${actionContext} FILE UPLOAD FAIL] Firebase Storage error for ${originalFileName}: ${userMessage}`, { error: fileUploadError }, 'error');
          return { ...initialFormState, message: userMessage, errors: { [config.formDataKey]: [userMessage] }, success: false, actionToken: forActionToken, updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), currentStep: stepNumber - 1 };
        }

        if (downloadURL) {
            if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
                const companionIndex = updatedGuestData.mitreisende.findIndex(m => m.id === config.mitreisenderId);
                if (companionIndex !== -1) {
                    (updatedGuestData.mitreisende[companionIndex] as any)[config.mitreisenderUrlKey] = downloadURL;
                }
            } else if (config.guestDataUrlKey) {
                (updatedGuestData as any)[config.guestDataUrlKey] = downloadURL;
            }
        }

      } else if (oldFileUrl) {
        if (config.mitreisenderId && config.mitreisenderUrlKey && updatedGuestData.mitreisende) {
            const companionIndex = updatedGuestData.mitreisende.findIndex(m => m.id === config.mitreisenderId);
            if (companionIndex !== -1 && !(updatedGuestData.mitreisende[companionIndex]as any)[config.mitreisenderUrlKey]) {
                 (updatedGuestData.mitreisende[companionIndex]as any)[config.mitreisenderUrlKey] = oldFileUrl;
            }
        } else if (config.guestDataUrlKey && !(updatedGuestData as any)[config.guestDataUrlKey]) {
            (updatedGuestData as any)[config.guestDataUrlKey] = oldFileUrl;
        }
        logSafe(`${actionContext} No new file for ${config.formDataKey}, kept old URL if present: ${oldFileUrl}`);
      }
      if (config.guestDataUrlKey) delete (updatedGuestData as any)[config.formDataKey];
      if (config.mitreisenderId) delete (updatedGuestData as any)[config.formDataKey]; 
    }
    logSafe(`${actionContext} All file uploads for step ${stepNumber} processed or skipped.`);

    if (updatedGuestData.mitreisende) {
        updatedGuestData.mitreisende = updatedGuestData.mitreisende.map(m => {
            const cleanedMitreisender = { ...m } as Partial<Mitreisender & { ausweisVorderseiteFile?: any, ausweisRückseiteFile?: any}>;
            delete cleanedMitreisender.ausweisVorderseiteFile; 
            delete cleanedMitreisender.ausweisRückseiteFile;
            return cleanedMitreisender as Mitreisender;
        });
    }

    updatedGuestData.lastCompletedStep = Math.max(currentGuestDataSnapshot.lastCompletedStep ?? -1, stepNumber - 1);
    logSafe(`${actionContext} Final merged guest data before Firestore save (keys):`, Object.keys(updatedGuestData));

    const bookingUpdatesFirestore: Partial<Booking> = {
      guestSubmittedData: updatedGuestData,
      updatedAt: Timestamp.now(),
    };

    if (stepNumber === 1 && dataFromForm.gastVorname && dataFromForm.gastNachname) {
        if (bookingDoc.guestFirstName !== dataFromForm.gastVorname || bookingDoc.guestLastName !== dataFromForm.gastNachname) {
            bookingUpdatesFirestore.guestFirstName = dataFromForm.gastVorname;
            bookingUpdatesFirestore.guestLastName = dataFromForm.gastNachname;
        }
    }
    
    if (stepNumber === 4) { 
      updatedGuestData.zahlungsart = 'Überweisung';
      bookingUpdatesFirestore.guestSubmittedData!.zahlungsart = 'Überweisung';
    }

    if (stepNumber === 5) { 
      if (dataFromForm.agbAkzeptiert === true && dataFromForm.datenschutzAkzeptiert === true) {
        updatedGuestData.submittedAt = Timestamp.now();
        bookingUpdatesFirestore.status = "Confirmed"; 
        bookingUpdatesFirestore.guestSubmittedData!.submittedAt = Timestamp.now();
        logSafe(`${actionContext} Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed".`);
      } else {
        logSafe(`${actionContext} Final step, but AGB/Datenschutz NICHT akzeptiert. Status bleibt: ${bookingDoc.status}.`, {}, 'warn');
        return {
          ...initialFormState, message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
          errors: {
            agbAkzeptiert: !dataFromForm.agbAkzeptiert ? ["AGB müssen akzeptiert werden."] : undefined,
            datenschutzAkzeptiert: !dataFromForm.datenschutzAkzeptiert ? ["Datenschutz muss akzeptiert werden."] : undefined,
          },
          success: false, actionToken: forActionToken, updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), currentStep: stepNumber - 1,
        };
      }
    }

    const dbUpdateStartTime = Date.now();
    let updateSuccess = false;
    try {
      updateSuccess = await updateBookingInFirestore(bookingDoc.id!, bookingUpdatesFirestore);
    } catch (dbError: any) {
      logSafe(`${actionContext} Firestore updateDoc FAILED. Duration: ${Date.now() - dbUpdateStartTime}ms.`, { error: dbError.message }, 'error');
      return {
          ...initialFormState, message: `Fehler beim Speichern der Daten in Firestore: ${dbError.message}`,
          errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: forActionToken, updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), currentStep: stepNumber - 1,
        };
    }
    logSafe(`${actionContext} Firestore updateDoc duration: ${Date.now() - dbUpdateStartTime}ms. Success: ${updateSuccess}`);

    if (updateSuccess) {
      logSafe(`${actionContext} SUCCESS] Data submitted successfully to Firestore. Booking status: ${bookingUpdatesFirestore.status || bookingDoc.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}. Total time: ${Date.now() - startTime}ms.`);
      revalidatePath(`/buchung/${bookingDoc.bookingToken}`, "layout");
      revalidatePath(`/admin/bookings/${bookingDoc.id}`, "page");
      revalidatePath(`/admin/dashboard`, "page");

      let message = `Schritt ${stepNumber} erfolgreich übermittelt.`; 
      if (bookingUpdatesFirestore.status === "Confirmed" && stepNumber === 5) { 
        message = "Buchung erfolgreich abgeschlossen und bestätigt!";
      }
      return { ...initialFormState, message, errors: null, success: true, actionToken: forActionToken, updatedGuestData: convertTimestampsInGuestData(updatedGuestData), currentStep: stepNumber - 1 };
    } else {
      logSafe(`${actionContext} FAIL] updateBookingInFirestore returned false.`, {}, 'error');
      return {
        ...initialFormState, message: "Fehler beim Speichern der Daten. Buchung konnte nicht aktualisiert werden.",
        errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: forActionToken, updatedGuestData: convertTimestampsInGuestData(currentGuestDataSnapshot), currentStep: stepNumber - 1,
      };
    }
  } catch (e: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR in updateBookingStep]:`, { error: e }, 'error');
    return {
      message: `Unerwarteter Serverfehler in Schritt ${stepNumber}: ${e.message}. Bitte versuchen Sie es später erneut. (Code: UBS-UNCAUGHT)`,
      errors: { global: [`Serverfehler in Schritt ${stepNumber}.`] },
      success: false,
      actionToken: forActionToken,
      currentStep: stepNumber - 1,
      updatedGuestData: convertTimestampsInGuestData( (await findBookingByTokenFromFirestore(bookingTokenParam))?.guestSubmittedData || null ),
    };
  }
}

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitGastStammdatenAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken });
    const result = await updateBookingStep(serverActionToken, bookingToken, 1, gastStammdatenSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Stammdaten-Verarbeitung: ${error.message}`, errors: { global: ["Serverfehler bei Stammdaten."] }, success: false, actionToken: serverActionToken, currentStep: prevState?.currentStep ?? 0, updatedGuestData: prevState?.updatedGuestData };
  }
}

export async function submitMitreisendeAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitMitreisendeAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken });
    const rawFormData = Object.fromEntries(formData.entries());
    const validatedMeta = mitreisendeSchema.safeParse(rawFormData); 

    if (!validatedMeta.success) {
        const fieldErrors = validatedMeta.error.flatten().fieldErrors;
        logSafe(actionContext + " Validation FAILED for Mitreisende metadata", { errors: fieldErrors }, 'warn');
        return { ...initialFormState, errors: fieldErrors, message: "Validierungsfehler bei Mitreisenden-Metadaten.", success: false, actionToken: serverActionToken, currentStep: 1, updatedGuestData: prevState.updatedGuestData };
    }
    
    const mitreisendeMetaArray = validatedMeta.data.mitreisendeMeta || [];
    logSafe(actionContext, { message: "Mitreisende metadata parsed.", count: mitreisendeMetaArray.length });

    const result = await updateBookingStep(serverActionToken, bookingToken, 2, z.object({}), formData, {}, mitreisendeMetaArray);
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Mitreisenden-Verarbeitung: ${error.message}`, errors: { global: ["Serverfehler bei Mitreisenden."] }, success: false, actionToken: serverActionToken, currentStep: prevState?.currentStep ?? 1, updatedGuestData: prevState?.updatedGuestData };
  }
}

export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitPaymentAmountSelectionAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
   try {
    logSafe(actionContext + " BEGIN", { bookingToken });
    const result = await updateBookingStep(serverActionToken, bookingToken, 3, paymentAmountSelectionSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Auswahl Zahlungssumme: ${error.message}`, errors: { global: ["Serverfehler bei Zahlungssummenauswahl."] }, success: false, actionToken: serverActionToken, currentStep: prevState?.currentStep ?? 2, updatedGuestData: prevState?.updatedGuestData };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitZahlungsinformationenAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken });
    const rawFormData = Object.fromEntries(formData.entries());
    const zahlungsbetrag = parseFloat(rawFormData.zahlungsbetrag as string);

    const result = await updateBookingStep(serverActionToken, bookingToken, 4, zahlungsinformationenSchema, formData, { zahlungsart: 'Überweisung', zahlungsbetrag });
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack }, 'error');
    return { ...initialFormState, message: `Serverfehler bei Zahlungsinformationen: ${error.message}`, errors: { global: ["Serverfehler bei Zahlungsinformationen."] }, success: false, actionToken: serverActionToken, currentStep: prevState?.currentStep ?? 3, updatedGuestData: prevState?.updatedGuestData };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `submitEndgueltigeBestaetigungAction - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  try {
    logSafe(actionContext + " BEGIN", { bookingToken });
    const result = await updateBookingStep(serverActionToken, bookingToken, 5, uebersichtBestaetigungSchema, formData, {});
    logSafe(actionContext + " END", { success: result.success, message: result.message, errors: result.errors });
    return result;
  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error:`, { message: error.message, stack: error.stack }, 'error');
    return { ...initialFormState, message: `Serverfehler beim Abschluss der Buchung: ${error.message}`, errors: { global: ["Serverfehler beim Buchungsabschluss."] }, success: false, actionToken: serverActionToken, currentStep: prevState?.currentStep ?? 4, updatedGuestData: prevState?.updatedGuestData };
  }
}

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
              message: "Mindestens ein Zimmer muss hinzugefügt werden und die Daten müssen als Liste von Zimmern übergeben werden.",
            });
            return z.NEVER;
          }
          return parsed;
        } catch (e) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Die Zimmerdaten sind nicht im korrekten JSON-Format. Bitte überprüfen Sie die Eingaben für alle Zimmer.",
          });
          return z.NEVER; 
        }
      }).pipe( 
        z.array(RoomSchema, {
          invalid_type_error: "Zimmerdaten müssen als Liste von Zimmern übergeben werden.",
          required_error: "Mindestens ein Zimmer muss angegeben werden."
        }).min(1, "Mindestens ein Zimmer muss hinzugefügt werden.")
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
  const actionContext = `createBookingAction - ActionToken: ${serverActionToken}`;
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { hasPrevState: !!prevState });

  try {
    if (!firebaseInitializedCorrectly || !db) {
      const errorMsg = firebaseInitializationError || "Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL).";
      logSafe(`${actionContext} FAIL]`, { error: errorMsg, dbExists: !!db, storageExists: !!storage, firebaseInitialized: firebaseInitializedCorrectly }, 'error');
      return { ...initialFormState, message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler. Bitte Server-Logs prüfen."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }

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
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: bookingData.verpflegung,
      rooms: bookingData.roomsData.map(room => ({ // Ensure room data is correctly mapped
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
      logSafe(`${actionContext} FAIL]`, { error: errorMsg, details: "addBookingToFirestore returned null or no ID." }, 'error');
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
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR]:`, { error: e }, 'error');
    return { ...initialFormState, message: `Unerwarteter Serverfehler beim Erstellen der Buchung: ${e.message}`, errors: { global: ["Serverfehler beim Erstellen."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction - IDs: ${bookingIds.join(', ') || 'N/A'} - ActionToken: ${serverActionToken}`;
  const startTime = Date.now();
  logSafe(actionContext + " BEGIN", { bookingIdsCount: bookingIds.length });
  
  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
      const errorMsg = firebaseInitializationError || `Serverfehler: Firebase ist nicht korrekt initialisiert (Code DBA-FIREBASE-INIT-FAIL).`;
      logSafe(`${actionContext} FAIL]`, { error: errorMsg }, 'error');
      return { success: false, message: errorMsg, actionToken: serverActionToken };
    }
    if (!bookingIds || bookingIds.length === 0) {
      logSafe(`${actionContext} WARN] No booking IDs provided for deletion.`, {}, 'warn');
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    let overallSuccess = true;
    let messages: string[] = [];

    for (const id of bookingIds) {
        const booking = await findBookingByIdFromFirestore(id);
        if (booking?.guestSubmittedData) {
            const guestData = booking.guestSubmittedData;
            const urlsToDelete: (string | undefined)[] = [
                guestData.hauptgastAusweisVorderseiteUrl,
                guestData.hauptgastAusweisRückseiteUrl,
                guestData.zahlungsbelegUrl,
            ];
            if (guestData.mitreisende) {
                guestData.mitreisende.forEach(mitreisender => {
                    urlsToDelete.push(mitreisender.ausweisVorderseiteUrl);
                    urlsToDelete.push(mitreisender.ausweisRückseiteUrl);
                });
            }

            for (const url of urlsToDelete) {
                if (url && typeof url === 'string' && url.startsWith("https://firebasestorage.googleapis.com")) {
                    try {
                        const fileRef = storageRefFB(storage, url);
                        await deleteObject(fileRef);
                        logSafe(actionContext, { message: `File ${url} deleted from Storage for booking ${id}` });
                    } catch (deleteError: any) {
                        if (deleteError.code === 'storage/object-not-found') {
                            logSafe(actionContext + ` WARN: File ${url} for booking ${id} not found in Storage, skipping deletion: ${deleteError.message}`, {}, 'warn');
                        } else {
                            logSafe(actionContext + ` WARN: Failed to delete file ${url} for booking ${id}`, { error: deleteError.message, code: (deleteError as any).code }, 'warn');
                            messages.push(`Datei für Buchung ${id.substring(0,6)} (${url.split('/').pop()?.split('?')[0]?.substring(0,20)}) konnte nicht gelöscht werden (Storage-Fehler).`);
                            overallSuccess = false;
                        }
                    }
                }
            }
        }
    }

    const firestoreDeleteSuccess = await deleteBookingsFromFirestoreByIds(bookingIds);
    if (firestoreDeleteSuccess) {
      messages.push(`${bookingIds.length} Buchung(en) erfolgreich aus Datenbank gelöscht.`);
    } else {
      messages.push(`Fehler beim Löschen von ${bookingIds.length} Buchung(en) aus der Datenbank.`);
      overallSuccess = false;
    }
    
    if (overallSuccess) {
        logSafe(`${actionContext} SUCCESS] ${bookingIds.length} booking(s) and associated files handled. Total time: ${Date.now() - startTime}ms.`);
        revalidatePath("/admin/dashboard", "layout");
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: true, message: messages.join(' '), actionToken: serverActionToken };
    } else {
        logSafe(`${actionContext} PARTIAL FAIL] Some operations failed. Total time: ${Date.now() - startTime}ms.`, {messages}, 'warn');
        revalidatePath("/admin/dashboard", "layout"); // Revalidate even on partial failure to reflect DB changes
        bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
        return { success: false, message: "Einige Operationen sind fehlgeschlagen: " + messages.join(' '), actionToken: serverActionToken };
    }

  } catch (error: any) {
    logSafe(`${actionContext} CRITICAL UNCAUGHT ERROR] Error deleting bookings:`, { error }, 'error');
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen: ${error.message}`, actionToken: serverActionToken };
  }
}

    