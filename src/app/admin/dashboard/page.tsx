
import { BookingsDataTable } from "@/components/admin/BookingsDataTable";
import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import type { Booking } from "@/lib/definitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogInIcon as ArrivalIcon, LogOutIcon as DepartureIcon, PlusCircleIcon as NewBookingIcon, Info, ListFilter, CalendarCheck2, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getBookingsFromFirestore } from "@/lib/mock-db";

async function fetchBookings(): Promise<Booking[]> {
  const operationName = "[AdminDashboardPage fetchBookings]";
  console.log(`${operationName} Fetching bookings...`);
  try {
    // This function will now throw an error if Firestore is not initialized or if fetching fails
    const bookings = await getBookingsFromFirestore();
    console.log(`${operationName} Fetched ${bookings.length} bookings.`);
    return bookings;
  } catch (error) {
    console.error(`${operationName} Error in fetchBookings:`, error);
    // Re-throw the error to be caught by the page component
    throw error;
  }
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
  let bookings: Booking[] = [];
  let stats = { arrivalsToday: 0, departuresToday: 0, newBookingsToday: 0 };
  let fetchError: string | null = null;

  try {
    console.log("[AdminDashboardPage] Attempting to fetch bookings and calculate stats...");
    bookings = await fetchBookings();
    stats = await getDashboardStats(bookings);
    console.log("[AdminDashboardPage] Successfully fetched bookings and calculated stats.");
  } catch (error: any) {
    console.error("[AdminDashboardPage] Critical error fetching data for dashboard:", error.message, error.stack?.substring(0,500));
    if (error.message.includes("FATAL: Firestore is not initialized")) {
        fetchError = `Fehler beim Laden der Buchungsdaten: Die Verbindung zur Firestore-Datenbank konnte nicht hergestellt werden.
                      Ursache: ${error.message}. Bitte stellen Sie sicher, dass Firebase korrekt konfiguriert ist (insbesondere die .env.local Datei und die Projekt-ID)
                      und dass die Firestore-Dienste (Firestore Database und Cloud Firestore API) in der Firebase/Google Cloud Konsole für Ihr Projekt aktiviert und eine Datenbank-Instanz erstellt wurde.
                      Überprüfen Sie die Server-Logs für detaillierte Initialisierungs-Informationen.`;
    } else if (error.message.includes("Missing or insufficient permissions")) {
        fetchError = `Fehler beim Laden der Buchungsdaten: Fehlende oder unzureichende Berechtigungen für Firestore.
                      Bitte überprüfen Sie Ihre Firebase Firestore Sicherheitsregeln in der Firebase Konsole.
                      Stellen Sie sicher, dass Lesezugriff für die 'bookings'-Collection erlaubt ist. (Fehlermeldung: ${error.message})`;
    } else if (error.message.includes("Query requires an index")) {
        fetchError = `Fehler beim Laden der Buchungsdaten: Eine benötigte Index-Konfiguration für Firestore fehlt.
                      Bitte überprüfen Sie die Firebase Konsole (Firestore > Indizes). Firestore könnte dort vorschlagen, den Index zu erstellen.
                      (Fehlermeldung: ${error.message})`;
    }
     else {
        fetchError = `Unbekannter Fehler beim Laden der Buchungsdaten: ${error.message}. Bitte überprüfen Sie die Server-Konfiguration und -Logs.`;
    }
  }

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

        {fetchError && (
          <Card className="mb-6 bg-destructive/10 border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center">
                <AlertTriangle className="mr-2 h-5 w-5" />
                Fehler beim Laden der Daten
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-destructive-foreground">{fetchError}</p>
              <p className="text-xs text-muted-foreground mt-2">Bitte überprüfen Sie die Server-Logs für weitere Details und stellen Sie sicher, dass Ihre Firebase-Konfiguration (insbesondere `.env.local` und die Dienste in der Firebase/Google Cloud Konsole) sowie Ihre Firestore Sicherheitsregeln korrekt sind.</p>
            </CardContent>
          </Card>
        )}

        {!fetchError && (
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
        )}

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
            {fetchError && !bookings.length ? (
                 <div className="flex flex-col items-center justify-center py-12 text-center">
                    <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
                    <h3 className="text-xl font-semibold text-destructive">Daten konnten nicht geladen werden</h3>
                    <p className="text-muted-foreground">Überprüfen Sie die Fehlermeldung oben und die Server-Logs für Details.</p>
                </div>
            ) : bookings.length > 0 ? (
                <BookingsDataTable data={bookings} />
            ) : (
                 !fetchError && bookings.length === 0 ? ( // Only show "No bookings" if there was no fetch error
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <CalendarCheck2 className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-xl font-semibold">Keine Buchungen gefunden</h3>
                        <p className="text-muted-foreground">Momentan sind keine Buchungen vorhanden. Erstellen Sie eine neue Buchung.</p>
                        <div className="mt-6">
                             <CreateBookingDialog />
                        </div>
                    </div>
                 ) : null // If fetchError and no bookings, the error message above is already shown
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

    