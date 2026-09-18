import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction } from "@/lib/fixtures/preview-states";

// Mission #065, partie B — le sélecteur dit ce qu'il fait : l'analyse garde
// son niveau de calcul, le choix vaut pour les analyses suivantes.

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll(" ", " ");

describe("phrase sous le sélecteur de niveau", () => {
  it("invite à essayer et dit que le choix vaut pour la suite", () => {
    const analysis = composeAnalysis(baseExtraction(), { tier: "experienced" });
    const html = renderToStaticMarkup(<AnalysisResult analysis={analysis} unlockHref="/connexion" />);
    expect(text(html)).toContain(
      "Change de niveau pour voir ce que ça donne. Ton choix s'appliquera à tes prochaines analyses.",
    );
  });

  it("la page s'ouvre sur ce même niveau (option c : rien n'a changé à l'ouverture)", () => {
    const analysis = composeAnalysis(baseExtraction(), { tier: "experienced" });
    const html = renderToStaticMarkup(<AnalysisResult analysis={analysis} unlockHref="/connexion" />);
    const input = html.match(/<input[^>]*value="experienced"[^>]*\/>/)?.[0] ?? "";
    expect(input).toContain('checked=""');
    expect(html.match(/<input[^>]*name="niveau"[^>]*\/>/g)?.filter((tag) => tag.includes('checked=""'))).toHaveLength(1);
  });
});
