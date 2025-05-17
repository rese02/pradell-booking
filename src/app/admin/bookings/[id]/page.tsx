
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Booking } from "@/lib/definitions";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Edit3, Euro, FileText, Home, Mail, Phone, User, MessageSquare, Link2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { findMockBookingById } from "@/lib/mock-db";
import { notFound } from "next/navigation";


async function getBookingDetails(id: string): Promise<Booking | null> {
  console.log(`[Page admin/bookings/[id]] Attempting to fetch booking details for id: "${id}"`);
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate API delay
  const booking = findMockBookingById(id);
  if (!booking) {
    console.warn(`[Page admin/bookings/[id]] Booking with id ${id} not found.`);
  } else {
    console.log(`[Page admin/bookings/[id]] Found booking for id ${id}:`, booking);
  }
  return booking || null;
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
  children?: React.ReactNode;
}

const DetailItem: React.FC<DetailItemProps> = ({ icon: Icon, label, value, isCurrency, isLink, isBadge, badgeVariant, children }) => {
  if (children) {
    return (
      <div className="flex items-start space-x-3">
        <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="text-base font-medium">{children}</div>
        </div>
      </div>
    )
  }
  
  if (value === null || typeof value === 'undefined' || value === "") return null;
  
  let displayValue: React.ReactNode = value;
  if (isCurrency && typeof value === 'number') {
    displayValue = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
  }
  if (isLink && typeof value === 'string') {
    displayValue = <Link href={value.startsWith('http') ? value : (value.includes('@') ? `mailto:${value}` : value)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{value}</Link>;
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
    notFound();
  }

  const guestData = booking.guestSubmittedData;
  const guestPortalLink = typeof window !== 'undefined' ? `${window.location.origin}/buchung/${booking.bookingToken}` : `/buchung/${booking.bookingToken}`;

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
              <DetailItem icon={User} label="Erwachsene" value={booking.erwachsene?.toString()} />
              {typeof booking.kinder === 'number' && <DetailItem icon={User} label="Kinder (3+)" value={booking.kinder.toString()} />}
              {typeof booking.kleinkinder === 'number' && <DetailItem icon={User} label="Kleinkinder (0-2 J.)" value={booking.kleinkinder.toString()} />}
              {booking.alterKinder && <DetailItem icon={User} label="Alter Kinder" value={booking.alterKinder} />}
              <DetailItem icon={Home} label="Verpflegung" value={booking.verpflegung} />
              <DetailItem icon={Link2} label="Gast-Link" value={guestPortalLink} isLink />
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground flex-wrap">
              <span>Erstellt am: {formatDate(booking.createdAt, true)}</span>
              <span className="mx-1">|</span>
              <span>Letzte Aktualisierung: {formatDate(booking.updatedAt, true)}</span>
            </CardFooter>
          </Card>

          {booking.interneBemerkungen && (
            <Card>
              <CardHeader>
                <CardTitle>Interne Bemerkungen</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailItem icon={MessageSquare} label="Bemerkung" value={booking.interneBemerkungen} />
              </CardContent>
            </Card>
          )}


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
                    <DetailItem icon={Home} label="Adresse">
                      {guestData.addressLine1}{guestData.addressLine2 ? `, ${guestData.addressLine2}` : ''}<br/>
                      {guestData.postalCode} {guestData.city}<br/>
                      {guestData.country}
                    </DetailItem>
                </div>
                
                {guestData.specialRequests && (
                  <>
                    <Separator />
                    <h3 className="font-semibold text-lg">Sonderwünsche</h3>
                    <DetailItem icon={MessageSquare} label="Nachricht" value={guestData.specialRequests} />
                  </>
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
                            fill={true}
                            style={{objectFit: "cover"}}
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
