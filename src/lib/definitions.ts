
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface Mitreisender { 
  id: string;
  vorname?: string;
  nachname?: string;
  alter?: number;
  ausweisVorderseiteUrl?: string;
  ausweisRückseiteUrl?: string;
  ausweisVorderseiteFile?: File; 
  ausweisRückseiteFile?: File;
}

export interface GuestSubmittedData {
  id?: string; 
  // Schritt 1: Gast-Stammdaten
  anrede?: 'Herr' | 'Frau' | 'Divers';
  gastVorname?: string; 
  gastNachname?: string; 
  geburtsdatum?: string; // ISO Format YYYY-MM-DD
  email?: string;
  telefon?: string;

  // Schritt 2: Ausweisdokument(e) Hauptgast
  hauptgastDokumenttyp?: 'Reisepass' | 'Personalausweis' | 'Führerschein';
  hauptgastAusweisVorderseiteUrl?: string; 
  hauptgastAusweisRückseiteUrl?: string;  

  // Schritt 3: Zahlungsinformationen
  zahlungsart?: 'Überweisung'; 
  zahlungsbetrag?: number; 
  zahlungsdatum?: string; // ISO Format YYYY-MM-DD
  zahlungsbelegUrl?: string;
  
  // Schritt 4: Übersicht & Bestätigung
  agbAkzeptiert?: boolean; 
  datenschutzAkzeptiert?: boolean; 
  
  submittedAt?: Date | string; 
  lastCompletedStep?: number; // 0-indexed
  actionToken?: string; 
}

export interface RoomDetail {
  zimmertyp: string;
  erwachsene: number;
  kinder?: number;
  kleinkinder?: number;
  alterKinder?: string;
}

export interface Booking {
  id: string; 
  guestFirstName: string; 
  guestLastName: string; 
  price: number;
  roomIdentifier: string; 
  checkInDate?: Date | string; 
  checkOutDate?: Date | string; 
  bookingToken: string; 
  status: BookingStatus;
  
  verpflegung?: string;
  
  // Deprecated individual room fields, use 'rooms' array instead for new bookings
  zimmertyp?: string;
  erwachsene?: number;
  kinder?: number;
  kleinkinder?: number;
  alterKinder?: string;
  
  rooms?: RoomDetail[]; // Array to store details of all rooms

  interneBemerkungen?: string;

  guestSubmittedData?: GuestSubmittedData; 
  createdAt: Date | string; 
  updatedAt: Date | string; 
}

// --- Form Data Typen für die aktuellen Schritte ---

export interface GastStammdatenFormData {
  anrede: 'Herr' | 'Frau' | 'Divers';
  gastVorname: string;
  gastNachname: string;
  geburtsdatum?: string;
  email: string;
  telefon: string;
}

export interface AusweisdokumenteFormData {
  hauptgastDokumenttyp: 'Reisepass' | 'Personalausweis' | 'Führerschein';
  hauptgastAusweisVorderseite?: File | null;
  hauptgastAusweisRückseite?: File | null;
}

export interface ZahlungsinformationenFormData {
  zahlungsart: 'Überweisung';
  zahlungsdatum: string;
  zahlungsbeleg?: File | null;
  zahlungsbetrag: number; // Added from hidden input
}

export interface UebersichtBestaetigungFormData {
  agbAkzeptiert: boolean; 
  datenschutzAkzeptiert: boolean; 
}


export interface CreateBookingFormData { // This is the data shape from the form before Zod transform
  guestFirstName: string;
  guestLastName: string;
  price: string; // from input type=number, can be string
  checkInDate: string; 
  checkOutDate: string;
  verpflegung: string;
  interneBemerkungen?: string;
  roomsData: string; // JSON string of RoomFormData[] (excluding client-side id)
}
