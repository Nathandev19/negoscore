import { describe, expect, it } from "vitest";
import { navItems, shouldCloseMenuOnBlur } from "@/components/header-nav";

// WebKit tactile peut retirer le focus du premier lien sans en donner un autre
// (relatedTarget === null) avant d'envoyer le click du tap. Si le blur ferme le
// panneau à ce moment-là, la cible disparaît et le click n'est jamais reçu.
function destinationApresTap(href: string, next: EventTarget | null): string | null {
  let menuOpen = true;
  const menu = { contains: () => false };

  if (shouldCloseMenuOnBlur(menu, next)) menuOpen = false;

  // Un navigateur ne peut envoyer le click qu'à une cible encore présente.
  return menuOpen ? href : null;
}

describe("navigation mobile au toucher", () => {
  it("laisse chaque lien naviguer quand WebKit produit un blur sans relatedTarget", () => {
    for (const state of [
      navItems(false, false),
      navItems(true, false),
      navItems(true, true),
    ]) {
      for (const item of [...state.main, state.account, state.cta]) {
        expect(destinationApresTap(item.href, null), item.label).toBe(item.href);
      }
    }
  });

  it("conserve la fermeture au clavier quand le focus quitte réellement le menu", () => {
    const outside = new EventTarget();
    expect(shouldCloseMenuOnBlur({ contains: () => false }, outside)).toBe(true);
    expect(shouldCloseMenuOnBlur({ contains: () => true }, outside)).toBe(false);
  });
});
