
// File: src/app/buchung/[token]/page.tsx
"use client"; // Beibehalten, falls Kindkomponenten (wie GuestBookingFormStepper) Client-Interaktivität benötigen

import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle, ServerCrash, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { findBookingByTokenFromFirestore } from "@/lib/mock-db"; // Firestore operations
import { firebaseInitializedCorrectly, firebaseInitializationError, db } from "@/lib/firebase"; // Import Firebase state

// Helper für konsistentes Logging auf dieser Seite
function logGuestPage(context: string, data?: any, level: 'info' | 'warn' | 'error' = 'info') {
    const pageName = "[GuestBookingPage]";
    let simplifiedData = "";
    const maxLogLength = 1500;
    try {
        simplifiedData = JSON.stringify(data || {}, (key, value) => {
            if (value instanceof Error) { return { message: value.message, name: value.name, code: (value as any).code, stack: value.stack?.substring(0,100) }; }
            if (typeof value === 'string' && value.length > 150 && !key.toLowerCase().includes('url')) { return value.substring(0,100) + "...[TRUNCATED_STRING_LOG]"; }
            return value;
        }, 2);
    } catch (e) {
        simplifiedData = "[Log data could not be stringified]";
    }
    const logMessage = `${pageName} [${new Date().toISOString()}] ${context} ${simplifiedData.length > maxLogLength ? simplifiedData.substring(0, maxLogLength) + `... [LOG_DATA_TRUNCATED_AT_${maxLogLength}_CHARS]` : simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}

async function getBookingByToken(token: string): Promise<Booking | null> {
  const operationName = "[Server getBookingByToken]";
  const callTime = new Date().toISOString();
  // Log here, as this function is async and token is a direct param.
  logGuestPage(`${operationName} Attempting to fetch booking for token: "${token}" at ${callTime}`, { firebaseInitialized: firebaseInitializedCorrectly, dbAvailable: !!db });

  if (!firebaseInitializedCorrectly || !db) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste oder DB nicht initialisiert.";
    logGuestPage(`${operationName} [Token: ${token}] Firebase not initialized. Cannot fetch booking.`, { error: initErrorMsg, firebaseInitialized: firebaseInitializedCorrectly, dbExists: !!db }, "error");
    throw new Error(`Datenbankverbindungsproblem. Bitte versuchen Sie es später erneut. (Ref: FNI-GBP-${token ? token.substring(0,4) : 'XXXX'}) Grund: ${initErrorMsg}`);
  }

  try {
    const booking = await findBookingByTokenFromFirestore(token); // This is the main await
    if (booking) {
      logGuestPage(`${operationName} [Token: ${token}] Successfully found booking.`, { id: booking.id, status: booking.status, guestFirstName: booking.guestFirstName });
      return booking;
    } else {
      logGuestPage(`${operationName} [Token: ${token}] No booking found in Firestore.`, {}, "warn");
      return null;
    }
  } catch (error: any) {
    logGuestPage(`${operationName} [Token: ${token}] CRITICAL ERROR fetching/processing booking:`, { message: error.message, code: error.code, stack: error.stack?.substring(0,300) }, 'error');
    if (String(error.message).includes("permission-denied") || String(error.code).toLowerCase().includes("permission-denied")) {
        throw new Error(`Zugriff auf Buchungsdetails verweigert. Bitte kontaktieren Sie das Hotel. (Ref: FPD-GBP-${token ? token.substring(0,4) : 'XXXX'})`);
    } else if (String(error.message).includes("failed-precondition") || String(error.code).toLowerCase().includes("failed-precondition")) {
        throw new Error(`Ein benötigter Datenbank-Index fehlt oder die Abfrage ist fehlerhaft. Bitte kontaktieren Sie das Hotel. (Ref: FIM-GBP-${token ? token.substring(0,4) : 'XXXX'})`);
    }
    throw new Error(`Fehler beim Abrufen der Buchungsdetails für Token ${token}. Details: ${error.message || 'Unbekannter Datenbankfehler'}`);
  }
}

export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const tokenFromParams = params.token; // Assign early
  const operationName = "[Server GuestBookingPage]";
  let booking: Booking | null = null;
  let fetchError: string | null = null;
  const pageRenderAttemptTime = new Date().toISOString();

  // DEFER logging that directly uses params.token or tokenFromParams until after the first await

  try {
    // Log the attempt to fetch, this is before the first await but crucial for context
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Initiating data fetch at ${pageRenderAttemptTime}.`, { paramsTokenLength: tokenFromParams?.length });
    booking = await getBookingByToken(tokenFromParams); // First await in this component
    
    // Now it's safer to log more details after the await
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] getBookingByToken call completed.`, { bookingFound: !!booking, status: booking?.status, guestFirstName: booking?.guestFirstName });

  } catch (error: any) {
    // Log error information here, using tokenFromParams is fine within a catch after an await
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Error during getBookingByToken or subsequent processing:`, { message: error.message, code: (error as any).code, stack: error.stack?.substring(0,300) }, 'error');
    
    // Construct more specific error messages based on the caught error
    if (error.message?.includes("Datenbankverbindungsproblem")) {
        fetchError = `Ein technisches Problem ist aufgetreten (Datenbankverbindung). Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel. (Ref: GBP-DBCONN-${tokenFromParams ? tokenFromParams.substring(0,4) : 'ERR'})`;
    } else if (error.message?.includes("Zugriff auf Buchungsdetails verweigert")) {
        fetchError = `Der Zugriff auf diese Buchungsdetails wurde verweigert. Bitte überprüfen Sie den Link oder kontaktieren Sie das Hotel. (Ref: GBP-PERM-${tokenFromParams ? tokenFromParams.substring(0,4) : 'ERR'})`;
    } else if (error.message?.includes("Ein benötigter Datenbank-Index fehlt")) {
        fetchError = `Ein technisches Problem ist aufgetreten (Datenbank-Index). Bitte kontaktieren Sie das Hotel. (Ref: GBP-INDEX-${tokenFromParams ? tokenFromParams.substring(0,4) : 'ERR'})`;
    } else {
        fetchError = error.message || `Ein unbekannter Fehler ist beim Laden der Buchungsdetails aufgetreten. (Ref: GBE-${tokenFromParams ? tokenFromParams.substring(0,4) : 'XXXX'})`;
    }
  }

  if (fetchError) {
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Rendering fetchError card.`, { error: fetchError }, "warn");
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <ServerCrash className="w-12 h-12 text-destructive mb-3" />
          <CardTitle className="text-xl">Fehler beim Laden der Buchung</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <CardDescription>{fetchError}</CardDescription>
            <p className="text-xs text-muted-foreground mt-2">Token: {tokenFromParams || "N/A"}</p>
        </CardContent>
      </Card>
    );
  }

  if (!booking) {
    // This case should ideally be caught by getBookingByToken throwing an error if null,
    // or fetchError would be set. But as a fallback:
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking is null after getBookingByToken (and fetchError was not set). Rendering "not found" card.`, {}, 'warn');
     return (
      <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mb-3" />
          <CardTitle className="text-xl">Ungültiger Buchungslink</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
           <CardDescription>
            Dieser Buchungslink ist ungültig oder die Buchung existiert nicht (mehr). Bitte überprüfen Sie den Link oder kontaktieren Sie das Hotel.
           </CardDescription>
           <p className="text-xs text-muted-foreground mt-2">Token: {tokenFromParams || "N/A"}</p>
        </CardContent>
      </Card>
    );
  }

  const isBookingConfirmedAndDataSubmitted = booking.status === "Confirmed" && booking.guestSubmittedData?.submittedAt;
  const isBookingCancelled = booking.status === "Cancelled";

  logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking data retrieved and conditions evaluated.`,
      {
          status: booking.status,
          guestSubmittedAt: booking.guestSubmittedData?.submittedAt ? new Date(booking.guestSubmittedData.submittedAt).toISOString() : 'N/A',
          lastCompletedStep: booking.guestSubmittedData?.lastCompletedStep,
          isBookingConfirmedAndDataSubmitted,
          isBookingCancelled,
      }
  );

  if (isBookingConfirmedAndDataSubmitted) {
     logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking is Confirmed and data submitted. Displaying confirmation.`, {});
     return (
      <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
          <CardTitle className="text-xl">Ihre Daten wurden bereits übermittelt</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <CardDescription>
            Vielen Dank, {booking.guestFirstName}. Ihre Buchungsdaten für {booking.roomIdentifier || 'Ihr Zimmer'} wurden bereits erfolgreich übermittelt und die Buchung ist bestätigt.
            </CardDescription>
            <p className="mt-4 text-sm text-muted-foreground">Bei Fragen wenden Sie sich bitte direkt an das Hotel.</p>
        </CardContent>
      </Card>
    );
  }

  if (isBookingCancelled) {
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking is Cancelled. Displaying cancellation message.`, {});
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mb-3" />
          <CardTitle className="text-xl">Buchung storniert</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
           <CardDescription>
            Diese Buchung wurde storniert. Bitte kontaktieren Sie das Hotel für weitere Informationen.
           </CardDescription>
        </CardContent>
      </Card>
    );
  }

  const shouldShowForm = booking.status === "Pending Guest Information" ||
                         (booking.status === "Confirmed" && !booking.guestSubmittedData?.submittedAt);

  logGuestPage(`${operationName} [Token: ${tokenFromParams}] Evaluation for showing form:`, {
    status: booking.status,
    submittedAt: booking.guestSubmittedData?.submittedAt ? new Date(booking.guestSubmittedData.submittedAt).toISOString() : 'N/A',
    shouldShowForm
  });

  if (shouldShowForm) {
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Rendering GuestBookingFormStepper.`, {});
    return (
      <GuestBookingFormStepper bookingToken={tokenFromParams} initialBookingDetails={booking} />
    );
  }

  logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking found, but status is "${booking.status}" which is not handled by specific UI or form should not be shown. Displaying generic status message.`, {}, 'warn');
  return (
    <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <FileText className="w-12 h-12 text-primary mb-3" />
          <CardTitle className="text-xl">Buchungsstatus: {booking.status}</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
           <CardDescription>
            Der aktuelle Status Ihrer Buchung ist: <span className="font-semibold">{booking.status}</span>.
            Das Gästedatenformular ist für diesen Status derzeit nicht verfügbar oder bereits abgeschlossen.
            Bitte kontaktieren Sie das Hotel für weitere Informationen oder wenn Sie Unterstützung benötigen.
           </CardDescription>
        </CardContent>
      </Card>
  );
}
