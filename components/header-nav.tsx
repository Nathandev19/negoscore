"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Logo } from "@/components/brand/logo";
import { NavPending } from "@/components/nav-pending";
import { WITHOUT_JS } from "@/lib/no-js";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

// Entrées de navigation selon l'état affiché. signedIn et owner viennent des
// cookies indicateurs : ils ne choisissent que des liens, jamais un accès.
// owner (mission #080) : lien vers les retours sur l'estimation, que le proxy
// et la page ne servent qu'à l'adresse OWNER_EMAIL.
export const OWNER_NAV_ITEM: NavItem = { href: "/dev/retours", label: "Retours" };

export function navItems(signedIn: boolean, owner = false): { main: NavItem[]; account: NavItem; cta: NavItem } {
  return {
    main: [
      { href: "/#methode", label: "Comment ça marche" },
      { href: "/tarifs", label: "Tarifs" },
      ...(signedIn ? [{ href: "/historique", label: "Mes analyses" }] : []),
      ...(signedIn && owner ? [OWNER_NAV_ITEM] : []),
    ],
    account: signedIn ? { href: "/compte", label: "Mon compte" } : { href: "/connexion", label: "Se connecter" },
    cta: { href: "/analyse", label: "Analyser un deal" },
  };
}

export type HeaderTone = "creme" | "marque";

export function shouldCloseMenuOnBlur<T>(menu: { contains(target: T): boolean }, next: T | null): boolean {
  return next !== null && !menu.contains(next);
}

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
  owner = false,
  pathname = null,
  tone = "creme",
}: {
  // null : pas encore connu (rendu serveur, avant hydratation, mission #071).
  signedIn: boolean | null;
  owner?: boolean;
  pathname?: string | null;
  tone?: HeaderTone;
}) {
  const LINK = TONE[tone].link;
  const CTA = TONE[tone].cta;
  const unknown = signedIn === null;
  const { main, account, cta } = navItems(signedIn === true, owner);
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

  // Menu mobile (mission #045) : ses liens sont masqués (hidden) tant qu'il est
  // fermé, donc pas préchargés. À l'ouverture ils deviennent visibles et Next
  // les précharge comme tout lien qui entre dans l'écran.
  function toggle() {
    setOpen((value) => !value);
  }

  // Le menu reste ouvert pendant la navigation, l'entrée cliquée en attente
  // (NavPending) : il ne se referme pas sur une page qui n'a pas encore changé.
  // La page suivante rend son propre en-tête, menu fermé. Un lien vers la page
  // courante (ancre « Comment ça marche » sur l'accueil) ne change pas de page :
  // le menu se ferme tout de suite.
  function onItemClick(href: string) {
    const target = new URL(href, window.location.href);
    if (target.pathname === window.location.pathname) setOpen(false);
  }

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  // Échap ferme et rend le focus au bouton. Tab n'est plus retenu (mission
  // #062, A11) : ce panneau n'est pas une modale — il ne recouvre pas la page,
  // ne la rend pas inerte, et le reste du site doit rester atteignable au
  // clavier. C'est le motif « disclosure » : on sort du menu en tabulant, et
  // le menu se referme quand le focus le quitte (onMenuBlur).
  function onMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  // Le focus a quitté le bouton et le panneau vers une cible connue : le menu
  // se referme sans ramener le focus en arrière. Sur WebKit tactile,
  // relatedTarget peut être null entre le début d'un tap et son click : fermer
  // ici retirerait le lien du DOM avant que sa navigation puisse partir.
  function onMenuBlur(event: FocusEvent<HTMLElement>) {
    if (!open) return;
    const next = event.relatedTarget as Node | null;
    if (shouldCloseMenuOnBlur(event.currentTarget, next)) setOpen(false);
  }

  return (
    <header className={cn("sticky top-0 z-40 h-14", TONE[tone].header)}>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Accueil">
          <Logo variant={tone === "marque" ? "creme" : "marque"} />
        </Link>

        <nav aria-label="Navigation principale" className="hidden h-8 items-center gap-6 text-small lg:flex">
          {main.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current(item.href)} className={cn(LINK, "relative font-medium")}>
              {item.label}
              <NavPending />
            </Link>
          ))}
        </nav>

        <div className="hidden h-8 items-center gap-4 text-small lg:flex">
          {unknown ? (
            // Place réservée, invisible et inerte : rien n'est affirmé avant de
            // savoir. Sans JavaScript (mission #073), l'état ne sera jamais
            // connu : « Se connecter » s'affiche exactement par-dessus, même
            // texte donc même largeur. Avec JavaScript, ce lien est masqué
            // avant le premier affichage (lib/no-js.ts) : aucun clignotement.
            // Pas de <noscript> (mission #076) : voir app/layout.tsx.
            <span className="grid">
              <span aria-hidden data-account-pending className={cn(LINK, "invisible relative col-start-1 row-start-1 font-medium")}>
                {account.label}
              </span>
              <a {...WITHOUT_JS} href="/connexion" className={cn(LINK, "relative col-start-1 row-start-1 font-medium")}>
                Se connecter
              </a>
            </span>
          ) : (
            <Link href={account.href} aria-current={current(account.href)} className={cn(LINK, "relative font-medium")}>
              {account.label}
              <NavPending />
            </Link>
          )}
          <Link href={cta.href} aria-current={current(cta.href)} className={cn(CTA, "relative")}>
            {cta.label}
            <NavPending />
          </Link>
        </div>

        <div className="flex items-center gap-4 lg:hidden" onKeyDown={onMenuKeyDown} onBlur={onMenuBlur}>
          {/* Mobile sans JavaScript (mission #073) : le menu ne peut pas
              s'ouvrir, la connexion est donc offerte à côté du bouton. */}
          {unknown ? (
            <a {...WITHOUT_JS} href="/connexion" className={cn(LINK, "flex min-h-11 items-center text-sm font-medium")}>
              Se connecter
            </a>
          ) : null}
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
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
              {[...main, ...(unknown ? [] : [account])].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current(item.href)}
                  onClick={() => onItemClick(item.href)}
                  className={cn(LINK, "relative flex min-h-11 items-center border-b text-base font-medium", TONE[tone].row)}
                >
                  {item.label}
                  <NavPending />
                </Link>
              ))}
              <Link
                href={cta.href}
                aria-current={current(cta.href)}
                onClick={() => onItemClick(cta.href)}
                className={cn(CTA, "relative flex min-h-11 items-center text-base")}
              >
                {cta.label}
                <NavPending />
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
