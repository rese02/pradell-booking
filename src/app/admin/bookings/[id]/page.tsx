import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Edit3, Euro, FileText, Home, Mail, Phone, User, MessageSquare, Link2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Mock data fetching function - replace with actual data fetching
async function getBookingDetails(id: string): Promise<Booking | null> {
  await new Promise(resolve => setTimeout(resolve, 300)); // Simulate API delay
  const MOCK_BOOKINGS: Booking[] = [
    { 
      id: '1', 
      guestFirstName: 'Max', 
      guestLastName: 'Mustermann', 
      price: 150.75, 
      roomIdentifier: '101', 
      checkInDate: new Date('2024-09-15T14:00:00Z').toISOString(),
      checkOutDate: new Date('2024-09-20T11:00:00Z').toISOString(),
      bookingToken: 'abc123xyz', 
      status: 'Pending Guest Information', 
      createdAt: new Date('2024-08-01T10:00:00Z').toISOString(), 
      updatedAt: new Date('2024-08-01T10:00:00Z').toISOString() 
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
      createdAt: new Date('2024-08-15T12:30:00Z').toISOString(), 
      updatedAt: new Date('2024-08-18T15:00:00Z').toISOString(),
      guestSubmittedData: { 
        fullName: "Erika Musterfrau", 
        email: "erika@example.com", 
        phone: "0123-4567890",
        addressLine1: "Musterstraße 123",
        city: "Musterstadt",
        postalCode: "12345",
        country: "Deutschland",
        documentUrls: ["https://placehold.co/600x400.png?text=Ausweis-Vorderseite", "https://placehold.co/600x400.png?text=Ausweis-Rückseite"],
        specialRequests: "Bitte ein ruhiges Zimmer, wenn möglich mit Blick zum Garten. Anreise erfolgt spät.",
        submittedAt: new Date('2024-08-18T14:55:00Z')
      }
    },
  ];
  return MOCK_BOOKINGS.find(b => b.id === id) || null;
}

const formatDate = (dateString?: Date | string, includeTime = false) => {
  if (!dateString) return "N/A";
  try {
    const formatString = includeTime ? "dd. MMM yyyy, HH:mm 'Uhr'" : "dd. MMM yyyy";
    return format(new Date(dateString), formatString, { locale: de });
  } catch (error) {
    return "Ungültiges Datum";
  }
};

interface DetailItemProps {
  icon: React.ElementType;
  label: string;
  value?: string | number | null;
  isCurrency?: boolean;
  isLink?: boolean;
  isBadge?: boolean;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

const DetailItem: React.FC<DetailItemProps> = ({ icon: Icon, label, value, isCurrency, isLink, isBadge, badgeVariant }) => {
  if (value === null || typeof value === 'undefined' || value === "") return null;
  
  let displayValue: React.ReactNode = value;
  if (isCurrency && typeof value === 'number') {
    displayValue = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
  }
  if (isLink && typeof value === 'string') {
    displayValue = <Link href={value.startsWith('http') ? value : `mailto:${value}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{value}</Link>;
  }
  if (isBadge && typeof value === 'string') {
    displayValue = <Badge variant={badgeVariant || 'secondary'}>{value}</Badge>;
  }

  return (
    <div className="flex items-start space-x-3">
      <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-base font-medium">{displayValue}</p>
      </div>
    </div>
  );
};

export default async function BookingDetailsPage({ params }: { params: { id: string } }) {
  const booking = await getBookingDetails(params.id);

  if (!booking) {
    return (
      <div className="container mx-auto py-10 text-center">
        <h1 className="text-2xl font-semibold">Buchung nicht gefunden</h1>
        <p className="text-muted-foreground">Die angeforderte Buchung konnte nicht gefunden werden.</p>
        <Button asChild className="mt-4">
          <Link href="/admin/dashboard">Zurück zum Dashboard</Link>
        </Button>
      </div>
    );
  }

  const guestData = booking.guestSubmittedData;

  return (
    <div className="container mx-auto py-2">
      <div className="mb-6">
        <Button variant="outline" asChild className="mb-4">
            <Link href="/admin/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> Zurück zur Übersicht</Link>
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Buchungsdetails</h1>
            <p className="text-muted-foreground">ID: {booking.id}</p>
          </div>
          <Button variant="outline"><Edit3 className="mr-2 h-4 w-4" /> Buchung bearbeiten</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Hauptinformationen</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <DetailItem icon={User} label="Gast" value={`${booking.guestFirstName} ${booking.guestLastName}`} />
              <DetailItem icon={Euro} label="Preis" value={booking.price} isCurrency />
              <DetailItem icon={Home} label="Zimmer" value={booking.roomIdentifier} />
              <DetailItem icon={CalendarDays} label="Anreise" value={formatDate(booking.checkInDate)} />
              <DetailItem icon={CalendarDays} label="Abreise" value={formatDate(booking.checkOutDate)} />
              <DetailItem icon={User} label="Status" value={booking.status} isBadge 
                badgeVariant={
                  booking.status === "Confirmed" ? "default" :
                  booking.status === "Pending Guest Information" ? "secondary" :
                  booking.status === "Cancelled" ? "destructive" : "outline"
                }
              />
              <DetailItem icon={Link2} label="Gast-Link" value={typeof window !== 'undefined' ? `${window.location.origin}/buchung/${booking.bookingToken}` : `/buchung/${booking.bookingToken}`} isLink />
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground">
              Erstellt am: {formatDate(booking.createdAt, true)} | Letzte Aktualisierung: {formatDate(booking.updatedAt, true)}
            </CardFooter>
          </Card>

          {guestData && (
            <Card>
              <CardHeader>
                <CardTitle>Vom Gast übermittelte Daten</CardTitle>
                {guestData.submittedAt && <CardDescription>Übermittelt am: {formatDate(guestData.submittedAt, true)}</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-4">
                <h3 className="font-semibold text-lg">Persönliche Angaben</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                    <DetailItem icon={User} label="Vollständiger Name" value={guestData.fullName} />
                    <DetailItem icon={Mail} label="E-Mail" value={guestData.email} isLink />
                    <DetailItem icon={Phone} label="Telefon" value={guestData.phone} />
                    <DetailItem icon={Home} label="Adresse" value={`${guestData.addressLine1}${guestData.addressLine2 ? ', ' + guestData.addressLine2 : ''}, ${guestData.postalCode} ${guestData.city}, ${guestData.country}`} />
                </div>
                <Separator />
                <h3 className="font-semibold text-lg">Sonderwünsche</h3>
                {guestData.specialRequests ? (
                    <DetailItem icon={MessageSquare} label="Nachricht" value={guestData.specialRequests} />
                ) : (
                    <p className="text-sm text-muted-foreground">Keine Sonderwünsche angegeben.</p>
                )}
                
                {guestData.documentUrls && guestData.documentUrls.length > 0 && (
                  <>
                    <Separator />
                    <h3 className="font-semibold text-lg">Hochgeladene Dokumente</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {guestData.documentUrls.map((url, index) => (
                        <div key={index} className="rounded-md overflow-hidden border aspect-video relative">
                          <Image 
                            src={url} 
                            alt={`Dokument ${index + 1}`} 
                            layout="fill" 
                            objectFit="cover" 
                            data-ai-hint="identification document"
                          />
                           <Button asChild size="sm" className="absolute bottom-2 right-2 opacity-80 hover:opacity-100">
                                <Link href={url} target="_blank" rel="noopener noreferrer">
                                    <FileText className="mr-1 h-3 w-3"/>Ansehen
                                </Link>
                            </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-1 h-fit sticky top-20"> {/* Activity/Notes section */}
            <CardHeader>
                <CardTitle>Notizen & Verlauf</CardTitle>
                <CardDescription>Interne Notizen und Buchungsverlauf.</CardDescription>
            </CardHeader>
            <CardContent>
                {/* Placeholder for notes and activity feed */}
                <p className="text-sm text-muted-foreground">Feature in Kürze verfügbar.</p>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
