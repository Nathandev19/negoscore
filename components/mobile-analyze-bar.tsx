"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListIcon, MenuIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { EXAMPLE_ORIGIN_PARAM, GUIDE_PATHS } from "@/lib/analytics/views";
import { cn } from "@/lib/utils";

export const PAGES = new Set<string>(["/", "/analyse/demo", "/exemple", "/tarifs", ...GUIDE_PATHS]);
const isResultPath = (pathname: string) => pathname.startsWith("/analyse/resultat/") || (process.env.NODE_ENV === "development" && pathname === "/dev/resultat");
const isEligible = (pathname: string | null, signedIn: boolean) => pathname !== null && (signedIn || PAGES.has(pathname) || isResultPath(pathname));
const SCORE_BLOCK_SELECTOR = 'main [data-score-verdict], main [data-score-block], main [aria-label="Verdict"]';
const RUNNING_SELECTOR = "[data-analysis-running]";
const HEADER_HEIGHT = 56;

// L'origine d'un clic interne reste dans ?de=, séparée des paramètres utm
// qui décrivent l'arrivée sur le site.
export const MOBILE_ANALYZE_HREF = `/analyse?${EXAMPLE_ORIGIN_PARAM}=bouton-mobile`;

export function activeMobileSection(pathname: string | null): "negociations" | "analyser" | null {
  if (pathname === "/historique" || pathname?.startsWith("/historique/")) return "negociations";
  if (pathname === "/" || pathname === "/analyse" || pathname?.startsWith("/analyse/resultat/") || pathname === "/dev/resultat") return "analyser";
  return null;
}

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
  const active = activeMobileSection(pathname);

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
      className="fixed inset-x-0 bottom-0 z-30 h-[calc(50px+max(8px,env(safe-area-inset-bottom)))] border-t border-encre bg-creme pb-[max(8px,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="grid h-full w-full grid-cols-3">
        <Link href="/historique" aria-current={active === "negociations" ? "page" : undefined} className={cn("grid min-h-0 grid-rows-[minmax(0,1fr)_11px] justify-items-center px-1 text-center text-[9px] font-semibold leading-[11px]", active === "negociations" ? "text-marque" : "text-encre")}>
          <ListIcon aria-hidden="true" className="mb-0.5 size-6 self-end" strokeWidth={1.75} />
          <span>Négociations</span>
        </Link>
        <Link href={MOBILE_ANALYZE_HREF} aria-label="Analyser un deal" aria-current={pathname !== "/" && active === "analyser" ? "page" : undefined} aria-disabled={analysisRunning} tabIndex={analysisRunning ? -1 : undefined} onClick={analysisRunning ? (event) => event.preventDefault() : undefined} className={cn("grid min-h-0 grid-rows-[minmax(0,1fr)_11px] justify-items-center text-center text-[9px] font-semibold leading-[11px] aria-disabled:opacity-60", active === "analyser" ? "text-marque" : "text-encre")}>
          <span aria-hidden="true" className="relative z-10 mb-0.5 flex size-12 self-end items-center justify-center rounded-full bg-marque text-creme"><PlusIcon className="size-6" strokeWidth={1.75} /></span>
          <span>Analyser</span>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={onMenuToggle}
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_11px] justify-items-center px-1 text-center text-[9px] font-semibold leading-[11px] text-encre"
        >
          <MenuIcon aria-hidden="true" className="mb-0.5 size-6 self-end" strokeWidth={1.75} />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  ) : (
    <div
      data-mobile-analyze-bar
      className="fixed inset-x-0 bottom-0 z-30 h-[calc(50px+max(8px,env(safe-area-inset-bottom)))] border-t border-encre bg-marque pb-[max(8px,env(safe-area-inset-bottom))] md:hidden"
    >
      <Button asChild size="lg" className="h-full w-full rounded-none text-base">
        <Link href={MOBILE_ANALYZE_HREF} aria-disabled={analysisRunning} tabIndex={analysisRunning ? -1 : undefined} onClick={analysisRunning ? (event) => event.preventDefault() : undefined}>Analyser un deal</Link>
      </Button>
    </div>
  );
}
