
import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle, ServerCrash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { findBookingByTokenFromFirestore } from "@/lib/mock-db";
import { notFound } from "next/navigation";

console.log(`[Module /buchung/[token]/page.tsx] Module evaluated at ${new Date().toISOString()}`);

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
    if (String(error.message).includes("Firestore is not initialized")) {
        throw new Error(`Datenbankverbindungsproblem. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel. (Ref: FNI-${token.substring(0,4)})`);
    } else if (String(error.message).toLowerCase().includes("permission denied")) {
        throw new Error(`Zugriff auf Buchungsdetails verweigert. Dies ist unerwartet. Bitte kontaktieren Sie das Hotel. (Ref: FPD-${token.substring(0,4)})`);
    } else if (String(error.message).toLowerCase().includes("index missing")) {
        throw new Error(`Ein benötigter Datenbank-Index fehlt. Dies ist ein technisches Problem. Bitte kontaktieren Sie das Hotel. (Ref: FIM-${token.substring(0,4)})`);
    }
    throw new Error(`Fehler beim Abrufen der Buchungsdetails für Token ${token}. Details: ${error.message}`);
  }
}

export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const tokenFromParams = params.token; // Assign to a local variable early
  const operationName = "[Server GuestBookingPage]";
  console.log(`${operationName} Rendering page for token: "${tokenFromParams}" at ${new Date().toISOString()}`);
  
  let booking: Booking | null = null;
  let fetchError: string | null = null;

  try {
    booking = await getBookingByToken(tokenFromParams);
    console.log(`${operationName} [Token: ${tokenFromParams}] getBookingByToken call completed. Booking object is ${booking ? 'NOT null' : 'null'}.`);
  } catch (error: any) {
    console.error(`${operationName} [Token: ${tokenFromParams}] Error in getBookingByToken:`, error.message, error.stack?.substring(0,300));
    fetchError = error.message || `Ein unbekannter Fehler ist beim Laden der Buchungsdetails aufgetreten. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel. (Ref: GBE-${tokenFromParams.substring(0,4)})`;
  }

  if (fetchError) {
    console.log(`${operationName} [Token: ${tokenFromParams}] Rendering fetchError card. Error: ${fetchError}`);
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
    console.error(`${operationName} [Token: ${tokenFromParams}] Booking is null after getBookingByToken. Rendering "not found" card.`);
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

  console.log(`${operationName} [Token: ${tokenFromParams}] Booking data retrieved. Status: ${booking.status}, Guest: ${booking.guestFirstName}, SubmittedAt: ${booking.guestSubmittedData?.submittedAt}, LastCompletedStep: ${booking.guestSubmittedData?.lastCompletedStep}`);

  if (booking.status === "Confirmed" && booking.guestSubmittedData && booking.guestSubmittedData.submittedAt) {
     console.log(`${operationName} [Token: ${tokenFromParams}] Booking is Confirmed and data submitted. Displaying confirmation.`);
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
    console.log(`${operationName} [Token: ${tokenFromParams}] Booking is Cancelled. Displaying cancellation message.`);
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
  
  // This is the primary condition to show the form
  const shouldShowForm = booking.status === "Pending Guest Information" || 
                        (booking.status === "Confirmed" && (!booking.guestSubmittedData || !booking.guestSubmittedData.submittedAt));

  if (shouldShowForm) {
    console.log(`${operationName} [Token: ${tokenFromParams}] Booking status is "${booking.status}" and conditions met. Rendering GuestBookingFormStepper.`);
    return (
      <GuestBookingFormStepper bookingToken={tokenFromParams} initialBookingDetails={booking} />
    );
  }

  console.warn(`${operationName} [Token: ${tokenFromParams}] Booking found, but status is "${booking.status}" which is not handled by specific UI. Displaying generic status message.`);
  return (
    <Card className="w-full max-w-lg mx-auto shadow-lg card-modern">
        <CardHeader className="items-center text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mb-3" />
          <CardTitle className="text-xl">Buchungsstatus</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
           <CardDescription>
            Der aktuelle Status Ihrer Buchung: {booking.status}.
            Bitte kontaktieren Sie das Hotel für weitere Informationen.
           </CardDescription>
        </CardContent>
      </Card>
  );
}
