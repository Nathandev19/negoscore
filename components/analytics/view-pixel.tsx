"use client";

import { useEffect } from "react";
import { currentAttribution } from "@/components/analytics/first-party-view";
import { WITHOUT_JS } from "@/lib/no-js";
import { viewPixelSrc, viewPixelUrl, type MeasuredPage } from "@/lib/analytics/views";

const pendingPixels = new Set<HTMLImageElement>();

// Avec JavaScript, l'image n'est demandée qu'après affichage de la page et
// porte uniquement le domaine normalisé. Sans JavaScript, le fond de l'élément
// data-sans-js garde la mesure des vues ; le référent de la page n'est alors
// pas accessible au pixel, donc la colonne reste honnêtement inconnue.
// Ce fond ne provoque pas le préchargement d'image de React (#136).
//
// Mission #161 — l'adresse émise est construite par viewPixelUrl, pas ici :
// c'est elle qui emporte l'origine `?de=` lue dans l'adresse de la page. Ce
// composant ne compose plus de chaîne, pour qu'il n'existe qu'UN endroit où
// cette adresse se décide, et un seul à tester.
export function ViewPixel({ page }: { page: MeasuredPage }) {
  useEffect(() => {
    if (navigator.doNotTrack === "1") return;
    const image = new Image();
    pendingPixels.add(image);
    image.onload = image.onerror = () => pendingPixels.delete(image);
    image.src = viewPixelUrl(page, window.location.search, currentAttribution().referrer_host);
  }, [page]);
  return (
    <div
      {...WITHOUT_JS}
      aria-hidden="true"
      className="pointer-events-none absolute h-px w-px opacity-0"
      style={{ backgroundImage: `url("${viewPixelSrc(page)}")` }}
    />
  );
}
