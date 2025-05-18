import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Logo } from "@/components/shared/Logo"; // Using alias path

export default function WelcomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-background to-blue-100 dark:from-background dark:to-blue-900/30">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="items-center text-center">
          <Logo />
          <CardTitle className="text-3xl font-bold mt-4">Willkommen bei Gastfreund Pro</CardTitle>
          <CardDescription className="text-lg">
            Ihre Lösung für intelligentes Hotel-Booking-Management.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6">
          <p className="text-center text-muted-foreground">
            Verwalten Sie Ihre Buchungen effizient und bieten Sie Ihren Gästen ein nahtloses Erlebnis.
          </p>
          <Button asChild size="lg" className="w-full max-w-xs">
            <Link href="/admin/login">Zum Admin Login</Link>
          </Button>
        </CardContent>
      </Card>
      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Gastfreund Pro. Alle Rechte vorbehalten.</p>
      </footer>
    </main>
  );
}
