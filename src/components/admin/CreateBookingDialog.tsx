
"use client";

import { useState, useEffect, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBookingAction } from "@/lib/actions";
import type { CreateBookingFormData } from "@/lib/definitions"; // Will be updated
import { CalendarIcon as CalendarLucideIcon, Loader2, PlusCircle, User, Bed, Euro, Home, MessageSquare, Users, SmilePlus, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { de } from 'date-fns/locale';


const initialState = {
  message: "",
  errors: {},
  bookingToken: null,
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
      Buchung erstellen
    </Button>
  );
}

export function CreateBookingDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createBookingAction, initialState);
  const { toast } = useToast();

  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  useEffect(() => {
    if (state.message && !state.errors) { 
      if (state.bookingToken) {
        toast({
          title: "Buchung erfolgreich erstellt!",
          description: (
            <div>
              <p>{state.message?.replace(` Token: ${state.bookingToken}`, '')}</p>
              <p>
                Link für Gast: <br/>
                <Link href={`/buchung/${state.bookingToken}`} target="_blank" className="underline text-blue-500">
                  {`${window.location.origin}/buchung/${state.bookingToken}`}
                </Link>
              </p>
            </div>
          ),
          duration: 10000, 
        });
        setOpen(false); 
        setDateRange(undefined); // Reset date range
        // Consider resetting other form fields if the dialog doesn't unmount/remount cleanly
      } else if (state.message && Object.keys(state.errors ?? {}).length === 0 ) { 
         toast({
          title: "Erfolg",
          description: state.message,
        });
      }
    } else if (state.message && state.errors && Object.keys(state.errors).length > 0) {
      // Construct a more detailed error message
      let errorMessage = state.message || "Bitte überprüfen Sie die Eingabefelder.";
      const fieldErrors = Object.values(state.errors).flat().join(" ");
      if (fieldErrors) {
        errorMessage += ` Fehler: ${fieldErrors}`;
      }
      toast({
        variant: "destructive",
        title: "Fehler beim Erstellen der Buchung",
        description: errorMessage,
      });
    }
  }, [state, toast]);


  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) {
        setDateRange(undefined); // Reset date range when dialog closes
      }
    }}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" /> Buchung erstellen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Neue Buchung erstellen</DialogTitle>
        </DialogHeader>
        <form action={formAction}>
          <div className="grid gap-6 py-4">
            {/* Row 1: Vorname, Nachname, Zeitraum */}
            <div className="grid md:grid-cols-3 gap-4 items-start">
              <div>
                <Label htmlFor="guestFirstName" className="flex items-center mb-1">
                  <User className="mr-2 h-4 w-4 text-muted-foreground" /> Vorname
                </Label>
                <Input id="guestFirstName" name="guestFirstName" />
                {state.errors?.guestFirstName && <p className="text-xs text-destructive mt-1">{state.errors.guestFirstName[0]}</p>}
              </div>
              <div>
                <Label htmlFor="guestLastName" className="flex items-center mb-1">
                  <User className="mr-2 h-4 w-4 text-muted-foreground" /> Nachname
                </Label>
                <Input id="guestLastName" name="guestLastName" />
                 {state.errors?.guestLastName && <p className="text-xs text-destructive mt-1">{state.errors.guestLastName[0]}</p>}
              </div>
              <div>
                <Label htmlFor="dateRange" className="flex items-center mb-1">
                    <CalendarLucideIcon className="mr-2 h-4 w-4 text-muted-foreground" /> Zeitraum (Anreise - Abreise)
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="dateRange"
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                      )}
                    >
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "dd.MM.yyyy", { locale: de })} - {format(dateRange.to, "dd.MM.yyyy", { locale: de })}
                          </>
                        ) : (
                          format(dateRange.from, "dd.MM.yyyy", { locale: de })
                        )
                      ) : (
                        <span>Wählen Sie An- und Abreisedatum</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={1} // Changed to 1 to better fit smaller screens, 2 is also fine
                      locale={de}
                    />
                  </PopoverContent>
                </Popover>
                <Input type="hidden" name="checkInDate" value={dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : ""} />
                <Input type="hidden" name="checkOutDate" value={dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : ""} />
                {(state.errors?.checkInDate || state.errors?.checkOutDate) && <p className="text-xs text-destructive mt-1">An- und Abreisedatum sind erforderlich.</p>}
              </div>
            </div>

            {/* Row 2: Verpflegung, Gesamtpreis */}
            <div className="grid md:grid-cols-2 gap-4 items-start">
              <div>
                <Label htmlFor="verpflegung" className="flex items-center mb-1">
                  <Bed className="mr-2 h-4 w-4 text-muted-foreground" /> Verpflegung
                </Label>
                <Select name="verpflegung">
                  <SelectTrigger id="verpflegung">
                    <SelectValue placeholder="Verpflegung auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ohne">Ohne Verpflegung</SelectItem>
                    <SelectItem value="fruehstueck">Frühstück</SelectItem>
                    <SelectItem value="halbpension">Halbpension</SelectItem>
                    <SelectItem value="vollpension">Vollpension</SelectItem>
                  </SelectContent>
                </Select>
                {state.errors?.verpflegung && <p className="text-xs text-destructive mt-1">{state.errors.verpflegung[0]}</p>}
              </div>
              <div>
                <Label htmlFor="price" className="flex items-center mb-1">
                  <Euro className="mr-2 h-4 w-4 text-muted-foreground" /> Gesamtpreis (€)
                </Label>
                <Input id="price" name="price" type="number" step="0.01" placeholder="Preis eingeben"/>
                <p className="text-xs text-muted-foreground mt-1">Gesamtpreis für alle Zimmer in Euro.</p>
                {state.errors?.price && <p className="text-xs text-destructive mt-1">{state.errors.price[0]}</p>}
              </div>
            </div>

            {/* Haupt-Zimmerdetails Section */}
            <div className="space-y-4 pt-4 border-t">
              <h3 className="text-lg font-semibold flex items-center">
                <Home className="mr-2 h-5 w-5 text-muted-foreground" /> Haupt-Zimmerdetails
              </h3>
              <div className="grid md:grid-cols-4 gap-4 items-start">
                <div>
                  <Label htmlFor="zimmertyp" className="mb-1 block">Zimmertyp</Label>
                  <Select name="zimmertyp">
                    <SelectTrigger id="zimmertyp">
                      <SelectValue placeholder="Standard" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="einzelzimmer">Einzelzimmer</SelectItem>
                      <SelectItem value="doppelzimmer">Doppelzimmer</SelectItem>
                      <SelectItem value="suite">Suite</SelectItem>
                      <SelectItem value="familienzimmer">Familienzimmer</SelectItem>
                    </SelectContent>
                  </Select>
                  {state.errors?.zimmertyp && <p className="text-xs text-destructive mt-1">{state.errors.zimmertyp[0]}</p>}
                </div>
                <div>
                  <Label htmlFor="erwachsene" className="mb-1 block">Erwachsene</Label>
                  <Input id="erwachsene" name="erwachsene" type="number" defaultValue="1" min="0"/>
                  {state.errors?.erwachsene && <p className="text-xs text-destructive mt-1">{state.errors.erwachsene[0]}</p>}
                </div>
                <div>
                  <Label htmlFor="kinder" className="mb-1 block">Kinder (3+)</Label>
                  <Input id="kinder" name="kinder" type="number" defaultValue="0" min="0"/>
                  {state.errors?.kinder && <p className="text-xs text-destructive mt-1">{state.errors.kinder[0]}</p>}
                </div>
                <div>
                  <Label htmlFor="kleinkinder" className="mb-1 block">Kleinkinder</Label>
                  <Input id="kleinkinder" name="kleinkinder" type="number" defaultValue="0" min="0"/>
                  <p className="text-xs text-muted-foreground mt-1">(0-2 J.)</p>
                  {state.errors?.kleinkinder && <p className="text-xs text-destructive mt-1">{state.errors.kleinkinder[0]}</p>}
                </div>
              </div>
              <div>
                <Label htmlFor="alterKinder" className="mb-1 block">Alter Kinder (3+)</Label>
                <Input id="alterKinder" name="alterKinder" placeholder="z.B. 4, 8" />
                <p className="text-xs text-muted-foreground mt-1">Kommagetrennt, falls zutreffend.</p>
                {state.errors?.alterKinder && <p className="text-xs text-destructive mt-1">{state.errors.alterKinder[0]}</p>}
              </div>
              <Button variant="outline" type="button" className="w-full sm:w-auto" disabled> {/* Placeholder */}
                <Plus className="mr-2 h-4 w-4" /> Weiteres Zimmer hinzufügen
              </Button>
            </div>

            {/* Interne Bemerkungen Section */}
            <div className="space-y-2 pt-4 border-t">
               <Label htmlFor="interneBemerkungen" className="flex items-center">
                 <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" /> Interne Bemerkungen (Optional)
                </Label>
              <Textarea id="interneBemerkungen" name="interneBemerkungen" placeholder="Fügen Sie hier interne Notizen zur Buchung hinzu..." rows={3}/>
              {state.errors?.interneBemerkungen && <p className="text-xs text-destructive mt-1">{state.errors.interneBemerkungen[0]}</p>}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline" type="button">Abbrechen</Button>
            </DialogClose>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

    