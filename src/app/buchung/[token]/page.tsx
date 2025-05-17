
import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MOCK_BOOKINGS_DB } from "@/lib/mock-db"; // Import centralized mock data
import { notFound } from "next/navigation";

// Mock data fetching function - replace with actual data fetching from your backend/Firebase
async function getBookingByToken(token: string): Promise<Booking | null> {
  console.log(`[Server] Attempting to fetch booking for token: ${token}`);
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));

  const booking = MOCK_BOOKINGS_DB.find(b => b.bookingToken === token);

  if (booking) {
    console.log(`[Server] Found booking for token ${token}:`, booking.status, booking);
    return booking;
  } else {
    console.log(`[Server] No booking found for token ${token}`);
    return null;
  }
}


export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const booking = await getBookingByToken(params.token);

  if (!booking) {
    // Instead of custom message, use Next.js notFound to render 404 page
    notFound();
  }
  
  // Check if guest data was already submitted and booking is confirmed
  if (booking.status === "Confirmed" && booking.guestSubmittedData && booking.guestSubmittedData.submittedAt) {
     return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
          <CardTitle className="text-xl">Ihre Daten wurden bereits übermittelt</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <CardDescription> {/* Use CardDescription for consistency */}
            Vielen Dank, {booking.guestFirstName}. Ihre Buchungsdaten für {booking.roomIdentifier || 'Ihr Zimmer'} wurden bereits erfolgreich übermittelt und bestätigt.
            </CardDescription>
            <p className="mt-4 text-sm text-muted-foreground">Bei Fragen wenden Sie sich bitte direkt an das Hotel.</p>
        </CardContent>
      </Card>
    );
  }

  if (booking.status === "Cancelled") {
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
    return (
      <GuestBookingFormStepper bookingToken={params.token} bookingDetails={booking} />
    );
  }

  // Fallback for other statuses or unexpected scenarios
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
