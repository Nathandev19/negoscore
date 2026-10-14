"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { EXAMPLE_ORIGIN_PARAM, GUIDE_PATHS } from "@/lib/analytics/views";

export const PAGES = new Set<string>(["/", "/analyse/demo", "/exemple", "/tarifs", ...GUIDE_PATHS]);
const isResultPath = (pathname: string) => pathname.startsWith("/analyse/resultat/") || (process.env.NODE_ENV === "development" && pathname === "/dev/resultat");
const isEligible = (pathname: string | null, signedIn: boolean) => pathname !== null && (signedIn || PAGES.has(pathname) || isResultPath(pathname));
const SCORE_BLOCK_SELECTOR = 'main [data-score-verdict], main [data-score-block], main [aria-label="Verdict"]';
const RUNNING_SELECTOR = "[data-analysis-running]";
const HEADER_HEIGHT = 56;

// L'origine d'un clic interne reste dans ?de=, séparée des paramètres utm
// qui décrivent l'arrivée sur le site.
export const MOBILE_ANALYZE_HREF = `/analyse?${EXAMPLE_ORIGIN_PARAM}=bouton-mobile`;

type VerticalRect = Pick<DOMRect, "top" | "bottom">;

export function showMobileAnalyzeBar(
  pathname: string | null,
  viewportHeight: number,
  scoreBlocks: readonly VerticalRect[] = [],
  signedIn = false,
): boolean {
  return isEligible(pathname, signedIn)
    && !scoreBlocks.some((score) => score.bottom > HEADER_HEIGHT && score.top < viewportHeight);
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
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const eligible = isEligible(pathname, signedIn);

  useEffect(() => {
    if (!eligible) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scoreBlocks = [...document.querySelectorAll<HTMLElement>(SCORE_BLOCK_SELECTOR)].map((element) => element.getBoundingClientRect());
        const running = document.querySelector(RUNNING_SELECTOR) !== null;
        setAnalysisRunning(running);
        setVisible(
          window.matchMedia("(max-width: 767px)").matches &&
            showMobileAnalyzeBar(pathname, window.innerHeight, scoreBlocks, signedIn),
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
      className="fixed inset-x-0 bottom-0 z-30 h-[72px] border-t border-encre bg-creme pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="grid h-full w-full grid-cols-3">
        <Link href="/historique" className="flex items-center justify-center px-1 text-center text-[10px] font-semibold leading-[11px] text-encre">
          Mes négociations
        </Link>
        <Link href={MOBILE_ANALYZE_HREF} aria-label="Analyser un deal" aria-disabled={analysisRunning} tabIndex={analysisRunning ? -1 : undefined} onClick={analysisRunning ? (event) => event.preventDefault() : undefined} className="flex flex-col items-center justify-center text-center text-[10px] font-semibold leading-[11px] text-encre aria-disabled:opacity-60">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-marque text-[30px] font-medium leading-none text-creme">+</span>
          <span>Analyser</span>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={onMenuToggle}
          className="px-1 text-[10px] font-semibold leading-[11px] text-encre"
        >
          Menu
        </button>
      </div>
    </nav>
  ) : (
    <div
      data-mobile-analyze-bar
      className="fixed inset-x-0 bottom-0 z-30 h-[72px] border-t border-encre bg-creme pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <Button asChild size="lg" className="h-full w-full rounded-none text-base">
        <Link href={MOBILE_ANALYZE_HREF} aria-disabled={analysisRunning} tabIndex={analysisRunning ? -1 : undefined} onClick={analysisRunning ? (event) => event.preventDefault() : undefined}>Analyser un deal</Link>
      </Button>
    </div>
  );
}
