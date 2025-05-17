"use client";

import { useState, useEffect, type ReactNode, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle, FileUp, Loader2, UserCircle, MessageSquare } from "lucide-react";
import { submitGuestPersonalDataAction, submitGuestDocumentsAction, submitGuestSpecialRequestsAction } from "@/lib/actions";
import type { Booking } from "@/lib/definitions";

interface Step {
  id: string;
  name: string;
  icon: React.ElementType;
  fields?: string[]; // For form validation feedback if needed
  Content: React.FC<StepContentProps>;
  action?: (bookingToken: string, prevState: any, formData: FormData) => Promise<any>;
}

interface StepContentProps {
  bookingToken: string;
  bookingDetails?: Booking | null; // Pass booking details if needed for context
  formState: FormState;
  onNext?: () => void; // For client-side only navigation if action is not per step
}

type FormState = {
  message?: string | null;
  errors?: Record<string, string[] | undefined> | null;
  success?: boolean;
};

const initialFormState: FormState = { message: null, errors: null, success: false };

// Step 1: Personal Data
const PersonalDataStep: React.FC<StepContentProps> = ({ bookingToken, formState }) => {
  const { pending } = useFormStatus();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="fullName">Vollständiger Name</Label>
          <Input id="fullName" name="fullName" required />
          {formState.errors?.fullName && <p className="text-xs text-destructive mt-1">{formState.errors.fullName[0]}</p>}
        </div>
        <div>
          <Label htmlFor="email">E-Mail</Label>
          <Input id="email" name="email" type="email" required />
          {formState.errors?.email && <p className="text-xs text-destructive mt-1">{formState.errors.email[0]}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="phone">Telefonnummer</Label>
        <Input id="phone" name="phone" required />
        {formState.errors?.phone && <p className="text-xs text-destructive mt-1">{formState.errors.phone[0]}</p>}
      </div>
      <div>
        <Label htmlFor="addressLine1">Adresse Zeile 1</Label>
        <Input id="addressLine1" name="addressLine1" required />
        {formState.errors?.addressLine1 && <p className="text-xs text-destructive mt-1">{formState.errors.addressLine1[0]}</p>}
      </div>
      <div>
        <Label htmlFor="addressLine2">Adresse Zeile 2 (Optional)</Label>
        <Input id="addressLine2" name="addressLine2" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="city">Stadt</Label>
          <Input id="city" name="city" required />
          {formState.errors?.city && <p className="text-xs text-destructive mt-1">{formState.errors.city[0]}</p>}
        </div>
        <div>
          <Label htmlFor="postalCode">Postleitzahl</Label>
          <Input id="postalCode" name="postalCode" required />
          {formState.errors?.postalCode && <p className="text-xs text-destructive mt-1">{formState.errors.postalCode[0]}</p>}
        </div>
        <div>
          <Label htmlFor="country">Land</Label>
          <Input id="country" name="country" required />
          {formState.errors?.country && <p className="text-xs text-destructive mt-1">{formState.errors.country[0]}</p>}
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
      {formState.errors?.documents && <p className="text-xs text-destructive mt-1">{formState.errors.documents[0]}</p>}
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
      {formState.errors?.specialRequests && <p className="text-xs text-destructive mt-1">{formState.errors.specialRequests[0]}</p>}
      <Button type="submit" className="w-full md:w-auto" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Buchung abschließen
      </Button>
    </div>
  );
};


const steps: Step[] = [
  { id: "personal-data", name: "Persönliche Daten", icon: UserCircle, Content: PersonalDataStep, action: submitGuestPersonalDataAction },
  { id: "documents", name: "Dokumente", icon: FileUp, Content: DocumentUploadStep, action: submitGuestDocumentsAction },
  { id: "special-requests", name: "Sonderwünsche", icon: MessageSquare, Content: SpecialRequestsStep, action: submitGuestSpecialRequestsAction },
];


export function GuestBookingFormStepper({ bookingToken, bookingDetails }: { bookingToken: string, bookingDetails?: Booking | null }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formState, formAction] = useActionState(
    (prevState: FormState, formData: FormData) => {
      const currentAction = steps[currentStep].action;
      if (currentAction) {
        // Bind the bookingToken to the action
        const boundAction = currentAction.bind(null, bookingToken);
        return boundAction(prevState, formData);
      }
      return Promise.resolve({ message: "Aktion nicht definiert", errors: null, success: false });
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
    } else if (formState.success && currentStep === steps.length - 1) {
      // Final step success actions (e.g., show completion message)
      // This is handled by the ThankYouCard now
    }
  }, [formState, toast, currentStep]);

  const ActiveStepContent = steps[currentStep].Content;

  if (formState.success && currentStep === steps.length - 1) {
    return (
      <Card className="w-full max-w-2xl mx-auto shadow-xl">
        <CardHeader className="items-center text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
          <CardTitle className="text-2xl">Buchung erfolgreich abgeschlossen!</CardTitle>
          <CardDescription>
            Vielen Dank! Ihre Daten wurden erfolgreich übermittelt. Das Hotel wird sich bei Bedarf mit Ihnen in Verbindung setzen.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p>Ihre Buchungsreferenz: <strong>{bookingToken}</strong></p>
          <p className="mt-2 text-muted-foreground">Sie können diese Seite nun schließen.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-xl">
      <CardHeader>
        <div className="mb-4">
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
        <CardTitle>Buchungsdaten vervollständigen</CardTitle>
        <CardDescription>
          Hallo {bookingDetails?.guestFirstName || 'Gast'}, bitte füllen Sie die folgenden Schritte aus, um Ihre Buchung abzuschließen.
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
