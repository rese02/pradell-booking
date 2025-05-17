import type { ReactNode } from "react";
// Removed GuestHeader as the new design integrates logo and title within the page content

export default function GuestBookingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background to-blue-100/30 dark:from-background dark:to-blue-900/20">
      {/* GuestHeader was here, removed as per new design integration */}
      <main className="flex-grow container mx-auto px-2 sm:px-4 lg:px-6 py-6 sm:py-8">
        {children}
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-background/80">
        <p>&copy; {new Date().getFullYear()} Pradell Hotel. Bei Fragen kontaktieren Sie uns bitte.</p>
      </footer>
    </div>
  );
}
