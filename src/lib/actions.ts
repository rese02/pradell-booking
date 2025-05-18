
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, GastStammdatenFormData, AusweisdokumenteFormData, ZahlungsinformationenFormData, UebersichtBestaetigungFormData, CreateBookingFormData } from "@/lib/definitions";
import { 
  addMockBooking, 
  findMockBookingByToken, 
  updateMockBookingByToken 
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
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_PDF_TYPES];

const fileSchema = z.instanceof(File).optional().nullable()
  .refine((file) => !file || file.size === 0 || file.size <= MAX_FILE_SIZE, `Maximale Dateigröße ist 10MB.`)
  .refine(
    (file) => !file || file.size === 0 || ACCEPTED_FILE_TYPES.includes(file.type),
    "Nur .jpg, .jpeg, .png und .pdf Dateien sind erlaubt."
  );

// --- Schemas für die einzelnen Schritte des Gästebuchungsformulars ---

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
  // zahlungsbetrag wird serverseitig hinzugefügt
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on", z.boolean().refine(val => val === true, {
    message: "Sie müssen den AGB zustimmen.",
  })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on", z.boolean().refine(val => val === true, {
    message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
  })),
});


// --- Server Actions ---

function generateActionToken() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

export async function createBookingAction(prevState: any, formData: FormData) {
  console.log("[Action createBookingAction] Received form data:", Object.fromEntries(formData.entries()));
  const validatedFields = createBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  const actionToken = generateActionToken(); // Generate new token for every attempt

  if (!validatedFields.success) {
    console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      bookingToken: null,
      success: false,
      actionToken,
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
        lastCompletedStep: -1, // No steps completed yet, -1 or undefined
      }
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout");

    return {
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      bookingToken: newBookingToken,
      errors: null,
      success: true,
      actionToken,
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error("[Action createBookingAction] Error creating booking:", error.message, error.stack);
    return { 
        message: "Datenbankfehler: Buchung konnte nicht erstellt werden.", 
        errors: null, 
        bookingToken: null, 
        success: false,
        actionToken,
    };
  }
}

type GuestSubmittedDataAsFormData = Omit<GuestSubmittedData, 
  'hauptgastAusweisVorderseiteUrl' | 
  'hauptgastAusweisRückseiteUrl' | 
  'zahlungsbelegUrl' |
  'agbAkzeptiert' | 
  'datenschutzAkzeptiert'
> & {
  hauptgastAusweisVorderseite?: File | null;
  hauptgastAusweisRückseite?: File | null;
  zahlungsbeleg?: File | null;
  agbAkzeptiert?: "on" | boolean; // FormData might send "on"
  datenschutzAkzeptiert?: "on" | boolean; // FormData might send "on"
};


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-based step number (1, 2, 3, 4)
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
) {
  const rawFormData = Object.fromEntries(formData.entries());
  const newServerActionToken = generateActionToken();

  console.log(`[Action updateBookingStep - Step ${stepNumber}] For token: ${bookingToken}. Server Action Token Generated: ${newServerActionToken}. Raw FormData:`, JSON.stringify(rawFormData, (key, value) => {
    if (value instanceof File) { return { name: value.name, size: value.size, type: value.type }; }
    return value;
  }).substring(0, 1000) + "...");


  try {
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Validation failed for token ${bookingToken}:`, validatedFields.error.flatten().fieldErrors);
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: `Fehler bei der Validierung für Schritt ${stepNumber}. Bitte überprüfen Sie Ihre Eingaben.`,
        success: false,
        actionToken: newServerActionToken,
        updatedGuestData: null,
      };
    }

    const dataFromForm = validatedFields.data as GuestSubmittedDataAsFormData;
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data for token ${bookingToken}:`, JSON.stringify(dataFromForm, (key, value) => {
      if (value instanceof File) { return { name: value.name, size: value.size, type: value.type };}
      if (typeof value === 'string' && value.length > 100 && value.startsWith('data:')) { return value.substring(0,100) + '...'; }
      return value;
    }).substring(0,1000) + "...");

    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }

    const currentGuestData = booking.guestSubmittedData || {};
    
    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestData,
      ...additionalDataToMerge,
      ...dataFromForm, 
      lastCompletedStep: Math.max(currentGuestData.lastCompletedStep ?? -1, stepNumber - 1), // stepNumber is 1-based, lastCompletedStep is 0-based index
    };
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data (before file handling) for token ${bookingToken}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}`);


    const fileFields: { formDataKey: keyof GuestSubmittedDataAsFormData; urlKey: keyof GuestSubmittedData }[] = [
      { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
      { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
      { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
    ];

    for (const field of fileFields) {
      const file = dataFromForm[field.formDataKey] as File | undefined | null;
      try {
        if (file && file.size > 0) {
          if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
            const buffer = Buffer.from(await file.arrayBuffer());
            const base64 = buffer.toString('base64');
            updatedGuestData[field.urlKey] = `data:${file.type};base64,${base64}`;
            console.log(`[Action updateBookingStep - Step ${stepNumber}] Generated data URI for image ${file.name} (token ${bookingToken})`);
          } else if (ACCEPTED_PDF_TYPES.includes(file.type)) {
            updatedGuestData[field.urlKey] = `mock-pdf-url:${encodeURIComponent(file.name)}`;
            console.log(`[Action updateBookingStep - Step ${stepNumber}] Generated PDF marker for ${file.name} (token ${bookingToken})`);
          } else {
            updatedGuestData[field.urlKey] = `unsupported-file-type:${encodeURIComponent(file.name)}`;
            console.warn(`[Action updateBookingStep - Step ${stepNumber}] Unsupported file type ${file.type} for ${file.name} (token ${bookingToken})`);
          }
        } else if (currentGuestData && currentGuestData[field.urlKey]) {
          // No new file, preserve existing URL if it exists
          updatedGuestData[field.urlKey] = currentGuestData[field.urlKey];
        } else {
          // No new file and no existing URL, ensure it's cleared
          delete updatedGuestData[field.urlKey];
        }
      } catch (fileProcessingError: any) {
        console.error(`[Action updateBookingStep - Step ${stepNumber}] Error processing file for field ${String(field.formDataKey)} (token ${bookingToken}): ${fileProcessingError.message}`, fileProcessingError.stack);
        return {
            message: `Serverfehler: Datei für Feld '${String(field.formDataKey)}' konnte nicht verarbeitet werden. Grund: ${fileProcessingError.message}`,
            errors: { [String(field.formDataKey)]: [`Datei-Verarbeitungsfehler: ${fileProcessingError.message}`] },
            success: false,
            actionToken: newServerActionToken,
            updatedGuestData: null
        };
      }
    }
     
    if (stepNumber === 4) { // Uebersicht & Bestaetigung
        // Zod schema already transformed "on" to boolean true
        updatedGuestData.agbAkzeptiert = dataFromForm.agbAkzeptiert === true;
        updatedGuestData.datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true;
        
        if (updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
            updatedGuestData.submittedAt = new Date().toISOString();
        }
        console.log(`[Action updateBookingStep - Step 4] AGB accepted: ${updatedGuestData.agbAkzeptiert}, Datenschutz accepted: ${updatedGuestData.datenschutzAkzeptiert}`);
    }
    
    const finalGuestDataLog = { ...updatedGuestData };
    fileFields.forEach(f => {
      if (finalGuestDataLog[f.urlKey] && typeof finalGuestDataLog[f.urlKey] === 'string' && (finalGuestDataLog[f.urlKey] as string).startsWith('data:image')) {
        (finalGuestDataLog[f.urlKey] as any) = `data:image/...[truncated]`;
      }
    });
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final updated guest data (after file handling) for token ${bookingToken}:`, finalGuestDataLog);

    const bookingUpdates: Partial<Booking> = {
        guestSubmittedData: updatedGuestData,
        updatedAt: new Date().toISOString(),
    };

    if (stepNumber === 1 && dataFromForm.gastVorname && dataFromForm.gastNachname) {
        bookingUpdates.guestFirstName = dataFromForm.gastVorname;
        bookingUpdates.guestLastName = dataFromForm.gastNachname;
    }
   
    if (stepNumber === 4 && updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
      bookingUpdates.status = "Confirmed";
    }


    const updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates);

    if (updateSuccess) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: ${bookingToken}. Status: ${bookingUpdates.status || booking.status}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); 
      if (booking.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
      
      let message = `Schritt ${stepNumber} erfolgreich übermittelt.`;
      if (bookingUpdates.status === "Confirmed") {
          message = "Buchung erfolgreich abgeschlossen und bestätigt!";
      }

      return { 
        message,
        errors: null, 
        success: true, 
        actionToken: newServerActionToken,
        updatedGuestData: updatedGuestData 
      };
    } else {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: ${bookingToken} in mock DB.`);
      return { message: "Fehler beim Speichern der Daten.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL UNEXPECTED ERROR for token ${bookingToken}:`, error.message, error.stack);
    return { 
        message: `Unerwarteter Serverfehler: Daten für Schritt ${stepNumber} konnten nicht verarbeitet werden. Grund: ${error.message}`, 
        errors: null, 
        success: false, 
        actionToken: newServerActionToken, 
        updatedGuestData: null 
    };
  }
}

// --- Wrapper-Aktionen für die einzelnen Schritte ---

export async function submitGastStammdatenAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitGastStammdatenAction] Called.");
  return updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData);
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitAusweisdokumenteAction] Called.");
  return updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData);
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitZahlungsinformationenAction] Called.");
  const booking = findMockBookingByToken(bookingToken);
  const anzahlungsbetrag = booking ? parseFloat((booking.price * 0.3).toFixed(2)) : 0;
  
  return updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {
    zahlungsbetrag: anzahlungsbetrag, 
  });
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitEndgueltigeBestaetigungAction] Called.");
  // Die Logik zum Setzen des Status "Confirmed" ist jetzt in updateBookingStep für stepNumber 4.
  return updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData);
}
