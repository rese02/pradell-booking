
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Booking, RoomDetail, Mitreisender } from "@/lib/definitions"; // Added Mitreisender
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Edit3, Euro, FileText, Home, Mail, Phone, User, MessageSquare, Link2, Users, Landmark, ShieldCheck, Briefcase, BookUser, UserCircle, CreditCard, FileIcon, Image as ImageIcon, Users2, Hotel, Info } from "lucide-react"; // Added Info here
import { Separator } from "@/components/ui/separator";
import NextImage from "next/image"; 
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { findBookingByIdFromFirestore } from "@/lib/mock-db";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react"; // Added ReactNode for SectionCard children

async function getBookingDetails(id: string): Promise<Booking | null> {
  const operationName = "[Page admin/bookings/[id] getBookingDetails]";
  console.log(`${operationName} Attempting to fetch booking details from Firestore for id: "${id}"`);
  try {
    const booking = await findBookingByIdFromFirestore(id);
    if (!booking) {
      console.warn(`${operationName} Booking with id ${id} not found in Firestore.`);
    } else {
      const guestDataSummary = booking.guestSubmittedData
        ? { submitted: !!booking.guestSubmittedData.submittedAt, lastStep: booking.guestSubmittedData.lastCompletedStep, hasEmail: !!booking.guestSubmittedData.email }
        : { submitted: false };
      console.log(`${operationName} Found booking for id ${id} from Firestore. Guest Data Summary:`, guestDataSummary);
    }
    return booking;
  } catch (error) {
    console.error(`${operationName} Error fetching booking ${id}:`, error);
    // Potentially re-throw or return a more specific error state
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
    console.warn(`[formatDate] Error parsing date: ${dateString}`, error);
    return "Ungültiges Datum";
  }
};

const formatCurrency = (amount?: number) => {
  if (typeof amount !== 'number') return "N/A";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};

const getFileNameFromUrl = (url?: string, defaultText = "N/A") => {
    if (!url) return defaultText;
    // Handle Data URIs for images (already done)
    if (url.startsWith('data:image')) return "Bilddatei (Data URI)"; // Simplified name for data URIs
    
    // Handle Firebase Storage URLs more robustly
    if (url.startsWith('https://firebasestorage.googleapis.com')) {
        try {
            const decodedUrl = decodeURIComponent(url);
            const pathSegments = new URL(decodedUrl).pathname.split('/');
            const lastSegmentWithQuery = pathSegments.pop(); // e.g., 'bookings%2F...%2F12345_filename.jpg?alt=media&token=...'
            if (lastSegmentWithQuery) {
                const fileNamePart = lastSegmentWithQuery.split('?')[0]; // Remove query parameters
                // Remove the folder structure and timestamp prefix if present
                const finalName = fileNamePart.substring(fileNamePart.lastIndexOf('/') + 1); // Get '12345_filename.jpg'
                const nameWithoutTimestamp = finalName.includes('_') ? finalName.substring(finalName.indexOf('_') + 1) : finalName; // Get 'filename.jpg'
                return nameWithoutTimestamp || finalName; // Fallback to full segment if split fails
            }
        } catch (e) { 
            console.warn(`[getFileNameFromUrl] Error parsing Firebase URL: ${url}`, e);
            // Fallback for URLs that might not be standard Firebase Storage URLs or have unusual characters
            const simpleName = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
            return simpleName.length > 0 ? (simpleName.length > 40 ? simpleName.substring(0,37) + "..." : simpleName) : defaultText;
        }
    }
    // Fallback for other types of URLs (e.g., mock URLs)
    if (url.startsWith('mock-file-url:')) return url.substring('mock-file-url:'.length);

    // Generic fallback
    const simpleName = url.substring(url.lastIndexOf('/') + 1);
    return simpleName.length > 0 ? (simpleName.length > 40 ? simpleName.substring(0,37) + "..." : simpleName) : defaultText;
};


interface DetailItemProps {
  icon?: React.ElementType;
  label: string;
  value?: string | number | null | boolean;
  isCurrency?: boolean;
  isLink?: boolean;
  isBadge?: boolean;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  children?: React.ReactNode;
  isDocumentUrl?: boolean;
  documentHint?: string;
  className?: string;
}

const DetailItem: React.FC<DetailItemProps> = ({ icon: Icon, label, value, isCurrency, isLink, isBadge, badgeVariant, children, isDocumentUrl, documentHint, className }) => {
  let displayValue: React.ReactNode = value;

  if (children) {
    return (
      <div className={cn("flex items-start space-x-3 py-1.5", className)}>
        {Icon && <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />}
        <div className={cn(!Icon && "pl-8")}>
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="text-base font-medium text-foreground">{children}</div>
        </div>
      </div>
    )
  }
  
  if (value === null || typeof value === 'undefined' || value === "") {
    if (typeof value === 'boolean' && value === false) {
      // Allow 'false' boolean to be displayed
    } else {
       return (
        <div className={cn("flex items-start space-x-3 py-1.5", className)}>
          {Icon && <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />}
           <div className={cn(!Icon && "pl-8")}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="text-base font-medium text-muted-foreground/70 italic">N/A</div>
          </div>
        </div>
      );
    }
  }

  if (typeof value === 'boolean') {
    displayValue = value ? "Ja" : "Nein";
  } else if (isCurrency && typeof value === 'number') {
    displayValue = formatCurrency(value);
  } else if (isDocumentUrl && typeof value === 'string') {
      const fileName = getFileNameFromUrl(value, "Ungültige URL");
      let fileIconElement = <FileIcon className="mr-2 h-4 w-4 flex-shrink-0" />;
      let imagePreview: React.ReactNode = null;

      // Check for Firebase Storage image URLs
      const isFirebaseImage = value.startsWith('https://firebasestorage.googleapis.com') && 
                              (/\.(jpeg|jpg|gif|png|webp)(\?alt=media|$)/i.test(value) || 
                               value.includes('image%2F') || 
                               value.includes('image%2f'));

      // Check for Firebase Storage PDF URLs
      const isFirebasePdf = value.startsWith('https://firebasestorage.googleapis.com') &&
                            (/\.pdf(\?alt=media|$)/i.test(value) ||
                             value.includes('application%2Fpdf') ||
                             value.includes('application%2fpdf'));
      
      const isDataImage = value.startsWith('data:image');


      if (isDataImage || isFirebaseImage) {
        fileIconElement = <ImageIcon className="mr-2 h-4 w-4 flex-shrink-0" />;
        imagePreview = <NextImage src={value} alt={label || 'Hochgeladenes Bild'} width={150} height={80} className="rounded-md border object-contain my-1.5 shadow-sm" data-ai-hint={documentHint || "document image"}/>;
      } else if (isFirebasePdf || value.startsWith('mock-file-url:')) { // mock-file-url might represent a PDF
        fileIconElement = <FileText className="mr-2 h-4 w-4 flex-shrink-0" />;
      }
      
      displayValue = (
        <div className="flex flex-col items-start mt-0.5">
          {imagePreview}
          <Link href={value.startsWith('mock-file-url:') || value.startsWith('data:image') ? '#' : value} target="_blank" rel="noopener noreferrer" title={`Datei ansehen: ${fileName}`} className="text-primary hover:underline hover:text-primary/80 transition-colors text-sm font-medium flex items-center">
            {fileIconElement} {fileName}
          </Link>
        </div>
      );
  } else if (isLink && typeof value === 'string') {
    displayValue = <Link href={value.startsWith('http') ? value : (value.includes('@') ? `mailto:${value}` : value)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline hover:text-primary/80 break-all transition-colors">{value}</Link>;
  } else if (isBadge && typeof value === 'string') {
    displayValue = <Badge variant={badgeVariant || 'secondary'} className="text-xs capitalize">{value.toLowerCase().replace(/_/g, ' ')}</Badge>;
  }


  return (
    <div className={cn("flex items-start space-x-3 py-1.5", className)}>
      {Icon && <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />}
      <div className={cn(!Icon && "pl-8")}> {/* Ensure padding if no icon */}
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="text-base font-medium text-foreground">{displayValue}</div>
      </div>
    </div>
  );
};

const SectionCard: React.FC<{title: string, children: ReactNode, icon?: React.ElementType, description?: string, cardClassName?: string}> = ({ title, children, icon: Icon, description, cardClassName }) => (
    <Card className={cn("card-modern", cardClassName)}>
      <CardHeader>
        <div className="flex items-center gap-3">
            {Icon && <div className="p-2 bg-primary/10 rounded-lg"><Icon className="w-6 h-6 text-primary" /></div>}
            <div>
                <CardTitle className="text-xl font-semibold text-foreground">{title}</CardTitle>
                {description && <CardDescription className="mt-1">{description}</CardDescription>}
            </div>
        </div>
      </CardHeader>
      <Separator className="mx-6 w-auto" />
      <CardContent className="pt-5 grid gap-y-2 gap-x-4 sm:grid-cols-2">
        {children}
      </CardContent>
    </Card>
  );


const RoomDetailsCard: React.FC<{ rooms: RoomDetail[] }> = ({ rooms }) => {
  if (!rooms || rooms.length === 0) {
    return null;
  }
  return (
    <SectionCard title="Zimmerdetails" icon={Hotel}>
        {rooms.map((room, index) => (
          <div key={index} className={cn("p-3 border rounded-lg bg-muted/30 shadow-sm sm:col-span-2 mt-2 first:mt-0", rooms.length > 1 && "sm:col-span-1")}>
            <h4 className="font-semibold text-md mb-2 text-foreground">Zimmer {index + 1}: {room.zimmertyp}</h4>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <DetailItem label="Erwachsene" value={String(room.erwachsene)} className="py-0.5"/>
              {typeof room.kinder === 'number' && <DetailItem label="Kinder (3+)" value={String(room.kinder)} className="py-0.5"/>}
              {typeof room.kleinkinder === 'number' && <DetailItem label="Kleinkinder (0-2 J.)" value={String(room.kleinkinder)} className="py-0.5"/>}
              {room.alterKinder && <DetailItem label="Alter Kinder" value={room.alterKinder} className="py-0.5"/>}
            </div>
          </div>
        ))}
    </SectionCard>
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
    <div className="container mx-auto py-6 px-2 sm:px-4">
      <div className="mb-8">
        <Button variant="outline" asChild className="mb-5 hover:bg-accent transition-colors shadow-sm">
          <Link href="/admin/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> Zurück zur Übersicht</Link>
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">Buchungsdetails</h1>
            <p className="text-muted-foreground mt-1">ID: {booking.id}</p>
          </div>
          <Button variant="outline" className="hover:bg-accent transition-colors shadow-sm"><Edit3 className="mr-2 h-4 w-4" /> Buchung bearbeiten</Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
        <div className="lg:col-span-2 space-y-8">
          <SectionCard title="Hauptinformationen (Hotel)" icon={Info}>
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
              <CardFooter className="text-xs text-muted-foreground flex-wrap gap-x-2 gap-y-1 sm:col-span-2 px-0 pt-4 mt-2 border-t border-border/30">
                <span>Erstellt am: {formatDate(booking.createdAt, true)}</span>
                <span className="hidden sm:inline">|</span>
                <span>Letzte Aktualisierung: {formatDate(booking.updatedAt, true)}</span>
            </CardFooter>
          </SectionCard>

          {booking.rooms && booking.rooms.length > 0 && (
            <RoomDetailsCard rooms={booking.rooms} />
          )}

          {booking.interneBemerkungen && (
             <SectionCard title="Interne Bemerkungen (Hotel)" icon={MessageSquare}>
                <DetailItem label="Bemerkung" value={booking.interneBemerkungen} className="sm:col-span-2"/>
            </SectionCard>
          )}

          {guestData && (guestData.gastVorname || guestData.email || guestData.hauptgastAusweisVorderseiteUrl || guestData.zahlungsbelegUrl || guestData.submittedAt) && (
            <Card className="card-modern">
              <CardHeader>
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg"><Users className="w-6 h-6 text-primary" /></div>
                    <div>
                        <CardTitle className="text-xl font-semibold text-foreground">Vom Gast übermittelte Daten</CardTitle>
                        {guestData.submittedAt && <CardDescription className="mt-1">Übermittelt am: {formatDate(guestData.submittedAt, true)} (Letzter Schritt: {guestData.lastCompletedStep !== undefined ? guestData.lastCompletedStep + 1 : 'N/A'})</CardDescription>}
                        {!guestData.submittedAt && booking.status === "Pending Guest Information" && <CardDescription className="mt-1">Gast hat das Formular noch nicht abgeschlossen.</CardDescription>}
                    </div>
                </div>
              </CardHeader>
              
              <div className="px-6 pb-6 space-y-6">
                <Separator className="my-0"/>
                <h3 className="font-semibold text-lg flex items-center text-foreground pt-2"><UserCircle className="mr-2.5 h-5 w-5 text-primary" /> Stammdaten Hauptgast</h3>
                <div className="grid gap-y-1 gap-x-4 sm:grid-cols-2 pl-8">
                  <DetailItem label="Anrede" value={guestData.anrede} />
                  <DetailItem label="Vollständiger Name" value={`${guestData.gastVorname || ''} ${guestData.gastNachname || ''}`} />
                  <DetailItem label="Geburtsdatum" value={formatDate(guestData.geburtsdatum)} />
                  <DetailItem label="Alter" value={guestData.alterHauptgast ? `${guestData.alterHauptgast} Jahre` : undefined} />
                  <DetailItem label="E-Mail" value={guestData.email} isLink />
                  <DetailItem label="Telefon" value={guestData.telefon} />
                </div>

                {(guestData.hauptgastAusweisVorderseiteUrl || guestData.hauptgastAusweisRückseiteUrl) && (
                  <>
                    <Separator className="my-5" />
                    <h3 className="font-semibold text-lg flex items-center text-foreground"><BookUser className="mr-2.5 h-5 w-5 text-primary" /> Ausweisdokument Hauptgast</h3>
                    <div className="grid gap-y-1 gap-x-4 sm:grid-cols-2 pl-8">
                      <DetailItem label="Vorderseite" value={guestData.hauptgastAusweisVorderseiteUrl} isDocumentUrl documentHint="identification front" />
                      <DetailItem label="Rückseite" value={guestData.hauptgastAusweisRückseiteUrl} isDocumentUrl documentHint="identification back" />
                    </div>
                  </>
                )}

                {guestData.mitreisende && guestData.mitreisende.length > 0 && (
                    <>
                        <Separator className="my-5" />
                        <h3 className="font-semibold text-lg flex items-center text-foreground"><Users2 className="mr-2.5 h-5 w-5 text-primary" /> Mitreisende</h3>
                        {guestData.mitreisende.map((mitreisender: Mitreisender, index: number) => (
                            <div key={mitreisender.id || index} className="pl-8 pt-3 border-t border-border/20 first:border-t-0 first:pt-0">
                                <h4 className="font-medium text-md mb-1.5 text-foreground/90">Mitreisender {index + 1}: {mitreisender.vorname} {mitreisender.nachname}</h4>
                                <DetailItem label="Ausweis Vorderseite" value={mitreisender.ausweisVorderseiteUrl} isDocumentUrl documentHint="companion identification front"/>
                                <DetailItem label="Ausweis Rückseite" value={mitreisender.ausweisRückseiteUrl} isDocumentUrl documentHint="companion identification back"/>
                            </div>
                        ))}
                    </>
                )}
                
                {(guestData.paymentAmountSelection || guestData.zahlungsart || guestData.zahlungsbelegUrl) && (
                  <>
                    <Separator className="my-5" />
                    <h3 className="font-semibold text-lg flex items-center text-foreground"><CreditCard className="mr-2.5 h-5 w-5 text-primary" /> Zahlungsinformationen</h3>
                    <div className="grid gap-y-1 gap-x-4 sm:grid-cols-2 pl-8">
                      <DetailItem label="Auswahl Zahlungssumme" value={guestData.paymentAmountSelection === 'downpayment' ? 'Anzahlung (30%)' : (guestData.paymentAmountSelection === 'full_amount' ? 'Gesamtbetrag (100%)' : guestData.paymentAmountSelection)} />
                      <DetailItem label="Zahlungsart" value={guestData.zahlungsart || 'Überweisung'} />
                      <DetailItem label="Überwiesener Betrag" value={guestData.zahlungsbetrag} isCurrency />
                      <DetailItem label="Zahlungsbeleg" value={guestData.zahlungsbelegUrl} isDocumentUrl documentHint="payment proof" />
                    </div>
                  </>
                )}

                {(guestData.agbAkzeptiert !== undefined || guestData.datenschutzAkzeptiert !== undefined) && (
                  <>
                    <Separator className="my-5" />
                    <h3 className="font-semibold text-lg flex items-center text-foreground"><ShieldCheck className="mr-2.5 h-5 w-5 text-primary" /> Zustimmungen</h3>
                    <div className="grid gap-y-1 gap-x-4 sm:grid-cols-2 pl-8">
                      <DetailItem label="AGB akzeptiert" value={guestData.agbAkzeptiert} />
                      <DetailItem label="Datenschutz zugestimmt" value={guestData.datenschutzAkzeptiert} />
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-1 h-fit sticky top-24 card-modern">
          <CardHeader>
             <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg"><MessageSquare className="w-6 h-6 text-primary" /></div>
                <div>
                    <CardTitle className="text-xl font-semibold text-foreground">Notizen &amp; Verlauf</CardTitle>
                    <CardDescription className="mt-1">Interne Notizen und Buchungsverlauf.</CardDescription>
                </div>
            </div>
          </CardHeader>
          <Separator className="mx-6 w-auto"/>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Feature in Kürze verfügbar.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
