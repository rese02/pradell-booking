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
import { Logo } from '@/components/shared/Logo';
import { Settings } from 'lucide-react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar variant="sidebar" collapsible="icon" side="left">
        <SidebarHeader className="p-4">
          {/* Logo visible when sidebar expanded, trigger when collapsed */}
          <div className="group-data-[collapsible=icon]:hidden">
             <Logo />
          </div>
          <div className="hidden group-data-[collapsible=icon]:block">
            <SidebarTrigger/>
          </div>
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
