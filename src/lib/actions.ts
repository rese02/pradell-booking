
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, GuestSubmittedDataFromForm } from "@/lib/definitions";
import { 
  findMockBookingByToken, 
  updateMockBookingByToken,
  addMockBooking,
  deleteMockBookingsByIds,
} from "@/lib/mock-db";

// --- Zod Schemas ---

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
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 10MB.`)
  .refine(
    (file) => {
      if (!file || file.size === 0) return true; 
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur ${ACCEPTED_FILE_TYPES.map(t => t.split('/')[1]).join(', ').toUpperCase()} Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
  );

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => {
    if (!val || val === "") return true; 
    const date = new Date(val);
    return !isNaN(date.getTime());
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


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string; 
  updatedGuestData?: GuestSubmittedData | null; 
};

function generateActionToken() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

// Helper function to log FormData safely
function logFormData(context: string, bookingToken: string, rawFormDataEntries: Record<string, any>) {
  try {
    const loggableEntries: Record<string, any> = {};
    for (const key in rawFormDataEntries) {
      if (Object.prototype.hasOwnProperty.call(rawFormDataEntries, key)) {
        const value = rawFormDataEntries[key];
        if (value instanceof File) {
          loggableEntries[key] = { name: value.name, size: value.size, type: value.type, lastModified: (value as any).lastModified };
        } else {
          loggableEntries[key] = value;
        }
      }
    }
    console.log(`${context} Raw FormData for token "${bookingToken}":`, JSON.stringify(loggableEntries, null, 2));
  } catch (e) {
    console.error(`${context} Error logging FormData for token "${bookingToken}":`, e);
  }
}

// Helper to stringify safely for logging, avoiding circular refs and truncating long strings
function stringifyReplacer(key: string, value: any) {
  if (value === undefined) {
    return 'undefined'; // Stringify undefined
  }
  if (typeof value === 'string' && value.length > 200) { 
    return value.substring(0, 200) + `...[truncated ${value.length} bytes]`;
  }
  return value;
}

async function updateBookingStep(
  bookingToken: string,
  stepNumber: number,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<FormState> {
  const serverActionToken = generateActionToken();
  console.log(`[Action updateBookingStep BEGIN - Step ${stepNumber}] Token: "${bookingToken}". Action Token: ${serverActionToken}.`);

  let rawFormData: Record<string, any>;
  try {
    rawFormData = Object.fromEntries(formData.entries());
    logFormData(`[Action updateBookingStep - Step ${stepNumber}]`, bookingToken, rawFormData);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL ERROR converting FormData to object for token "${bookingToken}":`, err.message, err.stack);
    return {
      message: `Serverfehler bei der Formularverarbeitung (Code 1) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: serverActionToken, updatedGuestData: null,
    };
  }

  let validatedFields: z.SafeParseReturnType<any, any>;
  try {
    validatedFields = actionSchema.safeParse(rawFormData);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL ERROR during Zod parsing for token "${bookingToken}":`, err.message, err.stack);
    return {
      message: `Serverfehler bei der Datenvalidierung (Code 2) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: serverActionToken, updatedGuestData: null,
    };
  }

  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    console.warn(`[Action updateBookingStep - Step ${stepNumber}] Validation failed for token "${bookingToken}":`, JSON.stringify(fieldErrors, stringifyReplacer, 2));
    return {
      errors: fieldErrors,
      message: `Validierungsfehler für Schritt ${stepNumber}. Bitte Eingaben prüfen.`,
      success: false, actionToken: serverActionToken, updatedGuestData: null,
    };
  }

  console.log(`[Action updateBookingStep - Step ${stepNumber}] Validation successful for token "${bookingToken}".`);
  const dataFromForm = validatedFields.data as GuestSubmittedDataFromForm;

  try {
    const loggableDataFromForm: Record<string, any> = { ...dataFromForm };
    for (const key of ['hauptgastAusweisVorderseite', 'hauptgastAusweisRückseite', 'zahlungsbeleg'] as (keyof GuestSubmittedDataFromForm)[]) {
      if (loggableDataFromForm[key] instanceof File) {
        const file = loggableDataFromForm[key] as File;
        loggableDataFromForm[key] = { name: file.name, size: file.size, type: file.type };
      }
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data (files as objects) for token "${bookingToken}":`, JSON.stringify(loggableDataFromForm, stringifyReplacer, 2));
  } catch (e) {
    console.warn(`[Action updateBookingStep - Step ${stepNumber}] Error logging validated data for token "${bookingToken}":`, e);
  }

  let booking: Booking | undefined;
  let currentBookingDataSnapshot: GuestSubmittedData | null = null;

  try {
    booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: "${bookingToken}"`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: serverActionToken, updatedGuestData: null };
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking found for token "${bookingToken}". Status: ${booking.status}.`);
    currentBookingDataSnapshot = JSON.parse(JSON.stringify(booking.guestSubmittedData || { lastCompletedStep: -1 }));
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Error fetching/preparing booking for token "${bookingToken}":`, err.message, err.stack);
    return {
      message: `Serverfehler beim Laden der Buchungsdaten (Code 3) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: serverActionToken, updatedGuestData: null,
    };
  }

  let updatedGuestData: GuestSubmittedData = {
    ...(currentBookingDataSnapshot ?? { lastCompletedStep: -1 }),
    ...(additionalDataToMerge ?? {}),
    ...dataFromForm,
  };

  // File processing - Simplified to always use mock-file-url
  const fileFields: { formDataKey: keyof GuestSubmittedDataFromForm; urlKey: keyof GuestSubmittedData }[] = [
    { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
    { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
    { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
  ];

  for (const field of fileFields) {
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing file field: ${String(field.formDataKey)} for token "${bookingToken}"`);
    const file = rawFormData[String(field.formDataKey)] as File | undefined | null; 

    try {
      if (file instanceof File && file.size > 0) {
        // Validate again for safety, though Zod should have caught it
        if (file.size > MAX_FILE_SIZE) {
            throw new Error(`Datei ${file.name} ist zu groß (${file.size} bytes). Max: ${MAX_FILE_SIZE} bytes.`);
        }
        if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
            throw new Error(`Dateityp ${file.type} für ${file.name} ist nicht erlaubt.`);
        }
        
        // Simplified: Always store as mock-file-url
        const fileUrl = `mock-file-url:${encodeURIComponent(file.name)}`;
        (updatedGuestData as any)[field.urlKey] = fileUrl;
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Stored mock URL for ${file.name}: ${fileUrl} for token "${bookingToken}"`);

      } else if ((updatedGuestData as any)[field.urlKey]) {
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(field.formDataKey)}, keeping old URL: ${(updatedGuestData as any)[field.urlKey]?.substring(0,50)}... for token "${bookingToken}"`);
      } else {
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file and no old URL for ${String(field.formDataKey)} for token "${bookingToken}"`);
        delete (updatedGuestData as any)[field.urlKey];
      }
    } catch (fileProcessingError) {
      const err = fileProcessingError instanceof Error ? fileProcessingError : new Error(String(fileProcessingError));
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Error processing file for ${String(field.formDataKey)} (Token "${bookingToken}"):`, err.message, err.stack?.substring(0, 500));
      return {
        message: `Fehler bei Dateiverarbeitung für ${String(field.formDataKey)}: ${err.message}.`,
        errors: { [String(field.formDataKey)]: [err.message] },
        success: false, actionToken: serverActionToken, updatedGuestData: currentBookingDataSnapshot,
      };
    }
  }

  updatedGuestData.lastCompletedStep = Math.max(updatedGuestData.lastCompletedStep ?? -1, stepNumber - 1); 
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data for token "${bookingToken}". New lastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);

  if (stepNumber === 4) { 
    const agb = dataFromForm.agbAkzeptiert;
    const datenschutz = dataFromForm.datenschutzAkzeptiert;
    console.log(`[Action updateBookingStep - Step ${stepNumber}] AGB: ${agb}, Datenschutz: ${datenschutz} (aus dataFromForm)`);

    updatedGuestData.agbAkzeptiert = agb;
    updatedGuestData.datenschutzAkzeptiert = datenschutz;

    if (agb && datenschutz) {
      updatedGuestData.submittedAt = new Date().toISOString();
      console.log(`[Action updateBookingStep - Step ${stepNumber}] AGB & Datenschutz akzeptiert. SubmittedAt gesetzt für Token "${bookingToken}".`);
    } else {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] AGB und/oder Datenschutz nicht akzeptiert für Token "${bookingToken}". SubmittedAt nicht gesetzt.`);
    }
  }

  const bookingUpdates: Partial<Booking> = {
    guestSubmittedData: updatedGuestData,
    updatedAt: new Date().toISOString(),
  };

  if (stepNumber === 1 && updatedGuestData.gastVorname && updatedGuestData.gastNachname) {
    bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
    bookingUpdates.guestLastName = updatedGuestData.gastNachname;
  }

  if (stepNumber === 4 && updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
    bookingUpdates.status = "Confirmed";
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Booking status for token "${bookingToken}" wird auf "Confirmed" gesetzt.`);
  }

  try {
    let loggingGuestData;
    try {
        loggingGuestData = JSON.stringify(updatedGuestData, stringifyReplacer, 2);
    } catch (stringifyError) {
        loggingGuestData = "[Error stringifying updatedGuestData for logging]";
        console.error(`[Action updateBookingStep - Step ${stepNumber}] Error stringifying updatedGuestData for logging (Token "${bookingToken}"):`, stringifyError);
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final updated guest data for token "${bookingToken}":`, loggingGuestData);

    let loggingBookingUpdates;
    try {
        loggingBookingUpdates = JSON.stringify(bookingUpdates, stringifyReplacer, 2);
    } catch (stringifyError) {
        loggingBookingUpdates = "[Error stringifying bookingUpdates for logging]";
        console.error(`[Action updateBookingStep - Step ${stepNumber}] Error stringifying bookingUpdates for logging (Token "${bookingToken}"):`, stringifyError);
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Attempting to update mock DB for token "${bookingToken}" with updates:`, loggingBookingUpdates);

  } catch (e) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Error during final logging phase for token "${bookingToken}":`, e);
  }
  
  let updateSuccess = false;
  try {
    updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL ERROR during updateMockBookingByToken for token "${bookingToken}":`, err.message, err.stack);
    return {
      message: `Serverfehler beim Speichern der Buchung (Code 4) für Schritt ${stepNumber}.`,
      errors: null, success: false, actionToken: serverActionToken, updatedGuestData: currentBookingDataSnapshot,
    };
  }

  if (updateSuccess) {
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: "${bookingToken}". Booking status: ${bookingUpdates.status || booking?.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}.`);
    revalidatePath(`/buchung/${bookingToken}`, "layout");
    if (booking?.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");

    let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
    if (bookingUpdates.status === "Confirmed") {
      message = "Buchung erfolgreich abgeschlossen und bestätigt!";
    }
    return {
      message, errors: null, success: true, actionToken: serverActionToken, updatedGuestData: updatedGuestData,
    };
  } else {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: "${bookingToken}" in mock DB (updateMockBookingByToken returned false).`);
    return {
      message: "Fehler beim Speichern der Daten (Code 5).",
      errors: null, success: false, actionToken: serverActionToken, updatedGuestData: currentBookingDataSnapshot,
    };
  }
}

export async function submitGastStammdatenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log(`[Action submitGastStammdatenAction] Called for bookingToken: "${bookingToken}"`);
  return updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData, {});
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log(`[Action submitAusweisdokumenteAction] Called for bookingToken: "${bookingToken}"`);
  const rawFormDataEntries = Object.fromEntries(formData.entries());
  logFormData('[Action submitAusweisdokumenteAction]', bookingToken, rawFormDataEntries);
  return updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData, {});
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log(`[Action submitZahlungsinformationenAction] Called for bookingToken: "${bookingToken}"`);
  const rawFormDataEntries = Object.fromEntries(formData.entries());
  logFormData('[Action submitZahlungsinformationenAction]', bookingToken, rawFormDataEntries);
  
  return updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {});
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: FormState, formData: FormData): Promise<FormState> {
  console.log(`[Action submitEndgueltigeBestaetigungAction] Called for bookingToken: "${bookingToken}"`);
  return updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData, {});
}

export async function createBookingAction(prevState: FormState, formData: FormData): Promise<FormState> {
  const rawFormData = Object.fromEntries(formData.entries());
  console.log("[Action createBookingAction] Received form data:", rawFormData);
  const validatedFields = createBookingSchema.safeParse(rawFormData);
  const newActionToken = generateActionToken(); 

  if (!validatedFields.success) {
    console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      success: false,
      actionToken: newActionToken,
      updatedGuestData: null,
    };
  }

  const bookingData = validatedFields.data;

  try {
    const newBookingId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    const newBookingToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const newBooking: Booking = {
      id: newBookingId,
      guestFirstName: bookingData.guestFirstName,
      guestLastName: bookingData.guestLastName,
      price: bookingData.price,
      checkInDate: new Date(bookingData.checkInDate).toISOString(),
      checkOutDate: new Date(bookingData.checkOutDate).toISOString(),
      bookingToken: newBookingToken,
      status: "Pending Guest Information",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      verpflegung: bookingData.verpflegung,
      zimmertyp: bookingData.zimmertyp,
      erwachsene: bookingData.erwachsene,
      kinder: bookingData.kinder,
      kleinkinder: bookingData.kleinkinder,
      alterKinder: bookingData.alterKinder || '',
      interneBemerkungen: bookingData.interneBemerkungen || '',
      roomIdentifier: `${bookingData.zimmertyp || 'Zimmer'}`, 
      guestSubmittedData: { 
        lastCompletedStep: -1, 
      }
    };

    addMockBooking(newBooking); 
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout"); 

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt. Token: ${newBookingToken}`,
      errors: null,
      success: true,
      actionToken: newActionToken,
      updatedGuestData: newBooking.guestSubmittedData, 
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction] Error creating booking:", error.message, error.stack);
    return { 
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", 
        errors: null, 
        success: false,
        actionToken: newActionToken,
        updatedGuestData: null,
    };
  }
}


export async function deleteBookingsAction(bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
  const actionToken = generateActionToken();
  console.log(`[Action deleteBookingsAction] Attempting to delete bookings with IDs: ${bookingIds.join(', ')}`);
  
  if (!bookingIds || bookingIds.length === 0) {
    return { success: false, message: "Keine Buchungs-IDs zum Löschen angegeben.", actionToken };
  }

  try {
    const deleteSuccess = deleteMockBookingsByIds(bookingIds); 

    if (deleteSuccess) {
      revalidatePath("/admin/dashboard", "layout"); 
      console.log(`[Action deleteBookingsAction] Successfully deleted bookings. Revalidating dashboard.`);
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken };
    } else {
      console.warn(`[Action deleteBookingsAction] deleteMockBookingsByIds reported no success for IDs: ${bookingIds.join(', ')}`);
      return { success: false, message: "Buchungen konnten nicht aus der Mock-DB gelöscht werden (interne Logik).", actionToken };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
    console.error(`[Action deleteBookingsAction] Error deleting bookings: ${errorMessage}`);
    return { success: false, message: `Fehler beim Löschen der Buchungen: ${errorMessage}`, actionToken };
  }
}
    
