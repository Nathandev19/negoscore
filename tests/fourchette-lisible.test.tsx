import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Estimate } from "@/components/result/analysis-blocks";
import { AnalysisResult } from "@/components/result/analysis-result";
import { previewAnalysis } from "@/lib/fixtures/preview-states";
import { formatEurRange } from "@/lib/money";

const analysis = previewAnalysis("debloque").analysis;

describe("la fourchette se lit sur le résultat d'une analyse", () => {
  it("explique les deux bornes et les facteurs du cas sans clic, après le verdict", () => {
    const html = renderToStaticMarkup(<AnalysisResult analysis={analysis} unlockHref="/connexion" />);
    const explication = html.indexOf('aria-label="Comment lire la fourchette"');
    expect(html.indexOf('aria-label="Verdict"')).toBeLessThan(explication);
    expect(html.indexOf("Fourchette estimée")).toBeLessThan(explication);
    expect(explication).toBeGreaterThan(-1);
    expect(html.slice(explication)).toContain("En bas");
    expect(html.slice(explication)).toContain("En haut");
    expect(html.slice(explication)).toContain(formatEurRange(analysis.estimate.base_low, analysis.estimate.base_high));
    for (const line of analysis.estimate.lines) expect(html.slice(explication)).toContain(line.label);
    expect(html.slice(explication)).toContain("ne choisit pas un montant précis");
    expect(html.slice(explication, html.indexOf("<dl", explication))).not.toContain("<details");
  });

  it("sans supplément, n'en invente aucun ; sans total, n'explique pas une fourchette absente", () => {
    const sansSupplement = { ...analysis.estimate, lines: [] };
    const html = renderToStaticMarkup(<Estimate estimate={sansSupplement} />);
    expect(html).toContain("Aucun supplément n&#x27;est chiffré dans cette offre");
    const sansTotal = renderToStaticMarkup(<Estimate estimate={{ ...sansSupplement, total_low: null, total_high: null }} />);
    expect(sansTotal).not.toContain("Comment lire la fourchette");
  });
});
