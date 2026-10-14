"use client";

import { useEffect, useState } from "react";

type ViewportReading = { width: number; height: number; top: string; bottom: string; agent: string };

function readViewport(): ViewportReading {
  const inset = document.createElement("span");
  inset.style.cssText = "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.append(inset);
  const computed = getComputedStyle(inset);
  const top = computed.paddingTop;
  const bottom = computed.paddingBottom;
  inset.remove();
  return { width: window.innerWidth, height: window.innerHeight, top, bottom, agent: navigator.userAgent.slice(0, 60) };
}

export function InternalViewportProbe() {
  const [reading, setReading] = useState<ViewportReading | null>(null);

  useEffect(() => {
    const update = () => setReading(readViewport());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <aside data-internal-viewport className="border-b border-filet bg-creme px-4 py-1 text-xs text-encre">
      {reading ? (
        <span>
          {reading.width} × {reading.height} · safe top {reading.top} · safe bottom {reading.bottom} · UA {reading.agent}
        </span>
      ) : "Mesure du viewport…"}
    </aside>
  );
}
