"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { noteLocation } from "@/lib/shown-once";

// Monté une fois dans la mise en page, qui reste en place d'une page à
// l'autre : il voit chaque changement de chemin, même quand la page qui a
// montré le message n'est plus là pour le voir (mission #068). N'affiche rien.
export function ShownOnceTracker() {
  const pathname = usePathname();
  useEffect(() => {
    noteLocation(pathname);
  }, [pathname]);
  return null;
}
