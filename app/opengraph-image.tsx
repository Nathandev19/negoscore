import { ImageResponse } from "next/og";
import { loadFonts } from "@/lib/share-card/render";
import { SITE_PREVIEW_ALT, SITE_PREVIEW_SIZE, sitePreviewElement } from "@/lib/share-card/site-preview";

// Aperçu Open Graph de tout le site (mission #047) : placé à la racine, il vaut
// pour toutes les pages, y compris les pages de résultat, qui ne révèlent donc
// rien de l'offre quand leur lien est partagé.
export const alt = SITE_PREVIEW_ALT;
export const size = SITE_PREVIEW_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(sitePreviewElement(), { ...size, fonts: await loadFonts() });
}
