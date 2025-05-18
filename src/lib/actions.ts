
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, RoomDetail } from "@/lib/definitions";
import {
  addBookingToFirestore,
  findBookingByTokenFromFirestore,
  findBookingByIdFromFirestore,
  updateBookingInFirestore,
  deleteBookingsFromFirestoreByIds,
} from "./mock-db"; // now points to firestore operations
import { storage, firebaseInitializedCorrectly, db } from "@/lib/firebase"; // Import db as well
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number;
  bookingToken?: string | null; // Added for createBookingAction
};

const RoomSchema = z.object({
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number().int().min(0, "Anzahl Erwachsene muss positiv sein."),
  kinder: z.coerce.number().int().min(0, "Anzahl Kinder muss positiv sein.").optional().default(0),
  kleinkinder: z.coerce.number().int().min(0, "Anzahl Kleinkinder muss positiv sein.").optional().default(0),
  alterKinder: z.string().optional().default(''),
});

const createBookingServerSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich."),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich."),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  interneBemerkungen: z.string().optional(),
  roomsData: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      const roomsArraySchema = z.array(RoomSchema).min(1, "Mindestens ein Zimmer muss hinzugefügt werden.");
      const validationResult = roomsArraySchema.safeParse(parsed);
      if (!validationResult.success) {
        validationResult.error.issues.forEach(issue => {
             // Manually build path for better error display
            const path = ['roomsData', ...(issue.path.map(p => typeof p === 'number' ? `Zimmer ${p+1}`: p))];
            ctx.addIssue({...issue, path })
        });
        return z.NEVER; 
      }
      return validationResult.data as RoomDetail[]; // Zod should infer this but being explicit
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ungültiges JSON-Format für Zimmerdaten.",
        path: ["roomsData"],
      });
      return z.NEVER; 
    }
  }),
}).refine(data => {
    if (data.checkInDate && data.checkOutDate) {
        return new Date(data.checkOutDate) > new Date(data.checkInDate);
    }
    return true;
}, {
    message: "Abreisedatum muss nach dem Anreisedatum liegen.",
    path: ["dateRange"], // Changed path to a non-input field or a summary field if possible
});


const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 10MB.`)
  .refine(
    (file) => {
      if (!file || file.size === 0) return true; 
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur ${[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES].map(t => t.split('/')[1]).join(', ').toUpperCase()} Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => {
    if (!val || val === "") return true; 
    const date = new Date(val);
    const age = new Date().getFullYear() - date.getFullYear();
    return !isNaN(date.getTime()) && age >=0 && age < 120;
  }, { message: "Ungültiges Geburtsdatum." }),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
});

const ausweisdokumenteSchema = z.object({
  hauptgastDokumenttyp: z.enum(['Reisepass', 'Personalausweis', 'Führerschein'], { required_error: "Dokumenttyp ist erforderlich."}),
  hauptgastAusweisVorderseite: fileSchema,
  hauptgastAusweisRückseite: fileSchema,
});

const zahlungsinformationenSchema = z.object({
  zahlungsart: z.literal('Überweisung', { required_error: "Zahlungsart ist erforderlich (aktuell nur Überweisung)."}),
  zahlungsdatum: z.string().min(1, "Zahlungsdatum ist erforderlich.").refine(val => !isNaN(Date.parse(val)), {
    message: "Ungültiges Zahlungsdatum."
  }),
  zahlungsbeleg: fileSchema.refine(file => !!file && file.size > 0, { message: "Zahlungsbeleg ist erforderlich."}),
  zahlungsbetrag: z.coerce.number().nonnegative("Anzahlungsbetrag muss eine nicht-negative Zahl sein."),
});

const uebersichtBestaetigungSchema = z.object({
    agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
        message: "Sie müssen den AGB zustimmen.",
    })),
    datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
        message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
    })),
});


function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function logSafe(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
  const simplifiedData = JSON.stringify(data, (key, value) => {
    if (value instanceof File) {
      return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified };
    }
    if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) {
      return value.substring(0, 100) + `...[truncated ${value.length} chars]`;
    }
    return value;
  }, 2);

  const logMessage = `[Action ${context}] ${simplifiedData}`;
  if (level === 'error') console.error(logMessage);
  else if (level === 'warn') console.warn(logMessage);
  else console.log(logMessage);
}

async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-based
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>,
  forActionToken?: string
): Promise<FormState> {
  const serverActionToken = forActionToken || generateActionToken();
  const actionContext = `updateBookingStep - Step ${stepNumber} - Token: "${bookingToken}" - ActionToken: ${serverActionToken}`;
  console.log(`[Action ${actionContext} BEGIN] Timestamp: ${new Date().toISOString()}`);

  if (!firebaseInitializedCorrectly || !db || !storage) {
    const errorMsg = "Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-CRITICAL).";
    console.error(`[Action ${actionContext} FAIL] ${errorMsg}`);
    return {
      message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler."] },
      success: false, actionToken: serverActionToken, currentStep: stepNumber - 1
    };
  }

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
    logSafe(`${actionContext} Raw FormData`, rawFormData);
  } catch (e: any) {
    console.error(`[Action ${actionContext} CRITICAL] Error converting FormData:`, e.message);
    return { message: "Serverfehler: Formularverarbeitung fehlgeschlagen.", errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber -1 };
  }

  const validatedFields = actionSchema.safeParse(rawFormData);
  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    logSafe(`${actionContext} Validation FAILED`, fieldErrors, 'warn');
    return { errors: fieldErrors, message: "Validierungsfehler. Bitte Eingaben prüfen.", success: false, actionToken: serverActionToken, currentStep: stepNumber -1 };
  }

  const dataFromForm = validatedFields.data;
  logSafe(`${actionContext} Zod validation successful. DataFromForm`, dataFromForm);

  const booking = await findBookingByTokenFromFirestore(bookingToken);
  if (!booking || !booking.id) {
    console.warn(`[Action ${actionContext} FAIL] Booking NOT FOUND in Firestore.`);
    return { message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber -1 };
  }
  logSafe(`${actionContext} Booking found. ID: ${booking.id}, Status: ${booking.status}. Current guestData`, booking.guestSubmittedData);

  let currentGuestDataSnapshot: GuestSubmittedData = booking.guestSubmittedData ? JSON.parse(JSON.stringify(booking.guestSubmittedData)) : { lastCompletedStep: -1 };
  
  let updatedGuestData: GuestSubmittedData = {
    ...currentGuestDataSnapshot,
    ...(additionalDataToMerge || {}),
    ...dataFromForm,
  };

  const fileFieldsDefinition: { formDataKey: keyof typeof dataFromForm; urlKey: keyof GuestSubmittedData }[] = [
    { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
    { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
    { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
  ];

  for (const fieldDef of fileFieldsDefinition) {
    const file = dataFromForm[fieldDef.formDataKey] as File | undefined | null;
    const oldFileUrl = (currentGuestDataSnapshot as any)[fieldDef.urlKey] as string | undefined;

    if (file instanceof File && file.size > 0) {
      logSafe(`${actionContext} Processing NEW file for ${String(fieldDef.formDataKey)}: ${file.name} (${file.size} bytes)`, {});
      try {
        if (oldFileUrl && oldFileUrl.startsWith('https://firebasestorage.googleapis.com')) {
          try {
            console.log(`[Action ${actionContext}] Attempting to delete old file: ${oldFileUrl} for ${String(fieldDef.formDataKey)}`);
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            console.log(`[Action ${actionContext}] Old file ${oldFileUrl} deleted successfully.`);
          } catch (deleteError: any) {
            console.warn(`[Action ${actionContext}] Failed to delete old file ${oldFileUrl} for ${String(fieldDef.formDataKey)}: ${deleteError.message} (Code: ${deleteError.code}). Continuing with new upload.`);
          }
        }

        const filePath = `bookings/${bookingToken}/${String(fieldDef.formDataKey)}/${Date.now()}_${file.name}`;
        const fileStorageRef = storageRefFB(storage, filePath);
        
        console.log(`[Action ${actionContext}] Starting upload for ${file.name} to ${filePath}. Size: ${file.size}, Type: ${file.type}. Timestamp: ${new Date().toISOString()}`);
        const startTimeUpload = Date.now();
        const fileBuffer = await file.arrayBuffer(); // Reading file into buffer
        console.log(`[Action ${actionContext}] File buffer created for ${file.name}. Duration: ${Date.now() - startTimeUpload}ms. Uploading...`);
        
        await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
        const uploadDuration = Date.now() - startTimeUpload;
        console.log(`[Action ${actionContext}] Successfully uploaded ${file.name} to Firebase Storage. Duration: ${uploadDuration}ms. Getting download URL...`);
        
        const startTimeUrl = Date.now();
        const downloadURL = await getDownloadURL(fileStorageRef);
        const urlDuration = Date.now() - startTimeUrl;
        console.log(`[Action ${actionContext}] Got download URL for ${file.name}: ${downloadURL}. Duration: ${urlDuration}ms.`);
        (updatedGuestData as any)[fieldDef.urlKey] = downloadURL;

      } catch (fileProcessingError: any) {
        console.error(`[Action ${actionContext} FILE UPLOAD FAIL] Firebase Storage error for ${String(fieldDef.formDataKey)} (File: ${file.name}): ${fileProcessingError.message} (Code: ${fileProcessingError.code})`, fileProcessingError.stack?.substring(0,500));
        let userMessage = `Dateiupload für ${String(fieldDef.formDataKey)} (${file.name}) fehlgeschlagen.`;
        if (fileProcessingError.code === 'storage/unauthorized') {
          userMessage = `Berechtigungsfehler beim Upload für ${String(fieldDef.formDataKey)}. Bitte Firebase Storage Regeln prüfen.`;
        } else if (fileProcessingError.code === 'storage/canceled') {
          userMessage = `Upload für ${String(fieldDef.formDataKey)} abgebrochen.`;
        } else if (fileProcessingError.code) {
          userMessage += ` (Code: ${fileProcessingError.code})`;
        }
        return {
          message: userMessage, errors: { [String(fieldDef.formDataKey)]: [userMessage] },
          success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber - 1,
        };
      }
    } else if (oldFileUrl) {
      (updatedGuestData as any)[fieldDef.urlKey] = oldFileUrl; 
      logSafe(`${actionContext} No new file for ${String(fieldDef.formDataKey)}, kept old URL: ${oldFileUrl}`, {});
    } else {
       if ((updatedGuestData as any)[fieldDef.urlKey]) {
         delete (updatedGuestData as any)[fieldDef.urlKey]; // No new file and no old file, ensure URL key is not present if it somehow existed
         logSafe(`${actionContext} No new file for ${String(fieldDef.formDataKey)}, and no old URL was present. Ensured URL key is removed.`, {});
       }
    }
  }

  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1);
  logSafe(`${actionContext} Final merged guest data before save`, updatedGuestData);

  const bookingUpdates: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
  };

  if (updatedGuestData.gastVorname && updatedGuestData.gastNachname && booking.guestFirstName !== updatedGuestData.gastVorname) {
    bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
    bookingUpdates.guestLastName = updatedGuestData.gastNachname;
  }

  if (stepNumber === 4) { // Last step: Übersicht & Bestätigung
    if (dataFromForm.agbAkzeptiert === true && dataFromForm.datenschutzAkzeptiert === true) {
      updatedGuestData.submittedAt = new Date().toISOString(); 
      bookingUpdates.status = "Confirmed";
      logSafe(`${actionContext} Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed".`, {});
    } else {
      logSafe(`${actionContext} Final step, but AGB/Datenschutz NICHT akzeptiert. Status bleibt: ${booking.status}.`, {}, 'warn');
       return {
          message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
          errors: {
              agbAkzeptiert: !dataFromForm.agbAkzeptiert ? ["AGB müssen akzeptiert werden."] : undefined,
              datenschutzAkzeptiert: !dataFromForm.datenschutzAkzeptiert ? ["Datenschutz muss akzeptiert werden."] : undefined,
           },
          success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
        };
    }
  }

  const startTimeDbUpdate = Date.now();
  const updateSuccess = await updateBookingInFirestore(booking.id, bookingUpdates);
  const dbUpdateDuration = Date.now() - startTimeDbUpdate;
  logSafe(`${actionContext} Firestore updateDoc duration: ${dbUpdateDuration}ms. Success: ${updateSuccess}`, {});

  if (updateSuccess) {
    console.log(`[Action ${actionContext} SUCCESS] Data submitted successfully to Firestore. Booking status: ${bookingUpdates.status || booking.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);
    revalidatePath(`/buchung/${bookingToken}`, "layout");
    revalidatePath(`/admin/bookings/${booking.id}`, "page"); // Revalidate specific booking detail page
    revalidatePath(`/admin/dashboard`, "page"); // Revalidate dashboard

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
    if (bookingUpdates.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return { message, errors: null, success: true, actionToken: serverActionToken, updatedGuestData: updatedGuestData, currentStep: stepNumber -1 };
  } else {
    console.error(`[Action ${actionContext} FAIL] Failed to update booking in Firestore.`);
    return {
      message: "Fehler beim Speichern der Daten in Firestore. Buchung konnte nicht aktualisiert werden.",
      errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
    };
  }
}


export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  try {
    return await updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitGastStammdatenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler bei Stammdaten-Verarbeitung (Code SA-STAMM-CATCH).", errors: { global: ["Serverfehler bei Stammdaten-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
   try {
    return await updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitAusweisdokumenteAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler bei Ausweisdokument-Verarbeitung (Code SA-AUSWEIS-CATCH).", errors: { global: ["Serverfehler bei Ausweisdokument-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  try {
    const rawFormData = Object.fromEntries(formData.entries());
    // Calculate anzahlungsbetrag here, or ensure it's correctly passed from client / calculated based on booking.price
    // For now, assuming it's part of rawFormData as 'zahlungsbetrag' from the hidden input.
    return await updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitZahlungsinformationenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler bei Zahlungsinformationen-Verarbeitung (Code SA-ZAHLUNG-CATCH).", errors: { global: ["Serverfehler bei Zahlungsinformationen-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  try {
    return await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitEndgueltigeBestaetigungAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler beim Abschluss der Buchung (Code SA-FINAL-CATCH).", errors: { global: ["Serverfehler beim Abschluss der Buchung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function createBookingAction(prevState: FormState | any, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  const actionContext = `createBookingAction - ActionToken: ${serverActionToken}`;
  console.log(`[Action ${actionContext} BEGIN]`);

  try {
    if (!firebaseInitializedCorrectly || !db) {
        const errorMsg = "Serverfehler: Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL).";
        console.error(`[Action ${actionContext} FAIL] ${errorMsg}`);
        return { message: errorMsg, errors: { global: ["Firebase Konfigurationsfehler."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const rawFormData = Object.fromEntries(formData.entries());
    logSafe(actionContext + " Raw FormData", rawFormData);
    const validatedFields = createBookingServerSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      logSafe(actionContext + " Validation FAILED", fieldErrors, 'warn');
      // Transform path for roomsData errors to be more user-friendly
        const errorsOutput: Record<string, string[]> = {};
        for (const key in fieldErrors) {
            const newKey = key.startsWith('roomsData.Zimmer') ? 'roomsData' : key;
            if (!errorsOutput[newKey]) errorsOutput[newKey] = [];
            errorsOutput[newKey].push(...(fieldErrors[key as keyof typeof fieldErrors] || []));
        }
      return { errors: errorsOutput, message: "Fehler bei der Validierung.", success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const bookingData = validatedFields.data;
    logSafe(actionContext + " Validation successful. Parsed BookingData", bookingData);

    const newBookingToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2,10);
    
    const firstRoom = bookingData.roomsData[0];
    const roomIdentifierString = `${firstRoom.zimmertyp || 'Zimmer'} (${firstRoom.erwachsene} Erw.${firstRoom.kinder ? `, ${firstRoom.kinder} Ki.` : ''}${firstRoom.kleinkinder ? `, ${firstRoom.kleinkinder} Kk.` : ''})`;


    const newBookingPayload: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> = {
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: bookingData.verpflegung,
      // Store first room details at top level for easy access/display
      zimmertyp: firstRoom.zimmertyp,
      erwachsene: firstRoom.erwachsene,
      kinder: firstRoom.kinder,
      kleinkinder: firstRoom.kleinkinder,
      alterKinder: firstRoom.alterKinder,
      rooms: bookingData.roomsData, // Store the full array of rooms
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: roomIdentifierString,
      guestSubmittedData: { lastCompletedStep: -1 }
    };

    const createdBooking = await addBookingToFirestore(newBookingPayload);

    if (!createdBooking) {
      const errorMsg = "Datenbankfehler: Buchung konnte nicht erstellt werden.";
      console.error(`[Action ${actionContext} FAIL] ${errorMsg} - addBookingToFirestore returned null.`);
      return { message: errorMsg, errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    console.log(`[Action ${actionContext} SUCCESS] New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBooking.id}`);

    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout"); // Revalidate guest page as well

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`, // Token removed from direct message
      errors: null,
      success: true,
      actionToken: serverActionToken,
      updatedGuestData: createdBooking.guestSubmittedData, // Should be empty initially
      bookingToken: newBookingToken,
    };
  } catch (e: any) {
    console.error(`[Action ${actionContext} CRITICAL UNCAUGHT ERROR]:`, e.message, e.stack?.substring(0,800));
    return { message: "Unerwarteter Serverfehler beim Erstellen der Buchung (Code SA-CREATE-CATCH).", errors: { global: ["Serverfehler beim Erstellen der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  const actionContext = `deleteBookingsAction - IDs: ${bookingIds.join(', ')} - ActionToken: ${serverActionToken}`;
  console.log(`[Action ${actionContext} BEGIN]`);

  try {
    if (!firebaseInitializedCorrectly || !db || !storage) {
        const errorMsg = "Serverfehler: Firebase ist nicht korrekt initialisiert (Code DBA-FIREBASE-INIT-FAIL).";
        console.error(`[Action ${actionContext} FAIL] ${errorMsg}`);
        return { success: false, message: errorMsg, actionToken: serverActionToken };
    }
    if (!bookingIds || bookingIds.length === 0) {
      console.warn(`[Action ${actionContext} WARN] No booking IDs provided for deletion.`);
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const fileUrlsToDelete: string[] = [];
    for (const id of bookingIds) {
        const booking = await findBookingByIdFromFirestore(id); // This now fetches from Firestore
        if (booking?.guestSubmittedData) {
            if (booking.guestSubmittedData.hauptgastAusweisVorderseiteUrl) fileUrlsToDelete.push(booking.guestSubmittedData.hauptgastAusweisVorderseiteUrl);
            if (booking.guestSubmittedData.hauptgastAusweisRückseiteUrl) fileUrlsToDelete.push(booking.guestSubmittedData.hauptgastAusweisRückseiteUrl);
            if (booking.guestSubmittedData.zahlungsbelegUrl) fileUrlsToDelete.push(booking.guestSubmittedData.zahlungsbelegUrl);
        }
    }

    for (const url of fileUrlsToDelete) {
        if (url.startsWith("https://firebasestorage.googleapis.com")) {
            try {
                const fileRef = storageRefFB(storage, url);
                await deleteObject(fileRef);
                console.log(`[Action ${actionContext}] File ${url} deleted from Firebase Storage.`);
            } catch (error: any) {
                console.warn(`[Action ${actionContext} WARN] Failed to delete file ${url} from Storage: ${error.message} (Code: ${error.code}). Continuing with Firestore deletion.`);
            }
        }
    }

    const deleteSuccess = await deleteBookingsFromFirestoreByIds(bookingIds);
    if (deleteSuccess) {
      console.log(`[Action ${actionContext} SUCCESS] ${bookingIds.length} booking(s) deleted from Firestore.`);
      revalidatePath("/admin/dashboard", "layout"); // Revalidate the whole layout to update counts etc.
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
      const errorMsg = "Fehler beim Löschen der Buchungen aus Firestore.";
      console.error(`[Action ${actionContext} FAIL] ${errorMsg}`);
      return { success: false, message: errorMsg, actionToken: serverActionToken };
    }
  } catch (error: any) {
    console.error(`[Action ${actionContext} CRITICAL UNCAUGHT ERROR] Error deleting bookings: ${error.message}`, error.stack?.substring(0, 800));
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen (Code SA-DELETE-CATCH): ${error.message}`, actionToken: serverActionToken };
  }
}
