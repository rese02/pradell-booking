
// src/components/shared/PradellLogo.tsx
import { cn } from "@/lib/utils";
// No image import needed if using text/SVG placeholder

export function PradellLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 group", className)}>
      <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-primary group-hover:text-primary-darker transition-colors">
        <path d="M50 10 L30 40 L50 70 L70 40 Z M50 10" stroke="currentColor" strokeWidth="8" fill="hsl(var(--primary-foreground))"/>
        <circle cx="50" cy="50" r="10" fill="currentColor"/>
      </svg>
      <span className="text-xl font-semibold text-foreground group-hover:text-primary-darker transition-colors">
        Gastfreund Pro
      </span>
    </div>
  );
}
