export type BookingStatus = "Pending Guest Information" | "Awaiting Confirmation" | "Confirmed" | "Cancelled";

export interface GuestSubmittedData {
  id?: string; // Optional: could be the booking ID itself or a separate ID
  fullName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  email?: string;
  phone?: string;
  documentUrls?: string[]; // Array of URLs to uploaded documents
  specialRequests?: string;
  submittedAt?: Date;
}

export interface Booking {
  id: string; // Unique ID for the booking
  guestFirstName: string;
  guestLastName: string;
  price: number;
  roomIdentifier: string; // e.g., "Room 101", "Suite Deluxe"
  checkInDate?: Date | string; // Store as ISO string or Date
  checkOutDate?: Date | string; // Store as ISO string or Date
  bookingToken: string; // Unique token for the guest link
  status: BookingStatus;
  guestSubmittedData?: GuestSubmittedData; // Data submitted by the guest
  createdAt: Date | string; // Store as ISO string or Date
  updatedAt: Date | string; // Store as ISO string or Date
}

// For react-hook-form, typically you'd have separate schemas for creation/update
export interface CreateBookingFormData {
  guestFirstName: string;
  guestLastName: string;
  price: number;
  roomIdentifier: string;
  checkInDate?: string; // Dates as strings for form input
  checkOutDate?: string;
}

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

export interface GuestBookingStep3FormData {
  specialRequests?: string;
}
