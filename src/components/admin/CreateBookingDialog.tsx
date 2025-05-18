
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
import type { RoomDetail } from "@/lib/definitions";
import { CalendarIcon as CalendarLucideIcon, Loader2, PlusCircle, User, Bed, Euro, Home, MessageSquare, Users, SmilePlus, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { de } from 'date-fns/locale';
import type { FormState } from "@/lib/actions"; // Import FormState type
import { Separator } from "@/components/ui/separator";


const initialState: FormState = {
  message: "",
  errors: {},
  bookingToken: null,
  success: false,
  actionToken: undefined,
};

interface RoomFormData extends Omit<RoomDetail, 'erwachsene' | 'kinder' | 'kleinkinder'> {
  id: string; // For unique key in map
  erwachsene: string;
  kinder?: string;
  kleinkinder?: string;
}

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
  const [formKey, setFormKey] = useState(Date.now()); // To reset form on close/success

  const initialRoom: RoomFormData = {
    id: Date.now().toString(),
    zimmertyp: 'standard',
    erwachsene: '1',
    kinder: '0',
    kleinkinder: '0',
    alterKinder: ''
  };
  const [rooms, setRooms] = useState<RoomFormData[]>([initialRoom]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const resetFormFields = () => {
    setRooms([initialRoom]);
    setDateRange(undefined);
    setFormKey(Date.now()); // Change key to force form re-render and reset internal state
  };

  useEffect(() => {
    if (!open) { // Reset when dialog closes
        resetFormFields();
        // Reset action state by re-initializing formKey if necessary, or ensure it resets when formAction changes for useActionState
    }
  }, [open]);

  useEffect(() => {
    if (state.success && state.bookingToken) {
      toast({
        title: "Buchung erfolgreich erstellt!",
        description: (
          <div>
            <p>{state.message?.replace(` Token: ${state.bookingToken}`, '')}</p>
            <p>
              Link für Gast: <br/>
              <Link href={`/buchung/${state.bookingToken}`} target="_blank" className="underline text-primary hover:text-primary/80">
                {typeof window !== "undefined" ? `${window.location.origin}/buchung/${state.bookingToken}` : `/buchung/${state.bookingToken}`}
              </Link>
            </p>
          </div>
        ),
        duration: 10000,
      });
      setOpen(false);
      resetFormFields();
    } else if (state.message && state.errors && Object.keys(state.errors).length > 0) {
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
    } else if (state.message && !state.success && Object.keys(state.errors || {}).length === 0 && !state.bookingToken) {
       // Generic error from server action not related to validation
       toast({
        variant: "destructive",
        title: "Fehler",
        description: state.message,
      });
    }
  }, [state, toast]);

  const handleAddRoom = () => {
    setRooms([...rooms, { ...initialRoom, id: Date.now().toString() }]);
  };

  const handleRemoveRoom = (idToRemove: string) => {
    if (rooms.length > 1) {
      setRooms(rooms.filter(room => room.id !== idToRemove));
    }
  };

  const handleRoomChange = (id: string, field: keyof Omit<RoomFormData, 'id'>, value: string) => {
    setRooms(rooms.map(room => room.id === id ? { ...room, [field]: value } : room));
  };


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" /> Buchung erstellen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Neue Buchung erstellen</DialogTitle>
        </DialogHeader>
        <form action={formAction} key={formKey}>
          <input type="hidden" name="roomsData" value={JSON.stringify(rooms.map(({id, ...rest}) => ({
            ...rest,
            erwachsene: parseInt(rest.erwachsene, 10) || 0,
            kinder: parseInt(rest.kinder || "0", 10) || 0,
            kleinkinder: parseInt(rest.kleinkinder || "0", 10) || 0,
          })))} />
          <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto pr-2">
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
                    <CalendarLucideIcon className="mr-2 h-4 w-4 text-muted-foreground" /> Zeitraum
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
                            {format(dateRange.from, "dd.MM.yy", { locale: de })} - {format(dateRange.to, "dd.MM.yy", { locale: de })}
                          </>
                        ) : (
                          format(dateRange.from, "dd.MM.yy", { locale: de })
                        )
                      ) : (
                        <span>An- & Abreise wählen</span>
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
                      numberOfMonths={1}
                      locale={de}
                    />
                  </PopoverContent>
                </Popover>
                <Input type="hidden" name="checkInDate" value={dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : ""} />
                <Input type="hidden" name="checkOutDate" value={dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : ""} />
                {(state.errors?.checkInDate || state.errors?.checkOutDate) && <p className="text-xs text-destructive mt-1">An- und Abreisedatum sind erforderlich.</p>}
                 {state.errors?.dateRange && <p className="text-xs text-destructive mt-1">{state.errors.dateRange[0]}</p>}
              </div>
            </div>

            {/* Row 2: Verpflegung, Gesamtpreis */}
            <div className="grid md:grid-cols-2 gap-4 items-start">
              <div>
                <Label htmlFor="verpflegung" className="flex items-center mb-1">
                  <Bed className="mr-2 h-4 w-4 text-muted-foreground" /> Verpflegung
                </Label>
                <Select name="verpflegung" defaultValue="ohne">
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

            {state.errors?.roomsData && <p className="text-sm text-destructive mt-2 mb-2 px-1">{Array.isArray(state.errors.roomsData) ? state.errors.roomsData.join(', ') : String(state.errors.roomsData)}</p>}


            {/* Zimmerdetails Section */}
            {rooms.map((room, index) => (
              <div key={room.id} className="space-y-4 pt-4 border-t first:border-t-0">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold flex items-center">
                    <Home className="mr-2 h-5 w-5 text-muted-foreground" /> Zimmer {index + 1} Details
                  </h3>
                  {rooms.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => handleRemoveRoom(room.id)} type="button" className="text-destructive hover:text-destructive/80">
                      <Trash2 className="mr-1 h-4 w-4" /> Zimmer entfernen
                    </Button>
                  )}
                </div>
                <div className="grid md:grid-cols-4 gap-4 items-start">
                  <div>
                    <Label htmlFor={`zimmertyp-${room.id}`} className="mb-1 block">Zimmertyp</Label>
                    <Select value={room.zimmertyp} onValueChange={(value) => handleRoomChange(room.id, 'zimmertyp', value)}>
                      <SelectTrigger id={`zimmertyp-${room.id}`}>
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
                  </div>
                  <div>
                    <Label htmlFor={`erwachsene-${room.id}`} className="mb-1 block">Erwachsene</Label>
                    <Input id={`erwachsene-${room.id}`} value={room.erwachsene} onChange={(e) => handleRoomChange(room.id, 'erwachsene', e.target.value)} type="number" min="0"/>
                  </div>
                  <div>
                    <Label htmlFor={`kinder-${room.id}`} className="mb-1 block">Kinder (3+)</Label>
                    <Input id={`kinder-${room.id}`} value={room.kinder} onChange={(e) => handleRoomChange(room.id, 'kinder', e.target.value)} type="number" min="0"/>
                  </div>
                  <div>
                    <Label htmlFor={`kleinkinder-${room.id}`} className="mb-1 block">Kleinkinder</Label>
                    <Input id={`kleinkinder-${room.id}`} value={room.kleinkinder} onChange={(e) => handleRoomChange(room.id, 'kleinkinder', e.target.value)} type="number" min="0"/>
                    <p className="text-xs text-muted-foreground mt-1">(0-2 J.)</p>
                  </div>
                </div>
                <div>
                  <Label htmlFor={`alterKinder-${room.id}`} className="mb-1 block">Alter Kinder (3+)</Label>
                  <Input id={`alterKinder-${room.id}`} value={room.alterKinder} onChange={(e) => handleRoomChange(room.id, 'alterKinder', e.target.value)} placeholder="z.B. 4, 8" />
                  <p className="text-xs text-muted-foreground mt-1">Kommagetrennt, falls zutreffend.</p>
                </div>
              </div>
            ))}
             <Button variant="outline" type="button" onClick={handleAddRoom} className="w-full sm:w-auto mt-4">
                <Plus className="mr-2 h-4 w-4" /> Weiteres Zimmer hinzufügen
            </Button>


            {/* Interne Bemerkungen Section */}
            <div className="space-y-2 pt-4 border-t">
               <Label htmlFor="interneBemerkungen" className="flex items-center">
                 <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" /> Interne Bemerkungen (Optional)
                </Label>
              <Textarea id="interneBemerkungen" name="interneBemerkungen" placeholder="Fügen Sie hier interne Notizen zur Buchung hinzu..." rows={3}/>
              {state.errors?.interneBemerkungen && <p className="text-xs text-destructive mt-1">{state.errors.interneBemerkungen[0]}</p>}
            </div>
          </div>

          <DialogFooter className="mt-6 pt-4 border-t">
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
