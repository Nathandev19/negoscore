import { cn } from "@/lib/utils";

// Os de squelette (mission #048) : un aplat aux couleurs du site, à la place
// d'un contenu qui arrive. Aucune bibliothèque. Pulsation douce (.skeleton,
// globals.css), figée par la règle globale prefers-reduced-motion.
//
// Taille : un os « ligne » occupe exactement la hauteur de ligne du texte qu'il
// remplace (h-[1lh] dans un élément qui porte la même classe de texte), pour
// que le contenu réel prenne la même place à son arrivée.
export function Bone({ className, onMarque = false }: { className?: string; onMarque?: boolean }) {
  return (
    <span
      aria-hidden
      data-bone
      className={cn("skeleton block rounded-pill", onMarque ? "bg-creme/20" : "bg-filet", className)}
    />
  );
}

// Ligne de texte fantôme : l'os est centré dans une ligne de la hauteur réelle.
export function BoneLine({ className, width = "w-full", onMarque = false }: { className?: string; width?: string; onMarque?: boolean }) {
  return (
    <span aria-hidden className={cn("flex h-[1lh] items-center", className)}>
      <Bone onMarque={onMarque} className={cn("h-[0.7em]", width)} />
    </span>
  );
}

// Annonce du chargement aux lecteurs d'écran, sans texte visible.
export function LoadingAnnouncement() {
  return (
    <p role="status" className="sr-only">
      Chargement de la page
    </p>
  );
}
