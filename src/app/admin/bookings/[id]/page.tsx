

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Booking } from "@/lib/definitions";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Edit3, Euro, FileText, Home, Mail, Phone, User, MessageSquare, Link2, Users, Landmark, ShieldCheck, Briefcase, BookUser } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { findMockBookingById } from "@/lib/mock-db";
import { notFound } from "next/navigation";


async function getBookingDetails(id: string): Promise<Booking | null> {
  console.log(`[Page admin/bookings/[id]] Attempting to fetch booking details for id: "${id}"`);
  const booking = findMockBookingById(id);
  if (!booking) {
    console.warn(`[Page admin/bookings/[id]] Booking with id ${id} not found.`);
  } else {
    // Log guestSubmittedData carefully to avoid overly verbose logs if it's large
    const guestDataSummary = booking.guestSubmittedData 
        ? { submitted: true, lastStep: booking.guestSubmittedData.lastCompletedStep, hasEmail: !!booking.guestSubmittedData.email } 
        : { submitted: false };
    console.log(`[Page admin/bookings/[id]] Found booking for id ${id}. Guest Data Summary:`, guestDataSummary);
  }
  return booking || null;
}

const formatDate = (dateString?: Date | string, includeTime = false) => {
  if (!dateString) return "N/A";
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    const formatString = includeTime ? "dd. MMM yyyy, HH:mm 'Uhr'" : "dd. MMM yyyy";
    return format(date, formatString, { locale: de });
  } catch (error) {
    return "Ungültiges Datum";
  }
};

const formatCurrency = (amount?: number) => {
    if (typeof amount !== 'number') return "N/A";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};

interface DetailItemProps {
  icon: React.ElementType;
  label: string;
  value?: string | number | null | boolean;
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
  
  if (value === null || typeof value === 'undefined' || value === "") {
     if (typeof value === 'boolean' && value === false) {
        // Allow 'false' boolean to be displayed as "Nein" or similar if needed
     } else {
        return null;
     }
  }
  
  let displayValue: React.ReactNode = value;
  if (typeof value === 'boolean') {
    displayValue = value ? "Ja" : "Nein";
  } else if (isCurrency && typeof value === 'number') {
    displayValue = formatCurrency(value);
  } else if (isLink && typeof value === 'string') {
    displayValue = <Link href={value.startsWith('http') ? value : (value.includes('@') ? `mailto:${value}` : value)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{value}</Link>;
  } else if (isBadge && typeof value === 'string') {
    displayValue = <Badge variant={badgeVariant || 'secondary'}>{value}</Badge>;
  }


  return (
    <div className="flex items-start space-x-3">
      <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="text-base font-medium">{displayValue}</div>
      </div>
    </div>
  );
};

export default async function BookingDetailsPage({ params }: { params: { id: string } }) {
  const booking = await getBookingDetails(params.id);

  if (!booking) {
    console.error(`[Server BookingDetailsPage] Booking not found for id "${params.id}" (getBookingDetails returned null). Calling notFound().`);
    notFound();
  }
  
  console.log(`[Server BookingDetailsPage] Booking data for id "${params.id}": Status: ${booking.status}, Guest: ${booking.guestFirstName}`);

  const guestData = booking.guestSubmittedData;
  const guestPortalLink = `/buchung/${booking.bookingToken}`;


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
              <DetailItem icon={User} label="Gast (Initial)" value={`${booking.guestFirstName} ${booking.guestLastName}`} />
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
              <DetailItem icon={Users} label="Erwachsene" value={booking.erwachsene?.toString()} />
              {typeof booking.kinder === 'number' && <DetailItem icon={Users} label="Kinder (3+)" value={booking.kinder.toString()} />}
              {typeof booking.kleinkinder === 'number' && <DetailItem icon={Users} label="Kleinkinder (0-2 J.)" value={booking.kleinkinder.toString()} />}
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
                <CardTitle>Interne Bemerkungen (Hotel)</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailItem icon={MessageSquare} label="Bemerkung" value={booking.interneBemerkungen} />
              </CardContent>
            </Card>
          )}


          {guestData && (guestData.gastVorname || guestData.email) && ( 
            <Card>
              <CardHeader>
                <CardTitle>Vom Gast übermittelte Daten</CardTitle>
                {guestData.submittedAt && <CardDescription>Übermittelt am: {formatDate(guestData.submittedAt, true)} (Letzter Schritt: {guestData.lastCompletedStep})</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-4">
                <h3 className="font-semibold text-lg flex items-center"><UserCircle className="mr-2 h-5 w-5 text-muted-foreground" /> Stammdaten Hauptgast</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                    <DetailItem icon={User} label="Anrede" value={guestData.anrede} />
                    <DetailItem icon={User} label="Vollständiger Name" value={`${guestData.gastVorname || ''} ${guestData.gastNachname || ''}`} />
                    <DetailItem icon={CalendarDays} label="Geburtsdatum" value={formatDate(guestData.geburtsdatum)} />
                    <DetailItem icon={Mail} label="E-Mail" value={guestData.email} isLink />
                    <DetailItem icon={Phone} label="Telefon" value={guestData.telefon} />
                </div>
                
                {(guestData.hauptgastDokumenttyp || guestData.hauptgastAusweisVorderseiteUrl || guestData.hauptgastAusweisRückseiteUrl) && (
                  <>
                    <Separator />
                    <h3 className="font-semibold text-lg mt-4 flex items-center"><BookUser className="mr-2 h-5 w-5 text-muted-foreground" /> Ausweisdokument Hauptgast</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <DetailItem icon={Briefcase} label="Dokumenttyp" value={guestData.hauptgastDokumenttyp} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                      {guestData.hauptgastAusweisVorderseiteUrl && (
                        <div className="rounded-md overflow-hidden border aspect-video relative">
                          <Image 
                            src={guestData.hauptgastAusweisVorderseiteUrl} 
                            alt="Ausweis Vorderseite" 
                            fill={true}
                            style={{objectFit: "cover"}}
                            data-ai-hint="identification document"
                          />
                           <Button asChild size="sm" className="absolute bottom-2 right-2 opacity-80 hover:opacity-100">
                                <Link href={guestData.hauptgastAusweisVorderseiteUrl} target="_blank" rel="noopener noreferrer">
                                    <FileText className="mr-1 h-3 w-3"/>Ansehen
                                </Link>
                            </Button>
                        </div>
                      )}
                      {guestData.hauptgastAusweisRückseiteUrl && (
                        <div className="rounded-md overflow-hidden border aspect-video relative">
                          <Image 
                            src={guestData.hauptgastAusweisRückseiteUrl} 
                            alt="Ausweis Rückseite" 
                            fill={true}
                            style={{objectFit: "cover"}}
                            data-ai-hint="identification document"
                          />
                           <Button asChild size="sm" className="absolute bottom-2 right-2 opacity-80 hover:opacity-100">
                                <Link href={guestData.hauptgastAusweisRückseiteUrl} target="_blank" rel="noopener noreferrer">
                                    <FileText className="mr-1 h-3 w-3"/>Ansehen
                                </Link>
                            </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {(guestData.zahlungsart || guestData.zahlungsbelegUrl) && (
                    <>
                        <Separator />
                        <h3 className="font-semibold text-lg mt-4 flex items-center"><CreditCard className="mr-2 h-5 w-5 text-muted-foreground" /> Zahlungsinformationen</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <DetailItem icon={Landmark} label="Zahlungsart" value={guestData.zahlungsart} />
                            <DetailItem icon={Euro} label="Anzahlung (30%)" value={guestData.zahlungsbetrag} isCurrency/>
                            <DetailItem icon={CalendarDays} label="Zahlungsdatum" value={formatDate(guestData.zahlungsdatum)} />
                        </div>
                        {guestData.zahlungsbelegUrl && (
                             <div className="mt-2">
                                <p className="text-sm font-medium mb-1">Zahlungsbeleg:</p>
                                <Button asChild variant="outline" size="sm">
                                    <Link href={guestData.zahlungsbelegUrl} target="_blank" rel="noopener noreferrer">
                                        <FileText className="mr-2 h-4 w-4"/>Beleg ansehen
                                    </Link>
                                </Button>
                            </div>
                        )}
                    </>
                )}
                
                {guestData.specialRequests && ( // Dieses Feld wird aktuell im neuen Flow nicht erfasst
                  <>
                    <Separator />
                    <h3 className="font-semibold text-lg mt-4">Sonderwünsche (Alt)</h3>
                    <DetailItem icon={MessageSquare} label="Nachricht" value={guestData.specialRequests} />
                  </>
                )}

                {(guestData.agbAkzeptiert !== undefined || guestData.datenschutzAkzeptiert !== undefined) && (
                    <>
                        <Separator />
                        <h3 className="font-semibold text-lg mt-4 flex items-center"><ShieldCheck className="mr-2 h-5 w-5 text-muted-foreground" /> Zustimmungen</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                           <DetailItem icon={ShieldCheck} label="AGB akzeptiert" value={guestData.agbAkzeptiert} />
                           <DetailItem icon={ShieldCheck} label="Datenschutz zugestimmt" value={guestData.datenschutzAkzeptiert} />
                        </div>
                    </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-1 h-fit sticky top-20">
            <CardHeader>
                <CardTitle>Notizen & Verlauf</CardTitle>
                <CardDescription>Interne Notizen und Buchungsverlauf.</CardDescription>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground">Feature in Kürze verfügbar.</p>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
