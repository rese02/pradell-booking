// src/components/shared/Logo.tsx
import { cn } from "@/lib/utils";
import Image from 'next/image';
import logoImage from './logo.png'; // Importiert logo.png aus demselben Verzeichnis

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}> {/* Added justify-center for good measure if parent doesn't have text-center */}
      <Image
        src={logoImage}
        alt="Gastfreund Pro Logo"
        width={100} // Doubled from 50
        height={20} // Doubled from 10
        priority 
        className="h-auto" // Behält das Seitenverhältnis bei, falls width/height anders skaliert werden
        data-ai-hint="company logo"
      />
    </div>
  );
}
