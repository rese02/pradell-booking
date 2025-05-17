
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
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
const ACCEPTED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

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
    if (!val) return true; // Optional, so empty is fine
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
  agbAkzeptiert: z.literal("on", { 
    errorMap: () => ({ message: "Sie müssen den AGB zustimmen." }),
  }),
  datenschutzAkzeptiert: z.literal("on", { 
    errorMap: () => ({ message: "Sie müssen den Datenschutzbestimmungen zustimmen." }),
  }),
});


// --- Server Actions ---

function generateActionToken() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

export async function createBookingAction(prevState: any, formData: FormData) {
  console.log("[Action createBookingAction] Received form data:", Object.fromEntries(formData.entries()));
  const validatedFields = createBookingSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    console.error("[Action createBookingAction] Validation failed:", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Fehler bei der Validierung der Buchungsdaten.",
      bookingToken: null,
      success: false,
      actionToken: prevState?.actionToken 
    };
  }

  const bookingData = validatedFields.data;
  const actionToken = generateActionToken();

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
      roomIdentifier: `${bookingData.zimmertyp}`, 
      guestSubmittedData: { 
        lastCompletedStep: 0,
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
        actionToken: prevState?.actionToken 
    };
  }
}

// Hilfsfunktion für die Aktualisierung der Schritte im Gästebuchungsformular
async function updateBookingStep(
  bookingToken: string,
  stepNumber: number,
  actionSchema: z.ZodType<any, any>,
  formData: FormData,
  additionalDataToMerge?: Partial<GuestSubmittedData> // Für serverseitig kalkulierte Daten
) {
  const rawFormData = Object.fromEntries(formData.entries());
  console.log(`[Action updateBookingStep - Step ${stepNumber}] For token: ${bookingToken}. Raw FormData:`, rawFormData);

  const validatedFields = actionSchema.safeParse(rawFormData);
  const clientActionToken = formData.get("currentActionToken") as string | undefined;
  const newServerActionToken = generateActionToken();

  if (!validatedFields.success) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Validation failed:`, validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: `Fehler bei der Validierung für Schritt ${stepNumber}.`,
      success: false,
      actionToken: clientActionToken, // Behalte Client-Token bei Fehler, um Re-Submit zu ermöglichen/verfolgen
      updatedGuestData: null,
    };
  }
  
  const dataFromForm = validatedFields.data;
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data from form:`, dataFromForm);

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: clientActionToken, updatedGuestData: null };
    }

    const currentGuestData = booking.guestSubmittedData || {};
    
    // Merge-Strategie: Aktuelle Daten + Serverseitig berechnete Daten + Formulardaten für diesen Schritt
    const updatedGuestData: GuestSubmittedData = {
      ...currentGuestData,
      ...additionalDataToMerge, 
      ...dataFromForm,       
      lastCompletedStep: Math.max(currentGuestData.lastCompletedStep || 0, stepNumber),
      submittedAt: new Date().toISOString(),
    };
     console.log(`[Action updateBookingStep - Step ${stepNumber}] Merged guest data (before file handling):`, updatedGuestData);


    // Simuliere Datei-Uploads, indem URLs generiert werden
    if (dataFromForm.hauptgastAusweisVorderseite && dataFromForm.hauptgastAusweisVorderseite.size > 0) {
      updatedGuestData.hauptgastAusweisVorderseiteUrl = `https://placehold.co/uploads/mock_hg_v_${Date.now()}_${dataFromForm.hauptgastAusweisVorderseite.name.replace(/\s+/g, '_')}`;
    }
    if (dataFromForm.hauptgastAusweisRückseite && dataFromForm.hauptgastAusweisRückseite.size > 0) {
      updatedGuestData.hauptgastAusweisRückseiteUrl = `https://placehold.co/uploads/mock_hg_r_${Date.now()}_${dataFromForm.hauptgastAusweisRückseite.name.replace(/\s+/g, '_')}`;
    }
    if (dataFromForm.zahlungsbeleg && dataFromForm.zahlungsbeleg.size > 0) {
      updatedGuestData.zahlungsbelegUrl = `https://placehold.co/uploads/mock_zb_${Date.now()}_${dataFromForm.zahlungsbeleg.name.replace(/\s+/g, '_')}`;
    }
     // Für Bestätigungsschritt
    if (typeof dataFromForm.agbAkzeptiert === 'string') { // Zod wandelt 'on' in string um
        updatedGuestData.agbAkzeptiert = dataFromForm.agbAkzeptiert === 'on';
    }
    if (typeof dataFromForm.datenschutzAkzeptiert === 'string') {
        updatedGuestData.datenschutzAkzeptiert = dataFromForm.datenschutzAkzeptiert === 'on';
    }
    
    console.log(`[Action updateBookingStep - Step ${stepNumber}] Final updated guest data (after file handling):`, updatedGuestData);

    const success = updateMockBookingByToken(bookingToken, { 
      guestSubmittedData: updatedGuestData,
      ...(stepNumber === 1 && { guestFirstName: dataFromForm.gastVorname, guestLastName: dataFromForm.gastNachname })
    });

    if (success) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); 
      if (booking.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { 
        message: `Schritt ${stepNumber} erfolgreich übermittelt.`, 
        errors: null, 
        success: true, 
        actionToken: newServerActionToken,
        updatedGuestData: updatedGuestData // Wichtig: das vollständige, aktualisierte Objekt zurückgeben
      };
    } else {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung.", errors: null, success: false, actionToken: clientActionToken, updatedGuestData: null };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Error submitting data:`, error.message, error.stack);
    return { message: "Serverfehler: Daten konnten nicht übermittelt werden.", errors: null, success: false, actionToken: clientActionToken, updatedGuestData: null };
  }
}

// --- Aktionen für die einzelnen Schritte ---

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
  const result = await updateBookingStep(bookingToken, 4, uebersichtBestaetigungSchema, formData);

  if (result.success && result.updatedGuestData) {
    const successConfirmation = updateMockBookingByToken(bookingToken, { 
        status: "Confirmed",
        guestSubmittedData: { // Stelle sicher, dass die finalen Daten konsistent sind
            ...result.updatedGuestData,
            agbAkzeptiert: true, // Da das Schema 'on' validiert, setzen wir hier explizit true
            datenschutzAkzeptiert: true,
        }
    });
    if (successConfirmation) {
       console.log(`[Action submitEndgueltigeBestaetigungAction] Booking ${bookingToken} status set to Confirmed.`);
       const booking = findMockBookingByToken(bookingToken);
       if (booking?.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
       revalidatePath("/admin/dashboard", "layout");
       // Hier könnte E-Mail-Versand Logik stehen
       return { ...result, message: "Buchung erfolgreich abgeschlossen und bestätigt!" };
    } else {
        console.error(`[Action submitEndgueltigeBestaetigungAction] Failed to set booking ${bookingToken} to Confirmed.`);
        return { ...result, success: false, message: "Fehler beim finalen Bestätigen der Buchung."};
    }
  }
  return result;
}
