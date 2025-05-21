
"use client";

import { useState, useEffect, useActionState } from "react"; 
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTrigger,
  DialogDescription, // Added for more context
  DialogFooter      // Added for standard dialog structure
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBookingAction } from "@/lib/actions";
import type { RoomDetail } from "@/lib/definitions";
import { CalendarIcon as CalendarLucideIcon, Loader2, PlusCircle, User, Bed, Euro, Home, MessageSquare, Users, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { de } from 'date-fns/locale';
import type { FormState } from "@/lib/actions"; 
import { ScrollArea } from "@/components/ui/scroll-area";


const initialState: FormState = {
  message: null,
  errors: null,
  bookingToken: null,
  success: false,
  actionToken: undefined,
  updatedGuestData: null, 
};

interface RoomFormData extends Omit<RoomDetail, 'erwachsene' | 'kinder' | 'kleinkinder'> {
  id: string; 
  erwachsene: string;
  kinder?: string;
  kleinkinder?: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-shadow">
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
      Buchung erstellen
    </Button>
  );
}

export function CreateBookingDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createBookingAction, initialState);
  const { toast } = useToast();
  const [formKey, setFormKey] = useState(Date.now()); 

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
    setRooms([{...initialRoom, id: Date.now().toString()}]);
    setDateRange(undefined);
    const formElement = document.getElementById("create-booking-form") as HTMLFormElement;
    if (formElement) {
        formElement.reset();
    }
    setFormKey(Date.now()); 
  };

  useEffect(() => {
    if (!open) { 
        resetFormFields();
    }
  }, [open]);

  useEffect(() => {
    if (state.actionToken) { 
      if (state.success && state.bookingToken) {
        toast({
          title: "Buchung erfolgreich erstellt!",
          description: (
            <div>
              <p>{state.message?.replace(` Token: ${state.bookingToken}`, '')}</p>
              <p className="mt-2">
                Link für Gast: <br/>
                <Link href={`/buchung/${state.bookingToken}`} target="_blank" className="underline text-primary hover:text-primary/80 break-all">
                  {typeof window !== "undefined" ? `${window.location.origin}/buchung/${state.bookingToken}` : `/buchung/${state.bookingToken}`}
                </Link>
              </p>
            </div>
          ),
          duration: 10000,
        });
        setOpen(false); 
        resetFormFields(); 
      } else if (state.message) { 
        let errorMessage = state.message;
        if (state.errors && Object.keys(state.errors).length > 0) {
            const fieldErrorsString = Object.entries(state.errors)
                .map(([key, value]) => {
                    const messages = Array.isArray(value) ? value.join(', ') : String(value);
                    let friendlyKey = key;
                    if (key === 'guestFirstName') friendlyKey = 'Vorname';
                    else if (key === 'guestLastName') friendlyKey = 'Nachname';
                    else if (key === 'price') friendlyKey = 'Preis';
                    else if (key === 'checkInDate') friendlyKey = 'Anreisedatum';
                    else if (key === 'checkOutDate') friendlyKey = 'Abreisedatum';
                    else if (key === 'roomsData') friendlyKey = 'Zimmerdetails';
                    else if (key === 'dateRange') friendlyKey = 'Datumsbereich';
                    else if (key === 'global') friendlyKey = 'Allgemein';
                    return messages ? `${friendlyKey}: ${messages}` : '';
                })
                .filter(Boolean)
                .join('. \n');
            if (fieldErrorsString) {
              errorMessage += `\nFehlerdetails: ${fieldErrorsString}`;
            }
        }
        toast({
          variant: "destructive",
          title: state.success === false ? "Fehler beim Erstellen der Buchung" : "Hinweis",
          description: <div className="whitespace-pre-wrap">{errorMessage}</div>,
          duration: 8000,
        });
      }
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
        <Button className="shadow-md hover:shadow-lg transition-shadow">
          <PlusCircle className="mr-2 h-4 w-4" /> Buchung erstellen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl md:max-w-3xl rounded-lg">
        <DialogHeader className="pb-4 border-b">
          <DialogTitle className="text-2xl font-semibold">Neue Buchung erstellen</DialogTitle>
          <DialogDescription>Füllen Sie die Details unten aus, um eine neue Buchung anzulegen.</DialogDescription>
        </DialogHeader>
        <form action={formAction} key={formKey} id="create-booking-form">
          <ScrollArea className="max-h-[calc(80vh-150px)] py-6 pr-3"> {/* Adjusted max-h and py */}
            <div className="grid gap-6">
              <div className="grid md:grid-cols-3 gap-4 items-start">
                <div>
                  <Label htmlFor="guestFirstName" className="flex items-center mb-1.5 text-sm font-medium">
                    <User className="mr-2 h-4 w-4 text-muted-foreground" /> Vorname*
                  </Label>
                  <Input id="guestFirstName" name="guestFirstName" className="input-modern"/>
                  {state.errors?.guestFirstName && <p className="text-xs text-destructive mt-1">{Array.isArray(state.errors.guestFirstName) ? state.errors.guestFirstName.join(', ') : state.errors.guestFirstName}</p>}
                </div>
                <div>
                  <Label htmlFor="guestLastName" className="flex items-center mb-1.5 text-sm font-medium">
                    <User className="mr-2 h-4 w-4 text-muted-foreground" /> Nachname*
                  </Label>
                  <Input id="guestLastName" name="guestLastName" className="input-modern"/>
                  {state.errors?.guestLastName && <p className="text-xs text-destructive mt-1">{Array.isArray(state.errors.guestLastName) ? state.errors.guestLastName.join(', ') : state.errors.guestLastName}</p>}
                </div>
                <div>
                  <Label htmlFor="dateRange" className="flex items-center mb-1.5 text-sm font-medium">
                      <CalendarLucideIcon className="mr-2 h-4 w-4 text-muted-foreground" /> Zeitraum*
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="dateRange"
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal input-modern hover:bg-accent",
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
                        disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                      />
                    </PopoverContent>
                  </Popover>
                  <Input type="hidden" name="checkInDate" value={dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : ""} />
                  <Input type="hidden" name="checkOutDate" value={dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : ""} />
                  {(state.errors?.checkInDate || state.errors?.checkOutDate) && <p className="text-xs text-destructive mt-1">An- und Abreisedatum sind erforderlich.</p>}
                  {state.errors?.dateRange && <p className="text-xs text-destructive mt-1">{Array.isArray(state.errors.dateRange) ? state.errors.dateRange.join(', ') : state.errors.dateRange}</p>}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 items-start">
                <div>
                  <Label htmlFor="verpflegung" className="flex items-center mb-1.5 text-sm font-medium">
                    <Bed className="mr-2 h-4 w-4 text-muted-foreground" /> Verpflegung*
                  </Label>
                  <Select name="verpflegung" defaultValue="ohne">
                    <SelectTrigger id="verpflegung" className="input-modern hover:bg-accent">
                      <SelectValue placeholder="Verpflegung auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ohne">Ohne Verpflegung</SelectItem>
                      <SelectItem value="fruehstueck">Frühstück</SelectItem>
                      <SelectItem value="halbpension">Halbpension</SelectItem>
                      <SelectItem value="vollpension">Vollpension</SelectItem>
                    </SelectContent>
                  </Select>
                  {state.errors?.verpflegung && <p className="text-xs text-destructive mt-1">{Array.isArray(state.errors.verpflegung) ? state.errors.verpflegung.join(', ') : state.errors.verpflegung}</p>}
                </div>
                <div>
                  <Label htmlFor="price" className="flex items-center mb-1.5 text-sm font-medium">
                    <Euro className="mr-2 h-4 w-4 text-muted-foreground" /> Gesamtpreis (€)*
                  </Label>
                  <Input id="price" name="price" type="number" step="0.01" placeholder="Preis eingeben" className="input-modern"/>
                  <p className="text-xs text-muted-foreground mt-1">Gesamtpreis für alle Zimmer in Euro.</p>
                  {state.errors?.price && <p className="text-xs text-destructive mt-1">{Array.isArray(state.errors.price) ? state.errors.price.join(', ') : state.errors.price}</p>}
                </div>
              </div>

              {state.errors?.roomsData && (
                  <div className="col-span-full p-3 bg-destructive/10 border border-destructive/30 rounded-lg shadow-sm">
                      <p className="text-sm text-destructive font-medium">Fehler bei Zimmerdetails:</p>
                      <ul className="list-disc list-inside text-xs text-destructive/90 mt-1">
                          {(Array.isArray(state.errors.roomsData) ? state.errors.roomsData : [String(state.errors.roomsData)]).map((err, i) => (
                              <li key={i}>{String(err)}</li>
                          ))}
                      </ul>
                  </div>
              )}


              {rooms.map((room, index) => (
                <div key={room.id} className="space-y-4 pt-6 border-t border-border/50 first:border-t-0 first:pt-0">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold flex items-center text-foreground">
                      <Home className="mr-2 h-5 w-5 text-muted-foreground" /> Zimmer {index + 1} Details
                    </h3>
                    {rooms.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveRoom(room.id)} type="button" className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 rounded-full h-8 w-8">
                        <Trash2 className="h-4 w-4" /> <span className="sr-only">Zimmer entfernen</span>
                      </Button>
                    )}
                  </div>
                  <div className="grid md:grid-cols-4 gap-4 items-start">
                    <div>
                      <Label htmlFor={`zimmertyp-${room.id}`} className="mb-1.5 block text-sm font-medium">Zimmertyp*</Label>
                      <Select value={room.zimmertyp} onValueChange={(value) => handleRoomChange(room.id, 'zimmertyp', value)}>
                        <SelectTrigger id={`zimmertyp-${room.id}`} className="input-modern hover:bg-accent">
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
                      <Label htmlFor={`erwachsene-${room.id}`} className="mb-1.5 block text-sm font-medium">Erwachsene*</Label>
                      <Input id={`erwachsene-${room.id}`} value={room.erwachsene} onChange={(e) => handleRoomChange(room.id, 'erwachsene', e.target.value)} type="number" min="0" className="input-modern"/>
                    </div>
                    <div>
                      <Label htmlFor={`kinder-${room.id}`} className="mb-1.5 block text-sm font-medium">Kinder (3+)</Label>
                      <Input id={`kinder-${room.id}`} value={room.kinder} onChange={(e) => handleRoomChange(room.id, 'kinder', e.target.value)} type="number" min="0" className="input-modern"/>
                    </div>
                    <div>
                      <Label htmlFor={`kleinkinder-${room.id}`} className="mb-1.5 block text-sm font-medium">Kleinkinder</Label>
                      <Input id={`kleinkinder-${room.id}`} value={room.kleinkinder} onChange={(e) => handleRoomChange(room.id, 'kleinkinder', e.target.value)} type="number" min="0" className="input-modern"/>
                      <p className="text-xs text-muted-foreground mt-1">(0-2 J.)</p>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`alterKinder-${room.id}`} className="mb-1.5 block text-sm font-medium">Alter Kinder (3+)</Label>
                    <Input id={`alterKinder-${room.id}`} value={room.alterKinder} onChange={(e) => handleRoomChange(room.id, 'alterKinder', e.target.value)} placeholder="z.B. 4, 8" className="input-modern"/>
                    <p className="text-xs text-muted-foreground mt-1">Kommagetrennt, falls zutreffend.</p>
                  </div>
                </div>
              ))}
              <Button variant="outline" type="button" onClick={handleAddRoom} className="w-full sm:w-auto mt-4 hover:bg-primary/5 hover:text-primary border-primary/30 transition-all duration-200 shadow-sm">
                  <Plus className="mr-2 h-4 w-4" /> Weiteres Zimmer hinzufügen
              </Button>


              <div className="space-y-2 pt-6 border-t border-border/50">
                <Label htmlFor="interneBemerkungen" className="flex items-center text-sm font-medium">
                  <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" /> Interne Bemerkungen (Optional)
                  </Label>
                <Textarea id="interneBemerkungen" name="interneBemerkungen" placeholder="Fügen Sie hier interne Notizen zur Buchung hinzu..." rows={3} className="input-modern"/>
                {state.errors?.interneBemerkungen && <p className="text-xs text-destructive mt-1">{Array.isArray(state.errors.interneBemerkungen) ? state.errors.interneBemerkungen.join(', ') : state.errors.interneBemerkungen}</p>}
              </div>
            </div>
          </ScrollArea>
           <input type="hidden" name="roomsData" value={JSON.stringify(rooms.map(({id, ...rest}) => ({ 
            ...rest,
            erwachsene: parseInt(rest.erwachsene, 10) || 0, 
            kinder: parseInt(rest.kinder || "0", 10) || 0,
            kleinkinder: parseInt(rest.kleinkinder || "0", 10) || 0,
          })))} />

          <DialogFooter className="mt-8 pt-6 border-t"> 
            <DialogClose asChild>
              <Button variant="outline" type="button" className="hover:bg-muted transition-colors shadow-sm">Abbrechen</Button>
            </DialogClose>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
    
