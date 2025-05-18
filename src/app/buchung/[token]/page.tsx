
import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { findBookingByTokenFromFirestore } from "@/lib/mock-db"; // Now fetches from Firestore
import { notFound } from "next/navigation";

// Log module evaluation time
console.log(`[Module /buchung/[token]/page.tsx] Module evaluated at ${new Date().toISOString()}`);

async function getBookingByToken(token: string): Promise<Booking | null> {
  console.log(`[Server getBookingByToken] Attempting to fetch booking from Firestore for token: "${token}" at ${new Date().toISOString()}`);
  const booking = await findBookingByTokenFromFirestore(token);

  if (booking) {
    console.log(`[Server getBookingByToken] Successfully found booking for token "${token}" from Firestore. Status: ${booking.status}, Guest: ${booking.guestFirstName}`);
    return booking;
  } else {
    console.warn(`[Server getBookingByToken] No booking found in Firestore for token "${token}".`);
    return null;
  }
}

export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  console.log(`[Server GuestBookingPage] Rendering page for token: "${params.token}" at ${new Date().toISOString()}`);
  const booking = await getBookingByToken(params.token);

  if (!booking) {
    console.error(`[Server GuestBookingPage] Booking not found for token "${params.token}" (getBookingByToken returned null). Calling notFound().`);
    notFound();
  }
  
  console.log(`[Server GuestBookingPage] Booking data retrieved for token "${params.token}": Status: ${booking.status}, Guest: ${booking.guestFirstName}`);

  if (booking.status === "Confirmed" && booking.guestSubmittedData && booking.guestSubmittedData.submittedAt) {
     console.log(`[Server GuestBookingPage] Booking for token "${params.token}" is Confirmed and data submitted. Displaying confirmation.`);
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
    console.log(`[Server GuestBookingPage] Booking for token "${params.token}" is Cancelled. Displaying cancellation message.`);
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

  if (booking.status === "Pending Guest Information") {
    console.log(`[Server GuestBookingPage] Booking for token "${params.token}" is "Pending Guest Information". Rendering GuestBookingFormStepper.`);
    return (
      <GuestBookingFormStepper bookingToken={params.token} bookingDetails={booking} />
    );
  }

  console.warn(`[Server GuestBookingPage] Booking found for token "${params.token}", but status is "${booking.status}", which is not handled by specific UI. Displaying generic status message.`);
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
