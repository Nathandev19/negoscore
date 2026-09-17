"use client";

import { useLinkStatus } from "next/link";

// Retour visuel d'un lien en cours de navigation (mission #045) :
// useLinkStatus (next/link, Next 15.3+, vérifié sur 16.3.5) vaut pending entre
// le clic et la mise à jour de l'historique. À placer DANS un <Link> dont la
// classe contient « relative ».
//
// Une barre sous le libellé, en position absolue : aucun décalage de mise en
// page. Elle n'apparaît qu'après 100 ms (.nav-pending, globals.css) : une
// navigation préchargée, instantanée, ne la fait jamais clignoter. Mouvement
// réduit : la barre apparaît sans s'animer (règle globale).
export function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending ? "" : undefined}
      className="nav-pending pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 rounded-pill bg-current"
    />
  );
}
