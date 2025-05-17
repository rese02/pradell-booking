import { GuestHeader } from "@/components/guest/GuestHeader";
import type { ReactNode } from "react";

export default function GuestBookingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background to-blue-100/50 dark:from-background dark:to-blue-900/30">
      <GuestHeader />
      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-card">
        <p>&copy; {new Date().getFullYear()} Gastfreund Pro. Bei Fragen kontaktieren Sie bitte das Hotel.</p>
      </footer>
    </div>
  );
}
