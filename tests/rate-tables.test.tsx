import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import fr20262 from "@/lib/rates/fr-2026.2.json";
import fr20263 from "@/lib/rates/fr-2026.3.json";

// Mission #085 — une analyse, et tout son fil de négociation, se calculent avec
// la table qui a servi à l'analyse d'origine. On simule ici le jour où la table
// est corrigée : la table actuelle devient une « fr-2026.4 » aux tarifs
// doublés, APRÈS l'analyse. Rien de ce qui a été fait en fr-2026.3 ne doit
// bouger.

const tables = vi.hoisted(() => ({ current: null as unknown }));
const FR4 = { ...fr20263, version: "fr-2026.4", base_rates_eur: { ...fr20263.base_rates_eur, starter: { low: 200, high: 360, confidence: "medium" }, confirmed: { low: 500, high: 1000, confidence: "medium" }, experienced: { low: 1000, high: 1600, confidence: "low" } } };

vi.mock("@/lib/rates/tables", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rates/tables")>();
  return {
    ...real,
    get CURRENT_RATE_TABLE() {
      return tables.current ?? real.CURRENT_RATE_TABLE;
    },
    rateTable: (version: string) => (version === FR4.version && tables.current === FR4 ? FR4 : real.rateTable(version)),
  };
});

const { composeAnalysis } = await import("@/lib/analysis/compose");
const { engineParts } = await import("@/lib/analysis/engine-parts");
const { recomputeForDeal, recomputeForTier, tierChangeAvailable } = await import("@/lib/analysis/recompute");
const { rateTable } = await import("@/lib/rates/tables");
const { processTurn } = await import("@/lib/negotiation/turn");
const { loadScenarios, readingOf, scenarioContext } = await import("@/lib/negotiation/scenarios");
const { AnalysisResult } = await import("@/components/result/analysis-result");
const { TurnCard } = await import("@/components/result/negotiation/turn-card");
const sample = (await import("@/lib/fixtures/sample-extraction.json")).default;

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\s  ]+/g, " ");
const scenario = (suffix: string) => loadScenarios().find((s) => s.id.endsWith(suffix))!;

function withCurrent<T>(table: unknown, run: () => T): T {
  tables.current = table;
  try {
    return run();
  } finally {
    tables.current = null;
  }
}

describe("les tables que le moteur sait appliquer", () => {
  it("fr-2026.2 : tarifs, multiplicateurs, plafonds et seuils identiques à fr-2026.3 ; seuls la version et le niveau par défaut diffèrent", () => {
    const strip = (table: typeof fr20263) => {
      const { version, base_rates_eur: base, ...rest } = table;
      const { default_tier, ...rates } = base;
      expect([version, default_tier]).toHaveLength(2);
      return { ...rest, base_rates_eur: rates };
    };
    expect(strip(fr20262 as typeof fr20263)).toEqual(strip(fr20263));
    expect(fr20262.base_rates_eur.default_tier).toBe("confirmed");
  });

  it("fr-2026.1 n'existe plus dans le code : aucune table ne lui est substituée", () => {
    expect(rateTable("fr-2026.1")).toBeNull();
    expect(rateTable("fr-2026.3")?.version).toBe("fr-2026.3");
    expect(rateTable("fr-2026.2")?.version).toBe("fr-2026.2");
  });
});

describe("A, B — une analyse fr-2026.3 reste en fr-2026.3 quand la table actuelle change", () => {
  const stored = composeAnalysis(sample as never, { tier: "confirmed" });
  const atStarter = composeAnalysis(sample as never, { tier: "starter" });

  it("la table actuelle a bien changé (le test simule quelque chose)", () => {
    const fresh = withCurrent(FR4, () => composeAnalysis(sample as never, { tier: "confirmed" }));
    expect(fresh.estimate.rate_table_version).toBe("fr-2026.4");
    expect(fresh.estimate.total_low).not.toBe(stored.estimate.total_low);
  });

  it("changement de niveau : chiffres et version de fr-2026.3", () => {
    const recomputed = withCurrent(FR4, () => recomputeForTier(stored, "starter"));
    expect(recomputed.estimate).toEqual(atStarter.estimate);
    expect(recomputed.estimate.rate_table_version).toBe("fr-2026.3");
    expect(recomputed.score).toEqual(atStarter.score);
  });

  it("termes actuels après un tour : chiffres et version de fr-2026.3", () => {
    const deal = { ...stored.deal, usage: { ...stored.deal.usage, duration_months: 12 } };
    const expected = engineParts(deal, stored.evaluability, "confirmed", [], rateTable("fr-2026.3")!);
    const recomputed = withCurrent(FR4, () => recomputeForDeal(stored, deal))!;
    expect(recomputed.estimate.rate_table_version).toBe("fr-2026.3");
    expect(recomputed.estimate.total_low).toBe(expected.estimate.total_low);
    expect(recomputed.estimate.total_high).toBe(expected.estimate.total_high);
  });

  it("D — un tour : avant et après chiffrés en fr-2026.3, comme l'analyse", () => {
    const s = scenario("termes-a-la-hausse");
    const context = scenarioContext(s);
    const before = processTurn(context, readingOf(s, context.original));
    const after = withCurrent(FR4, () => processTurn(context, readingOf(s, context.original)));
    if (before.kind !== "turn" || after.kind !== "turn") throw new Error("pas un tour");
    expect(after.payload.pricing_before.rate_table_version).toBe("fr-2026.3");
    expect(after.payload.pricing_after?.rate_table_version).toBe("fr-2026.3");
    expect(after.payload).toEqual(before.payload);
  });

  it("D — deuxième tour, termes déjà changés : toujours fr-2026.3", () => {
    const first = scenario("termes-a-la-hausse");
    const second = scenario("termes-a-la-baisse");
    const context = scenarioContext(first);
    const turn2 = processTurn(context, readingOf(first, context.original));
    if (turn2.kind !== "turn") throw new Error("pas un tour");
    const next = { ...context, previous: [turn2.payload], turnNumber: 3, brandReply: second.reponse_marque };
    const turn3 = withCurrent(FR4, () => processTurn(next, readingOf(second, context.original)));
    if (turn3.kind !== "turn") throw new Error("pas un tour");
    expect(turn3.payload.pricing_before.rate_table_version).toBe("fr-2026.3");
    expect(turn3.payload.pricing_after?.rate_table_version).toBe("fr-2026.3");
    expect(turn3.payload.pricing_before.total_low).toBe(turn2.payload.pricing_after?.total_low);
  });
});

describe("C — une table disparue du code : rien n'est recalculé, et l'écran le dit", () => {
  const s = scenario("termes-a-la-hausse");
  const context = scenarioContext(s);
  const gone = { ...context.original, estimate: { ...context.original.estimate, rate_table_version: "fr-2026.1" } };
  const goneContext = { ...context, original: gone };

  it("ni niveau, ni termes actuels", () => {
    expect(tierChangeAvailable(gone)).toBe(false);
    expect(recomputeForTier(gone, "starter")).toBe(gone);
    expect(recomputeForDeal(gone, gone.deal)).toBeNull();
  });

  it("un tour qui change les termes : aucun chiffre, et le message n'en cite aucun", () => {
    const result = processTurn(goneContext, readingOf(s, gone));
    if (result.kind !== "turn") throw new Error("pas un tour");
    expect(result.payload.pricing_unavailable).toBe(true);
    expect(result.payload.pricing_after).toBeNull();
    expect(result.payload.message.text).not.toMatch(/\d\s?€/);
    const card = text(renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={null} payload={result.payload} />));
    expect(card).toContain("la table de tarifs fr-2026.1 de cette analyse n'existe plus dans l'outil");
    expect(card).not.toContain("Fourchette inchangée");
  });

  it("un tour sans changement : les chiffres enregistrés de l'analyse, avec sa version", () => {
    const vague = scenario("reponse-vague");
    const result = processTurn(goneContext, readingOf(vague, gone));
    if (result.kind !== "turn") throw new Error("pas un tour");
    expect(result.payload.pricing_unavailable).toBe(false);
    expect(result.payload.pricing_before.rate_table_version).toBe("fr-2026.1");
    expect(result.payload.pricing_before.total_low).toBe(gone.estimate.total_low);
  });

  it("la page : chiffres enregistrés, version enregistrée, et une phrase qui le dit ; le deal suit les termes actuels", () => {
    const result = processTurn(goneContext, readingOf(s, gone));
    if (result.kind !== "turn") throw new Error("pas un tour");
    const html = text(
      renderToStaticMarkup(<AnalysisResult analysis={gone} unlockHref="/connexion" negotiated={{ deal: result.payload.deal_after, turn: 2 }} />),
    );
    expect(html).toContain("La table fr-2026.1 n'existe plus dans l'outil. Ces chiffres sont ceux calculés le jour de l'analyse");
    expect(html).toContain("Table de tarifs fr-2026.1");
    expect(html).not.toContain("fr-2026.3");
    expect(html).toContain("Le score et la fourchette, eux, restent ceux de l'offre d'origine");
    expect(html).not.toContain("Score, fourchette et deal sont à jour");
    expect(html).toContain("12 mois");
  });
});
