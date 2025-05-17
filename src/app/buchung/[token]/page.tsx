
import { GuestBookingFormStepper } from "@/components/guest/GuestBookingFormStepper";
import type { Booking } from "@/lib/definitions";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Mock data - In a real application, this data would be fetched from a database (e.g., Firebase Firestore)
// based on the booking token.
const MOCK_BOOKINGS_DB: Booking[] = [
  {
    id: '1',
    guestFirstName: 'Max', // Admin entered this
    guestLastName: 'Mustermann', // Admin entered this
    price: 150.75, // Admin entered this
    checkInDate: new Date('2024-09-15T14:00:00Z').toISOString(), // Admin entered this
    checkOutDate: new Date('2024-09-20T11:00:00Z').toISOString(), // Admin entered this
    bookingToken: 'abc123xyz',
    status: 'Pending Guest Information', // CRITICAL for showing the form
    createdAt: new Date('2024-08-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2024-08-01T10:00:00Z').toISOString(),
    // New fields from admin dialog
    verpflegung: 'fruehstueck',
    zimmertyp: 'doppelzimmer',
    erwachsene: 2,
    kinder: 1,
    kleinkinder: 0,
    alterKinder: '5',
    interneBemerkungen: 'Früher Check-in angefragt, falls möglich.',
    roomIdentifier: 'Doppelzimmer (Details folgen)', // Derived or generic
    // guestSubmittedData will be filled by the guest through the form
  },
  {
    id: '2',
    guestFirstName: 'Erika',
    guestLastName: 'Musterfrau',
    price: 200,
    checkInDate: new Date('2024-10-01T00:00:00Z').toISOString(),
    checkOutDate: new Date('2024-10-05T00:00:00Z').toISOString(),
    bookingToken: 'def456uvw',
    status: 'Confirmed', // To show "already submitted" message
    createdAt: new Date('2024-08-15T12:30:00Z').toISOString(),
    updatedAt: new Date('2024-08-18T15:00:00Z').toISOString(),
    verpflegung: 'halbpension',
    zimmertyp: 'suite',
    erwachsene: 2,
    kinder: 0,
    kleinkinder: 0,
    roomIdentifier: 'Suite (Details folgen)',
    guestSubmittedData: {
      fullName: "Erika Musterfrau",
      email: "erika@example.com",
      phone: "0123-4567890",
      addressLine1: "Musterstraße 123",
      city: "Musterstadt",
      postalCode: "12345",
      country: "Deutschland",
      submittedAt: new Date('2024-08-18T14:55:00Z')
    }
  },
];

// Mock data fetching function - replace with actual data fetching from your backend/Firebase
async function getBookingByToken(token: string): Promise<Booking | null> {
  console.log(`[Server] Attempting to fetch booking for token: ${token}`);
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 300));

  // In a real app, you would query your database:
  // e.g., const bookingDoc = await db.collection('bookings').where('bookingToken', '==', token).limit(1).get();
  // if (bookingDoc.empty) { console.log(`[Server] No booking found for token ${token}`); return null; }
  // const bookingData = bookingDoc.docs[0].data() as Booking;
  // console.log(`[Server] Found booking for token ${token}:`, bookingData.status);
  // return bookingData;

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
      <Card className="w-full max-w-lg mx-auto shadow-lg">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
          <CardTitle className="text-xl">Ihre Daten wurden bereits übermittelt</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
            <p className="text-muted-foreground">
            Vielen Dank, {booking.guestFirstName}. Ihre Buchungsdaten für {booking.roomIdentifier || 'Ihr Zimmer'} wurden bereits erfolgreich übermittelt und bestätigt.
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

  // If booking is pending guest information, show the form
  return (
    <GuestBookingFormStepper bookingToken={params.token} bookingDetails={booking} />
  );
}
