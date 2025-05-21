// src/components/shared/Logo.tsx
import { cn } from "@/lib/utils";
import Image from "next/image";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Image
        src="/logo.png" // This points to public/logo.png
        alt="Gastfreund Pro Logo"
        width={150} 
        height={30} 
        priority // Ensures the logo loads quickly, good for LCP
        className="h-auto" // Adjust height automatically based on width and aspect ratio
        data-ai-hint="logo company"
      />
    </div>
  );
}
