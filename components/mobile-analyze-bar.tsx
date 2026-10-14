"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { SoldeEntete } from "@/components/solde-negociations";
import { EXAMPLE_ORIGIN_PARAM, GUIDE_PATHS } from "@/lib/analytics/views";

export const PAGES = new Set<string>(["/", "/analyse/demo", "/exemple", "/tarifs", ...GUIDE_PATHS]);
const PAGE_CTA_SELECTOR = 'main a[href="/analyse"], main button[type="submit"], footer a[href="/analyse"]';
const SCORE_BLOCK_SELECTOR = 'main [data-score-block], main [aria-label="Verdict"]';
// Mission #172 — l'écran d'attente, où qu'il soit dans la page.
const RUNNING_SELECTOR = "[data-analysis-running]";
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
  // Mission #172 — UNE ANALYSE TOURNE. Rapporté sur iPhone, Safari, navigation
  // privée : pendant « On analyse ton offre », la barre proposait de lancer ce
  // qui était déjà en cours.
  //
  // La cause n'était pas un oubli de règle, c'est l'inverse : l'écran
  // d'attente REMPLACE le formulaire, donc le `button[type="submit"]` que la
  // barre surveillait disparaît de la page — et la barre, qui se cachait
  // justement parce qu'un bouton d'analyse était à l'écran, se montrait.
  //
  // Ce booléen ne dépend PAS du défilement : une analyse tourne ou ne tourne
  // pas, et on ne propose pas d'en lancer une deuxième parce qu'on a fait
  // défiler la page.
  analysisRunning = false,
  signedIn = false,
): boolean {
  if (analysisRunning) return false;
  const approach = pathname === "/analyse/demo" || pathname === "/exemple" ? CTA_APPROACH : 0;
  return pathname !== null && (signedIn || PAGES.has(pathname))
    && !scoreBlocks.some((score) => score.bottom > HEADER_HEIGHT && score.top < viewportHeight)
    && !ctas.some((cta) => cta.bottom > HEADER_HEIGHT && cta.top < viewportHeight + approach);
}

export function MobileAnalyzeBar({ signedIn, menuId, menuOpen, onMenuToggle, menuButtonRef }: {
  signedIn: boolean;
  menuId: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const eligible = pathname !== null && (signedIn || PAGES.has(pathname));

  useEffect(() => {
    if (!eligible) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const ctas = pathname !== null && PAGES.has(pathname)
          ? [...document.querySelectorAll<HTMLElement>(PAGE_CTA_SELECTOR)].map((element) => element.getBoundingClientRect())
          : [];
        const scoreBlocks = [...document.querySelectorAll<HTMLElement>(SCORE_BLOCK_SELECTOR)].map((element) => element.getBoundingClientRect());
        const running = document.querySelector(RUNNING_SELECTOR) !== null;
        setVisible(
          window.matchMedia("(max-width: 767px)").matches &&
            showMobileAnalyzeBar(pathname, ctas, window.innerHeight, scoreBlocks, running, signedIn),
        );
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
  }, [eligible, pathname, signedIn]);

  if (!eligible) return null;

  if (!visible) return null;
  return signedIn ? (
    <nav
      data-mobile-bottom-nav
      aria-label="Navigation basse"
      className="fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-30 h-18 border-t-2 border-encre bg-creme px-2 py-2 md:hidden"
    >
      <div className="mx-auto grid h-full max-w-xl grid-cols-[1.75fr_1.2fr_0.8fr_0.8fr] gap-1">
        <Link href={MOBILE_ANALYZE_HREF} className="flex min-h-11 items-center justify-center rounded-control bg-marque px-1 text-center text-xs font-bold leading-tight text-creme">
          Analyser un deal
        </Link>
        <Link href="/historique" className="flex min-h-11 items-center justify-center rounded-control border border-filet px-1 text-center text-[10px] font-semibold leading-tight text-encre">
          Mes négociations
        </Link>
        <SoldeEntete compact className="h-full w-full rounded-control" />
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={onMenuToggle}
          className="min-h-11 min-w-11 rounded-control border border-filet px-1 text-xs font-semibold text-encre"
        >
          Menu
        </button>
      </div>
    </nav>
  ) : (
    <div
      data-mobile-analyze-bar
      className="fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-30 border-t border-filet bg-creme px-4 py-2 md:hidden"
    >
      <Button asChild size="lg" className="h-12 w-full text-base">
        <Link href={MOBILE_ANALYZE_HREF}>Analyser un deal</Link>
      </Button>
    </div>
  );
}
