
// File: src/app/buchung/[token]/page.tsx
"use client"; 

import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle, ServerCrash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { findBookingByTokenFromFirestore } from "@/lib/mock-db"; // Firestore operations
import { firebaseInitializationError, firebaseInitializedCorrectly } from "@/lib/firebase"; // Import Firebase state

// Helper for consistent logging on this page
function logGuestPage(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const pageName = "[GuestBookingPage]";
    let simplifiedData;
    const maxLogLength = 1500; 
    try {
        simplifiedData = JSON.stringify(data, (key, value) => {
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
  logGuestPage(`${operationName} Attempting to fetch booking from Firestore for token: "${token}"`, { firebaseInitialized: firebaseInitializedCorrectly });

  if (!firebaseInitializedCorrectly) {
    const initErrorMsg = firebaseInitializationError || "Firebase Dienste nicht initialisiert.";
    logGuestPage(`${operationName} Firebase not initialized. Cannot fetch booking.`, { error: initErrorMsg }, "error");
    throw new Error(`Datenbankverbindungsproblem. Bitte versuchen Sie es später erneut. (Ref: FNI-GBP-${token.substring(0,4)})`);
  }

  try {
    const booking = await findBookingByTokenFromFirestore(token);
    if (booking) {
      logGuestPage(`${operationName} Successfully found booking for token "${token}"`, { status: booking.status, guestName: booking.guestFirstName });
      return booking;
    } else {
      logGuestPage(`${operationName} No booking found in Firestore for token "${token}".`, {}, "warn");
      return null; 
    }
  } catch (error: any) {
    logGuestPage(`${operationName} CRITICAL ERROR fetching booking for token "${token}":`, { message: error.message, code: error.code, stack: error.stack?.substring(0,300) }, 'error');
    // Propagate specific error messages
    if (error.message.includes("Firestore Permission Denied")) {
        throw new Error(`Zugriff auf Buchungsdetails verweigert. Bitte kontaktieren Sie das Hotel. (Ref: FPD-GBP-${token.substring(0,4)})`);
    } else if (error.message.includes("Firestore Query Error (likely Index Missing)")) {
        throw new Error(`Ein benötigter Datenbank-Index fehlt. Dies ist ein technisches Problem. Bitte kontaktieren Sie das Hotel. (Ref: FIM-GBP-${token.substring(0,4)})`);
    }
    throw new Error(`Fehler beim Abrufen der Buchungsdetails für Token ${token}. Details: ${error.message || 'Unbekannter Fehler'}`);
  }
}

export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const tokenFromParams = params.token; 
  const operationName = "[Server GuestBookingPage]";
  let booking: Booking | null = null;
  let fetchError: string | null = null;

  // Assign token to local variable early, use this variable for logging
  logGuestPage(`${operationName} Rendering page for token: "${tokenFromParams}"`, {});

  try {
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] getBookingByToken call starting.`, {});
    booking = await getBookingByToken(tokenFromParams); // Use local token variable
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] getBookingByToken call completed.`, { bookingFound: !!booking, status: booking?.status, guestFirstName: booking?.guestFirstName });
  } catch (error: any) {
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Error in getBookingByToken:`, { message: error.message, code: error.code, stack: error.stack?.substring(0,300) }, 'error');
    fetchError = error.message || `Ein unbekannter Fehler ist beim Laden der Buchungsdetails aufgetreten. (Ref: GBE-${tokenFromParams.substring(0,4)})`;
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
            <p className="text-xs text-muted-foreground mt-2">Token: {tokenFromParams}</p>
        </CardContent>
      </Card>
    );
  }

  if (!booking) {
    logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking is null after getBookingByToken. Rendering "not found" card.`, {}, 'warn'); 
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
           <p className="text-xs text-muted-foreground mt-2">Token: {tokenFromParams}</p>
        </CardContent>
      </Card>
    );
  }

  // Check if booking is confirmed AND guest data has been submitted
  const isBookingConfirmedAndDataSubmitted = booking.status === "Confirmed" && booking.guestSubmittedData?.submittedAt;
  const isBookingCancelled = booking.status === "Cancelled";
  
  logGuestPage(`${operationName} [Token: ${tokenFromParams}] Booking data retrieved.`,
      {
          status: booking.status,
          guestSubmittedAt: booking.guestSubmittedData?.submittedAt,
          lastCompletedStep: booking.guestSubmittedData?.lastCompletedStep,
          isBookingConfirmedAndDataSubmitted: isBookingConfirmedAndDataSubmitted,
          isBookingCancelled: isBookingCancelled,
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
  
  // Form should be shown if status is Pending Guest Information OR if it's Confirmed but guest data hasn't been submitted yet.
  const shouldShowForm = booking.status === "Pending Guest Information" || 
                         (booking.status === "Confirmed" && !booking.guestSubmittedData?.submittedAt);
  
  logGuestPage(`${operationName} [Token: ${tokenFromParams}] Evaluation for showing form:`, { 
    status: booking.status, 
    submittedAt: booking.guestSubmittedData?.submittedAt,
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
          <AlertTriangle className="w-12 h-12 text-yellow-500 mb-3" />
          <CardTitle className="text-xl">Buchungsstatus</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
           <CardDescription>
            Der aktuelle Status Ihrer Buchung ist: <span className="font-semibold">{booking.status}</span>.
            Das Gästedatenformular ist für diesen Status nicht verfügbar oder bereits abgeschlossen.
            Bitte kontaktieren Sie das Hotel für weitere Informationen.
           </CardDescription>
        </CardContent>
      </Card>
  );
}
