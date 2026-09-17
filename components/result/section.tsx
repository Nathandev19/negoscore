import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

// Bloc de résultat : titre serré sur son contenu, filet au-dessus pour le
// séparer du bloc précédent. L'écart entre blocs est posé par la page.
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("flex flex-col gap-3 border-t border-filet pt-5", className)}>
      <h2 className="text-h2 font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
