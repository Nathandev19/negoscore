"use client";

import { useEffect } from "react";
import { currentAttribution } from "@/components/analytics/first-party-view";
import { WITHOUT_JS } from "@/lib/no-js";
import { viewPixelSrc, type MeasuredPage } from "@/lib/analytics/views";

const pendingPixels = new Set<HTMLImageElement>();

// Avec JavaScript, l'image n'est demandée qu'après affichage de la page et
// porte uniquement le domaine normalisé. Sans JavaScript, le fond de l'élément
// data-sans-js garde la mesure des vues ; le référent de la page n'est alors
// pas accessible au pixel, donc la colonne reste honnêtement inconnue.
// Ce fond ne provoque pas le préchargement d'image de React (#136).
export function ViewPixel({ page }: { page: MeasuredPage }) {
  useEffect(() => {
    if (navigator.doNotTrack === "1") return;
    const referrer = currentAttribution().referrer_host;
    const image = new Image();
    pendingPixels.add(image);
    image.onload = image.onerror = () => pendingPixels.delete(image);
    image.src = `${viewPixelSrc(page)}${referrer === null ? "" : `&r=${encodeURIComponent(referrer)}`}`;
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
