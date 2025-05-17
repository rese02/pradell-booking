
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

// --- Neue Zod Schemas für die 5 Schritte ---

const gastStammdatenSchema = z.object({
  anrede: z.enum(['Herr', 'Frau', 'Divers'], { required_error: "Anrede ist erforderlich." }),
  gastVorname: z.string().min(1, "Vorname ist erforderlich."),
  gastNachname: z.string().min(1, "Nachname ist erforderlich."),
  geburtsdatum: z.string().optional().refine(val => !val || !isNaN(Date.parse(val)), {
    message: "Ungültiges Geburtsdatum."
  }),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  telefon: z.string().min(1, "Telefonnummer ist erforderlich."),
});

const ausweisdokumenteSchema = z.object({
  hauptgastDokumenttyp: z.enum(['Reisepass', 'Personalausweis', 'Führerschein'], { required_error: "Dokumenttyp ist erforderlich."}),
  hauptgastAusweisVorderseite: fileSchema,
  hauptgastAusweisRückseite: fileSchema,
});

const zahlungsinformationenSchema = z.object({
  // anzahlungsbetrag wird serverseitig oder aus booking.price gelesen
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
  return Date.now().toString();
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
      actionToken: prevState?.actionToken // Behalte vorherigen Token, falls Validierung fehlschlägt
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
      guestSubmittedData: { // Initialisiere guestSubmittedData für den neuen Flow
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

async function updateBookingStep(
  bookingToken: string,
  stepNumber: number,
  updateData: Partial<GuestSubmittedData>,
  actionSchema: z.ZodType<any, any>,
  formData: FormData
) {
  const rawFormData = Object.fromEntries(formData.entries());
  console.log(`[Action updateBookingStep - Step ${stepNumber}] For token: ${bookingToken}. Raw FormData:`, rawFormData);

  const validatedFields = actionSchema.safeParse(rawFormData);
  const actionToken = generateActionToken();

  if (!validatedFields.success) {
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Validation failed:`, validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: `Fehler bei der Validierung für Schritt ${stepNumber}.`,
      success: false,
      actionToken: (formData.get("currentActionToken") as string) || undefined,
    };
  }
  
  const data = validatedFields.data;
  console.log(`[Action updateBookingStep - Step ${stepNumber}] Validated data:`, data);

  try {
    const booking = findMockBookingByToken(bookingToken);
    if (!booking) {
      console.warn(`[Action updateBookingStep - Step ${stepNumber}] Booking not found for token: ${bookingToken}`);
      return { message: "Buchung nicht gefunden.", errors: null, success: false, actionToken: (formData.get("currentActionToken") as string) || undefined };
    }

    const currentGuestData = booking.guestSubmittedData || {};
    const updatedGuestData: GuestSubmittedData = {
      ...currentGuestData,
      ...updateData, // Spezifische Daten für diesen Schritt
      ...data, // Validierte Daten aus dem Formular
      lastCompletedStep: Math.max(currentGuestData.lastCompletedStep || 0, stepNumber),
      submittedAt: new Date().toISOString(),
    };

    // Simuliere Datei-Uploads, indem URLs generiert werden
    if (data.hauptgastAusweisVorderseite && data.hauptgastAusweisVorderseite.size > 0) {
      updatedGuestData.hauptgastAusweisVorderseiteUrl = `https://placehold.co/uploads/mock_hg_v_${Date.now()}_${data.hauptgastAusweisVorderseite.name.replace(/\s+/g, '_')}`;
    }
    if (data.hauptgastAusweisRückseite && data.hauptgastAusweisRückseite.size > 0) {
      updatedGuestData.hauptgastAusweisRückseiteUrl = `https://placehold.co/uploads/mock_hg_r_${Date.now()}_${data.hauptgastAusweisRückseite.name.replace(/\s+/g, '_')}`;
    }
    if (data.zahlungsbeleg && data.zahlungsbeleg.size > 0) {
      updatedGuestData.zahlungsbelegUrl = `https://placehold.co/uploads/mock_zb_${Date.now()}_${data.zahlungsbeleg.name.replace(/\s+/g, '_')}`;
    }
    
    const success = updateMockBookingByToken(bookingToken, { 
      guestSubmittedData: updatedGuestData,
      // Aktualisiere guestFirstName/LastName in Booking, falls sie in Schritt 1 geändert wurden
      ...(stepNumber === 1 && { guestFirstName: data.gastVorname, guestLastName: data.gastNachname })
    });

    if (success) {
      console.log(`[Action updateBookingStep - Step ${stepNumber}] Data submitted successfully for token: ${bookingToken}`);
      revalidatePath(`/buchung/${bookingToken}`, "layout"); 
      if (booking.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
      return { message: `Schritt ${stepNumber} erfolgreich übermittelt.`, errors: null, success: true, actionToken };
    } else {
      console.error(`[Action updateBookingStep - Step ${stepNumber}] Failed to update booking for token: ${bookingToken}`);
      return { message: "Fehler beim Aktualisieren der Buchung.", errors: null, success: false, actionToken: (formData.get("currentActionToken") as string) || undefined };
    }

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`[Action updateBookingStep - Step ${stepNumber}] Error submitting data:`, error.message, error.stack);
    return { message: "Serverfehler: Daten konnten nicht übermittelt werden.", errors: null, success: false, actionToken: (formData.get("currentActionToken") as string) || undefined };
  }
}

export async function submitGastStammdatenAction(bookingToken: string, prevState: any, formData: FormData) {
  return updateBookingStep(bookingToken, 1, {
    // gastVorname, gastNachname etc. werden direkt aus validatedFields.data übernommen
  }, gastStammdatenSchema, formData);
}

export async function submitAusweisdokumenteAction(bookingToken: string, prevState: any, formData: FormData) {
   return updateBookingStep(bookingToken, 2, {
    // hauptgastDokumenttyp etc. werden direkt aus validatedFields.data übernommen
  }, ausweisdokumenteSchema, formData);
}

export async function submitZahlungsinformationenAction(bookingToken: string, prevState: any, formData: FormData) {
  // Hier könnte die Logik für den Anzahlungsbetrag stehen
  const booking = findMockBookingByToken(bookingToken);
  const anzahlungsbetrag = booking ? booking.price * 0.3 : 0;

  return updateBookingStep(bookingToken, 3, {
    zahlungsbetrag: anzahlungsbetrag, // Beispiel: Anzahlung wird hier gesetzt
    // zahlungsart, zahlungsdatum etc. kommen aus validatedFields.data
  }, zahlungsinformationenSchema, formData);
}

export async function submitEndgueltigeBestaetigungAction(bookingToken: string, prevState: any, formData: FormData) {
  const result = await updateBookingStep(bookingToken, 4, {
    // agbAkzeptiert, datenschutzAkzeptiert kommen aus validatedFields.data
  }, uebersichtBestaetigungSchema, formData);

  if (result.success) {
    // Wenn der letzte Schritt erfolgreich war, Buchungsstatus auf "Confirmed" setzen
    const successConfirmation = updateMockBookingByToken(bookingToken, { status: "Confirmed" });
    if (successConfirmation) {
       console.log(`[Action submitEndgueltigeBestaetigungAction] Booking ${bookingToken} status set to Confirmed.`);
       const booking = findMockBookingByToken(bookingToken);
       if (booking?.id) revalidatePath(`/admin/bookings/${booking.id}`, "page");
       revalidatePath("/admin/dashboard", "layout");
       // Hier könnte E-Mail-Versand Logik stehen
       return { ...result, message: "Buchung erfolgreich abgeschlossen und bestätigt!" };
    } else {
        return { ...result, success: false, message: "Fehler beim finalen Bestätigen der Buchung."};
    }
  }
  return result;
}


// --- Alte Actions (Referenz/Entfernung) ---
export async function submitHauptgastAction(bookingToken: string, prevState: any, formData: FormData) {
  // Diese Action ist veraltet und wird durch submitGastStammdatenAction und submitAusweisdokumenteAction ersetzt
  console.warn("[Action submitHauptgastAction] This action is deprecated.");
  return { message: "Veraltete Aktion.", errors: null, success: false, actionToken: prevState?.actionToken };
}
export async function submitMitreisendeAction(bookingToken: string, prevState: any, formData: FormData) {
   console.warn("[Action submitMitreisendeAction] This action is deprecated as Mitreisende are not in the new flow.");
   return { message: "Veraltete Aktion.", errors: null, success: false, actionToken: prevState?.actionToken };
}
export async function submitPaymentAmountSelectionAction(bookingToken: string, prevState: any, formData: FormData) {
    console.warn("[Action submitPaymentAmountSelectionAction] This action is deprecated, payment info is now part of step 3.");
    return { message: "Veraltete Aktion.", errors: null, success: false, actionToken: prevState?.actionToken };
}
export async function submitBookingCompletionAction(bookingToken: string, prevState: any, formData: FormData) {
  console.warn("[Action submitBookingCompletionAction] This action is deprecated, use submitEndgueltigeBestaetigungAction.");
  return { message: "Veraltete Aktion.", errors: null, success: false, actionToken: prevState?.actionToken };
}
