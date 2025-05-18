
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
    guestSubmittedData: {
        lastCompletedStep: -1,
        email: "max@example.com", // Pre-fill for easier testing
    }
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
      lastCompletedStep: 3, // All 4 steps (0,1,2,3) completed
      anrede: 'Frau',
      gastVorname: 'Erika',
      gastNachname: 'Musterfrau',
      geburtsdatum: '1980-05-20',
      email: "erika@example.com",
      telefon: "0123-4567890",
      hauptgastDokumenttyp: 'Personalausweis',
      hauptgastAusweisVorderseiteUrl: 'https://placehold.co/600x400.png?text=Erika-Ausweis-V.pdf',
      hauptgastAusweisRückseiteUrl: 'https://placehold.co/600x400.png?text=Erika-Ausweis-R.pdf',
      zahlungsart: 'Überweisung',
      zahlungsbetrag: 60.00, // 30% of 200
      zahlungsdatum: '2024-08-17',
      zahlungsbelegUrl: 'https://placehold.co/600x400.png?text=Erika-Zahlungsbeleg.jpg',
      agbAkzeptiert: true,
      datenschutzAkzeptiert: true,
      submittedAt: new Date('2024-08-18T14:55:00Z').toISOString()
    }
  },
];


const MOCK_DB_GLOBAL_KEY = Symbol.for('MOCK_BOOKINGS_DB_GASTFREUND_PRO_V2');

interface MockDbStore {
  bookings: Booking[];
  initialized: boolean;
}

const g = globalThis as any;

function getGlobalDbStore(): MockDbStore {
  if (!g[MOCK_DB_GLOBAL_KEY] || !g[MOCK_DB_GLOBAL_KEY].initialized) {
    console.log(`[MockDB - GlobalStore] Initializing/Re-initializing GLOBAL mock DB store with key ${MOCK_DB_GLOBAL_KEY.toString()} at ${new Date().toISOString()}`);
    g[MOCK_DB_GLOBAL_KEY] = {
      bookings: JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS)), 
      initialized: true,
    };
  }
  return g[MOCK_DB_GLOBAL_KEY];
}

getGlobalDbStore();
console.log(`[MockDB - Module] Module evaluated. Global store should be initialized. Current global DB length: ${getGlobalDbStore().bookings.length} at ${new Date().toISOString()}`);


export function getMockBookings(): Booking[] {
  const store = getGlobalDbStore();
  console.log(`[MockDB getMockBookings] Accessing global DB. Current length: ${store.bookings.length} at ${new Date().toISOString()}`);
  return JSON.parse(JSON.stringify(store.bookings)); 
}

export function addMockBooking(booking: Booking): void {
  const store = getGlobalDbStore();
  console.log(`[MockDB addMockBooking] Attempting to add booking to global DB. Current global DB length: ${store.bookings.length} at ${new Date().toISOString()}`);
  store.bookings.unshift(booking); 
  console.log(`[MockDB addMockBooking] Booking added with token ${booking.bookingToken}. New global DB length: ${store.bookings.length}. All tokens: ${store.bookings.map(b => b.bookingToken).join(', ')}`);
}

export function findMockBookingByToken(token: string): Booking | undefined {
  const store = getGlobalDbStore();
  console.log(`[MockDB findMockBookingByToken] Searching for token: "${token}" in global DB at ${new Date().toISOString()}`);
  console.log(`[MockDB findMockBookingByToken] Current global DB (length ${store.bookings.length}) tokens: [${store.bookings.map(b => b.bookingToken).join(', ')}]`);
  const booking = store.bookings.find(b => b.bookingToken === token);
  if (booking) {
    console.log(`[MockDB findMockBookingByToken] Found booking for token "${token}" in global DB.`);
    return JSON.parse(JSON.stringify(booking)); 
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
    return JSON.parse(JSON.stringify(booking)); 
  }
  console.warn(`[MockDB findMockBookingById] Booking with ID "${id}" NOT FOUND in global DB.`);
  return undefined;
}

export function updateMockBookingByToken(token: string, updates: Partial<Booking>): boolean {
  const store = getGlobalDbStore();
  console.log(`[MockDB updateMockBookingByToken] Attempting to update booking with token: "${token}" in global DB. DB length: ${store.bookings.length} at ${new Date().toISOString()}`);
  const bookingIndex = store.bookings.findIndex(b => b.bookingToken === token);
  if (bookingIndex !== -1) {
    const currentBooking = store.bookings[bookingIndex];
    
    const updatedBookingData: Booking = {
      ...currentBooking,
      ...updates, // Apply all updates directly
      guestSubmittedData: { // Deep merge guestSubmittedData
        ...(currentBooking.guestSubmittedData || {}),
        ...(updates.guestSubmittedData || {}),
      },
      updatedAt: new Date().toISOString(),
    };
    
    store.bookings[bookingIndex] = updatedBookingData;
    console.log(`[MockDB updateMockBookingByToken] Booking with token "${token}" updated successfully in global DB.`);
    console.log(`[MockDB updateMockBookingByToken] Updated Guest Data for token ${token} (partial): ${JSON.stringify(updatedBookingData.guestSubmittedData, null, 2).substring(0, 300)}...`);
    return true;
  }
  console.warn(`[MockDB updateMockBookingByToken] Booking with token "${token}" not found for update in global DB.`);
  return false;
}

export function deleteMockBookingsByIds(ids: string[]): boolean {
  const store = getGlobalDbStore();
  const initialLength = store.bookings.length;
  console.log(`[MockDB deleteMockBookingsByIds] Attempting to delete IDs: [${ids.join(', ')}] from global DB. Current length: ${initialLength}`);
  
  store.bookings = store.bookings.filter(booking => !ids.includes(booking.id));
  
  const finalLength = store.bookings.length;
  const numDeleted = initialLength - finalLength;

  if (numDeleted > 0) {
    console.log(`[MockDB deleteMockBookingsByIds] Successfully deleted ${numDeleted} booking(s). New global DB length: ${finalLength}. Remaining tokens: ${store.bookings.map(b => b.bookingToken).join(', ')}`);
  } else {
    console.warn(`[MockDB deleteMockBookingsByIds] No bookings found with the provided IDs to delete. IDs: [${ids.join(', ')}]. DB length unchanged: ${finalLength}`);
  }
  return true; 
}

export function resetMockDb(): void {
  const store = getGlobalDbStore();
  console.log(`[MockDB resetMockDb] Resetting GLOBAL mock DB to initial state at ${new Date().toISOString()}.`);
  store.bookings = JSON.parse(JSON.stringify(INITIAL_MOCK_BOOKINGS));
  store.initialized = true; 
  console.log(`[MockDB resetMockDb] Global DB reset. New length: ${store.bookings.length}`);
}
