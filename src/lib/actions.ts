
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData, CreateBookingFormData } from "@/lib/definitions";
import { 
  addMockBooking, 
  findMockBookingByToken, 
  updateMockBookingByToken,
  deleteMockBookingsByIds,
  getMockBookings // For debugging
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
      console.log(`[fileSchema refine type check] File: ${file.name}, Type: ${file.type}, Size: ${file.size}`);
      return ACCEPTED_FILE_TYPES.includes(file.type);
    },
    (file) => ({ message: `Nur ${ACCEPTED_FILE_TYPES.join(', ')} Dateien sind erlaubt. Erhalten: ${file?.type || 'unbekannt'}` })
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
  // zahlungsbetrag wird serverseitig hinzugefügt und sollte nicht vom Client kommen
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
        lastCompletedStep: -1, // Bedeutet, dass kein Schritt des Gastformulars abgeschlossen wurde
      }
    };

    addMockBooking(newBooking);
    console.log(`[Action createBookingAction] New booking added. Token: ${newBookingToken}. ID: ${newBookingId}`);
    
    revalidatePath("/admin/dashboard", "layout");
    revalidatePath(`/buchung/${newBookingToken}`, "layout"); // Revalidate guest page for new token

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
  'zahlungsbelegUrl' |
  'agbAkzeptiert' | 
  'datenschutzAkzeptiert'
> & {
  hauptgastAusweisVorderseite?: File | null;
  hauptgastAusweisRückseite?: File | null;
  zahlungsbeleg?: File | null;
  agbAkzeptiert?: "on" | boolean | string; // FormData can send "on" or "true"
  datenschutzAkzeptiert?: "on" | boolean | string;
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
    )).substring(0, 1000) // Log more for debugging
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
        updatedGuestData: null, // Kein Update bei Validierungsfehler
      };
    }

    const dataFromForm = validatedFields.data as GuestSubmittedDataFromForm;
    // Log validated data (ohne Base64, da das sehr lang sein kann)
    const loggableDataFromForm = {...dataFromForm};
    if (loggableDataFromForm.hauptgastAusweisVorderseite) loggableDataFromForm.hauptgastAusweisVorderseite = {name: loggableDataFromForm.hauptgastAusweisVorderseite.name, size: loggableDataFromForm.hauptgastAusweisVorderseite.size, type: loggableDataFromForm.hauptgastAusweisVorderseite.type} as any;
    if (loggableDataFromForm.hauptgastAusweisRückseite) loggableDataFromForm.hauptgastAusweisRückseite = {name: loggableDataFromForm.hauptgastAusweisRückseite.name, size: loggableDataFromForm.hauptgastAusweisRückseite.size, type: loggableDataFromForm.hauptgastAusweisRückseite.type} as any;
    if (loggableDataFromForm.zahlungsbeleg) loggableDataFromForm.zahlungsbeleg = {name: loggableDataFromForm.zahlungsbeleg.name, size: loggableDataFromForm.zahlungsbeleg.size, type: loggableDataFromForm.zahlungsbeleg.type} as any;
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data for token ${bookingToken}:`, JSON.stringify(loggableDataFromForm));

    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: newServerActionToken, updatedGuestData: null };
    }

    const currentGuestData: GuestSubmittedData = JSON.parse(JSON.stringify(booking.guestSubmittedData || { lastCompletedStep: -1 }));
    
    let updatedGuestData: GuestSubmittedData = {
      ...currentGuestData,
      ...additionalDataToMerge, // z.B. zahlungsbetrag
      ...dataFromForm, // Überschreibt currentGuestData und additionalDataToMerge mit validierten Formulardaten
    };
    
    updatedGuestData.lastCompletedStep = Math.max(currentGuestData.lastCompletedStep ?? -1, stepNumber -1);
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data (before file handling) for token ${bookingToken}. LastCompletedStep: ${updatedGuestData.lastCompletedStep}`);

    const fileFields: { formDataKey: keyof GuestSubmittedDataFromForm; urlKey: keyof GuestSubmittedData }[] = [
      { formDataKey: 'hauptgastAusweisVorderseite', urlKey: 'hauptgastAusweisVorderseiteUrl' },
      { formDataKey: 'hauptgastAusweisRückseite', urlKey: 'hauptgastAusweisRückseiteUrl' },
      { formDataKey: 'zahlungsbeleg', urlKey: 'zahlungsbelegUrl' },
    ];

    for (const field of fileFields) {
      const file = dataFromForm[field.formDataKey] as File | undefined | null;
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Processing file field: ${String(field.formDataKey)}, File present: ${!!file}, File size: ${file?.size}`);
      
      if (file && file.size > 0) {
        console.log(`[Action updateBookingStep - Step ${stepNumber}] File ${file.name} (type: ${file.type}, size: ${file.size} bytes) is being processed for ${String(field.formDataKey)}.`);
        try {
          if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
            console.log(`[Action updateBookingStep - Step ${stepNumber}] Converting image ${file.name} to Data URI.`);
            const buffer = Buffer.from(await file.arrayBuffer());
            const base64 = buffer.toString('base64');
            updatedGuestData[field.urlKey] = `data:${file.type};base64,${base64}`;
            console.log(`[Action updateBookingStep - Step ${stepNumber}] Generated Data URI for image ${file.name} (length: ${updatedGuestData[field.urlKey]?.length}).`);
          } else if (ACCEPTED_PDF_TYPES.includes(file.type)) {
            updatedGuestData[field.urlKey] = `mock-pdf-url:${encodeURIComponent(file.name)}`;
            console.log(`[Action updateBookingStep - Step ${stepNumber}] Generated PDF marker for ${file.name}.`);
          } else {
            // Dies sollte durch Zod abgefangen werden, aber als zusätzliche Sicherheit
            console.warn(`[Action updateBookingStep - Step ${stepNumber}] Unsupported file type ${file.type} for ${file.name} (token ${bookingToken}) during processing. This should have been caught by Zod.`);
            // Behalte die alte URL, wenn eine neue Datei ungültig ist und hochgeladen wurde
             if (currentGuestData && currentGuestData[field.urlKey]) {
                updatedGuestData[field.urlKey] = currentGuestData[field.urlKey];
             } else {
                delete updatedGuestData[field.urlKey];
             }
          }
        } catch (fileProcessingError: any) {
          console.error(`[Action updateBookingStep - Step ${stepNumber}] CRITICAL Error processing file ${file.name} for field ${String(field.formDataKey)} (token ${bookingToken}): ${fileProcessingError.message}`, fileProcessingError.stack);
          return {
              message: `Serverfehler: Datei '${file.name}' konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut oder kontaktieren Sie den Support.`,
              errors: { [String(field.formDataKey)]: [`Datei-Verarbeitungsfehler für ${file.name}.`] },
              success: false,
              actionToken: newServerActionToken,
              updatedGuestData: currentGuestData // Wichtig: alte Daten zurückgeben
          };
        }
      } else if (currentGuestData && currentGuestData[field.urlKey]) {
        // Keine neue Datei hochgeladen, alte URL beibehalten
        updatedGuestData[field.urlKey] = currentGuestData[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No new file for ${String(field.formDataKey)}, keeping old URL: ${updatedGuestData[field.urlKey]}`);
      } else {
        // Weder neue Datei noch alte URL vorhanden
        delete updatedGuestData[field.urlKey];
        console.log(`[Action updateBookingStep - Step ${stepNumber}] No file and no old URL for ${String(field.formDataKey)}.`);
      }
    }
     
    if (stepNumber === 4) { // Übersicht & Bestätigung
        // Zod's preprocess sollte das bereits erledigt haben, aber zur Sicherheit:
        updatedGuestData.agbAkzeptiert = dataFromForm.agbAkzeptiert === true || dataFromForm.agbAkzeptiert === "on";
        updatedGuestData.datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === true || dataFromForm.datenschutzAkzeptiert === "on";
        
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

    // Gast Vorname/Nachname in Booking aktualisieren, falls im ersten Schritt geändert
    if (stepNumber === 1 && updatedGuestData.gastVorname && updatedGuestData.gastNachname) {
        bookingUpdates.guestFirstName = updatedGuestData.gastVorname;
        bookingUpdates.guestLastName = updatedGuestData.gastNachname;
    }
   
    // Status auf "Confirmed" setzen, wenn der letzte Schritt abgeschlossen und alles akzeptiert wurde
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
        updatedGuestData: currentGuestData // alte Daten zurückgeben
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
        updatedGuestData: null // Keine Daten zurückgeben oder ggf. die alten, je nach Fehler
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

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: any, formData: FormData) {
  console.log("[Action submitEndgueltigeBestaetigungAction] Called.");
  return updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData);
}

// --- Action zum Löschen von Buchungen ---
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
      // Optional: Revalidate individual booking pages if needed, though they might 404
      // bookingIds.forEach(id => revalidatePath(`/admin/bookings/${id}`, "page"));
      console.log(`[Action deleteBookingsAction] Successfully deleted bookings. Revalidating dashboard.`);
      return { success: true, message: `${bookingIds.length} Buchung(en) erfolgreich gelöscht.`, actionToken };
    } else {
      // This case might not be reachable if deleteMockBookingsByIds always returns true or throws
      console.warn(`[Action deleteBookingsAction] deleteMockBookingsByIds reported no success for IDs: ${bookingIds.join(', ')}`);
      return { success: false, message: "Buchungen konnten nicht aus der Mock-DB gelöscht werden (interne Logik).", actionToken };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
    console.error(`[Action deleteBookingsAction] Error deleting bookings: ${errorMessage}`);
    return { success: false, message: `Fehler beim Löschen der Buchungen: ${errorMessage}`, actionToken };
  }
}

    