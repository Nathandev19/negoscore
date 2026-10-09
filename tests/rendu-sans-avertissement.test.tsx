import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { ScoreBand } from "@/components/result/score-band";
import { loadScenarios, runScenario } from "@/lib/negotiation/scenarios";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import type { TurnPayload } from "@/lib/negotiation/types";

// Mission #159, point 2 — AUCUN AVERTISSEMENT REACT AU RENDU DU RÉSULTAT.
//
// La cause a été corrigée en #127 : les éléments passés en PROPRIÉTÉ à
// AnalysisResult — `above`, `before`, `beforeUnlock`, `afterMessage` — n'avaient
// pas de clé, et React en signalait l'absence à chaque chargement en
// développement. Ce qui manquait depuis, c'est la GARDE : le test de #127
// cherche trois chaînes dans le source d'UNE page. Il ne voit donc ni une
// quatrième propriété ajoutée demain, ni une liste sans clé à l'intérieur d'un
// bloc, ni aucun autre avertissement de React.
//
// Ici, on REND, et on échoue sur le moindre console.error ou console.warn.
// Pas d'index de tableau comme clé nulle part : un index ne survit pas à un
// réordonnancement, et la liste des points à négocier est justement triée par
// priorité (components/result/analysis-blocks.tsx).
//
// Ce que cette garde couvre : les dix états de la page de résultat, nus puis
// avec enfants et fil de négociation, et les vingt tours des scénarios réels.

const scenarios = loadScenarios();
const TOURS: Array<{ turnNumber: number; createdAt: string; brandReply: string; payload: TurnPayload }> = scenarios
  .map((scenario, index) => ({ index, result: runScenario(scenario).result }))
  .filter((entry): entry is { index: number; result: { kind: "turn"; payload: TurnPayload } } => entry.result.kind === "turn")
  .map(({ index, result }) => ({
    turnNumber: index + 2,
    createdAt: "2026-09-19T10:00:00.000Z",
    brandReply: "Réponse de la marque.",
    payload: result.payload,
  }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/analyse/resultat/x",
}));

const { NegotiationThread } = await import("@/components/result/negotiation/negotiation-thread");
const { VerdictCardShare } = await import("@/components/result/verdict-card-share");
const { default: PageExemple } = await import("@/app/analyse/demo/page");

// Tout ce que React écrit sur la console pendant un rendu. React n'émet pas
// d'exception pour une clé manquante : il appelle console.error. Sans cette
// capture, le test passerait en affichant l'avertissement.
let bruit: string[] = [];
const vraiError = console.error;
const vraiWarn = console.warn;

beforeEach(() => {
  bruit = [];
  const capter = (...args: unknown[]) => bruit.push(args.map((a) => String(a)).join(" "));
  console.error = capter;
  console.warn = capter;
});

afterEach(() => {
  console.error = vraiError;
  console.warn = vraiWarn;
});

describe("la page de résultat se rend sans un seul avertissement React", () => {
  it("le relevé des tours de scénario n'est pas vide : la garde a de la matière", () => {
    expect(TOURS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(PREVIEW_STATES)("état « %s », seul puis avec enfants et fil de négociation", (etat) => {
    const { analysis } = previewAnalysis(etat);
    renderToStaticMarkup(<AnalysisResult analysis={analysis} unlockHref="/connexion" />);
    renderToStaticMarkup(
      <AnalysisResult
        analysis={analysis}
        unlockHref="/connexion"
        afterMessage={
          <NegotiationThread
            key="echange"
            analysisId="11111111-1111-4111-8111-111111111111"
            turns={TOURS}
            conclusion={null}
            access="open"
          />
        }
      >
        {/* Mission #165 — la carte de verdict est un enfant de la page de
            résultat : elle entre dans le même harnais. Rendue ici sans
            cliquer, donc à l'état « Voir ma carte » — aucune requête ne part
            au rendu, c'est justement ce qu'on veut vérifier. */}
        <VerdictCardShare />
        <p>Un enfant quelconque.</p>
      </AnalysisResult>,
    );
    expect(bruit).toEqual([]);
  });

  // Mission #172, point 2 — L'ANIMATION DU SCORE N'EST PAS UN ANGLE MORT.
  //
  // Le rejeu (changement de niveau) remonte la jauge et le chiffre depuis
  // une valeur de départ : c'est le seul chemin où ScoreBand reçoit `from`,
  // et il remonte un composant entier par sa clé. Un avertissement y
  // passerait inaperçu — la page est déjà affichée quand il sort.
  it.each(PREVIEW_STATES)("état « %s », pendant l'animation du score et au rejeu", (etat) => {
    const { analysis } = previewAnalysis(etat);
    const valeur = analysis.score?.value ?? null;
    for (const depart of [null, 0, valeur]) {
      renderToStaticMarkup(<ScoreBand analysis={analysis} from={depart} />);
      renderToStaticMarkup(<ScoreBand analysis={analysis} from={depart} animated={false} />);
    }
    expect(bruit).toEqual([]);
  });

  it("la page d'exemple, qui passe trois éléments en propriété", () => {
    renderToStaticMarkup(PageExemple());
    expect(bruit).toEqual([]);
  });

  // Mutation-test de la garde elle-même : si la capture cessait de fonctionner,
  // les assertions ci-dessus passeraient sans rien vérifier.
  it("la capture attrape bien ce que React écrirait", () => {
    console.error("Each child in a list should have a unique %s prop.", "key");
    expect(bruit).toHaveLength(1);
    expect(bruit[0]).toContain("unique");
    bruit = [];
  });

  // L'index d'un tableau comme clé est interdit là où l'ordre peut changer :
  // les points à négocier sont triés par priorité avant rendu.
  it("aucune clé prise sur l'index du tableau dans les blocs de résultat", async () => {
    const { readFileSync } = await import("node:fs");
    for (const fichier of [
      "components/result/analysis-blocks.tsx",
      "components/result/analysis-result.tsx",
      "components/result/negotiation/turn-card.tsx",
    ]) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).not.toMatch(/key=\{\s*index\s*\}/);
      expect(source, fichier).not.toMatch(/key=\{\s*i\s*\}/);
    }
  });
});
