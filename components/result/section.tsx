import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

// Bloc de résultat sur crème : titre serré sur son contenu. L'écart entre
// blocs est posé par la page.
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}
