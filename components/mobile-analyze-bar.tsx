"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EXAMPLE_ORIGIN_PARAM } from "@/lib/analytics/views";

const PAGES = new Set(["/", "/analyse/demo", "/exemple", "/tarifs", "/combien-facturer", "/droits-utilisation", "/produits-offerts"]);
const PAGE_CTA_SELECTOR = 'main a[href="/analyse"], main button[type="submit"], footer a[href="/analyse"]';
const SCORE_BLOCK_SELECTOR = "main [data-score-block]";
const HEADER_HEIGHT = 56;
const CTA_APPROACH = 16;

// L'origine d'un clic interne reste dans ?de=, séparée des paramètres utm
// qui décrivent l'arrivée sur le site.
export const MOBILE_ANALYZE_HREF = `/analyse?${EXAMPLE_ORIGIN_PARAM}=bouton-mobile`;

type VerticalRect = Pick<DOMRect, "top" | "bottom">;

export function showMobileAnalyzeBar(
  pathname: string | null,
  ctas: readonly VerticalRect[],
  viewportHeight: number,
  scoreBlocks: readonly VerticalRect[] = [],
): boolean {
  const approach = pathname === "/analyse/demo" || pathname === "/exemple" ? CTA_APPROACH : 0;
  return pathname !== null && PAGES.has(pathname)
    && !scoreBlocks.some((score) => score.bottom > HEADER_HEIGHT && score.top < viewportHeight)
    && !ctas.some((cta) => cta.bottom > HEADER_HEIGHT && cta.top < viewportHeight + approach);
}

export function MobileAnalyzeBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const eligible = pathname !== null && PAGES.has(pathname);

  useEffect(() => {
    if (!eligible) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const ctas = [...document.querySelectorAll<HTMLElement>(PAGE_CTA_SELECTOR)].map((element) => element.getBoundingClientRect());
        const scoreBlocks = [...document.querySelectorAll<HTMLElement>(SCORE_BLOCK_SELECTOR)].map((element) => element.getBoundingClientRect());
        setVisible(window.matchMedia("(max-width: 767px)").matches && showMobileAnalyzeBar(pathname, ctas, window.innerHeight, scoreBlocks));
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const main = document.querySelector("main");
    const resizeObserver = main && typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (main) resizeObserver?.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
    };
  }, [eligible, pathname]);

  if (!eligible) return null;

  return (
    <>
      {/* La réserve est au bas du pied de page : elle ne déplace rien au-dessus
          de la ligne de flottaison et laisse atteindre le dernier contenu. */}
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" />
      {visible ? (
        <div
          data-mobile-analyze-bar
          className="fixed inset-x-0 bottom-0 z-30 border-t border-filet bg-creme px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <Button asChild size="lg" className="h-12 w-full text-base">
            <Link href={MOBILE_ANALYZE_HREF}>Analyser un deal</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
