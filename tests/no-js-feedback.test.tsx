import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction } from "@/lib/fixtures/preview-states";

// Mission #075, B — l'avis sur l'estimation envoyé SANS JavaScript. L'action
// traverse la vraie route /api/analyses/[id]/avis ; seules la lecture de
// l'analyse et l'écriture de l'avis sont simulées.

const ID = "11111111-1111-4111-8111-111111111111";
const OWNER_TOKEN = "jeton-du-proprietaire";

const store = vi.hoisted(() => ({ saved: [] as Array<{ id: string; rating: string; comment: string | null; tier: string; turn?: number; savedTurn?: number }> }));
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => null));
vi.mock("@/lib/analysis/load", () => ({
  // Même règle que la vraie : l'analyse n'est lisible que par son propriétaire.
  loadResultForViewer: async (id: string, viewer: { anonToken: string | null }) =>
    id === ID && viewer.anonToken === OWNER_TOKEN ? { analysis: composeAnalysis(baseExtraction()), unlocked: false } : null,
}));
vi.mock("@/lib/analysis/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analysis/feedback")>()),
  saveFeedback: async (id: string, _shown: unknown, input: { rating: string; comment: string | null; tier: string }, turn: number) => {
    store.saved.push({ id, ...input, savedTurn: turn });
    return "saved";
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...browser.cookies.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    set: () => undefined,
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

const { saveFeedbackWithoutJs } = await import("@/lib/forms/no-js-actions");

// Ce que le navigateur envoie sans JavaScript : les champs du formulaire.
function submit(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return saveFeedbackWithoutJs({ status: "idle" }, form);
}

beforeEach(() => {
  store.saved = [];
  browser.cookies = new Map([["deal_anon_token", OWNER_TOKEN]]);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("avis sur l'estimation sans JavaScript", () => {
  it("le formulaire est envoyable par le navigateur seul : action serveur, champs nommés", () => {
    const source = readFileSync(path.join(process.cwd(), "components/result/estimate-feedback.tsx"), "utf8");
    expect(source).toContain("action={analysisId ? serverAction : undefined}");
    expect(source).toContain('name="analysisId"');
    expect(source).toContain('name="tier"');
    expect(source).toContain('name="comment"');
    expect(source).toContain('name="rating"');
  });

  it("l'avis est réellement enregistré, et le serveur confirme", async () => {
    const state = await submit({ analysisId: ID, rating: "too_low", comment: "La marque paie 400 € d'habitude.", tier: "starter" });
    expect(state).toEqual({ status: "saved", tier: "starter", rating: "too_low", comment: "La marque paie 400 € d'habitude." });
    // Mission #086 : sans tour envoyé, l'offre d'origine.
    expect(store.saved).toEqual([{ id: ID, rating: "too_low", comment: "La marque paie 400 € d'habitude.", tier: "starter", turn: 0, savedTurn: 0 }]);
  });

  it("sans réponse choisie : le serveur le dit, et le commentaire est gardé", async () => {
    const state = await submit({ analysisId: ID, comment: "gardé", tier: "starter" });
    expect(state).toMatchObject({ status: "error", message: "Choisis une réponse avant d'envoyer.", comment: "gardé" });
    expect(store.saved).toEqual([]);
  });

  it("l'analyse de quelqu'un d'autre : refusée, rien d'enregistré", async () => {
    browser.cookies = new Map([["deal_anon_token", "un-autre-navigateur"]]);
    const state = await submit({ analysisId: ID, rating: "fair", tier: "starter" });
    expect(state).toMatchObject({ status: "error", message: "Analyse introuvable." });
    expect(store.saved).toEqual([]);
  });

  it("la confirmation écrite par le serveur s'affiche, réponse et commentaire remis en place", async () => {
    const { EstimateFeedback } = await import("@/components/result/estimate-feedback");
    // Rendu initial : aucune confirmation (rien n'a été envoyé).
    const html = renderToStaticMarkup(<EstimateFeedback action={`/api/analyses/${ID}/avis`} initial={null} />);
    expect(html).toContain(`name="analysisId" value="${ID}"`);
    expect(html).not.toContain("c&#x27;est enregistré");
  });
});
