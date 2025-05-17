
import type { Booking } from "@/lib/definitions";

// Centralized Mock Database for Bookings
export const MOCK_BOOKINGS_DB: Booking[] = [
  {
    id: '1',
    guestFirstName: 'Max',
    guestLastName: 'Mustermann',
    price: 150.75,
    checkInDate: new Date('2024-09-15T14:00:00Z').toISOString(),
    checkOutDate: new Date('2024-09-20T11:00:00Z').toISOString(),
    bookingToken: 'abc123xyz',
    status: 'Pending Guest Information',
    createdAt: new Date('2024-08-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2024-08-01T10:00:00Z').toISOString(),
    verpflegung: 'fruehstueck',
    zimmertyp: 'doppelzimmer',
    erwachsene: 2,
    kinder: 1,
    kleinkinder: 0,
    alterKinder: '5',
    interneBemerkungen: 'Früher Check-in angefragt, falls möglich.',
    roomIdentifier: 'Doppelzimmer (Details folgen)',
  },
  {
    id: '2',
    guestFirstName: 'Erika',
    guestLastName: 'Musterfrau',
    price: 200,
    checkInDate: new Date('2024-10-01T00:00:00Z').toISOString(),
    checkOutDate: new Date('2024-10-05T00:00:00Z').toISOString(),
    bookingToken: 'def456uvw',
    status: 'Confirmed',
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
      documentUrls: ["https://placehold.co/600x400.png?text=Ausweis-Vorderseite", "https://placehold.co/600x400.png?text=Ausweis-Rückseite"],
      specialRequests: "Bitte ein ruhiges Zimmer, wenn möglich mit Blick zum Garten. Anreise erfolgt spät.",
      submittedAt: new Date('2024-08-18T14:55:00Z')
    }
  },
];
