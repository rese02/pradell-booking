
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
      documentUrls: ["https://placehold.co/600x400.png?text=Ausweis-Vorderseite"],
      specialRequests: "Bitte ein ruhiges Zimmer, wenn möglich mit Blick zum Garten. Anreise erfolgt spät.",
      submittedAt: new Date('2024-08-18T14:55:00Z')
    }
  },
];

// --- Global Mock DB Store for Development ---
// Warning: Using global for mock DB is for dev only and has limitations.
// It aims to provide a more consistent state across Next.js dev server reloads/contexts.

const MOCK_DB_GLOBAL_KEY = Symbol.for('MOCK_BOOKINGS_DB_GASTFREUND_PRO');

interface MockDbStore {
  bookings: Booking[];
  initialized: boolean;
}

// Ensure globalThis is defined (it should be in Node.js and modern browsers)
const g = globalThis as any;

function getGlobalDbStore(): MockDbStore {
  if (!g[MOCK_DB_GLOBAL_KEY]) {
    console.log(`[MockDB - GlobalStore] Initializing GLOBAL mock DB store with key ${MOCK_DB_GLOBAL_KEY.toString()} at ${new Date().toISOString()}`);
    g[MOCK_DB_GLOBAL_KEY] = {
      bookings: JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS)), // Deep copy
      initialized: true,
    };
  } else if (!g[MOCK_DB_GLOBAL_KEY].initialized) {
    // This case might happen if the symbol exists but data isn't fully set up (e.g. across some types of hot reloads)
    console.log(`[MockDB - GlobalStore] Re-initializing data in existing GLOBAL mock DB store at ${new Date().toISOString()}`);
    g[MOCK_DB_GLOBAL_KEY].bookings = JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS));
    g[MOCK_DB_GLOBAL_KEY].initialized = true;
  }
  return g[MOCK_DB_GLOBAL_KEY];
}

// Initialize on module load
getGlobalDbStore();
console.log(`[MockDB - Module] Module evaluated. Global store should be initialized. Current global DB length: ${getGlobalDbStore().bookings.length} at ${new Date().toISOString()}`);


export function getMockBookings(): Booking[] {
  const store = getGlobalDbStore();
  console.log(`[MockDB getMockBookings] Accessing global DB. Current length: ${store.bookings.length} at ${new Date().toISOString()}`);
  return JSON.parse(JSON.stringify(store.bookings)); // Return a deep copy
}

export function addMockBooking(booking: Booking): void {
  const store = getGlobalDbStore();
  console.log(`[MockDB addMockBooking] Attempting to add booking to global DB. Current global DB length: ${store.bookings.length} at ${new Date().toISOString()}`);
  store.bookings.unshift(booking); // Add to the beginning
  console.log(`[MockDB addMockBooking] Booking added with token ${booking.bookingToken}. New global DB length: ${store.bookings.length}. All tokens: ${store.bookings.map(b => b.bookingToken).join(', ')}`);
}

export function findMockBookingByToken(token: string): Booking | undefined {
  const store = getGlobalDbStore();
  console.log(`[MockDB findMockBookingByToken] Searching for token: "${token}" in global DB at ${new Date().toISOString()}`);
  console.log(`[MockDB findMockBookingByToken] Current global DB (length ${store.bookings.length}) tokens: [${store.bookings.map(b => b.bookingToken).join(', ')}]`);
  const booking = store.bookings.find(b => b.bookingToken === token);
  if (booking) {
    console.log(`[MockDB findMockBookingByToken] Found booking for token "${token}" in global DB.`);
    return JSON.parse(JSON.stringify(booking)); // Return a copy
  }
  console.warn(`[MockDB findMockBookingByToken] Booking with token "${token}" NOT FOUND in global DB.`);
  return undefined;
}

export function findMockBookingById(id: string): Booking | undefined {
  const store = getGlobalDbStore();
  console.log(`[MockDB findMockBookingById] Searching for ID: "${id}" in global DB at ${new Date().toISOString()}`);
  console.log(`[MockDB findMockBookingById] Current global DB (length ${store.bookings.length}) IDs: [${store.bookings.map(b => b.id).join(', ')}]`);
  const booking = store.bookings.find(b => b.id === id);
   if (booking) {
    console.log(`[MockDB findMockBookingById] Found booking for ID "${id}" in global DB.`);
    return JSON.parse(JSON.stringify(booking)); // Return a copy
  }
  console.warn(`[MockDB findMockBookingById] Booking with ID "${id}" NOT FOUND in global DB.`);
  return undefined;
}

export function updateMockBookingByToken(token: string, updates: Partial<Booking> | { guestSubmittedData: Partial<GuestSubmittedData>, documentUrls?: string[] }): boolean {
  const store = getGlobalDbStore();
  console.log(`[MockDB updateMockBookingByToken] Attempting to update booking with token: "${token}" in global DB. DB length: ${store.bookings.length} at ${new Date().toISOString()}`);
  const bookingIndex = store.bookings.findIndex(b => b.bookingToken === token);
  if (bookingIndex !== -1) {
    const currentBooking = store.bookings[bookingIndex];
    
    let updatedBookingData: Booking;

    if ('guestSubmittedData' in updates && typeof updates.guestSubmittedData === 'object') {
      const guestDataUpdates = updates.guestSubmittedData as Partial<GuestSubmittedData>;
      const newGuestSubmittedData: GuestSubmittedData = { // Ensure newGuestSubmittedData is typed
        ...(currentBooking.guestSubmittedData || {}),
        ...guestDataUpdates,
      };
      if ('documentUrls' in updates && Array.isArray(updates.documentUrls)) {
        newGuestSubmittedData.documentUrls = updates.documentUrls;
      } else if (guestDataUpdates.documentUrls) {
        newGuestSubmittedData.documentUrls = guestDataUpdates.documentUrls;
      }

      updatedBookingData = {
        ...currentBooking,
        ...(updates as Partial<Booking>), // Apply other top-level updates if any
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
    store.bookings[bookingIndex] = updatedBookingData;
    console.log(`[MockDB updateMockBookingByToken] Booking with token "${token}" updated successfully in global DB.`);
    return true;
  }
  console.warn(`[MockDB updateMockBookingByToken] Booking with token "${token}" not found for update in global DB.`);
  return false;
}

export function resetMockDb(): void {
  const store = getGlobalDbStore();
  console.log(`[MockDB resetMockDb] Resetting GLOBAL mock DB to initial state at ${new Date().toISOString()}.`);
  store.bookings = JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS));
  store.initialized = true; // Ensure initialized flag is set
  console.log(`[MockDB resetMockDb] Global DB reset. New length: ${store.bookings.length}`);
}
