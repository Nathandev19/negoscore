"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

// Entrées de navigation selon l'état affiché. signedIn vient du cookie
// indicateur : il ne choisit que des liens, jamais un accès.
export function navItems(signedIn: boolean): { main: NavItem[]; account: NavItem; cta: NavItem } {
  return {
    main: [
      { href: "/#methode", label: "Comment ça marche" },
      { href: "/offres", label: "Tarifs" },
      ...(signedIn ? [{ href: "/historique", label: "Mes analyses" }] : []),
    ],
    account: signedIn ? { href: "/compte", label: "Mon compte" } : { href: "/connexion", label: "Se connecter" },
    cta: { href: "/analyse", label: "Analyser un deal" },
  };
}

export type HeaderTone = "creme" | "marque";

// Deux tons : crème partout, bleu marque (avec grain) en tête des pages de
// résultat, où l'en-tête se prolonge dans le bandeau de verdict.
// « Analyser un deal » est un lien souligné, pas un bouton : l'action principale
// de chaque écran est dans la page (formulaire, déblocage), jamais dans l'en-tête.
const TONE: Record<HeaderTone, { header: string; link: string; cta: string; toggle: string; panel: string; row: string }> = {
  creme: {
    header: "border-b border-filet bg-creme",
    link: "text-encre-douce decoration-2 underline-offset-4 transition-colors duration-150 hover:text-encre hover:underline aria-[current=page]:text-encre aria-[current=page]:underline",
    cta: "font-semibold text-marque underline decoration-2 underline-offset-4 hover:text-marque-deep",
    toggle: "border-encre text-encre",
    panel: "border-b-2 border-encre bg-creme",
    row: "border-filet",
  },
  marque: {
    header: "on-marque grain bg-marque",
    link: "text-creme decoration-2 underline-offset-4 hover:underline aria-[current=page]:underline",
    cta: "font-semibold text-creme underline decoration-2 underline-offset-4",
    toggle: "border-creme text-creme",
    panel: "on-marque grain bg-marque",
    row: "border-creme/30",
  },
};

// En-tête sans lecture de session : la page le rend statique. Hauteur fixe de
// 56 px quel que soit l'état ; le menu mobile s'ouvre par-dessus le contenu.
export function HeaderNav({
  signedIn,
  pathname = null,
  tone = "creme",
}: {
  signedIn: boolean;
  pathname?: string | null;
  tone?: HeaderTone;
}) {
  const LINK = TONE[tone].link;
  const CTA = TONE[tone].cta;
  const { main, account, cta } = navItems(signedIn);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = (href: string) => (pathname !== null && href === pathname ? ("page" as const) : undefined);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !toggleRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  // Échap ferme ; Tab reste dans le menu (bouton + liens) tant qu'il est ouvert.
  function onMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = [
      toggleRef.current,
      ...Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a, button") ?? []),
    ].filter((el): el is HTMLElement => el !== null);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <header className={cn("sticky top-0 z-40 h-14", TONE[tone].header)}>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Accueil">
          <Logo tone={tone === "marque" ? "on-marque" : "on-creme"} />
        </Link>

        <nav aria-label="Navigation principale" className="hidden h-8 items-center gap-6 text-small lg:flex">
          {main.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current(item.href)} className={cn(LINK, "font-medium")}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden h-8 items-center gap-4 text-small lg:flex">
          <Link href={account.href} aria-current={current(account.href)} className={cn(LINK, "font-medium")}>
            {account.label}
          </Link>
          <Link href={cta.href} aria-current={current(cta.href)} className={CTA}>
            {cta.label}
          </Link>
        </div>

        <div className="lg:hidden" onKeyDown={onMenuKeyDown}>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className={cn("inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-control border-2 px-3 text-sm font-semibold", TONE[tone].toggle)}
          >
            {open ? "Fermer" : "Menu"}
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
              {open ? (
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              ) : (
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <div
            ref={panelRef}
            id={panelId}
            hidden={!open}
            className={cn("absolute inset-x-0 top-14 px-4 pt-2 pb-4 sm:px-6", TONE[tone].panel)}
          >
            <nav aria-label="Navigation mobile" className="mx-auto flex max-w-6xl flex-col">
              {[...main, account].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current(item.href)}
                  onClick={() => setOpen(false)}
                  className={cn(LINK, "flex min-h-11 items-center border-b text-base font-medium", TONE[tone].row)}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href={cta.href}
                aria-current={current(cta.href)}
                onClick={() => setOpen(false)}
                className={cn(CTA, "flex min-h-11 items-center text-base")}
              >
                {cta.label}
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
