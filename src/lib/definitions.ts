
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface GuestSubmittedData {
  id?: string; 
  // Schritt 1: Gast-Stammdaten & Ausweis
  gastVorname?: string; 
  gastNachname?: string; 
  email?: string;
  telefon?: string;
  alterHauptgast?: number;
  hauptgastDokumenttyp?: 'Reisepass' | 'Personalausweis' | 'Führerschein';
  hauptgastAusweisVorderseiteUrl?: string; 
  hauptgastAusweisRückseiteUrl?: string;  

  // Schritt 2: Zahlungssumme (war vorher Zahlungswahl)
  paymentAmountSelection?: 'downpayment' | 'full_amount';
  
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
  
  zimmertyp?: string; // From first room, for easier display
  erwachsene?: number; // From first room
  kinder?: number; // From first room
  kleinkinder?: number; // From first room
  alterKinder?: string; // From first room
  
  rooms?: RoomDetail[]; 

  interneBemerkungen?: string;

  guestSubmittedData?: GuestSubmittedData; 
  createdAt: Date | string; 
  updatedAt: Date | string; 
}

// --- Form Data Typen für Server Actions ---

export interface GastStammdatenFormData { // For step 1 (Hauptgast Details & Ausweis)
  gastVorname: string;
  gastNachname: string;
  email: string;
  telefon: string;
  alterHauptgast?: string; // Kommt als String vom Formular, Zod wandelt es in number um
  // hauptgastDokumenttyp: 'Reisepass' | 'Personalausweis' | 'Führerschein'; // Ist im Bild nicht mehr explizit, wird aber noch im Schema verwendet
  hauptgastAusweisVorderseiteFile?: File | null;
  hauptgastAusweisRückseiteFile?: File | null;
}

export interface PaymentAmountSelectionFormData { // For step 2 (Zahlungssumme)
  paymentAmountSelection: 'downpayment' | 'full_amount';
}

export interface ZahlungsinformationenFormData { // For step 3 (Zahlungsdetails)
  zahlungsart: 'Überweisung';
  zahlungsdatum: string;
  zahlungsbelegFile?: File | null;
  zahlungsbetrag: number;
}

export interface UebersichtBestaetigungFormData { // For step 4 (Übersicht)
  agbAkzeptiert: boolean; 
  datenschutzAkzeptiert: boolean; 
}

export interface CreateBookingFormData { 
  guestFirstName: string;
  guestLastName: string;
  price: string; 
  checkInDate: string; 
  checkOutDate: string;
  verpflegung: string;
  interneBemerkungen?: string;
  roomsData: string; 
}

    