
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
    return String(dateString); 
  }
};

const formatCurrency = (amount?: number) => {
  if (typeof amount !== 'number') return "N/A";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};

const getFileNameFromUrl = (url?: string, defaultText = "Keine Datei ausgewählt") => {
    if (!url) return defaultText;
    if (url.startsWith('data:')) return "Bilddatei ausgewählt"; // For Data URIs
    if (url.startsWith('mock-file-url:')) return url.substring('mock-file-url:'.length); // For mock file URLs
    
    try {
        const decodedUrl = decodeURIComponent(url);
        const pathSegments = new URL(decodedUrl).pathname.split('/');
        const lastSegmentEncoded = pathSegments.pop()?.split('?')[0]; 
        if (lastSegmentEncoded) {
             // Remove the timestamp and underscore prefix if present (from Firebase Storage uploads)
             const nameWithoutTimestamp = lastSegmentEncoded.includes('_') ? lastSegmentEncoded.substring(lastSegmentEncoded.indexOf('_') + 1) : lastSegmentEncoded;
             return nameWithoutTimestamp || lastSegmentEncoded; // Fallback to full segment if split fails
        }
    } catch (e) { console.error("Error parsing filename from URL", e); }
    
    // Fallback for other URL types or parsing errors
    const simpleName = url.substring(url.lastIndexOf('/') + 1);
    return simpleName.length > 0 ? (simpleName.length > 30 ? simpleName.substring(0,27) + "..." : simpleName) : defaultText;
};

interface StepCommonProps {
  bookingToken: string;
  initialBookingDetails: Booking; 
  guestData: GuestSubmittedData | null | undefined; 
  formState: FormState;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
}

// --- Step 1: Hauptgast Details & Ausweis ---
const HauptgastDetailsStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  const [vorderseiteFileName, setVorderseiteFileName] = useState<string>(() => getFileNameFromUrl(guestData?.hauptgastAusweisVorderseiteUrl));
  const [rueckseiteFileName, setRueckseiteFileName] = useState<string>(() => getFileNameFromUrl(guestData?.hauptgastAusweisRückseiteUrl));

  useEffect(() => {
    setVorderseiteFileName(getFileNameFromUrl(guestData?.hauptgastAusweisVorderseiteUrl));
    setRueckseiteFileName(getFileNameFromUrl(guestData?.hauptgastAusweisRückseiteUrl));
  }, [guestData?.hauptgastAusweisVorderseiteUrl, guestData?.hauptgastAusweisRückseiteUrl]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Label htmlFor="gastVorname" className="flex items-center text-sm font-medium"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Vorname *</Label>
          <Input id="gastVorname" name="gastVorname" defaultValue={guestData?.gastVorname || initialBookingDetails?.guestFirstName || ""} placeholder="Max" className="mt-1 input-modern"/>
          {getErrorMessage("gastVorname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastVorname", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="gastNachname" className="flex items-center text-sm font-medium"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Nachname *</Label>
          <Input id="gastNachname" name="gastNachname" defaultValue={guestData?.gastNachname || initialBookingDetails?.guestLastName || ""} placeholder="Mustermann" className="mt-1 input-modern"/>
          {getErrorMessage("gastNachname", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("gastNachname", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="email" className="flex items-center text-sm font-medium"><Mail className="w-4 h-4 mr-2 text-muted-foreground" />E-Mail *</Label>
          <Input id="email" name="email" type="email" defaultValue={guestData?.email || ""} placeholder="max.mustermann@email.com" className="mt-1 input-modern"/>
          {getErrorMessage("email", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("email", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="telefon" className="flex items-center text-sm font-medium"><Phone className="w-4 h-4 mr-2 text-muted-foreground" />Telefon *</Label>
          <Input id="telefon" name="telefon" defaultValue={guestData?.telefon || ""} placeholder="+49 123 456789" className="mt-1 input-modern"/>
          {getErrorMessage("telefon", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("telefon", formState.errors)}</p>}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="alterHauptgast" className="flex items-center text-sm font-medium"><LucideCalendarIcon className="w-4 h-4 mr-2 text-muted-foreground" />Alter (in Jahren)</Label>
          <Input id="alterHauptgast" name="alterHauptgast" type="number" defaultValue={guestData?.alterHauptgast || ""} placeholder="z.B. 30" className="mt-1 input-modern"/>
          {getErrorMessage("alterHauptgast", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("alterHauptgast", formState.errors)}</p>}
        </div>
      </div>
      
      <Separator className="my-8"/>

      <h3 className="text-lg font-semibold flex items-center"><BookUser className="w-6 h-6 mr-2 text-primary"/>Ausweisdokumente (Optional)</h3>
      <p className="text-sm text-muted-foreground -mt-4">Foto eines gültigen Ausweisdokuments aufnehmen oder hochladen. Max. 10MB (JPG, PNG, WEBP, PDF).</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
        <div className="space-y-2">
            <Label htmlFor="hauptgastAusweisVorderseiteFile" className="text-sm font-medium">Vorderseite</Label>
            <div className="flex items-center gap-3 mt-1">
                <Button asChild variant="outline" size="sm" className="shrink-0 hover:bg-accent hover:border-primary/50 transition-all duration-200">
                    <Label htmlFor="hauptgastAusweisVorderseiteFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei wählen</Label>
                </Button>
                <Input id="hauptgastAusweisVorderseiteFile" name="hauptgastAusweisVorderseiteFile" type="file" className="hidden" onChange={(e) => setVorderseiteFileName(e.target.files?.[0]?.name || getFileNameFromUrl(guestData?.hauptgastAusweisVorderseiteUrl))} accept="image/jpeg,image/png,image/webp,application/pdf" />
                <span className="text-sm text-muted-foreground truncate max-w-xs">{vorderseiteFileName}</span>
            </div>
            {getErrorMessage("hauptgastAusweisVorderseiteFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisVorderseiteFile", formState.errors)}</p>}
        </div>

        <div className="space-y-2">
            <Label htmlFor="hauptgastAusweisRückseiteFile" className="text-sm font-medium">Rückseite</Label>
            <div className="flex items-center gap-3 mt-1">
                <Button asChild variant="outline" size="sm" className="shrink-0 hover:bg-accent hover:border-primary/50 transition-all duration-200">
                    <Label htmlFor="hauptgastAusweisRückseiteFile" className="cursor-pointer flex items-center"><Upload className="w-4 h-4 mr-2" /> Datei wählen</Label>
                </Button>
                <Input id="hauptgastAusweisRückseiteFile" name="hauptgastAusweisRückseiteFile" type="file" className="hidden" onChange={(e) => setRueckseiteFileName(e.target.files?.[0]?.name || getFileNameFromUrl(guestData?.hauptgastAusweisRückseiteUrl))} accept="image/jpeg,image/png,image/webp,application/pdf" />
                <span className="text-sm text-muted-foreground truncate max-w-xs">{rueckseiteFileName}</span>
            </div>
            {getErrorMessage("hauptgastAusweisRückseiteFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("hauptgastAusweisRückseiteFile", formState.errors)}</p>}
        </div>
      </div>
      
      <div className="p-4 border border-muted rounded-xl bg-muted/30 text-sm text-muted-foreground flex items-start gap-3 mt-10 shadow-sm">
        <ShieldCheck className="w-5 h-5 mt-0.5 text-primary flex-shrink-0"/>
        <p>Die Vertraulichkeit und der Schutz Ihrer persönlichen Daten haben für uns höchste Priorität. Ihre übermittelten Ausweisdokumente und Fotos werden von uns gemäß den geltenden Datenschutzgesetzen, insbesondere der Datenschutz-Grundverordnung (DSGVO), behandelt.</p>
      </div>
    </div>
  );
};

// --- Step 2: Mitreisende ---
interface CompanionFormState extends MitreisenderData {
  file_vorderseite?: File | null;
  fileName_vorderseite?: string;
  file_rueckseite?: File | null;
  fileName_rueckseite?: string;
}

const MitreisendeStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  const [companions, setCompanions] = useState<CompanionFormState[]>(() => {
    return (guestData?.mitreisende || []).map(c => ({ 
        ...c, 
        fileName_vorderseite: getFileNameFromUrl(c.ausweisVorderseiteUrl), 
        fileName_rueckseite: getFileNameFromUrl(c.ausweisRückseiteUrl) 
    }));
  });

   useEffect(() => {
    // This ensures that if guestData.mitreisende is updated from a server response (e.g. after form submission error with partial data)
    // the local state for companions is also updated.
    setCompanions((guestData?.mitreisende || []).map(c => ({ 
        ...c, 
        fileName_vorderseite: getFileNameFromUrl(c.ausweisVorderseiteUrl), 
        fileName_rueckseite: getFileNameFromUrl(c.ausweisRückseiteUrl) 
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
        c.id === id ? { ...c, [field]: file, [fileNameField]: file?.name || getFileNameFromUrl((c as any)[urlField]) } : c
      )
    );
  };
  
  const gesamtPersonen = initialBookingDetails.rooms?.reduce((sum, room) => sum + (room.erwachsene || 0) + (room.kinder || 0) + (room.kleinkinder || 0), 0) || 1; 

  return (
    <div className="space-y-6">
       <input type="hidden" name="mitreisendeMeta" value={JSON.stringify(companions.map(c => ({id: c.id, vorname: c.vorname, nachname: c.nachname})))} />
       
      <p className="text-sm text-muted-foreground -mt-2">
         Fügen Sie hier die Daten aller weiteren Personen hinzu (optional). Ihre Buchung umfasst insgesamt {gesamtPersonen} Person(en) (inkl. Hauptgast).
      </p>

      <Card className="card-modern p-2 sm:p-0">
        <CardContent className="pt-6 space-y-6">
          {companions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Keine weiteren Mitreisenden angegeben.</p>
          )}
          {companions.map((comp, index) => (
            <div key={comp.id} className="p-4 border rounded-xl relative space-y-4 bg-background/50 shadow-md hover:shadow-lg transition-shadow">
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-destructive hover:bg-destructive/10 rounded-full" onClick={() => handleRemoveCompanion(comp.id!)}>
                <Trash2 className="h-4 w-4" /> <span className="sr-only">Gast entfernen</span>
              </Button>
              <h4 className="font-medium text-md text-foreground">Mitreisender {index + 1}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor={`mitreisende_${comp.id}_vorname`} className="font-medium text-sm">Vorname *</Label>
                  <Input id={`mitreisende_${comp.id}_vorname`} name={`mitreisende_${comp.id}_vorname`} value={comp.vorname} onChange={(e) => handleCompanionChange(comp.id!, 'vorname', e.target.value)} className="mt-1 input-modern" />
                  {getErrorMessage(`mitreisende.${index}.vorname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende.${index}.vorname`, formState.errors)}</p>}
                </div>
                <div>
                  <Label htmlFor={`mitreisende_${comp.id}_nachname`} className="font-medium text-sm">Nachname *</Label>
                  <Input id={`mitreisende_${comp.id}_nachname`} name={`mitreisende_${comp.id}_nachname`} value={comp.nachname} onChange={(e) => handleCompanionChange(comp.id!, 'nachname', e.target.value)} className="mt-1 input-modern" />
                   {getErrorMessage(`mitreisende.${index}.nachname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende.${index}.nachname`, formState.errors)}</p>}
                </div>
              </div>
              <div className="space-y-3 pt-2">
                <Label className="text-sm font-medium text-foreground/90">Ausweisdokument (Optional)</Label>
                <div className="space-y-2">
                   <Label htmlFor={`mitreisende_${comp.id}_ausweisVorderseiteFile`} className="text-xs text-muted-foreground">Vorderseite</Label>
                   <div className="flex items-center gap-3">
                     <Button asChild variant="outline" size="sm" className="shrink-0 hover:bg-accent hover:border-primary/50 transition-all duration-200">
                       <Label htmlFor={`mitreisende_${comp.id}_ausweisVorderseiteFile`} className="cursor-pointer flex items-center"><Upload className="w-3 h-3 mr-1.5" /> Wählen</Label>
                     </Button>
                     <Input id={`mitreisende_${comp.id}_ausweisVorderseiteFile`} name={`mitreisende_${comp.id}_ausweisVorderseiteFile`} type="file" className="hidden" onChange={(e) => handleCompanionFileChange(comp.id!, 'file_vorderseite', e.target.files?.[0] || null)} accept="image/jpeg,image/png,image/webp,application/pdf" />
                     <span className="text-xs text-muted-foreground truncate max-w-[150px] sm:max-w-xs">{comp.fileName_vorderseite}</span>
                   </div>
                   {getErrorMessage(`mitreisende_${comp.id}_ausweisVorderseiteFile`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende_${comp.id}_ausweisVorderseiteFile`, formState.errors)}</p>}
                </div>
                 <div className="space-y-2">
                   <Label htmlFor={`mitreisende_${comp.id}_ausweisRückseiteFile`} className="text-xs text-muted-foreground">Rückseite</Label>
                   <div className="flex items-center gap-3">
                     <Button asChild variant="outline" size="sm" className="shrink-0 hover:bg-accent hover:border-primary/50 transition-all duration-200">
                       <Label htmlFor={`mitreisende_${comp.id}_ausweisRückseiteFile`} className="cursor-pointer flex items-center"><Upload className="w-3 h-3 mr-1.5" /> Wählen</Label>
                     </Button>
                     <Input id={`mitreisende_${comp.id}_ausweisRückseiteFile`} name={`mitreisende_${comp.id}_ausweisRückseiteFile`} type="file" className="hidden" onChange={(e) => handleCompanionFileChange(comp.id!, 'file_rueckseite', e.target.files?.[0] || null)} accept="image/jpeg,image/png,image/webp,application/pdf" />
                     <span className="text-xs text-muted-foreground truncate max-w-[150px] sm:max-w-xs">{comp.fileName_rueckseite}</span>
                   </div>
                   {getErrorMessage(`mitreisende_${comp.id}_ausweisRückseiteFile`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende_${comp.id}_ausweisRückseiteFile`, formState.errors)}</p>}
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={handleAddCompanion} className="w-full sm:w-auto mt-4 hover:bg-primary/5 hover:text-primary border-primary/30 transition-all duration-200">
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
      <p className="text-sm text-muted-foreground -mt-2">Wählen Sie Ihre bevorzugte Zahlungssumme.</p>

      <RadioGroup name="paymentAmountSelection" defaultValue={defaultSelection} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <RadioGroupItem value="downpayment" id="downpayment" className="peer sr-only" />
          <Label
            htmlFor="downpayment"
            className="flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-card p-6 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all duration-200 shadow-md hover:shadow-lg"
          >
            <div className="flex items-center justify-between w-full mb-3">
              <span className="text-lg font-semibold text-foreground">Anzahlung (30%)</span>
              <CheckCircle2 className={cn("h-6 w-6 text-primary opacity-0", "peer-data-[state=checked]:opacity-100 transition-opacity" )} />
            </div>
            <p className="text-3xl font-bold text-primary">{formatCurrency(anzahlungsbetrag)}</p>
          </Label>
        </div>
        <div>
          <RadioGroupItem value="full_amount" id="full_amount" className="peer sr-only" />
          <Label
            htmlFor="full_amount"
            className="flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-card p-6 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all duration-200 shadow-md hover:shadow-lg"
          >
             <div className="flex items-center justify-between w-full mb-3">
              <span className="text-lg font-semibold text-foreground">Gesamtbetrag (100%)</span>
              <CheckCircle2 className={cn("h-6 w-6 text-primary opacity-0", "peer-data-[state=checked]:opacity-100 transition-opacity" )} />
            </div>
            <p className="text-3xl font-bold text-primary">{formatCurrency(gesamtbetrag)}</p>
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
  const [fileNameBeleg, setFileNameBeleg] = useState<string>(() => getFileNameFromUrl(guestData?.zahlungsbelegUrl));

   useEffect(() => {
    setFileNameBeleg(getFileNameFromUrl(guestData?.zahlungsbelegUrl));
  }, [guestData?.zahlungsbelegUrl]);

  const anzahlungsbetrag = useMemo(() => {
    const price = initialBookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [initialBookingDetails?.price]);

  const zuZahlenderBetrag = guestData?.paymentAmountSelection === 'downpayment' ? anzahlungsbetrag : (initialBookingDetails?.price || 0);
  
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
      toast({ title: "Kopiert!", description: `${fieldName} wurde in die Zwischenablage kopiert.`, duration: 3000 });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht in die Zwischenablage kopieren.", duration: 3000 });
    }
  };

  return (
    <div className="space-y-8 text-center">
      <PradellLogo className="mb-2 mt-[-20px]"/> {/* Consistent logo placement */}
      <Landmark className="w-16 h-16 text-primary mx-auto opacity-80" />
      <p className="text-muted-foreground max-w-md mx-auto">
        Fast geschafft! Bitte führen Sie die Überweisung durch und laden Sie anschließend Ihren Zahlungsbeleg hoch.
      </p>

      <Card className="text-left shadow-xl card-modern p-2 sm:p-0">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Unsere Bankverbindung</CardTitle>
        </CardHeader>
        <CardContent className="pt-2 space-y-4">
          {Object.entries(bankDetails).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center py-2 border-b border-border/50 last:border-b-0">
              <div>
                <span className="text-xs text-muted-foreground block uppercase tracking-wider">
                  {key === 'bankName' && 'Bank Name'}
                  {key === 'kontoName' && 'Begünstigter'}
                  {key === 'iban' && 'IBAN'}
                  {key === 'swift' && 'SWIFT/BIC'}
                </span>
                <span className="font-medium text-foreground text-sm sm:text-base">{value}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(value, key)} className="text-primary hover:text-primary/80">
                <Copy className="h-4 w-4 mr-2" /> Kopieren
              </Button>
            </div>
          ))}
          <div className="flex justify-between items-center pt-3 border-t border-border/80 mt-3">
            <div>
              <span className="text-xs text-muted-foreground block uppercase tracking-wider">Zu zahlender Betrag</span>
              <span className="font-bold text-xl text-primary">{formatCurrency(zuZahlenderBetrag)}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(zuZahlenderBetrag.toString(), 'Betrag')} className="text-primary hover:text-primary/80">
              <Copy className="h-4 w-4 mr-2" /> Kopieren
            </Button>
          </div>
        </CardContent>
      </Card>
      { guestData?.paymentAmountSelection === 'downpayment' && <p className="text-xs text-center text-muted-foreground -mt-4">Der Restbetrag ist vor Ort im Hotel zu begleichen.</p>}


      <div className="mt-10 space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Zahlungsbeleg hochladen*</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Bitte laden Sie den Zahlungsbeleg (z. B. PDF der Überweisung) hoch. Max. 10MB (JPG, PNG, WEBP, PDF).
        </p>
        <Label
          htmlFor="zahlungsbelegFile"
          className="mx-auto flex flex-col items-center justify-center w-full max-w-lg h-48 border-2 border-dashed border-primary/30 rounded-xl cursor-pointer bg-card hover:bg-accent/50 transition-all duration-300 hover:border-primary"
        >
          <CloudUpload className="h-12 w-12 text-primary mb-3 opacity-70" />
          <span className="text-sm text-primary font-medium">Klicken zum Hochladen (PDF/Foto)</span>
          <span className="text-xs text-muted-foreground mt-1 truncate max-w-[90%] px-2">{fileNameBeleg}</span>
        </Label>
        <Input id="zahlungsbelegFile" name="zahlungsbelegFile" type="file" className="hidden" onChange={(e) => setFileNameBeleg(e.target.files?.[0]?.name || getFileNameFromUrl(guestData?.zahlungsbelegUrl))} accept="image/jpeg,image/png,image/webp,application/pdf" />
        {getErrorMessage("zahlungsbelegFile", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsbelegFile", formState.errors)}</p>}
      </div>
      <Input type="hidden" name="zahlungsbetrag" value={zahlungsbetragFuerFormular.current} />
    </div>
  );
};

// --- Step 5: Übersicht & Bestätigung ---
const UebersichtBestaetigungStep: React.FC<StepCommonProps> = ({ initialBookingDetails, guestData, formState }) => {
  
  const renderDocumentLink = (url?: string, altText?: string, hint?: string) => {
    if (!url) return <span className="italic text-muted-foreground text-xs">Nicht vorhanden</span>;

    const fileName = getFileNameFromUrl(url, "Datei");
    
    if (url.startsWith('data:image') || (url.startsWith('https://firebasestorage.googleapis.com') && (/\.(jpeg|jpg|gif|png|webp)(\?alt=media|$)/i.test(url) || url.includes('image%2F') || url.includes('image%2f')))) {
        return (
            <div className="flex flex-col items-start gap-1 mt-1">
                <NextImage src={url} alt={altText || 'Hochgeladenes Bild'} width={120} height={70} className="rounded-md border object-contain shadow-sm" data-ai-hint={hint || "document image"}/>
                <Link href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline hover:text-primary/80 transition-colors">
                   {fileName} (ansehen)
                </Link>
            </div>
        );
    } else if (url.startsWith('mock-file-url:') || (url.startsWith('https://firebasestorage.googleapis.com') && (/\.pdf(\?alt=media|$)/i.test(url) || url.includes('application%2Fpdf') || url.includes('application%2fpdf')))) {
        return (
            <Link href={url.startsWith('mock-file-url:') ? '#' : url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline hover:text-primary/80 transition-colors flex items-center gap-1.5 text-sm" title={`Datei ansehen: ${fileName}`}>
              <FileText className="w-4 h-4 flex-shrink-0" /> {fileName}
            </Link>
          );
    } else if (url.startsWith('https://firebasestorage.googleapis.com')) { // Fallback for other Firebase Storage files
         return (
            <Link href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline hover:text-primary/80 transition-colors flex items-center gap-1.5 text-sm" title={`Datei ansehen: ${fileName}`}>
                <FileIcon className="w-4 h-4 flex-shrink-0" /> {fileName}
            </Link>
        );
    }
    return <span className="italic text-muted-foreground text-xs">Link: {fileName}</span>;
  };

  const SectionCard: React.FC<{title: string, children: ReactNode, icon?: React.ElementType}> = ({ title, children, icon: Icon }) => (
    <Card className="card-modern">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-foreground flex items-center">
          {Icon && <Icon className="w-5 h-5 mr-2.5 text-primary" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-foreground/90">
        {children}
      </CardContent>
    </Card>
  );

  const DetailRow: React.FC<{label: string, value?: string | number | boolean | null, children?: ReactNode}> = ({ label, value, children }) => (
    <div className="flex justify-between py-1.5 border-b border-border/30 last:border-b-0">
      <span className="font-medium text-muted-foreground">{label}:</span>
      {children ? <div className="text-right">{children}</div> : <span className="text-right">{typeof value === 'boolean' ? (value ? 'Ja' : 'Nein') : (value || 'N/A')}</span>}
    </div>
  );

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground -mt-2">Bitte überprüfen Sie Ihre Angaben sorgfältig, bevor Sie die Buchung abschließen.</p>
      
      <SectionCard title="Hauptgast" icon={UserCircle}>
        <DetailRow label="Anrede" value={guestData?.anrede} />
        <DetailRow label="Name" value={`${guestData?.gastVorname || ''} ${guestData?.gastNachname || ''}`} />
        <DetailRow label="E-Mail" value={guestData?.email} />
        <DetailRow label="Telefon" value={guestData?.telefon} />
        <DetailRow label="Alter" value={guestData?.alterHauptgast ? `${guestData.alterHauptgast} Jahre` : undefined} />
        <Separator className="my-3" />
        <h4 className="font-semibold text-sm pt-1 pb-1 text-foreground">Ausweisdokument Hauptgast</h4>
        <DetailRow label="Vorderseite">{renderDocumentLink(guestData?.hauptgastAusweisVorderseiteUrl, "Ausweis Vorderseite Hauptgast", "identification document")}</DetailRow>
        <DetailRow label="Rückseite">{renderDocumentLink(guestData?.hauptgastAusweisRückseiteUrl, "Ausweis Rückseite Hauptgast", "identification document")}</DetailRow>
      </SectionCard>

      {guestData?.mitreisende && guestData.mitreisende.length > 0 && (
        <SectionCard title="Mitreisende" icon={Users2}>
          {guestData.mitreisende.map((mitreisender, index) => (
            <div key={mitreisender.id || index} className="pt-2 mt-2 border-t first:border-t-0 first:mt-0">
              <h5 className="font-semibold text-sm mb-1 text-foreground">Mitreisender {index + 1}</h5>
              <DetailRow label="Name" value={`${mitreisender.vorname || ''} ${mitreisender.nachname || ''}`} />
              <DetailRow label="Ausweis Vorderseite">{renderDocumentLink(mitreisender.ausweisVorderseiteUrl, `Ausweis Mitr. ${index+1} Vorderseite`, "identification document")}</DetailRow>
              <DetailRow label="Ausweis Rückseite">{renderDocumentLink(mitreisender.ausweisRückseiteUrl, `Ausweis Mitr. ${index+1} Rückseite`, "identification document")}</DetailRow>
            </div>
          ))}
        </SectionCard>
      )}

      <SectionCard title="Zahlungsinformationen" icon={CreditCard}>
        <DetailRow label="Auswahl Zahlungssumme" value={guestData?.paymentAmountSelection === 'downpayment' ? 'Anzahlung (30%)' : (guestData?.paymentAmountSelection === 'full_amount' ? 'Gesamtbetrag (100%)' : (guestData?.paymentAmountSelection || 'N/A'))} />
        <DetailRow label="Zahlungsart" value={guestData?.zahlungsart || 'Überweisung'} />
        <DetailRow label="Überwiesener Betrag" value={formatCurrency(guestData?.zahlungsbetrag)} />
        <DetailRow label="Zahlungsbeleg">{renderDocumentLink(guestData?.zahlungsbelegUrl, "Zahlungsbeleg", "payment proof")}</DetailRow>
        <Separator className="my-3"/>
         <div className="flex justify-between items-center py-1.5">
            <span className="font-medium text-muted-foreground">Zahlungsstatus:</span>
            <Badge
                variant={
                    (initialBookingDetails?.status === "Confirmed" && guestData?.submittedAt)
                    ? "default" 
                    : guestData?.zahlungsbelegUrl
                        ? "secondary" 
                        : "outline" 
                }
                className={cn(
                    "text-xs font-semibold",
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
      </SectionCard>

      <div className="space-y-5 pt-6 border-t border-border/50">
        <div className="flex items-start space-x-3 p-3 rounded-lg border border-border/40 bg-card hover:border-primary/30 transition-colors">
          <Checkbox id="agbAkzeptiert" name="agbAkzeptiert" defaultChecked={guestData?.agbAkzeptiert === true} className="mt-1"/>
          <Label htmlFor="agbAkzeptiert" className="text-sm leading-relaxed text-foreground/90">
            Ich akzeptiere die <Link href="/agb" target="_blank" className="underline text-primary hover:text-primary/80">Allgemeinen Geschäftsbedingungen</Link>.*
          </Label>
        </div>
        {getErrorMessage("agbAkzeptiert", formState.errors) && <p className="text-xs text-destructive -mt-3 ml-9">{getErrorMessage("agbAkzeptiert", formState.errors)}</p>}
        
        <div className="flex items-start space-x-3 p-3 rounded-lg border border-border/40 bg-card hover:border-primary/30 transition-colors">
          <Checkbox id="datenschutzAkzeptiert" name="datenschutzAkzeptiert" defaultChecked={guestData?.datenschutzAkzeptiert === true} className="mt-1" />
          <Label htmlFor="datenschutzAkzeptiert" className="text-sm leading-relaxed text-foreground/90">
            Ich habe die <Link href="/datenschutz" target="_blank" className="underline text-primary hover:text-primary/80">Datenschutzbestimmungen</Link> gelesen und stimme der Verarbeitung meiner Daten zu.*
          </Label>
        </div>
        {getErrorMessage("datenschutzAkzeptiert", formState.errors) && <p className="text-xs text-destructive -mt-3 ml-9">{getErrorMessage("datenschutzAkzeptiert", formState.errors)}</p>}
      </div>
    </div>
  );
};

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
    <Card className="mb-8 bg-gradient-to-r from-primary/5 via-background to-primary/5 card-modern p-1">
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-base font-semibold text-primary">Ihre Buchungsübersicht</CardTitle>
        <CardDescription className="text-xs">Vom Hotel für Sie vorbereitet.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm px-4 pb-4">
        <div><strong className="block text-xs text-muted-foreground uppercase tracking-wider">Gast</strong> {bookingDetails.guestFirstName} {bookingDetails.guestLastName}</div>
        <div><strong className="block text-xs text-muted-foreground uppercase tracking-wider">Anreise</strong> {formatDateDisplay(bookingDetails.checkInDate)}</div>
        <div><strong className="block text-xs text-muted-foreground uppercase tracking-wider">Abreise</strong> {formatDateDisplay(bookingDetails.checkOutDate)}</div>
        <div className="sm:col-span-2"><strong className="block text-xs text-muted-foreground uppercase tracking-wider">Zimmer</strong> {ersteZimmerdetails}</div>
        <div><strong className="block text-xs text-muted-foreground uppercase tracking-wider">Verpflegung</strong> {bookingDetails.verpflegung || 'Keine Angabe'}</div>
        <div><strong className="block text-xs text-muted-foreground uppercase tracking-wider">Preis</strong> <span className="font-semibold text-primary">{formatCurrency(bookingDetails.price)}</span></div>
      </CardContent>
    </Card>
  );
};


export function GuestBookingFormStepper({ bookingToken, bookingDetails: initialBookingDetailsProp }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const { toast } = useToast();
  const lastProcessedActionTokenRef = useRef<string | undefined>(undefined);

  const [initialBookingDetails, setInitialBookingDetails] = useState<Booking | null | undefined>(initialBookingDetailsProp);
  const [latestGuestSubmittedData, setLatestGuestSubmittedData] = useState<GuestSubmittedData | null | undefined>(
    initialBookingDetailsProp?.guestSubmittedData
  );

  useEffect(() => {
    setInitialBookingDetails(initialBookingDetailsProp);
    if (initialBookingDetailsProp?.guestSubmittedData) {
         setLatestGuestSubmittedData(initialBookingDetailsProp.guestSubmittedData);
    } else {
        setLatestGuestSubmittedData({ lastCompletedStep: -1 }); 
    }
  }, [initialBookingDetailsProp]);

  const steps = useMemo(() => [
    { id: "hauptgast", name: "Ihre Daten & Ausweis", label: "Hauptgast", Icon: UserCircle, Content: HauptgastDetailsStep, action: submitGastStammdatenAction },
    { id: "mitreisende", name: "Weitere Mitreisende", label: "Mitreisende", Icon: Users2, Content: MitreisendeStep, action: submitMitreisendeAction },
    { id: "zahlungssumme", name: "Zahlungssumme wählen", label: "Zahlungswahl", Icon: WalletCards, Content: ZahlungssummeWaehlenStep, action: submitPaymentAmountSelectionAction },
    { id: "zahlung", name: "Banküberweisung & Beleg", label: "Zahlungsinfo", Icon: CreditCard, Content: ZahlungsinformationenStep, action: submitZahlungsinformationenAction },
    { id: "uebersicht", name: "Übersicht & Bestätigung", label: "Bestätigung", Icon: CheckCircle, Content: UebersichtBestaetigungStep, action: submitEndgueltigeBestaetigungAction },
  ], []);

  const totalDisplaySteps = steps.length;

  const initialStepFromDb = useMemo(() => {
    const lastStep = latestGuestSubmittedData?.lastCompletedStep; 
    if (typeof lastStep === 'number' && lastStep >= 0) {
      if (lastStep >= steps.length - 1) { 
        return steps.length; 
      }
      return lastStep + 1; 
    }
    return 0; 
  }, [latestGuestSubmittedData?.lastCompletedStep, steps.length]);

  const [currentStep, setCurrentStep] = useState(initialStepFromDb);

  useEffect(() => {
    setCurrentStep(initialStepFromDb);
  }, [initialStepFromDb]);


 const currentActionFn = useMemo(() => {
    if (currentStep >= 0 && currentStep < steps.length && steps[currentStep]?.action) {
        return steps[currentStep].action.bind(null, bookingToken);
    }
    return async (prevState: FormState, formData: FormData): Promise<FormState> => ({
        ...initialFormState,
        message: currentStep >= steps.length ? "Alle Schritte bereits abgeschlossen." : "Interner Fehler: Ungültiger Schritt oder Aktion nicht definiert.",
        success: currentStep >= steps.length,
        currentStep: currentStep,
        actionToken: Date.now().toString(36) + Math.random().toString(36).substring(2, 9), 
    });
  }, [currentStep, steps, bookingToken]);

  const [formState, formAction, isPending] = useActionState(currentActionFn, {...initialFormState, currentStep: currentStep});

  useEffect(() => {
    const uniqueActionToken = formState.actionToken;
    
    if (uniqueActionToken && uniqueActionToken !== lastProcessedActionTokenRef.current) {
      lastProcessedActionTokenRef.current = uniqueActionToken;

      if (formState.message) {
        toast({
          title: formState.success ? "Erfolg" : (formState.errors && Object.keys(formState.errors).length > 0 ? "Fehler" : "Hinweis"),
          description: formState.message,
          variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
          duration: formState.success ? 5000 : 8000,
        });
      }

      if (formState.success) {
        if (formState.updatedGuestData) {
          setLatestGuestSubmittedData(formState.updatedGuestData);
        }
        
        if (typeof formState.currentStep === 'number' && formState.currentStep < steps.length - 1) {
          setCurrentStep(formState.currentStep + 1);
        } else if (typeof formState.currentStep === 'number' && formState.currentStep === steps.length -1) { 
          setCurrentStep(steps.length); 
        }
      } else { 
        if (formState.updatedGuestData) {
            setLatestGuestSubmittedData(formState.updatedGuestData);
        }
      }
    } else if (formState.message && !uniqueActionToken && !lastProcessedActionTokenRef.current && !formState.success) {
       toast({ 
        title: (formState.errors && Object.keys(formState.errors).length > 0 ? "Fehler" : "Hinweis"),
        description: formState.message,
        variant: (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
        duration: 8000,
      });
    }
  }, [formState, toast, steps.length]);


  if (!initialBookingDetails) {
    return (
      <Card className="w-full max-w-lg mx-auto shadow-xl card-modern">
        <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle className="text-xl text-destructive">Fehler</CardTitle></CardHeader>
        <CardContent><CardDescription>Buchungsdetails konnten nicht geladen werden. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Hotel.</CardDescription></CardContent>
      </Card>
    );
  }

  const isCompletedOrConfirmed = currentStep >= steps.length || 
    (initialBookingDetails.status === "Confirmed" &&
     latestGuestSubmittedData?.lastCompletedStep === steps.length -1 && 
     latestGuestSubmittedData?.submittedAt);


  if (isCompletedOrConfirmed) {
    const guestName = latestGuestSubmittedData?.gastVorname || initialBookingDetails?.guestFirstName || 'Gast';
    const isFullyConfirmedBySystem = initialBookingDetails.status === "Confirmed" && latestGuestSubmittedData?.submittedAt;
    
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-center">
        <PradellLogo className="mb-10 inline-block" />
        <Card className="w-full shadow-xl card-modern p-6 sm:p-8">
          <CardHeader className="items-center text-center border-0 p-0 mb-6">
            <CheckCircle className="w-20 h-20 text-green-500 mb-5" />
            <CardTitle className="text-2xl sm:text-3xl font-semibold text-foreground">Buchung {isFullyConfirmedBySystem ? "abgeschlossen und bestätigt" : "Daten übermittelt" }!</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <CardDescription className="text-base text-muted-foreground">
              Vielen Dank, {guestName}! Ihre Daten wurden erfolgreich übermittelt.
              {isFullyConfirmedBySystem
                ? " Ihre Buchung ist nun bestätigt."
                : " Ihre Buchung wird vom Hotel geprüft. Sie erhalten in Kürze eine Bestätigung."} Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.
            </CardDescription>
            <p className="mt-3 text-sm text-muted-foreground">Ihre Buchungsreferenz: <strong className="text-foreground">{bookingToken}</strong></p>
            <Button asChild className="mt-8 w-full sm:w-auto" size="lg">
                <Link href="/">Zur Startseite</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  
  if (currentStep < 0 || !steps[currentStep]) {
    return (
        <Card className="w-full max-w-lg mx-auto shadow-xl card-modern">
            <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle className="text-xl text-destructive">Formularfehler</CardTitle></CardHeader>
            <CardContent><CardDescription>Ein interner Fehler ist aufgetreten (ungültiger Schritt: {currentStep}). Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.</CardDescription></CardContent>
        </Card>
    );
  }

  const ActiveStepContent = steps[currentStep].Content;
  const CurrentStepIconComponent = steps[currentStep].Icon;
  const stepNumberForDisplay = currentStep + 1;

  return (
    <>
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
         <div className="text-center mb-6">
            {currentStep !== 3 && <PradellLogo className="mb-8 inline-block" /> } {/* Hide PradellLogo on payment step as it's inside the step */}
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Buchung vervollständigen</h1>
            <p className="text-muted-foreground mt-1">Schritt {stepNumberForDisplay} von {totalDisplaySteps} - {steps[currentStep].label}</p>
        </div>

        <div className="mb-12">
            <ol className="flex items-center w-full">
            {steps.map((step, index) => {
                const StepIcon = step.Icon; 
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;
                return(
                <li
                    key={step.id}
                    className={cn(
                    "flex w-full items-center",
                    index < steps.length - 1 ? "after:content-[''] after:w-full after:h-1.5 after:border-b-2 after:border-muted after:inline-block" : "",
                    index < steps.length - 1 && (isCompleted || isActive) ? "after:border-primary" : "after:border-muted"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => isCompleted && setCurrentStep(index)} // Allow navigation to completed steps
                        disabled={isPending && !isCompleted} // Disable if pending unless it's a completed step
                        className={cn(
                            "flex items-center justify-center w-10 h-10 rounded-full shrink-0 text-sm font-medium transition-all duration-300",
                            isActive ? "bg-primary text-primary-foreground ring-4 ring-primary/30 scale-110" :
                            isCompleted ? "bg-primary/80 text-primary-foreground hover:bg-primary" :
                            "bg-muted text-muted-foreground border-2 hover:border-primary/50"
                        )}
                        aria-label={`Gehe zu Schritt ${index + 1}: ${step.label}`}
                    >
                    {isCompleted ? <Check className="w-5 h-5" /> : <StepIcon className="w-5 h-5" />}
                    </button>
                </li>
                );
            })}
            </ol>
            <div className="flex justify-between text-xs mt-2.5 px-1">
                {steps.map((step, idx) => (
                    <span key={`${step.id}-label`} className={cn(
                        "text-center flex-1 text-muted-foreground transition-colors duration-300",
                        currentStep === idx && "text-primary font-semibold",
                        idx < currentStep && "text-primary/80"
                        )}>
                        {step.label}
                    </span>
                ))}
            </div>
        </div>
        
        {currentStep !== 3 && <BookingSummaryCard bookingDetails={initialBookingDetails} />} {/* Hide summary on payment step as it's part of the layout */}

        <Card className="w-full shadow-xl card-modern p-1 sm:p-0">
          <CardHeader className="border-b border-border/50 p-5">
              <CardTitle className="text-xl font-semibold text-foreground flex items-center">
                {CurrentStepIconComponent && <CurrentStepIconComponent className="w-6 h-6 mr-3 text-primary"/>}
                {steps[currentStep].name}
              </CardTitle>
          </CardHeader>
          <CardContent className="p-5 sm:p-6 md:p-8">
            <form action={formAction} key={`${currentStep}-${bookingToken}`}>
              <ActiveStepContent
                bookingToken={bookingToken}
                initialBookingDetails={initialBookingDetails!}
                guestData={latestGuestSubmittedData}
                formState={formState}
                setCurrentStep={setCurrentStep} // Pass setCurrentStep
              />
              {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
                <div className="mt-6 p-4 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2 shadow-sm">
                  <AlertCircle className="h-5 w-5" /> {formState.message}
                </div>
              )}
              <CardFooter className="flex justify-between mt-10 pt-6 border-t border-border/50 px-0 pb-0">
                <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))} 
                    disabled={isPending || currentStep === 0}
                    className="px-6 py-3 rounded-lg hover:bg-muted transition-colors"
                >
                    <ChevronLeft className="mr-2 h-5 w-5" /> Zurück
                </Button>
                <Button 
                    type="submit" 
                    disabled={isPending} 
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-shadow"
                >
                  {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : (currentStep === steps.length -1 ? (<><CheckCircle className="mr-2 h-5 w-5"/>Buchung abschließen</>) : (<>Weiter <ChevronRight className="ml-2 h-5 w-5" /></>))}
                </Button>
              </CardFooter>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

interface Step {
  id: string;
  name: string; 
  label: string; 
  Icon: React.ElementType; 
  Content: React.FC<StepCommonProps>;
  action: (bookingToken: string, prevState: FormState, formData: FormData) => Promise<FormState>;
}
