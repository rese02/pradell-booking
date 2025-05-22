
"use client"; // Keep this if using client-side hooks like useState, useEffect for this page directly, but main data fetching is server-side.
              // For a pure Server Component page displaying data, it would not be needed.
              // However, if GuestBookingFormStepper is a client component, this page might be better as a client component wrapper.
              // Given GuestBookingFormStepper uses useActionState, this page effectively acts as a Server Component that renders a Client Component.

import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle, ServerCrash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { findBookingByTokenFromFirestore } from "@/lib/mock-db"; // Firestore operations
import { notFound } from "next/navigation";

async function getBookingByToken(token: string): Promise<Booking | null> {
  const operationName = "[Server getBookingByToken]";
  console.log(`${operationName} Attempting to fetch booking from Firestore for token: "${token}" at ${new Date().toISOString()}`);
  try {
    const booking = await findBookingByTokenFromFirestore(token);
    if (booking) {
      console.log(`${operationName} Successfully found booking for token "${token}" from Firestore. Status: ${booking.status}, Guest: ${booking.guestFirstName}`);
      return booking;
    } else {
      console.warn(`${operationName} No booking found in Firestore for token "${token}".`);
      return null;
    }
  } catch (error: any) {
    console.error(`${operationName} CRITICAL ERROR fetching booking for token "${token}":`, error.message, error.stack?.substring(0,500));
    // Rethrow specific error messages to be caught by the page component
    if (String(error.message).includes("Firestore is not initialized")) {
        throw new Error(`Datenbankverbindungsproblem. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel. (Ref: FNI-${token.substring(0,4)})`);
    } else if (String(error.message).toLowerCase().includes("permission denied") || String(error.message).toLowerCase().includes("insufficient permissions")) {
        throw new Error(`Zugriff auf Buchungsdetails verweigert. Dies ist unerwartet. Bitte kontaktieren Sie das Hotel. (Ref: FPD-${token.substring(0,4)})`);
    } else if (String(error.message).toLowerCase().includes("index missing") || String(error.message).toLowerCase().includes("query requires an index")) {
        throw new Error(`Ein benötigter Datenbank-Index fehlt. Dies ist ein technisches Problem. Bitte kontaktieren Sie das Hotel. (Ref: FIM-${token.substring(0,4)})`);
    }
    throw new Error(`Fehler beim Abrufen der Buchungsdetails für Token ${token}. Details: ${error.message}`);
  }
}

export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const tokenFromParams = params.token; 
  const operationName = "[Server GuestBookingPage]";
  console.log(`${operationName} Rendering page for token: "${tokenFromParams}" at ${new Date().toISOString()}`);
  
  let booking: Booking | null = null;
  let fetchError: string | null = null;

  try {
    booking = await getBookingByToken(tokenFromParams);
    logSafePage(`${operationName} [Token: ${tokenFromParams}] getBookingByToken call completed. Booking object is ${booking ? 'NOT null' : 'null'}.`, { status: booking?.status });
  } catch (error: any) {
    logSafePage(`${operationName} [Token: ${tokenFromParams}] Error in getBookingByToken:`, { message: error.message, stack: error.stack?.substring(0,300) }, 'error');
    fetchError = error.message || `Ein unbekannter Fehler ist beim Laden der Buchungsdetails aufgetreten. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel. (Ref: GBE-${tokenFromParams.substring(0,4)})`;
  }

  if (fetchError) {
    logSafePage(`${operationName} [Token: ${tokenFromParams}] Rendering fetchError card. Error: ${fetchError}`, {}, "warn");
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
    logSafePage(`${operationName} [Token: ${tokenFromParams}] Booking is null after getBookingByToken. Rendering "not found" card.`, {}, 'error');
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

  logSafePage(`${operationName} [Token: ${tokenFromParams}] Booking data retrieved.`, { status: booking.status, guestFirstName: booking.guestFirstName, submittedAt: booking.guestSubmittedData?.submittedAt, lastCompletedStep: booking.guestSubmittedData?.lastCompletedStep });

  if (booking.status === "Confirmed" && booking.guestSubmittedData?.submittedAt) {
     logSafePage(`${operationName} [Token: ${tokenFromParams}] Booking is Confirmed and data submitted. Displaying confirmation.`, {});
     return (
      <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
          <CardTitle className="text-xl">Ihre Daten wurden bereits übermittelt</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <CardDescription>
            Vielen Dank, {booking.guestFirstName}. Ihre Buchungsdaten für {booking.roomIdentifier || 'Ihr Zimmer'} wurden bereits erfolgreich übermittelt und bestätigt.
            </CardDescription>
            <p className="mt-4 text-sm text-muted-foreground">Bei Fragen wenden Sie sich bitte direkt an das Hotel.</p>
        </CardContent>
      </Card>
    );
  }

  if (booking.status === "Cancelled") {
    logSafePage(`${operationName} [Token: ${tokenFromParams}] Booking is Cancelled. Displaying cancellation message.`, {});
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
  
  // Simplified condition: show form if status is "Pending Guest Information" AND data not yet submitted.
  const shouldShowForm = booking.status === "Pending Guest Information" && !booking.guestSubmittedData?.submittedAt;
  
  logSafePage(`${operationName} [Token: ${tokenFromParams}] Evaluation for showing form:`, { 
    status: booking.status, 
    submittedAt: booking.guestSubmittedData?.submittedAt,
    shouldShowForm 
  });

  if (shouldShowForm) {
    logSafePage(`${operationName} [Token: ${tokenFromParams}] Rendering GuestBookingFormStepper.`, {});
    return (
      <GuestBookingFormStepper bookingToken={tokenFromParams} initialBookingDetails={booking} />
    );
  }

  // Fallback for other statuses or unexpected conditions
  logSafePage(`${operationName} [Token: ${tokenFromParams}] Booking found, but status is "${booking.status}" which is not handled by specific UI or form should not be shown. Displaying generic status message.`, {}, 'warn');
  return (
    <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mb-3" />
          <CardTitle className="text-xl">Buchungsstatus</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
           <CardDescription>
            Der aktuelle Status Ihrer Buchung ist: {booking.status}.
            Das Gästedatenformular ist für diesen Status nicht verfügbar oder bereits abgeschlossen.
            Bitte kontaktieren Sie das Hotel für weitere Informationen.
           </CardDescription>
        </CardContent>
      </Card>
  );
}

// Helper for consistent logging on this page
function logSafePage(context: string, data: any, level: 'info' | 'warn' | 'error' = 'info') {
    const pageName = "[GuestBookingPage]";
    let simplifiedData;
    try {
        simplifiedData = JSON.stringify(data, null, 2).substring(0, 500); // Limit log size
    } catch (e) {
        simplifiedData = "[Log data could not be stringified]";
    }
    const logMessage = `${pageName} [${new Date().toISOString()}] ${context} ${simplifiedData}`;

    if (level === 'error') console.error(logMessage);
    else if (level === 'warn') console.warn(logMessage);
    else console.log(logMessage);
}
