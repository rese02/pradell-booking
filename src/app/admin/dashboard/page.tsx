
import { BookingsDataTable } from "@/components/admin/BookingsDataTable";
import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import type { Booking } from "@/lib/definitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogInIcon as ArrivalIcon, LogOutIcon as DepartureIcon, PlusCircleIcon as NewBookingIcon, Info, ListFilter, CalendarCheck2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getBookingsFromFirestore } from "@/lib/mock-db"; // Now fetches from Firestore

async function fetchBookings(): Promise<Booking[]> {
  console.log("[AdminDashboardPage] Fetching bookings from Firestore...");
  const bookings = await getBookingsFromFirestore();
  console.log(`[AdminDashboardPage] Fetched ${bookings.length} bookings.`);
  return bookings; // Already sorted by createdAt desc in getBookingsFromFirestore
}

async function getDashboardStats(bookings: Booking[]) {
  const today = new Date().setHours(0,0,0,0);

  const arrivalsToday = bookings.filter(b => {
    const checkInDate = b.checkInDate ? new Date(b.checkInDate).setHours(0,0,0,0) : null;
    return checkInDate === today && (b.status === "Confirmed" || b.status === "Pending Guest Information");
  }).length;

  const departuresToday = bookings.filter(b => {
    const checkOutDate = b.checkOutDate ? new Date(b.checkOutDate).setHours(0,0,0,0) : null;
    return checkOutDate === today && b.status === "Confirmed";
  }).length;
  
  const newBookingsToday = bookings.filter(b => {
    const createdAtDate = b.createdAt ? new Date(b.createdAt).setHours(0,0,0,0) : null;
    return createdAtDate === today;
  }).length;

  return {
    arrivalsToday,
    departuresToday,
    newBookingsToday,
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
  const bookings = await fetchBookings();
  const stats = await getDashboardStats(bookings);

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
          <CreateBookingDialog />
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
            value={`${stats.newBookingsToday > 0 ? '+' : ''}${stats.newBookingsToday}`}
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
          </CardHeader>
          <CardContent>
            {bookings.length > 0 ? (
                <BookingsDataTable data={bookings} />
            ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <CalendarCheck2 className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold">Keine Buchungen gefunden</h3>
                    <p className="text-muted-foreground">Momentan sind keine Buchungen vorhanden. Erstellen Sie eine neue Buchung.</p>
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
