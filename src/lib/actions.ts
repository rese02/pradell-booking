
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { 
  findMockBookingByToken, 
  updateMockBookingByToken,
  addMockBooking,
  deleteMockBookingsByIds,
  getMockBookings
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
});

const uebersichtBestaetigungSchema = z.object({
  agbAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den AGB zustimmen.",
  })),
  datenschutzAkzeptiert: z.preprocess((val) => val === "on" || val === true, z.boolean().refine(val => val === true, {
    message: "Sie müssen den Datenschutzbestimmungen zustimmen.",
  })),
});


// --- Server Actions ---

function generateActionToken() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

export async function createBookingAction(prevState: any, formData: FormData) {
  const rawFormData = Object.fromEntries(formData.entries());
  console.log("[Action createBookingAction] Received form data:", rawFormData);
  const validatedFields = createBookingSchema.safeParse(rawFormData);
  const actionToken = generateActionToken(); 

  if (!validatedFields.success) {
    console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      bookingToken: null,
      success: false,
      actionToken,
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
      message: `Buchung für ${bookingData.guestFirstName} ${bookingData.guestLastName} erstellt.`,
      bookingToken: newBookingToken,
      errors: null,
      success: true,
      actionToken,
      updatedGuestData: newBooking.guestSubmittedData,
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
        updatedGuestData: null,
    };
  }
}

type GuestSubmittedDataFromForm = Omit<GuestSubmittedData, 
  'hauptgastAusweisVorderseiteUrl' | 
  'hauptgastAusweisRückseiteUrl' | 
  'zahlungsbelegUrl'
> & {
  hauptgastAusweisVorderseite?: File | null;
  hauptgastAusweisRückseite?: File | null;
  zahlungsbeleg?: File | null;
};


async function updateBookingStep(
  bookingToken: string,
  stepNumber: number, // 1-basiert
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData>
): Promise<{ success: boolean; message: string | null; errors: Record<string, string[] | undefined> | null; actionToken: string; updatedGuestData: GuestSubmittedData | null; }> {
  
  const newServerActionToken = generateActionToken();
  const rawFormData = Object.fromEntries(formData.entries());
  
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Token: ${bookingToken}. Action Token: ${newServerActionToken}. Raw FormData (files as objects):`, 
    JSON.stringify(Object.fromEntries(
      Object.entries(rawFormData).map(([key, value]) => {
        if (value instanceof File) return [key, { name: value.name, size: value.size, type: value.type }];
        return [key, value];
      })
    )).substring(0, 1000)
  );

  try {
    const validatedFields = actionSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Validation failed for token ${bookingToken}:`, JSON.stringify(fieldErrors));
      return {
        errors: fieldErrors,
        message: `Fehler bei der Validierung für Schritt ${stepNumber}. Bitte überprüfen Sie Ihre Eingaben.`,
        success: false,
        actionToken: newServerActionToken,
        updatedGuestData: null,
      };
    }

    const dataFromForm = validatedFields.data as GuestSubmittedDataFromForm;
    const loggableDataFromForm = {...dataFromForm};
    // Log files by their properties, not the full File object
    for (const key of ['hauptgastAusweisVorderseite', 'hauptgastAusweisRückseite', 'zahlungsbeleg'] as (keyof GuestSubmittedDataFromForm)[]) {
        if (loggableDataFromForm[key] instanceof File) {
            const file = loggableDataFromForm[key] as File;
            (loggableDataFromForm as any)[key] = { name: file.name, size: file.size, type: file.type };
        }
    }
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data for token ${bookingToken}:`, JSON.stringify(loggableDataFromForm, null, 2));


    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }

    const currentGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(booking.guestSubmittedData || { lastCompletedStep: -1 }));
    
    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestData,
      ...additionalDataToMerge, 
      ...dataFromForm, 
    };
    
    // Correctly set lastCompletedStep to 0-based index
    updatedGuestData.lastCompletedStep = Math.max(currentGuestData.lastCompletedStep ?? -1, stepNumber - 1);
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data (before file handling) for token ${bookingToken}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}`);

    const fileFields: { formDataKey: keyof GuestSubmittedDataFromForm; urlKey: keyof GuestSubmittedData }[] = [
      { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
      { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
      { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
    ];

    for (const field of fileFields) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing file field definition: ${String(field.formDataKey)}`);
      const file = dataFromForm[field.formDataKey] as File | undefined | null;
      console.log(`[Action updateBookingStep - Step ${stepNumber}] File for ${String(field.formDataKey)}: ${file ? `Name: ${file.name}, Size: ${file.size}, Type: ${file.type}` : 'Not present or empty'}`);

      if (file instanceof File && file.size > 0) {
        console.log(`[Action updateBookingStep - Step ${stepNumber}] Valid file ${file.name} (type: ${file.type}, size: ${file.size} bytes) for ${String(field.formDataKey)}.`);
        try {
          // SIMPLIFIED MOCK: Store a generic marker with the filename for ALL file types
          updatedGuestData[field.urlKey] = `mock-file-url:${encodeURIComponent(file.name)}`;
          console.log(`[Action updateBookingStep - Step ${stepNumber}] Stored MOCK URL for ${file.name}: ${updatedGuestData[field.urlKey]}`);

        } catch (fileProcessingError: any) {
          console.error(`[Action updateBookingStep - Step ${stepNumber}] Error (during simple mock URL creation) for file ${file.name} (field ${String(field.formDataKey)}, token ${bookingToken}):`, fileProcessingError);
          return {
              message: `Serverfehler: Datei '${file.name}' (${String(field.formDataKey)}) konnte nicht verarbeitet werden: ${fileProcessingError.message}.`,
              errors: { [String(field.formDataKey)]: [`Interner Fehler bei Dateiverarbeitung für ${file.name}: ${fileProcessingError.message}`] },
              success: false,
              actionToken: newServerActionToken,
              updatedGuestData: currentGuestData
          };
        }
      } else if (currentGuestData && currentGuestData[field.urlKey]) {
        updatedGuestData[field.urlKey] = currentGuestData[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new valid file for ${String(field.formDataKey)}, keeping old URL: ${updatedGuestData[field.urlKey]}`);
      } else {
        delete updatedGuestData[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new valid file and no old URL for ${String(field.formDataKey)}.`);
      }
    }
     
    if (stepNumber === 4) { // Übersicht & Bestätigung
        updatedGuestData.agbAkzeptiert = dataFromForm.agbAkzeptiert === true; // Zod preprocess should handle "on"
        updatedGuestData.datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true;
        
        if (updatedGuestData.agbAkzeptiert && updatedGuestData.datenschutzAkzeptiert) {
            updatedGuestData.submittedAt = new Date().toISOString();
            console.log(`[Action updateBookingStep - Step 4] AGB & Datenschutz akzeptiert. SubmittedAt gesetzt.`);
        } else {
            console.warn(`[Action updateBookingStep - Step 4] AGB und/oder Datenschutz nicht akzeptiert. SubmittedAt nicht gesetzt.`);
        }
    }
    
    const finalGuestDataLog = { ...updatedGuestData };
    fileFields.forEach(f => {
      if (finalGuestDataLog[f.urlKey] && typeof finalGuestDataLog[f.urlKey] === 'string' && (finalGuestDataLog[f.urlKey] as string).startsWith('data:image')) {
        (finalGuestDataLog[f.urlKey] as any) = `data:image/...[truncated ${ (finalGuestDataLog[f.urlKey] as string).length} bytes]`;
      }
    });
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final updated guest data (after file handling) for token ${bookingToken}:`, JSON.stringify(finalGuestDataLog, null, 2));

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
      console.log(`[Action updateBookingStep - Step 4] Booking status for token ${bookingToken} set to Confirmed.`);
    }

    const updateSuccess = updateMockBookingByToken(bookingToken, bookingUpdates);

    if (updateSuccess) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: ${bookingToken}. Status: ${bookingUpdates.status || booking.status}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}. Returning success to client.`);
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
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: ${bookingToken} in mock DB. Returning error to client.`);
      return { 
        message: "Fehler beim Speichern der Daten in der Mock-DB.", 
        errors: null, 
        success: false, 
        actionToken: newServerActionToken, 
        updatedGuestData: currentGuestData
      };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL UNEXPECTED OUTER ERROR for token ${bookingToken}:`, error.message, error.stack);
    return { 
        message: `Unerwarteter Serverfehler in Schritt ${stepNumber}: ${error.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.`, 
        errors: null, 
        success: false, 
        actionToken: newServerActionToken, 
        updatedGuestData: null
    };
  }
}

export async function submitGastStammdatenAction(prevState: {actionToken?: string}, formData: FormData, bookingToken: string) {
  console.log("[Action submitGastStammdatenAction] Called.");
  return updateBookingStep(bookingToken, 1, gastStammdatenSchema, formData);
}

export async function submitAusweisdokumenteAction(prevState: {actionToken?: string}, formData: FormData, bookingToken: string) {
  console.log("[Action submitAusweisdokumenteAction] Called.");
  return updateBookingStep(bookingToken, 2, ausweisdokumenteSchema, formData);
}

export async function submitZahlungsinformationenAction(prevState: {actionToken?: string}, formData: FormData, bookingToken: string) {
  console.log("[Action submitZahlungsinformationenAction] Called.");
  const booking = findMockBookingByToken(bookingToken);
  let anzahlungsbetrag = 0;
  if (booking && typeof booking.price === 'number') {
    anzahlungsbetrag = parseFloat((booking.price * 0.3).toFixed(2));
  } else {
     console.warn(`[Action submitZahlungsinformationenAction] Booking not found or price not a number for token ${bookingToken}. Anzahlungsbetrag ist 0.`);
  }
  
  return updateBookingStep(bookingToken, 3, zahlungsinformationenSchema, formData, {
    zahlungsbetrag: anzahlungsbetrag, 
  });
}

export async function submitEndgueltigeBestaetigungAction(prevState: {actionToken?: string}, formData: FormData, bookingToken: string) {
  console.log("[Action submitEndgueltigeBestaetigungAction] Called.");
  return updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData);
}

export async function deleteBookingsAction(prevState: any, bookingIds: string[]): Promise<{ success: boolean; message: string, actionToken: string }> {
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
