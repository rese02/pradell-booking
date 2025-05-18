import type { ReactNode } from 'react';
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
// Removed Logo import as it's no longer used in SidebarHeader
import { Settings } from 'lucide-react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar variant="sidebar" collapsible="icon" side="left">
        <SidebarHeader className="p-4 flex items-center justify-center group-data-[collapsible=icon]:justify-center">
          {/* Logo removed from here */}
          {/* SidebarTrigger is always visible and centered when sidebar is in icon mode */}
          <SidebarTrigger/>
        </SidebarHeader>
        <SidebarContent>
          <AdminSidebarNav />
        </SidebarContent>
        <SidebarFooter>
           <Button variant="ghost" className="w-full justify-start gap-2" asChild>
            <Link href="/admin/settings"> {/* Placeholder link */}
              <Settings className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">Einstellungen</span>
            </Link>
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <AdminHeader />
        <main className="flex-1 p-4 sm:p-6 bg-background/40 min-h-[calc(100vh-4rem)]">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
