import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { pricePhrase } from "@/lib/analysis/engine-parts";
import { WRITTEN_CONTRACT_THRESHOLD_EUR } from "@/lib/legal/fr";
import { messageProblems } from "@/lib/negotiation/message";
import { originPricing } from "@/lib/negotiation/pricing";
import { loadScenarios, runScenario, type Scenario } from "@/lib/negotiation/scenarios";
import { OFF_TOPIC_MESSAGE, type Pricing, type TurnPayload } from "@/lib/negotiation/types";

// Mission #080, F8 — chaque scénario de réponse de marque produit une sortie
// sensée. Le CODE tourne sur la sortie du modèle enregistrée dans le scénario
// (inventée aujourd'hui) : aucun appel au modèle. Ajouter un scénario = ajouter
// un fichier dans lib/negotiation/scenarios/ ; il est pris automatiquement.

const scenarios = loadScenarios();

// Montants affichés en euros dans un rendu HTML, HORS citations de la marque
// (<q>, <blockquote>) : ce que la marque a écrit est montré tel quel, ce n'est
// pas un chiffre du produit.
export function displayedAmounts(html: string): number[] {
  const text = html
    .replace(/<q\b[\s\S]*?<\/q>/g, " ")
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/g, " ")
    .replace(/<textarea\b[\s\S]*?<\/textarea>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return [...text.matchAll(/(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:,\d+)?\s?€/g)].map((m) => Number(m[1].replace(/[\s  ]/g, "")));
}

// Tout montant que le produit a le droit d'afficher pour ce tour : sorties du
// moteur (fourchettes, contre-offres, écarts entre elles), montants LUS dans
// les termes (proposé par la marque, valeur des produits) avec leurs écarts,
// et le seuil légal du contrat écrit. Rien d'autre.
export function allowedAmounts(payload: TurnPayload): Set<number> {
  const pricing = [payload.pricing_before, ...(payload.pricing_after ? [payload.pricing_after] : [])];
  const engine = pricing.flatMap((p: Pricing) => [p.total_low, p.total_high, p.counter_low, p.counter_high]);
  const read = [payload.deal_before, payload.deal_after].flatMap((deal) => [deal.payment.amount_eur, deal.in_kind_value_eur]);
  const values = [...engine, ...read].filter((v): v is number => v !== null);
  const allowed = new Set(values);
  const current = payload.pricing_after ?? payload.pricing_before;
  if (payload.pricing_after) {
    const b = payload.pricing_before;
    const a = payload.pricing_after;
    for (const [x, y] of [[a.total_low, b.total_low], [a.total_high, b.total_high], [a.counter_low, b.counter_low], [a.counter_high, b.counter_high]]) {
      if (x !== null && y !== null) allowed.add(Math.abs(x - y));
    }
  }
  for (const value of read.filter((v): v is number => v !== null)) {
    if (current.total_low !== null) allowed.add(Math.abs(value - current.total_low));
  }
  allowed.add(0);
  // Seuil légal du contrat écrit (C4) : constante de lib/legal/fr.ts.
  allowed.add(WRITTEN_CONTRACT_THRESHOLD_EUR);
  return allowed;
}

function turnOf(scenario: Scenario) {
  const { context, result } = runScenario(scenario);
  if (result.kind !== "turn") throw new Error(`${scenario.id} : pas un tour`);
  return { context, payload: result.payload };
}

describe("F8 — les scénarios couvrent les cas demandés", () => {
  it("au moins les huit cas de la mission, chacun dans son fichier", () => {
    const ids = scenarios.map((s) => s.id);
    for (const required of [
      "acceptation-franche",
      "acceptation-partielle",
      "termes-a-la-hausse",
      "termes-a-la-baisse",
      "refus-net",
      "reponse-vague",
      "question-a-la-creatrice",
      "hors-sujet",
    ]) {
      expect(ids.some((id) => id.endsWith(required)), required).toBe(true);
    }
    // Chaque scénario dit s'il est inventé ou réel : le remplacement se voit.
    for (const scenario of scenarios) expect(["inventé", "réel"]).toContain(scenario.source);
  });
});

describe.each(scenarios.map((s) => [s.id, s] as const))("scénario %s", (_id, scenario) => {
  const { attendu } = scenario;

  if (attendu.type === "hors_sujet") {
    it("B3 — dit que ce n'est pas une réponse, n'invente rien", () => {
      const { result } = runScenario(scenario);
      expect(result.kind).toBe("off_topic");
      if (result.kind === "off_topic") expect(OFF_TOPIC_MESSAGE[result.relevance]).toContain("Rien n'a été décompté");
    });
    return;
  }

  it("issue, demandes et termes attendus", () => {
    const { payload } = turnOf(scenario);
    if (attendu.issue) expect(payload.outcome).toBe(attendu.issue);
    for (const [id, status] of Object.entries(attendu.demandes ?? {})) {
      expect(payload.asks.find((ask) => ask.id === id)?.status, id).toBe(status);
    }
    if (attendu.termes_changes) expect(payload.changes.map((c) => c.group).sort()).toEqual([...attendu.termes_changes].sort());
    if (attendu.conclusion !== undefined) expect(payload.conclusion !== null).toBe(attendu.conclusion);
    if (attendu.message_de_repli !== undefined) expect(payload.message.fallback).toBe(attendu.message_de_repli);
    if (attendu.doutes) expect(payload.uncertainties.length).toBeGreaterThan(0);
  });

  it("B2 — sans changement de termes, la fourchette est celle de l'analyse d'origine ; avec, ancien et nouveau côte à côte", () => {
    const { context, payload } = turnOf(scenario);
    expect(payload.pricing_before).toEqual(originPricing(context.original, context.tier));
    if (attendu.nouveau_chiffrage) {
      expect(payload.pricing_after).not.toBeNull();
    } else {
      expect(payload.pricing_after).toBeNull();
      expect(payload.deal_after).toEqual(payload.deal_before);
    }
  });

  it("F4 — tout ce qui est prêté à la marque est cité mot pour mot", () => {
    const { payload } = turnOf(scenario);
    const reply = scenario.reponse_marque.toLowerCase();
    for (const quote of [...payload.asks.filter((a) => a.turn === 2).map((a) => a.quote), ...payload.changes.map((c) => c.quote), ...payload.brand_questions.map((q) => q.quote)]) {
      expect(reply).toContain(String(quote).toLowerCase());
    }
  });

  it("F3, F5 — le message final : aucun montant hors moteur, aucune échéance, aucun ton sec, aucune citation inventée", () => {
    const { context, payload } = turnOf(scenario);
    const current = payload.pricing_after ?? payload.pricing_before;
    const enginePhrase = pricePhrase(context.original.language, { low: current.counter_low, high: current.counter_high });
    const text = payload.message.text.replace(enginePhrase, " ");
    if (payload.conclusion) {
      // Conclusion : les seuls montants sont ceux des termes lus ou du moteur.
      for (const amount of displayedAmounts(text)) expect(allowedAmounts(payload).has(amount), String(amount)).toBe(true);
      expect(payload.message.text).toMatch(/par écrit/);
    } else {
      expect(messageProblems(text, payload.deal_after, scenario.reponse_marque, payload.asks.map((a) => a.label))).toEqual([]);
      // Contrôle indépendant de message.ts : aucun montant en euros hors de la
      // contre-offre du moteur, déjà retirée du texte ci-dessus.
      expect(displayedAmounts(text)).toEqual([]);
    }
  });

  it("F1 — chaque montant affiché vient du moteur ou des termes lus", () => {
    const { payload } = turnOf(scenario);
    const html = renderToStaticMarkup(
      <TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={scenario.reponse_marque} payload={payload} />,
    );
    const allowed = allowedAmounts(payload);
    const amounts = displayedAmounts(html);
    for (const amount of amounts) expect(allowed.has(amount), `${amount} € affiché`).toBe(true);
  });

  it("F2, F6 — la lecture est affichée, et le message est modifiable, et le produit le dit", () => {
    const { payload } = turnOf(scenario);
    const html = renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={scenario.reponse_marque} payload={payload} />);
    expect(html).toContain("Ce que l&#x27;outil a compris des termes");
    expect(html).toContain("Le deal tel que l&#x27;outil le lit après cette réponse");
    expect(html).toContain("Tu peux le modifier avant de l&#x27;envoyer");
    expect(html).toContain("<textarea");
  });
});

describe("F1 — le contrôle des montants attrape bien un chiffre qui ne vient pas du moteur", () => {
  it("un montant inventé glissé dans la carte est détecté", () => {
    const scenario = scenarios.find((s) => s.id.endsWith("reponse-vague")) as Scenario;
    const { payload } = turnOf(scenario);
    const forged: TurnPayload = { ...payload, uncertainties: ["la marque pourrait payer 777 €"] };
    const html = renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={null} payload={forged} />);
    const amounts = displayedAmounts(html);
    expect(amounts).toContain(777);
    expect(allowedAmounts(forged).has(777)).toBe(false);
  });
});

describe("schéma envoyé au modèle", () => {
  it("strict : chaque objet ferme ses propriétés et les rend toutes obligatoires", async () => {
    const { turnReadingJsonSchema } = await import("@/lib/llm/turn-prompt");
    const objects: Array<Record<string, unknown>> = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "object" || (Array.isArray(record.type) && record.type.includes("object"))) objects.push(record);
      Object.values(record).forEach(walk);
    };
    walk(turnReadingJsonSchema());
    expect(objects.length).toBeGreaterThan(5);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required as string[])].sort()).toEqual(Object.keys(object.properties as object).sort());
    }
  });
});
