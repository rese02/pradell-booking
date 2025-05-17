
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface Mitreisender {
  id: string; // Can be temporary for client-side, or permanent from DB
  vorname?: string;
  nachname?: string;
  alter?: number;
  ausweisVorderseiteUrl?: string;
  ausweisRückseiteUrl?: string;
  // For FormData processing with files
  ausweisVorderseiteFile?: File; 
  ausweisRückseiteFile?: File;
}

export interface GuestSubmittedData {
  id?: string; 
  fullName?: string; 
  guestFirstName?: string; 
  guestLastName?: string; 
  email?: string;
  phone?: string;
  alter?: number;
  ausweisVorderseiteUrl?: string; 
  ausweisRückseiteUrl?: string;  
  specialRequests?: string;
  datenschutzAkzeptiert?: boolean;
  
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  
  documentUrls?: string[]; 
  mitreisende?: Mitreisender[]; // Array of fellow travelers
  submittedAt?: Date | string; 
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

export interface HauptgastFormData {
  fullName: string; 
  lastName: string; 
  email: string;
  phone: string;
  alter?: number;
  ausweisVorderseite?: File | null; 
  ausweisRückseite?: File | null;  
  specialRequests?: string;
  datenschutz: "on" | undefined; // Checkbox value
}

export interface MitreisendeFormData {
  mitreisende: {
    id?: string;
    vorname: string;
    nachname: string;
    alter?: number;
    ausweisVorderseite?: File | null;
    ausweisRückseite?: File | null;
  }[];
}
    
