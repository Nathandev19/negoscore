import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import sample from "@/lib/fixtures/analysis-sample.json";
import { extractionSchema, PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import { formatEur } from "@/lib/money";

// Sortie de modèle simulée, construite à partir de la fixture d'exemple.
function makeExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return extractionSchema.parse({
    ...sample,
    negotiate: [
      { label: "Facturer les droits pub", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" },
      { label: "Limiter les révisions", why: "Sinon ça ne s'arrête pas.", priority: 2, topic: "revisions" },
    ],
    counter_offer: { changes: ["Droits pub facturés à part"] },
    ready_to_send_message: { tone: "cordial", text: `Mon tarif pour ce projet : ${PRICE_PLACEHOLDER}.` },
    ...overrides,
  });
}

describe("composeAnalysis", () => {
  it("calcule chiffrage, score, couche légale et contre-offre côté code", () => {
    const analysis = composeAnalysis(makeExtraction());
    expect(analysis.estimate.total_low).not.toBeNull();
    expect(analysis.counter_offer.amount_low).toBe(analysis.estimate.total_low);
    expect(analysis.counter_offer.amount_high).toBe(analysis.estimate.total_high);
    expect(analysis.ready_to_send_message.text).not.toContain(PRICE_PLACEHOLDER);
    expect(analysis.ready_to_send_message.text).toMatch(/entre .+€ et .+€/);

    const paidAds = analysis.negotiate.find((n) => n.label === "Facturer les droits pub");
    const paidAdsLine = analysis.estimate.lines.find((l) => l.label.startsWith("Droits pub"));
    expect(paidAds?.eur_impact_low).toBe(paidAdsLine?.eur_low);
    expect(analysis.negotiate.find((n) => n.label === "Limiter les révisions")?.eur_impact_low).toBeNull();
  });

  it("sans montant proposé : confiance faible et total null", () => {
    const base = makeExtraction();
    const analysis = composeAnalysis(
      makeExtraction({
        confidence: "high",
        deal: { ...base.deal, payment: { ...base.deal.payment, amount_eur: null } },
        ready_to_send_message: { tone: "cordial", text: "Quel budget avez-vous prévu ?" },
      }),
    );
    expect(analysis.confidence).toBe("low");
    expect(analysis.estimate.total_low).toBeNull();
    expect(analysis.counter_offer.amount_low).toBeNull();
    expect(analysis.fr_legal.threshold_1000_reached).toBe("unknown");
  });

  it("fusionne les points qui portent sur le même sujet, en gardant le chiffrage", () => {
    const analysis = composeAnalysis(
      makeExtraction({
        negotiate: [
          { label: "Clarifier les droits publicitaires", why: "Trop large.", priority: 2, topic: "paid_ads" },
          { label: "Encadrer les droits publicitaires", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" },
          { label: "Limiter les révisions", why: "Sinon ça ne s'arrête pas.", priority: 3, topic: "revisions" },
        ],
      }),
    );
    expect(analysis.negotiate.map((n) => n.label)).toEqual([
      "Encadrer les droits publicitaires",
      "Limiter les révisions",
    ]);
    expect(analysis.negotiate[0].why).toBe("Ils ont de la valeur. Trop large.");
    expect(analysis.negotiate[0].eur_impact_low).not.toBeNull();
    expect(analysis.negotiate.map((n) => n.priority)).toEqual([1, 2]);
  });

  it("ne répète pas une explication déjà dite, et ne fusionne pas le sujet « other »", () => {
    const analysis = composeAnalysis(
      makeExtraction({
        negotiate: [
          { label: "Droits pub", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" },
          { label: "Droits pub, encore", why: "Ils ont de la valeur", priority: 2, topic: "paid_ads" },
          { label: "Demander le brief", why: "Il manque.", priority: 3, topic: "other" },
          { label: "Demander le calendrier", why: "Il manque aussi.", priority: 4, topic: "other" },
        ],
      }),
    );
    expect(analysis.negotiate).toHaveLength(3);
    expect(analysis.negotiate[0].why).toBe("Ils ont de la valeur.");
    expect(analysis.negotiate.map((n) => n.label)).toEqual(["Droits pub", "Demander le brief", "Demander le calendrier"]);
  });

  it("écrit la fourchette du message avec le formateur unique", () => {
    const analysis = composeAnalysis(makeExtraction());
    const { total_low: low, total_high: high } = analysis.estimate;
    expect(analysis.ready_to_send_message.text).toContain(`entre ${formatEur(low!)} et ${formatEur(high!)}`);
  });

  it("sépare les milliers dans le message, sur une offre à quatre chiffres", () => {
    const base = makeExtraction();
    const analysis = composeAnalysis(
      makeExtraction({
        deal: {
          ...base.deal,
          deliverables: [{ type: "video", platform: "tiktok", quantity: 4, format: null }],
          usage: { ...base.deal.usage, paid_ads: true, duration_months: 12, territory: "monde entier" },
          payment: { ...base.deal.payment, amount_eur: 1500 },
        },
      }),
    );
    const { total_low: low, total_high: high } = analysis.estimate;
    expect(low).toBeGreaterThan(999);
    const text = analysis.ready_to_send_message.text;
    expect(text).toContain(`entre ${formatEur(low!)} et ${formatEur(high!)}`);
    // Aucun montant collé : « 1260 » ne doit jamais apparaître tel quel.
    expect(text).not.toMatch(/\d{4}/);
  });

  it("estimation plus de trois fois au-dessus de l'offre : confiance high ramenée à medium, fourchette intacte", () => {
    const base = makeExtraction();
    const cheap = makeExtraction({
      confidence: "high",
      deal: { ...base.deal, payment: { ...base.deal.payment, amount_eur: 10 } },
    });
    const analysis = composeAnalysis(cheap);
    const reference = composeAnalysis(makeExtraction({ confidence: "high" }));
    expect(analysis.confidence).toBe("medium");
    expect(analysis.estimate.total_low).toBe(reference.estimate.total_low);
    expect(analysis.estimate.assumptions.some((a) => a.includes("trois fois"))).toBe(true);
    expect(composeAnalysis(makeExtraction({ confidence: "low", deal: cheap.deal })).confidence).toBe("low");
  });

  it("ajoute les hypothèses fournies par la route", () => {
    const analysis = composeAnalysis(makeExtraction(), { extraAssumptions: ["Texte tronqué."] });
    expect(analysis.estimate.assumptions[0]).toBe("Texte tronqué.");
  });
});
