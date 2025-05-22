
import { BookingsDataTable } from "@/components/admin/BookingsDataTable";
import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import type { Booking } from "@/lib/definitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogInIcon as ArrivalIcon, LogOutIcon as DepartureIcon, PlusCircleIcon as NewBookingIcon, Info, ListFilter, CalendarCheck2, AlertTriangle, Users, Briefcase, BarChart3 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getBookingsFromFirestore } from "@/lib/mock-db"; 
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

async function fetchBookings(): Promise<Booking[]> {
  const operationName = "[AdminDashboardPage fetchBookings]";
  console.log(`${operationName} Fetching bookings...`);
  try {
    const bookings = await getBookingsFromFirestore();
    console.log(`${operationName} Fetched ${bookings.length} bookings.`);
    return bookings;
  } catch (error) {
    console.error(`${operationName} Error in fetchBookings:`, error);
    throw error; // Re-throw to be caught by the page component
  }
}

async function getDashboardStats(bookings: Booking[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingCheckIns = bookings.filter(b => {
    const checkInDate = b.checkInDate ? new Date(b.checkInDate) : null;
    return checkInDate && checkInDate >= today && (b.status === "Confirmed" || b.status === "Pending Guest Information");
  }).length;

  const guestsInHouse = bookings.filter(b => {
    const checkInDate = b.checkInDate ? new Date(b.checkInDate) : null;
    const checkOutDate = b.checkOutDate ? new Date(b.checkOutDate) : null;
    return checkInDate && checkOutDate && checkInDate <= today && checkOutDate > today && b.status === "Confirmed";
  }).length;

  const totalConfirmedBookings = bookings.filter(b => b.status === "Confirmed").length;
  
  const totalPendingBookings = bookings.filter(b => b.status === "Pending Guest Information").length;

  return {
    upcomingCheckIns,
    guestsInHouse,
    totalConfirmedBookings,
    totalPendingBookings,
  };
}

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ElementType;
  description: string;
  tooltipText?: string;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, description, tooltipText, className }) => {
  return (
    <Card className={cn("card-modern p-1", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {tooltipText && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 hover:opacity-100">
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{tooltipText}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex items-center space-x-3">
            <div className="p-3 rounded-lg bg-primary/10">
                <Icon className="h-6 w-6 text-primary" />
            </div>
            <div className="text-3xl font-bold text-foreground">{value}</div>
        </div>
        <p className="text-xs text-muted-foreground pt-2">{description}</p>
      </CardContent>
    </Card>
  );
};

export default async function AdminDashboardPage() {
  let bookings: Booking[] = [];
  let stats = { upcomingCheckIns: 0, guestsInHouse: 0, totalConfirmedBookings: 0, totalPendingBookings: 0 };
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
                      Überprüfen Sie die Server-Logs für detaillierte Initialisierungs-Informationen. (Code: ADP-FNI)`;
    } else if (error.message.toLowerCase().includes("missing or insufficient permissions")) {
        fetchError = `Fehler beim Laden der Buchungsdaten: Fehlende oder unzureichende Berechtigungen für Firestore.
                      Bitte überprüfen Sie Ihre Firebase Firestore Sicherheitsregeln in der Firebase Konsole.
                      Stellen Sie sicher, dass Lesezugriff für die 'bookings'-Collection erlaubt ist. (Fehlermeldung: ${error.message}) (Code: ADP-FPERM)`;
    } else if (error.message.toLowerCase().includes("query requires an index")) {
        fetchError = `Fehler beim Laden der Buchungsdaten: Eine benötigte Index-Konfiguration für Firestore fehlt.
                      Bitte überprüfen Sie die Firebase Konsole (Firestore > Indizes). Firestore könnte dort vorschlagen, den Index zu erstellen.
                      (Fehlermeldung: ${error.message}) (Code: ADP-FINDE)`;
    }
     else {
        fetchError = `Unbekannter Fehler beim Laden der Buchungsdaten: ${error.message}. Bitte überprüfen Sie die Server-Konfiguration und -Logs. (Code: ADP-UNK)`;
    }
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto py-4 px-2 sm:px-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">Admin Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Übersicht und Verwaltung Ihrer Hotelbuchungen.
            </p>
          </div>
          <CreateBookingDialog />
        </div>

        {fetchError && (
          <Card className="mb-8 bg-destructive/10 border-destructive card-modern">
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <StatCard
              title="Anstehende Check-Ins"
              value={stats.upcomingCheckIns}
              icon={ArrivalIcon}
              description="Geplante Ankünfte"
              tooltipText="Anzahl der Buchungen mit heutigem oder zukünftigem Check-In-Datum (Status: Confirmed oder Pending Guest Information)."
              className="bg-card"
            />
            <StatCard
              title="Gäste im Haus"
              value={stats.guestsInHouse}
              icon={Users}
              description="Aktuell eingecheckte Gäste"
              tooltipText="Anzahl der Buchungen, deren Aufenthalt heute stattfindet (Status: Confirmed)."
              className="bg-card"
            />
            <StatCard
              title="Bestätigte Buchungen"
              value={stats.totalConfirmedBookings}
              icon={CalendarCheck2}
              description="Insgesamt bestätigt"
              tooltipText="Gesamtzahl aller Buchungen mit dem Status 'Confirmed'."
              className="bg-card"
            />
             <StatCard
              title="Ausstehende Infos"
              value={stats.totalPendingBookings}
              icon={AlertTriangle} 
              description="Warten auf Gastdaten"
              tooltipText="Gesamtzahl aller Buchungen mit dem Status 'Pending Guest Information'."
              className="bg-yellow-500/10 border-yellow-500/50" 
            />
          </div>
        )}

        <Card className="card-modern">
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-5">
            <div>
              <CardTitle className="text-xl font-semibold">Buchungsübersicht</CardTitle>
              <CardDescription className="mt-1">
                Details ansehen und Buchungen verwalten.
              </CardDescription>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="p-0 sm:p-2 md:p-4">
            {fetchError && !bookings.length ? (
                 <div className="flex flex-col items-center justify-center py-16 text-center">
                    <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
                    <h3 className="text-xl font-semibold text-destructive">Daten konnten nicht geladen werden</h3>
                    <p className="text-muted-foreground max-w-md">{fetchError}</p>
                </div>
            ) : bookings.length > 0 ? (
                <BookingsDataTable data={bookings} />
            ) : (
                 !fetchError && bookings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <CalendarCheck2 className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-xl font-semibold">Keine Buchungen gefunden</h3>
                        <p className="text-muted-foreground">Momentan sind keine Buchungen vorhanden. Erstellen Sie eine neue Buchung.</p>
                        <div className="mt-6">
                             <CreateBookingDialog />
                        </div>
                    </div>
                 ) : null 
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

    