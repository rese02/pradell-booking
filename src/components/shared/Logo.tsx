import { cn } from "@/lib/utils";
import Image from "next/image";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Image
        src="/logo.png" // Geht davon aus, dass Ihr Logo logo.png heißt und im public-Ordner liegt
        alt="Gastfreund Pro Logo"
        width={150} // Passen Sie die Breite nach Bedarf an
        height={30} // Passen Sie die Höhe an, um das Seitenverhältnis und die gewünschte Größe beizubehalten
        priority // Fügen Sie priority hinzu, wenn das Logo "above the fold" ist
        className="h-auto" // Behält das Seitenverhältnis bei, wenn die Breite durch das Elternelement begrenzt wird
      />
    </div>
  );
}
