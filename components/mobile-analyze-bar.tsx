"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EXAMPLE_ORIGIN_PARAM } from "@/lib/analytics/views";

const PAGES = new Set(["/", "/analyse/demo", "/exemple", "/tarifs", "/combien-facturer", "/droits-utilisation", "/produits-offerts"]);
const PAGE_CTA_SELECTOR = 'main a[href="/analyse"], main button[type="submit"], footer a[href="/analyse"]';
const HEADER_HEIGHT = 56;
const CTA_APPROACH = 16;

// L'origine d'un clic interne reste dans ?de=, séparée des paramètres utm
// qui décrivent l'arrivée sur le site.
export const MOBILE_ANALYZE_HREF = `/analyse?${EXAMPLE_ORIGIN_PARAM}=bouton-mobile`;

type VerticalRect = Pick<DOMRect, "top" | "bottom">;

export function showMobileAnalyzeBar(pathname: string | null, ctas: readonly VerticalRect[], viewportHeight: number): boolean {
  const approach = pathname === "/analyse/demo" || pathname === "/exemple" ? CTA_APPROACH : 0;
  return pathname !== null && PAGES.has(pathname) && !ctas.some((cta) => cta.bottom > HEADER_HEIGHT && cta.top < viewportHeight + approach);
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
        setVisible(window.matchMedia("(max-width: 767px)").matches && showMobileAnalyzeBar(pathname, ctas, window.innerHeight));
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
      <div aria-hidden="true" className="h-[calc(3.75rem+env(safe-area-inset-bottom))] min-[360px]:h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" />
      {visible ? (
        /* À 320 px, une barre pleine largeur masquerait le score de l'exemple.
           Le bouton étroit reste à droite ; dès 360 px, il prend toute la largeur. */
        <div
          data-mobile-analyze-bar
          className="fixed right-1 bottom-[calc(0.25rem+env(safe-area-inset-bottom))] z-30 w-[76px] min-[360px]:inset-x-0 min-[360px]:bottom-0 min-[360px]:w-auto min-[360px]:border-t min-[360px]:border-filet min-[360px]:bg-creme min-[360px]:px-4 min-[360px]:pt-2 min-[360px]:pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <Button asChild size="lg" className="h-14 w-full whitespace-normal px-1 text-center text-sm leading-tight min-[360px]:h-12 min-[360px]:text-base">
            <Link href={MOBILE_ANALYZE_HREF}>Analyser un deal</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
