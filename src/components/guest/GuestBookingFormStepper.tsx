
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Check, CheckCircle, CheckCircle2, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, MessageSquare, ShieldCheck, Info, Users, CreditCard, ShieldQuestion, Trash2, PlusCircle, Landmark, Euro, WalletCards, Percent } from "lucide-react";
import { submitHauptgastAction, submitMitreisendeAction, submitPaymentAmountSelectionAction } from "@/lib/actions";
import type { Booking, GuestSubmittedData, Mitreisender } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { PradellLogo } from "@/components/shared/PradellLogo";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Step {
  id: string;
  name: string;
  Icon: React.ElementType;
  StepIcon: React.ElementType;
  Content: React.FC<StepContentProps>;
  action?: (bookingToken: string, prevState: any, formData: FormData) => Promise<any>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null;
  formState: FormState;
  onNext?: () => void;
  hauptgastSpecialRequests?: string;
  setHauptgastSpecialRequests?: (requests: string) => void;
}

type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
};

const initialFormState: FormState = { message: null, errors: null, success: false };

const getErrorMessage = (fieldName: string, errors: FormState['errors']): string | undefined => {
  return errors?.[fieldName]?.[0];
};

const formatDateDisplay = (dateString?: Date | string) => {
    if (!dateString) return "N/A";
    try {
      return format(new Date(dateString), "dd.MM.yyyy", { locale: de });
    } catch {
      return String(dateString); 
    }
  };

const formatCurrency = (amount?: number) => {
    if (typeof amount !== 'number') return "N/A";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
};

// Step 1: Hauptgast
const HauptgastStep: React.FC<StepContentProps> = ({ bookingToken, bookingDetails, formState, setHauptgastSpecialRequests }) => {
  const { pending } = useFormStatus();
  const [fileNameVorderseite, setFileNameVorderseite] = useState<string | null>(null);
  const [fileNameRückseite, setFileNameRückseite] = useState<string | null>(null);
  const [specialRequestsLocal, setSpecialRequestsLocal] = useState(bookingDetails?.guestSubmittedData?.specialRequests || "");

  useEffect(() => {
    if (setHauptgastSpecialRequests) {
        setHauptgastSpecialRequests(specialRequestsLocal);
    }
  }, [specialRequestsLocal, setHauptgastSpecialRequests]);


  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Ihre Daten (Hauptbucher)</h2>
        <p className="text-sm text-muted-foreground">Bitte füllen Sie die folgenden Felder aus.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="fullName" className="flex items-center mb-1"><UserCircle className="w-4 h-4 mr-2 text-muted-foreground" />Vorname</Label>
          <Input id="fullName" name="fullName" defaultValue={bookingDetails?.guestFirstName || ""} placeholder="Ihr Vorname" />
          {getErrorMessage("fullName", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("fullName", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="lastName" className="flex items-center mb-1"><UserCircle className="w-4 h-4 mr-2 text-muted-foreground" />Nachname</Label>
          <Input id="lastName" name="lastName" defaultValue={bookingDetails?.guestLastName || ""} placeholder="Ihr Nachname" />
          {getErrorMessage("lastName", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("lastName", formState.errors)}</p>}
        </div>
         <div>
          <Label htmlFor="email" className="flex items-center mb-1"><Mail className="w-4 h-4 mr-2 text-muted-foreground" />E-Mail</Label>
          <Input id="email" name="email" type="email" defaultValue={bookingDetails?.guestSubmittedData?.email || ""} placeholder="max.mustermann@email.com" />
          {getErrorMessage("email", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("email", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="phone" className="flex items-center mb-1"><Phone className="w-4 h-4 mr-2 text-muted-foreground" />Telefon</Label>
          <Input id="phone" name="phone" defaultValue={bookingDetails?.guestSubmittedData?.phone || ""} placeholder="+49 123 456789" />
          {getErrorMessage("phone", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("phone", formState.errors)}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="alter" className="flex items-center mb-1"><CalendarDays className="w-4 h-4 mr-2 text-muted-foreground" />Alter (optional)</Label>
        <Input id="alter" name="alter" type="number" placeholder="30" defaultValue={bookingDetails?.guestSubmittedData?.alter?.toString() || ""} />
        {getErrorMessage("alter", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("alter", formState.errors)}</p>}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Ausweisdokumente (optional)</h3>
        <div>
          <Label htmlFor="ausweisVorderseite" className="block mb-1 text-sm font-medium">Ausweisdokument (Vorderseite)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="ausweisVorderseite"
              name="ausweisVorderseite"
              type="file"
              className="hidden"
              onChange={(e) => setFileNameVorderseite(e.target.files?.[0]?.name || null)}
              accept=".jpg,.jpeg,.png,.pdf"
            />
            <Button asChild variant="outline" size="sm">
              <Label htmlFor="ausweisVorderseite" className="cursor-pointer">
                <FileUp className="w-4 h-4 mr-2"/> Wählen
              </Label>
            </Button>
            <span className="text-sm text-muted-foreground">{fileNameVorderseite || "Keine Datei ausgewählt"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Foto oder PDF (.jpg, .png, .pdf, max 5MB)</p>
          {getErrorMessage("ausweisVorderseite", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("ausweisVorderseite", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="ausweisRückseite" className="block mb-1 text-sm font-medium">Ausweisdokument (Rückseite)</Label>
           <div className="flex items-center gap-2">
            <Input
              id="ausweisRückseite"
              name="ausweisRückseite"
              type="file"
              className="hidden"
              onChange={(e) => setFileNameRückseite(e.target.files?.[0]?.name || null)}
              accept=".jpg,.jpeg,.png,.pdf"
            />
             <Button asChild variant="outline" size="sm">
              <Label htmlFor="ausweisRückseite" className="cursor-pointer">
                <FileUp className="w-4 h-4 mr-2"/> Wählen
              </Label>
            </Button>
            <span className="text-sm text-muted-foreground">{fileNameRückseite || "Keine Datei ausgewählt"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Foto oder PDF (.jpg, .png, .pdf, max 5MB)</p>
          {getErrorMessage("ausweisRückseite", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("ausweisRückseite", formState.errors)}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="specialRequests" className="flex items-center mb-1"><Info className="w-4 h-4 mr-2 text-muted-foreground" />Ihre Anmerkungen (optional)</Label>
        <Textarea
            id="specialRequests"
            name="specialRequests"
            placeholder="Haben Sie spezielle Wünsche?"
            rows={3}
            value={specialRequestsLocal}
            onChange={(e) => setSpecialRequestsLocal(e.target.value)}
        />
        {getErrorMessage("specialRequests", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("specialRequests", formState.errors)}</p>}
      </div>

      <div className="flex items-start space-x-3 p-4 border rounded-md bg-muted/30">
        <Checkbox id="datenschutz" name="datenschutz" defaultChecked={bookingDetails?.guestSubmittedData?.datenschutzAkzeptiert} />
        <div className="grid gap-1.5 leading-none">
          <Label htmlFor="datenschutz" className="flex items-center">
            <ShieldCheck className="w-4 h-4 mr-2 text-muted-foreground" />Datenschutz *
          </Label>
          <p className="text-sm text-muted-foreground">
            Ich bestätige hiermit, die <Link href="/datenschutz" target="_blank" className="underline text-primary">Datenschutzbestimmungen</Link> gelesen zu haben und stimme der Verarbeitung meiner Daten zu.
          </p>
          {getErrorMessage("datenschutz", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("datenschutz", formState.errors)}</p>}
        </div>
      </div>
    </div>
  );
};


const MitreisendeStep: React.FC<StepContentProps> = ({ bookingToken, bookingDetails, formState, hauptgastSpecialRequests }) => {
  const { pending } = useFormStatus();
  const [mitreisende, setMitreisende] = useState<Partial<Mitreisender>[]>(bookingDetails?.guestSubmittedData?.mitreisende || []);
  const [fileNames, setFileNames] = useState<Record<string, { vorderseite?: string; rueckseite?: string }>>({});


  const handleAddMitreisender = () => {
    setMitreisende([...mitreisende, { id: `temp-${Date.now()}` }]);
  };

  const handleRemoveMitreisender = (index: number) => {
    setMitreisende(mitreisende.filter((_, i) => i !== index));
    setFileNames(prev => {
        const newFileNames = {...prev};
        delete newFileNames[mitreisende[index].id || index.toString()];
        return newFileNames;
    });
  };

  const handleMitreisenderChange = (index: number, field: keyof Mitreisender, value: string) => {
    const updatedMitreisende = [...mitreisende];
    updatedMitreisende[index] = { ...updatedMitreisende[index], [field]: value };
    setMitreisende(updatedMitreisende);
  };

  const handleFileChange = (index: number, type: 'vorderseite' | 'rueckseite', file: File | null) => {
    const mitreisenderId = mitreisende[index].id || index.toString();
    setFileNames(prev => ({
        ...prev,
        [mitreisenderId]: {
            ...prev[mitreisenderId],
            [type]: file?.name
        }
    }));
  };

  const getPersonenText = () => {
    const erwachsene = bookingDetails?.erwachsene || 0;
    const kinder = bookingDetails?.kinder || 0;
    const kleinkinder = bookingDetails?.kleinkinder || 0;
    
    const parts: string[] = [];
    if (erwachsene > 0) parts.push(`${erwachsene} Erw.`);
    if (kinder > 0) parts.push(`${kinder} Ki.`);
    if (kleinkinder > 0) parts.push(`${kleinkinder} Klk.`);
    
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };

  return (
    <div className="space-y-8">
      <Card className="bg-muted/20 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary">Ihre Buchungsdetails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                    <p className="text-xs text-muted-foreground">Check-in</p>
                    <p className="font-semibold">{formatDateDisplay(bookingDetails?.checkInDate)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Check-out</p>
                    <p className="font-semibold">{formatDateDisplay(bookingDetails?.checkOutDate)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Preis</p>
                    <p className="font-semibold">{formatCurrency(bookingDetails?.price)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Verpflegung</p>
                    <p className="font-semibold capitalize">{bookingDetails?.verpflegung?.replace(/_/g, ' ') || 'Keine'}</p>
                </div>
            </div>
            <Separator/>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                    <p className="text-xs text-muted-foreground">Hauptzimmer</p>
                    <p className="font-semibold">{bookingDetails?.zimmertyp || 'N/A'}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Personen</p>
                    <p className="font-semibold">{getPersonenText()}</p>
                </div>
            </div>
            {(hauptgastSpecialRequests || bookingDetails?.interneBemerkungen) && <Separator/>}
            {hauptgastSpecialRequests && (
                <div>
                    <p className="text-xs text-muted-foreground">Ihre Anmerkungen</p>
                    <p className="font-medium whitespace-pre-wrap">{hauptgastSpecialRequests}</p>
                </div>
            )}
             {bookingDetails?.interneBemerkungen && (
                <div>
                    <p className="text-xs text-muted-foreground">Anmerkungen (Hotel)</p>
                    <p className="font-medium whitespace-pre-wrap">{bookingDetails.interneBemerkungen}</p>
                </div>
            )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center">Weitere Mitreisende</CardTitle>
          <CardDescription>Fügen Sie hier die Daten aller weiteren Personen hinzu (optional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {mitreisende.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Keine weiteren Mitreisenden angegeben.</p>
          )}
          {mitreisende.map((gast, index) => (
            <div key={gast.id || index} className="p-4 border rounded-md space-y-4 relative bg-muted/20">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveMitreisender(index)}
                aria-label="Mitreisenden entfernen"
                type="button" 
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <h3 className="font-medium text-base">Mitreisender {index + 1}</h3>
              <input type="hidden" name={`mitreisende[${index}][id]`} value={gast.id || ''} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor={`mitreisende[${index}][vorname]`}>Vorname</Label>
                  <Input
                    id={`mitreisende[${index}][vorname]`}
                    name={`mitreisende[${index}][vorname]`}
                    defaultValue={gast.vorname}
                    onChange={(e) => handleMitreisenderChange(index, 'vorname', e.target.value)}
                    placeholder="Max"
                  />
                   {getErrorMessage(`mitreisende[${index}].vorname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende[${index}].vorname`, formState.errors)}</p>}
                </div>
                <div>
                  <Label htmlFor={`mitreisende[${index}][nachname]`}>Nachname</Label>
                  <Input
                    id={`mitreisende[${index}][nachname]`}
                    name={`mitreisende[${index}][nachname]`}
                    defaultValue={gast.nachname}
                    onChange={(e) => handleMitreisenderChange(index, 'nachname', e.target.value)}
                    placeholder="Muster"
                  />
                   {getErrorMessage(`mitreisende[${index}].nachname`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende[${index}].nachname`, formState.errors)}</p>}
                </div>
                <div>
                  <Label htmlFor={`mitreisende[${index}][alter]`}>Alter</Label>
                  <Input
                    id={`mitreisende[${index}][alter]`}
                    name={`mitreisende[${index}][alter]`}
                    type="number"
                    defaultValue={gast.alter?.toString()}
                    onChange={(e) => handleMitreisenderChange(index, 'alter', e.target.value)}
                    placeholder="30"
                  />
                   {getErrorMessage(`mitreisende[${index}].alter`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende[${index}].alter`, formState.errors)}</p>}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">Ausweisdokumente (optional)</p>
                <div>
                  <Label htmlFor={`mitreisende[${index}][ausweisVorderseite]`} className="text-xs">Vorderseite</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                        id={`mitreisende[${index}][ausweisVorderseite]`}
                        name={`mitreisende[${index}][ausweisVorderseite]`}
                        type="file"
                        className="hidden"
                        accept=".jpg,.jpeg,.png,.pdf"
                        onChange={(e) => handleFileChange(index, 'vorderseite', e.target.files?.[0] || null)}
                    />
                    <Button asChild variant="outline" size="sm"><Label htmlFor={`mitreisende[${index}][ausweisVorderseite]`} className="cursor-pointer"><FileUp className="w-3 h-3 mr-1.5"/> Wählen</Label></Button>
                    <span className="text-xs text-muted-foreground">{fileNames[gast.id || index.toString()]?.vorderseite || "Keine Datei"}</span>
                  </div>
                  {getErrorMessage(`mitreisende[${index}].ausweisVorderseite`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende[${index}].ausweisVorderseite`, formState.errors)}</p>}
                </div>
                <div>
                  <Label htmlFor={`mitreisende[${index}][ausweisRückseite]`} className="text-xs">Rückseite</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                        id={`mitreisende[${index}][ausweisRückseite]`}
                        name={`mitreisende[${index}][ausweisRückseite]`}
                        type="file"
                        className="hidden"
                        accept=".jpg,.jpeg,.png,.pdf"
                        onChange={(e) => handleFileChange(index, 'rueckseite', e.target.files?.[0] || null)}
                    />
                    <Button asChild variant="outline" size="sm"><Label htmlFor={`mitreisende[${index}][ausweisRückseite]`} className="cursor-pointer"><FileUp className="w-3 h-3 mr-1.5"/> Wählen</Label></Button>
                    <span className="text-xs text-muted-foreground">{fileNames[gast.id || index.toString()]?.rueckseite || "Keine Datei"}</span>
                  </div>
                  {getErrorMessage(`mitreisende[${index}].ausweisRückseite`, formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage(`mitreisende[${index}].ausweisRückseite`, formState.errors)}</p>}
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={handleAddMitreisender} className="w-full sm:w-auto" type="button">
            <PlusCircle className="w-4 h-4 mr-2" /> Weiteren Gast hinzufügen
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};


const ZahlungssummeWaehlenStep: React.FC<StepContentProps> = ({ bookingDetails, formState, hauptgastSpecialRequests }) => {
  const { pending } = useFormStatus();
  const [selectedOption, setSelectedOption] = useState<'downpayment' | 'full_amount'>(
    bookingDetails?.guestSubmittedData?.paymentAmountSelection || 'full_amount'
  );

  const totalPrice = bookingDetails?.price || 0;
  const downPayment = totalPrice * 0.3;

  const getPersonenText = () => {
    const erwachsene = bookingDetails?.erwachsene || 0;
    const kinder = bookingDetails?.kinder || 0;
    const kleinkinder = bookingDetails?.kleinkinder || 0;
    
    const parts: string[] = [];
    if (erwachsene > 0) parts.push(`${erwachsene} Erw.`);
    if (kinder > 0) parts.push(`${kinder} Ki.`);
    if (kleinkinder > 0) parts.push(`${kleinkinder} Klk.`);
    
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };


  return (
    <div className="space-y-8">
      <Card className="bg-muted/20 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary">Ihre Buchungsdetails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                    <p className="text-xs text-muted-foreground">Check-in</p>
                    <p className="font-semibold">{formatDateDisplay(bookingDetails?.checkInDate)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Check-out</p>
                    <p className="font-semibold">{formatDateDisplay(bookingDetails?.checkOutDate)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Preis</p>
                    <p className="font-semibold">{formatCurrency(bookingDetails?.price)}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Verpflegung</p>
                    <p className="font-semibold capitalize">{bookingDetails?.verpflegung?.replace(/_/g, ' ') || 'Keine'}</p>
                </div>
            </div>
            <Separator/>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                    <p className="text-xs text-muted-foreground">Hauptzimmer</p>
                    <p className="font-semibold">{bookingDetails?.zimmertyp || 'N/A'}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Personen</p>
                    <p className="font-semibold">{getPersonenText()}</p>
                </div>
            </div>
             {hauptgastSpecialRequests && (
              <>
                <Separator/>
                <div>
                    <p className="text-xs text-muted-foreground">Ihre Anmerkungen</p>
                    <p className="font-medium whitespace-pre-wrap">{hauptgastSpecialRequests}</p>
                </div>
              </>
            )}
            {bookingDetails?.interneBemerkungen && (
              <>
                <Separator/>
                <div>
                    <p className="text-xs text-muted-foreground">Anmerkungen (Hotel)</p>
                    <p className="font-medium whitespace-pre-wrap">{bookingDetails.interneBemerkungen}</p>
                </div>
              </>
            )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
            <CardTitle className="text-xl font-semibold">Zahlungssumme wählen</CardTitle>
            <CardDescription>Wählen Sie, ob Sie eine Anzahlung oder den Gesamtbetrag leisten möchten.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="flex items-center mb-4 text-sm">
                <Mail className="w-4 h-4 mr-2 text-muted-foreground" />
                <span>Wählen Sie Ihre bevorzugte Zahlungssumme *</span>
            </div>
            <RadioGroup
                name="paymentSelection"
                defaultValue={selectedOption}
                onValueChange={(value: 'downpayment' | 'full_amount') => setSelectedOption(value)}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
                <Label htmlFor="downpayment" className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all",
                    selectedOption === 'downpayment' ? "border-primary ring-2 ring-primary shadow-lg" : "border-border hover:shadow-md"
                )}>
                    <RadioGroupItem value="downpayment" id="downpayment" className="sr-only" />
                    <div className="flex flex-col items-center text-center">
                        <Landmark className="w-8 h-8 mb-2 text-muted-foreground" />
                        <h3 className="font-semibold text-lg">Anzahlung</h3>
                        <p className="text-sm text-muted-foreground">30% des Gesamtbetrags</p>
                        <p className="text-xl font-bold mt-1">{formatCurrency(downPayment)}</p>
                        {selectedOption === 'downpayment' && <CheckCircle2 className="w-5 h-5 text-primary mt-2" />}
                    </div>
                </Label>

                 <Label htmlFor="full_amount" className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all",
                    selectedOption === 'full_amount' ? "border-primary ring-2 ring-primary shadow-lg" : "border-border hover:shadow-md"
                )}>
                    <RadioGroupItem value="full_amount" id="full_amount" className="sr-only" />
                    <div className="flex flex-col items-center text-center">
                        <Euro className="w-8 h-8 mb-2 text-muted-foreground" />
                        <h3 className="font-semibold text-lg">Gesamtbetrag</h3>
                        <p className="text-sm text-muted-foreground">100% des Gesamtbetrags</p>
                        <p className="text-xl font-bold mt-1">{formatCurrency(totalPrice)}</p>
                        {selectedOption === 'full_amount' && <CheckCircle2 className="w-5 h-5 text-primary mt-2" />}
                    </div>
                </Label>
            </RadioGroup>
            {getErrorMessage("paymentSelection", formState.errors) && <p className="text-xs text-destructive mt-2">{getErrorMessage("paymentSelection", formState.errors)}</p>}
        </CardContent>
      </Card>
    </div>
  );
};


const ZahlungsinfoStep: React.FC<StepContentProps> = ({ formState }) => {
  const { pending } = useFormStatus();
  return (
    <div>
      <h2 className="text-xl font-semibold">Zahlungsinformationen</h2>
      <p className="text-sm text-muted-foreground mb-4">Geben Sie Ihre Zahlungsdetails ein.</p>
      <p className="text-center text-muted-foreground py-8">Dieser Schritt ist noch in Bearbeitung.</p>
    </div>
  );
};


export function GuestBookingFormStepper({ bookingToken, bookingDetails: initialBookingDetails }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [bookingDetails, setBookingDetails] = useState(initialBookingDetails); 
  const [hauptgastSpecialRequests, setHauptgastSpecialRequests] = useState(initialBookingDetails?.guestSubmittedData?.specialRequests || "");

  useEffect(() => {
    setBookingDetails(initialBookingDetails);
    setHauptgastSpecialRequests(initialBookingDetails?.guestSubmittedData?.specialRequests || "");
  }, [initialBookingDetails]);


  console.log(`[GuestBookingFormStepper] Rendering. Token: ${bookingToken}. Current Step: ${currentStep}. Initial Booking Details:`, initialBookingDetails ? {...initialBookingDetails, guestSubmittedData: !!initialBookingDetails.guestSubmittedData} : null);

  const steps: Step[] = useMemo(() => [
    { id: "hauptgast", name: "Hauptgast", Icon: UserCircle, StepIcon: UserCircle, Content: HauptgastStep, action: submitHauptgastAction },
    { id: "mitreisende", name: "Mitreisende", Icon: Users, StepIcon: Users, Content: MitreisendeStep, action: submitMitreisendeAction },
    { id: "zahlungssumme", name: "Zahlungssumme", Icon: WalletCards, StepIcon: WalletCards, Content: ZahlungssummeWaehlenStep, action: submitPaymentAmountSelectionAction },
    { id: "zahlungsinfo", name: "Zahlungsinfo", Icon: CreditCard, StepIcon: CreditCard, Content: ZahlungsinfoStep, action: async () => ({success: true, message: "Platzhalter Zahlungsinfo übersprungen"}) },
  ], []);

  const totalDisplaySteps = 5; 
  const stepperLabels = ["Hauptgast", "Mitreisende", "Zahlungssumme", "Zahlungsinfo", "Bestätigung"];

  const boundAction = steps[currentStep]?.action
    ? steps[currentStep].action!.bind(null, bookingToken)
    : async (prevState: FormState, formData: FormData) => {
        console.error("[GuestBookingFormStepper] Fehler: Aktion für den aktuellen Schritt nicht gefunden oder ungültiger Schritt.", currentStep, steps);
        return Promise.resolve({ message: "Aktion nicht definiert oder Schritt ungültig.", errors: null, success: false });
      };

  const [formState, formAction] = useActionState(boundAction, initialFormState);
  const { toast } = useToast();

  useEffect(() => {
    if (formState.message) {
      toast({
        title: formState.success ? "Erfolg" : "Hinweis",
        description: formState.message,
        variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });
    }

    if (formState.success && currentStep < steps.length -1) {
      // Nur weiterschalten, wenn die Aktion erfolgreich war und es noch weitere interaktive Schritte gibt
      setCurrentStep(prev => prev + 1);
       // Formularstatus zurücksetzen, damit der Toast nicht erneut erscheint, wenn der Benutzer zurück navigiert
       // und dann wieder vorwärts, ohne die Aktion erneut auszulösen.
       // Dies sollte idealerweise im useActionState Hook selbst passieren, wenn er zurückgesetzt wird,
       // aber hier manuell für Klarheit und sofortige Wirkung.
       // WICHTIG: Dies ist ein Workaround. Ein besseres State-Management für formState wäre, es
       // explizit zurückzusetzen oder useActionState so zu verwenden, dass es sich bei neuer Action zurücksetzt.
       // Für den Moment, um das Springen zu verhindern:
       // (initialFormState as any).success = false; // Temporary hack, not ideal
    } else if (formState.success && currentStep === steps.length - 1) {
      // Letzter interaktiver Schritt erfolgreich, Formular ist quasi abgeschlossen
      // Die Seite /buchung/[token] sollte nun die finale Bestätigungsnachricht anzeigen,
      // basierend auf dem aktualisierten Booking-Status (z.B. "Confirmed")
      console.log("[GuestBookingFormStepper] Alle interaktiven Schritte abgeschlossen.");
    }
  }, [formState, toast, currentStep, steps.length]);


  if (!steps || currentStep < 0 ) {
     console.error("[GuestBookingFormStepper] Invalid steps array or currentStep index.", currentStep, steps);
     return <p>Ein interner Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.</p>;
  }


  if (currentStep >= steps.length ) {
     // Dieser Zustand sollte erreicht werden, nachdem der letzte interaktive Schritt erfolgreich war.
     // Die übergeordnete Seite /buchung/[token]/page.tsx sollte dann die finale Bestätigungsnachricht zeigen.
     // Dieser return-Block dient als Fallback oder für den Fall, dass die Seite nicht neu geladen wird
     // um den finalen Status zu zeigen.
    console.warn("[GuestBookingFormStepper] currentStep ist jenseits der definierten interaktiven Schritte. Aktueller Schritt:", currentStep, "Anzahl Schritte:", steps.length);
    return (
      <>
        <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <PradellLogo className="mb-8" />
            <Card className="w-full shadow-xl">
                <CardHeader className="items-center text-center">
                { formState.success || bookingDetails?.status === "Confirmed" ? <CheckCircle className="w-16 h-16 text-green-500 mb-4" /> : <Info className="w-16 h-16 text-blue-500 mb-4" /> }
                <CardTitle className="text-2xl">Buchungsabschluss</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                <CardDescription>
                    { formState.success || bookingDetails?.status === "Confirmed" ? `Vielen Dank, ${bookingDetails?.guestFirstName || 'Gast'}! Ihre Daten wurden erfolgreich übermittelt. Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.` 
                                      : "Das Formular wurde bereits abgeschlossen oder befindet sich in einem unerwarteten Zustand." }
                </CardDescription>
                { (formState.success || bookingDetails?.status === "Confirmed") && <p className="mt-2">Ihre Buchungsreferenz: <strong>{bookingToken}</strong></p>}
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
  const { pending } = useFormStatus(); // Bezieht sich auf die Action des aktuellen Schritts

  return (
    <>
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <PradellLogo className="mb-8" />
        <CardTitle className="text-3xl font-bold text-center mb-2">Buchung vervollständigen</CardTitle>
        <p className="text-center text-muted-foreground mb-10">Schritt {stepNumberForDisplay} von {totalDisplaySteps} - {stepperLabels[currentStep]}</p>

        <div className="mb-12">
          <ol className="flex items-center w-full">
            {stepperLabels.map((label, index) => {
              const StepIconComponent = steps[index] ? steps[index].StepIcon : null; // Korrigiert: StepIconComponent statt StepIcon
              return (
              <li
                key={label}
                className={cn(
                  "flex w-full items-center",
                  index < totalDisplaySteps - 1 ? "after:content-[''] after:w-full after:h-0.5 after:border-b after:border-muted after:inline-block" : "",
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
                      {label}
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
            <form action={formAction}>
              <ActiveStepContent
                bookingToken={bookingToken}
                bookingDetails={bookingDetails}
                formState={formState}
                hauptgastSpecialRequests={hauptgastSpecialRequests}
                setHauptgastSpecialRequests={setHauptgastSpecialRequests} 
              />
              {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
                <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2"/> {formState.message}
                </div>
              )}
               <div className="flex justify-between items-center mt-8 pt-6 border-t">
                {currentStep > 0 ? (
                    <Button variant="outline" onClick={() => {
                        setCurrentStep(prev => prev -1);
                        // Formularstatus zurücksetzen, um alte Fehlermeldungen zu löschen
                        // Dies sollte idealerweise über eine Reset-Funktion des useActionState oder
                        // durch Neumontage der Komponente geschehen.
                        // (initialFormState as any).errors = null; 
                        // (initialFormState as any).message = null;
                        // (initialFormState as any).success = false;
                    }} type="button" disabled={pending}>
                        Zurück
                    </Button>
                ) : <div></div> 
                }
                
                <Button type="submit" disabled={pending}>
                    {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 
                     (currentStep === steps.length -1 ? "Buchung abschließen" : `Weiter zu Schritt ${currentStep + 2}`)}
                </Button>
               </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

    