import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #107 — les pages connectées cessent d'attendre en file indienne.
//
// Ce qui est mesuré ici n'est pas un temps mais une PROFONDEUR DE CHAÎNE : le
// nombre de vagues de lectures qui s'attendent l'une l'autre. Deux lectures
// lancées ensemble comptent pour une vague ; deux lectures dont la seconde
// attend la première en comptent deux. Un temps de test dépendrait de la
// machine ; une profondeur de chaîne, non.

const db = vi.hoisted(() => ({
  waves: 0,
  inFlight: 0,
  calls: [] as string[],
  analyses: [] as Array<Record<string, unknown>>,
  turns: [] as Array<Record<string, unknown>>,
  payloads: [] as Array<Record<string, unknown>>,
  credits: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  free: [] as Array<Record<string, unknown>>,
  feedback: [] as Array<Record<string, unknown>>,
  feedbackTurns: [] as Array<Record<string, unknown>>,
  user: { id: "99999999-9999-4999-8999-999999999999", email: "createur@exemple.test" } as { id: string; email: string } | null,
}));

// Chaque lecture compte : celles du service comme celles faites sous
// l'identité de la personne.
async function traced<T>(label: string, rows: T): Promise<T> {
  db.calls.push(label);
  if (db.inFlight === 0) db.waves += 1;
  db.inFlight += 1;
  await new Promise((resolve) => setTimeout(resolve, 2));
  db.inFlight -= 1;
  return rows;
}

vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => db.user,
  getViewerAccessToken: async () => (db.user ? "jeton" : null),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    if (table === "negotiation_turns" && query.includes("user_id=eq.")) return traced(`service:${table}`, db.turns);
    if (table === "negotiation_turns") return traced(`service:${table}:feedback`, db.feedbackTurns);
    if (table === "credits") return traced(`service:${table}`, db.credits);
    if (table === "admin_entitlements") return traced(`service:${table}`, db.grants);
    if (table === "free_usage") return traced(`service:${table}`, db.free);
    if (table === "deals") return traced(`service:${table}`, []);
    if (table === "analysis_feedback") return traced(`service:${table}`, db.feedback);
    return traced(`service:${table}`, []);
  },
}));

vi.mock("@/lib/supabase/as-user", () => ({
  selectRowsAsUser: async (_token: string, table: string, query: string) =>
    traced(`user:${table}${query.includes("payload&id=in") ? ":payloads" : ""}`, query.includes("payload&id=in") ? db.payloads : db.analyses),
}));

const { default: HistoryPage } = await import("@/app/historique/page");
const { default: AccountPage } = await import("@/app/compte/page");
const { loadFeedbackRows } = await import("@/lib/admin/feedback-report");

function reset() {
  // La gratuité est repérée par un sujet haché : sans sel, la lecture échoue
  // avant même de partir.
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
  db.waves = 0;
  db.inFlight = 0;
  db.calls = [];
  db.analyses = [];
  db.turns = [];
  db.payloads = [];
  db.credits = [{ plan: "free", balance: 0, period_end: null, cancelled_at: null }];
  db.grants = [];
  db.free = [{ used: 0 }];
  db.feedback = [];
  db.feedbackTurns = [];
  db.user = { id: "99999999-9999-4999-8999-999999999999", email: "createur@exemple.test" };
}

beforeEach(reset);

const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

// ─── /historique ────────────────────────────────────────────────────────────

describe("/historique — la liste et les tours partent ensemble", () => {
  it("aucune négociation : une seule vague de lectures", async () => {
    db.analyses = [{ id: uuid(1), created_at: "2026-09-01T10:00:00Z", score: 70, amount: 300, evaluability: "complete", tier: "starter", rateTable: "fr-2026.3" }];
    renderToStaticMarkup(await HistoryPage());

    expect(db.waves).toBe(1);
    expect(db.calls.sort()).toEqual(["service:negotiation_turns", "user:analyses"]);
  });

  it("avec des tours : deux vagues au lieu de trois, et la seconde ne part que si elle sert", async () => {
    db.analyses = [{ id: uuid(1), created_at: "2026-09-01T10:00:00Z", score: 70, amount: 300, evaluability: "complete", tier: "starter", rateTable: "fr-2026.3" }];
    db.turns = [{ analysis_id: uuid(1), kind: "reply", turn_number: 2, deal_after: null, deal: null, accepted: null }];
    renderToStaticMarkup(await HistoryPage());

    // Vague 1 : la liste ET les tours. Vague 2 : les payloads des analyses négociées.
    expect(db.waves).toBe(2);
    expect(db.calls[db.calls.length - 1]).toBe("user:analyses:payloads");
  });

  it("sans session : redirection, et aucune lecture", async () => {
    db.user = null;
    await expect(HistoryPage()).rejects.toThrow();
    expect(db.calls).toEqual([]);
  });
});

// ─── /compte ────────────────────────────────────────────────────────────────

describe("/compte — solde, accès offert et gratuité partent ensemble", () => {
  it("solde, accès offert et compteur de gratuité partent ensemble", async () => {
    renderToStaticMarkup(await AccountPage());

    // Une seule vague : solde, accès offert et compteur de gratuité partent
    // ensemble. Le repli sur les analyses déjà faites ne part qu'après, et
    // seulement quand le compteur ne tranche pas.
    expect(db.calls.slice(0, 3).sort()).toEqual(["service:admin_entitlements", "service:credits", "service:free_usage"]);
    expect(db.waves).toBe(2);
  });

  it("compte payant : la ligne de gratuité n'est pas affichée", async () => {
    db.credits = [{ plan: "pro", balance: 0, period_end: new Date(Date.now() + 86_400_000).toISOString(), cancelled_at: null }];
    const html = renderToStaticMarkup(await AccountPage());

    expect(html).not.toContain("Analyse gratuite");
    // Compte payant : une seule vague, et surtout AUCUN repli sur les analyses
    // déjà faites — il ne sert qu'à la ligne de gratuité, qui ne s'affiche pas.
    expect(db.waves).toBe(1);
    expect(db.calls).not.toContain("service:deals");
  });

  it("sans session : redirection, et aucune lecture", async () => {
    db.user = null;
    await expect(AccountPage()).rejects.toThrow();
    expect(db.calls).toEqual([]);
  });
});

// ─── /dev/retours ───────────────────────────────────────────────────────────

function feedbackRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    analysis_id: uuid((index % 120) + 1),
    rating: "fair",
    comment: null,
    profile_tier: "starter",
    score: 60,
    total_low: 100,
    total_high: 200,
    rate_table_version: "fr-2026.3",
    turn_number: index % 3,
    turn_recorded: true,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    analysis: { deal: {} },
  }));
}

describe("/dev/retours — un nombre de lectures constant", () => {
  it("3 retours ou 300 : le même nombre d'allers-retours", async () => {
    db.feedback = feedbackRows(3);
    await loadFeedbackRows();
    const petit = db.calls.length;

    reset();
    db.feedback = feedbackRows(300);
    await loadFeedbackRows();
    const gros = db.calls.length;

    expect(gros).toBe(petit);
    // Une lecture des retours, une des tours jugés. Rien de proportionnel.
    expect(gros).toBeLessThanOrEqual(2);
  });

  it("la lecture est bornée explicitement, sans boucle de pagination", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/admin/feedback-report.ts", "utf8");
    expect(source).toContain("FEEDBACK_MAX");
    expect(source).not.toMatch(/for \(let offset = 0; ; offset \+= /);
    db.feedback = feedbackRows(5);
    await loadFeedbackRows();
    expect(db.calls[0]).toBe("service:analysis_feedback");
  });
});

// ─── I-b : jamais l'action d'un autre plan, même une fraction de seconde ────

describe("/tarifs — l'état neutre ne suppose aucun plan", () => {
  it("le premier rendu ne contient ni « Prendre Pro » ni « Se connecter pour payer »", async () => {
    const { OffersList } = await import("@/components/offers/offers-list");
    const html = renderToStaticMarkup(<OffersList />);

    expect(html).not.toContain("Prendre Pro");
    expect(html).not.toContain("Prendre Pack");
    expect(html).not.toContain("Se connecter pour payer");
    expect(html).not.toContain("Recharger");
    // L'attente est dite, et l'emplacement garde sa taille.
    expect(html).toContain("Lecture de ton compte");
    expect(html).toContain('aria-busy="true"');
    // L'action qui ne dépend d'aucun plan, elle, est là tout de suite.
    expect(html).toContain("Analyser un deal");
  });

  it("un compte non encore lu reste « inconnu », jamais « visiteur »", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/offers/offers-list.tsx", "utf8");
    // C'est cette ligne qui empêche la bascule Pro → Gratuit → Pro.
    expect(source).toMatch(/credits === undefined\s*\?\s*"inconnu"/);
  });
});

// ─── I-d : les gardes d'accès ───────────────────────────────────────────────

describe("les gardes d'accès n'ont pas bougé", () => {
  it("/admin et /dev/retours : introuvable sans propriétaire", async () => {
    db.user = { id: "11111111-1111-4111-8111-111111111111", email: "quelquun@exemple.test" };
    const { default: AdminLayout } = await import("@/app/admin/layout");
    const { default: FeedbackPage } = await import("@/app/dev/retours/page");
    await expect(AdminLayout({ children: null })).rejects.toThrow();
    await expect(FeedbackPage()).rejects.toThrow();
    expect(db.calls).toEqual([]);
  });
});
