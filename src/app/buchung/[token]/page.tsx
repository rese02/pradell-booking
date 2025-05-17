import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Mock data fetching function - replace with actual data fetching
async function getBookingByToken(token: string): Promise<Booking | null> {
  await new Promise(resolve => setTimeout(resolve, 300)); // Simulate API delay
  
  const MOCK_BOOKINGS: Booking[] = [
     { 
      id: '1', 
      guestFirstName: 'Max', 
      guestLastName: 'Mustermann', 
      price: 150.75, 
      roomIdentifier: '101', 
      checkInDate: new Date('2024-09-15').toISOString(),
      checkOutDate: new Date('2024-09-20').toISOString(),
      bookingToken: 'abc123xyz', 
      status: 'Pending Guest Information', 
      createdAt: new Date().toISOString(), 
      updatedAt: new Date().toISOString() 
    },
    { 
      id: '2', 
      guestFirstName: 'Erika', 
      guestLastName: 'Musterfrau', 
      price: 200, 
      roomIdentifier: 'Suite 205', 
      checkInDate: new Date('2024-10-01').toISOString(),
      checkOutDate: new Date('2024-10-05').toISOString(),
      bookingToken: 'def456uvw', 
      status: 'Confirmed', // This one is already confirmed, guest form might show a message or be read-only
      createdAt: new Date().toISOString(), 
      updatedAt: new Date().toISOString(),
      guestSubmittedData: { fullName: "Erika Musterfrau", email: "erika@example.com", phone: "0123456789"}
    },
  ];
  
  const booking = MOCK_BOOKINGS.find(b => b.bookingToken === token);
  if (booking && booking.status === "Confirmed") {
    // If already confirmed, we might not want them to edit. For now, let's return it.
    // Or, throw an error / return a specific status.
  }
  return booking || null;
}


export default async function GuestBookingPage({ params }: { params: { token: string } }) {
  const booking = await getBookingByToken(params.token);

  if (!booking) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h1 className="text-2xl font-semibold">Ungültiger Buchungslink</h1>
        <p className="text-muted-foreground mt-2">
          Dieser Buchungslink ist ungültig oder abgelaufen. Bitte kontaktieren Sie das Hotel.
        </p>
      </div>
    );
  }

  if (booking.status === "Confirmed" && booking.guestSubmittedData) {
     return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
          <CardTitle className="text-xl">Ihre Daten wurden bereits übermittelt</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <p className="text-muted-foreground">
            Vielen Dank, {booking.guestFirstName}. Ihre Buchungsdaten für Zimmer {booking.roomIdentifier} wurden bereits erfolgreich übermittelt und bestätigt.
            </p>
            <p className="mt-4">Bei Fragen wenden Sie sich bitte direkt an das Hotel.</p>
        </CardContent>
      </Card>
    );
  }
  
  if (booking.status === "Cancelled") {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h1 className="text-2xl font-semibold">Buchung storniert</h1>
        <p className="text-muted-foreground mt-2">
          Diese Buchung wurde storniert. Bitte kontaktieren Sie das Hotel für weitere Informationen.
        </p>
      </div>
    );
  }

  return (
    <GuestBookingFormStepper bookingToken={params.token} bookingDetails={booking} />
  );
}

// Added CheckCircle import as it's used in the conditional rendering.
import { CheckCircle } from "lucide-react";

