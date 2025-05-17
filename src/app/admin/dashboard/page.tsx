import { BookingsDataTable } from "@/components/admin/BookingsDataTable";
import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import type { Booking } from "@/lib/definitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogInIcon as ArrivalIcon, LogOutIcon as DepartureIcon, PlusCircleIcon as NewBookingIcon, Info, ListFilter, CalendarCheck2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
];

// This function would fetch data in a real app
async function getBookings(): Promise<Booking[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));
  return MOCK_BOOKINGS;
}

async function getDashboardStats() {
  // Simulate API delay and data fetching
  await new Promise(resolve => setTimeout(resolve, 100));
  return {
    arrivalsToday: 0,
    departuresToday: 0,
    newBookingsToday: 0,
  };
}


interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ElementType;
  description: string;
  tooltipText: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, description, tooltipText }) => {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-50 hover:opacity-100">
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{tooltipText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-3">
            <Icon className="h-6 w-6 text-primary" />
            <div className="text-2xl font-bold">{value}</div>
        </div>
        <p className="text-xs text-muted-foreground pt-1">{description}</p>
      </CardContent>
    </Card>
  );
};


export default async function AdminDashboardPage() {
  const bookings = await getBookings();
  const stats = await getDashboardStats();

  return (
    <TooltipProvider>
      <div className="container mx-auto py-2">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-muted-foreground">
              Übersicht und Verwaltung aller Buchungen.
            </p>
          </div>
          <CreateBookingDialog /> {/* "Neue Buchung" Button */}
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatCard
            title="Ankünfte heute"
            value={stats.arrivalsToday}
            icon={ArrivalIcon}
            description="Gäste die heute anreisen"
            tooltipText="Anzahl der geplanten Ankünfte für den heutigen Tag."
          />
          <StatCard
            title="Abreisen heute"
            value={stats.departuresToday}
            icon={DepartureIcon}
            description="Gäste die heute auschecken"
            tooltipText="Anzahl der geplanten Abreisen für den heutigen Tag."
          />
          <StatCard
            title="Neue Buchungen heute"
            value={`+${stats.newBookingsToday}`}
            icon={NewBookingIcon}
            description="Heute erstellte Buchungen"
            tooltipText="Anzahl der Buchungen, die heute neu erstellt wurden."
          />
        </div>
        
        <Card className="shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Aktuelle Buchungen</CardTitle>
              <CardDescription>
                Details ansehen und Buchungen verwalten.
              </CardDescription>
            </div>
            {/* Placeholder for the "Buchungen ausrichten" button from BookingsDataTable's filter options */}
            {/* The actual filter button is inside BookingsDataTable */}
          </CardHeader>
          <CardContent>
            {bookings.length > 0 ? (
                <BookingsDataTable data={bookings} />
            ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <CalendarCheck2 className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold">Keine Buchungen gefunden</h3>
                    <p className="text-muted-foreground">Momentan sind keine Buchungen vorhanden.</p>
                    <div className="mt-6">
                         <CreateBookingDialog />
                    </div>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
