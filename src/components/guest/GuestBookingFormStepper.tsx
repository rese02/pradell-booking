
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Check, CheckCircle, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, ShieldCheck, Info, CreditCard, ShieldQuestion, FileText, BookUser, Landmark, Euro, Percent, CheckCircle2, WalletCards, User as UserIcon, Image as ImageIcon, Upload, CalendarIcon as LucideCalendarIcon, ChevronRight, ChevronLeft, Users2, Trash2, PlusCircle } from "lucide-react"; // Added Users2, Trash2, PlusCircle
import { Badge } from "@/components/ui/badge"; // Ensured Badge is imported
import {
  submitGastStammdatenAction,
  submitMitreisendeAction, // Placeholder for now
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
import NextImage from "next/image"; // Using NextImage alias
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";


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

interface StepContentProps {
  bookingToken: string;
  initialBookingDetails: Booking; // Now always Booking, not null
  guestData?: GuestSubmittedData | null;
  formState: FormState;
  setLatestGuestSubmittedData: React.Dispatch<React.SetStateAction<GuestSubmittedData | null | undefined>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
}

// --- Step 1: Hauptgast Details & Ausweis ---
const HauptgastDetailsStep: React.FC<StepContentProps> = ({ initialBookingDetails, guestData, formState }) => {
  const [vorderseiteFileName, setVorderseiteFileName] = useState<string>(guestData?.hauptgastAusweisVorderseiteUrl ? "Datei bereits hochgeladen" : "Keine Datei ausgewählt");
  const [rueckseiteFileName, setRueckseiteFileName] = useState<string>(guestData?.hauptgastAusweisRückseiteUrl ? "Datei bereits hochgeladen" : "Keine Datei ausgewählt");

  useEffect(() => {
    if (guestData?.hauptgastAusweisVorderseiteUrl) {
      setVorderseiteFileName(guestData.hauptgastAusweisVorderseiteUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen");
    }
     if (guestData?.hauptgastAusweisRückseiteUrl) {
      setRueckseiteFileName(guestData.hauptgastAusweisRückseiteUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen");
    }
  }, [guestData?.hauptgastAusweisVorderseiteUrl, guestData?.hauptgastAusweisRückseiteUrl]);


  return (
    <div className="space-y-6">
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Label htmlFor="anrede" className="flex items-center text-sm"><UserIcon className="w-4 h-4 mr-2 text-muted-foreground" />Anrede</Label>
          <Select name="anrede" defaultValue={guestData?.anrede || ""}>
            <SelectTrigger id="anrede" className="mt-1">
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
            <Input id="geburtsdatum" name="geburtsdatum" type="date" defaultValue={formatDateForInput(guestData?.geburtsdatum)} className="mt-1"/>
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
            <Label htmlFor="alterHauptgast" className="flex items-center text-sm"><LucideCalendarIcon className="w-4 h-4 mr-2 text-muted-foreground" />Alter (in Jahren)</Label>
            <Input id="alterHauptgast" name="alterHauptgast" type="number" defaultValue={guestData?.alterHauptgast || ""} placeholder="z.B. 30" className="mt-1"/>
            {getErrorMessage("alterHauptgast", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("alterHauptgast", formState.errors)}</p>}
        </div>
      </div>
      
      <Separator className="my-6"/>

      <div className="space-y-4">
        <h3 className="text-md font-semibold">Ausweisdokument (Vorderseite)</h3>
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
        <h3 className="text-md font-semibold">Ausweisdokument (Rückseite)</h3>
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

// --- Step 2: Mitreisende ---
interface CompanionFormState extends MitreisenderData {
  file_vorderseite?: File | null;
  file_rueckseite?: File | null;
  fileName_vorderseite?: string;
  fileName_rueckseite?: string;
}

const MitreisendeStep: React.FC<StepContentProps> = ({ initialBookingDetails, guestData, formState, setLatestGuestSubmittedData }) => {
  const [companions, setCompanions] = useState<CompanionFormState[]>(guestData?.mitreisende || []);

  useEffect(() => {
    // Initialize filenames if URLs are present from DB
    setCompanions(
      (guestData?.mitreisende || []).map(c => ({
        ...c,
        fileName_vorderseite: c.hauptgastAusweisVorderseiteUrl ? c.hauptgastAusweisVorderseiteUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen" : "Keine Datei ausgewählt",
        fileName_rueckseite: c.hauptgastAusweisRückseiteUrl ? c.hauptgastAusweisRückseiteUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen" : "Keine Datei ausgewählt",
      }))
    );
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
    setCompanions(
      companions.map(c =>
        c.id === id ? { ...c, [field]: file, [fileNameField]: file?.name || ( (c as any)[field] ? (c as any)[fileNameField] : 'Keine Datei ausgewählt') } : c
      )
    );
  };
  
  const getPersonenText = (room: typeof initialBookingDetails.rooms extends (infer R)[] ? R : never) => {
    if (!room) return "N/A";
    let text = `${room.erwachsene} Erw.`;
    if (room.kinder && room.kinder > 0) text += `, ${room.kinder} Ki.`;
    if (room.kleinkinder && room.kleinkinder > 0) text += `, ${room.kleinkinder} Kk.`;
    return text;
  };


  const prepareFormDataForAction = (formData: FormData) => {
    const mitreisendeMeta = companions.map(c => ({id: c.id, vorname: c.vorname, nachname: c.nachname}));
    formData.append('mitreisendeMeta', JSON.stringify(mitreisendeMeta));

    companions.forEach((comp, index) => {
        if (comp.file_vorderseite) {
            formData.append(`mitreisende_${index}_ausweisVorderseiteFile`, comp.file_vorderseite);
        }
        if (comp.file_rueckseite) {
            formData.append(`mitreisende_${index}_ausweisRückseiteFile`, comp.file_rueckseite);
        }
    });
    return formData;
  };


  // This function will be passed to the form's onSubmit if needed, or used with useActionState
  const handleSubmitMitreisende = async (formData: FormData) => {
    const preparedFormData = prepareFormDataForAction(new FormData()); // Use a fresh FormData to append based on state
    // Then call the actual server action with preparedFormData
    // This part is tricky with useActionState, which expects the form to directly provide data.
    // We might need to manually trigger the action after preparing FormData, or restructure.
    // For now, the form will submit, and the server action will parse based on `mitreisendeMeta` and file names.
  };
  

  return (
    <div className="space-y-6">
       <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
       {/* Hidden input for Mitreisende metadata */}
       <input type="hidden" name="mitreisendeMeta" value={JSON.stringify(companions.map(c => ({id: c.id, vorname: c.vorname, nachname: c.nachname})))} />


      <Card className="bg-muted/30">
        <CardHeader><CardTitle className="text-lg">Ihre Buchungsdetails</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><strong className="block text-xs text-muted-foreground">Check-in</strong> {formatDateDisplay(initialBookingDetails.checkInDate)}</div>
            <div><strong className="block text-xs text-muted-foreground">Check-out</strong> {formatDateDisplay(initialBookingDetails.checkOutDate)}</div>
            <div><strong className="block text-xs text-muted-foreground">Preis</strong> {formatCurrency(initialBookingDetails.price)}</div>
            <div><strong className="block text-xs text-muted-foreground">Verpflegung</strong> {initialBookingDetails.verpflegung || "Keine"}</div>
          </div>
          {initialBookingDetails.rooms?.map((room, index) => (
             <div key={index} className="pt-2 mt-2 border-t border-muted/50">
                <strong className="block text-xs text-muted-foreground">Hauptzimmer {initialBookingDetails.rooms && initialBookingDetails.rooms.length > 1 ? index +1 : ''}</strong>
                Typ: {room.zimmertyp}, Personen: {getPersonenText(room)}
             </div>
          ))}
           {initialBookingDetails.interneBemerkungen && (
            <div className="pt-2 mt-2 border-t border-muted/50">
              <strong className="block text-xs text-muted-foreground">Anmerkungen (Hotel)</strong>
              {initialBookingDetails.interneBemerkungen}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Weitere Mitreisende</CardTitle>
          <CardDescription>Fügen Sie hier die Daten aller weiteren Personen hinzu (optional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {companions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Keine weiteren Mitreisenden angegeben.</p>
          )}
          {companions.map((comp, index) => (
            <div key={comp.id} className="p-4 border rounded-md relative space-y-4 bg-background shadow-sm">
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveCompanion(comp.id)}>
                <Trash2 className="h-4 w-4" /> <span className="sr-only">Gast entfernen</span>
              </Button>
              <h4 className="font-medium text-md">Mitreisender {index + 1}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor={`mitreisende_${index}_vorname`}>Vorname *</Label>
                  <Input id={`mitreisende_${index}_vorname`} name={`mitreisende_${index}_vorname`} value={comp.vorname} onChange={(e) => handleCompanionChange(comp.id, 'vorname', e.target.value)} className="mt-1" />
                  {getErrorMessage(`mitreisende_${index}_vorname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende_${index}_vorname`, formState.errors)}</p>}
                </div>
                <div>
                  <Label htmlFor={`mitreisende_${index}_nachname`}>Nachname *</Label>
                  <Input id={`mitreisende_${index}_nachname`} name={`mitreisende_${index}_nachname`} value={comp.nachname} onChange={(e) => handleCompanionChange(comp.id, 'nachname', e.target.value)} className="mt-1" />
                   {getErrorMessage(`mitreisende_${index}_nachname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende_${index}_nachname`, formState.errors)}</p>}
                </div>
              </div>
              <div className="space-y-3 pt-2">
                <Label className="text-sm font-medium">Ausweisdokument (Optional)</Label>
                <div className="space-y-2">
                   <Label htmlFor={`mitreisende_${index}_ausweisVorderseiteFile`} className="text-xs text-muted-foreground">Vorderseite</Label>
                   <div className="flex items-center gap-3">
                     <Button asChild variant="outline" size="sm" className="shrink-0">
                       <Label htmlFor={`mitreisende_${index}_ausweisVorderseiteFile`} className="cursor-pointer flex items-center"><Upload className="w-3 h-3 mr-1.5" /> Wählen</Label>
                     </Button>
                     <Input id={`mitreisende_${index}_ausweisVorderseiteFile`} name={`mitreisende_${index}_ausweisVorderseiteFile`} type="file" className="hidden" onChange={(e) => handleCompanionFileChange(comp.id, 'file_vorderseite', e.target.files?.[0] || null)} accept="image/jpeg,image/png,image/webp,application/pdf" />
                     <span className="text-xs text-muted-foreground truncate max-w-[150px] sm:max-w-xs">{comp.fileName_vorderseite}</span>
                   </div>
                </div>
                 <div className="space-y-2">
                   <Label htmlFor={`mitreisende_${index}_ausweisRückseiteFile`} className="text-xs text-muted-foreground">Rückseite</Label>
                   <div className="flex items-center gap-3">
                     <Button asChild variant="outline" size="sm" className="shrink-0">
                       <Label htmlFor={`mitreisende_${index}_ausweisRückseiteFile`} className="cursor-pointer flex items-center"><Upload className="w-3 h-3 mr-1.5" /> Wählen</Label>
                     </Button>
                     <Input id={`mitreisende_${index}_ausweisRückseiteFile`} name={`mitreisende_${index}_ausweisRückseiteFile`} type="file" className="hidden" onChange={(e) => handleCompanionFileChange(comp.id, 'file_rueckseite', e.target.files?.[0] || null)} accept="image/jpeg,image/png,image/webp,application/pdf" />
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
const ZahlungssummeWaehlenStep: React.FC<StepContentProps> = ({ initialBookingDetails, guestData, formState }) => {
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
      <input type="hidden" name="currentActionToken" value={formState.actionToken || ''} />
      <div>
        <h2 className="text-xl font-semibold">Zahlungssumme wählen</h2>
        <p className="text-sm text-muted-foreground">Wählen Sie Ihre bevorzugte Zahlungssumme.</p>
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
              <CheckCircle2 className={cn("h-5 w-5 text-primary", defaultSelection === "downpayment" ? "opacity-100" : "opacity-0" )} />
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
              <CheckCircle2 className={cn("h-5 w-5 text-primary", defaultSelection === "full_amount" ? "opacity-100" : "opacity-0" )} />
            </div>
            <p className="text-2xl font-bold">{formatCurrency(gesamtbetrag)}</p>
          </Label>
        </div>
      </RadioGroup>
      {getErrorMessage("paymentAmountSelection", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("paymentAmountSelection", formState.errors)}</p>}
    </div>
  );
};


// --- Step 4: Zahlungsinformationen ---
const ZahlungsinformationenStep: React.FC<StepContentProps> = ({ initialBookingDetails, guestData, formState }) => {
  const [fileNameBeleg, setFileNameBeleg] = useState<string>(guestData?.zahlungsbelegUrl ? "Datei bereits hochgeladen" : "Keine Datei ausgewählt");

 useEffect(() => {
    if (guestData?.zahlungsbelegUrl) {
      setFileNameBeleg(guestData.zahlungsbelegUrl.split('/').pop()?.split('?')[0]?.substring(14) || "Datei hochgeladen");
    }
  }, [guestData?.zahlungsbelegUrl]);

  const anzahlungsbetrag = useMemo(() => {
    const price = initialBookingDetails?.price;
    if (typeof price !== 'number') return 0;
    return parseFloat((price * 0.3).toFixed(2));
  }, [initialBookingDetails?.price]);

  const zuZahlenderBetrag = guestData?.paymentAmountSelection === 'downpayment' ? anzahlungsbetrag : (initialBookingDetails?.price || 0);


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
        <Input type="hidden" name="zahlungsbetrag" value={zuZahlenderBetrag.toString()} />
        { guestData?.paymentAmountSelection === 'downpayment' && <p className="text-xs text-muted-foreground mt-1">Der Restbetrag ist vor Ort im Hotel zu begleichen.</p>}
      </div>
      <div>
        <Label htmlFor="zahlungsart">Zahlungsart *</Label>
        <Select name="zahlungsart" defaultValue={guestData?.zahlungsart || "Überweisung"}>
          <SelectTrigger id="zahlungsart" className="mt-1"><SelectValue placeholder="Zahlungsart wählen" /></SelectTrigger>
          <SelectContent><SelectItem value="Überweisung">Überweisung</SelectItem></SelectContent>
        </Select>
        {getErrorMessage("zahlungsart", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("zahlungsart", formState.errors)}</p>}
      </div>
      <div>
        <Label htmlFor="zahlungsdatum">Datum der Zahlung *</Label>
        <Input id="zahlungsdatum" name="zahlungsdatum" type="date" defaultValue={formatDateForInput(guestData?.zahlungsdatum)} className="mt-1"/>
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

// --- Step 5: Übersicht & Bestätigung ---
const UebersichtBestaetigungStep: React.FC<StepContentProps> = ({ initialBookingDetails, guestData, formState }) => {
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
        const isImage = /\.(jpeg|jpg|gif|png|webp)(\?|$)/i.test(url) || url.includes('image%2F') || url.includes('image%2f');
        const isPdf = /\.pdf(\?|$)/i.test(url) || url.includes('application%2Fpdf') || url.includes('application%2fpdf');
        let fileNameFromUrl = 'Datei';
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/');
            const lastSegmentEncoded = pathSegments.pop();
            if (lastSegmentEncoded) {
                 fileNameFromUrl = decodeURIComponent(lastSegmentEncoded.split('_').slice(1).join('_') || lastSegmentEncoded);
                 if (fileNameFromUrl.length < 3) fileNameFromUrl = decodeURIComponent(lastSegmentEncoded); // fallback if no timestamp
            }
        } catch (e) { console.error("Error parsing filename from Firebase URL", e); }


        if (isImage) {
            return (
                <div className="flex flex-col items-start gap-1 mt-1">
                    <NextImage src={url} alt={altText || 'Hochgeladenes Bild'} width={100} height={60} className="rounded border object-contain" data-ai-hint={hint || "document image"} />
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
        <CardHeader><CardTitle className="text-lg">Ihre Buchungsdetails (vom Hotel)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Zeitraum:</strong> {formatDateDisplay(initialBookingDetails?.checkInDate)} - {formatDateDisplay(initialBookingDetails?.checkOutDate)}</div>
          <div><strong>Zimmer:</strong> {display(initialBookingDetails?.zimmertyp || (initialBookingDetails?.rooms && initialBookingDetails.rooms[0]?.zimmertyp))}</div>
          <div><strong>Verpflegung:</strong> {display(initialBookingDetails?.verpflegung)}</div>
          <div><strong>Gesamtpreis:</strong> {formatCurrency(initialBookingDetails?.price)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Ihre Daten (Hauptgast)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Anrede:</strong> {display(guestData?.anrede)}</div>
          <div><strong>Name:</strong> {display(guestData?.gastVorname)} {display(guestData?.gastNachname)}</div>
          <div><strong>Geburtsdatum:</strong> {formatDateDisplay(guestData?.geburtsdatum) || display(null)}</div>
          <div><strong>Alter:</strong> {display(guestData?.alterHauptgast) || display(null)}</div>
          <div><strong>E-Mail:</strong> {display(guestData?.email)}</div>
          <div><strong>Telefon:</strong> {display(guestData?.telefon)}</div>
          <Separator className="my-3" />
          <h4 className="font-medium">Ausweisdokument Hauptgast</h4>
          <div><strong>Dokumenttyp:</strong> {display(guestData?.hauptgastDokumenttyp)}</div>
          <div><strong>Ausweis Vorderseite:</strong> {renderDocumentLink(guestData?.hauptgastAusweisVorderseiteUrl, "Ausweis Vorderseite", "identification document")}</div>
          <div><strong>Ausweis Rückseite:</strong> {renderDocumentLink(guestData?.hauptgastAusweisRückseiteUrl, "Ausweis Rückseite", "identification document")}</div>
        </CardContent>
      </Card>

      {guestData?.mitreisende && guestData.mitreisende.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Daten der Mitreisenden</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {guestData.mitreisende.map((mitreisender, index) => (
              <div key={mitreisender.id || index} className="text-sm border-b pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0">
                <h5 className="font-medium">Mitreisender {index + 1}</h5>
                <p><strong>Name:</strong> {display(mitreisender.vorname)} {display(mitreisender.nachname)}</p>
                <p><strong>Ausweis Vorderseite:</strong> {renderDocumentLink(mitreisender.hauptgastAusweisVorderseiteUrl, `Ausweis Mitr. ${index+1} Vorderseite`, "identification document")}</p>
                <p><strong>Ausweis Rückseite:</strong> {renderDocumentLink(mitreisender.hauptgastAusweisRückseiteUrl, `Ausweis Mitr. ${index+1} Rückseite`, "identification document")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Zahlungsinformationen</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Auswahl Zahlungssumme:</strong> {guestData?.paymentAmountSelection === 'downpayment' ? 'Anzahlung (30%)' : 'Gesamtbetrag (100%)'}</div>
          <div><strong>Zahlungsart:</strong> {display(guestData?.zahlungsart)}</div>
          <div><strong>Zu zahlender Betrag:</strong> {formatCurrency(guestData?.zahlungsbetrag)}</div>
          <div><strong>Zahlungsdatum:</strong> {formatDateDisplay(guestData?.zahlungsdatum) || display(null)}</div>
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
  name: string; // For internal logic and CardTitle
  label: string; // For visual stepper UI
  Icon: React.ElementType;
  Content: React.FC<StepContentProps>;
  action: (bookingToken: string, prevState: FormState, formData: FormData) => Promise<FormState>;
}

const BookingSummaryCard: React.FC<{ bookingDetails?: Booking | null }> = ({ bookingDetails }) => {
  if (!bookingDetails) return null;
  return (
    <Card className="mb-8 bg-muted/30 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">Ihre Buchungsübersicht (vom Hotel)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><strong className="block text-xs text-muted-foreground">Gast (Hauptbucher)</strong> {bookingDetails.guestFirstName} {bookingDetails.guestLastName}</div>
        <div><strong className="block text-xs text-muted-foreground">Preis</strong> {formatCurrency(bookingDetails.price)}</div>
        <div><strong className="block text-xs text-muted-foreground">Anreise</strong> {formatDateDisplay(bookingDetails.checkInDate)}</div>
        <div><strong className="block text-xs text-muted-foreground">Abreise</strong> {formatDateDisplay(bookingDetails.checkOutDate)}</div>
        <div className="col-span-2"><strong className="block text-xs text-muted-foreground">Zimmer</strong> {bookingDetails.roomIdentifier} ({bookingDetails.verpflegung || 'Keine Verpflegung'})</div>
      </CardContent>
    </Card>
  );
};


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
    { id: "hauptgast", name: "Hauptgast & Ausweis", label: "Hauptgast", Icon: UserCircle, Content: HauptgastDetailsStep, action: submitGastStammdatenAction },
    { id: "mitreisende", name: "Mitreisende", label: "Mitreisende", Icon: Users2, Content: MitreisendeStep, action: submitMitreisendeAction },
    { id: "zahlungssumme", name: "Zahlungssumme", label: "Zahlungswahl", Icon: WalletCards, Content: ZahlungssummeWaehlenStep, action: submitPaymentAmountSelectionAction },
    { id: "zahlung", name: "Zahlungsinformationen", label: "Zahlungsinfo", Icon: CreditCard, Content: ZahlungsinformationenStep, action: submitZahlungsinformationenAction },
    { id: "uebersicht", name: "Bestätigung", label: "Bestätigung", Icon: CheckCircle, Content: UebersichtBestaetigungStep, action: submitEndgueltigeBestaetigungAction },
  ], []);

  const stepperLabels = steps.map(s => s.label); // ["Hauptgast", "Mitreisende", ...]
  const totalDisplaySteps = stepperLabels.length;


  const initialStepFromDb = useMemo(() => {
    const lastStep = latestGuestSubmittedData?.lastCompletedStep;
    if (typeof lastStep === 'number' && lastStep >= 0) { // lastCompletedStep is 0-indexed
      if (lastStep >= steps.length - 1) { // If last completed step is the final data entry step
        return steps.length; // Go to "Fertig" state
      }
      return lastStep + 1; // Go to the next step
    }
    return 0; // Start at the first step
  }, [latestGuestSubmittedData?.lastCompletedStep, steps.length]);

  const [currentStep, setCurrentStep] = useState(initialStepFromDb);

  useEffect(() => {
    setCurrentStep(initialStepFromDb);
  }, [initialStepFromDb]);


 const currentActionFn = useMemo(() => {
    if (currentStep >= 0 && currentStep < steps.length && steps[currentStep]?.action) {
        return steps[currentStep].action.bind(null, bookingToken);
    }
    // Fallback if currentStep is out of bounds (e.g., when all steps are completed)
    return async (prevState: FormState, formData: FormData) => ({
        ...initialFormState,
        message: currentStep >= steps.length ? "Alle Schritte abgeschlossen." : "Interner Fehler: Ungültiger Schritt.",
        success: currentStep >= steps.length, // Success if all steps done
    });
  }, [currentStep, steps, bookingToken]);

  const [formState, formAction, isPending] = useActionState(currentActionFn, initialFormState);

  useEffect(() => {
    if (formState.actionToken && formState.actionToken !== lastProcessedActionTokenRef.current) {
      lastProcessedActionTokenRef.current = formState.actionToken; // Mark this token as processed

      toast({
        title: formState.success ? "Erfolg" : "Hinweis",
        description: formState.message,
        variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });

      if (formState.success) {
        if (formState.updatedGuestData) {
          setLatestGuestSubmittedData(formState.updatedGuestData);
        }
        if (currentStep < steps.length - 1) {
          setCurrentStep(prev => prev + 1);
        } else if (currentStep === steps.length -1) {
          // This was the last data entry step, now show "Fertig"
          setCurrentStep(steps.length);
        }
      }
    } else if (formState.message && !formState.actionToken && !lastProcessedActionTokenRef.current) {
      // Handle initial or non-action related messages (e.g., validation before submit)
       toast({
        title: "Hinweis",
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

  const isCompletedOrConfirmed = currentStep >= steps.length ||
    (initialBookingDetails.status === "Confirmed" &&
     latestGuestSubmittedData?.lastCompletedStep === steps.length -1 &&
     latestGuestSubmittedData?.submittedAt);


  if (isCompletedOrConfirmed) {
    const guestName = latestGuestSubmittedData?.gastVorname || initialBookingDetails?.guestFirstName || 'Gast';
    const isFullyConfirmed = initialBookingDetails.status === "Confirmed" && latestGuestSubmittedData?.submittedAt;
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8 text-center">
        <PradellLogo className="mb-8 inline-block" />
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

  // Fallback for invalid step index, though currentActionFn should handle this
  if (currentStep < 0 || !steps[currentStep]) {
    return (
        <Card className="w-full max-w-lg mx-auto shadow-lg">
            <CardHeader className="items-center text-center"><AlertCircle className="w-12 h-12 text-destructive mb-3" /><CardTitle>Formularfehler</CardTitle></CardHeader>
            <CardContent><CardDescription>Ein interner Fehler ist aufgetreten (ungültiger Schritt: {currentStep}). Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.</CardDescription></CardContent>
        </Card>
    );
  }

  const ActiveStepContent = steps[currentStep]!.Content;
  const CurrentStepIconComponent = steps[currentStep]!.Icon;
  const stepNumberForDisplay = currentStep + 1;

  return (
    <>
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-4">
             <PradellLogo className="mb-8 inline-block" />
            <h1 className="text-2xl font-semibold tracking-tight">Buchung vervollständigen</h1>
            <p className="text-muted-foreground">Schritt {stepNumberForDisplay} von {totalDisplaySteps} - {steps[currentStep].label}</p>
        </div>

        <div className="mb-10">
            <ol className="flex items-center w-full">
            {steps.map((step, index) => {
                const StepIconComponent = step.Icon;
                const isActive = index === currentStep;
                const isCompleted = index < currentStep || (currentStep === steps.length && index < steps.length); // All completed if on final "Fertig" screen
                return(
                <li
                    key={step.id}
                    className={cn(
                    "flex w-full items-center",
                    index < steps.length - 1 ? "after:content-[''] after:w-full after:h-1 after:border-b after:border-4 after:inline-block" : "",
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
                {steps.map(step => (
                    <span key={`${step.id}-label`} className="text-center flex-1 text-muted-foreground group-data-[isActive=true]:text-primary">
                        {step.label}
                    </span>
                ))}
            </div>
        </div>
         <BookingSummaryCard bookingDetails={initialBookingDetails} />

        <Card className="w-full shadow-xl">
          <CardHeader className="border-b">
              <CardTitle className="text-xl flex items-center">
                {CurrentStepIconComponent && <CurrentStepIconComponent className="w-6 h-6 mr-3 text-primary"/>}
                {steps[currentStep].name}
              </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={formAction} key={`${currentStep}-${bookingToken}`} encType="multipart/form-data" >
              <ActiveStepContent
                bookingToken={bookingToken}
                initialBookingDetails={initialBookingDetails}
                guestData={latestGuestSubmittedData}
                formState={formState}
                setLatestGuestSubmittedData={setLatestGuestSubmittedData}
                setCurrentStep={setCurrentStep}
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
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (currentStep === steps.length -1 ? "Buchung abschließen" : "Weiter")}
                  {!isPending && <ChevronRight className="ml-2 h-5 w-5" />}
                </Button>
              </CardFooter>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
