
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { LayoutDashboard, BookOpen, Settings, Users, BarChart2, HotelIcon } from "lucide-react"; // Added BarChart2 and HotelIcon
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltip?: string;
}

const navItems: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, tooltip: "Übersicht" },
  { href: "/admin/bookings", label: "Buchungen", icon: BookOpen, tooltip: "Alle Buchungen" },
  { href: "/admin/guests", label: "Gäste", icon: Users, tooltip: "Gästedatenbank" },
  { href: "/admin/reports", label: "Berichte", icon: BarChart2, tooltip: "Statistiken & Berichte" },
  { href: "/admin/hotel-settings", label: "Hotelinfo", icon: HotelIcon, tooltip: "Hoteleinstellungen" },
];

export function AdminSidebarNav() {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {navItems.map((item) => (
        <SidebarMenuItem key={item.href} className="px-2">
          <SidebarMenuButton
            asChild
            isActive={pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(item.href))}
            tooltip={item.tooltip || item.label}
            variant="default" // Will use sidebar specific variants from globals.css
            size="default"
            className={cn(
              "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              (pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(item.href))) && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
            )}
          >
            <Link href={item.href}>
              <item.icon className="h-5 w-5" /> {/* Slightly larger icons */}
              <span className="ml-1">{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
