
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LogIn } from "lucide-react";
import { Logo } from "../../../components/shared/Logo"; // Changed to relative path
import { useRouter } from "next/navigation"; 
import { useToast } from "@/hooks/use-toast";


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
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    console.log("Login attempt:", values);
    await new Promise(resolve => setTimeout(resolve, 1000));

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-blue-100 dark:from-background dark:to-blue-900/30 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="items-center text-center">
          <Logo />
          <CardTitle className="text-2xl font-semibold mt-4">Admin Login</CardTitle>
          <CardDescription>Melden Sie sich an, um Ihre Buchungen zu verwalten.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-Mail</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="info@pradell.com" {...field} />
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
                    <FormLabel>Passwort</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && (
                <p className="text-sm font-medium text-destructive">{form.formState.errors.root.message}</p>
              )}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  "Anmelden..."
                ) : (
                  <>
                    <LogIn className="mr-2 h-4 w-4" /> Anmelden
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
