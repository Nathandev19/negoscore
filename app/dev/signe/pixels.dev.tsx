"use client";

import { useEffect, useRef } from "react";

// Rastérise le SVG à 16 × 16 et 32 × 32 dans un canevas, puis agrandit chaque
// pixel 12 et 6 fois sans lissage : ce que voit réellement un onglet.
export function SignPixels({ svg }: { svg: string }) {
  const small = useRef<HTMLCanvasElement>(null);
  const medium = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      ([[16, small.current], [32, medium.current]] as const).forEach(([size, target]) => {
        const source = document.createElement("canvas");
        source.width = size;
        source.height = size;
        source.getContext("2d")?.drawImage(image, 0, 0, size, size);
        const context = target?.getContext("2d");
        if (!target || !context) return;
        context.imageSmoothingEnabled = false;
        context.drawImage(source, 0, 0, target.width, target.height);
      });
    };
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
  return (
    <div className="flex gap-6">
      <canvas ref={small} width={192} height={192} aria-label="16 px agrandi" />
      <canvas ref={medium} width={192} height={192} aria-label="32 px agrandi" />
    </div>
  );
}
