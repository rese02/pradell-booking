import { cn } from "@/lib/utils";
import Image from 'next/image';

// Simple placeholder for the Pradell Hotel logo.
// Replace with actual SVG or Image component once available.
export function PradellLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      {/* Placeholder SVG - replace with actual logo */}
      <svg width="100" height="80" viewBox="0 0 150 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-16 w-auto dark:text-white text-black">
        <path d="M75 10 L60 30 L75 50 L90 30 Z M75 10" stroke="currentColor" strokeWidth="2" fill="none"/>
        <path d="M40 30 Q50 15 60 30 T80 70" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M110 30 Q100 15 90 30 T70 70" stroke="currentColor" strokeWidth="2" fill="none" />
        <rect x="65" y="35" width="20" height="15" stroke="currentColor" strokeWidth="2" fill="hsl(var(--background))" />
         <text x="75" y="47" fontFamily="serif" fontSize="10" fill="currentColor" textAnchor="middle">P</text>
        <path d="M60 55 C 50 75, 50 90, 75 90 C 100 90, 100 75, 90 55" stroke="currentColor" strokeWidth="2" fill="none"/>
        <text x="75" y="75" fontFamily="sans-serif" fontSize="8" fill="currentColor" textAnchor="middle">PRADELL</text>
        <text x="75" y="85" fontFamily="sans-serif" fontSize="7" fill="currentColor" textAnchor="middle">HOTEL</text>
      </svg>
    </div>
  );
}
