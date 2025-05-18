
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea"; 
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Check, CheckCircle, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, MessageSquare, ShieldCheck, Info, Users, CreditCard, ShieldQuestion, Trash2, PlusCircle, Landmark, Euro, WalletCards, Percent, FileText, Edit3, Gift, BadgePercent, BookUser } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { 
  submitGastStammdatenAction,
  submitAusweisdokumenteAction,
  submitZahlungsinformationenAction,
  submitEndgueltigeBestaetigungAction
} from "@/lib/actions";
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { PradellLogo } from "@/components/shared/PradellLogo";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Step {
  id: string;
  name: string;
  Icon: React.ElementType; 
  StepIcon: React.ElementType; 
  Content: React.FC<StepContentProps>;
  action: (bookingToken: string, prevState: any, formData: FormData) => Promise<FormState>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null; 
  guestData?: GuestSubmittedData | null;
  formState: FormState;
  currentActionToken?: string; 
}

type FormState = {
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
      return format(date, "dd.MM.yyyy", { locale: de });
    } catch {
      return String(dateString); 
    }
};
const formatDateForInput = (dateString?: Date | string) => {
    if (!dateString) return "";
    try {
        const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
        return format(date, "yyyy-MM-dd");
    } catch {
        return "";
    }
};

const formatCurrency = (amount?: number) => {
    if (typeof amount !== 'number') return "N/A";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};


// --- Schritt 1: Gast-Stammdaten ---
const GastStammdatenStep: React.FC<StepContentProps> = ({ guestData, formState, currentActionToken }) => {
  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={currentActionToken} />
      <div>
        <h2 className="text-xl font-semibold">Ihre Kontaktdaten (Hauptgast)</h2>
        <p className="text-sm text-muted-foreground">Bitte füllen Sie die folgenden Felder aus.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="anrede">Anrede *</Label>
          <Select name="anrede" defaultValue={guestData?.anrede}>
            <SelectTrigger id="anrede">
              <SelectValue placeholder="Anrede wählen" />
            </SelectTrigger>
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

// --- Schritt 2: Ausweisdokument(e) ---
const AusweisdokumenteStep: React.FC<StepContentProps> = ({ guestData, formState, currentActionToken }) => {
  const [fileNameVorderseite, setFileNameVorderseite] = useState<string | null>(null);
  const [fileNameRückseite, setFileNameRückseite] = useState<string | null>(null);

  useEffect(() => {
    if (guestData?.hauptgastAusweisVorderseiteUrl && !fileNameVorderseite) {
        setFileNameVorderseite("Bereits hochgeladen (Vorderseite)");
    }
    if (guestData?.hauptgastAusweisRückseiteUrl && !fileNameRückseite) {
        setFileNameRückseite("Bereits hochgeladen (Rückseite)");
    }
  }, [guestData, fileNameVorderseite, fileNameRückseite]);


  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={currentActionToken} />
      <div>
        <h2 className="text-xl font-semibold">Ihre Ausweisdokumente (Hauptgast)</h2>
        <p className="text-sm text-muted-foreground">Bitte laden Sie eine Kopie Ihres Ausweisdokuments hoch (Vorder- und Rückseite, falls zutreffend).</p>
      </div>
      
      <div>
        <Label htmlFor="hauptgastDokumenttyp">Dokumenttyp *</Label>
        <Select name="hauptgastDokumenttyp" defaultValue={guestData?.hauptgastDokumenttyp}>
          <SelectTrigger id="hauptgastDokumenttyp">
            <SelectValue placeholder="Dokumenttyp wählen" />
          </SelectTrigger>
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
            <Input
              id="hauptgastAusweisVorderseite"
              name="hauptgastAusweisVorderseite"
              type="file"
              className="hidden"
              onChange={(e) => setFileNameVorderseite(e.target.files?.[0]?.name || "Keine Datei ausgewählt")}
              accept=".jpg,.jpeg,.png,.pdf"
            />
            <Button asChild variant="outline" size="sm">
              <Label htmlFor="hauptgastAusweisVorderseite" className="cursor-pointer">
                <FileUp className="w-4 h-4 mr-2"/> Datei wählen
              </Label>
            </Button>
            <span className="text-sm text-muted-foreground">{fileNameVorderseite || "Keine Datei ausgewählt"}</span>
          </div>
           {guestData?.hauptgastAusweisVorderseiteUrl && (
            <p className="text-xs text-muted-foreground mt-1">
              Aktuell: <Link href={guestData.hauptgastAusweisVorderseiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Vorderseite ansehen</Link>
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF)</p>
          {getErrorMessage("hauptgastAusweisVorderseite", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisVorderseite", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="hauptgastAusweisRückseite" className="block mb-1 text-sm font-medium">Rückseite (optional)</Label>
           <div className="flex items-center gap-2">
            <Input
              id="hauptgastAusweisRückseite"
              name="hauptgastAusweisRückseite"
              type="file"
              className="hidden"
              onChange={(e) => setFileNameRückseite(e.target.files?.[0]?.name || "Keine Datei ausgewählt")}
              accept=".jpg,.jpeg,.png,.pdf"
            />
             <Button asChild variant="outline" size="sm">
              <Label htmlFor="hauptgastAusweisRückseite" className="cursor-pointer">
                <FileUp className="w-4 h-4 mr-2"/> Datei wählen
              </Label>
            </Button>
            <span className="text-sm text-muted-foreground">{fileNameRückseite || "Keine Datei ausgewählt"}</span>
          </div>
          {guestData?.hauptgastAusweisRückseiteUrl && (
            <p className="text-xs text-muted-foreground mt-1">
              Aktuell: <Link href={guestData.hauptgastAusweisRückseiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Rückseite ansehen</Link>
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF)</p>
          {getErrorMessage("hauptgastAusweisRückseite", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisRückseite", formState.errors)}</p>}
        </div>
      </div>
    </div>
  );
};

// --- Schritt 3: Zahlungsinformationen ---
const ZahlungsinformationenStep: React.FC<StepContentProps> = ({ bookingDetails, guestData, formState, currentActionToken }) => {
  const [fileNameBeleg, setFileNameBeleg] = useState<string | null>(null);
  const anzahlungsbetrag = useMemo(() => {
    const price = bookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [bookingDetails?.price]);

  useEffect(() => {
    if (guestData?.zahlungsbelegUrl && !fileNameBeleg) {
        setFileNameBeleg("Bereits hochgeladen (Beleg)");
    }
  }, [guestData, fileNameBeleg]);

  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={currentActionToken} />
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
          <SelectTrigger id="zahlungsart">
            <SelectValue placeholder="Zahlungsart wählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Überweisung">Überweisung</SelectItem>
          </SelectContent>
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
          <Input
            id="zahlungsbeleg"
            name="zahlungsbeleg"
            type="file"
            className="hidden"
            onChange={(e) => setFileNameBeleg(e.target.files?.[0]?.name || "Keine Datei ausgewählt")}
            accept=".jpg,.jpeg,.png,.pdf"
          />
          <Button asChild variant="outline" size="sm">
            <Label htmlFor="zahlungsbeleg" className="cursor-pointer">
              <FileUp className="w-4 h-4 mr-2"/> Datei wählen
            </Label>
          </Button>
          <span className="text-sm text-muted-foreground">{fileNameBeleg || "Keine Datei ausgewählt"}</span>
        </div>
        {guestData?.zahlungsbelegUrl && (
            <p className="text-xs text-muted-foreground mt-1">
              Aktuell: <Link href={guestData.zahlungsbelegUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Beleg ansehen</Link>
            </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">Max. 10MB (JPG, PNG, PDF). Erst nach Upload und Validierung des Belegs wird die Buchung komplett bestätigt.</p>
        {getErrorMessage("zahlungsbeleg", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsbeleg", formState.errors)}</p>}
      </div>
    </div>
  );
};


// --- Schritt 4: Übersicht & Bestätigung ---
const UebersichtBestaetigungStep: React.FC<StepContentProps> = ({ bookingDetails, guestData, formState, currentActionToken }) => {
  const display = (value?: string | number | boolean | null) => {
    if (typeof value === 'boolean') return value ? "Ja" : "Nein";
    return value || <span className="italic text-muted-foreground">N/A</span>;
  }

  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={currentActionToken} />
      <div>
        <h2 className="text-xl font-semibold">Übersicht und Bestätigung</h2>
        <p className="text-sm text-muted-foreground">Bitte überprüfen Sie Ihre Angaben sorgfältig, bevor Sie die Buchung abschließen.</p>
      </div>

      <Card className="bg-muted/30">
        <CardHeader><CardTitle className="text-lg">Ihre Buchungsdetails</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>Zeitraum:</strong> {formatDateDisplay(bookingDetails?.checkInDate)} - {formatDateDisplay(bookingDetails?.checkOutDate)}</p>
          <p><strong>Zimmer:</strong> {display(bookingDetails?.zimmertyp)} ({display(bookingDetails?.erwachsene)} Erw. {bookingDetails?.kinder ? `, ${bookingDetails.kinder} Ki.` : ''} {bookingDetails?.kleinkinder ? `, ${bookingDetails.kleinkinder} Kk.` : ''})</p>
          <p><strong>Verpflegung:</strong> {display(bookingDetails?.verpflegung)}</p>
          <p><strong>Gesamtpreis:</strong> {formatCurrency(bookingDetails?.price)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Ihre Daten (Hauptgast)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>Anrede:</strong> {display(guestData?.anrede)}</p>
          <p><strong>Name:</strong> {display(guestData?.gastVorname)} {display(guestData?.gastNachname)}</p>
          <p><strong>Geburtsdatum:</strong> {formatDateDisplay(guestData?.geburtsdatum) || display(null)}</p>
          <p><strong>E-Mail:</strong> {display(guestData?.email)}</p>
          <p><strong>Telefon:</strong> {display(guestData?.telefon)}</p>
          <Separator className="my-3" />
          <h4 className="font-medium">Ausweisdokument</h4>
          <p><strong>Dokumenttyp:</strong> {display(guestData?.hauptgastDokumenttyp)}</p>
          <p><strong>Ausweis Vorderseite:</strong> {guestData?.hauptgastAusweisVorderseiteUrl ? <Link href={guestData.hauptgastAusweisVorderseiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Ansehen</Link> : display(null)}</p>
          <p><strong>Ausweis Rückseite:</strong> {guestData?.hauptgastAusweisRückseiteUrl ? <Link href={guestData.hauptgastAusweisRückseiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Ansehen</Link> : display(null)}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader><CardTitle className="text-lg">Zahlungsinformationen</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>Zahlungsart:</strong> {display(guestData?.zahlungsart)}</p>
          <p><strong>Anzahlungsbetrag (30%):</strong> {formatCurrency(guestData?.zahlungsbetrag)}</p>
          <p><strong>Zahlungsdatum:</strong> {formatDateDisplay(guestData?.zahlungsdatum) || display(null)}</p>
          <p><strong>Zahlungsbeleg:</strong> {guestData?.zahlungsbelegUrl ? <Link href={guestData.zahlungsbelegUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Ansehen</Link> : display(null)}</p>
          <p><strong>Zahlungsstatus:</strong> <Badge variant={bookingDetails?.status === "Confirmed" ? "default" : "secondary"}>{bookingDetails?.status === "Confirmed" ? "Bezahlt (Bestätigt)" : "Ausstehend"}</Badge></p>
        </CardContent>
      </Card>

      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-start space-x-3">
          <Checkbox id="agbAkzeptiert" name="agbAkzeptiert" defaultChecked={guestData?.agbAkzeptiert} />
          <Label htmlFor="agbAkzeptiert" className="text-sm">
            Ich akzeptiere die <Link href="/agb" target="_blank" className="underline text-primary">Allgemeinen Geschäftsbedingungen</Link>.*
          </Label>
        </div>
        {getErrorMessage("agbAkzeptiert", formState.errors) && <p className="text-xs text-destructive -mt-2 ml-9">{getErrorMessage("agbAkzeptiert", formState.errors)}</p>}
        
        <div className="flex items-start space-x-3">
            <Checkbox id="datenschutzAkzeptiert" name="datenschutzAkzeptiert" defaultChecked={guestData?.datenschutzAkzeptiert} />
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

  const initialStepFromDb = useMemo(() => {
    return initialBookingDetails?.guestSubmittedData?.lastCompletedStep || 0;
  }, [initialBookingDetails?.guestSubmittedData?.lastCompletedStep]);
  
  const [currentStep, setCurrentStep] = useState(initialStepFromDb);
  const [latestGuestSubmittedData, setLatestGuestSubmittedData] = useState<GuestSubmittedData | null | undefined>(initialBookingDetails?.guestSubmittedData);


  console.log(`[GuestBookingFormStepper] Rendering. Token: ${bookingToken}. Initial DB Step: ${initialStepFromDb}, Current Client Step: ${currentStep}. Last processed action token: ${lastProcessedActionTokenRef.current}`);
  console.log(`[GuestBookingFormStepper] Initial bookingDetails:`, initialBookingDetails);
  console.log(`[GuestBookingFormStepper] Initial latestGuestSubmittedData:`, latestGuestSubmittedData);


  const steps: Step[] = useMemo(() => [
    { id: "gastdaten", name: "Kontaktdaten", Icon: UserCircle, StepIcon: UserCircle, Content: GastStammdatenStep, action: submitGastStammdatenAction },
    { id: "ausweis", name: "Ausweis", Icon: BookUser, StepIcon: BookUser, Content: AusweisdokumenteStep, action: submitAusweisdokumenteAction },
    { id: "zahlung", name: "Zahlung", Icon: CreditCard, StepIcon: CreditCard, Content: ZahlungsinformationenStep, action: submitZahlungsinformationenAction },
    { id: "uebersicht", name: "Bestätigung", Icon: CheckCircle, StepIcon: CheckCircle, Content: UebersichtBestaetigungStep, action: submitEndgueltigeBestaetigungAction },
  ], []);

  const currentAction = currentStep < steps.length ? steps[currentStep].action.bind(null, bookingToken) : async () => initialFormState;
  const [formState, formAction, isPending] = useActionState(currentAction, initialFormState);

  useEffect(() => {
    console.log("[GuestBookingFormStepper useEffect] formState changed:", JSON.parse(JSON.stringify(formState)));
    console.log(`[GuestBookingFormStepper useEffect] Conditions: success=${formState.success}, actionToken=${formState.actionToken}, lastProcessedToken=${lastProcessedActionTokenRef.current}, currentStep=${currentStep}`);

    if (formState.message && (formState.actionToken !== lastProcessedActionTokenRef.current || !formState.success || (formState.errors && Object.keys(formState.errors).length > 0) )) {
      toast({
        title: formState.success ? "Erfolg" : "Hinweis",
        description: formState.message,
        variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });
    }

    if (formState.success && formState.actionToken && formState.actionToken !== lastProcessedActionTokenRef.current) {
      console.log(`[GuestBookingFormStepper useEffect] Action with token ${formState.actionToken} successful. Last processed token was ${lastProcessedActionTokenRef.current}. Current step: ${currentStep}`);
      lastProcessedActionTokenRef.current = formState.actionToken; 
      
      if (formState.updatedGuestData) {
        console.log("[GuestBookingFormStepper useEffect] Updating latestGuestSubmittedData with:", formState.updatedGuestData);
        setLatestGuestSubmittedData(formState.updatedGuestData);
      }

      if (currentStep < steps.length - 1) {
        console.log(`[GuestBookingFormStepper useEffect] Navigating from step ${currentStep} to ${currentStep + 1}`);
        setCurrentStep(prev => prev + 1);
      } else if (currentStep === steps.length - 1) {
        console.log("[GuestBookingFormStepper useEffect] All interactive steps completed. Finalizing. Moving to success screen.");
        setCurrentStep(steps.length); 
      }
    } else if (formState.success && formState.actionToken && formState.actionToken === lastProcessedActionTokenRef.current) {
        console.log(`[GuestBookingFormStepper useEffect] Action with token ${formState.actionToken} was already processed. No navigation. currentStep: ${currentStep}`);
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
  
  const showSuccessScreen = currentStep >= steps.length || 
                           (initialBookingDetails.status === "Confirmed" && initialBookingDetails.guestSubmittedData?.submittedAt);

  if (showSuccessScreen) {
    console.log(`[GuestBookingFormStepper] Reached final state or booking already confirmed. currentStep: ${currentStep}, booking status: ${initialBookingDetails.status}`);
    const guestName = latestGuestSubmittedData?.gastVorname || initialBookingDetails?.guestFirstName || 'Gast';
    return (
      <>
        <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <PradellLogo className="mb-8" />
            <Card className="w-full shadow-xl">
                <CardHeader className="items-center text-center">
                <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
                <CardTitle className="text-2xl">Buchung abgeschlossen!</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                <CardDescription>
                    Vielen Dank, {guestName}! Ihre Daten wurden erfolgreich übermittelt.
                    {initialBookingDetails.status === "Confirmed" 
                        ? " Ihre Buchung ist nun bestätigt." 
                        : " Ihre Buchung wird vom Hotel geprüft und in Kürze bestätigt."} Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.
                </CardDescription>
                <p className="mt-2">Ihre Buchungsreferenz: <strong>{bookingToken}</strong></p>
                <p className="mt-4 text-muted-foreground">Sie können diese Seite nun schließen oder <Link href="/" className="text-primary underline">zur Startseite</Link> zurückkehren.</p>
                </CardContent>
            </Card>
        </div>
      </>
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
              const StepIconComponent = step.StepIcon; 
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
                <span className={cn(
                  "flex flex-col items-center justify-center text-center",
                )}>
                  <span className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-full text-sm shrink-0 mb-1 lg:w-10 lg:h-10",
                      index < currentStep ? "bg-primary text-primary-foreground" :
                      index === currentStep ? "bg-primary text-primary-foreground ring-4 ring-primary/30" :
                      "bg-muted text-muted-foreground border"
                  )}>
                    {index < currentStep ? <Check className="w-5 h-5" /> : (StepIconComponent ? <StepIconComponent className="w-5 h-5"/> : index +1) }
                  </span>
                  <span className={cn(
                      "text-xs px-1", 
                       index <= currentStep ? "text-primary" : "text-muted-foreground"
                  )}>
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
                {CurrentStepIconComponent && <CurrentStepIconComponent className="w-6 h-6 mr-3 text-primary"/>}
                {steps[currentStep].name}
              </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Das key-Attribut hier ist entscheidend, um den Form-State bei Schrittwechsel zurückzusetzen */}
            <form action={formAction} key={currentStep}> 
              <ActiveStepContent
                bookingToken={bookingToken}
                bookingDetails={initialBookingDetails}
                guestData={latestGuestSubmittedData}  
                formState={formState}
                currentActionToken={lastProcessedActionTokenRef.current || initialFormState.actionToken}
              />
              {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
                <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2"/> {formState.message}
                </div>
              )}
               <div className="flex justify-between items-center mt-8 pt-6 border-t">
                {currentStep > 0 ? (
                    <Button variant="outline" onClick={() => {
                        console.log(`[GuestBookingFormStepper] Back button clicked. Current step: ${currentStep}, moving to ${currentStep -1}`);
                        setCurrentStep(prev => prev -1);
                    }} type="button" disabled={isPending}>
                        Zurück
                    </Button>
                ) : <div></div> 
                }
                
                <Button type="submit" disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 
                     (currentStep === steps.length -1 ? "Buchung abschließen & Bestätigen" : `Weiter zu Schritt ${currentStep + 2}`)}
                </Button>
               </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
