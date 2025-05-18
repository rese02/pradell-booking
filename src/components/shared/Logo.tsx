import { cn } from "@/lib/utils";
import Image from "next/image";

interface LogoProps {
  className?: string;
  // We can remove LucideProps if no longer directly passing them to an icon
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Image
        src="/logo.png" // Assumes your logo is named logo.png and in the public folder
        alt="Gastfreund Pro Logo"
        width={150} // Adjust width as needed
        height={30} // Adjust height as needed to maintain aspect ratio and desired size
        priority // Add priority if the logo is above the fold
        className="h-auto" // maintain aspect ratio if only height or width is constrained by parent
      />
    </div>
  );
}
