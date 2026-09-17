import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { lockAnalysis } from "@/lib/analysis/lock";
import { dealRecapRows, deliverablesLine, formatNumber, formatPercent } from "@/lib/display";
import { evalAnalyses } from "@/lib/fixtures/eval-analyses";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import { composeAnalysis } from "@/lib/analysis/compose";
import { formatFileSize } from "@/lib/upload";

// Mission #034 : tout nombre affiché est au format français (virgule décimale,
// espace insécable avant %, séparateur de milliers), et le détail du chiffrage
// n'affiche plus de pourcentage.

// Texte visible d'un rendu : balises et attributs retirés (les styles en ligne
// contiennent des nombres CSS comme « 62.5% » qui ne sont pas affichés).
// L'identifiant de la table de tarifs (« fr-2026.2 ») n'est pas un nombre : retiré.
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/fr-\d{4}\.\d+/g, " ");
}

// Un point entre deux chiffres : un décimal à l'anglaise.
const DECIMAL_POINT = /\d\.\d/;

// Deal volontairement décimal : durées et délai non entiers, comme un modèle
// peut en extraire (« six semaines » → 1,5 mois).
function decimalAnalysis() {
  const extraction = baseExtraction();
  return composeAnalysis({
    ...extraction,
    deal: {
      ...extraction.deal,
      usage: { ...extraction.deal.usage, duration_months: 2.5 },
      exclusivity: { ...extraction.deal.exclusivity, duration_months: 1.5 },
      revisions: { count: 2, unlimited: false },
      payment: { ...extraction.deal.payment, terms_days: 45 },
    },
  });
}

describe("formateur unique fr-FR", () => {
  it("virgule décimale, séparateur de milliers dès quatre chiffres, espace insécable avant %", () => {
    expect(formatNumber(63.6)).toBe("63,6");
    expect(formatNumber(1070)).toBe("1\u202f070");
    expect(formatNumber(12345.5)).toBe("12\u202f345,5");
    expect(formatNumber(3)).toBe("3");
    expect(formatPercent(45.5)).toBe("45,5\u00a0%");
  });

  it("tailles de fichier", () => {
    expect(formatFileSize(3.4 * 1024 * 1024)).toBe("3,4\u00a0Mo");
    expect(formatFileSize(512 * 1024)).toBe("512\u00a0Ko");
  });

  it("récapitulatif du deal et libellés du moteur avec des durées décimales", () => {
    const analysis = decimalAnalysis();
    const recap = dealRecapRows(analysis.deal).map((row) => row.value).join(" | ");
    expect(recap).not.toMatch(DECIMAL_POINT);
    expect(recap).toContain("2,5 mois");
    expect(recap).toContain("1,5 mois");
    const labels = analysis.estimate.lines.map((line) => line.label).join(" | ");
    expect(labels).not.toMatch(DECIMAL_POINT);
    expect(labels).toContain("Exclusivité 1,5 mois");
    expect(labels).toContain("Droits pub 2,5 mois");
    expect(deliverablesLine(analysis.deal)).not.toMatch(DECIMAL_POINT);
  });
});

describe("aucun point décimal dans une page de résultat", () => {
  const cases = [{ name: "durées décimales", analysis: decimalAnalysis() }, ...evalAnalyses()];

  it("sur toutes les analyses des fixtures, vue débloquée et verrouillée", () => {
    expect(cases.length).toBeGreaterThan(20);
    for (const { name, analysis } of cases) {
      for (const view of [analysis, lockAnalysis(analysis)]) {
        const text = visibleText(renderToStaticMarkup(createElement(AnalysisResult, { analysis: view, unlockHref: "/connexion" })));
        expect(text.match(new RegExp(`.{0,30}${DECIMAL_POINT.source}.{0,10}`))?.[0] ?? null, name).toBeNull();
      }
    }
  });

  it("le détail du chiffrage n'affiche plus de pourcentage, les données les gardent", () => {
    const analysis = decimalAnalysis();
    expect(analysis.estimate.lines.some((line) => line.type === "percent" && line.high > 0)).toBe(true);
    const html = renderToStaticMarkup(createElement(AnalysisResult, { analysis, unlockHref: "/connexion" }));
    // Le détail : du titre « Ce que ça vaut » aux hypothèses (qui, elles, citent parfois l'offre).
    const detail = html.slice(html.indexOf("Ce que ça vaut"), html.indexOf("Hypothèses"));
    expect(detail.length).toBeGreaterThan(0);
    expect(visibleText(detail)).not.toMatch(/%|\(\+/);
    for (const line of analysis.estimate.lines) expect(html).toContain(`<dt class="text-attenue">${line.label.replace(/'/g, "&#x27;")}</dt>`);
  });
});
