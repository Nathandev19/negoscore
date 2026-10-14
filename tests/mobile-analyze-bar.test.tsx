import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WaitingScreen } from "@/components/loading-steps";
import { activeMobileSection, MOBILE_ANALYZE_HREF, PAGES, showMobileAnalyzeBar } from "@/components/mobile-analyze-bar";
import { GUIDE_PATHS } from "@/lib/analytics/views";

describe("la navigation basse mobile", () => {
  it("apparaît sur l'accueil tant que le score est hors champ", () => {
    expect(showMobileAnalyzeBar("/", 560, [{ top: -500, bottom: 40 }])).toBe(true);
    expect(showMobileAnalyzeBar("/", 560)).toBe(true);
  });

  it("reste masqué à 320 × 460 tant que le bloc de score est visible", () => {
    expect(showMobileAnalyzeBar("/analyse/demo", 460, [{ top: 340, bottom: 558 }])).toBe(false);
    expect(showMobileAnalyzeBar("/analyse/demo", 460, [{ top: -160, bottom: 80 }])).toBe(false);
  });

  it("reste visible sur l'accueil et les tarifs sans garde sur les autres appels à l'action", () => {
    expect(showMobileAnalyzeBar("/", 560)).toBe(true);
    expect(showMobileAnalyzeBar("/tarifs", 460)).toBe(true);
    expect(readFileSync("components/mobile-analyze-bar.tsx", "utf8")).not.toContain("PAGE_CTA_SELECTOR");
  });

  it("revient quand le verdict sort par le haut", () => {
    expect(showMobileAnalyzeBar("/analyse/demo", 560, [{ top: -500, bottom: 48 }])).toBe(true);
  });

  it("une analyse en cours garde la navigation visible mais désactive son action", () => {
    expect(showMobileAnalyzeBar("/", 560)).toBe(true);
    const barre = readFileSync("components/mobile-analyze-bar.tsx", "utf8");
    expect(barre).toContain("aria-disabled={analysisRunning}");
    expect(barre).toContain("event.preventDefault()");
  });

  it("l'écran d'attente porte bien le repère que la barre lit", () => {
    // Les deux composants ne se connaissent pas : ils se parlent par un
    // attribut, comme la barre et le bloc de score depuis #163. Si le repère
    // changeait de nom d'un côté, ce test tomberait.
    const attente = readFileSync(path.join(process.cwd(), "components/loading-steps.tsx"), "utf8");
    const barre = readFileSync(path.join(process.cwd(), "components/mobile-analyze-bar.tsx"), "utf8");
    expect(attente).toContain("data-analysis-running");
    expect(barre).toContain('"[data-analysis-running]"');
    // Et la barre interroge le DOCUMENT entier, pas seulement <main> : l'écran
    // d'attente n'est pas forcément dans la zone surveillée.
    expect(barre).toContain("document.querySelector(RUNNING_SELECTOR)");
  });

  it("pendant l'analyse, aucun bouton ni lien ne propose d'en lancer une", () => {
    // La preuve par le rendu : l'écran d'attente, rendu seul, ne contient
    // aucun chemin vers /analyse.
    const html = renderToStaticMarkup(<WaitingScreen kind="text" respondedAt={null} />);
    expect(html).toContain("data-analysis-running");
    expect(html).not.toContain('href="/analyse');
    expect(html).not.toContain("Analyser");
    expect(html).not.toMatch(/<button/);
  });

  // Mission #172 — TOUS LES GUIDES, pas une liste recopiée à la main.
  // /droits-pub-6-mois (#158) et /exclusivite-ugc (#171) n'y étaient jamais
  // entrés : la barre n'apparaissait pas sur ces deux pages. La liste se
  // construit maintenant depuis GUIDE_PATHS, et ce test le vérifie.
  it("chaque guide est couvert par la barre, sans exception", () => {
    for (const chemin of GUIDE_PATHS) {
      expect(PAGES.has(chemin), chemin).toBe(true);
      expect(showMobileAnalyzeBar(chemin, 560), chemin).toBe(true);
    }
    expect(GUIDE_PATHS.length).toBeGreaterThanOrEqual(5);
  });

  it("respecte chaque page prévue et exclut l'analyse et les pages privées", () => {
    for (const path of ["/", "/exemple", "/tarifs", "/combien-facturer", "/droits-utilisation", "/produits-offerts"]) {
      expect(showMobileAnalyzeBar(path, 560), path).toBe(true);
    }
    for (const path of ["/analyse", "/admin", "/compte", "/compte/supprime", "/historique", "/connexion", "/mentions-legales", "/confidentialite", "/cgv"]) {
      expect(showMobileAnalyzeBar(path, 560), path).toBe(false);
    }
  });

  it("la navigation connectée couvre les pages de compte sans jamais recouvrir le verdict", () => {
    expect(showMobileAnalyzeBar("/compte", 560, [], true)).toBe(true);
    expect(showMobileAnalyzeBar("/historique", 560, [], true)).toBe(true);
    expect(showMobileAnalyzeBar("/analyse/resultat/123", 460, [{ top: 330, bottom: 510 }], true)).toBe(false);
    expect(showMobileAnalyzeBar("/analyse/resultat/123", 460, [{ top: -400, bottom: 20 }], true)).toBe(true);
  });

  it("réapparaît aussi sur un résultat déconnecté après le verdict", () => {
    expect(showMobileAnalyzeBar("/analyse/resultat/123", 774, [{ top: 143, bottom: 358 }])).toBe(false);
    expect(showMobileAnalyzeBar("/analyse/resultat/123", 774, [{ top: -800, bottom: -500 }])).toBe(true);
  });

  it("la navigation est une surface continue collée au bas, avec une réserve intérieure", () => {
    const barre = readFileSync("components/mobile-analyze-bar.tsx", "utf8");
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(barre).toContain("grid h-full w-full grid-cols-3");
    expect(barre.indexOf('href="/historique"')).toBeLessThan(barre.indexOf("href={MOBILE_ANALYZE_HREF}"));
    expect(barre.indexOf("href={MOBILE_ANALYZE_HREF}")).toBeLessThan(barre.indexOf("ref={menuButtonRef}"));
    expect(barre.split("bottom-0 z-30 h-[calc(50px+max(8px,env(safe-area-inset-bottom)))]")).toHaveLength(3);
    expect(barre.split("pb-[max(8px,env(safe-area-inset-bottom))]")).toHaveLength(3);
    expect(barre).not.toContain("gap-1");
    expect(barre).toContain("size-12 self-end items-center justify-center rounded-full bg-marque");
    expect(barre).toContain("<span>Analyser</span>");
    expect(barre).toContain('aria-label="Analyser un deal"');
    expect(layout).toContain("pb-[calc(50px+max(8px,env(safe-area-inset-bottom)))] md:pb-0");
  });

  it("les trois cellules ont une icône de même trait, une légende et un état actif", () => {
    const barre = readFileSync("components/mobile-analyze-bar.tsx", "utf8");
    expect(barre).toContain("ListIcon");
    expect(barre).toContain("MenuIcon");
    expect(barre).toContain("PlusIcon");
    expect(barre.split("strokeWidth={1.75}")).toHaveLength(4);
    expect(barre.split("grid-rows-[minmax(0,1fr)_11px]")).toHaveLength(4);
    expect(barre.split("text-[9px] font-semibold")).toHaveLength(4);
    expect(barre).toContain("<span>Négociations</span>");
    expect(activeMobileSection("/historique")).toBe("negociations");
    expect(activeMobileSection("/analyse")).toBe("analyser");
    expect(activeMobileSection("/")).toBe("menu");
    expect(activeMobileSection("/tarifs")).toBe("menu");
  });

  it("porte une origine interne et aucun paramètre d'acquisition", () => {
    const url = new URL(MOBILE_ANALYZE_HREF, "https://www.negoscore.fr");
    expect(url.pathname).toBe("/analyse");
    expect(url.searchParams.get("de")).toBe("bouton-mobile");
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) expect(url.searchParams.has(name)).toBe(false);
  });
});
