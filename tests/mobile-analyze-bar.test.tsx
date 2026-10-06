import { describe, expect, it } from "vitest";
import { MOBILE_ANALYZE_HREF, showMobileAnalyzeBar } from "@/components/mobile-analyze-bar";

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
