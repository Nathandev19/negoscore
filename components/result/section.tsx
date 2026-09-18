import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
  // Ancre du bloc (#message), avec une marge sous l'en-tête collant.
  id?: string;
  // Pastille à côté du titre (« Débloqué à l'instant », mission #067).
  badge?: ReactNode;
};

// Bloc de résultat sur crème : titre serré sur son contenu. L'écart entre
// blocs est posé par la page.
export function Section({ title, children, className, id, badge }: SectionProps) {
  return (
    <section id={id} className={cn("flex flex-col gap-3", id && "scroll-mt-24", className)}>
      {badge ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* tabIndex -1 : le titre peut recevoir le focus à l'arrivée sur l'ancre. */}
          <h2 tabIndex={-1} className="text-h2">
            {title}
          </h2>
          {badge}
        </div>
      ) : (
        <h2 tabIndex={id ? -1 : undefined} className="text-h2">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
