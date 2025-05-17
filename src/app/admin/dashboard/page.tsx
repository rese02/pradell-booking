import { BookingsDataTable } from "@/components/admin/BookingsDataTable";
import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import type { Booking } from "@/lib/definitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, ListFilter } from "lucide-react";

// Mock data - in a real app, this would come from a database
const MOCK_BOOKINGS: Booking[] = [
  { 
    id: '1', 
    guestFirstName: 'Max', 
    guestLastName: 'Mustermann', 
    price: 150.75, 
    roomIdentifier: '101', 
    checkInDate: new Date('2024-09-15').toISOString(),
    checkOutDate: new Date('2024-09-20').toISOString(),
    bookingToken: 'abc123xyz', 
    status: 'Pending Guest Information', 
    createdAt: new Date().toISOString(), 
    updatedAt: new Date().toISOString() 
  },
  { 
    id: '2', 
    guestFirstName: 'Erika', 
    guestLastName: 'Musterfrau', 
    price: 200, 
    roomIdentifier: 'Suite 205', 
    checkInDate: new Date('2024-10-01').toISOString(),
    checkOutDate: new Date('2024-10-05').toISOString(),
    bookingToken: 'def456uvw', 
    status: 'Confirmed', 
    createdAt: new Date().toISOString(), 
    updatedAt: new Date().toISOString(),
    guestSubmittedData: { fullName: "Erika Musterfrau", email: "erika@example.com", phone: "0123456789"}
  },
  { 
    id: '3', 
    guestFirstName: 'John', 
    guestLastName: 'Doe', 
    price: 99.50, 
    roomIdentifier: '303', 
    checkInDate: new Date('2024-11-10').toISOString(),
    checkOutDate: new Date('2024-11-12').toISOString(),
    bookingToken: 'ghi789rst', 
    status: 'Awaiting Confirmation', 
    createdAt: new Date().toISOString(), 
    updatedAt: new Date().toISOString() 
  },
  { 
    id: '4', 
    guestFirstName: 'Jane', 
    guestLastName: 'Roe', 
    price: 320.00, 
    roomIdentifier: 'Penthouse', 
    bookingToken: 'jkl012pqr', 
    status: 'Cancelled', 
    createdAt: new Date().toISOString(), 
    updatedAt: new Date().toISOString() 
  },
];

// This function would fetch data in a real app
async function getBookings(): Promise<Booking[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  return MOCK_BOOKINGS;
}

export default async function AdminDashboardPage() {
  const bookings = await getBookings();

  return (
    <div className="container mx-auto py-2">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Übersicht aller aktuellen Buchungen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" /> Exportieren
          </Button>
          <CreateBookingDialog />
        </div>
      </div>
      
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Buchungsübersicht</CardTitle>
          <CardDescription>
            Verwalten und einsehen aller Buchungen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BookingsDataTable data={bookings} />
        </CardContent>
      </Card>
    </div>
  );
}
