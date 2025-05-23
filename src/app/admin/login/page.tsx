
"use client";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LogIn, LibraryBig } from "lucide-react"; 
import { Logo } from "@/components/shared/Logo"; 
import { useRouter } from "next/navigation"; 
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

const loginSchema = z.object({
  email: z.string().email({ message: "Ungültige E-Mail-Adresse." }),
  password: z.string().min(1, { message: "Passwort ist erforderlich." }), 
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "info@pradell.com",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    await new Promise(resolve => setTimeout(resolve, 700));

    if (values.email === "info@pradell.com" && values.password === "Pradell!") {
      toast({
        title: "Login erfolgreich",
        description: "Willkommen zurück!",
      });
      router.push("/admin/dashboard");
    } else {
      toast({
        variant: "destructive",
        title: "Login fehlgeschlagen",
        description: "Ungültige E-Mail-Adresse oder Passwort.",
      });
      form.setError("root", { message: "Ungültige E-Mail-Adresse oder Passwort."});
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="w-full md:w-2/5 lg:w-1/3 flex flex-col justify-center items-center p-8 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <Logo /> 
          </div>
          
          <h1 className="text-2xl font-semibold text-center mb-2 text-foreground">Pradell Buchungssystem</h1>
          <p className="text-sm text-muted-foreground text-center mb-10">Bitte loggen Sie sich ein</p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">Benutzername (E-Mail)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="info@pradell.com" {...field} className="input-modern" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">Passwort</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="input-modern" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && (
                <p className="text-sm font-medium text-destructive">{form.formState.errors.root.message}</p>
              )}
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 text-base font-semibold rounded-lg shadow-md hover:shadow-lg transition-shadow" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  "Einloggen..."
                ) : (
                  <>
                    <LogIn className="mr-2 h-5 w-5" /> Einloggen
                  </>
                )}
              </Button>
            </form>
          </Form>

          <p className="mt-16 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} Hotel Pradell. Alle Rechte vorbehalten. | <Link href="/datenschutz" className="hover:underline text-primary/80">Datenschutz</Link>
          </p>
        </div>
      </div>

      <div 
        className="hidden md:flex md:w-3/5 lg:w-2/3 flex-col justify-center items-center p-12 text-center bg-gradient-to-b from-primary via-primary/90 to-primary-darker text-primary-foreground"
      >
        <LibraryBig className="h-28 w-28 mb-8 opacity-75" data-ai-hint="building document"/>
        <h2 className="text-4xl font-bold mb-4">Willkommen zurück!</h2>
        <p className="text-lg max-w-md opacity-90">
          Verwalten Sie Ihre Hotelbuchungen effizient und professionell. Behalten Sie den Überblick über Gästeformationen und Dokumente.
        </p>
      </div>
    </div>
  );
}
