
export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface GuestSubmittedData {
  id?: string; 
  fullName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  email?: string;
  phone?: string;
  documentUrls?: string[]; 
  specialRequests?: string;
  submittedAt?: Date | string; // Keep consistent with Booking dates
}

export interface Booking {
  id: string; 
  guestFirstName: string;
  guestLastName: string;
  price: number;
  roomIdentifier: string; // This might be derived from zimmertyp or a specific assigned room number later
  checkInDate?: Date | string; 
  checkOutDate?: Date | string; 
  bookingToken: string; 
  status: BookingStatus;
  
  // Fields from the new booking form
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
  checkInDate: string; // Dates as strings from form input for yyyy-MM-dd format
  checkOutDate: string;
  verpflegung: string;
  zimmertyp: string;
  erwachsene: number;
  kinder?: number; // Optional if 0
  kleinkinder?: number; // Optional if 0
  alterKinder?: string;
  interneBemerkungen?: string;
}

// For GuestBookingFormStepper (Step 1)
export interface GuestBookingStep1FormData {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postalCode: string;
  country: string;
}

// For GuestBookingFormStepper (Step 3)
export interface GuestBookingStep3FormData {
  specialRequests?: string;
}

    