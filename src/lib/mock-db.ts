
import type { Booking, GuestSubmittedData } from "@/lib/definitions";

// Initial state of the mock database
const INITIAL_MOCK_BOOKINGS: Booking[] = [
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
    alterKinder: '',
    interneBemerkungen: '',
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

// Internal state of the mock database
let INTERNAL_MOCK_BOOKINGS_DB: Booking[] = JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS)); // Deep copy to start fresh on server restart for dev

console.log(`[Module mock-db.ts] Initialized at ${new Date().toISOString()}. INTERNAL_MOCK_BOOKINGS_DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);

export function getMockBookings(): Booking[] {
  console.log(`[MockDB getMockBookings] Accessing DB. Current length: ${INTERNAL_MOCK_BOOKINGS_DB.length} at ${new Date().toISOString()}`);
  return JSON.parse(JSON.stringify(INTERNAL_MOCK_BOOKINGS_DB));
}

export function addMockBooking(booking: Booking): void {
  console.log(`[MockDB addMockBooking] Attempting to add booking. Current DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length} at ${new Date().toISOString()}`);
  INTERNAL_MOCK_BOOKINGS_DB.unshift(booking); // Add to the beginning
  console.log(`[MockDB addMockBooking] Booking added with token ${booking.bookingToken}. New DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length}. All tokens: ${INTERNAL_MOCK_BOOKINGS_DB.map(b => b.bookingToken).join(', ')}`);
}

export function findMockBookingByToken(token: string): Booking | undefined {
  console.log(`[MockDB findMockBookingByToken] Searching for token: "${token}" at ${new Date().toISOString()}`);
  console.log(`[MockDB findMockBookingByToken] Current DB (length ${INTERNAL_MOCK_BOOKINGS_DB.length}) tokens: [${INTERNAL_MOCK_BOOKINGS_DB.map(b => b.bookingToken).join(', ')}]`);
  const booking = INTERNAL_MOCK_BOOKINGS_DB.find(b => b.bookingToken === token);
  if (booking) {
    console.log(`[MockDB findMockBookingByToken] Found booking for token "${token}".`);
    return JSON.parse(JSON.stringify(booking)); // Return a copy
  }
  console.warn(`[MockDB findMockBookingByToken] Booking with token "${token}" NOT FOUND.`);
  return undefined;
}

export function findMockBookingById(id: string): Booking | undefined {
  console.log(`[MockDB findMockBookingById] Searching for ID: "${id}" at ${new Date().toISOString()}`);
  console.log(`[MockDB findMockBookingById] Current DB (length ${INTERNAL_MOCK_BOOKINGS_DB.length}) IDs: [${INTERNAL_MOCK_BOOKINGS_DB.map(b => b.id).join(', ')}]`);
  const booking = INTERNAL_MOCK_BOOKINGS_DB.find(b => b.id === id);
   if (booking) {
    console.log(`[MockDB findMockBookingById] Found booking for ID "${id}".`);
    return JSON.parse(JSON.stringify(booking)); // Return a copy
  }
  console.warn(`[MockDB findMockBookingById] Booking with ID "${id}" NOT FOUND.`);
  return undefined;
}

export function updateMockBookingByToken(token: string, updates: Partial<Booking> | { guestSubmittedData: Partial<GuestSubmittedData>, documentUrls?: string[] }): boolean {
  console.log(`[MockDB updateMockBookingByToken] Attempting to update booking with token: "${token}". DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length} at ${new Date().toISOString()}`);
  const bookingIndex = INTERNAL_MOCK_BOOKINGS_DB.findIndex(b => b.bookingToken === token);
  if (bookingIndex !== -1) {
    const currentBooking = INTERNAL_MOCK_BOOKINGS_DB[bookingIndex];
    
    let updatedBookingData: Booking;

    if ('guestSubmittedData' in updates && typeof updates.guestSubmittedData === 'object') {
      const guestDataUpdates = updates.guestSubmittedData as Partial<GuestSubmittedData>;
      const newGuestSubmittedData = {
        ...(currentBooking.guestSubmittedData || {}),
        ...guestDataUpdates,
      };
      if ('documentUrls' in updates && Array.isArray(updates.documentUrls)) {
        // This case seems unlikely given the structure, but for safety:
        newGuestSubmittedData.documentUrls = updates.documentUrls;
      } else if (guestDataUpdates.documentUrls) {
         // If documentUrls are part of guestDataUpdates
        newGuestSubmittedData.documentUrls = guestDataUpdates.documentUrls;
      }


      updatedBookingData = {
        ...currentBooking,
        ...(updates as Partial<Booking>), 
        guestSubmittedData: newGuestSubmittedData,
        updatedAt: new Date().toISOString(),
      };
    } else {
      updatedBookingData = {
        ...currentBooking,
        ...(updates as Partial<Booking>),
        updatedAt: new Date().toISOString(),
      };
    }
    INTERNAL_MOCK_BOOKINGS_DB[bookingIndex] = updatedBookingData;
    console.log(`[MockDB updateMockBookingByToken] Booking with token "${token}" updated successfully.`);
    return true;
  }
  console.warn(`[MockDB updateMockBookingByToken] Booking with token "${token}" not found for update.`);
  return false;
}

export function resetMockDb(): void {
  console.log(`[MockDB resetMockDb] Resetting INTERNAL_MOCK_BOOKINGS_DB to initial state at ${new Date().toISOString()}.`);
  INTERNAL_MOCK_BOOKINGS_DB = JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS));
  console.log(`[MockDB resetMockDb] DB reset. New length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);
}
