import type { LucideProps } from 'lucide-react';
import { Hotel } from 'lucide-react';

export function Logo({ className, ...props }: LucideProps) {
  return (
    <div className="flex items-center gap-2">
      <Hotel className={cn("h-7 w-7 text-primary", className)} {...props} />
      <span className="text-xl font-semibold text-foreground">Gastfreund Pro</span>
    </div>
  );
}

// Minimalistic helper for className merging, as cn from lib/utils might not be available here if this file is moved.
// For robustness, ensure cn is properly imported or defined if this component is used in varied contexts.
// However, given standard project structure, `import { cn } from "@/lib/utils"` should work.
// For now, assuming it's used where cn is available through such import.
// If not, a local cn implementation would be: const cn = (...classes) => classes.filter(Boolean).join(' ');

import { cn } from "@/lib/utils";
