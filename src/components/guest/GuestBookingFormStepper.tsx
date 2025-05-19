
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Check, CheckCircle, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, ShieldCheck, Info, CreditCard, ShieldQuestion, FileText, BookUser, Landmark, Euro, Percent, CheckCircle2, WalletCards, User as UserIcon, Image as ImageIcon, Upload, CalendarIcon, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  submitGastStammdatenAction,
  // submitAusweisdokumenteAction, // Wird entfernt, da in submitGastStammdatenAction integriert
  submitPaymentAmountSelectionAction,
  submitZahlungsinformationenAction,
  submitEndgueltigeBestaetigungAction
} from "@/lib/actions";
import type { Booking, GuestSubmittedData, GastStammdatenFormData, ZahlungsinformationenFormData, UebersichtBestaetigungFormData, PaymentAmountSelectionFormData } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format, parseISO, isValid, differenceInYears } from 'date-fns';
import { de } from 'date-fns/locale';
import { PradellLogo } from "@/components/shared/PradellLogo";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NextImage from "next/image";

export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number; 
};

const initialFormState: FormState = { message: null, errors: null, success: false, actionToken: undefined, updatedGuestData: null };

const getErrorMessage = (fieldName: string, errors: FormState['errors']): string | undefined => {
  return errors?.[fieldName]?.[0];
};

const formatDateDisplay = (dateString?: Date | string, formatStr = "dd.MM.yyyy") => {
  if (!dateString) return "N/A";
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    if (!isValid(date)) return "Ungültiges Datum";
    return format(date, formatStr, { locale: de });
  } catch {
    return String(dateString);
  }
};

const formatDateForInput = (dateString?: Date | string) => {
  if (!dateString) return "";
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    if (!isValid(date)) return "";
    return format(date, "yyyy-MM-dd");
  } catch {
    return "";
  }
};

const formatCurrency = (amount?: number) => {
  if (typeof amount !== 'number') return "N/A";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};

// --- Step 1: Hauptgast Details & Ausweis ---
interface HauptgastDetailsStepProps extends StepContentProps {
    initialBookingDetails: Booking; // Make sure this is passed down
}

const HauptgastDetailsStep: React.FC<HauptgastDetailsStepProps> = ({ guestData, formState, initialBookingDetails }) => {
  const [vorderseiteFileName, setVorderseiteFileName] = useState<string>("Keine Datei ausgewählt");
  const [rueckseiteFileName, setRueckseiteFileName] = useState<string>("Keine Datei ausgewählt");

  useEffect(() => {
    if (guestData?.hauptgastAusweisVorderseiteUrl) {
      setVorderseiteFileName(guestData.hauptgastAusweisVorderseiteUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen");
    } else {
      setVorderseiteFileName("Keine Datei ausgewählt");
    }
    if (guestData?.hauptgastAusweisRückseiteUrl) {
      setRueckseiteFileName(guestData.hauptgastAusweisRückseiteUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen");
    } else {
      setRueckseiteFileName("Keine Datei ausgewählt");
    }
  }, [guestData]);


  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      
      <div className="mb-8 p-4 border border-muted rounded-lg bg-muted/20">
        <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">Ihre Buchungsdetails</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Check-in</p>
            <p className="font-medium">{formatDateDisplay(initialBookingDetails.checkInDate)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Check-out</p>
            <p className="font-medium">{formatDateDisplay(initialBookingDetails.checkOutDate)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Zimmertyp</p>
            <p className="font-medium">{initialBookingDetails.zimmertyp || (initialBookingDetails.rooms && initialBookingDetails.rooms[0]?.zimmertyp) || 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Preis</p>
            <p className="font-medium">{formatCurrency(initialBookingDetails.price)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Label htmlFor="gastVorname" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Vorname *</Label>
          <Input id="gastVorname" name="gastVorname" defaultValue={initialBookingDetails?.guestFirstName || guestData?.gastVorname || ""} placeholder="Max" className="mt-1"/>
          {getErrorMessage("gastVorname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastVorname", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="gastNachname" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Nachname *</Label>
          <Input id="gastNachname" name="gastNachname" defaultValue={initialBookingDetails?.guestLastName || guestData?.gastNachname || ""} placeholder="Mustermann" className="mt-1"/>
          {getErrorMessage("gastNachname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastNachname", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="email" className="flex items-center text-sm"><Mail className="w-4 h-4 mr-2 text-muted-foreground" />E-Mail *</Label>
          <Input id="email" name="email" type="email" defaultValue={guestData?.email || ""} placeholder="max.mustermann@email.com" className="mt-1"/>
          {getErrorMessage("email", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("email", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="telefon" className="flex items-center text-sm"><Phone className="w-4 h-4 mr-2 text-muted-foreground" />Telefon *</Label>
          <Input id="telefon" name="telefon" defaultValue={guestData?.telefon || ""} placeholder="+49 123 456789" className="mt-1"/>
          {getErrorMessage("telefon", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("telefon", formState.errors)}</p>}
        </div>
        <div className="md:col-span-2">
            <Label htmlFor="alterHauptgast" className="flex items-center text-sm"><CalendarIcon className="w-4 h-4 mr-2 text-muted-foreground" />Alter (in Jahren)</Label>
            <Input id="alterHauptgast" name="alterHauptgast" type="number" defaultValue={guestData?.alterHauptgast || ""} placeholder="z.B. 30" className="mt-1"/>
            {getErrorMessage("alterHauptgast", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("alterHauptgast", formState.errors)}</p>}
        </div>
      </div>
      
      <Separator className="my-6"/>

      <div className="space-y-4">
        <h3 className="text-md font-medium">Ausweisdokument (Vorderseite)</h3>
        <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm" className="shrink-0">
                <Label htmlFor="hauptgastAusweisVorderseiteFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei auswählen</Label>
            </Button>
            <Input id="hauptgastAusweisVorderseiteFile" name="hauptgastAusweisVorderseiteFile" type="file" className="hidden" onChange={(e) => setVorderseiteFileName(e.target.files?.[0]?.name || "Keine Datei ausgewählt")} accept="image/jpeg,image/png,image/webp,application/pdf" />
            <span className="text-sm text-muted-foreground truncate">{vorderseiteFileName}</span>
        </div>
        <p className="text-xs text-muted-foreground">Foto eines gültigen Ausweisdokuments aufnehmen oder hochladen. Max. 10MB (JPG, PNG, PDF)</p>
        {getErrorMessage("hauptgastAusweisVorderseiteFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisVorderseiteFile", formState.errors)}</p>}
      </div>

      <div className="space-y-4">
        <h3 className="text-md font-medium">Ausweisdokument (Rückseite)</h3>
         <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm" className="shrink-0">
                <Label htmlFor="hauptgastAusweisRückseiteFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei auswählen</Label>
            </Button>
            <Input id="hauptgastAusweisRückseiteFile" name="hauptgastAusweisRückseiteFile" type="file" className="hidden" onChange={(e) => setRueckseiteFileName(e.target.files?.[0]?.name || "Keine Datei ausgewählt")} accept="image/jpeg,image/png,image/webp,application/pdf" />
            <span className="text-sm text-muted-foreground truncate">{rueckseiteFileName}</span>
        </div>
        <p className="text-xs text-muted-foreground">Max. 10MB (JPG, PNG, PDF)</p>
        {getErrorMessage("hauptgastAusweisRückseiteFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisRückseiteFile", formState.errors)}</p>}
      </div>

      <Separator className="my-6"/>
      
      <div className="p-4 border border-muted rounded-lg bg-muted/20 text-sm text-muted-foreground flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 mt-0.5 text-primary flex-shrink-0"/>
        <p>Die Vertraulichkeit und der Schutz Ihrer persönlichen Daten haben für uns höchste Priorität. Ihre übermittelten Ausweisdokumente und Fotos werden von uns gemäß den geltenden Datenschutzgesetzen, insbesondere der Datenschutz-Grundverordnung (DSGVO), behandelt.</p>
      </div>
    </div>
  );
};


// --- Step 2: Zahlungssumme wählen ---
const ZahlungssummeWaehlenStep: React.FC<StepContentProps> = ({ bookingDetails, guestData, formState }) => {
  const anzahlungsbetrag = useMemo(() => {
    const price = bookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [bookingDetails?.price]);

  const gesamtbetrag = useMemo(() => {
    return bookingDetails?.price || 0;
  }, [bookingDetails?.price]);
  
  const defaultSelection = guestData?.paymentAmountSelection || "full_amount";

  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Zahlungssumme wählen</h2>
        <p className="text-sm text-muted-foreground">Wählen Sie Ihre bevorzugte Zahlungssumme.</p>
      </div>

      <Select name="paymentAmountSelection" defaultValue={defaultSelection}>
        <SelectTrigger id="paymentAmountSelection" className="w-full">
            <SelectValue placeholder="Zahlungssumme auswählen" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="downpayment">
                <div className="flex items-center justify-between w-full">
                    <span>Anzahlung (30%)</span>
                    <Badge variant="outline" className="ml-2">{formatCurrency(anzahlungsbetrag)}</Badge>
                </div>
            </SelectItem>
            <SelectItem value="full_amount">
                <div className="flex items-center justify-between w-full">
                    <span>Gesamtbetrag (100%)</span>
                    <Badge variant="outline" className="ml-2">{formatCurrency(gesamtbetrag)}</Badge>
                </div>
            </SelectItem>
        </SelectContent>
      </Select>
      {getErrorMessage("paymentAmountSelection", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("paymentAmountSelection", formState.errors)}</p>}
    </div>
  );
};

// --- Step 3: Zahlungsinformationen ---
const ZahlungsinformationenStep: React.FC<StepContentProps> = ({ bookingDetails, guestData, formState }) => {
  const [fileNameBeleg, setFileNameBeleg] = useState<string>("Keine Datei ausgewählt");

 useEffect(() => {
    if (guestData?.zahlungsbelegUrl) {
      setFileNameBeleg(guestData.zahlungsbelegUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen");
    } else {
        setFileNameBeleg("Keine Datei ausgewählt");
    }
  }, [guestData?.zahlungsbelegUrl]);

  const anzahlungsbetrag = useMemo(() => {
    const price = bookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [bookingDetails?.price]);
  
  const zuZahlenderBetrag = guestData?.paymentAmountSelection === 'downpayment' ? anzahlungsbetrag : (bookingDetails?.price || 0);


  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Zahlungsinformationen</h2>
        <p className="text-sm text-muted-foreground">Bitte geben Sie die Details Ihrer Zahlung an.</p>
      </div>
      <div>
        <Label>Zu zahlender Betrag</Label>
        <Input value={formatCurrency(zuZahlenderBetrag)} readOnly className="mt-1 bg-muted/50" />
        <Input type="hidden" name="zahlungsbetrag" value={zuZahlenderBetrag} />
        { guestData?.paymentAmountSelection === 'downpayment' && <p className="text-xs text-muted-foreground mt-1">Der Restbetrag ist vor Ort im Hotel zu begleichen.</p>}
      </div>
      <div>
        <Label htmlFor="zahlungsart">Zahlungsart *</Label>
        <Select name="zahlungsart" defaultValue={guestData?.zahlungsart || "Überweisung"}>
          <SelectTrigger id="zahlungsart"><SelectValue placeholder="Zahlungsart wählen" /></SelectTrigger>
          <SelectContent><SelectItem value="Überweisung">Überweisung</SelectItem></SelectContent>
        </Select>
        {getErrorMessage("zahlungsart", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsart", formState.errors)}</p>}
      </div>
      <div>
        <Label htmlFor="zahlungsdatum">Datum der Zahlung *</Label>
        <Input id="zahlungsdatum" name="zahlungsdatum" type="date" defaultValue={formatDateForInput(guestData?.zahlungsdatum)} />
        {getErrorMessage("zahlungsdatum", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsdatum", formState.errors)}</p>}
      </div>
      <div>
        <Label htmlFor="zahlungsbelegFile" className="block mb-1 text-sm font-medium">Zahlungsbeleg hochladen *</Label>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Label htmlFor="zahlungsbelegFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei wählen</Label>
          </Button>
          <Input id="zahlungsbelegFile" name="zahlungsbelegFile" type="file" className="hidden" onChange={(e) => setFileNameBeleg(e.target.files?.[0]?.name || "Keine Datei ausgewählt")} accept="image/jpeg,image/png,image/webp,application/pdf" />
          <span className="text-sm text-muted-foreground truncate">{fileNameBeleg}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF). Erst nach Upload und Validierung des Belegs wird die Buchung komplett bestätigt.</p>
        {getErrorMessage("zahlungsbelegFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsbelegFile", formState.errors)}</p>}
      </div>
    </div>
  );
};

// --- Step 4: Übersicht & Bestätigung ---
const UebersichtBestaetigungStep: React.FC<StepContentProps> = ({ bookingDetails, guestData, formState }) => {
  const display = (value?: string | number | boolean | null) => {
    if (typeof value === 'boolean') return value ? "Ja" : "Nein";
    if (value === null || typeof value === 'undefined' || value === "") { 
        return <span className="italic text-muted-foreground">N/A</span>;
    }
    return String(value);
  }

  const renderDocumentLink = (url?: string, altText?: string, hint?: string) => {
    if (!url) return display(null);

    if (url.startsWith('https://firebasestorage.googleapis.com')) {
        const isImage = /\.(jpeg|jpg|gif|png|webp)$/i.test(url) || url.includes('image%2F');
        const isPdf = /\.pdf/i.test(url) || url.includes('application%2Fpdf');
        const fileNameFromUrl = url.split('/').pop()?.split('?')[0];
        const decodedFileName = fileNameFromUrl ? decodeURIComponent(fileNameFromUrl.split('_').slice(1).join('_') || fileNameFromUrl) : 'Datei';

        if (isImage) {
            return (
                <div className="flex flex-col items-start gap-1 mt-1">
                    <NextImage src={url} alt={altText || 'Hochgeladenes Bild'} width={100} height={60} className="rounded border object-contain" data-ai-hint={hint || "document image"} />
                    <Link href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                       {decodedFileName} (ansehen)
                    </Link>
                </div>
            );
        } else if (isPdf) {
            return (
                <Link href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center" title={`PDF ansehen: ${decodedFileName}`}>
                  <FileText className="w-4 h-4 mr-1 flex-shrink-0" /> {decodedFileName}
                </Link>
              );
        } else { 
             return (
                <Link href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center" title={`Datei ansehen: ${decodedFileName}`}>
                    <FileText className="w-4 h-4 mr-1 flex-shrink-0" /> {decodedFileName}
                </Link>
            );
        }
    }
    return <span className="italic text-muted-foreground">Dokument nicht verfügbar oder ungültige URL</span>;
  };

  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Übersicht und Bestätigung</h2>
        <p className="text-sm text-muted-foreground">Bitte überprüfen Sie Ihre Angaben sorgfältig, bevor Sie die Buchung abschließen.</p>
      </div>
      <Card className="bg-muted/30">
        <CardHeader><CardTitle className="text-lg">Ihre Buchungsdetails</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Zeitraum:</strong> {formatDateDisplay(bookingDetails?.checkInDate)} - {formatDateDisplay(bookingDetails?.checkOutDate)}</div>
          <div><strong>Zimmer:</strong> {display(bookingDetails?.zimmertyp || (bookingDetails?.rooms && bookingDetails.rooms[0]?.zimmertyp))}</div>
          <div><strong>Verpflegung:</strong> {display(bookingDetails?.verpflegung)}</div>
          <div><strong>Gesamtpreis:</strong> {formatCurrency(bookingDetails?.price)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Ihre Daten (Hauptgast)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Name:</strong> {display(guestData?.gastVorname)} {display(guestData?.gastNachname)}</div>
          <div><strong>Alter:</strong> {display(guestData?.alterHauptgast) || display(null)}</div>
          <div><strong>E-Mail:</strong> {display(guestData?.email)}</div>
          <div><strong>Telefon:</strong> {display(guestData?.telefon)}</div>
          <Separator className="my-3" />
          <h4 className="font-medium">Ausweisdokument</h4>
          <div><strong>Dokumenttyp:</strong> {display(guestData?.hauptgastDokumenttyp)}</div>
          <div><strong>Ausweis Vorderseite:</strong> {renderDocumentLink(guestData?.hauptgastAusweisVorderseiteUrl, "Ausweis Vorderseite", "identification document")}</div>
          <div><strong>Ausweis Rückseite:</strong> {renderDocumentLink(guestData?.hauptgastAusweisRückseiteUrl, "Ausweis Rückseite", "identification document")}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Zahlungsinformationen</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Auswahl Zahlungssumme:</strong> {guestData?.paymentAmountSelection === 'downpayment' ? 'Anzahlung (30%)' : 'Gesamtbetrag (100%)'}</div>
          <div><strong>Zahlungsart:</strong> {display(guestData?.zahlungsart)}</div>
          <div><strong>Zu zahlender Betrag:</strong> {formatCurrency(guestData?.zahlungsbetrag)}</div>
          <div><strong>Zahlungsdatum:</strong> {formatDateDisplay(guestData?.zahlungsdatum) || display(null)}</div>
          <div><strong>Zahlungsbeleg:</strong> {renderDocumentLink(guestData?.zahlungsbelegUrl, "Zahlungsbeleg", "payment proof")}</div>
          <div className="text-sm">
            <strong>Zahlungsstatus:</strong>{' '}
            <Badge
              variant={
                (bookingDetails?.status === "Confirmed" && guestData?.submittedAt)
                  ? "default" 
                  : guestData?.zahlungsbelegUrl
                    ? "secondary" 
                    : "outline" 
              }
            >
              {(bookingDetails?.status === "Confirmed" && guestData?.submittedAt)
                ? "Bezahlt & Bestätigt"
                : guestData?.zahlungsbelegUrl
                  ? "Zahlungsnachweis Erhalten"
                  : "Zahlung Ausstehend"}
            </Badge>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-start space-x-3">
          <Checkbox id="agbAkzeptiert" name="agbAkzeptiert" defaultChecked={guestData?.agbAkzeptiert === true} />
          <Label htmlFor="agbAkzeptiert" className="text-sm">
            Ich akzeptiere die <Link href="/agb" target="_blank" className="underline text-primary">Allgemeinen Geschäftsbedingungen</Link>.*
          </Label>
        </div>
        {getErrorMessage("agbAkzeptiert", formState.errors) && <p className="text-xs text-destructive -mt-2 ml-9">{getErrorMessage("agbAkzeptiert", formState.errors)}</p>}
        <div className="flex items-start space-x-3">
          <Checkbox id="datenschutzAkzeptiert" name="datenschutzAkzeptiert" defaultChecked={guestData?.datenschutzAkzeptiert === true} />
          <Label htmlFor="datenschutzAkzeptiert" className="text-sm">
            Ich habe die <Link href="/datenschutz" target="_blank" className="underline text-primary">Datenschutzbestimmungen</Link> gelesen und stimme der Verarbeitung meiner Daten zu.*
          </Label>
        </div>
        {getErrorMessage("datenschutzAkzeptiert", formState.errors) && <p className="text-xs text-destructive -mt-2 ml-9">{getErrorMessage("datenschutzAkzeptiert", formState.errors)}</p>}
      </div>
    </div>
  );
};


interface Step {
  id: string;
  name: string; // For internal logic
  label: string; // For visual stepper UI
  Icon: React.ElementType; 
  Content: React.FC<StepContentProps>;
  action: (bookingToken: string, prevState: FormState, formData: FormData) => Promise<FormState>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null;
  guestData?: GuestSubmittedData | null; 
  formState: FormState;
  initialBookingDetails?: Booking; // Add this to pass admin-created data to step 1
}

export function GuestBookingFormStepper({ bookingToken, bookingDetails: initialBookingDetailsProp }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const { toast } = useToast();
  const lastProcessedActionTokenRef = useRef<string | undefined>(undefined);
  
  const [latestGuestSubmittedData, setLatestGuestSubmittedData] = useState<GuestSubmittedData | null | undefined>(
    initialBookingDetailsProp?.guestSubmittedData
  );
   const [initialBookingDetails, setInitialBookingDetails] = useState<Booking | null | undefined>(initialBookingDetailsProp);


  useEffect(() => {
    setInitialBookingDetails(initialBookingDetailsProp);
    setLatestGuestSubmittedData(initialBookingDetailsProp?.guestSubmittedData);
  }, [initialBookingDetailsProp]);


  const steps: Step[] = useMemo(() => [
    { id: "hauptgast", name: "Hauptgast & Ausweis", label: "Hauptgast", Icon: UserIcon, Content: HauptgastDetailsStep, action: submitGastStammdatenAction },
    // Placeholder for future "Mitreisende" step if needed. For now, the visual stepper will show 6, but functional steps are fewer.
    // { id: "mitreisende", name: "Mitreisende", label: "Mitreisende", Icon: Users, Content: MitreisendeStep, action: submitMitreisendeAction },
    { id: "zahlungssumme", name: "Zahlungssumme", label: "Zahlungssumme", Icon: WalletCards, Content: ZahlungssummeWaehlenStep, action: submitPaymentAmountSelectionAction },
    { id: "zahlung", name: "Zahlungsinformationen", label: "Zahlungsdetails", Icon: CreditCard, Content: ZahlungsinformationenStep, action: submitZahlungsinformationenAction },
    { id: "uebersicht", name: "Bestätigung", label: "Übersicht", Icon: CheckCircle, Content: UebersichtBestaetigungStep, action: submitEndgueltigeBestaetigungAction },
  ], []);

  const visualStepperLabels = ["Hauptgast", "Mitreisende", "Zahlungssumme", "Zahlungsdetails", "Übersicht", "Fertig"];
  const totalVisualSteps = visualStepperLabels.length;


  const initialStepFromDb = useMemo(() => {
    const lastStep = latestGuestSubmittedData?.lastCompletedStep; 
    if (typeof lastStep === 'number' && lastStep > -1) {
      if (lastStep >= steps.length - 1) { 
        return steps.length; 
      }
      return lastStep + 1; 
    }
    return 0; 
  }, [latestGuestSubmittedData?.lastCompletedStep, steps]);

  const [currentStep, setCurrentStep] = useState(initialStepFromDb); 

  useEffect(() => {
    setCurrentStep(initialStepFromDb);
  }, [initialStepFromDb]);

  const currentActionFn = useMemo(() => {
    if (currentStep >= 0 && currentStep < steps.length && steps[currentStep]?.action) {
        return steps[currentStep].action.bind(null, bookingToken);
    }
    return async (prevState: FormState, formData: FormData) => ({...initialFormState, message: "Interner Fehler: Ungültiger Schritt."}); 
  }, [currentStep, steps, bookingToken]);

  const [formState, formAction, isPending] = useActionState(currentActionFn, initialFormState);
  
  useEffect(() => {
    if (formState.message && (formState.actionToken !== lastProcessedActionTokenRef.current || !formState.success || (formState.errors && Object.keys(formState.errors).length > 0))) {
      toast({
        title: formState.success ? "Erfolg" : "Hinweis",
        description: formState.message,
        variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });
    }

    if (formState.success && formState.actionToken && formState.actionToken !== lastProcessedActionTokenRef.current) {
      lastProcessedActionTokenRef.current = formState.actionToken;
      if (formState.updatedGuestData) {
        setLatestGuestSubmittedData(formState.updatedGuestData);
      }
      if (currentStep < steps.length - 1) {
        setCurrentStep(prev => prev + 1);
      } else if (currentStep === steps.length -1) { 
        setCurrentStep(steps.length); 
      }
    }
  }, [formState, toast, currentStep, steps]);


  if (!initialBookingDetails) {
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
        <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Fehler</CardTitle></CardHeader>
        <CardContent><CardDescription>Buchungsdetails konnten nicht geladen werden.</CardDescription></CardContent>
      </Card>
    );
  }
  
  const isCompletedOrConfirmed = currentStep >= steps.length ||
    (initialBookingDetails.status === "Confirmed" && 
     latestGuestSubmittedData?.lastCompletedStep === steps.length -1 && 
     latestGuestSubmittedData?.submittedAt);

  if (isCompletedOrConfirmed) {
    const guestName = latestGuestSubmittedData?.gastVorname || initialBookingDetails?.guestFirstName || 'Gast';
    const isFullyConfirmed = initialBookingDetails.status === "Confirmed" && latestGuestSubmittedData?.submittedAt;
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <PradellLogo className="mb-8" />
        <Card className="w-full shadow-xl">
          <CardHeader className="items-center text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <CardTitle className="text-2xl">Buchung {isFullyConfirmed ? "abgeschlossen und bestätigt" : "Daten übermittelt" }!</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <CardDescription>
              Vielen Dank, {guestName}! Ihre Daten wurden erfolgreich übermittelt.
              {isFullyConfirmed
                ? " Ihre Buchung ist nun bestätigt."
                : " Ihre Buchung wird vom Hotel geprüft. Sie erhalten in Kürze eine Bestätigung."} Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.
            </CardDescription>
            <p className="mt-2">Ihre Buchungsreferenz: <strong>{bookingToken}</strong></p>
            <p className="mt-4 text-muted-foreground">Sie können diese Seite nun schließen oder <Link href="/" className="text-primary underline">zur Startseite</Link> zurückkehren.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStep < 0 || currentStep >= steps.length || !steps[currentStep]) {
    return (
        <Card className="w-full max-w-lg mx-auto shadow-lg">
            <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Formularfehler</CardTitle></CardHeader>
            <CardContent><CardDescription>Ein interner Fehler ist aufgetreten (ungültiger Schritt: {currentStep}). Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.</CardDescription></CardContent>
        </Card>
    );
  }

  const ActiveStepContent = steps[currentStep]!.Content;
  const CurrentStepIconComponent = steps[currentStep]!.Icon; 
  const currentVisualStepNumber = currentStep === 0 ? 1 : currentStep + 2; // Mapping functional step to visual step
                                                                      // Step 0 -> Visual 1
                                                                      // Step 1 -> Visual 3
                                                                      // Step 2 -> Visual 4
                                                                      // Step 3 -> Visual 5

  return (
    <>
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-4">
            <h1 className="text-2xl font-semibold tracking-tight">Buchung vervollständigen</h1>
            <p className="text-muted-foreground">Schritt {currentVisualStepNumber} von {totalVisualSteps}</p>
        </div>
        
        <div className="mb-10 flex justify-center">
            <ol className="flex items-center space-x-2 sm:space-x-4">
            {visualStepperLabels.map((label, index) => {
                const visualStepNum = index + 1;
                let isActive = false;
                let isCompleted = false;

                if (currentStep === 0 && visualStepNum === 1) isActive = true; // Hauptgast
                else if (currentStep === 0 && visualStepNum < 1) isCompleted = true;
                // Visual Step 2 (Mitreisende) is a placeholder for now
                else if (currentStep === 1 && visualStepNum === 3) isActive = true; // Zahlungssumme
                else if (currentStep === 1 && visualStepNum < 3) isCompleted = true;
                else if (currentStep === 2 && visualStepNum === 4) isActive = true; // Zahlungsdetails
                else if (currentStep === 2 && visualStepNum < 4) isCompleted = true;
                else if (currentStep === 3 && visualStepNum === 5) isActive = true; // Übersicht
                else if (currentStep === 3 && visualStepNum < 5) isCompleted = true;
                else if (currentStep >= steps.length && visualStepNum === 6) isActive = true; // Fertig
                else if (currentStep >= steps.length && visualStepNum < 6) isCompleted = true;


                return (
                <li key={label} className="flex items-center">
                    <span className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-full text-sm shrink-0 border-2",
                        isActive ? "bg-primary text-primary-foreground border-primary font-semibold" :
                        isCompleted ? "bg-primary/20 border-primary text-primary" :
                        "bg-muted text-muted-foreground border-muted-foreground/30"
                    )}>
                    {isCompleted ? <Check className="w-5 h-5" /> : visualStepNum}
                    </span>
                    {index < totalVisualSteps - 1 && <div className={cn("w-8 sm:w-12 h-0.5", isCompleted ? "bg-primary/50" : "bg-muted-foreground/30")}></div>}
                </li>
                );
            })}
            </ol>
        </div>
        <div className="text-center mb-8">
            <PradellLogo className="inline-block" />
             <h2 className="text-xl font-semibold mt-4">Schön, dass Sie bei uns buchen möchten</h2>
            <p className="text-muted-foreground">Hier sind die letzten Schritte Ihrer Buchung...</p>
        </div>

        <Card className="w-full shadow-xl">
          {/* CardHeader kann entfernt werden, wenn der Titel global über dem Stepper ist */}
          <CardContent className="pt-6">
            <form action={formAction} key={`${currentStep}-${bookingToken}`} >
              <ActiveStepContent
                bookingToken={bookingToken}
                initialBookingDetails={initialBookingDetails} // Pass initialBookingDetails here
                guestData={latestGuestSubmittedData}
                formState={formState}
              />
              {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
                <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2" /> {formState.message}
                </div>
              )}
              <div className="flex justify-end items-center mt-8 pt-6 border-t">
                {/* "Zurück" Button kann hier noch implementiert werden, wenn currentStep > 0 */}
                <Button type="submit" disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 text-base">
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Weiter"}
                  {!isPending && <ChevronRight className="ml-2 h-5 w-5" />}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

    