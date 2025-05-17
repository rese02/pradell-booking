
"use client";

import { useState, useEffect, type ReactNode, useActionState, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle, FileUp, Loader2, UserCircle, MessageSquare, Info } from "lucide-react";
import { submitGuestPersonalDataAction, submitGuestDocumentsAction, submitGuestSpecialRequestsAction } from "@/lib/actions";
import type { Booking } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface Step {
  id: string;
  name: string;
  icon: React.ElementType;
  fields?: string[];
  Content: React.FC<StepContentProps>;
  action?: (bookingToken: string, prevState: any, formData: FormData) => Promise<any>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null;
  formState: FormState;
  onNext?: () => void;
}

type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
};

const initialFormState: FormState = { message: null, errors: null, success: false };

// Helper function to format Zod errors for display
const getErrorMessage = (fieldName: string, errors: FormState['errors']): string | undefined => {
  return errors?.[fieldName]?.[0];
};


// Step 1: Personal Data
const PersonalDataStep: React.FC<StepContentProps> = ({ bookingToken, formState }) => {
  const { pending } = useFormStatus();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="fullName">Vollständiger Name</Label>
          <Input id="fullName" name="fullName" required />
          {getErrorMessage("fullName", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("fullName", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="email">E-Mail</Label>
          <Input id="email" name="email" type="email" required />
          {getErrorMessage("email", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("email", formState.errors)}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="phone">Telefonnummer</Label>
        <Input id="phone" name="phone" required />
        {getErrorMessage("phone", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("phone", formState.errors)}</p>}
      </div>
      <div>
        <Label htmlFor="addressLine1">Adresse Zeile 1</Label>
        <Input id="addressLine1" name="addressLine1" required />
        {getErrorMessage("addressLine1", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("addressLine1", formState.errors)}</p>}
      </div>
      <div>
        <Label htmlFor="addressLine2">Adresse Zeile 2 (Optional)</Label>
        <Input id="addressLine2" name="addressLine2" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="city">Stadt</Label>
          <Input id="city" name="city" required />
          {getErrorMessage("city", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("city", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="postalCode">Postleitzahl</Label>
          <Input id="postalCode" name="postalCode" required />
          {getErrorMessage("postalCode", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("postalCode", formState.errors)}</p>}
        </div>
        <div>
          <Label htmlFor="country">Land</Label>
          <Input id="country" name="country" required />
          {getErrorMessage("country", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("country", formState.errors)}</p>}
        </div>
      </div>
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Weiter
      </Button>
    </div>
  );
};

// Step 2: Document Upload
const DocumentUploadStep: React.FC<StepContentProps> = ({ bookingToken, formState }) => {
  const { pending } = useFormStatus();
  const [fileNames, setFileNames] = useState<string[]>([]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setFileNames(Array.from(event.target.files).map(file => file.name));
    } else {
      setFileNames([]);
    }
  };

  return (
    <div className="space-y-4">
      <Label htmlFor="documents">Dokumente hochladen (z.B. Ausweis)</Label>
      <Input id="documents" name="documents" type="file" multiple onChange={handleFileChange} />
      {fileNames.length > 0 && (
        <div className="mt-2 text-sm text-muted-foreground">
          Ausgewählte Dateien: {fileNames.join(', ')}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Sie können mehrere Dateien auswählen. Max. Dateigröße pro Datei: 5MB. Akzeptierte Formate: JPG, PNG, PDF.
      </p>
      {getErrorMessage("documents", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("documents", formState.errors)}</p>}
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Weiter
      </Button>
    </div>
  );
};

// Step 3: Special Requests
const SpecialRequestsStep: React.FC<StepContentProps> = ({ bookingToken, formState }) => {
  const { pending } = useFormStatus();
  return (
    <div className="space-y-4">
      <Label htmlFor="specialRequests">Sonderwünsche (Optional)</Label>
      <Textarea id="specialRequests" name="specialRequests" placeholder="z.B. Allergien, späte Anreise, Zimmerpräferenzen..." rows={4}/>
      {getErrorMessage("specialRequests", formState.errors) && <p className="text-xs text-destructive mt-1">{getErrorMessage("specialRequests", formState.errors)}</p>}
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Buchung abschließen
      </Button>
    </div>
  );
};

const formatVerpflegung = (verpflegung?: string) => {
  if (!verpflegung) return "";
  switch (verpflegung.toLowerCase()) {
    case "fruehstueck": return "Frühstück";
    case "halbpension": return "Halbpension";
    case "vollpension": return "Vollpension";
    case "ohne": return "Ohne Verpflegung";
    default: return verpflegung;
  }
};

const formatZimmertyp = (zimmertyp?: string) => {
  if (!zimmertyp) return "Standard";
  switch (zimmertyp.toLowerCase()) {
    case "standard": return "Standard Zimmer";
    case "einzelzimmer": return "Einzelzimmer";
    case "doppelzimmer": return "Doppelzimmer";
    case "suite": return "Suite";
    case "familienzimmer": return "Familienzimmer";
    default: return zimmertyp;
  }
};


export function GuestBookingFormStepper({ bookingToken, bookingDetails }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps: Step[] = useMemo(() => [
    { id: "personal-data", name: "Persönliche Daten", icon: UserCircle, Content: PersonalDataStep, action: submitGuestPersonalDataAction },
    { id: "documents", name: "Dokumente (Optional)", icon: FileUp, Content: DocumentUploadStep, action: submitGuestDocumentsAction },
    { id: "special-requests", name: "Sonderwünsche", icon: MessageSquare, Content: SpecialRequestsStep, action: submitGuestSpecialRequestsAction },
  ], []);

  const [formState, formAction] = useActionState(
    (prevState: FormState, formData: FormData) => {
      if (currentStep >= 0 && currentStep < steps.length) {
        const currentAction = steps[currentStep].action;
        if (currentAction) {
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

    if (formState.success && currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  }, [formState, toast, currentStep, steps]);


  if (!steps || currentStep < 0) { 
     console.error("[GuestBookingFormStepper] Invalid steps array or currentStep index.", currentStep, steps);
     return <p>Ein interner Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.</p>;
  }

  if (formState.success && currentStep === steps.length - 1) {
    return (
      <Card className="w-full max-w-2xl mx-auto shadow-xl">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
          <CardTitle className="text-2xl">Buchung erfolgreich abgeschlossen!</CardTitle>
          <CardDescription>
            Vielen Dank, {bookingDetails?.guestFirstName || 'Gast'}! Ihre Daten wurden erfolgreich übermittelt. Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p>Ihre Buchungsreferenz: <strong>{bookingToken}</strong></p>
          <p className="mt-2 text-muted-foreground">Sie können diese Seite nun schließen.</p>
        </CardContent>
      </Card>
    );
  }
  
  if (currentStep >= steps.length) {
     console.warn("[GuestBookingFormStepper] currentStep is out of bounds (>= steps.length) but not yet caught by success condition. Current step:", currentStep, "Steps length:", steps.length);
    return (
         <Card className="w-full max-w-2xl mx-auto shadow-xl">
            <CardHeader className="items-center text-center">
              <Info className="w-16 h-16 text-blue-500 mb-4" />
              <CardTitle className="text-2xl">Formularstatus</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <CardDescription>Das Formular wurde bereits abgeschlossen oder befindet sich in einem unerwarteten Zustand.</CardDescription>
            </CardContent>
        </Card>
    );
  }

  const ActiveStepContent = steps[currentStep].Content;

  const numAdults = bookingDetails?.erwachsene ?? 0;
  const numChildren = bookingDetails?.kinder ?? 0;
  const numInfants = bookingDetails?.kleinkinder ?? 0;

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-xl">
      <CardHeader>
        <div className="mb-6">
          <ol className="flex items-center w-full">
            {steps.map((step, index) => (
              <li
                key={step.id}
                className={cn(
                  "flex w-full items-center",
                  index < steps.length -1 ? "after:content-[''] after:w-full after:h-1 after:border-b after:border-4 after:inline-block" : "",
                  index <= currentStep ? "after:border-primary" : "after:border-muted",
                  index < currentStep ? "text-primary" : index === currentStep ? "text-primary font-semibold" : "text-muted-foreground"
                )}
              >
                <span className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full lg:h-12 lg:w-12 shrink-0",
                  index <= currentStep ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <step.icon className="w-5 h-5 lg:w-6 lg:h-6" />
                </span>
              </li>
            ))}
          </ol>
           <p className="text-center mt-2 text-sm font-medium">{steps[currentStep].name}</p>
        </div>
        <CardTitle className="text-2xl">Buchungsdaten vervollständigen</CardTitle>
        <CardDescription className="text-base mt-2 space-y-1">
          <p>Hallo {bookingDetails?.guestFirstName || 'Gast'}, Ihre Buchung für</p>
          <p className="font-semibold">
            ein {formatZimmertyp(bookingDetails?.zimmertyp)}
            {bookingDetails?.verpflegung && bookingDetails.verpflegung !== "ohne" ? ` mit ${formatVerpflegung(bookingDetails.verpflegung)}` : ""}
          </p>
          <p>
            für {numAdults} Erwachsene
            {numChildren > 0 ? `, ${numChildren} Kind(er)` : ""}
            {numInfants > 0 ? ` und ${numInfants} Kleinkind(er)` : ""}
            {bookingDetails?.alterKinder && numChildren > 0 ? ` (Alter: ${bookingDetails.alterKinder})` : ""}
          </p>
          <p>
            vom <span className="font-semibold">{bookingDetails?.checkInDate ? format(new Date(bookingDetails.checkInDate), "dd.MM.yyyy", { locale: de }) : 'N/A'}</span>
            bis <span className="font-semibold">{bookingDetails?.checkOutDate ? format(new Date(bookingDetails.checkOutDate), "dd.MM.yyyy", { locale: de }) : 'N/A'}</span>
          </p>
          <p>
            zum Preis von <span className="font-semibold">{bookingDetails?.price ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(bookingDetails.price) : 'N/A'}</span>
          </p>
          <p className="pt-2">ist fast abgeschlossen. Bitte füllen Sie die folgenden Schritte aus:</p>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <ActiveStepContent bookingToken={bookingToken} bookingDetails={bookingDetails} formState={formState} />
          {formState.message && !formState.success && Object.keys(formState.errors || {}).length === 0 && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center">
              <AlertCircle className="h-4 w-4 mr-2"/> {formState.message}
            </div>
          )}
        </form>
      </CardContent>
      {currentStep > 0 && currentStep < steps.length && !(formState.success && currentStep === steps.length - 1) && (
         <CardFooter className="border-t pt-6">
            <Button variant="outline" onClick={() => setCurrentStep(prev => prev -1)} className="mr-auto">
                Zurück
            </Button>
         </CardFooter>
      )}
    </Card>
  );
}
