
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
import { AlertCircle, Check, CheckCircle, FileUp, Loader2, UserCircle, Mail, Phone, CalendarDays, MessageSquare, ShieldCheck, Info, Users, CreditCard, ShieldQuestion } from "lucide-react";
import { submitHauptgastAction } from "@/lib/actions"; // Updated action name
import type { Booking, GuestSubmittedData } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { PradellLogo } from "@/components/shared/PradellLogo";
import Link from "next/link";

interface Step {
  id: string;
  name: string;
  Icon: React.ElementType; // Icon for the form content section
  StepIcon: React.ElementType; // Icon for the stepper progress display
  Content: React.FC<StepContentProps>;
  action?: (bookingToken: string, prevState: any, formData: FormData) => Promise<any>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null; // Make bookingDetails optional as it might not be available initially
  formState: FormState;
  onNext?: () => void; // Optional: for client-side only navigation if needed
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

// Step 1: Hauptgast
const HauptgastStep: React.FC<StepContentProps> = ({ bookingToken, bookingDetails, formState }) => {
  const { pending } = useFormStatus();
  const [fileNameVorderseite, setFileNameVorderseite] = useState<string | null>(null);
  const [fileNameRückseite, setFileNameRückseite] = useState<string | null>(null);

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
        <Input id="alter" name="alter" type="number" placeholder="30" />
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
        <Textarea id="specialRequests" name="specialRequests" placeholder="Haben Sie spezielle Wünsche?" rows={3} />
        {getErrorMessage("specialRequests", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("specialRequests", formState.errors)}</p>}
      </div>
      
      <div className="flex items-start space-x-3 p-4 border rounded-md bg-muted/30">
        <Checkbox id="datenschutz" name="datenschutz" />
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

      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Weiter zu Schritt 2
      </Button>
    </div>
  );
};

// Placeholder for Step 2: Mitreisende
const MitreisendeStep: React.FC<StepContentProps> = ({ formState }) => {
  const { pending } = useFormStatus();
  return (
    <div>
      <h2 className="text-xl font-semibold">Mitreisende</h2>
      <p className="text-sm text-muted-foreground mb-4">Angaben zu weiteren Gästen (falls zutreffend).</p>
      {/* TODO: Implement fields for additional guests */}
      <p className="text-center text-muted-foreground py-8">Dieser Schritt ist noch in Bearbeitung.</p>
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Weiter zu Schritt 3
      </Button>
    </div>
  );
};

// Placeholder for Step 3: Zahlungswahl
const ZahlungswahlStep: React.FC<StepContentProps> = ({ formState }) => {
  const { pending } = useFormStatus();
  return (
    <div>
      <h2 className="text-xl font-semibold">Zahlungswahl</h2>
      <p className="text-sm text-muted-foreground mb-4">Wählen Sie Ihre bevorzugte Zahlungsmethode.</p>
      {/* TODO: Implement payment method selection */}
      <p className="text-center text-muted-foreground py-8">Dieser Schritt ist noch in Bearbeitung.</p>
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Weiter zu Schritt 4
      </Button>
    </div>
  );
};

// Placeholder for Step 4: Zahlungsinfo
const ZahlungsinfoStep: React.FC<StepContentProps> = ({ formState }) => {
  const { pending } = useFormStatus();
  return (
    <div>
      <h2 className="text-xl font-semibold">Zahlungsinformationen</h2>
      <p className="text-sm text-muted-foreground mb-4">Geben Sie Ihre Zahlungsdetails ein.</p>
      {/* TODO: Implement payment details form */}
      <p className="text-center text-muted-foreground py-8">Dieser Schritt ist noch in Bearbeitung.</p>
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Buchung abschließen
      </Button>
    </div>
  );
};


export function GuestBookingFormStepper({ bookingToken, bookingDetails: initialBookingDetails }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const [currentStep, setCurrentStep] = useState(0);
  // Use state for bookingDetails to allow potential updates if we fetch them client-side later
  const [bookingDetails, setBookingDetails] = useState(initialBookingDetails); 

  console.log(`[GuestBookingFormStepper] Rendering. Token: ${bookingToken}. Current Step: ${currentStep}. Initial Booking Details:`, initialBookingDetails ? {...initialBookingDetails, guestSubmittedData: !!initialBookingDetails.guestSubmittedData} : null);


  const steps: Step[] = useMemo(() => [
    { id: "hauptgast", name: "Hauptgast", Icon: UserCircle, StepIcon: UserCircle, Content: HauptgastStep, action: submitHauptgastAction },
    { id: "mitreisende", name: "Mitreisende", Icon: Users, StepIcon: Users, Content: MitreisendeStep, action: async () => ({success: true, message: "Platzhalter Mitreisende übersprungen"}) }, // Placeholder action
    { id: "zahlungswahl", name: "Zahlungswahl", Icon: CreditCard, StepIcon: CreditCard, Content: ZahlungswahlStep, action: async () => ({success: true, message: "Platzhalter Zahlungswahl übersprungen"}) }, // Placeholder action
    { id: "zahlungsinfo", name: "Zahlungsinfo", Icon: ShieldQuestion, StepIcon: ShieldQuestion, Content: ZahlungsinfoStep, action: async () => ({success: true, message: "Platzhalter Zahlungsinfo übersprungen"}) }, // Placeholder action
    // The 5th step "Bestätigung" is handled by the success screen after the last action
  ], []);
  
  const totalDisplaySteps = 5; // For the visual stepper: Hauptgast, Mitreisende, Zahlungswahl, Zahlungsinfo, Bestätigung

  const [formState, formAction] = useActionState(
    async (prevState: FormState, formData: FormData) => {
      if (currentStep >= 0 && currentStep < steps.length) {
        const currentAction = steps[currentStep].action;
        if (currentAction) {
          // For file inputs, ensure they are correctly passed in formData.
          // For 'HauptgastStep', 'ausweisVorderseite' and 'ausweisRückseite' are file inputs.
          console.log(`[GuestBookingFormStepper FormAction] Executing action for step: ${steps[currentStep].id}`);
          return currentAction(bookingToken, prevState, formData);
        }
      }
      console.error("[GuestBookingFormStepper] Fehler: Aktion für den aktuellen Schritt nicht gefunden oder ungültiger Schritt.", currentStep, steps);
      return Promise.resolve({ message: "Aktion nicht definiert oder Schritt ungültig.", errors: null, success: false });
    },
    initialFormState
  );

  const { toast } = useToast();

  useEffect(() => {
    if (formState.message) {
      toast({
        title: formState.success ? "Erfolg" : "Hinweis",
        description: formState.message,
        variant: formState.success ? "default" : (formState.errors && Object.keys(formState.errors).length > 0 ? "destructive" : "default"),
      });
    }

    if (formState.success && currentStep < steps.length -1) { // if successful and not the last action step
      setCurrentStep(prev => prev + 1);
    }
    // If it's the last action step and successful, the success screen below will handle it.
  }, [formState, toast, currentStep, steps]);


  if (!steps || currentStep < 0) { 
     console.error("[GuestBookingFormStepper] Invalid steps array or currentStep index.", currentStep, steps);
     return <p>Ein interner Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.</p>;
  }
  
  // Success screen after the final actual step (e.g., Zahlungsinfo)
  if (formState.success && currentStep === steps.length - 1) {
    return (
       <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <PradellLogo className="mb-8" />
        <Card className="w-full shadow-xl">
            <CardHeader className="items-center text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <CardTitle className="text-2xl">Buchung erfolgreich vervollständigt!</CardTitle>
            <CardDescription>
                Vielen Dank, {bookingDetails?.guestFirstName || 'Gast'}! Ihre Daten wurden erfolgreich übermittelt. Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.
            </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
            <p>Ihre Buchungsreferenz: <strong>{bookingToken}</strong></p>
            <p className="mt-2 text-muted-foreground">Sie können diese Seite nun schließen.</p>
            </CardContent>
        </Card>
      </div>
    );
  }
  
  // If currentStep is somehow out of bounds but not yet caught by success condition
  if (currentStep >= steps.length && !(formState.success && currentStep === steps.length -1)) {
     console.warn("[GuestBookingFormStepper] currentStep is out of bounds. Current step:", currentStep, "Steps length:", steps.length);
    return (
        <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <PradellLogo className="mb-8" />
            <Card className="w-full shadow-xl">
                <CardHeader className="items-center text-center">
                <Info className="w-16 h-16 text-blue-500 mb-4" />
                <CardTitle className="text-2xl">Formularstatus</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                <CardDescription>Das Formular wurde bereits abgeschlossen oder befindet sich in einem unerwarteten Zustand.</CardDescription>
                </CardContent>
            </Card>
        </div>
    );
  }

  const ActiveStepContent = steps[currentStep].Content;
  const stepNumberForDisplay = currentStep + 1; // 1-based index for display

  const stepperLabels = ["Hauptgast", "Mitreisende", "Zahlungswahl", "Zahlungsinfo", "Bestätigung"];


  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <PradellLogo className="mb-8" />
      <CardTitle className="text-3xl font-bold text-center mb-2">Buchung vervollständigen</CardTitle>
      <p className="text-center text-muted-foreground mb-10">Schritt {stepNumberForDisplay} von {totalDisplaySteps}</p>
      
      {/* Stepper Visual */}
      <div className="mb-12">
        <ol className="flex items-center w-full">
          {stepperLabels.map((label, index) => (
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
                  {index < currentStep ? <Check className="w-5 h-5" /> : index + 1}
                </span>
                <span className={cn(
                    "text-xs",
                     index <= currentStep ? "text-primary" : "text-muted-foreground"
                )}>
                    {label}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <Card className="w-full shadow-xl">
        <CardHeader className="border-b">
            <CardTitle className="text-xl">{steps[currentStep].name}</CardTitle>
             {/* Optional: Could add a description for the current step here */}
        </CardHeader>
        <CardContent className="pt-6">
          <form action={formAction}>
            <ActiveStepContent bookingToken={bookingToken} bookingDetails={bookingDetails} formState={formState} />
            {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
              <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
                <AlertCircle className="h-4 w-4 mr-2"/> {formState.message}
              </div>
            )}
          </form>
        </CardContent>
        {/* Footer with Back button (if not the first step) */}
        {(currentStep > 0 && currentStep < steps.length && !(formState.success && currentStep === steps.length - 1)) && (
           <CardFooter className="border-t pt-6">
              <Button variant="outline" onClick={() => setCurrentStep(prev => prev -1)} className="mr-auto">
                  Zurück
              </Button>
           </CardFooter>
        )}
      </Card>
    </div>
  );
}
