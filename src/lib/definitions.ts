

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
  
  // Beibehaltene allgemeine Felder (werden in den neuen Schritten nicht mehr explizit als eigene Felder erfasst, aber die Struktur bleibt für Altdaten)
  specialRequests?: string; 
  
  // Schritt 4 (ehemals 5): Übersicht & Bestätigung
  agbAkzeptiert?: boolean; 
  datenschutzAkzeptiert?: boolean; 
  
  submittedAt?: Date | string; 
  lastCompletedStep?: number; 
  actionToken?: string; 

  // Nicht mehr aktiv genutzte Felder aus älteren Strukturen (zur Referenz):
  // fullName?: string; 
  // guestFirstName?: string; // use gastVorname
  // guestLastName?: string; // use gastNachname
  // phone?: string; // use telefon
  // alter?: number; // use geburtsdatum
  // ausweisVorderseiteUrl?: string; // use hauptgastAusweisVorderseiteUrl
  // ausweisRückseiteUrl?: string;  // use hauptgastAusweisRückseiteUrl
  // addressLine1?: string; 
  // addressLine2?: string; 
  // city?: string; 
  // postalCode?: string; 
  // country?: string; 
  // documentUrls?: string[]; // use spezifische URLs
  // mitreisende?: Mitreisender[]; // aktuell nicht im Flow
  // paymentAmountSelection?: 'downpayment' | 'full_amount'; // Nicht mehr als separater Schritt
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
  zimmertyp?: string;
  erwachsene?: number;
  kinder?: number;
  kleinkinder?: number;
  alterKinder?: string;
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
  // anzahlungsbetrag wird automatisch kalkuliert
  zahlungsart: 'Überweisung';
  zahlungsdatum: string;
  zahlungsbeleg?: File | null;
}

export interface UebersichtBestaetigungFormData {
  agbAkzeptiert: boolean; // Wird als boolean interpretiert
  datenschutzAkzeptiert: boolean; // Wird als boolean interpretiert
}


// Alte Form Data Typen (zur Referenz / ggf. Entfernung)
export interface CreateBookingFormData {
  guestFirstName: string;
  guestLastName: string;
  price: number;
  checkInDate: string; 
  checkOutDate: string;
  verpflegung: string;
  zimmertyp: string;
  erwachsene: number;
  kinder?: number; 
  kleinkinder?: number; 
  alterKinder?: string;
  interneBemerkungen?: string;
}
