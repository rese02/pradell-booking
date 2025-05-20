
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Booking, RoomDetail } from "@/lib/definitions";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Edit3, Euro, FileText, Home, Mail, Phone, User, MessageSquare, Link2, Users, Landmark, ShieldCheck, Briefcase, BookUser, UserCircle, CreditCard, FileIcon, Image as ImageIcon, Users2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import NextImage from "next/image"; 
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { findBookingByIdFromFirestore } from "@/lib/mock-db";
import { notFound } from "next/navigation";

async function getBookingDetails(id: string): Promise<Booking | null> {
  console.log(`[Page admin/bookings/[id]] Attempting to fetch booking details from Firestore for id: "${id}"`);
  try {
    const booking = await findBookingByIdFromFirestore(id);
    if (!booking) {
      console.warn(`[Page admin/bookings/[id]] Booking with id ${id} not found in Firestore.`);
    } else {
      const guestDataSummary = booking.guestSubmittedData
        ? { submitted: !!booking.guestSubmittedData.submittedAt, lastStep: booking.guestSubmittedData.lastCompletedStep, hasEmail: !!booking.guestSubmittedData.email }
        : { submitted: false };
      console.log(`[Page admin/bookings/[id]] Found booking for id ${id} from Firestore. Guest Data Summary:`, guestDataSummary);
    }
    return booking;
  } catch (error) {
    console.error(`[Page admin/bookings/[id]] Error fetching booking ${id}:`, error);
    return null;
  }
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
  isDocumentUrl?: boolean;
  documentHint?: string;
}

const DetailItem: React.FC<DetailItemProps> = ({ icon: Icon, label, value, isCurrency, isLink, isBadge, badgeVariant, children, isDocumentUrl, documentHint }) => {
  let displayValue: React.ReactNode = value;

  if (children) {
    return (
      <div className="flex items-start space-x-3 py-1">
        <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="text-base font-medium">{children}</div>
        </div>
      </div>
    )
  }
  
  // Handle null, undefined, or empty string for value, unless it's a boolean `false`
  if (value === null || typeof value === 'undefined' || value === "") {
    if (typeof value === 'boolean' && value === false) {
      // Allow 'false' boolean to be displayed as "Nein"
    } else {
      return null; // Don't render the item if value is effectively empty
    }
  }


  if (typeof value === 'boolean') {
    displayValue = value ? "Ja" : "Nein";
  } else if (isCurrency && typeof value === 'number') {
    displayValue = formatCurrency(value);
  } else if (isDocumentUrl && typeof value === 'string' && value.startsWith('https://firebasestorage.googleapis.com')) {
    let fileNameFromUrl = 'Datei';
    try {
        const decodedUrl = decodeURIComponent(value);
        const pathSegments = new URL(decodedUrl).pathname.split('/');
        const lastSegmentEncoded = pathSegments.pop()?.split('?')[0]; 
        if (lastSegmentEncoded) {
             fileNameFromUrl = lastSegmentEncoded.substring(lastSegmentEncoded.indexOf('_') + 1) || lastSegmentEncoded;
        }
    } catch (e) { console.error("Error parsing filename from Firebase URL", e); }

    const isImage = /\.(jpeg|jpg|gif|png|webp)(\?|$)/i.test(value) || value.includes('image%2Fjpeg') || value.includes('image%2Fpng') || value.includes('image%2Fgif') || value.includes('image%2Fwebp');
    const isPdf = /\.pdf(\?|$)/i.test(value) || value.includes('application%2Fpdf');

    if (isImage) {
        displayValue = (
            <div className="flex flex-col gap-2 mt-1">
                <NextImage src={value} alt={label || 'Hochgeladenes Bild'} width={200} height={100} className="rounded-md border object-contain" data-ai-hint={documentHint || "document image"}/>
                <Button asChild variant="outline" size="sm" className="w-fit">
                    <Link href={value} target="_blank" rel="noopener noreferrer">
                        <ImageIcon className="mr-2 h-4 w-4" /> Bild ansehen ({fileNameFromUrl})
                    </Link>
                </Button>
            </div>
        );
    } else if (isPdf) {
         displayValue = (
            <div className="flex items-center gap-2 mt-1">
                <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <Link href={value} target="_blank" rel="noopener noreferrer" title={`PDF ansehen: ${fileNameFromUrl}`} className="text-primary hover:underline text-sm font-medium truncate max-w-xs">
                    {fileNameFromUrl}
                </Link>
            </div>
        );
    } else {
         displayValue = (
            <div className="flex items-center gap-2 mt-1">
                <FileIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                 <Link href={value} target="_blank" rel="noopener noreferrer" title={`Datei ansehen: ${fileNameFromUrl}`} className="text-primary hover:underline text-sm font-medium truncate max-w-xs">
                    {fileNameFromUrl}
                </Link>
            </div>
        );
    }
  } else if (isLink && typeof value === 'string') {
    displayValue = <Link href={value.startsWith('http') ? value : (value.includes('@') ? `mailto:${value}` : value)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{value}</Link>;
  } else if (isBadge && typeof value === 'string') {
    displayValue = <Badge variant={badgeVariant || 'secondary'}>{value}</Badge>;
  }

  return (
    <div className="flex items-start space-x-3 py-1">
      <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="text-base font-medium">{displayValue}</div>
      </div>
    </div>
  );
};

const RoomDetailsCard: React.FC<{ rooms: RoomDetail[] }> = ({ rooms }) => {
  if (!rooms || rooms.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Zimmerdetails</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rooms.map((room, index) => (
          <div key={index} className="p-3 border rounded-md bg-muted/20 shadow-sm">
            <h4 className="font-semibold text-md mb-2">Zimmer {index + 1}: {room.zimmertyp}</h4>
            <div className="grid sm:grid-cols-2 gap-2 text-sm">
              <p><strong>Erwachsene:</strong> {room.erwachsene}</p>
              {typeof room.kinder === 'number' && <p><strong>Kinder (3+):</strong> {room.kinder}</p>}
              {typeof room.kleinkinder === 'number' && <p><strong>Kleinkinder (0-2 J.):</strong> {room.kleinkinder}</p>}
              {room.alterKinder && <p><strong>Alter Kinder:</strong> {room.alterKinder}</p>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
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
    <div className="container mx-auto py-4">
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
              <CardTitle>Hauptinformationen (vom Hotel)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-y-2 gap-x-4 sm:grid-cols-2">
              <DetailItem icon={User} label="Gast (Initial)" value={`${booking.guestFirstName} ${booking.guestLastName}`} />
              <DetailItem icon={Euro} label="Preis" value={booking.price} isCurrency />
              <DetailItem icon={Home} label="Zimmerübersicht (Initial)" value={booking.roomIdentifier} />
              <DetailItem icon={CalendarDays} label="Anreise" value={formatDate(booking.checkInDate)} />
              <DetailItem icon={CalendarDays} label="Abreise" value={formatDate(booking.checkOutDate)} />
              <DetailItem icon={User} label="Status" value={booking.status} isBadge
                badgeVariant={
                  booking.status === "Confirmed" ? "default" :
                    booking.status === "Pending Guest Information" ? "secondary" :
                      booking.status === "Cancelled" ? "destructive" : "outline"
                }
              />
              <DetailItem icon={Briefcase} label="Verpflegung" value={booking.verpflegung} />
              <DetailItem icon={Link2} label="Gast-Link" value={guestPortalLink} isLink />
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground flex-wrap gap-x-2 gap-y-1">
              <span>Erstellt am: {formatDate(booking.createdAt, true)}</span>
              <span className="hidden sm:inline">|</span>
              <span>Letzte Aktualisierung: {formatDate(booking.updatedAt, true)}</span>
            </CardFooter>
          </Card>

          {booking.rooms && booking.rooms.length > 0 && (
            <RoomDetailsCard rooms={booking.rooms} />
          )}

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

          {guestData && (guestData.gastVorname || guestData.email || guestData.hauptgastAusweisVorderseiteUrl || guestData.zahlungsbelegUrl || guestData.submittedAt) && (
            <Card>
              <CardHeader>
                <CardTitle>Vom Gast übermittelte Daten</CardTitle>
                {guestData.submittedAt && <CardDescription>Übermittelt am: {formatDate(guestData.submittedAt, true)} (Letzter Schritt: {guestData.lastCompletedStep !== undefined ? guestData.lastCompletedStep + 1 : 'N/A'})</CardDescription>}
                {!guestData.submittedAt && booking.status === "Pending Guest Information" && <CardDescription>Gast hat das Formular noch nicht abgeschlossen.</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-4">
                
                <h3 className="font-semibold text-lg flex items-center"><UserCircle className="mr-2 h-5 w-5 text-primary" /> Stammdaten Hauptgast</h3>
                <div className="grid gap-y-2 gap-x-4 sm:grid-cols-2">
                  <DetailItem icon={User} label="Anrede" value={guestData.anrede} />
                  <DetailItem icon={User} label="Vollständiger Name" value={`${guestData.gastVorname || ''} ${guestData.gastNachname || ''}`} />
                  <DetailItem icon={CalendarDays} label="Geburtsdatum" value={formatDate(guestData.geburtsdatum)} />
                  <DetailItem icon={User} label="Alter" value={guestData.alterHauptgast ? `${guestData.alterHauptgast} Jahre` : undefined} />
                  <DetailItem icon={Mail} label="E-Mail" value={guestData.email} isLink />
                  <DetailItem icon={Phone} label="Telefon" value={guestData.telefon} />
                </div>

                {(guestData.hauptgastAusweisVorderseiteUrl || guestData.hauptgastAusweisRückseiteUrl) && (
                  <>
                    <Separator className="my-4" />
                    <h3 className="font-semibold text-lg flex items-center"><BookUser className="mr-2 h-5 w-5 text-primary" /> Ausweisdokument Hauptgast</h3>
                    <div className="grid gap-y-2 gap-x-4 sm:grid-cols-2">
                      {/* <DetailItem icon={FileText} label="Dokumenttyp" value={guestData.hauptgastDokumenttyp} /> remove if not used */}
                      <DetailItem icon={ImageIcon} label="Vorderseite" value={guestData.hauptgastAusweisVorderseiteUrl} isDocumentUrl documentHint="identification front" />
                      <DetailItem icon={ImageIcon} label="Rückseite" value={guestData.hauptgastAusweisRückseiteUrl} isDocumentUrl documentHint="identification back" />
                    </div>
                  </>
                )}

                {guestData.mitreisende && guestData.mitreisende.length > 0 && (
                    <>
                        <Separator className="my-4" />
                        <h3 className="font-semibold text-lg flex items-center"><Users2 className="mr-2 h-5 w-5 text-primary" /> Mitreisende</h3>
                        {guestData.mitreisende.map((mitreisender, index) => (
                            <div key={mitreisender.id || index} className="p-3 border rounded-md bg-muted/20 mt-2 space-y-2 shadow-sm">
                                <h4 className="font-medium text-md">Mitreisender {index + 1}: {mitreisender.vorname} {mitreisender.nachname}</h4>
                                <DetailItem icon={ImageIcon} label="Ausweis Vorderseite" value={mitreisender.ausweisVorderseiteUrl} isDocumentUrl documentHint="companion identification front"/>
                                <DetailItem icon={ImageIcon} label="Ausweis Rückseite" value={mitreisender.ausweisRückseiteUrl} isDocumentUrl documentHint="companion identification back"/>
                            </div>
                        ))}
                    </>
                )}
                
                {(guestData.paymentAmountSelection || guestData.zahlungsart || guestData.zahlungsbelegUrl) && (
                  <>
                    <Separator className="my-4" />
                    <h3 className="font-semibold text-lg flex items-center"><CreditCard className="mr-2 h-5 w-5 text-primary" /> Zahlungsinformationen</h3>
                    <div className="grid gap-y-2 gap-x-4 sm:grid-cols-2">
                      <DetailItem icon={Landmark} label="Auswahl Zahlungssumme" value={guestData.paymentAmountSelection === 'downpayment' ? 'Anzahlung (30%)' : (guestData.paymentAmountSelection === 'full_amount' ? 'Gesamtbetrag (100%)' : guestData.paymentAmountSelection)} />
                      <DetailItem icon={Landmark} label="Zahlungsart" value={guestData.zahlungsart} />
                      {/* <DetailItem icon={CalendarDays} label="Datum der Zahlung" value={formatDate(guestData.zahlungsdatum)} /> removed as per new form */}
                      <DetailItem icon={Euro} label="Überwiesener Betrag" value={guestData.zahlungsbetrag} isCurrency />
                      <DetailItem icon={FileIcon} label="Zahlungsbeleg" value={guestData.zahlungsbelegUrl} isDocumentUrl documentHint="payment proof" />
                    </div>
                  </>
                )}

                {(guestData.agbAkzeptiert !== undefined || guestData.datenschutzAkzeptiert !== undefined) && (
                  <>
                    <Separator className="my-4" />
                    <h3 className="font-semibold text-lg flex items-center"><ShieldCheck className="mr-2 h-5 w-5 text-primary" /> Zustimmungen</h3>
                    <div className="grid gap-y-2 gap-x-4 sm:grid-cols-2">
                      <DetailItem icon={ShieldCheck} label="AGB akzeptiert" value={guestData.agbAkzeptiert} />
                      <DetailItem icon={ShieldCheck} label="Datenschutz zugestimmt" value={guestData.datenschutzAkzeptiert} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-1 h-fit sticky top-20 shadow-md">
          <CardHeader>
            <CardTitle>Notizen &amp; Verlauf</CardTitle>
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

