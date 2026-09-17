import { ImageResponse } from "next/og";
import { MarkImage } from "@/components/brand/mark-image";

// Icône carrée 512 px (mission #051) : elle sert au manifeste et de logo dans
// les données structurées, où Google demande une image carrée d'au moins
// 112 px sans transparence. Le fond bleu de MarkImage est opaque.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<MarkImage size={512} />, size);
}
