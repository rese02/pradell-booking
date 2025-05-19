
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface Mitreisender {
  id: string; // For React key and client-side management
  vorname?: string;
  nachname?: string;
  // Optional: If age or other details are needed for companions
  // alter?: number;
  hauptgastAusweisVorderseiteUrl?: string; // Storing the final URL from Firebase Storage
  hauptgastAusweisRückseiteUrl?: string;  // Storing the final URL from Firebase Storage
}

export interface GuestSubmittedData {
  id?: string;
  // Schritt 1: Gast-Stammdaten & Ausweis Hauptgast
  anrede?: 'Herr' | 'Frau' | 'Divers';
  gastVorname?: string;
  gastNachname?: string;
  geburtsdatum?: string; // ISO Format YYYY-MM-DD
  email?: string;
  telefon?: string;
  alterHauptgast?: number; // From new Step 1 design
  hauptgastDokumenttyp?: 'Reisepass' | 'Personalausweis' | 'Führerschein'; // From new Step 2 in image, now part of Hauptgast
  hauptgastAusweisVorderseiteUrl?: string; // From Firebase Storage
  hauptgastAusweisRückseiteUrl?: string;  // From Firebase Storage

  // Schritt 2: Mitreisende (NEU)
  mitreisende?: Mitreisender[];

  // Schritt 3: Zahlungssumme (war Zahlungswahl)
  paymentAmountSelection?: 'downpayment' | 'full_amount';

  // Schritt 4: Zahlungsinformationen
  zahlungsart?: 'Überweisung';
  zahlungsbetrag?: number;
  zahlungsdatum?: string; // ISO Format YYYY-MM-DD
  zahlungsbelegUrl?: string; // From Firebase Storage

  // Schritt 5: Übersicht & Bestätigung
  agbAkzeptiert?: boolean;
  datenschutzAkzeptiert?: boolean;

  submittedAt?: Date | string;
  lastCompletedStep?: number; // 0-indexed, indicates the last successfully COMPLETED step
  actionToken?: string;
}

export interface RoomDetail {
  zimmertyp: string;
  erwachsene: number;
  kinder?: number; // Kinder (3+ Jahre)
  kleinkinder?: number; // Kleinkinder (0-2 Jahre)
  alterKinder?: string; // Kommagetrenntes Alter der Kinder (3+)
}

export interface Booking {
  id: string; // Firestore Document ID
  guestFirstName: string; // Hauptansprechpartner Vorname
  guestLastName: string;  // Hauptansprechpartner Nachname
  price: number;
  roomIdentifier: string; // Wird aus dem ersten Zimmer generiert für schnelle Anzeige
  checkInDate?: Date | string; // ISO String oder Date Objekt
  checkOutDate?: Date | string; // ISO String oder Date Objekt
  bookingToken: string; // Eindeutiger Token für den Gast-Link
  status: BookingStatus;

  verpflegung?: string; // z.B. Frühstück, Halbpension

  // Details des ersten Zimmers für einfache Anzeige, die vollständigen Details sind in 'rooms'
  zimmertyp?: string;
  erwachsene?: number;
  kinder?: number;
  kleinkinder?: number;
  alterKinder?: string;

  rooms?: RoomDetail[]; // Array für mehrere Zimmer pro Buchung

  interneBemerkungen?: string; // Vom Hotel-Admin

  guestSubmittedData?: GuestSubmittedData; // Alle vom Gast übermittelten Daten
  createdAt: Date | string; // Erstellungsdatum
  updatedAt: Date | string; // Letztes Aktualisierungsdatum
}


// --- Form Data Typen für Server Actions (Spiegeln oft die Struktur der Eingabefelder wider) ---

export interface GastStammdatenFormData {
  anrede?: 'Herr' | 'Frau' | 'Divers';
  gastVorname: string;
  gastNachname: string;
  geburtsdatum?: string;
  email: string;
  telefon: string;
  alterHauptgast?: string; // Wird serverseitig zu number konvertiert
  hauptgastAusweisVorderseiteFile?: File | null;
  hauptgastAusweisRückseiteFile?: File | null;
}

// FormData für Mitreisende wird komplexer, da es ein Array ist.
// Oft sendet man dies als JSON-String für Metadaten und Dateien separat,
// oder nummeriert die Felder in FormData.

export interface PaymentAmountSelectionFormData {
  paymentAmountSelection: 'downpayment' | 'full_amount';
}

export interface ZahlungsinformationenFormData {
  zahlungsart: 'Überweisung';
  zahlungsdatum: string;
  zahlungsbelegFile?: File | null;
  zahlungsbetrag: string; // Kommt als String vom Formular
}

export interface UebersichtBestaetigungFormData {
  agbAkzeptiert: "on" | undefined; // Checkboxen senden "on" wenn checked
  datenschutzAkzeptiert: "on" | undefined;
}

export interface CreateBookingFormData {
  guestFirstName: string;
  guestLastName: string;
  price: string;
  checkInDate: string;
  checkOutDate: string;
  verpflegung: string;
  interneBemerkungen?: string;
  roomsData: string; // JSON string of RoomDetail[]
}
