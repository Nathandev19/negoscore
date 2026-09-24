import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { lockAnalysis } from "@/lib/analysis/lock";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { sampleAnalysis } from "@/lib/sample-analysis";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { SHARE_CARD_SITE, shareCardAvailable, shareCardElement, shareCardTexts } from "@/lib/share-card/element";
import { analysisSchema } from "@/lib/schema";

// Carte partageable : contenu fermé (aucune donnée personnelle, pas le nom de
// la marque) et accès réservé au propriétaire de l'analyse.

const db = vi.hoisted(() => ({ analyses: new Map<string, { payload: unknown; deal: Record<string, unknown> }>() }));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));
const rendered = vi.hoisted(() => ({ calls: 0, last: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    if (table !== "analyses") return [];
    const row = db.analyses.get(query.match(/id=eq\.([^&]+)/)?.[1] ?? "");
    return row ? [row] : [];
  },
}));
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));
// Le rendu PNG lui-même (satori) est vérifié dans le navigateur ; ici, on
// vérifie qui y a accès.
vi.mock("@/lib/share-card/render", () => ({
  renderShareCard: async (analysis: unknown, headers: Record<string, string>) => {
    rendered.calls += 1;
    rendered.last = analysis;
    return new Response("png", { status: 200, headers: { "Content-Type": "image/png", ...headers } });
  },
}));

const { GET } = await import("@/app/analyse/resultat/[id]/carte/route");

const ANON_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_TOKEN = "jeton-du-navigateur-auteur";

// Analyse chargée de données personnelles et du nom de la marque, pour
// vérifier qu'aucune n'atteint la carte.
const SENSITIVE = {
  brand: "Maison Ortie",
  person: "Camille Durand",
  email: "camille@ortie.fr",
};

function sensitiveAnalysis() {
  const base = analysisSchema.parse(sample);
  return {
    ...base,
    deal: {
      ...base.deal,
      brand: SENSITIVE.brand,
      deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity: 2, format: `Pour ${SENSITIVE.brand}, contact ${SENSITIVE.email}` }],
      termination: `Résiliation par ${SENSITIVE.person}`,
      governing_law: SENSITIVE.email,
    },
    good_points: [{ label: `Merci ${SENSITIVE.person}`, why: SENSITIVE.email }],
    red_flags: [{ label: `${SENSITIVE.brand} impose tout`, severity: "high" as const, why: SENSITIVE.person }],
    ready_to_send_message: { tone: "cordial", text: `Bonjour ${SENSITIVE.person}, ${SENSITIVE.brand}` },
  };
}

// Toutes les chaînes du rendu, props comprises (alt, src…).
function allStrings(node: ReactNode): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(allStrings);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === "function") return allStrings((node.type as (p: unknown) => ReactNode)(props));
  return Object.entries(props).flatMap(([key, value]) =>
    key === "children" ? allStrings(value as ReactNode) : typeof value === "string" ? [value] : [],
  );
}

beforeEach(() => {
  db.analyses.clear();
  user.current = null;
  rendered.calls = 0;
  db.analyses.set(ANON_ID, { payload: sensitiveAnalysis(), deal: { id: "d1", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "x", deal_documents: [] } });
  db.analyses.set(ACCOUNT_ID, { payload: sensitiveAnalysis(), deal: { id: "d2", anon_token: OWNER_TOKEN, user_id: "user-a", source_type: "text", raw_text: "x", deal_documents: [] } });
});

function get(id: string, cookie: string | null, query = "") {
  return GET(new Request(`http://localhost:3000/analyse/resultat/${id}/carte${query}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });
}

describe("contenu de la carte", () => {
  it("ni le nom de la marque, ni un nom, ni un email : même quand l'analyse en contient partout", () => {
    const analysis = sensitiveAnalysis();
    for (const view of [analysis, lockAnalysis(analysis)]) {
      const text = allStrings(shareCardElement(view)).join(" | ");
      for (const value of Object.values(SENSITIVE)) expect(text).not.toContain(value);
      expect(text).not.toMatch(/@/);
      expect(text).toContain(SHARE_CARD_SITE);
    }
  });

  it("rien d'autre que le signe, le site, le score, la pastille, la jauge, l'offre, la valeur, le niveau et les livrables", () => {
    const texts = shareCardTexts(sensitiveAnalysis());
    expect(Object.keys(texts).sort()).toEqual(["deliverables", "pill", "proposes", "score", "tier", "worth"]);
    expect(texts.score).toBe("32");
    expect(texts.pill).toBe("Deal faible");
    expect(texts.proposes?.replace(/\s/g, " ")).toBe("Elle propose 300 €");
    expect(texts.worth?.replace(/\s/g, " ")).toBe("Ça vaut 510 € – 1 100 €");
    // Le champ libre « format » n'est jamais recopié.
    expect(texts.deliverables).toBe("2 vidéos TikTok");
    // Le niveau nomme une ligne de la table, jamais une personne.
    expect(texts.tier).toBe("Niveau : Déjà des collabs payées");
  });

  it("pas de carte vide : ni « unpriced » ni « incomplete » ; les états chiffrés en ont une", () => {
    // Mission #116 — la règle porte sur l'ÉVALUABILITÉ, pas sur le nom de
    // l'aperçu : l'offre à commission est « unpriced » (aucun montant proposé),
    // et n'a donc pas de carte. Une carte pour une offre à commission
    // laisserait croire à un montant que le produit refuse de chiffrer.
    for (const state of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(state);
      const chiffrable = analysis.evaluability !== "incomplete" && analysis.evaluability !== "unpriced";
      expect(shareCardAvailable(analysis), state).toBe(chiffrable);
    }
    expect(previewAnalysis("commission").analysis.evaluability).toBe("unpriced");
  });
});

describe("accès à la carte : même règle que la suppression", () => {
  it("un autre visiteur, avec son propre cookie : introuvable, rien n'est rendu", async () => {
    expect((await get(ANON_ID, "deal_anon_token=un-autre-navigateur")).status).toBe(404);
    expect(rendered.calls).toBe(0);
  });

  it("un visiteur sans cookie, même avec l'identifiant exact : introuvable", async () => {
    expect((await get(ANON_ID, null)).status).toBe(404);
    expect(rendered.calls).toBe(0);
  });

  it("un identifiant inexistant ou mal formé : introuvable", async () => {
    expect((await get(MISSING_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect((await get("pas-un-uuid", `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect(rendered.calls).toBe(0);
  });

  it("une analyse rattachée à un compte : ni le cookie anonyme, ni un autre compte ne suffisent", async () => {
    expect((await get(ACCOUNT_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    user.current = { id: "user-b", email: "b@example.com" };
    expect((await get(ACCOUNT_ID, null)).status).toBe(404);
    expect(rendered.calls).toBe(0);
    user.current = { id: "user-a", email: "a@example.com" };
    const response = await get(ACCOUNT_ID, null);
    expect(response.status).toBe(200);
  });

  it("offre sans montant (« unpriced ») : même le propriétaire n'obtient pas de carte vide", async () => {
    const base = sensitiveAnalysis();
    db.analyses.set(ANON_ID, {
      payload: { ...base, evaluability: "unpriced", score: null, deal: { ...base.deal, payment: { ...base.deal.payment, amount_eur: null } } },
      deal: { id: "d1", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "x", deal_documents: [] },
    });
    expect((await get(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect(rendered.calls).toBe(0);
  });

  it("l'auteur anonyme : image téléchargeable, jamais mise en cache partagé", async () => {
    const response = await get(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rendered.calls).toBe(1);
  });
});

describe("B2 — la carte porte le niveau choisi", () => {
  const CURRENT_ID = "33333333-3333-4333-8333-333333333333";
  const owner = `deal_anon_token=${OWNER_TOKEN}`;

  beforeEach(() => {
    db.analyses.set(CURRENT_ID, { payload: sampleAnalysis, deal: { id: "d3", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "x", deal_documents: [] } });
  });

  it("?niveau= : chiffres recalculés par le serveur à ce niveau, et le niveau écrit sur la carte", async () => {
    // L'exemple est au niveau par défaut (starter) : la carte est demandée au niveau confirmé.
    expect((await get(CURRENT_ID, owner, "?niveau=confirmed")).status).toBe(200);
    // Auteur anonyme : vue verrouillée, recalculée au niveau demandé.
    const expected = recomputeForTier(lockAnalysis(sampleAnalysis), "confirmed");
    expect(rendered.last).toEqual(expected);
    const texts = shareCardTexts(expected);
    expect(texts.tier).toBe("Niveau : Déjà des collabs payées");
    expect(shareCardTexts(sampleAnalysis).tier).toBe("Niveau : Je débute");
    expect(texts.worth).not.toBe(shareCardTexts(sampleAnalysis).worth);
  });

  it("sans paramètre ou niveau inconnu : le niveau de l'analyse enregistrée", async () => {
    await get(CURRENT_ID, owner);
    expect(rendered.last).toEqual(lockAnalysis(sampleAnalysis));
    await get(CURRENT_ID, owner, "?niveau=nano");
    expect(rendered.last).toEqual(lockAnalysis(sampleAnalysis));
  });

  it("le niveau ne donne accès à rien de plus : un autre visiteur reste refusé", async () => {
    expect((await get(CURRENT_ID, "deal_anon_token=un-autre", "?niveau=starter")).status).toBe(404);
  });
});
