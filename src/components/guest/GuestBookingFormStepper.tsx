
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Check, CheckCircle, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, ShieldCheck, Info, CreditCard, ShieldQuestion, FileText, BookUser, Landmark, Euro, Percent, CheckCircle2, WalletCards, User as UserIcon, FileIcon, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  submitGastStammdatenAction,
  submitAusweisdokumenteAction,
  submitZahlungsinformationenAction,
  submitEndgueltigeBestaetigungAction
} from "@/lib/actions";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format, parseISO, isValid, differenceInYears } from 'date-fns';
import { de } from 'date-fns/locale';
import { PradellLogo } from "@/components/shared/PradellLogo";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Image from "next/image";

interface Step {
  id: string;
  name: string;
  Icon: React.ElementType; 
  StepIcon: React.ElementType; 
  Content: React.FC<StepContentProps>;
  action: (bookingToken: string, prevState: FormState, formData: FormData) => Promise<FormState>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null;
  guestData?: GuestSubmittedData | null; 
  formState: FormState;
}

export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
};

const initialFormState: FormState = { message: null, errors: null, success: false, actionToken: undefined, updatedGuestData: null };

const getErrorMessage = (fieldName: string, errors: FormState['errors']): string | undefined => {
  return errors?.[fieldName]?.[0];
};

const formatDateDisplay = (dateString?: Date | string) => {
  if (!dateString) return "N/A";
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    if (!isValid(date)) return "Ungültiges Datum";
    return format(date, "dd.MM.yyyy", { locale: de });
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

// --- Step 1: Gast-Stammdaten ---
const GastStammdatenStep: React.FC<StepContentProps> = ({ guestData, formState }) => {
  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Ihre Kontaktdaten (Hauptgast)</h2>
        <p className="text-sm text-muted-foreground">Bitte füllen Sie die folgenden Felder aus.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="anrede">Anrede *</Label>
          <Select name="anrede" defaultValue={guestData?.anrede}>
            <SelectTrigger id="anrede"><SelectValue placeholder="Anrede wählen" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Herr">Herr</SelectItem>
              <SelectItem value="Frau">Frau</SelectItem>
              <SelectItem value="Divers">Divers</SelectItem>
            </SelectContent>
          </Select>
          {getErrorMessage("anrede", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("anrede", formState.errors)}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="gastVorname">Vorname *</Label>
          <Input id="gastVorname" name="gastVorname" defaultValue={guestData?.gastVorname || ""} placeholder="Max" />
          {getErrorMessage("gastVorname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastVorname", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="gastNachname">Nachname *</Label>
          <Input id="gastNachname" name="gastNachname" defaultValue={guestData?.gastNachname || ""} placeholder="Mustermann" />
          {getErrorMessage("gastNachname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastNachname", formState.errors)}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="geburtsdatum">Geburtsdatum (optional)</Label>
        <Input id="geburtsdatum" name="geburtsdatum" type="date" defaultValue={formatDateForInput(guestData?.geburtsdatum)} />
        {getErrorMessage("geburtsdatum", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("geburtsdatum", formState.errors)}</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="email">E-Mail-Adresse *</Label>
          <Input id="email" name="email" type="email" defaultValue={guestData?.email || ""} placeholder="max.mustermann@email.com" />
          {getErrorMessage("email", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("email", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="telefon">Telefonnummer *</Label>
          <Input id="telefon" name="telefon" defaultValue={guestData?.telefon || ""} placeholder="+49 123 456789" />
          {getErrorMessage("telefon", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("telefon", formState.errors)}</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Wir verwenden Ihre E-Mail und Telefonnummer zur Kontaktaufnahme bei Rückfragen zu Ihrer Buchung.</p>
    </div>
  );
};

// --- Step 2: Ausweisdokument(e) Hauptgast ---
const AusweisdokumenteStep: React.FC<StepContentProps> = ({ guestData, formState }) => {
  const [fileNameVorderseite, setFileNameVorderseite] = useState<string | null>(null);
  const [fileNameRückseite, setFileNameRückseite] = useState<string | null>(null);
  const [previewVorderseite, setPreviewVorderseite] = useState<string | null>(guestData?.hauptgastAusweisVorderseiteUrl || null);
  const [previewRückseite, setPreviewRückseite] = useState<string | null>(guestData?.hauptgastAusweisRückseiteUrl || null);


  useEffect(() => {
     const vorderseiteUrl = guestData?.hauptgastAusweisVorderseiteUrl;
     if (vorderseiteUrl) {
        if (vorderseiteUrl.startsWith("data:image")) {
            setFileNameVorderseite("Bildvorschau unten");
            setPreviewVorderseite(vorderseiteUrl);
        } else if (vorderseiteUrl.startsWith("mock-file-url:")) {
            setFileNameVorderseite(decodeURIComponent(vorderseiteUrl.substring("mock-file-url:".length)));
            setPreviewVorderseite(null); // No direct preview for mock PDFs
        } else {
             setFileNameVorderseite("Bereits hochgeladen");
             setPreviewVorderseite(null); // Or attempt to show if it's an image
        }
     } else {
        setFileNameVorderseite("Keine Datei ausgewählt");
        setPreviewVorderseite(null);
     }

     const rückseiteUrl = guestData?.hauptgastAusweisRückseiteUrl;
     if (rückseiteUrl) {
        if (rückseiteUrl.startsWith("data:image")) {
            setFileNameRückseite("Bildvorschau unten");
            setPreviewRückseite(rückseiteUrl);
        } else if (rückseiteUrl.startsWith("mock-file-url:")) {
            setFileNameRückseite(decodeURIComponent(rückseiteUrl.substring("mock-file-url:".length)));
            setPreviewRückseite(null);
        } else {
            setFileNameRückseite("Bereits hochgeladen");
            setPreviewRückseite(null);
        }
     } else {
        setFileNameRückseite("Keine Datei ausgewählt");
        setPreviewRückseite(null);
     }
  }, [guestData?.hauptgastAusweisVorderseiteUrl, guestData?.hauptgastAusweisRückseiteUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, type: 'vorderseite' | 'rückseite') => {
    const file = event.target.files?.[0];
    if (file) {
      if (type === 'vorderseite') {
        setFileNameVorderseite(file.name);
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onloadend = () => setPreviewVorderseite(reader.result as string);
          reader.readAsDataURL(file);
        } else {
          setPreviewVorderseite(null);
        }
      } else {
        setFileNameRückseite(file.name);
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onloadend = () => setPreviewRückseite(reader.result as string);
          reader.readAsDataURL(file);
        } else {
          setPreviewRückseite(null);
        }
      }
    } else {
      if (type === 'vorderseite') {
        setFileNameVorderseite(guestData?.hauptgastAusweisVorderseiteUrl ? (guestData.hauptgastAusweisVorderseiteUrl.startsWith("mock-file-url:") ? decodeURIComponent(guestData.hauptgastAusweisVorderseiteUrl.substring("mock-file-url:".length)) : "Bereits hochgeladen") : "Keine Datei ausgewählt");
        setPreviewVorderseite(guestData?.hauptgastAusweisVorderseiteUrl?.startsWith("data:image") ? guestData.hauptgastAusweisVorderseiteUrl : null);

      } else {
        setFileNameRückseite(guestData?.hauptgastAusweisRückseiteUrl ? (guestData.hauptgastAusweisRückseiteUrl.startsWith("mock-file-url:") ? decodeURIComponent(guestData.hauptgastAusweisRückseiteUrl.substring("mock-file-url:".length)) : "Bereits hochgeladen") : "Keine Datei ausgewählt");
        setPreviewRückseite(guestData?.hauptgastAusweisRückseiteUrl?.startsWith("data:image") ? guestData.hauptgastAusweisRückseiteUrl : null);
      }
    }
  };


  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Ihre Ausweisdokumente (Hauptgast)</h2>
        <p className="text-sm text-muted-foreground">Bitte laden Sie eine Kopie Ihres Ausweisdokuments hoch (Vorder- und Rückseite, falls zutreffend).</p>
      </div>
      <div>
        <Label htmlFor="hauptgastDokumenttyp">Dokumenttyp *</Label>
        <Select name="hauptgastDokumenttyp" defaultValue={guestData?.hauptgastDokumenttyp}>
          <SelectTrigger id="hauptgastDokumenttyp"><SelectValue placeholder="Dokumenttyp wählen" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Personalausweis">Personalausweis</SelectItem>
            <SelectItem value="Reisepass">Reisepass</SelectItem>
            <SelectItem value="Führerschein">Führerschein</SelectItem>
          </SelectContent>
        </Select>
        {getErrorMessage("hauptgastDokumenttyp", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastDokumenttyp", formState.errors)}</p>}
      </div>
      <div className="space-y-4">
        <div>
          <Label htmlFor="hauptgastAusweisVorderseite" className="block mb-1 text-sm font-medium">Vorderseite (optional)</Label>
          <div className="flex items-center gap-2">
            <Input id="hauptgastAusweisVorderseite" name="hauptgastAusweisVorderseite" type="file" className="hidden" onChange={(e) => handleFileChange(e, 'vorderseite')} accept="image/jpeg,image/png,image/webp,application/pdf" />
            <Button asChild variant="outline" size="sm"><Label htmlFor="hauptgastAusweisVorderseite" className="cursor-pointer"><FileUp className="w-4 h-4 mr-2" /> Datei wählen</Label></Button>
            <span className="text-sm text-muted-foreground truncate max-w-xs">{fileNameVorderseite}</span>
          </div>
          {previewVorderseite && previewVorderseite.startsWith("data:image/") && (
            <div className="mt-2 rounded-md border overflow-hidden relative w-48 h-32">
              <Image src={previewVorderseite} alt="Vorschau Vorderseite" layout="fill" objectFit="contain" data-ai-hint="identification document" />
            </div>
          )}
          {guestData?.hauptgastAusweisVorderseiteUrl && guestData.hauptgastAusweisVorderseiteUrl.startsWith("mock-file-url:") && !previewVorderseite && (
             <p className="text-xs text-muted-foreground mt-1 flex items-center"><FileIcon className="w-3 h-3 mr-1"/> {decodeURIComponent(guestData.hauptgastAusweisVorderseiteUrl.substring("mock-file-url:".length))}</p>
           )}
          <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF)</p>
          {getErrorMessage("hauptgastAusweisVorderseite", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisVorderseite", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="hauptgastAusweisRückseite" className="block mb-1 text-sm font-medium">Rückseite (optional)</Label>
          <div className="flex items-center gap-2">
            <Input id="hauptgastAusweisRückseite" name="hauptgastAusweisRückseite" type="file" className="hidden" onChange={(e) => handleFileChange(e, 'rückseite')} accept="image/jpeg,image/png,image/webp,application/pdf" />
            <Button asChild variant="outline" size="sm"><Label htmlFor="hauptgastAusweisRückseite" className="cursor-pointer"><FileUp className="w-4 h-4 mr-2" /> Datei wählen</Label></Button>
            <span className="text-sm text-muted-foreground truncate max-w-xs">{fileNameRückseite}</span>
          </div>
          {previewRückseite && previewRückseite.startsWith("data:image/") && (
            <div className="mt-2 rounded-md border overflow-hidden relative w-48 h-32">
              <Image src={previewRückseite} alt="Vorschau Rückseite" layout="fill" objectFit="contain" data-ai-hint="identification document"/>
            </div>
          )}
           {guestData?.hauptgastAusweisRückseiteUrl && guestData.hauptgastAusweisRückseiteUrl.startsWith("mock-file-url:") && !previewRückseite &&(
             <p className="text-xs text-muted-foreground mt-1 flex items-center"><FileIcon className="w-3 h-3 mr-1"/> {decodeURIComponent(guestData.hauptgastAusweisRückseiteUrl.substring("mock-file-url:".length))}</p>
           )}
          <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF)</p>
          {getErrorMessage("hauptgastAusweisRückseite", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisRückseite", formState.errors)}</p>}
        </div>
      </div>
    </div>
  );
};

// --- Step 3: Zahlungsinformationen ---
const ZahlungsinformationenStep: React.FC<StepContentProps> = ({ bookingDetails, guestData, formState }) => {
  const [fileNameBeleg, setFileNameBeleg] = useState<string | null>(null);
  const [previewBeleg, setPreviewBeleg] = useState<string | null>(guestData?.zahlungsbelegUrl || null);


 useEffect(() => {
    const belegUrl = guestData?.zahlungsbelegUrl;
    if (belegUrl) {
        if (belegUrl.startsWith("data:image")) {
            setFileNameBeleg("Bildvorschau unten");
            setPreviewBeleg(belegUrl);
        } else if (belegUrl.startsWith("mock-file-url:")) {
            setFileNameBeleg(decodeURIComponent(belegUrl.substring("mock-file-url:".length)));
            setPreviewBeleg(null); 
        } else {
            setFileNameBeleg("Bereits hochgeladen");
            setPreviewBeleg(null);
        }
    } else {
        setFileNameBeleg("Keine Datei ausgewählt");
        setPreviewBeleg(null);
    }
  }, [guestData?.zahlungsbelegUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileNameBeleg(file.name);
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onloadend = () => setPreviewBeleg(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        setPreviewBeleg(null);
      }
    } else {
      setFileNameBeleg(guestData?.zahlungsbelegUrl ? (guestData.zahlungsbelegUrl.startsWith("mock-file-url:") ? decodeURIComponent(guestData.zahlungsbelegUrl.substring("mock-file-url:".length)) : "Bereits hochgeladen") : "Keine Datei ausgewählt");
      setPreviewBeleg(guestData?.zahlungsbelegUrl?.startsWith("data:image") ? guestData.zahlungsbelegUrl : null);
    }
  };


  const anzahlungsbetrag = useMemo(() => {
    const price = bookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [bookingDetails?.price]);

  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Zahlungsinformationen</h2>
        <p className="text-sm text-muted-foreground">Bitte geben Sie die Details Ihrer Zahlung an.</p>
      </div>
      <div>
        <Label>Anzahlungsbetrag (30%)</Label>
        <Input value={formatCurrency(anzahlungsbetrag)} readOnly className="mt-1 bg-muted/50" />
        <Input type="hidden" name="zahlungsbetrag" value={anzahlungsbetrag} />
        <p className="text-xs text-muted-foreground mt-1">Der Restbetrag ist vor Ort im Hotel zu begleichen.</p>
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
        <Label htmlFor="zahlungsbeleg" className="block mb-1 text-sm font-medium">Zahlungsbeleg hochladen *</Label>
        <div className="flex items-center gap-2">
          <Input id="zahlungsbeleg" name="zahlungsbeleg" type="file" className="hidden" onChange={handleFileChange} accept="image/jpeg,image/png,image/webp,application/pdf" />
          <Button asChild variant="outline" size="sm"><Label htmlFor="zahlungsbeleg" className="cursor-pointer"><FileUp className="w-4 h-4 mr-2" /> Datei wählen</Label></Button>
          <span className="text-sm text-muted-foreground truncate max-w-xs">{fileNameBeleg}</span>
        </div>
        {previewBeleg && previewBeleg.startsWith("data:image/") && (
          <div className="mt-2 rounded-md border overflow-hidden relative w-48 h-32">
            <Image src={previewBeleg} alt="Vorschau Zahlungsbeleg" layout="fill" objectFit="contain" data-ai-hint="payment proof"/>
          </div>
        )}
        {guestData?.zahlungsbelegUrl && guestData.zahlungsbelegUrl.startsWith("mock-file-url:") && !previewBeleg &&(
           <p className="text-xs text-muted-foreground mt-1 flex items-center"><FileIcon className="w-3 h-3 mr-1"/> {decodeURIComponent(guestData.zahlungsbelegUrl.substring("mock-file-url:".length))}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF). Erst nach Upload und Validierung des Belegs wird die Buchung komplett bestätigt.</p>
        {getErrorMessage("zahlungsbeleg", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsbeleg", formState.errors)}</p>}
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
    if (url.startsWith("data:image/")) {
      return (
        <div className="mt-1 rounded-md border overflow-hidden relative w-32 h-20 sm:w-40 sm:h-24">
          <Image src={url} alt={altText || "Dokumentenvorschau"} layout="fill" objectFit="contain" data-ai-hint={hint || "document"}/>
        </div>
      );
    }
    if (url.startsWith("mock-file-url:")) { 
      const fileName = decodeURIComponent(url.substring("mock-file-url:".length));
      return (
        <Link href="#" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center" title="Mock-Datei (nicht herunterladbar)">
          <FileIcon className="w-4 h-4 mr-1 flex-shrink-0" /> {fileName}
        </Link>
      );
    }
    return <Link href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">Datei ansehen (Unbekanntes Format)</Link>;
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
          <div><strong>Zimmer:</strong> {display(bookingDetails?.zimmertyp)} ({display(bookingDetails?.erwachsene)} Erw. {bookingDetails?.kinder ? `, ${bookingDetails.kinder} Ki.` : ''} {bookingDetails?.kleinkinder ? `, ${bookingDetails.kleinkinder} Kk.` : ''})</div>
          <div><strong>Verpflegung:</strong> {display(bookingDetails?.verpflegung)}</div>
          <div><strong>Gesamtpreis:</strong> {formatCurrency(bookingDetails?.price)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Ihre Daten (Hauptgast)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Anrede:</strong> {display(guestData?.anrede)}</div>
          <div><strong>Name:</strong> {display(guestData?.gastVorname)} {display(guestData?.gastNachname)}</div>
          <div><strong>Geburtsdatum:</strong> {formatDateDisplay(guestData?.geburtsdatum) || display(null)}</div>
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
          <div><strong>Zahlungsart:</strong> {display(guestData?.zahlungsart)}</div>
          <div><strong>Anzahlungsbetrag (30%):</strong> {formatCurrency(guestData?.zahlungsbetrag)}</div>
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

export function GuestBookingFormStepper({ bookingToken, bookingDetails: initialBookingDetails }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const { toast } = useToast();
  const lastProcessedActionTokenRef = useRef<string | undefined>(undefined);

  const [latestGuestSubmittedData, setLatestGuestSubmittedData] = useState<GuestSubmittedData | null | undefined>(
    initialBookingDetails?.guestSubmittedData
  );

  useEffect(() => {
    setLatestGuestSubmittedData(initialBookingDetails?.guestSubmittedData);
    console.log("[GuestBookingFormStepper useEffect initialBookingDetails] Initial guest data updated:", JSON.stringify(initialBookingDetails?.guestSubmittedData, null, 2).substring(0,200)+"...");
  }, [initialBookingDetails?.guestSubmittedData]);

  const steps: Step[] = useMemo(() => [
    { id: "gastdaten", name: "Kontaktdaten", Icon: UserCircle, StepIcon: UserIcon, Content: GastStammdatenStep, action: submitGastStammdatenAction },
    { id: "ausweis", name: "Ausweis", Icon: BookUser, StepIcon: BookUser, Content: AusweisdokumenteStep, action: submitAusweisdokumenteAction },
    { id: "zahlung", name: "Zahlung", Icon: CreditCard, StepIcon: CreditCard, Content: ZahlungsinformationenStep, action: submitZahlungsinformationenAction },
    { id: "uebersicht", name: "Bestätigung", Icon: CheckCircle, StepIcon: CheckCircle, Content: UebersichtBestaetigungStep, action: submitEndgueltigeBestaetigungAction },
  ], []);

  const initialStepFromDb = useMemo(() => {
    const lastStep = latestGuestSubmittedData?.lastCompletedStep; // 0-indexed
    const numSteps = steps.length;

    if (typeof lastStep === 'number') {
      if (lastStep >= numSteps - 1) { 
        return numSteps; 
      }
      if (lastStep > -1) { 
        return lastStep + 1; 
      }
    }
    return 0; 
  }, [latestGuestSubmittedData?.lastCompletedStep, steps]);

  const [currentStep, setCurrentStep] = useState(initialStepFromDb); 

  useEffect(() => {
    setCurrentStep(initialStepFromDb);
    console.log(`[GuestBookingFormStepper useEffect initialStepFromDb] currentStep set to: ${initialStepFromDb} based on lastCompletedStep: ${latestGuestSubmittedData?.lastCompletedStep}`);
  }, [initialStepFromDb, latestGuestSubmittedData?.lastCompletedStep]);

  console.log(`[GuestBookingFormStepper Render] Token: ${bookingToken}. DB lastCompletedStep: ${latestGuestSubmittedData?.lastCompletedStep}, Calculated initialStepFromDb: ${initialStepFromDb}, Client currentStep: ${currentStep}. Last processed action token: ${lastProcessedActionTokenRef.current}`);


  const currentActionFn = useMemo(() => {
    if (currentStep >= 0 && currentStep < steps.length && steps[currentStep]?.action) {
        return steps[currentStep].action.bind(null, bookingToken);
    }
    console.warn(`[GuestBookingFormStepper] Fallback action used. currentStep: ${currentStep}, steps.length: ${steps.length}`);
    return async () => ({...initialFormState, message: "Interner Fehler: Ungültiger Schritt oder Aktion nicht definiert."}); 
  }, [currentStep, steps, bookingToken]);

  const [formState, formAction, isPending] = useActionState(currentActionFn, initialFormState);

  useEffect(() => {
    console.log("[GuestBookingFormStepper useEffect formState] Changed:", JSON.parse(JSON.stringify(formState)));
    console.log(`[GuestBookingFormStepper useEffect formState] Conditions: success=${formState.success}, actionToken=${formState.actionToken}, lastProcessedToken=${lastProcessedActionTokenRef.current}, currentStep=${currentStep}`);

    if (formState.message && (formState.actionToken !== lastProcessedActionTokenRef.current || !formState.success || (formState.errors && Object.keys(formState.errors).length > 0))) {
      toast({
        title: formState.success ? "Erfolg" : "Hinweis",
        description: formState.message,
        variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });
    }

    if (formState.success && formState.actionToken && formState.actionToken !== lastProcessedActionTokenRef.current) {
      console.log(`[GuestBookingFormStepper useEffect formState] Action with token ${formState.actionToken} successful. Current step: ${currentStep}.`);
      lastProcessedActionTokenRef.current = formState.actionToken;

      if (formState.updatedGuestData) {
        console.log("[GuestBookingFormStepper useEffect formState] Updating latestGuestSubmittedData with:", JSON.stringify(formState.updatedGuestData,null,2).substring(0, 300) + "...");
        setLatestGuestSubmittedData(formState.updatedGuestData);
      }
    } else if (formState.success && formState.actionToken && formState.actionToken === lastProcessedActionTokenRef.current) {
      console.log(`[GuestBookingFormStepper useEffect formState] Action with token ${formState.actionToken} was already processed. No state changes from this effect. currentStep: ${currentStep}`);
    }
  }, [formState, toast, currentStep, steps, bookingToken]);


  if (!initialBookingDetails) {
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
        <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Fehler</CardTitle></CardHeader>
        <CardContent><CardDescription>Buchungsdetails konnten nicht geladen werden.</CardDescription></CardContent>
      </Card>
    );
  }
  
  if (!steps || steps.length === 0) {
    return (
        <Card className="w-full max-w-lg mx-auto shadow-lg">
            <CardHeader className="items-center text-center"><Loader2 className="w-12 h-12 text-primary animate-spin mb-3" /><CardTitle>Formular wird geladen...</CardTitle></CardHeader>
            <CardContent><CardDescription>Einen Moment Geduld.</CardDescription></CardContent>
        </Card>
    );
  }

  const isCompletedOrConfirmed = currentStep >= steps.length ||
    (initialBookingDetails.status === "Confirmed" && 
     latestGuestSubmittedData?.lastCompletedStep === steps.length -1 && 
     latestGuestSubmittedData?.submittedAt);


  if (isCompletedOrConfirmed) {
    console.log(`[GuestBookingFormStepper] Reached final state. currentStep: ${currentStep}, booking status: ${initialBookingDetails.status}, lastCompletedStep DB: ${latestGuestSubmittedData?.lastCompletedStep}, submittedAt: ${latestGuestSubmittedData?.submittedAt}`);
    const guestName = latestGuestSubmittedData?.gastVorname || initialBookingDetails?.guestFirstName || 'Gast';
    const isFullyConfirmed = initialBookingDetails.status === "Confirmed" && latestGuestSubmittedData?.submittedAt;
    return (
      <>
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
      </>
    );
  }

  if (currentStep < 0 || currentStep >= steps.length || !steps[currentStep]) {
    console.error(`[GuestBookingFormStepper] Invalid currentStep or step definition: currentStep=${currentStep}, steps.length=${steps.length}, steps[currentStep]=${steps[currentStep]}. Displaying error card.`);
    return (
        <Card className="w-full max-w-lg mx-auto shadow-lg">
            <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Formularfehler</CardTitle></CardHeader>
            <CardContent><CardDescription>Ein interner Fehler ist aufgetreten (ungültiger Schritt: {currentStep}). Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.</CardDescription></CardContent>
        </Card>
    );
  }

  const ActiveStepContent = steps[currentStep].Content;
  const CurrentStepIconComponent = steps[currentStep].Icon; 
  const stepNumberForDisplay = currentStep + 1;
  const totalDisplaySteps = steps.length;

  return (
    <>
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <PradellLogo className="mb-8" />
        <CardTitle className="text-3xl font-bold text-center mb-2">Buchung vervollständigen</CardTitle>
        <p className="text-center text-muted-foreground mb-10">Schritt {stepNumberForDisplay} von {totalDisplaySteps} - {steps[currentStep].name}</p>

        <div className="mb-12">
          <ol className="flex items-center w-full">
            {steps.map((step, index) => {
              const StepProgressIcon = steps[index]?.StepIcon || Info; 
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex w-full items-center",
                    index < steps.length - 1 ? "after:content-[''] after:w-full after:h-0.5 after:border-b after:border-muted after:inline-block" : "",
                    index < currentStep ? "after:border-primary" : "",
                    index === currentStep && "font-semibold"
                  )}
                >
                  <span className={cn("flex flex-col items-center justify-center text-center")}>
                    <span className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-full text-sm shrink-0 mb-1 lg:w-10 lg:h-10",
                      index < currentStep ? "bg-primary text-primary-foreground" :
                        index === currentStep ? "bg-primary text-primary-foreground ring-4 ring-primary/30" :
                          "bg-muted text-muted-foreground border"
                    )}>
                      {index < currentStep ? <Check className="w-5 h-5" /> : <StepProgressIcon className="w-5 h-5" />}
                    </span>
                    <span className={cn("text-xs px-1", index <= currentStep ? "text-primary" : "text-muted-foreground")}>
                      {step.name}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <Card className="w-full shadow-xl">
          <CardHeader className="border-b">
            <CardTitle className="text-xl flex items-center">
              {CurrentStepIconComponent && <CurrentStepIconComponent className="w-6 h-6 mr-3 text-primary" />}
              {steps[currentStep].name}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={formAction} key={`${currentStep}-${bookingToken}`} > 
              <ActiveStepContent
                bookingToken={bookingToken}
                bookingDetails={initialBookingDetails}
                guestData={latestGuestSubmittedData}
                formState={formState}
              />
              {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
                <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2" /> {formState.message}
                </div>
              )}
              <div className="flex justify-between items-center mt-8 pt-6 border-t">
                {currentStep > 0 ? (
                  <Button variant="outline" onClick={() => {
                    console.log(`[GuestBookingFormStepper] Back button clicked. Current step: ${currentStep}, moving to ${currentStep - 1}`);
                    setCurrentStep(prev => prev - 1);
                    lastProcessedActionTokenRef.current = undefined; 
                  }} type="button" disabled={isPending}>
                    Zurück
                  </Button>
                ) : <div></div> }
                <Button type="submit" disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
                    (currentStep === steps.length - 1 ? "Buchung abschließen & Bestätigen" : `Weiter zu Schritt ${currentStep + 2}`)}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
