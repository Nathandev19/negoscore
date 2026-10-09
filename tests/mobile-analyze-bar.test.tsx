import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WaitingScreen } from "@/components/loading-steps";
import { MOBILE_ANALYZE_HREF, PAGES, showMobileAnalyzeBar } from "@/components/mobile-analyze-bar";
import { GUIDE_PATHS } from "@/lib/analytics/views";

describe("le bouton mobile d'analyse", () => {
  it("apparaît quand l'appel à l'action de la page est sous l'écran", () => {
    expect(showMobileAnalyzeBar("/analyse/demo", [{ top: 578, bottom: 626 }], 460, [{ top: -500, bottom: 40 }])).toBe(true);
    expect(showMobileAnalyzeBar("/", [{ top: 571, bottom: 619 }], 560)).toBe(true);
  });

  it("reste masqué à 320 × 460 tant que le bloc de score est visible", () => {
    expect(showMobileAnalyzeBar("/analyse/demo", [{ top: 578, bottom: 626 }], 460, [{ top: 340, bottom: 558 }])).toBe(false);
    expect(showMobileAnalyzeBar("/analyse/demo", [{ top: -100, bottom: 40 }], 460, [{ top: -160, bottom: 80 }])).toBe(false);
  });

  it("disparaît dès que l'appel à l'action entre dans l'écran", () => {
    expect(showMobileAnalyzeBar("/analyse/demo", [{ top: 489, bottom: 537 }], 560)).toBe(false);
    expect(showMobileAnalyzeBar("/analyse/demo", [{ top: 450, bottom: 498 }], 460)).toBe(false);
  });

  it("revient quand l'appel à l'action sort par le haut", () => {
    expect(showMobileAnalyzeBar("/analyse/demo", [{ top: 0, bottom: 48 }], 560)).toBe(true);
  });

  // Mission #172, point 3 — RAPPORTÉ SUR IPHONE, SAFARI, NAVIGATION PRIVÉE.
  //
  // Pendant « On analyse ton offre », la barre proposait de lancer ce qui
  // tournait déjà. La cause est à l'envers de ce qu'on croirait : l'écran
  // d'attente REMPLACE le formulaire, donc le bouton d'envoi que la barre
  // surveillait disparaît — et la barre, qui se cachait justement parce
  // qu'un bouton d'analyse était à l'écran, se montrait.
  it("une analyse en cours masque la barre, quel que soit le défilement", () => {
    // Aucun bouton d'analyse visible (le formulaire a laissé la place à
    // l'écran d'attente) : sans la garde, la barre s'afficherait.
    expect(showMobileAnalyzeBar("/", [], 560)).toBe(true);
    expect(showMobileAnalyzeBar("/", [], 560, [], true)).toBe(false);
    // Et le défilement n'y change rien : une analyse tourne ou ne tourne pas.
    expect(showMobileAnalyzeBar("/", [{ top: 0, bottom: 48 }], 560, [], true)).toBe(false);
    expect(showMobileAnalyzeBar("/analyse/demo", [], 460, [], true)).toBe(false);
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
      expect(showMobileAnalyzeBar(chemin, [], 560), chemin).toBe(true);
    }
    expect(GUIDE_PATHS.length).toBeGreaterThanOrEqual(5);
  });

  it("respecte chaque page prévue et exclut l'analyse et les pages privées", () => {
    for (const path of ["/", "/exemple", "/tarifs", "/combien-facturer", "/droits-utilisation", "/produits-offerts"]) {
      expect(showMobileAnalyzeBar(path, [], 560), path).toBe(true);
    }
    for (const path of ["/analyse", "/admin", "/compte", "/compte/supprime", "/historique", "/connexion", "/mentions-legales", "/confidentialite", "/cgv"]) {
      expect(showMobileAnalyzeBar(path, [], 560), path).toBe(false);
    }
  });

  it("porte une origine interne et aucun paramètre d'acquisition", () => {
    const url = new URL(MOBILE_ANALYZE_HREF, "https://www.negoscore.fr");
    expect(url.pathname).toBe("/analyse");
    expect(url.searchParams.get("de")).toBe("bouton-mobile");
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) expect(url.searchParams.has(name)).toBe(false);
  });
});
