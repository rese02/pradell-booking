// src/components/shared/Logo.tsx
import { cn } from "@/lib/utils";
import Image from 'next/image';
import logoImage from './logo.png'; // Importiert logo.png aus demselben Verzeichnis

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Image
        src={logoImage}
        alt="Gastfreund Pro Logo"
        width={150} 
        height={30} 
        priority 
        className="h-auto"
        data-ai-hint="company logo"
      />
    </div>
  );
}
