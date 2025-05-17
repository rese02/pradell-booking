
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface Mitreisender { // Beibehalten, falls später wieder benötigt, aktuell nicht im neuen 5-Schritt-Flow
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
  gastVorname?: string; // Umbenannt von guestFirstName zur Klarheit, da fullName oft verwendet wird
  gastNachname?: string; // Umbenannt von guestLastName
  geburtsdatum?: string; // ISO Format YYYY-MM-DD
  email?: string;
  telefon?: string;

  // Schritt 2: Ausweisdokument(e) Hauptgast
  hauptgastDokumenttyp?: 'Reisepass' | 'Personalausweis' | 'Führerschein';
  hauptgastAusweisVorderseiteUrl?: string; 
  hauptgastAusweisRückseiteUrl?: string;  

  // Schritt 3: Zahlungsinformationen
  zahlungsart?: 'Überweisung'; // Vorerst nur Überweisung
  zahlungsbetrag?: number; // Kann Anzahlung oder Gesamtbetrag sein
  zahlungsdatum?: string; // ISO Format YYYY-MM-DD
  zahlungsbelegUrl?: string;
  
  // Für die Auswahl der Zahlungssumme, falls noch relevant oder als Teil von Schritt 3
  paymentAmountSelection?: 'downpayment' | 'full_amount'; 

  // Beibehaltene allgemeine Felder
  specialRequests?: string; // Könnte in Schritt 1 oder 4 erfasst werden
  datenschutzAkzeptiert?: boolean; // Für Schritt 4 (Übersicht)
  agbAkzeptiert?: boolean; // Für Schritt 4 (Übersicht)
  
  // Alte Felder, die ggf. migriert/entfernt werden müssen:
  fullName?: string; // Wird durch gastVorname/gastNachname ersetzt
  guestFirstName?: string; 
  guestLastName?: string; 
  phone?: string; // Bereits oben als telefon
  alter?: number; // Wird durch geburtsdatum ersetzt für präzisere Altersangabe
  ausweisVorderseiteUrl?: string; // Ersetzt durch hauptgastAusweis...
  ausweisRückseiteUrl?: string;  // Ersetzt durch hauptgastAusweis...
  addressLine1?: string; // Nicht im neuen Flow
  addressLine2?: string; // Nicht im neuen Flow
  city?: string; // Nicht im neuen Flow
  postalCode?: string; // Nicht im neuen Flow
  country?: string; // Nicht im neuen Flow
  documentUrls?: string[]; // Wird durch spezifische URLs ersetzt
  mitreisende?: Mitreisender[]; // Aktuell nicht im neuen Flow
  
  submittedAt?: Date | string; 
  lastCompletedStep?: number; // Um den Fortschritt zu speichern
  actionToken?: string; // Für die Navigation
}

export interface Booking {
  id: string; 
  guestFirstName: string; // Bleibt für die Admin-Anzeige / initiale Erstellung
  guestLastName: string; // Bleibt für die Admin-Anzeige / initiale Erstellung
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

// --- Form Data Typen für die neuen Schritte ---

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
  // anzahlungsbetrag: number; // Wird automatisch kalkuliert oder später manuell editierbar
  zahlungsart: 'Überweisung';
  zahlungsdatum: string;
  zahlungsbeleg?: File | null;
}

export interface UebersichtBestaetigungFormData {
  agbAkzeptiert: "on" | undefined;
  datenschutzAkzeptiert: "on" | undefined;
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

export interface HauptgastFormData { // Alt, wird durch GastStammdatenFormData und AusweisdokumenteFormData ersetzt
  fullName: string; 
  lastName: string; 
  email: string;
  phone: string;
  alter?: number;
  ausweisVorderseite?: File | null; 
  ausweisRückseite?: File | null;  
  specialRequests?: string;
  datenschutz: "on" | undefined;
}

export interface MitreisendeFormData { // Alt
  mitreisende: {
    id?: string;
    vorname: string;
    nachname: string;
    alter?: number;
    ausweisVorderseite?: File | null;
    ausweisRückseite?: File | null;
  }[];
}

export interface PaymentAmountSelectionFormData { // Alt
  paymentSelection: 'downpayment' | 'full_amount';
}
    
