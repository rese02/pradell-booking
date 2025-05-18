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
        priority 
        className="h-auto" 
      />
    </div>
  );
}
