import { ImageResponse } from "next/og";
import { MarkImage } from "@/components/brand/mark-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<MarkImage size={180} radius={0} />, size);
}
