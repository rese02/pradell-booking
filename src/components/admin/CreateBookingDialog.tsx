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
import { createBookingAction } from "@/lib/actions";
import type { CreateBookingFormData } from "@/lib/definitions";
import { CalendarIcon, Loader2, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";


const initialState = {
  message: "",
  errors: {},
  bookingToken: null,
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      Buchung erstellen
    </Button>
  );
}

export function CreateBookingDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createBookingAction, initialState);
  const { toast } = useToast();

  const [checkInDate, setCheckInDate] = useState<Date | undefined>(undefined);
  const [checkOutDate, setCheckOutDate] = useState<Date | undefined>(undefined);

  useEffect(() => {
    if (state.message && !state.errors?.guestFirstName && !state.errors?.guestLastName && !state.errors?.price && !state.errors?.roomIdentifier) { // Check if there are no field errors
      if (state.bookingToken) {
        toast({
          title: "Buchung erfolgreich erstellt!",
          description: (
            <div>
              <p>{state.message}</p>
              <p>
                Link für Gast: <br/>
                <Link href={`/buchung/${state.bookingToken}`} target="_blank" className="underline text-blue-500">
                  {`/buchung/${state.bookingToken}`}
                </Link>
              </p>
            </div>
          ),
          duration: 10000, // Keep toast longer for link
        });
        setOpen(false); // Close dialog on success
        // Reset form fields if needed, though Dialog unmount might handle it
        // For controlled components, you might need to manually reset here.
        setCheckInDate(undefined);
        setCheckOutDate(undefined);
      } else if (state.message && Object.keys(state.errors ?? {}).length === 0 ) { // General success message without token (should ideally not happen if token is always generated on success)
         toast({
          title: "Erfolg",
          description: state.message,
        });
      }
    } else if (state.message && (state.errors?.guestFirstName || state.errors?.guestLastName || state.errors?.price || state.errors?.roomIdentifier)) {
      toast({
        variant: "destructive",
        title: "Fehler beim Erstellen der Buchung",
        description: state.message || "Bitte überprüfen Sie die Eingabefelder.",
      });
    }
  }, [state, toast]);


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" /> Buchung erstellen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Neue Buchung erstellen</DialogTitle>
          <DialogDescription>
            Füllen Sie die Details aus, um eine neue Buchung manuell anzulegen.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="guestFirstName" className="text-right">
                Vorname
              </Label>
              <div className="col-span-3">
                <Input id="guestFirstName" name="guestFirstName" className="w-full" />
                {state.errors?.guestFirstName && <p className="text-xs text-destructive mt-1">{state.errors.guestFirstName[0]}</p>}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="guestLastName" className="text-right">
                Nachname
              </Label>
              <div className="col-span-3">
                <Input id="guestLastName" name="guestLastName" className="w-full" />
                 {state.errors?.guestLastName && <p className="text-xs text-destructive mt-1">{state.errors.guestLastName[0]}</p>}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="price" className="text-right">
                Preis (€)
              </Label>
              <div className="col-span-3">
                <Input id="price" name="price" type="number" step="0.01" className="w-full" />
                {state.errors?.price && <p className="text-xs text-destructive mt-1">{state.errors.price[0]}</p>}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="roomIdentifier" className="text-right">
                Zimmer
              </Label>
              <div className="col-span-3">
                <Input id="roomIdentifier" name="roomIdentifier" placeholder="z.B. Raum 101, Suite" className="w-full" />
                {state.errors?.roomIdentifier && <p className="text-xs text-destructive mt-1">{state.errors.roomIdentifier[0]}</p>}
              </div>
            </div>
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="checkInDate" className="text-right">
                Anreise
              </Label>
              <div className="col-span-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !checkInDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {checkInDate ? format(checkInDate, "PPP") : <span>Datum auswählen</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={checkInDate}
                      onSelect={setCheckInDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Input type="hidden" name="checkInDate" value={checkInDate ? format(checkInDate, "yyyy-MM-dd") : ""} />
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="checkOutDate" className="text-right">
                Abreise
              </Label>
               <div className="col-span-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !checkOutDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {checkOutDate ? format(checkOutDate, "PPP") : <span>Datum auswählen</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={checkOutDate}
                      onSelect={setCheckOutDate}
                      disabled={(date) =>
                        checkInDate ? date <= checkInDate : false
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Input type="hidden" name="checkOutDate" value={checkOutDate ? format(checkOutDate, "yyyy-MM-dd") : ""} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Abbrechen</Button>
            </DialogClose>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
