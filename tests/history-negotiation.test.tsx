import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #087 — l'historique montre les deals qui ont bougé : état de
// l'échange, montant et score actuels à côté de ceux d'origine, sans rien
// recalculer quand la table de l'analyse n'existe plus.

const db = vi.hoisted(() => ({
  turns: [] as unknown[],
  payloads: [] as unknown[],
  queries: [] as string[],
  fail: false,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.queries.push(`service:${table}?${query}`);
    if (db.fail) throw new Error("panne");
    return table === "negotiation_turns" ? db.turns : [];
  },
}));
vi.mock("@/lib/supabase/as-user", () => ({
  selectRowsAsUser: async (_token: string, table: string, query: string) => {
    db.queries.push(`user:${table}?${query}`);
    return table === "analyses" ? db.payloads : [];
  },
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));

const { recomputeForDeal } = await import("@/lib/analysis/recompute");
const { loadScenarios, runScenario } = await import("@/lib/negotiation/scenarios");
const { summarizeNegotiation } = await import("@/lib/negotiation/history");
const { loadNegotiationSummaries } = await import("@/lib/negotiation/history-load");
const { HistoryView } = await import("@/components/account/history-view");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\s  ]+/g, " ");
const USER = "99999999-9999-4999-8999-999999999999";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

// Tour 2 du fil d'exemple : 300 € → 450 €, 3 vidéos, droits pub 12 mois.
const s = loadScenarios().find((x) => x.id.endsWith("termes-a-la-hausse"))!;
const { context, result } = runScenario(s);
if (result.kind !== "turn") throw new Error("pas un tour");
const original = context.original;
const turn2 = { analysis_id: A, kind: "reply" as const, turn_number: 2, deal_after: result.payload.deal_after, deal: null, accepted: null };

beforeEach(() => {
  db.turns = [];
  db.payloads = [];
  db.queries = [];
  db.fail = false;
});

describe("A, B — le résumé d'un échange", () => {
  it("aucun tour : rien", () => {
    expect(summarizeNegotiation(original, [])).toBeNull();
  });

  it("tour 2 en cours : montant et score actuels, ceux que la page affiche en tête", () => {
    const summary = summarizeNegotiation(original, [turn2])!;
    const page = recomputeForDeal(original, result.payload.deal_after)!;
    expect(summary).toEqual({ turn: 2, concluded: false, amountNow: 450, now: { score: page.score?.value ?? null, evaluability: page.evaluability } });
  });

  it("le score qui a bougé est le score actuel, pas celui d'origine (la marque monte à 1 800 €)", () => {
    const raised = { ...result.payload.deal_after, payment: { ...result.payload.deal_after.payment, amount_eur: 1800 } };
    const summary = summarizeNegotiation(original, [{ ...turn2, deal_after: raised }])!;
    const page = recomputeForDeal(original, raised)!;
    expect(summary.now?.score).toBe(page.score?.value);
    expect(summary.now?.score).not.toBe(original.score?.value);
    expect(summary.amountNow).toBe(1800);
  });

  it("conclue : par la personne (ligne de conclusion) ou par la marque (dans le tour)", () => {
    const conclusion = { analysis_id: A, kind: "conclusion" as const, turn_number: null, deal_after: null, deal: result.payload.deal_after, accepted: null };
    expect(summarizeNegotiation(original, [turn2, conclusion])?.concluded).toBe(true);
    expect(summarizeNegotiation(original, [{ ...turn2, accepted: "brand_accepted" }])?.concluded).toBe(true);
  });

  it("C — table de l'analyse disparue du code : rien n'est recalculé", () => {
    const gone = { ...original, estimate: { ...original.estimate, rate_table_version: "fr-2026.1" } };
    const summary = summarizeNegotiation(gone, [turn2])!;
    expect(summary.now).toBeNull();
    expect(summary.amountNow).toBe(450);
  });
});

describe("l'affichage de la liste", () => {
  const base = { created_at: "2026-09-19T10:00:00.000Z", evaluability: "complete", tier: "confirmed" };
  const summary = summarizeNegotiation(original, [turn2])!;

  it("A, B — une analyse négociée : état, montant d'origine et actuel, score actuel et d'origine", () => {
    const html = text(
      renderToStaticMarkup(<HistoryView rows={[{ ...base, id: A, score: original.score!.value, amount: 300, negotiation: summary }]} />),
    );
    expect(html).toContain("Négociation en cours, tour 2");
    expect(html).toContain("Offre : 300 € au départ, 450 € aujourd'hui");
    expect(html).toContain(`${summary.now!.score} /100`);
    expect(html).toContain(`${original.score!.value}/100 au départ`);
  });

  it("B — conclue : dit au tour où elle l'a été", () => {
    const html = text(renderToStaticMarkup(<HistoryView rows={[{ ...base, id: A, score: 29, amount: 300, negotiation: { ...summary, concluded: true, turn: 3 } }]} />));
    expect(html).toContain("Négociation conclue au tour 3");
  });

  it("C — table disparue : le score d'origine, et c'est dit", () => {
    const html = text(renderToStaticMarkup(<HistoryView rows={[{ ...base, id: A, score: 29, amount: 300, negotiation: { ...summary, now: null } }]} />));
    expect(html).toContain("29 /100");
    expect(html).toContain("Score de l'offre d'origine, non recalculable");
  });

  it("une analyse sans tour : comme avant", () => {
    const html = text(renderToStaticMarkup(<HistoryView rows={[{ ...base, id: B, score: 29, amount: 200, negotiation: null }]} />));
    expect(html).toContain("Offre : 200 €");
    expect(html).not.toContain("Négociation");
    expect(html).not.toContain("au départ");
  });

  it("état des échanges illisible : dit en tête, jamais passé sous silence", () => {
    const html = text(renderToStaticMarkup(<HistoryView rows={[{ ...base, id: B, score: 29, amount: 200 }]} negotiationUnavailable />));
    expect(html).toContain("L'état de tes négociations n'a pas pu être lu");
  });
});

describe("D — ce que la page lit en plus", () => {
  it("une requête pour les tours (bornée au compte, sans réponse collée), une pour les seules analyses négociées", async () => {
    db.turns = [turn2];
    db.payloads = [{ id: A, payload: original }];
    const summaries = await loadNegotiationSummaries(USER, "jeton", [A, B]);
    expect(summaries?.get(A)?.turn).toBe(2);
    expect(summaries?.has(B)).toBe(false);
    expect(db.queries).toHaveLength(2);
    expect(db.queries[0]).toContain("service:negotiation_turns?");
    expect(db.queries[0]).toContain(`user_id=eq.${USER}`);
    // Mission #107 — plus de filtre sur les analyses listées : il ne servait
    // qu'au confort et forçait cette lecture à ATTENDRE la liste. Le compte la
    // borne déjà, et le tri en mémoire ne garde que les analyses affichées.
    expect(db.queries[0]).not.toContain("analysis_id=in.");
    expect(db.queries[0]).toContain("limit=");
    expect(db.queries[0]).not.toMatch(/brand_reply|message/);
    expect(db.queries[1]).toBe(`user:analyses?select=id,payload&id=in.(${A})`);
  });

  it("un tour d'une analyse NON listée est ignoré : l'affichage ne change pas", async () => {
    const autre = "33333333-3333-4333-8333-333333333333";
    db.turns = [turn2, { ...turn2, analysis_id: autre }];
    db.payloads = [{ id: A, payload: original }];
    const summaries = await loadNegotiationSummaries(USER, "jeton", [A]);
    expect(summaries?.has(autre)).toBe(false);
    // Le payload n'est demandé que pour l'analyse listée.
    expect(db.queries[1]).toBe(`user:analyses?select=id,payload&id=in.(${A})`);
  });

  it("aucune analyse négociée : une seule requête, aucun recalcul", async () => {
    const summaries = await loadNegotiationSummaries(USER, "jeton", [A, B]);
    expect(summaries?.size).toBe(0);
    expect(db.queries).toHaveLength(1);
  });

  it("lecture en échec : null (l'historique le dit), pas d'erreur", async () => {
    db.fail = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await loadNegotiationSummaries(USER, "jeton", [A])).toBeNull();
  });
});
