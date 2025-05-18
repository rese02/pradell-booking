
"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, MoreHorizontal, Search, ListFilter, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Booking } from "@/lib/definitions";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { deleteBookingsAction } from "@/lib/actions";

// Helper to format date or return placeholder
const formatDate = (dateString?: Date | string) => {
  if (!dateString) return "N/A";
  try {
    return format(new Date(dateString), "dd. MMM yyyy", { locale: de });
  } catch (error) {
    return "Ungültiges Datum";
  }
};

const getFullBookingLink = (bookingToken: string) => {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/buchung/${bookingToken}`;
  }
  // Fallback für serverseitiges Rendering oder wenn window nicht verfügbar ist
  // Dies wird nicht für den Kopiervorgang verwendet, sondern nur als Fallback.
  return `/buchung/${bookingToken}`; 
};

export const columns: ColumnDef<Booking>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Alle auswählen"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Zeile auswählen"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "guestFullName",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Gast
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => <div>{`${row.original.guestFirstName} ${row.original.guestLastName}`}</div>,
    filterFn: (row, columnId, filterValue) => {
        const guestName = `${row.original.guestFirstName} ${row.original.guestLastName}`;
        return guestName.toLowerCase().includes(filterValue.toLowerCase());
    }
  },
  {
    accessorKey: "roomIdentifier",
    header: "Zimmer",
  },
  {
    accessorKey: "price",
    header: () => <div className="text-right">Preis</div>,
    cell: ({ row }) => {
      const amount = parseFloat(String(row.getValue("price")));
      const formatted = new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(amount);
      return <div className="text-right font-medium">{formatted}</div>;
    },
  },
  {
    accessorKey: "checkInDate",
    header: "Anreise",
    cell: ({ row }) => formatDate(row.original.checkInDate),
  },
  {
    accessorKey: "checkOutDate",
    header: "Abreise",
    cell: ({ row }) => formatDate(row.original.checkOutDate),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
      if (status === "Confirmed") variant = "default"; 
      if (status === "Pending Guest Information") variant = "secondary";
      if (status === "Cancelled") variant = "destructive";

      return <Badge variant={variant} className="capitalize">{status.toLowerCase().replace(/_/g, ' ')}</Badge>;
    },
  },
  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const booking = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Menü öffnen</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Aktionen</DropdownMenuLabel>
             <DropdownMenuItem
              onClick={() => {
                if (typeof window !== "undefined") {
                  navigator.clipboard.writeText(getFullBookingLink(booking.bookingToken))
                    .then(() => alert("Buchungslink in die Zwischenablage kopiert!"))
                    .catch(err => console.error("Fehler beim Kopieren: ", err));
                }
              }}
            >
              Buchungslink kopieren
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
               <Link href={`/admin/bookings/${booking.id}`}>Details anzeigen</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>Buchung stornieren</DropdownMenuItem> {/* Placeholder */}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

interface BookingsDataTableProps {
  data: Booking[];
}

export function BookingsDataTable({ data }: BookingsDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const { toast } = useToast();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [confirmationText, setConfirmationText] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  const handleDeleteSelected = async () => {
    const selectedRows = table.getFilteredSelectedRowModel().rows;
    if (selectedRows.length === 0) {
      toast({ variant: "destructive", title: "Keine Buchungen ausgewählt" });
      return;
    }
    if (confirmationText !== "LÖSCHEN") {
      toast({ variant: "destructive", title: "Bestätigungstext falsch" });
      return;
    }

    const bookingIdsToDelete = selectedRows.map(row => row.original.id);
    
    try {
      const result = await deleteBookingsAction(bookingIdsToDelete);
      if (result.success) {
        toast({ title: "Erfolg", description: result.message });
        table.resetRowSelection(); 
      } else {
        toast({ variant: "destructive", title: "Fehler", description: result.message });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Ein unerwarteter Fehler ist aufgetreten." });
    } finally {
      setIsDeleteDialogOpen(false);
      setConfirmationText("");
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4 gap-2">
        <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
            placeholder="Buchungen suchen (z.B. Gastname)..."
            value={(table.getColumn("guestFullName")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
                table.getColumn("guestFullName")?.setFilterValue(event.target.value)
            }
            className="pl-10 max-w-sm" 
            />
        </div>
        <div className="flex items-center gap-2">
            {table.getFilteredSelectedRowModel().rows.length > 0 && (
                <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
                    setIsDeleteDialogOpen(open);
                    if (!open) setConfirmationText(""); // Reset text on close
                }}>
                    <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                        <Trash2 className="mr-2 h-4 w-4" />
                        {table.getFilteredSelectedRowModel().rows.length} Ausgewählte löschen
                    </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sind Sie absolut sicher?</AlertDialogTitle>
                        <AlertDialogDescription>
                        Diese Aktion kann nicht rückgängig gemacht werden. Dadurch werden die ausgewählten
                        Buchungen dauerhaft gelöscht.
                        Um fortzufahren, geben Sie bitte "LÖSCHEN" in das Textfeld ein.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4 space-y-2">
                        <Label htmlFor="deleteConfirm" className="text-sm font-medium">
                        Bestätigungswort eingeben:
                        </Label>
                        <Input
                        id="deleteConfirm"
                        value={confirmationText}
                        onChange={(e) => setConfirmationText(e.target.value)}
                        placeholder="LÖSCHEN"
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                        onClick={handleDeleteSelected}
                        disabled={confirmationText !== "LÖSCHEN"}
                        className={buttonVariants({ variant: "destructive" })}
                        >
                        Löschen
                        </AlertDialogAction>
                    </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            <Button variant="outline" size="sm">
                <ListFilter className="mr-2 h-4 w-4" /> Buchungen ausrichten
            </Button>
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="ml-auto"> 
                Spalten <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                    let label = column.id;
                    if (column.id === "guestFullName") label = "Gast";
                    if (column.id === "roomIdentifier") label = "Zimmer";
                    if (column.id === "price") label = "Preis";
                    if (column.id === "checkInDate") label = "Anreise";
                    if (column.id === "checkOutDate") label = "Abreise";
                    if (column.id === "status") label = "Status";
                    return (
                    <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                        }
                    >
                        {label}
                    </DropdownMenuCheckboxItem>
                    );
                })}
            </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  Keine Ergebnisse.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} von{" "}
          {table.getFilteredRowModel().rows.length} Zeile(n) ausgewählt.
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Vorherige
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Nächste
          </Button>
        </div>
      </div>
    </div>
  );
}
