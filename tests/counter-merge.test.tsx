import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Estimate } from "@/components/result/analysis-blocks";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { CounterOffer } from "@/components/result/unlocked-blocks";
import { counterSameAsEstimate } from "@/lib/analysis/anchoring";
import { loadScenarios, runScenario } from "@/lib/negotiation/scenarios";
import type { TurnPayload } from "@/lib/negotiation/types";

// Mission #082, D — la fourchette estimée et la contre-offre, identiques quand
// la marque propose moins que le bas de la fourchette (ou rien) : une seule
// ligne, jamais deux fois le même chiffre l'un sous l'autre.

const estimate = { total_low: 1070, total_high: 2500 };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\s  ]+/g, " ");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("contre-offre identique à la fourchette : quand et pourquoi", () => {
  it("offre sous le bas : identiques, « below »", () => {
    expect(counterSameAsEstimate(300, { amount_low: 1070, amount_high: 2500 }, estimate)).toBe("below");
  });
  it("aucun montant écrit : identiques, « no_amount »", () => {
    expect(counterSameAsEstimate(null, { amount_low: 1070, amount_high: 2500 }, estimate)).toBe("no_amount");
  });
  it("offre dans la fourchette : la contre-offre diffère", () => {
    expect(counterSameAsEstimate(1500, { amount_low: 2000, amount_high: 2500 }, estimate)).toBeNull();
  });
  it("contre-offre verrouillée ou absente : rien à fusionner", () => {
    expect(counterSameAsEstimate(300, undefined, estimate)).toBeNull();
    expect(counterSameAsEstimate(3000, { amount_low: null, amount_high: null }, estimate)).toBeNull();
  });
});

describe("page de résultat : le chiffre n'apparaît qu'une fois", () => {
  const full = { base_low: 800, base_high: 1500, lines: [], total_low: 1070, total_high: 2500, assumptions: [], rate_table_version: "fr-2026.3" };
  const offer = { amount_low: 1070, amount_high: 2500, changes: ["Exclusivité ramenée à 1 mois"] };

  it("identiques : « Fourchette estimée, et ta contre-offre », et le bloc contre-offre ne répète pas le grand chiffre", () => {
    const page = text(renderToStaticMarkup(<Estimate estimate={full} counterSame />) + renderToStaticMarkup(<CounterOffer offer={offer} sameAsEstimate="below" />));
    expect(page).toContain("Fourchette estimée, et ta contre-offre");
    expect(page).toContain("ce que la marque propose est en dessous de son bas");
    const counterHtml = renderToStaticMarkup(<CounterOffer offer={offer} sameAsEstimate="below" />);
    expect(counterHtml).not.toContain("figures text-5xl");
  });

  it("sans montant de la marque : la phrase le dit, sans prétendre qu'elle propose moins", () => {
    const page = text(renderToStaticMarkup(<CounterOffer offer={offer} sameAsEstimate="no_amount" />));
    expect(page).toContain("la marque n'a écrit aucun montant");
    expect(page).not.toContain("en dessous");
  });

  it("différentes : deux lignes, comme avant", () => {
    expect(text(renderToStaticMarkup(<Estimate estimate={full} />))).not.toContain("et ta contre-offre");
    expect(renderToStaticMarkup(<CounterOffer offer={{ ...offer, amount_low: 2000 }} />)).toContain("figures text-5xl");
  });
});

describe("tour de négociation : une seule ligne quand elles sont identiques avant et après", () => {
  const turn = (suffix: string): TurnPayload => {
    const { result } = runScenario(loadScenarios().find((s) => s.id.endsWith(suffix))!);
    if (result.kind !== "turn") throw new Error("pas un tour");
    return result.payload;
  };
  const render = (payload: TurnPayload) =>
    text(renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={null} payload={payload} />));

  it("termes à la hausse (offre toujours sous le bas) : une ligne fusionnée", () => {
    const html = render(turn("termes-a-la-hausse"));
    expect(html).toContain("Fourchette estimée, et ta contre-offre");
    expect(count(html, "Ta contre-offre")).toBe(0);
  });

  it("contre-offre différente de la fourchette : deux lignes", () => {
    const payload = turn("termes-a-la-hausse");
    const differs: TurnPayload = { ...payload, pricing_after: { ...payload.pricing_after!, counter_low: 2000 } };
    const html = render(differs);
    expect(html).toContain("Fourchette estimée");
    expect(html).toContain("Ta contre-offre");
    expect(html).not.toContain("Fourchette estimée, et ta contre-offre");
  });
});
