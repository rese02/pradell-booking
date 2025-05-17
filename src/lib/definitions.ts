
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface GuestSubmittedData {
  id?: string; 
  // Fields from new Hauptgast form
  fullName?: string; // Used for Hauptgast Vorname in form
  guestFirstName?: string; // Could be derived from fullName or specific
  guestLastName?: string; // Hauptgast Nachname
  email?: string;
  phone?: string;
  alter?: number;
  ausweisVorderseiteUrl?: string; // Store URL after upload
  ausweisRückseiteUrl?: string;  // Store URL after upload
  specialRequests?: string;
  datenschutzAkzeptiert?: boolean;
  
  // Legacy fields (can be removed if not used by Hauptgast form directly for address)
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  
  documentUrls?: string[]; // General documents, can combine with new specific ones
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

// For react-hook-form used in CreateBookingDialog
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

// For GuestBookingFormStepper (Step 1 - Hauptgast)
export interface HauptgastFormData {
  fullName: string; // Vorname on form
  lastName: string; // Nachname on form
  email: string;
  phone: string;
  alter?: number;
  ausweisVorderseite?: File; // File object from input
  ausweisRückseite?: File;  // File object from input
  specialRequests?: string;
  datenschutz: boolean; // From checkbox
}
    
