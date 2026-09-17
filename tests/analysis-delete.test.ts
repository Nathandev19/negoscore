import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-sample.json";

// Suppression d'une analyse et affichage après purge, sans réseau : les
// lectures et écritures Supabase sont simulées et enregistrées.
const db = vi.hoisted(() => ({
  analyses: new Map<string, { payload: unknown; deal: Record<string, unknown> }>(),
  documents: [] as Array<{ deal_id: string; storage_path: string }>,
  queries: [] as string[],
  deletedDeals: [] as string[],
  removed: [] as string[][],
}));

const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.queries.push(`${table}?${query}`);
    if (table === "analyses") {
      const id = query.match(/id=eq\.([^&]+)/)?.[1] ?? "";
      const row = db.analyses.get(id);
      return row ? [row] : [];
    }
    if (table === "deal_documents") {
      const dealId = query.match(/deal_id=eq\.([^&]+)/)?.[1];
      return db.documents.filter((d) => d.deal_id === dealId);
    }
    return [];
  },
  removeDocuments: async (paths: string[]) => {
    db.removed.push(paths);
    return paths;
  },
  deleteRows: async (table: string, filter: string) => {
    expect(table).toBe("deals");
    db.deletedDeals.push(filter.replace("id=eq.", ""));
  },
}));
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => user.current }));

const { deleteAnalysisForViewer } = await import("@/lib/analysis/delete");
const { loadResultForViewer } = await import("@/lib/analysis/load");
const { POST } = await import("@/app/api/analyses/[id]/supprimer/route");

const ANON_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const TEXT_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_TOKEN = "jeton-du-navigateur-auteur";

beforeEach(() => {
  db.analyses.clear();
  db.documents = [];
  db.queries = [];
  db.deletedDeals = [];
  db.removed = [];
  user.current = null;
  db.analyses.set(ANON_ID, {
    payload: sample,
    deal: { id: "deal-anon", anon_token: OWNER_TOKEN, user_id: null, source_type: "image", raw_text: null, deal_documents: [{ id: "doc" }] },
  });
  db.analyses.set(ACCOUNT_ID, {
    payload: sample,
    deal: { id: "deal-compte", anon_token: OWNER_TOKEN, user_id: "user-a", source_type: "text", raw_text: "offre", deal_documents: [] },
  });
  db.analyses.set(TEXT_ID, {
    payload: sample,
    deal: { id: "deal-texte", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "Bonjour, Camille de Maison Ortie, camille@ortie.fr : 450 €", deal_documents: [] },
  });
  db.documents = [{ deal_id: "deal-anon", storage_path: "a/b.png" }];
});

function post(id: string, cookie: string | null, confirmation: string | null = "oui") {
  const body = confirmation === null ? "" : new URLSearchParams({ confirmation }).toString();
  return POST(
    new Request(`http://localhost:3000/api/analyses/${id}/supprimer`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("suppression d'une analyse : autorisation par le rattachement serveur uniquement", () => {
  it("un autre visiteur, avec son propre cookie, ne supprime rien", async () => {
    expect(await deleteAnalysisForViewer(ANON_ID, { user: null, anonToken: "jeton-d-un-autre" })).toEqual({ deleted: false });
    expect((await post(ANON_ID, "deal_anon_token=jeton-d-un-autre")).status).toBe(404);
    expect(db.deletedDeals).toEqual([]);
    expect(db.removed).toEqual([]);
  });

  it("un visiteur sans cookie ne supprime rien, même avec l'identifiant exact", async () => {
    expect(await deleteAnalysisForViewer(ANON_ID, { user: null, anonToken: null })).toEqual({ deleted: false });
    expect((await post(ANON_ID, null)).status).toBe(404);
    expect(db.deletedDeals).toEqual([]);
  });

  it("un identifiant inexistant ou mal formé : introuvable, sans suppression", async () => {
    expect((await post(MISSING_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect((await post("pas-un-uuid", `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect(db.queries.some((q) => q.includes("pas-un-uuid"))).toBe(false);
    expect(db.deletedDeals).toEqual([]);
  });

  it("une analyse rattachée à un compte : ni le cookie anonyme, ni un autre compte ne suffisent", async () => {
    expect((await post(ACCOUNT_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    user.current = { id: "user-b", email: "b@example.com" };
    expect((await post(ACCOUNT_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect(db.deletedDeals).toEqual([]);

    user.current = { id: "user-a", email: "a@example.com" };
    const response = await post(ACCOUNT_ID, null);
    expect(response.headers.get("location")).toBe("/analyse/supprimee");
    expect(db.deletedDeals).toEqual(["deal-compte"]);
  });

  it("sans confirmation explicite : retour à la page de confirmation, rien n'est supprimé", async () => {
    const response = await post(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`, null);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/analyse/resultat/${ANON_ID}/supprimer`);
    expect(db.deletedDeals).toEqual([]);
  });

  it("l'auteur anonyme : fichiers du stockage puis deal supprimés", async () => {
    const response = await post(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/analyse/supprimee");
    expect(db.removed).toEqual([["a/b.png"]]);
    expect(db.deletedDeals).toEqual(["deal-anon"]);
  });
});

describe("page de résultat après la purge des 30 jours", () => {
  it("texte collé effacé : signalé, le reste de l'analyse est chargé", async () => {
    const deal = db.analyses.get(TEXT_ID)!.deal;
    deal.raw_text = null;
    const result = await loadResultForViewer(TEXT_ID, { user: null, anonToken: OWNER_TOKEN });
    expect(result).toMatchObject({ sourceRemoved: true, sourceType: "text", unlocked: false });
    expect(result?.analysis.score).toEqual(sample.score);
  });

  it("texte encore présent : non signalé, et le texte ne quitte jamais le serveur", async () => {
    const result = await loadResultForViewer(TEXT_ID, { user: null, anonToken: OWNER_TOKEN });
    expect(result?.sourceRemoved).toBe(false);
    expect(JSON.stringify(result)).not.toContain("camille@ortie.fr");
  });

  it("fichier déposé supprimé : signalé", async () => {
    db.analyses.get(ANON_ID)!.deal.deal_documents = [];
    expect(await loadResultForViewer(ANON_ID, { user: null, anonToken: OWNER_TOKEN })).toMatchObject({ sourceRemoved: true, sourceType: "image" });
  });
});
