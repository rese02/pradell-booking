import { Logo } from "@/components/shared/Logo"; // Alias-Pfad verwenden

export function GuestHeader() {
  return (
    <header className="py-6 px-4 sm:px-6 lg:px-8 border-b bg-card">
      <div className="container mx-auto flex justify-between items-center">
        <Logo />
        {/* Optional: Add contact info or help link */}
        {/* <span className="text-sm text-muted-foreground">Fragen? Rufen Sie uns an: +49 123 456789</span> */}
      </div>
    </header>
  );
}
