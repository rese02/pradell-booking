
"use client"; // Hinzugefügt, da usePathname clientseitig ist

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation'; // Importiert für Pfadabfrage
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminSidebarNav } from "@/components/admin/AdminSidebarNav";
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { PradellLogo } from '@/components/shared/PradellLogo'; // Import PradellLogo

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Wenn der aktuelle Pfad die Admin-Login-Seite ist,
  // rendere nur die Kinder (die Login-Seite selbst) ohne das Admin-Layout.
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  // Andernfalls, rendere das volle Admin-Layout mit Sidebar und Header.
  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar variant="sidebar" collapsible="icon" side="left" className="border-r border-border/50 shadow-md">
        <SidebarHeader className="p-4 flex items-center justify-between group-data-[collapsible=icon]:justify-center border-b border-border/30">
           {/* PradellLogo only visible when sidebar is expanded */}
          <div className="group-data-[collapsible=icon]:hidden">
            <PradellLogo />
          </div>
          <SidebarTrigger/>
        </SidebarHeader>
        <SidebarContent className="p-2">
          <AdminSidebarNav />
        </SidebarContent>
        <SidebarFooter className="p-2 border-t border-border/30">
           <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" asChild>
            <Link href="/admin/settings"> {/* Placeholder link */}
              <Settings className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">Einstellungen</span>
            </Link>
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <AdminHeader />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-background min-h-[calc(100vh-4rem)]"> {/* Adjusted bg */}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
