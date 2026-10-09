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
import type { ResultView } from "@/lib/analysis/lock";
import { verdictCardAvailable, verdictCardTexts } from "@/lib/share-card/verdict-card";
import { carteDeLAnalyse, carteDepuisChiffrage, ligneOffreDuDeal } from "@/lib/share-card/verdict-data";
import { projectionAnalyse, projectionFil } from "./helpers/carte-projection";
import { TONES, toneLabel } from "@/lib/tone";

// Mission #084 — après un tour, aucune partie de la page n'affirme un terme
// que l'état actuel du deal contredit.

const thread = vi.hoisted(() => ({ current: null as unknown }));
const rendered = vi.hoisted(() => ({ last: null as unknown }));
const loaded = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/negotiation/store", () => ({ TURNS_TABLE: "negotiation_turns", loadThread: async () => thread.current }));
vi.mock("@/lib/analysis/load", () => ({ loadResultForViewer: async () => loaded.current }));
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => ({ id: "u1", email: "u@exemple.fr" })));
// Mission #169 — la carte ne passe plus par loadResultForViewer ni par
// loadThread : elle lit des colonnes projetées. Le mock rend donc la
// PROJECTION de ce que ces deux-là contiennent, pour que le test vérifie
// vraiment ce que la route a le droit de voir.
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string) => {
    if (table === "analyses") {
      const charge = loaded.current as { analysis: ResultView } | null;
      return charge
        ? [projectionAnalyse(charge.analysis, { rate_table_version: charge.analysis.estimate.rate_table_version })]
        : [];
    }
    if (thread.current === "panne") throw new Error("fil injoignable");
    const fil = thread.current as { turns: Array<{ turnNumber: number; payload: unknown }>; conclusion: unknown } | null;
    return (fil?.turns ?? []).map((tour) =>
      projectionFil({ kind: "reply", turn_number: tour.turnNumber, payload: tour.payload }),
    );
  },
}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    status = 200;
    headers = new Headers({ "Content-Type": "image/png" });
    constructor(element: unknown) {
      rendered.last = element;
    }
  },
}));

async function carte() {
  const { GET } = await import("@/app/api/carte/[id]/route");
  return GET(new Request("http://localhost/api/carte/abc", { headers: { cookie: "deal_anon_token=x" } }), {
    params: Promise.resolve({ id: "abc" }),
  });
}

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
const negotiated = { deal: payload.deal_after, turn: 2, offered: null };
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

  it("après un tour : verdict et fourchette des termes actuels", async () => {
    thread.current = { turns: [{ id: "t", turnNumber: 2, brandReply: null, createdAt: "", payload }], conclusion: null };
    expect((await carte()).status).toBe(200);
    const attendu = verdictCardTexts(carteDepuisChiffrage(payload.pricing_after!, ligneOffreDuDeal(payload.deal_after)));
    const texte = JSON.stringify(rendered.last);
    // La fourchette du tour, pas celle de l'offre d'origine.
    expect(texte).toContain(attendu.vaut);
    expect(attendu.vaut).not.toBe(verdictCardTexts(carteDepuisChiffrage(payload.pricing_before, ligneOffreDuDeal(payload.deal_before))).vaut);
    // Et le montant des termes actuels : 450 €, pas celui de l'offre.
    expect(payload.deal_after.payment.amount_eur).toBe(450);
    expect(payload.pricing_after?.compared).toBe(450);
    expect(texte).toContain(attendu.propose);
  });

  it("fil illisible : pas de carte, plutôt que des chiffres peut-être périmés", async () => {
    thread.current = "panne";
    expect((await carte()).status).toBe(503);
    expect(rendered.last).toBeNull();
  });

  it("mission #085 — après un tour, table de l'analyse disparue du code : pas de carte aux chiffres d'origine", async () => {
    // Mission #169 — LE SIGNAL A CHANGÉ DE PLACE, PAS DE SENS. La route de la
    // #064 recalculait et constatait l'échec ; celle-ci ne recalcule rien,
    // elle lit le drapeau que l'écriture du tour a posé (pricing_unavailable).
    // Ce qui est interdit reste interdit : aucun repli sur les chiffres de
    // l'offre d'origine, qui ne décrivent plus ce qui est sur la table.
    loaded.current = { analysis: { ...original, estimate: { ...original.estimate, rate_table_version: "fr-2026.1" } }, unlocked: true };
    const sansTable: TurnPayload = { ...payload, pricing_unavailable: true, pricing_after: null };
    thread.current = { turns: [{ id: "t", turnNumber: 2, brandReply: null, createdAt: "", payload: sansTable }], conclusion: null };
    expect((await carte()).status).toBe(404);
    expect(rendered.last).toBeNull();
  });

  it("un tour enregistré avant la #169 : pas de carte, et surtout pas celle de l'origine", async () => {
    // Son chiffrage n'a pas de bande. On ne retombe pas sur l'offre d'origine :
    // la page ne proposera donc pas le bouton (même règle, même fonction).
    loaded.current = { analysis: original, unlocked: true };
    const ancien: TurnPayload = {
      ...payload,
      pricing_after: { ...payload.pricing_after!, score: null, band: null, compared: null, ceiling: false },
    };
    thread.current = { turns: [{ id: "t", turnNumber: 2, brandReply: null, createdAt: "", payload: ancien }], conclusion: null };
    expect((await carte()).status).toBe(404);
    expect(rendered.last).toBeNull();
    // Et la carte de l'origine, elle, existerait : c'est bien un refus, pas
    // une absence de données.
    expect(verdictCardAvailable(carteDeLAnalyse(original))).toBe(true);
  });

  it("aucun tour : la carte de l'offre analysée", async () => {
    thread.current = { turns: [], conclusion: null };
    expect(currentState(thread.current as never)).toBeNull();
    expect((await carte()).status).toBe(200);
    const attendu = verdictCardTexts(carteDeLAnalyse(original));
    expect(JSON.stringify(rendered.last)).toContain(attendu.vaut);
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
