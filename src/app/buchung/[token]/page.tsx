
import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { findMockBookingByToken, getMockBookings } from "@/lib/mock-db"; 
import { notFound } from "next/navigation";

// Log module evaluation time
console.log(`[Module /buchung/[token]/page.tsx] Module evaluated at ${new Date().toISOString()}`);

// Mock data fetching function - replace with actual data fetching from your backend/Firebase
async function getBookingByToken(token: string): Promise<Booking | null> {
  console.log(`[Server getBookingByToken] Attempting to fetch booking for token: "${token}" at ${new Date().toISOString()}`);
  
  // Log the current state of MOCK_BOOKINGS_DB that this function sees
  const currentBookingsInDb = getMockBookings(); // Use the new getter
  const availableTokens = currentBookingsInDb.map(b => b.bookingToken);
  console.log(`[Server getBookingByToken] Current MOCK_BOOKINGS_DB length: ${currentBookingsInDb.length}`);
  console.log(`[Server getBookingByToken] Available tokens in MOCK_BOOKINGS_DB: [${availableTokens.join(', ')}]`);
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));

  const booking = findMockBookingByToken(token); // Use the new finder

  if (booking) {
    console.log(`[Server getBookingByToken] Found booking for token "${token}". Status: ${booking.status}`);
    return booking;
  } else {
    console.warn(`[Server getBookingByToken] No booking found for token "${token}".`);
    return null;
  }
}


export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  console.log(`[Server GuestBookingPage] Rendering page for token: "${params.token}" at ${new Date().toISOString()}`);
  const booking = await getBookingByToken(params.token);

  if (!booking) {
    console.error(`[Server GuestBookingPage] Booking not found for token "${params.token}", calling notFound().`);
    notFound();
  }
  
  // Check if guest data was already submitted and booking is confirmed
  if (booking.status === "Confirmed" && booking.guestSubmittedData && booking.guestSubmittedData.submittedAt) {
     console.log(`[Server GuestBookingPage] Booking for token "${params.token}" is Confirmed and data submitted.`);
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
    console.log(`[Server GuestBookingPage] Booking for token "${params.token}" is Cancelled.`);
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

  // If booking is pending guest information (and not yet fully submitted and confirmed)
  if (booking.status === "Pending Guest Information") {
    console.log(`[Server GuestBookingPage] Booking for token "${params.token}" is Pending Guest Information. Rendering form.`);
    return (
      <GuestBookingFormStepper bookingToken={params.token} bookingDetails={booking} />
    );
  }

  // Fallback for other statuses or unexpected scenarios
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

// Enable Edge runtime for this page if possible, or ensure nodejs runtime handles state well.
// For mock data, this is less critical than with a real DB.
// export const runtime = 'edge'; // Consider if compatible with all features
