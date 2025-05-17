"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { LayoutDashboard, BookOpen, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltip?: string;
}

const navItems: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, tooltip: "Dashboard" },
  { href: "/admin/bookings", label: "Buchungen", icon: BookOpen, tooltip: "Buchungen" },
  // Add more items as needed, e.g.:
  // { href: "/admin/guests", label: "Gäste", icon: Users, tooltip: "Gäste verwalten" },
  // { href: "/admin/settings", label: "Einstellungen", icon: Settings, tooltip: "Einstellungen" },
];

export function AdminSidebarNav() {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {navItems.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            asChild
            isActive={pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(item.href))}
            tooltip={item.tooltip || item.label}
            variant="default"
            size="default"
          >
            <Link href={item.href}>
              <item.icon />
              <span>{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
