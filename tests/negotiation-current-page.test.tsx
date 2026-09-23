import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { ReadyMessage } from "@/components/result/unlocked-blocks";
import { recomputeForDeal } from "@/lib/analysis/recompute";
import { dealRecapRows } from "@/lib/display";
import { computeFrLegal } from "@/lib/legal/fr";
import { changedGroups, currentState, splitByChange } from "@/lib/negotiation/current";
import { loadScenarios, runScenario } from "@/lib/negotiation/scenarios";
import type { TurnPayload } from "@/lib/negotiation/types";
import { TONES, toneLabel } from "@/lib/tone";

// Mission #084 — après un tour, aucune partie de la page n'affirme un terme
// que l'état actuel du deal contredit.

const thread = vi.hoisted(() => ({ current: null as unknown }));
const rendered = vi.hoisted(() => ({ last: null as unknown }));
const loaded = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/negotiation/store", () => ({ loadThread: async () => thread.current }));
vi.mock("@/lib/analysis/load", () => ({ loadResultForViewer: async () => loaded.current }));
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => ({ id: "u1", email: "u@exemple.fr" }) }));
vi.mock("@/lib/share-card/render", () => ({
  renderShareCard: async (analysis: unknown) => {
    rendered.last = analysis;
    return new Response("png", { status: 200, headers: { "Content-Type": "image/png" } });
  },
}));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/[\s  ]+/g, " ");

// Tour 2 réel du fil d'exemple : 3 vidéos au lieu de 2, droits pub 12 mois au
// lieu de 6, budget 450 €.
function turnFrom(suffix: string) {
  const scenario = loadScenarios().find((s) => s.id.endsWith(suffix))!;
  const { context, result } = runScenario(scenario);
  if (result.kind !== "turn") throw new Error("pas un tour");
  return { original: context.original, payload: result.payload as TurnPayload };
}
const { original, payload } = turnFrom("termes-a-la-hausse");
const negotiated = { deal: payload.deal_after, turn: 2, ceiling: null };
const page = () => text(renderToStaticMarkup(<AnalysisResult analysis={original} unlockHref="/connexion" negotiated={negotiated} />));

describe("A2 — ce que le code déduit des termes est recalculé sur les termes actuels", () => {
  it("fourchette et score : ceux des termes actuels, les mêmes que le tour", () => {
    const current = recomputeForDeal(original, payload.deal_after)!;
    expect(current.estimate.total_low).toBe(payload.pricing_after?.total_low);
    expect(current.estimate.total_high).toBe(payload.pricing_after?.total_high);
    expect(current.estimate.total_low).not.toBe(original.estimate.total_low);
    expect(current.deal).toEqual(payload.deal_after);
    expect(current.fr_legal).toEqual(computeFrLegal(payload.deal_after));
  });

  it("le deal affiché est l'état actuel, et le titre le dit", () => {
    const html = page();
    // Mission #097 : le bloc est replié, son intitulé dit à quoi il sert ; le
    // tour dont il est à jour se lit à l'ouverture.
    expect(html).toContain("Le deal proposé");
    expect(html).toContain("À jour des termes du tour 2.");
    for (const row of dealRecapRows(payload.deal_after)) expect(html).toContain(text(row.value).trim());
    expect(html).toContain("12 mois");
    expect(html).toContain("Score, fourchette et deal sont à jour des termes du tour 2");
  });

  it("aucun tour : la page reste celle de l'offre analysée", () => {
    const html = text(renderToStaticMarkup(<AnalysisResult analysis={original} unlockHref="/connexion" />));
    expect(html).toContain("Le deal proposé");
    expect(html).not.toContain("jour des termes");
    expect(html).not.toContain("D'après l'offre d'origine");
  });
});

describe("A2 — ce qui vient du modèle décrit l'offre d'origine, et ne dément pas les termes actuels", () => {
  it("le cas vu en production : « 6 mois, c'est borné » disparaît quand la durée est passée à 12 mois", () => {
    const html = page();
    expect(changedGroups(original.deal, payload.deal_after).has("usage_duration")).toBe(true);
    expect(html).not.toContain("6 mois, c'est borné");
    expect(html).toContain("Retiré, car le terme a changé pendant l'échange avec la marque : « Des droits pub limités dans le temps »");
    expect(html).toContain("D'après l'offre d'origine, avant l'échange avec la marque.");
  });

  it("invariant : sur chaque scénario qui change des termes, aucun point gardé ne parle d'un terme changé", () => {
    for (const scenario of loadScenarios()) {
      const { context, result } = runScenario(scenario);
      if (result.kind !== "turn" || result.payload.changes.length === 0) continue;
      const changed = changedGroups(context.original.deal, result.payload.deal_after);
      for (const group of result.payload.changes.map((c) => c.group)) expect(changed.has(group), `${scenario.id} ${group}`).toBe(true);
      for (const items of [context.original.good_points, context.original.red_flags, context.original.negotiate]) {
        const { kept } = splitByChange(items as Array<{ label: string; why: string }>, changed);
        const again = splitByChange(kept, changed);
        expect(again.withdrawn, scenario.id).toEqual([]);
      }
    }
  });

  it("un point sur un terme inchangé reste (le paiement n'a pas bougé au tour 2)", () => {
    expect(page()).toContain("Paiement à 60 jours");
  });

  it("la contre-offre et le premier message restent ceux envoyés, sur l'offre d'origine", () => {
    const html = page();
    expect(html).toContain(original.ready_to_send_message?.text.slice(0, 40));
  });
});

describe("A4 — la carte partageable porte les termes actuels", () => {
  beforeEach(() => {
    rendered.last = null;
    loaded.current = { analysis: original, unlocked: true };
  });

  it("après un tour : score et fourchette des termes actuels", async () => {
    thread.current = { turns: [{ id: "t", turnNumber: 2, brandReply: null, createdAt: "", payload }], conclusion: null };
    const { GET } = await import("@/app/analyse/resultat/[id]/carte/route");
    const response = await GET(new Request("http://localhost/analyse/resultat/abc/carte"), { params: Promise.resolve({ id: "abc" }) });
    expect(response.status).toBe(200);
    const card = rendered.last as typeof original;
    expect(card.estimate.total_low).toBe(payload.pricing_after?.total_low);
    expect(card.deal.payment.amount_eur).toBe(450);
  });

  it("fil illisible : pas de carte, plutôt que des chiffres peut-être périmés", async () => {
    thread.current = Promise.reject(new Error("panne"));
    const { GET } = await import("@/app/analyse/resultat/[id]/carte/route");
    const response = await GET(new Request("http://localhost/analyse/resultat/abc/carte"), { params: Promise.resolve({ id: "abc" }) });
    expect(response.status).toBe(503);
    expect(rendered.last).toBeNull();
  });

  it("mission #085 — après un tour, table de l'analyse disparue du code : pas de carte aux chiffres d'origine", async () => {
    loaded.current = { analysis: { ...original, estimate: { ...original.estimate, rate_table_version: "fr-2026.1" } }, unlocked: true };
    thread.current = { turns: [{ id: "t", turnNumber: 2, brandReply: null, createdAt: "", payload }], conclusion: null };
    const { GET } = await import("@/app/analyse/resultat/[id]/carte/route");
    const response = await GET(new Request("http://localhost/analyse/resultat/abc/carte"), { params: Promise.resolve({ id: "abc" }) });
    expect(response.status).toBe(404);
    expect(rendered.last).toBeNull();
  });

  it("aucun tour : la carte de l'offre analysée", async () => {
    thread.current = { turns: [], conclusion: null };
    expect(currentState(thread.current as never)).toBeNull();
    const { GET } = await import("@/app/analyse/resultat/[id]/carte/route");
    await GET(new Request("http://localhost/analyse/resultat/abc/carte"), { params: Promise.resolve({ id: "abc" }) });
    expect((rendered.last as typeof original).estimate).toEqual(original.estimate);
  });
});

describe("B — deux défauts vus au passage", () => {
  it("B1 — une question identique à sa citation ne s'affiche qu'une fois", () => {
    const same: TurnPayload = { ...payload, brand_questions: [{ question: "Ça te va ?", quote: "Ça te va ?" }] };
    const html = text(renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={null} payload={same} />));
    expect(html.split("Ça te va ?")).toHaveLength(2);
    const reworded: TurnPayload = { ...payload, brand_questions: [{ question: "Tes statistiques du dernier mois ?", quote: "pouvez-vous nous envoyer vos stats ?" }] };
    const both = text(renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={null} payload={reworded} />));
    expect(both).toContain("Tes statistiques du dernier mois ?");
    expect(both).toContain("pouvez-vous nous envoyer vos stats ?");
  });

  it("B2 — trois libellés de ton, les mêmes partout", () => {
    expect(toneLabel("Poli et ferme")).toBe(TONES.firm);
    expect(toneLabel("ferme et cordial")).toBe(TONES.firm);
    expect(toneLabel("Chaleureux et ferme")).toBe(TONES.firm);
    expect(toneLabel("poli et chaleureux")).toBe(TONES.warm);
    expect(toneLabel("Poli et ouvert")).toBe(TONES.clear);
    expect(toneLabel("")).toBe(TONES.clear);
    const html = text(renderToStaticMarkup(<ReadyMessage message={{ tone: "ferme et cordial", text: "Bonjour" }} />));
    expect(html).toContain("Ton : Poli et ferme");
    expect(Object.values(TONES)).toContain(payload.message.tone);
  });
});
