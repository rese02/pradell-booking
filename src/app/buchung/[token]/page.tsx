
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
    // Re-throw to be caught by the page component or Next.js error handling
    throw new Error(`Failed to retrieve booking details for token ${token}: ${error.message}`);
  }
}

export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const operationName = "[Server GuestBookingPage]";
  console.log(`${operationName} Rendering page for token: "${params.token}" at ${new Date().toISOString()}`);
  let booking: Booking | null = null;
  let fetchError: string | null = null;

  try {
    booking = await getBookingByToken(params.token);
  } catch (error: any) {
    console.error(`${operationName} Error in getBookingByToken for token "${params.token}":`, error.message);
    fetchError = `Fehler beim Laden der Buchungsdetails: ${error.message}. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel.`;
    // We don't call notFound() here yet, to display a more user-friendly error if possible
  }

  if (fetchError) {
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
        <CardHeader className="items-center text-center">
          <ServerCrash className="w-12 h-12 text-destructive mb-3" />
          <CardTitle className="text-xl">Fehler beim Laden der Buchung</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <CardDescription>{fetchError}</CardDescription>
        </CardContent>
      </Card>
    );
  }

  if (!booking) {
    console.error(`${operationName} Booking not found for token "${params.token}" (getBookingByToken returned null or error was caught). Calling notFound().`);
    notFound();
  }

  console.log(`${operationName} Booking data retrieved for token "${params.token}": Status: ${booking.status}, Guest: ${booking.guestFirstName}`);

  if (booking.status === "Confirmed" && booking.guestSubmittedData && booking.guestSubmittedData.submittedAt) {
     console.log(`${operationName} Booking for token "${params.token}" is Confirmed and data submitted. Displaying confirmation.`);
     return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
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
    console.log(`${operationName} Booking for token "${params.token}" is Cancelled. Displaying cancellation message.`);
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
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

  // Allow "Confirmed" status to also proceed to the form if guestSubmittedData is not fully complete yet.
  // This might happen if an admin confirms a booking before the guest submits all data.
  if (booking.status === "Pending Guest Information" || (booking.status === "Confirmed" && (!booking.guestSubmittedData || !booking.guestSubmittedData.submittedAt))) {
    console.log(`${operationName} Booking for token "${params.token}" is "${booking.status}". Rendering GuestBookingFormStepper.`);
    return (
      <GuestBookingFormStepper bookingToken={params.token} initialBookingDetails={booking} />
    );
  }

  console.warn(`${operationName} Booking found for token "${params.token}", but status is "${booking.status}", which is not handled by specific UI. Displaying generic status message.`);
  return (
    <Card className="w-full max-w-lg mx-auto shadow-lg">
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

    