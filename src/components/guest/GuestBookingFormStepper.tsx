
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
    AlertCircle, Check, CheckCircle, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, 
    ShieldCheck, Info, CreditCard, ShieldQuestion, FileText, BookUser, Landmark, Euro, Percent, 
    CheckCircle2, WalletCards, User as UserIcon, Image as ImageIcon, Upload, 
    CalendarIcon as LucideCalendarIcon, ChevronRight, ChevronLeft, Users2, Trash2, PlusCircle, Copy, CloudUpload 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  submitGastStammdatenAction,
  submitMitreisendeAction,
  submitPaymentAmountSelectionAction,
  submitZahlungsinformationenAction,
  submitEndgueltigeBestaetigungAction
} from "@/lib/actions";
import type { Booking, GuestSubmittedData, Mitreisender as MitreisenderData } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format, parseISO, isValid, differenceInYears } from 'date-fns';
import { de } from 'date-fns/locale';
import { PradellLogo } from "@/components/shared/PradellLogo";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NextImage from "next/image";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";


export type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
  actionToken?: string;
  updatedGuestData?: GuestSubmittedData | null;
  currentStep?: number; // 0-indexed
};

const initialFormState: FormState = { message: null, errors: null, success: false, actionToken: undefined, updatedGuestData: null, currentStep: -1 };

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
    return String(dateString); // Fallback if parsing fails
  }
};

const formatCurrency = (amount?: number) => {
  if (typeof amount !== 'number') return "N/A";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};

// Helper to get filename from Firebase Storage URL
const getFileNameFromFirebaseUrl = (url?: string) => {
    if (!url) return "Keine Datei ausgewählt";
    if (url.startsWith('https://firebasestorage.googleapis.com')) {
        try {
            const decodedUrl = decodeURIComponent(url);
            const pathSegments = new URL(decodedUrl).pathname.split('/');
            const lastSegmentEncoded = pathSegments.pop()?.split('?')[0];
            if (lastSegmentEncoded) {
                 // Remove timestamp prefix like "1234567890123_"
                 return lastSegmentEncoded.substring(lastSegmentEncoded.indexOf('_') + 1) || lastSegmentEncoded;
            }
        } catch (e) { console.error("Error parsing filename from Firebase URL", e); }
    }
    return "Datei hochgeladen"; // Fallback for non-Firebase or malformed URLs
};

interface StepCommonProps {
  bookingToken: string;
  initialBookingDetails: Booking; // Original booking details, remains constant
  guestData: GuestSubmittedData | null | undefined; // Latest submitted data, updated across steps
  formState: FormState;
  // setLatestGuestSubmittedData: React.Dispatch<React.SetStateAction<GuestSubmittedData | null | undefined>>; // Not needed if formState.updatedGuestData is used
  // setCurrentStep: React.Dispatch<React.SetStateAction<number>>; // Handled by main component
}

// --- Step 1: Hauptgast Details & Ausweis ---
const HauptgastDetailsStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  const [vorderseiteFileName, setVorderseiteFileName] = useState<string>(() => getFileNameFromFirebaseUrl(guestData?.hauptgastAusweisVorderseiteUrl));
  const [rueckseiteFileName, setRueckseiteFileName] = useState<string>(() => getFileNameFromFirebaseUrl(guestData?.hauptgastAusweisRückseiteUrl));

  useEffect(() => {
    setVorderseiteFileName(getFileNameFromFirebaseUrl(guestData?.hauptgastAusweisVorderseiteUrl));
    setRueckseiteFileName(getFileNameFromFirebaseUrl(guestData?.hauptgastAusweisRückseiteUrl));
  }, [guestData?.hauptgastAusweisVorderseiteUrl, guestData?.hauptgastAusweisRückseiteUrl]);


  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <PradellLogo className="mb-4 mx-auto" />
        <p className="text-muted-foreground">Schön, dass Sie bei uns buchen möchten! Bitte vervollständigen Sie Ihre Angaben.</p>
      </div>
      
      <h3 className="text-lg font-semibold flex items-center"><UserCircle className="w-6 h-6 mr-2 text-primary" />Ihre Daten (Hauptbucher)</h3>
      <p className="text-sm text-muted-foreground -mt-4">Bitte geben Sie Ihre persönlichen Daten ein.</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
         <div>
          <Label htmlFor="anrede" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Anrede *</Label>
          <Select name="anrede" defaultValue={guestData?.anrede || "Frau"}>
            <SelectTrigger id="anrede" className="mt-1">
              <SelectValue placeholder="Anrede auswählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Frau">Frau</SelectItem>
              <SelectItem value="Herr">Herr</SelectItem>
              <SelectItem value="Divers">Divers</SelectItem>
            </SelectContent>
          </Select>
          {getErrorMessage("anrede", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("anrede", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="gastVorname" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Vorname *</Label>
          <Input id="gastVorname" name="gastVorname" defaultValue={guestData?.gastVorname || initialBookingDetails?.guestFirstName || ""} placeholder="Max" className="mt-1"/>
          {getErrorMessage("gastVorname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastVorname", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="gastNachname" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Nachname *</Label>
          <Input id="gastNachname" name="gastNachname" defaultValue={guestData?.gastNachname || initialBookingDetails?.guestLastName || ""} placeholder="Mustermann" className="mt-1"/>
          {getErrorMessage("gastNachname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastNachname", formState.errors)}</p>}
        </div>
         <div>
          <Label htmlFor="geburtsdatum" className="flex items-center text-sm"><LucideCalendarIcon className="w-4 h-4 mr-2 text-muted-foreground" />Geburtsdatum</Label>
          <Input id="geburtsdatum" name="geburtsdatum" type="date" defaultValue={guestData?.geburtsdatum || ""} className="mt-1"/>
          {getErrorMessage("geburtsdatum", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("geburtsdatum", formState.errors)}</p>}
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
            <Label htmlFor="alterHauptgast" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Alter (in Jahren)</Label>
            <Input id="alterHauptgast" name="alterHauptgast" type="number" defaultValue={guestData?.alterHauptgast || ""} placeholder="z.B. 30" className="mt-1"/>
            {getErrorMessage("alterHauptgast", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("alterHauptgast", formState.errors)}</p>}
        </div>
      </div>
      
      <Separator className="my-6"/>

      <h3 className="text-lg font-semibold flex items-center"><BookUser className="w-6 h-6 mr-2 text-primary"/>Ausweisdokumente (Optional)</h3>
       <p className="text-sm text-muted-foreground -mt-4">Foto eines gültigen Ausweisdokuments aufnehmen oder hochladen. Max. 10MB (JPG, PNG, WEBP, PDF)</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-2">
            <Label htmlFor="hauptgastAusweisVorderseiteFile" className="text-sm font-medium">Vorderseite</Label>
            <div className="flex items-center gap-3">
                <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Label htmlFor="hauptgastAusweisVorderseiteFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei wählen</Label>
                </Button>
                <Input id="hauptgastAusweisVorderseiteFile" name="hauptgastAusweisVorderseiteFile" type="file" className="hidden" onChange={(e) => setVorderseiteFileName(e.target.files?.[0]?.name || getFileNameFromFirebaseUrl(guestData?.hauptgastAusweisVorderseiteUrl))} accept="image/jpeg,image/png,image/webp,application/pdf" />
                <span className="text-sm text-muted-foreground truncate max-w-xs">{vorderseiteFileName}</span>
            </div>
            {getErrorMessage("hauptgastAusweisVorderseiteFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisVorderseiteFile", formState.errors)}</p>}
        </div>

        <div className="space-y-2">
            <Label htmlFor="hauptgastAusweisRückseiteFile" className="text-sm font-medium">Rückseite</Label>
            <div className="flex items-center gap-3">
                <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Label htmlFor="hauptgastAusweisRückseiteFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei wählen</Label>
                </Button>
                <Input id="hauptgastAusweisRückseiteFile" name="hauptgastAusweisRückseiteFile" type="file" className="hidden" onChange={(e) => setRueckseiteFileName(e.target.files?.[0]?.name || getFileNameFromFirebaseUrl(guestData?.hauptgastAusweisRückseiteUrl))} accept="image/jpeg,image/png,image/webp,application/pdf" />
                <span className="text-sm text-muted-foreground truncate max-w-xs">{rueckseiteFileName}</span>
            </div>
            {getErrorMessage("hauptgastAusweisRückseiteFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisRückseiteFile", formState.errors)}</p>}
        </div>
      </div>
      
      <div className="p-4 border border-muted rounded-lg bg-muted/20 text-sm text-muted-foreground flex items-start gap-3 mt-8">
        <ShieldCheck className="w-5 h-5 mt-0.5 text-primary flex-shrink-0"/>
        <p>Die Vertraulichkeit und der Schutz Ihrer persönlichen Daten haben für uns höchste Priorität. Ihre übermittelten Ausweisdokumente und Fotos werden von uns gemäß den geltenden Datenschutzgesetzen, insbesondere der Datenschutz-Grundverordnung (DSGVO), behandelt.</p>
      </div>
    </div>
  );
};

// --- Step 2: Mitreisende ---
interface CompanionFormState extends MitreisenderData {
  // Client-side only fields for file inputs
  file_vorderseite?: File | null;
  file_rueckseite?: File | null;
  fileName_vorderseite?: string;
  fileName_rueckseite?: string;
}

const MitreisendeStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  const [companions, setCompanions] = useState<CompanionFormState[]>(() => {
    return (guestData?.mitreisende || []).map(c => ({ 
        ...c, 
        fileName_vorderseite: getFileNameFromFirebaseUrl(c.ausweisVorderseiteUrl), 
        fileName_rueckseite: getFileNameFromFirebaseUrl(c.ausweisRückseiteUrl) 
    }));
  });

   useEffect(() => {
    // Sync companions if guestData changes from server (e.g., after an error and re-fetch)
    setCompanions((guestData?.mitreisende || []).map(c => ({ 
        ...c, 
        fileName_vorderseite: getFileNameFromFirebaseUrl(c.ausweisVorderseiteUrl), 
        fileName_rueckseite: getFileNameFromFirebaseUrl(c.ausweisRückseiteUrl) 
    })));
  }, [guestData?.mitreisende]);


  const handleAddCompanion = () => {
    setCompanions([...companions, { id: Date.now().toString(), vorname: '', nachname: '', fileName_vorderseite: 'Keine Datei ausgewählt', fileName_rueckseite: 'Keine Datei ausgewählt' }]);
  };

  const handleRemoveCompanion = (id: string) => {
    setCompanions(companions.filter(c => c.id !== id));
  };

  const handleCompanionChange = (id: string, field: 'vorname' | 'nachname', value: string) => {
    setCompanions(companions.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleCompanionFileChange = (id: string, field: 'file_vorderseite' | 'file_rueckseite', file: File | null) => {
    const fileNameField = field === 'file_vorderseite' ? 'fileName_vorderseite' : 'fileName_rueckseite';
    const urlField = field === 'file_vorderseite' ? 'ausweisVorderseiteUrl' : 'ausweisRückseiteUrl';
    setCompanions(
      companions.map(c =>
        c.id === id ? { ...c, [field]: file, [fileNameField]: file?.name || getFileNameFromFirebaseUrl((c as any)[urlField]) } : c
      )
    );
  };
  
  const gesamtPersonen = initialBookingDetails.rooms?.reduce((sum, room) => sum + (room.erwachsene || 0) + (room.kinder || 0) + (room.kleinkinder || 0), 0) || 1; // Fallback to 1 if no room data

  return (
    <div className="space-y-6">
       {/* Hidden input to send metadata about companions for server-side processing */}
       <input type="hidden" name="mitreisendeMeta" value={JSON.stringify(companions.map(c => ({id: c.id, vorname: c.vorname, nachname: c.nachname})))} />
       
      <h3 className="text-lg font-semibold flex items-center"><Users2 className="w-6 h-6 mr-2 text-primary"/>Weitere Mitreisende</h3>
      <p className="text-sm text-muted-foreground -mt-4">
         Fügen Sie hier die Daten aller weiteren Personen hinzu (optional). Ihre Buchung umfasst insgesamt {gesamtPersonen} Person(en) (inkl. Hauptgast).
      </p>

      <Card>
        <CardContent className="pt-6 space-y-6">
          {companions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Keine weiteren Mitreisenden angegeben.</p>
          )}
          {companions.map((comp, index) => (
            <div key={comp.id} className="p-4 border rounded-md relative space-y-4 bg-background shadow-sm">
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveCompanion(comp.id!)}>
                <Trash2 className="h-4 w-4" /> <span className="sr-only">Gast entfernen</span>
              </Button>
              <h4 className="font-medium text-md">Mitreisender {index + 1}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor={`mitreisende_${comp.id}_vorname`}>Vorname *</Label>
                  <Input id={`mitreisende_${comp.id}_vorname`} name={`mitreisende_${comp.id}_vorname`} value={comp.vorname} onChange={(e) => handleCompanionChange(comp.id!, 'vorname', e.target.value)} className="mt-1" />
                  {getErrorMessage(`mitreisende_${comp.id}_vorname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende_${comp.id}_vorname`, formState.errors)}</p>}
                </div>
                <div>
                  <Label htmlFor={`mitreisende_${comp.id}_nachname`}>Nachname *</Label>
                  <Input id={`mitreisende_${comp.id}_nachname`} name={`mitreisende_${comp.id}_nachname`} value={comp.nachname} onChange={(e) => handleCompanionChange(comp.id!, 'nachname', e.target.value)} className="mt-1" />
                   {getErrorMessage(`mitreisende_${comp.id}_nachname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende_${comp.id}_nachname`, formState.errors)}</p>}
                </div>
              </div>
              <div className="space-y-3 pt-2">
                <Label className="text-sm font-medium">Ausweisdokument (Optional)</Label>
                <div className="space-y-2">
                   <Label htmlFor={`mitreisende_${comp.id}_ausweisVorderseiteFile`} className="text-xs text-muted-foreground">Vorderseite</Label>
                   <div className="flex items-center gap-3">
                     <Button asChild variant="outline" size="sm" className="shrink-0">
                       <Label htmlFor={`mitreisende_${comp.id}_ausweisVorderseiteFile`} className="cursor-pointer flex items-center"><Upload className="w-3 h-3 mr-1.5" /> Wählen</Label>
                     </Button>
                     <Input id={`mitreisende_${comp.id}_ausweisVorderseiteFile`} name={`mitreisende_${comp.id}_ausweisVorderseiteFile`} type="file" className="hidden" onChange={(e) => handleCompanionFileChange(comp.id!, 'file_vorderseite', e.target.files?.[0] || null)} accept="image/jpeg,image/png,image/webp,application/pdf" />
                     <span className="text-xs text-muted-foreground truncate max-w-[150px] sm:max-w-xs">{comp.fileName_vorderseite}</span>
                   </div>
                </div>
                 <div className="space-y-2">
                   <Label htmlFor={`mitreisende_${comp.id}_ausweisRückseiteFile`} className="text-xs text-muted-foreground">Rückseite</Label>
                   <div className="flex items-center gap-3">
                     <Button asChild variant="outline" size="sm" className="shrink-0">
                       <Label htmlFor={`mitreisende_${comp.id}_ausweisRückseiteFile`} className="cursor-pointer flex items-center"><Upload className="w-3 h-3 mr-1.5" /> Wählen</Label>
                     </Button>
                     <Input id={`mitreisende_${comp.id}_ausweisRückseiteFile`} name={`mitreisende_${comp.id}_ausweisRückseiteFile`} type="file" className="hidden" onChange={(e) => handleCompanionFileChange(comp.id!, 'file_rueckseite', e.target.files?.[0] || null)} accept="image/jpeg,image/png,image/webp,application/pdf" />
                     <span className="text-xs text-muted-foreground truncate max-w-[150px] sm:max-w-xs">{comp.fileName_rueckseite}</span>
                   </div>
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={handleAddCompanion} className="w-full sm:w-auto mt-4">
            <PlusCircle className="mr-2 h-4 w-4" /> Weiteren Gast hinzufügen
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};


// --- Step 3: Zahlungssumme wählen ---
const ZahlungssummeWaehlenStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  const anzahlungsbetrag = useMemo(() => {
    const price = initialBookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [initialBookingDetails?.price]);

  const gesamtbetrag = useMemo(() => {
    return initialBookingDetails?.price || 0;
  }, [initialBookingDetails?.price]);

  const defaultSelection = guestData?.paymentAmountSelection || "full_amount";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center"><WalletCards className="w-6 h-6 mr-2 text-primary"/>Zahlungssumme wählen</h3>
        <p className="text-sm text-muted-foreground -mt-0">Wählen Sie Ihre bevorzugte Zahlungssumme.</p>
      </div>

      <RadioGroup name="paymentAmountSelection" defaultValue={defaultSelection} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <RadioGroupItem value="downpayment" id="downpayment" className="peer sr-only" />
          <Label
            htmlFor="downpayment"
            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
          >
            <div className="flex items-center justify-between w-full mb-2">
              <span className="font-semibold">Anzahlung (30%)</span>
              <CheckCircle2 className={cn("h-5 w-5 text-primary opacity-0", "peer-data-[state=checked]:opacity-100" )} />
            </div>
            <p className="text-2xl font-bold">{formatCurrency(anzahlungsbetrag)}</p>
          </Label>
        </div>
        <div>
          <RadioGroupItem value="full_amount" id="full_amount" className="peer sr-only" />
          <Label
            htmlFor="full_amount"
            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
          >
             <div className="flex items-center justify-between w-full mb-2">
              <span className="font-semibold">Gesamtbetrag (100%)</span>
              <CheckCircle2 className={cn("h-5 w-5 text-primary opacity-0", "peer-data-[state=checked]:opacity-100" )} />
            </div>
            <p className="text-2xl font-bold">{formatCurrency(gesamtbetrag)}</p>
          </Label>
        </div>
      </RadioGroup>
      {getErrorMessage("paymentAmountSelection", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("paymentAmountSelection", formState.errors)}</p>}
    </div>
  );
};


// --- Step 4: Zahlungsinformationen (Banküberweisung) ---
const ZahlungsinformationenStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  const { toast } = useToast();
  const [fileNameBeleg, setFileNameBeleg] = useState<string>(() => getFileNameFromFirebaseUrl(guestData?.zahlungsbelegUrl));

   useEffect(() => {
    setFileNameBeleg(getFileNameFromFirebaseUrl(guestData?.zahlungsbelegUrl));
  }, [guestData?.zahlungsbelegUrl]);

  const anzahlungsbetrag = useMemo(() => {
    const price = initialBookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [initialBookingDetails?.price]);

  const zuZahlenderBetrag = guestData?.paymentAmountSelection === 'downpayment' ? anzahlungsbetrag : (initialBookingDetails?.price || 0);
  
  // Use a ref to store the calculated amount for the hidden input field
  // This ensures the value submitted in the form is the one calculated when the component mounts or zuZahlenderBetrag changes.
  const zahlungsbetragFuerFormular = useRef(zuZahlenderBetrag);
  useEffect(() => {
    zahlungsbetragFuerFormular.current = zuZahlenderBetrag;
  }, [zuZahlenderBetrag]);


  const bankDetails = {
    bankName: "Raiffeisen Überwasser",
    kontoName: "Pradell GmbH",
    iban: "IT74T3467673600007473467673", 
    swift: "RZBRIT2BXXX", 
  };

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Kopiert!", description: `${fieldName} wurde in die Zwischenablage kopiert.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht in die Zwischenablage kopieren." });
    }
  };

  return (
    <div className="space-y-6 text-center">
      <PradellLogo className="mx-auto mb-4" />
      <h2 className="text-3xl font-bold flex items-center justify-center"><CreditCard className="w-8 h-8 mr-3 text-primary"/>Banküberweisung</h2>
      <p className="text-muted-foreground">
        Fast geschafft! Bitte führen Sie die Überweisung durch und laden Sie anschließend Ihren Zahlungsbeleg hoch.
      </p>

      <Card className="text-left shadow-md">
        <CardContent className="pt-6 space-y-3">
          {Object.entries(bankDetails).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center">
              <div>
                <span className="text-sm text-muted-foreground block">
                  {key === 'bankName' && 'Bank Name'}
                  {key === 'kontoName' && 'Konto Name'}
                  {key === 'iban' && 'IBAN'}
                  {key === 'swift' && 'Swift'}
                </span>
                <span className="font-medium">{value}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(value, key)}>
                <Copy className="h-4 w-4 mr-2" /> Kopieren
              </Button>
            </div>
          ))}
          <div className="flex justify-between items-center pt-2 border-t">
            <div>
              <span className="text-sm text-muted-foreground block">Betrag</span>
              <span className="font-bold text-lg">{formatCurrency(zuZahlenderBetrag)}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(zuZahlenderBetrag.toString(), 'Betrag')}>
              <Copy className="h-4 w-4 mr-2" /> Kopieren
            </Button>
          </div>
        </CardContent>
      </Card>
      { guestData?.paymentAmountSelection === 'downpayment' && <p className="text-xs text-center text-muted-foreground -mt-2">Der Restbetrag ist vor Ort im Hotel zu begleichen.</p>}


      <div className="mt-8 space-y-2">
        <p className="text-muted-foreground">
          Bitte laden Sie den Zahlungsbeleg (z. B. PDF der Überweisung) hoch, damit wir Ihre Zahlung schnell bearbeiten können.
        </p>
        <Label
          htmlFor="zahlungsbelegFile"
          className="mx-auto flex flex-col items-center justify-center w-full max-w-xs h-32 border-2 border-dashed border-primary/50 rounded-lg cursor-pointer bg-card hover:bg-muted/30 transition-colors"
        >
          <CloudUpload className="h-10 w-10 text-primary mb-2" />
          <span className="text-sm text-primary font-medium">pdf/foto</span>
          <span className="text-xs text-muted-foreground mt-1 truncate max-w-[90%] px-2">{fileNameBeleg}</span>
        </Label>
        <Input id="zahlungsbelegFile" name="zahlungsbelegFile" type="file" className="hidden" onChange={(e) => setFileNameBeleg(e.target.files?.[0]?.name || getFileNameFromFirebaseUrl(guestData?.zahlungsbelegUrl))} accept="image/jpeg,image/png,image/webp,application/pdf" />
        {getErrorMessage("zahlungsbelegFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsbelegFile", formState.errors)}</p>}
      </div>
      {/* This hidden input ensures the calculated amount is submitted with the form */}
      <Input type="hidden" name="zahlungsbetrag" value={zahlungsbetragFuerFormular.current} />
    </div>
  );
};

// --- Step 5: Übersicht & Bestätigung ---
const UebersichtBestaetigungStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  
  const renderDocumentLink = (url?: string, altText?: string, hint?: string) => {
    if (!url) return <span className="italic text-muted-foreground">N/A</span>;

    let fileNameFromUrl = getFileNameFromFirebaseUrl(url);
    
    if (url.startsWith('https://firebasestorage.googleapis.com')) {
        const isImage = /\.(jpeg|jpg|gif|png|webp)(\?|$)/i.test(url) || url.includes('image%2F') || url.includes('image%2f');
        const isPdf = /\.pdf(\?|$)/i.test(url) || url.includes('application%2Fpdf') || url.includes('application%2fpdf');

        if (isImage) {
            return (
                <div className="flex flex-col items-start gap-1 mt-1">
                    <NextImage src={url} alt={altText || 'Hochgeladenes Bild'} width={100} height={60} className="rounded border object-contain" data-ai-hint={hint || "document image"}/>
                    <Link href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                       {fileNameFromUrl} (ansehen)
                    </Link>
                </div>
            );
        } else if (isPdf) {
            return (
                <Link href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center" title={`PDF ansehen: ${fileNameFromUrl}`}>
                  <FileText className="w-4 h-4 mr-1 flex-shrink-0" /> {fileNameFromUrl}
                </Link>
              );
        } else { 
             return (
                <Link href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center" title={`Datei ansehen: ${fileNameFromUrl}`}>
                    <FileText className="w-4 h-4 mr-1 flex-shrink-0" /> {fileNameFromUrl}
                </Link>
            );
        }
    }
    // Fallback for non-Firebase URLs or if type cannot be determined
    return <span className="italic text-muted-foreground">Link: {fileNameFromUrl}</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center"><CheckCircle className="w-6 h-6 mr-2 text-primary"/>Übersicht und Bestätigung</h3>
        <p className="text-sm text-muted-foreground -mt-0">Bitte überprüfen Sie Ihre Angaben sorgfältig, bevor Sie die Buchung abschließen.</p>
      </div>
      
      <Card>
        <CardHeader><CardTitle className="text-lg">Hauptgast</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div><strong>Anrede:</strong> {guestData?.anrede || 'N/A'}</div>
          <div><strong>Name:</strong> {guestData?.gastVorname || ''} {guestData?.gastNachname || ''}</div>
          <div><strong>Geburtsdatum:</strong> {formatDateDisplay(guestData?.geburtsdatum)}</div>
          <div><strong>Alter:</strong> {guestData?.alterHauptgast ? `${guestData.alterHauptgast} Jahre` : 'N/A'}</div>
          <div><strong>E-Mail:</strong> {guestData?.email || 'N/A'}</div>
          <div><strong>Telefon:</strong> {guestData?.telefon || 'N/A'}</div>
          <Separator className="my-2 !mt-3" />
          <h4 className="font-medium pt-1">Ausweisdokument Hauptgast</h4>
          <div><strong>Vorderseite:</strong> {renderDocumentLink(guestData?.hauptgastAusweisVorderseiteUrl, "Ausweis Vorderseite", "identification document")}</div>
          <div><strong>Rückseite:</strong> {renderDocumentLink(guestData?.hauptgastAusweisRückseiteUrl, "Ausweis Rückseite", "identification document")}</div>
        </CardContent>
      </Card>

      {guestData?.mitreisende && guestData.mitreisende.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Mitreisende</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {guestData.mitreisende.map((mitreisender, index) => (
              <div key={mitreisender.id || index} className="text-sm border-b pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0">
                <h5 className="font-medium">Mitreisender {index + 1}</h5>
                <p><strong>Name:</strong> {mitreisender.vorname || ''} {mitreisender.nachname || ''}</p>
                <p><strong>Ausweis Vorderseite:</strong> {renderDocumentLink(mitreisender.ausweisVorderseiteUrl, `Ausweis Mitr. ${index+1} Vorderseite`, "identification document")}</p>
                <p><strong>Ausweis Rückseite:</strong> {renderDocumentLink(mitreisender.ausweisRückseiteUrl, `Ausweis Mitr. ${index+1} Rückseite`, "identification document")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Zahlungsinformationen</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div><strong>Auswahl Zahlungssumme:</strong> {guestData?.paymentAmountSelection === 'downpayment' ? 'Anzahlung (30%)' : (guestData?.paymentAmountSelection === 'full_amount' ? 'Gesamtbetrag (100%)' : 'N/A')}</div>
          <div><strong>Zahlungsart:</strong> {guestData?.zahlungsart || 'N/A'}</div>
          <div><strong>Überwiesener Betrag:</strong> {formatCurrency(guestData?.zahlungsbetrag)}</div>
          <div><strong>Zahlungsbeleg:</strong> {renderDocumentLink(guestData?.zahlungsbelegUrl, "Zahlungsbeleg", "payment proof")}</div>
           <div className="font-medium">
             <strong>Zahlungsstatus:</strong>{' '}
            <Badge
                variant={
                    (initialBookingDetails?.status === "Confirmed" && guestData?.submittedAt)
                    ? "default" 
                    : guestData?.zahlungsbelegUrl
                        ? "secondary" 
                        : "outline" 
                }
                className={cn(
                    (initialBookingDetails?.status === "Confirmed" && guestData?.submittedAt) && "bg-green-500 hover:bg-green-600 text-white",
                    (!(initialBookingDetails?.status === "Confirmed" && guestData?.submittedAt) && guestData?.zahlungsbelegUrl) && "bg-yellow-500 hover:bg-yellow-600 text-black"
                )}
                >
                {(initialBookingDetails?.status === "Confirmed" && guestData?.submittedAt)
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
  name: string; // Title for the step card header
  label: string; // Short label for the stepper progress display
  Icon: React.ElementType; // Icon for the stepper progress display
  Content: React.FC<StepCommonProps>;
  action: (bookingToken: string, prevState: FormState, formData: FormData) => Promise<FormState>;
}

const BookingSummaryCard: React.FC<{ bookingDetails?: Booking | null }> = ({ bookingDetails }) => {
  if (!bookingDetails) return null;
  
  const getPersonenTextForRoom = (room: Booking['rooms'] extends (infer R)[] | undefined ? (R | undefined) : never): string => {
    if (!room) return "N/A";
    let textParts: string[] = [];
    if (room.erwachsene && room.erwachsene > 0) textParts.push(`${room.erwachsene} Erw.`);
    if (room.kinder && room.kinder > 0) textParts.push(`${room.kinder} Ki.`);
    if (room.kleinkinder && room.kleinkinder > 0) textParts.push(`${room.kleinkinder} Kk.`);
    return textParts.length > 0 ? textParts.join(', ') : "Details nicht verfügbar";
  };

  const ersteZimmerdetails = bookingDetails.rooms && bookingDetails.rooms.length > 0 
    ? `${bookingDetails.rooms[0].zimmertyp} (${getPersonenTextForRoom(bookingDetails.rooms[0])})` 
    : bookingDetails.roomIdentifier;

  return (
    <Card className="mb-8 bg-muted/20 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">Ihre Buchungsübersicht (vom Hotel)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><strong className="block text-xs text-muted-foreground">Gast (Hauptbucher)</strong> {bookingDetails.guestFirstName} {bookingDetails.guestLastName}</div>
        <div><strong className="block text-xs text-muted-foreground">Anreise</strong> {formatDateDisplay(bookingDetails.checkInDate)}</div>
        <div><strong className="block text-xs text-muted-foreground">Abreise</strong> {formatDateDisplay(bookingDetails.checkOutDate)}</div>
        <div className="sm:col-span-2"><strong className="block text-xs text-muted-foreground">Zimmer</strong> {ersteZimmerdetails}</div>
        <div><strong className="block text-xs text-muted-foreground">Verpflegung</strong> {bookingDetails.verpflegung || 'Keine Angabe'}</div>
        <div><strong className="block text-xs text-muted-foreground">Preis</strong> {formatCurrency(bookingDetails.price)}</div>
      </CardContent>
    </Card>
  );
};


export function GuestBookingFormStepper({ bookingToken, bookingDetails: initialBookingDetailsProp }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const { toast } = useToast();
  const lastProcessedActionTokenRef = useRef<string | undefined>(undefined);

  const [initialBookingDetails, setInitialBookingDetails] = useState<Booking | null | undefined>(initialBookingDetailsProp);
  // State to hold the latest version of guest-submitted data, updated after each successful step
  const [latestGuestSubmittedData, setLatestGuestSubmittedData] = useState<GuestSubmittedData | null | undefined>(
    initialBookingDetailsProp?.guestSubmittedData
  );

  useEffect(() => {
    // Update local state if the prop changes (e.g., after initial server fetch)
    setInitialBookingDetails(initialBookingDetailsProp);
    setLatestGuestSubmittedData(initialBookingDetailsProp?.guestSubmittedData);
  }, [initialBookingDetailsProp]);

  const steps: Step[] = useMemo(() => [
    { id: "hauptgast", name: "Hauptgast & Ausweis", label: "Hauptgast", Icon: UserCircle, Content: HauptgastDetailsStep, action: submitGastStammdatenAction },
    { id: "mitreisende", name: "Mitreisende", label: "Mitreisende", Icon: Users2, Content: MitreisendeStep, action: submitMitreisendeAction },
    { id: "zahlungssumme", name: "Zahlungssumme", label: "Zahlungswahl", Icon: WalletCards, Content: ZahlungssummeWaehlenStep, action: submitPaymentAmountSelectionAction },
    { id: "zahlung", name: "Banküberweisung & Beleg", label: "Zahlungsinfo", Icon: CreditCard, Content: ZahlungsinformationenStep, action: submitZahlungsinformationenAction },
    { id: "uebersicht", name: "Übersicht & Bestätigung", label: "Bestätigung", Icon: CheckCircle, Content: UebersichtBestaetigungStep, action: submitEndgueltigeBestaetigungAction },
  ], []);

  const stepperLabels = steps.map(s => s.label);
  const totalDisplaySteps = stepperLabels.length;

  const initialStepFromDb = useMemo(() => {
    const lastStep = latestGuestSubmittedData?.lastCompletedStep; // 0-indexed
    console.log(`[GuestBookingFormStepper] Initializing: lastCompletedStep from DB/latestGuestData: ${lastStep}`);
    if (typeof lastStep === 'number' && lastStep >= 0) {
      if (lastStep >= steps.length - 1) { // Already completed all defined steps
        return steps.length; // Go to "completed" state
      }
      return lastStep + 1; // Start at the next UNCOMPLETED step (0-indexed)
    }
    return 0; // Start at the first step (0-indexed)
  }, [latestGuestSubmittedData?.lastCompletedStep, steps.length]);

  const [currentStep, setCurrentStep] = useState(initialStepFromDb);

  useEffect(() => {
    // This effect ensures currentStep is updated if initialStepFromDb changes
    // (e.g., if latestGuestSubmittedData gets updated asynchronously after initial mount)
    setCurrentStep(initialStepFromDb);
  }, [initialStepFromDb]);


 const currentActionFn = useMemo(() => {
    if (currentStep >= 0 && currentStep < steps.length && steps[currentStep]?.action) {
        return steps[currentStep].action.bind(null, bookingToken);
    }
    // Fallback for completed state or invalid step
    return async (prevState: FormState, formData: FormData): Promise<FormState> => ({
        ...initialFormState,
        message: currentStep >= steps.length ? "Alle Schritte bereits abgeschlossen." : "Interner Fehler: Ungültiger Schritt oder Aktion nicht definiert.",
        success: currentStep >= steps.length,
        currentStep: currentStep,
        actionToken: generateActionToken(), // Generate a new token for this dummy action
    });
  }, [currentStep, steps, bookingToken]);

  const [formState, formAction, isPending] = useActionState(currentActionFn, {...initialFormState, currentStep: currentStep});

  useEffect(() => {
    const uniqueActionToken = formState.actionToken;
    console.log(`[GuestBookingFormStepper] formState changed. Current step: ${currentStep}, ActionToken: ${uniqueActionToken}, ProcessedToken: ${lastProcessedActionTokenRef.current}, Success: ${formState.success}, Message: ${formState.message}`);
    
    if (uniqueActionToken && uniqueActionToken !== lastProcessedActionTokenRef.current) {
      console.log(`[GuestBookingFormStepper] Processing new actionToken: ${uniqueActionToken}`);
      lastProcessedActionTokenRef.current = uniqueActionToken;

      if (formState.message) {
        toast({
          title: formState.success ? "Erfolg" : (formState.errors && Object.keys(formState.errors).length > 0 ? "Fehler" : "Hinweis"),
          description: formState.message,
          variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
        });
      }

      if (formState.success) {
        if (formState.updatedGuestData) {
          console.log("[GuestBookingFormStepper] Updating latestGuestSubmittedData from formState.");
          setLatestGuestSubmittedData(formState.updatedGuestData);
        }
        
        // Navigate to next step or completion screen
        if (currentStep < steps.length - 1) {
          console.log("[GuestBookingFormStepper] Moving to next step:", currentStep + 1);
          setCurrentStep(prev => prev + 1);
        } else if (currentStep === steps.length -1) { // Just completed the last defined step
          console.log("[GuestBookingFormStepper] All steps completed, moving to completion screen logic.");
          setCurrentStep(steps.length); // Triggers completion screen
        }
      } else {
        console.warn("[GuestBookingFormStepper] Action was not successful:", formState.message, formState.errors);
        // Optionally reset latestGuestSubmittedData to formState.updatedGuestData if error occurred
        // This ensures the UI reflects the state from the server after an error
        if (formState.updatedGuestData) {
            setLatestGuestSubmittedData(formState.updatedGuestData);
        }
      }
    } else if (formState.message && !uniqueActionToken && !lastProcessedActionTokenRef.current && !formState.success) {
       // Handles initial messages or errors not tied to a specific action token (e.g., from previous state, or initial load error)
       console.log("[GuestBookingFormStepper] Displaying initial/non-action token message:", formState.message);
       toast({
        title: (formState.errors && Object.keys(formState.errors).length > 0 ? "Fehler" : "Hinweis"),
        description: formState.message,
        variant: (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });
    }
  }, [formState, toast, currentStep, steps.length]);


  if (!initialBookingDetails) {
    return (
      <Card className="w-full max-w-lg mx-auto shadow-lg">
        <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Fehler</CardTitle></CardHeader>
        <CardContent><CardDescription>Buchungsdetails konnten nicht geladen werden.</CardDescription></CardContent>
      </Card>
    );
  }

  // Completion condition
  const isCompletedOrConfirmed = currentStep >= steps.length || 
    (initialBookingDetails.status === "Confirmed" &&
     latestGuestSubmittedData?.lastCompletedStep === steps.length -1 && 
     latestGuestSubmittedData?.submittedAt);


  if (isCompletedOrConfirmed) {
    const guestName = latestGuestSubmittedData?.gastVorname || initialBookingDetails?.guestFirstName || 'Gast';
    const isFullyConfirmedBySystem = initialBookingDetails.status === "Confirmed" && latestGuestSubmittedData?.submittedAt;
    
    console.log(`[GuestBookingFormStepper] Rendering completion screen. isFullyConfirmedBySystem: ${isFullyConfirmedBySystem}`);
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8 text-center">
        <PradellLogo className="mb-8 inline-block" />
        <Card className="w-full shadow-xl">
          <CardHeader className="items-center text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <CardTitle className="text-2xl">Buchung {isFullyConfirmedBySystem ? "abgeschlossen und bestätigt" : "Daten übermittelt" }!</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <CardDescription>
              Vielen Dank, {guestName}! Ihre Daten wurden erfolgreich übermittelt.
              {isFullyConfirmedBySystem
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
    console.error(`[GuestBookingFormStepper] Invalid currentStep: ${currentStep}. Steps array length: ${steps.length}. Rendering error/fallback.`);
    return (
        <Card className="w-full max-w-lg mx-auto shadow-lg">
            <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Formularfehler</CardTitle></CardHeader>
            <CardContent><CardDescription>Ein interner Fehler ist aufgetreten (ungültiger Schritt: {currentStep}). Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.</CardDescription></CardContent>
        </Card>
    );
  }

  const ActiveStepContent = steps[currentStep]!.Content;
  const CurrentStepIcon = steps[currentStep]!.Icon;
  const stepNumberForDisplay = currentStep + 1;

  return (
    <>
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
         <div className="text-center mb-4">
             {/* Logo and Title are now part of HauptgastDetailsStep for step 1 */}
             {currentStep > 0 && <PradellLogo className="mb-8 inline-block" />}
            <h1 className={cn("text-2xl font-semibold tracking-tight", currentStep === 0 && "hidden")}>Buchung vervollständigen</h1>
            <p className={cn("text-muted-foreground", currentStep === 0 && "hidden")}>Schritt {stepNumberForDisplay} von {totalDisplaySteps} - {steps[currentStep].label}</p>
        </div>

        {/* Stepper Visual Progress */}
        <div className="mb-10">
            <ol className="flex items-center w-full">
            {steps.map((step, index) => {
                const StepIconComponent = step.Icon;
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;
                return(
                <li
                    key={step.id}
                    className={cn(
                    "flex w-full items-center",
                    index < steps.length - 1 ? "after:content-[''] after:w-full after:h-1 after:border-b after:border-muted after:border-4 after:inline-block" : "",
                    index < steps.length - 1 && (isCompleted || isActive) ? "after:border-primary" : "after:border-muted"
                    )}
                >
                    <span
                    className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-full shrink-0 text-sm font-medium",
                        isActive ? "bg-primary text-primary-foreground ring-4 ring-primary/30" :
                        isCompleted ? "bg-primary/80 text-primary-foreground" :
                        "bg-muted text-muted-foreground border-2"
                    )}
                    >
                    {isCompleted ? <Check className="w-5 h-5" /> : <StepIconComponent className="w-5 h-5" />}
                    </span>
                </li>
                );
            })}
            </ol>
            <div className="flex justify-between text-xs mt-2">
                {steps.map((step, idx) => (
                    <span key={`${step.id}-label`} className={cn(
                        "text-center flex-1 text-muted-foreground",
                        currentStep === idx && "text-primary font-medium"
                        )}>
                        {step.label}
                    </span>
                ))}
            </div>
        </div>
        
        <BookingSummaryCard bookingDetails={initialBookingDetails} />

        <Card className="w-full shadow-xl">
          <CardHeader className="border-b">
              <CardTitle className="text-xl flex items-center">
                {CurrentStepIcon && <CurrentStepIcon className="w-6 h-6 mr-3 text-primary"/>}
                {steps[currentStep].name}
              </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Using key to force re-render of form and its state when step changes */}
            <form action={formAction} key={`${currentStep}-${bookingToken}`} >
              <ActiveStepContent
                bookingToken={bookingToken}
                initialBookingDetails={initialBookingDetails!}
                guestData={latestGuestSubmittedData}
                formState={formState}
              />
              {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
                <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2" /> {formState.message}
                </div>
              )}
              <CardFooter className="flex justify-between mt-8 pt-6 border-t px-0 pb-0">
                <Button type="button" variant="outline" onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))} disabled={isPending || currentStep === 0}>
                    <ChevronLeft className="mr-2 h-4 w-4" /> Zurück
                </Button>
                <Button type="submit" disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (currentStep === steps.length -1 ? (<><CheckCircle className="mr-2 h-4 w-4"/>Buchung abschließen</>) : (<>Weiter <ChevronRight className="ml-2 h-5 w-5" /></>))}
                </Button>
              </CardFooter>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
