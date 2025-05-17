
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

console.log(`[Module mock-db.ts] Initialized. INTERNAL_MOCK_BOOKINGS_DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);

export function getMockBookings(): Booking[] {
  console.log(`[getMockBookings] Accessing DB. Current length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);
  // Return a deep copy to prevent unintended modifications outside of the defined functions
  return JSON.parse(JSON.stringify(INTERNAL_MOCK_BOOKINGS_DB));
}

export function addMockBooking(booking: Booking): void {
  console.log(`[addMockBooking] Attempting to add booking. Current length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);
  INTERNAL_MOCK_BOOKINGS_DB.unshift(booking); // Add to the beginning
  console.log(`[addMockBooking] Booking added. New length: ${INTERNAL_MOCK_BOOKINGS_DB.length}. Tokens: ${INTERNAL_MOCK_BOOKINGS_DB.map(b => b.bookingToken).join(', ')}`);
}

export function findMockBookingByToken(token: string): Booking | undefined {
  console.log(`[findMockBookingByToken] Searching for token: "${token}". DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length}. Available tokens: ${INTERNAL_MOCK_BOOKINGS_DB.map(b => b.bookingToken).join(', ')}`);
  const booking = INTERNAL_MOCK_BOOKINGS_DB.find(b => b.bookingToken === token);
  if (booking) {
    console.log(`[findMockBookingByToken] Found booking for token "${token}".`);
    return JSON.parse(JSON.stringify(booking)); // Return a copy
  }
  console.warn(`[findMockBookingByToken] Booking with token "${token}" not found.`);
  return undefined;
}

export function findMockBookingById(id: string): Booking | undefined {
  console.log(`[findMockBookingById] Searching for ID: "${id}". DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);
  const booking = INTERNAL_MOCK_BOOKINGS_DB.find(b => b.id === id);
   if (booking) {
    console.log(`[findMockBookingById] Found booking for ID "${id}".`);
    return JSON.parse(JSON.stringify(booking)); // Return a copy
  }
  console.warn(`[findMockBookingById] Booking with ID "${id}" not found.`);
  return undefined;
}

export function updateMockBookingByToken(token: string, updates: Partial<Booking> | { guestSubmittedData: Partial<GuestSubmittedData>, documentUrls?: string[] }): boolean {
  console.log(`[updateMockBookingByToken] Attempting to update booking with token: "${token}". DB length: ${INTERNAL_MOCK_BOOKINGS_DB.length}`);
  const bookingIndex = INTERNAL_MOCK_BOOKINGS_DB.findIndex(b => b.bookingToken === token);
  if (bookingIndex !== -1) {
    const currentBooking = INTERNAL_MOCK_BOOKINGS_DB[bookingIndex];
    
    // Handle nested guestSubmittedData updates carefully
    if ('guestSubmittedData' in updates && typeof updates.guestSubmittedData === 'object') {
      const guestDataUpdates = updates.guestSubmittedData as Partial<GuestSubmittedData>;
      const newGuestSubmittedData = {
        ...(currentBooking.guestSubmittedData || {}),
        ...guestDataUpdates,
      };
      // Special handling for documentUrls if provided in the nested structure
      if ('documentUrls' in updates && Array.isArray(updates.documentUrls)) {
        newGuestSubmittedData.documentUrls = updates.documentUrls;
      }

      INTERNAL_MOCK_BOOKINGS_DB[bookingIndex] = {
        ...currentBooking,
        ...updates, // Apply top-level updates (like status)
        guestSubmittedData: newGuestSubmittedData, // Apply merged guest data
        updatedAt: new Date().toISOString(),
      };
    } else {
       // Handle top-level updates only
      INTERNAL_MOCK_BOOKINGS_DB[bookingIndex] = {
        ...currentBooking,
        ...(updates as Partial<Booking>), // Cast here as we've handled the other case
        updatedAt: new Date().toISOString(),
      };
    }
    console.log(`[updateMockBookingByToken] Booking with token "${token}" updated successfully.`);
    return true;
  }
  console.warn(`[updateMockBookingByToken] Booking with token "${token}" not found for update.`);
  return false;
}

// Helper to reset the mock DB to initial state (e.g., for testing or specific dev scenarios)
export function resetMockDb(): void {
  console.log("[resetMockDb] Resetting INTERNAL_MOCK_BOOKINGS_DB to initial state.");
  INTERNAL_MOCK_BOOKINGS_DB = JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS));
}
