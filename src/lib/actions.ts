
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import {
  addBookingToFirestore,
  findBookingByTokenFromFirestore,
  findBookingByIdFromFirestore,
  updateBookingInFirestore,
  deleteBookingsFromFirestoreByIds,
} from "./mock-db"; // conceptually firestore-db
import { storage, firebaseInitializedCorrectly } from "@/lib/firebase";
import { ref as storageRefFB, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { Timestamp } from "firebase/firestore";


// --- Zod Schemas (unchanged for now, but might need adjustment for Firestore specific types if any) ---
const createBookingSchema = z.object({
  guestFirstName: z.string().min(1, "Vorname ist erforderlich."),
  guestLastName: z.string().min(1, "Nachname ist erforderlich."),
  price: z.coerce.number().positive("Preis muss eine positive Zahl sein."),
  checkInDate: z.string().min(1, "Anreisedatum ist erforderlich."),
  checkOutDate: z.string().min(1, "Abreisedatum ist erforderlich."),
  verpflegung: z.string().min(1, "Verpflegung ist erforderlich."),
  zimmertyp: z.string().min(1, "Zimmertyp ist erforderlich."),
  erwachsene: z.coerce.number().int().min(0, "Anzahl Erwachsene muss positiv sein."),
  kinder: z.coerce.number().int().min(0, "Anzahl Kinder muss positiv sein.").optional(),
  kleinkinder: z.coerce.number().int().min(0, "Anzahl Kleinkinder muss positiv sein.").optional(),
  alterKinder: z.string().optional(),
  interneBemerkungen: z.string().optional(),
}).refine(data => {
    if (data.checkInDate && data.checkOutDate) {
        return new Date(data.checkOutDate) > new Date(data.checkInDate);
    }
    return true;
}, {
    message: "Abreisedatum muss nach dem Anreisedatum liegen.",
    path: ["checkOutDate"],
});

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 10MB.`)
  .refine(
    (file) => {
      if (!file || file.size === 0) return true; // Allow empty or no file
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur ${[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES].map(t => t.split('/')[1]).join(', ').toUpperCase()} Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => {
    if (!val || val === "") return true; // Optional
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

// --- FormState and Helper Functions ---
export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number;
};

function generateActionToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function logSafe(context: string, data: any) {
    // Basic logger, can be expanded
    console.log(context, JSON.stringify(data, (key, value) => {
        if (value instanceof File) {
            return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified };
        }
        if (typeof value === 'string' && value.length > 200 && !key.toLowerCase().includes('url') && !key.toLowerCase().includes('token') && !key.toLowerCase().includes('datauri')) {
          return value.substring(0, 200) + `...[truncated ${value.length} chars]`;
        }
        return value;
    }, 2));
}


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>,
  forActionToken?: string
): Promise<FormState> {
  const serverActionToken = forActionToken || generateActionToken();
  console.log(`[Action updateBookingStep BEGIN - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${serverActionToken}. Timestamp: ${new Date().toISOString()}`);

  if (!firebaseInitializedCorrectly || !storage) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Firebase not correctly initialized or Storage not available for token "${bookingToken}".`);
    return {
      message: "Serverfehler: Firebase ist nicht korrekt initialisiert (Code UDB-FIREBASE-INIT).",
      errors: { global: ["Firebase Konfigurationsfehler."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber - 1
    };
  }

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
    logSafe(`[Action updateBookingStep - Step ${stepNumber}] Raw FormData for token "${bookingToken}":`, rawFormData);
  } catch (e) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL: Error converting FormData for token "${bookingToken}":`, e);
    return { message: "Serverfehler: Formularverarbeitung fehlgeschlagen.", errors: { global: ["Formularverarbeitung fehlgeschlagen."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber -1 };
  }

  const validatedFields = actionSchema.safeParse(rawFormData);
  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    logSafe(`[Action updateBookingStep - Step ${stepNumber}] Validation FAILED for token "${bookingToken}":`, fieldErrors);
    return { errors: fieldErrors, message: "Validierungsfehler. Bitte Eingaben prüfen.", success: false, actionToken: serverActionToken, currentStep: stepNumber -1 };
  }

  const dataFromForm = validatedFields.data;
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Zod validation successful for token "${bookingToken}".`);

  const booking = await findBookingByTokenFromFirestore(bookingToken);
  if (!booking || !booking.id) {
    console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking NOT FOUND in Firestore for token: "${bookingToken}"`);
    return { message: "Buchung nicht gefunden.", errors: { global: ["Buchung nicht gefunden."] }, success: false, actionToken: serverActionToken, currentStep: stepNumber -1 };
  }
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking found for token "${bookingToken}". ID: ${booking.id}, Status: ${booking.status}.`);

  let currentGuestDataSnapshot: GuestSubmittedData = booking.guestSubmittedData ? JSON.parse(JSON.stringify(booking.guestSubmittedData)) : { lastCompletedStep: -1 };

  let updatedGuestData: GuestSubmittedData = {
    ...currentGuestDataSnapshot,
    ...(additionalDataToMerge || {}),
    ...dataFromForm, // Zod validated data from current form step
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
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing NEW file for ${String(fieldDef.formDataKey)}: ${file.name} (${file.size} bytes) for token "${bookingToken}"`);
      try {
        // Delete old file if it exists and a new one is uploaded
        if (oldFileUrl && oldFileUrl.includes("firebasestorage.googleapis.com")) {
          try {
            const oldFileStorageRef = storageRefFB(storage, oldFileUrl);
            await deleteObject(oldFileStorageRef);
            console.log(`[Action updateBookingStep - Step ${stepNumber}] Old file ${oldFileUrl} deleted for ${String(fieldDef.formDataKey)}.`);
          } catch (deleteError: any) {
            // Log but don't fail the whole upload if old file deletion fails
            console.warn(`[Action updateBookingStep - Step ${stepNumber}] Failed to delete old file ${oldFileUrl} for ${String(fieldDef.formDataKey)}:`, deleteError.message);
          }
        }

        const filePath = `bookings/${bookingToken}/${String(fieldDef.formDataKey)}/${Date.now()}_${file.name}`;
        const fileStorageRef = storageRefFB(storage, filePath);
        const fileBuffer = await file.arrayBuffer();
        await uploadBytes(fileStorageRef, fileBuffer, { contentType: file.type });
        const downloadURL = await getDownloadURL(fileStorageRef);
        (updatedGuestData as any)[fieldDef.urlKey] = downloadURL;
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Successfully uploaded ${file.name}. URL: ${downloadURL} stored in ${String(fieldDef.urlKey)}.`);
      } catch (fileProcessingError: any) {
        console.error(`[Action updateBookingStep - Step ${stepNumber}] Firebase Storage upload/processing FAILED for ${String(fieldDef.formDataKey)} (Token "${bookingToken}"):`, fileProcessingError.code, fileProcessingError.message);
        let userMessage = `Dateiupload für ${String(fieldDef.formDataKey)} fehlgeschlagen.`;
        if (fileProcessingError.code === 'storage/unauthorized') {
          userMessage = `Berechtigungsfehler beim Upload für ${String(fieldDef.formDataKey)}. Bitte Firebase Storage Regeln prüfen.`;
        } else if (fileProcessingError.code === 'storage/canceled') {
          userMessage = `Upload für ${String(fieldDef.formDataKey)} abgebrochen.`;
        }
        return {
          message: userMessage,
          errors: { [String(fieldDef.formDataKey)]: [userMessage] },
          success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
        };
      }
    } else if (oldFileUrl) {
      (updatedGuestData as any)[fieldDef.urlKey] = oldFileUrl; // Keep old URL if no new file
      console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(fieldDef.formDataKey)}, kept old URL for token "${bookingToken}".`);
    } else {
      delete (updatedGuestData as any)[fieldDef.urlKey]; // No new file and no old file, ensure URL key is not present
    }
  }

  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1);
  logSafe(`[Action updateBookingStep - Step ${stepNumber}] Final merged guest data before save for token "${bookingToken}":`, updatedGuestData);

  const bookingUpdates: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
    // updatedAt will be set by updateBookingInFirestore
  };

  if (updatedGuestData.gastVorname && updatedGuestData.gastNachname && !booking.guestSubmittedData?.gastVorname) { // Only update if not already set from guest data
    bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
    bookingUpdates.guestLastName = updatedGuestData.gastNachname;
  }

  if (stepNumber === 4 && dataFromForm.agbAkzeptiert === true && dataFromForm.datenschutzAkzeptiert === true) {
    updatedGuestData.submittedAt = new Date().toISOString(); // This will be converted to Timestamp by Firestore helper
    bookingUpdates.status = "Confirmed";
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final step. AGB & Datenschutz akzeptiert. SubmittedAt gesetzt, Status wird "Confirmed" für Token "${bookingToken}".`);
  } else if (stepNumber === 4) {
    console.warn(`[Action updateBookingStep - Step ${stepNumber}] Final step, but AGB/Datenschutz nicht akzeptiert. Status bleibt: ${booking.status}.`);
     return {
        message: "AGB und/oder Datenschutz wurden nicht akzeptiert.",
        errors: {
            agbAkzeptiert: !dataFromForm.agbAkzeptiert ? ["AGB müssen akzeptiert werden."] : undefined,
            datenschutzAkzeptiert: !dataFromForm.datenschutzAkzeptiert ? ["Datenschutz muss akzeptiert werden."] : undefined,
         },
        success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
      };
  }


  const updateSuccess = await updateBookingInFirestore(booking.id, bookingUpdates);
  if (updateSuccess) {
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully to Firestore for token: "${bookingToken}". Booking status: ${bookingUpdates.status || booking.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);
    revalidatePath(`/buchung/${bookingToken}`, "layout");
    revalidatePath(`/admin/bookings/${booking.id}`, "page");

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
    if (bookingUpdates.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return { message, errors: null, success: true, actionToken: serverActionToken, updatedGuestData: updatedGuestData, currentStep: stepNumber -1 };
  } else {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking in Firestore for token: "${bookingToken}".`);
    return {
      message: "Fehler beim Speichern der Daten in Firestore. Buchung konnte nicht aktualisiert werden.",
      errors: { global: ["Fehler beim Speichern der Buchungsaktualisierung."] }, success: false, actionToken: serverActionToken, updatedGuestData: currentGuestDataSnapshot, currentStep: stepNumber -1,
    };
  }
}


// --- Exported Server Actions ---
export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitGastStammdatenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}.`);
  try {
    return await updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitGastStammdatenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler bei Stammdaten-Verarbeitung (Code SA-STAMM-CATCH).", errors: { global: ["Serverfehler bei Stammdaten-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitAusweisdokumenteAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}.`);
  try {
    return await updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitAusweisdokumenteAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler bei Ausweisdokument-Verarbeitung (Code SA-AUSWEIS-CATCH).", errors: { global: ["Serverfehler bei Ausweisdokument-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitZahlungsinformationenAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}.`);
  try {
    return await updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitZahlungsinformationenAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler bei Zahlungsinformationen-Verarbeitung (Code SA-ZAHLUNG-CATCH).", errors: { global: ["Serverfehler bei Zahlungsinformationen-Verarbeitung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action submitEndgueltigeBestaetigungAction BEGIN] Token: "${bookingToken}". Action Token: ${serverActionToken}.`);
  try {
    return await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData, {}, serverActionToken);
  } catch (error: any) {
    console.error(`[Action submitEndgueltigeBestaetigungAction CRITICAL UNCAUGHT ERROR] Token: "${bookingToken}". Error:`, error.message, error.stack?.substring(0, 800));
    return { message: "Serverfehler beim Abschluss der Buchung (Code SA-FINAL-CATCH).", errors: { global: ["Serverfehler beim Abschluss der Buchung."] }, success: false, actionToken: serverActionToken, updatedGuestData: prevState.updatedGuestData || null, currentStep: prevState.currentStep ?? 0 };
  }
}

export async function createBookingAction(prevState: FormState | any, formData: FormData): Promise<FormState & { bookingToken?: string | null }> {
  const serverActionToken = generateActionToken();
  console.log(`[Action createBookingAction BEGIN] Action Token: ${serverActionToken}`);
  try {
    if (!firebaseInitializedCorrectly) {
        console.error("[Action createBookingAction] Firebase not correctly initialized.");
        return { message: "Serverfehler: Firebase ist nicht korrekt initialisiert (Code CBA-FIREBASE-INIT-FAIL).", errors: { global: ["Firebase Konfigurationsfehler."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const rawFormData = Object.fromEntries(formData.entries());
    logSafe("[Action createBookingAction Raw FormData]", rawFormData);
    const validatedFields = createBookingSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      console.error("[Action createBookingAction] Validation FAILED:", fieldErrors);
      return { errors: fieldErrors, message: "Fehler bei der Validierung.", success: false, actionToken: serverActionToken, bookingToken: null };
    }

    const bookingData = validatedFields.data;
    console.log("[Action createBookingAction] Validation successful.");

    const newBookingToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2,10);

    const newBookingPayload: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> = {
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      verpflegung: bookingData.verpflegung,
      zimmertyp: bookingData.zimmertyp,
      erwachsene: bookingData.erwachsene,
      kinder: bookingData.kinder,
      kleinkinder: bookingData.kleinkinder,
      alterKinder: bookingData.alterKinder || '',
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: `${bookingData.zimmertyp || 'Zimmer'} (${bookingData.erwachsene} Erw.)`,
      guestSubmittedData: { lastCompletedStep: -1 }
    };

    const createdBooking = await addBookingToFirestore(newBookingPayload);

    if (!createdBooking) {
      console.error("[Action createBookingAction] Failed to add booking to Firestore.");
      return { message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", errors: { global: ["Fehler beim Speichern der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
    }
    console.log(`[Action createBookingAction] New booking added to Firestore. Token: ${newBookingToken}. ID: ${createdBooking.id}`);

    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout");

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      errors: null,
      success: true,
      actionToken: serverActionToken,
      updatedGuestData: createdBooking.guestSubmittedData,
      bookingToken: newBookingToken,
    };
  } catch (e: any) {
    console.error("[Action createBookingAction CRITICAL UNCAUGHT ERROR]:", e.message, e.stack?.substring(0,800));
    return { message: "Unerwarteter Serverfehler beim Erstellen der Buchung (Code SA-CREATE-CATCH).", errors: { global: ["Serverfehler beim Erstellen der Buchung."] }, success: false, actionToken: serverActionToken, bookingToken: null };
  }
}

export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const serverActionToken = generateActionToken();
  console.log(`[Action deleteBookingsAction BEGIN] Attempting to delete bookings: ${bookingIds.join(', ')}. Action Token: ${serverActionToken}`);
  try {
    if (!firebaseInitializedCorrectly || !storage) {
        console.error("[Action deleteBookingsAction] Firebase not correctly initialized or Storage not available.");
        return { success: false, message: "Serverfehler: Firebase ist nicht korrekt initialisiert (Code DBA-FIREBASE-INIT-FAIL).", actionToken: serverActionToken };
    }
    if (!bookingIds || bookingIds.length === 0) {
      return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken: serverActionToken };
    }

    const fileUrlsToDelete: string[] = [];
    for (const id of bookingIds) {
        const booking = await findBookingByIdFromFirestore(id);
        if (booking?.guestSubmittedData) {
            if (booking.guestSubmittedData.hauptgastAusweisVorderseiteUrl) fileUrlsToDelete.push(booking.guestSubmittedData.hauptgastAusweisVorderseiteUrl);
            if (booking.guestSubmittedData.hauptgastAusweisRückseiteUrl) fileUrlsToDelete.push(booking.guestSubmittedData.hauptgastAusweisRückseiteUrl);
            if (booking.guestSubmittedData.zahlungsbelegUrl) fileUrlsToDelete.push(booking.guestSubmittedData.zahlungsbelegUrl);
        }
    }

    for (const url of fileUrlsToDelete) {
        if (url.includes("firebasestorage.googleapis.com")) {
            try {
                const fileRef = storageRefFB(storage, url);
                await deleteObject(fileRef);
                console.log(`[Action deleteBookingsAction] File ${url} deleted from Firebase Storage.`);
            } catch (error: any) {
                console.warn(`[Action deleteBookingsAction] Failed to delete file ${url} from Storage: ${error.message}. Continuing with Firestore deletion.`);
            }
        }
    }

    const deleteSuccess = await deleteBookingsFromFirestoreByIds(bookingIds);
    if (deleteSuccess) {
      revalidatePath("/admin/dashboard", "layout");
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken: serverActionToken };
    } else {
      return { success: false, message: "Fehler beim Löschen der Buchungen aus Firestore.", actionToken: serverActionToken };
    }
  } catch (error: any) {
    console.error(`[Action deleteBookingsAction CRITICAL UNCAUGHT ERROR] Error deleting bookings: ${error.message}`, error.stack?.substring(0, 800));
    return { success: false, message: `Unerwarteter Serverfehler beim Löschen (Code SA-DELETE-CATCH): ${error.message}`, actionToken: serverActionToken };
  }
}
