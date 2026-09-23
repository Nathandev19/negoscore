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

// Mission #097 — ce qui se lit une fois se replie, ce qui se relit reste
// ouvert. Le repli est NATIF (<details>/<summary>) : il fonctionne sans
// JavaScript, au clavier, et l'état déplié/replié est annoncé par le
// navigateur lui-même — un aria-expanded écrit à la main serait faux.
// Rien n'est retiré de la page : le contenu est à un clic, et un navigateur
// qui ne sait pas replier affiche tout.
//
// hint : ce que le bloc contient, visible sans l'ouvrir. C'est lui qui évite
// d'avoir à ouvrir pour savoir si ça vaut la peine.
export function CollapsibleSection({
  title,
  hint,
  children,
  className,
  id,
  open = false,
}: SectionProps & { hint?: ReactNode; open?: boolean }) {
  return (
    <section id={id} className={cn("flex flex-col", id && "scroll-mt-24", className)}>
      <details open={open} className="flex flex-col">
        <summary className="flex cursor-pointer list-none flex-col gap-1 rounded-control py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marque">
          <span className="flex items-baseline gap-2">
            <span aria-hidden className="details-chevron text-attenue">
              ›
            </span>
            <h2 className="text-h2">{title}</h2>
          </span>
          {hint ? <span className="pl-5 text-small text-attenue">{hint}</span> : null}
        </summary>
        <div className="mt-3 flex flex-col gap-3">{children}</div>
      </details>
    </section>
  );
}
