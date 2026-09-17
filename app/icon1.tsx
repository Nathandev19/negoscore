import { ImageResponse } from "next/og";
import { MarkImage } from "@/components/brand/mark-image";

// Favicon PNG 32 px, en complément de app/icon.svg pour les navigateurs qui
// n'acceptent pas le SVG.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<MarkImage size={32} radius={7} />, size);
}
