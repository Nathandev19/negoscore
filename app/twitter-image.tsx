import { ImageResponse } from "next/og";
import { loadFonts } from "@/lib/share-card/render";
import { SITE_PREVIEW_ALT, SITE_PREVIEW_SIZE, sitePreviewElement } from "@/lib/share-card/site-preview";

// Même image que l'aperçu Open Graph, pour les cartes Twitter / X.
export const alt = SITE_PREVIEW_ALT;
export const size = SITE_PREVIEW_SIZE;
export const contentType = "image/png";

export default async function TwitterImage() {
  return new ImageResponse(sitePreviewElement(), { ...size, fonts: await loadFonts() });
}
