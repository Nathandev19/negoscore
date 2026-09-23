import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #086 — l'avis porte sur les chiffres réellement jugés : ceux du tour
// affiché, enregistrés avec son numéro, et regroupés selon les termes de ce
// tour sur la page des retours.

const db = vi.hoisted(() => ({
  writes: [] as Array<Record<string, unknown>>,
  turns: [] as Array<{ analysis_id: string; turn_number: number; deal: unknown }>,
  queries: [] as string[],
}));
const loaded = vi.hoisted(() => ({ current: null as unknown }));
const thread = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      db.queries.push(`${table}?${query}`);
      return table === "negotiation_turns" ? db.turns : [];
    },
    upsertRow: async (_table: string, row: Record<string, unknown>) => {
      db.writes.push(row);
    },
  };
});
vi.mock("@/lib/analysis/load", () => ({ loadResultForViewer: async () => loaded.current }));
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => ({ id: "u1", email: "u@exemple.fr" })));
vi.mock("@/lib/negotiation/store", () => ({ loadThread: async () => thread.current }));

const { POST } = await import("@/app/api/analyses/[id]/avis/route");
const { recomputeForDeal } = await import("@/lib/analysis/recompute");
const { loadScenarios, runScenario } = await import("@/lib/negotiation/scenarios");
const { attachTurnDeals, buildReport, dealOf } = await import("@/lib/admin/feedback-report");
const { EntryItem } = await import("@/components/admin/feedback-report-view");
const { EstimateFeedback } = await import("@/components/result/estimate-feedback");

const ID = "11111111-1111-4111-8111-111111111111";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\s  ]+/g, " ");

// Tour 2 du fil d'exemple : 3 vidéos, droits pub 12 mois, 450 €.
const s = loadScenarios().find((x) => x.id.endsWith("termes-a-la-hausse"))!;
const { context, result } = runScenario(s);
if (result.kind !== "turn") throw new Error("pas un tour");
const original = context.original;
const payload = result.payload;
const storedThread = { turns: [{ id: "t2", turnNumber: 2, brandReply: null, createdAt: "", payload }], conclusion: null };

function post(body: unknown) {
  return POST(
    new Request(`http://localhost:3000/api/analyses/${ID}/avis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
}

beforeEach(() => {
  db.writes = [];
  db.turns = [];
  db.queries = [];
  loaded.current = { analysis: original, unlocked: true };
  thread.current = storedThread;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("A — les chiffres affichés et le tour, enregistrés avec l'avis", () => {
  it("après le tour 2 : la fourchette et le score des termes du tour 2, et le tour", async () => {
    const response = await post({ rating: "too_low", tier: "confirmed", turn: 2 });
    expect(response.status).toBe(200);
    const expected = recomputeForDeal(original, payload.deal_after)!;
    expect(db.writes[0]).toMatchObject({
      turn_number: 2,
      total_low: expected.estimate.total_low,
      total_high: expected.estimate.total_high,
      score: expected.score?.value ?? null,
      rate_table_version: "fr-2026.3",
    });
    expect(db.writes[0].total_low).not.toBe(original.estimate.total_low);
  });

  it("sur l'offre d'origine : ses chiffres, tour 0", async () => {
    await post({ rating: "fair", tier: "confirmed", turn: 0 });
    expect(db.writes[0]).toMatchObject({ turn_number: 0, total_low: original.estimate.total_low, total_high: original.estimate.total_high });
  });

  it("un tour qui n'existe pas dans le fil : refusé, rien d'écrit", async () => {
    const response = await post({ rating: "fair", tier: "confirmed", turn: 3 });
    expect(response.status).toBe(409);
    expect(db.writes).toEqual([]);
    expect((await post({ rating: "fair", tier: "confirmed", turn: 1 })).status).toBe(400);
  });

  it("table de l'analyse disparue : la page montrait les chiffres d'origine, l'avis porte sur eux (tour 0)", async () => {
    loaded.current = { analysis: { ...original, estimate: { ...original.estimate, rate_table_version: "fr-2026.1" } }, unlocked: true };
    await post({ rating: "fair", tier: "confirmed", turn: 2 });
    expect(db.writes[0]).toMatchObject({ turn_number: 0, total_low: original.estimate.total_low, rate_table_version: "fr-2026.1" });
  });
});

describe("B — la page des retours regroupe selon les termes du tour jugé", () => {
  // L'offre d'origine a des droits pub et 300 € ; le tour jugé : sans droits
  // pub, sans exclusivité, 900 €.
  const turnDeal = {
    ...payload.deal_after,
    usage: { ...payload.deal_after.usage, paid_ads: false },
    exclusivity: { present: false, duration_months: null, category: null },
    payment: { ...payload.deal_after.payment, amount_eur: 900 },
  };
  const row = (overrides: Record<string, unknown>) => ({
    analysis_id: ID,
    rating: "fair" as const,
    comment: null,
    profile_tier: "confirmed" as const,
    score: 40,
    total_low: 1000,
    total_high: 2000,
    rate_table_version: "fr-2026.3",
    turn_number: 2,
    turn_recorded: true,
    created_at: "2026-09-20T10:00:00.000Z",
    updated_at: "2026-09-20T10:00:00.000Z",
    analysis: { deal: original.deal },
    ...overrides,
  });

  it("les termes du tour sont lus dans negotiation_turns (deal_after seulement)", async () => {
    db.turns = [{ analysis_id: ID, turn_number: 2, deal: turnDeal }];
    const [attached] = await attachTurnDeals([row({})]);
    expect(attached.turn_deal).toEqual(turnDeal);
    expect(db.queries[0]).toContain("negotiation_turns?select=analysis_id,turn_number,deal:payload->deal_after");
    expect(db.queries[0]).not.toContain("brand_reply");
  });

  it("droits pub, exclusivité et montant proposé : ceux du tour 2, pas de l'offre d'origine", () => {
    expect(original.deal.usage.paid_ads).toBe(true);
    const report = buildReport([row({ turn_deal: turnDeal })]);
    const group = (key: string, label: string) =>
      report.byShape.find((b) => b.key === key)!.groups.find((g) => g.label === label)!.distribution.total;
    expect(group("droits-pub", "Sans droits pub")).toBe(1);
    expect(group("droits-pub", "Avec droits pub")).toBe(0);
    expect(group("exclusivite", "Sans exclusivité")).toBe(1);
    expect(report.entries[0].offered).toEqual({ value: 900, kind: "money" });
    expect(report.entries[0].ratioToLow).toBeCloseTo(0.9);
  });

  it("tour introuvable : rangé à part, jamais sous la forme de l'offre d'origine", () => {
    const report = buildReport([row({})]);
    expect(dealOf(row({}))).toBeNull();
    const pub = report.byShape.find((b) => b.key === "droits-pub")!.groups;
    expect(pub.find((g) => g.key === "illisible")?.distribution.total).toBe(1);
    expect(pub.find((g) => g.key === "avec")?.distribution.total).toBe(0);
  });

  it("C — le tour est visible dans la liste, et compté par tour", () => {
    const report = buildReport([row({ turn_deal: turnDeal }), row({ analysis_id: "22222222-2222-4222-8222-222222222222", turn_number: 0 })]);
    const html = text(renderToStaticMarkup(<EntryItem entry={report.entries[0]} link={false} />));
    expect(html).toContain("Porte sur Les termes après le tour 2 de négociation");
    expect(report.byTurn.map((g) => [g.key, g.distribution.total])).toEqual([
      ["origine", 1],
      ["apres-tour", 1],
    ]);
  });

  it("E — un avis d'avant l'enregistrement du tour : l'offre d'origine, et l'écran dit que c'est supposé", () => {
    const old = row({ turn_number: 0, turn_recorded: false });
    expect(dealOf(old)).not.toBeNull();
    const report = buildReport([old]);
    const html = text(renderToStaticMarkup(<EntryItem entry={report.entries[0]} link={false} />));
    expect(html).toContain("L'offre d'origine (supposé : avis donné avant l'enregistrement du tour)");
    expect(report.byTurn.find((g) => g.key === "non-enregistre")?.distribution.total).toBe(1);
    expect(report.byShape.find((b) => b.key === "droits-pub")!.groups.find((g) => g.key === "avec")?.distribution.total).toBe(1);
  });
});

describe("le formulaire d'avis", () => {
  it("il envoie le tour affiché, et dit sur quoi porte l'avis", () => {
    const html = renderToStaticMarkup(<EstimateFeedback action={`/api/analyses/${ID}/avis`} initial={null} turn={3} />);
    expect(html).toContain('name="turn" value="3"');
    // Mission #097 : la question répète le chiffre jugé au lieu de renvoyer à
    // « la fourchette affichée plus haut ».
    expect(text(html)).toContain("Calculée sur les termes après le tour 3.");
    expect(text(html)).not.toContain("affichée plus haut");
  });

  it("B — l'avis de CE tour est pré-rempli ; celui d'un autre tour, jamais", () => {
    const here = text(
      renderToStaticMarkup(<EstimateFeedback action={`/api/analyses/${ID}/avis`} initial={{ rating: "too_high", comment: "tour deux", turn: 2 }} turn={2} />),
    );
    expect(here).toContain("tour deux");
    expect(here).toContain("Modifier mon avis");
    const other = renderToStaticMarkup(
      <EstimateFeedback action={`/api/analyses/${ID}/avis`} initial={{ rating: "too_high", comment: "avis-d-origine", turn: 0 }} turn={2} />,
    );
    expect(other).not.toContain("avis-d-origine");
    expect(other).not.toMatch(/value="too_high" checked/);
    expect(text(other)).toContain("Envoyer mon avis");
  });

  it("avis ancien (tour non enregistré) : pré-rempli sur l'offre d'origine, et dit comme supposé", () => {
    const same = text(renderToStaticMarkup(<EstimateFeedback action={`/api/analyses/${ID}/avis`} initial={{ rating: "fair", comment: "gardé", turn: null }} />));
    expect(same).toContain("gardé");
    expect(same).toContain("Ton avis enregistré date d'avant l'enregistrement du tour : il est compté sur l'offre d'origine.");
    const later = text(renderToStaticMarkup(<EstimateFeedback action={`/api/analyses/${ID}/avis`} initial={{ rating: "fair", comment: "gardé", turn: null }} turn={2} />));
    expect(later).not.toContain("gardé");
  });
});

describe("un avis par tour (clé analysis_id + turn_number)", () => {
  it("A — un avis après le tour 2 s'ajoute : il n'écrase pas celui sur l'offre d'origine", async () => {
    const { feedbackRow } = await import("@/lib/analysis/feedback");
    const input = { rating: "fair" as const, comment: null, tier: "confirmed" as const, turn: 0 };
    const origin = feedbackRow(ID, original, input, 0);
    const after = feedbackRow(ID, original, { ...input, turn: 2 }, 2);
    // Même analyse, tours différents : deux clés différentes.
    expect([origin.analysis_id, origin.turn_number]).not.toEqual([after.analysis_id, after.turn_number]);
    await post({ rating: "fair", tier: "confirmed", turn: 0 });
    await post({ rating: "too_low", tier: "confirmed", turn: 2 });
    expect(db.writes.map((w) => [w.analysis_id, w.turn_number, w.rating])).toEqual([
      [ID, 0, "fair"],
      [ID, 2, "too_low"],
    ]);
  });

  it("B — la page lit l'avis du tour affiché, et seulement lui", async () => {
    const { readFeedback } = await import("@/lib/analysis/feedback");
    await readFeedback(ID, 3);
    expect(db.queries.at(-1)).toContain(`analysis_id=eq.${ID}&turn_number=eq.3`);
  });

  it("C — deux avis sur une même analyse : comptée une fois dans les répartitions (son avis d'origine), deux fois par tour et dans la liste", async () => {
    const { buildReport: build, onePerAnalysis } = await import("@/lib/admin/feedback-report");
    const base = {
      analysis_id: ID,
      comment: null,
      profile_tier: "confirmed" as const,
      score: 40,
      total_low: 1000,
      total_high: 2000,
      rate_table_version: "fr-2026.3",
      turn_recorded: true,
      created_at: "2026-09-20T10:00:00.000Z",
      analysis: { deal: original.deal },
    };
    const originRow = { ...base, rating: "too_high" as const, turn_number: 0, updated_at: "2026-09-20T10:00:00.000Z" };
    const laterRow = { ...base, rating: "too_low" as const, turn_number: 3, updated_at: "2026-09-21T10:00:00.000Z", turn_deal: payload.deal_after };
    const other = { ...base, analysis_id: "22222222-2222-4222-8222-222222222222", rating: "fair" as const, turn_number: 2, updated_at: "2026-09-19T10:00:00.000Z", turn_deal: payload.deal_after };
    expect(onePerAnalysis([laterRow, originRow, other]).map((r) => [r.analysis_id, r.turn_number])).toEqual([
      [ID, 0],
      ["22222222-2222-4222-8222-222222222222", 2],
    ]);
    const report = build([laterRow, originRow, other]);
    expect(report.analyses).toBe(2);
    expect(report.avis).toBe(3);
    expect(report.overall.total).toBe(2);
    expect(report.overall.counts).toEqual({ too_low: 0, fair: 1, too_high: 1 });
    expect(report.byTier.find((g) => g.key === "confirmed")?.distribution.total).toBe(2);
    expect(report.byTurn.map((g) => [g.key, g.distribution.total])).toEqual([
      ["origine", 1],
      ["apres-tour", 2],
    ]);
    expect(report.entries.map((e) => e.turn)).toEqual([3, 0, 2]);
    const view = text(renderToStaticMarkup(<EntryItem entry={report.entries[0]} />));
    expect(renderToStaticMarkup(<EntryItem entry={report.entries[0]} />)).toContain(`href="/dev/retours/${ID}?tour=3"`);
    expect(view).toContain("Les termes après le tour 3 de négociation");
  });
});
