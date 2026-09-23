import { beforeEach, describe, expect, it, vi } from "vitest";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import type { Extraction } from "@/lib/llm/prompt";
import { tooManyOpenings } from "@/lib/content/vocabulaire";
import { OPENINGS_ACCOUNT, OPENINGS_ANON } from "@/lib/security/limite";

// Mission #060 partie A — une requête perdue en route ne doit plus coûter un
// droit ni une analyse. La route réelle /api/analyse est appelée, avec une base
// en mémoire et un modèle simulé : AUCUN appel au modèle payant.

type DealRow = {
  id: string;
  user_id: string | null;
  anon_token: string | null;
  status: string;
  idempotency_key: string | null;
};
type AnalysisRow = { id: string; deal_id: string; payload: unknown };

const db = vi.hoisted(() => ({
  deals: [] as DealRow[],
  analyses: [] as AnalysisRow[],
  freeUsage: new Map<string, number>(),
  // Migration 019 appliquée ou non.
  idempotencyColumn: true,
  seq: 0,
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));
const model = vi.hoisted(() => ({ calls: 0 }));
// Mission #102, partie B : ce que le filet horaire répond, et sur quelle clé
// il a été interrogé.
const filet = vi.hoisted(() => ({ allowed: true, keys: [] as string[], limits: [] as number[] }));

vi.mock("@/lib/llm/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/extract")>();
  return {
    ...actual,
    extractDeal: async () => {
      model.calls += 1;
      return {
        extraction: structuredClone(sampleExtraction) as unknown as Extraction,
        model: "test",
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        reasoningEffort: null,
        textVerbosity: "low",
        costEur: 0,
        latencyMs: 1,
        schemaValidFirstTry: true,
        attempts: 1,
      };
    },
  };
});
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async (key: string, options?: { limit?: number }) => {
    filet.keys.push(key);
    filet.limits.push(options?.limit ?? 0);
    return { allowed: filet.allowed, count: filet.allowed ? 1 : 6, retryInMinutes: 47 };
  },
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/rates/tier-preference", () => ({ preferredTier: async () => "starter" }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const param = (query: string, key: string) => {
    const match = query.match(new RegExp(`(?:^|&)${key}=([^&]+)`));
    return match ? decodeURIComponent(match[1]) : undefined;
  };
  const eq = (query: string, key: string) => {
    const raw = param(query, key);
    return raw?.startsWith("eq.") ? raw.slice(3) : undefined;
  };
  const missingColumn = () => new actual.SupabaseRequestError("colonne absente", 400, "42703");
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table === "free_usage") {
        const hash = eq(query, "subject_hash") ?? "";
        return db.freeUsage.has(hash) ? [{ used: db.freeUsage.get(hash) }] : [];
      }
      if (table === "deals") {
        const key = eq(query, "idempotency_key");
        if (key !== undefined) {
          if (!db.idempotencyColumn) throw missingColumn();
          return db.deals
            .filter((d) => d.idempotency_key === key)
            .map((d) => ({
              id: d.id,
              user_id: d.user_id,
              anon_token: d.anon_token,
              analyses: db.analyses.filter((a) => a.deal_id === d.id).map((a) => ({ id: a.id })),
            }));
        }
        const token = eq(query, "anon_token");
        const owner = eq(query, "user_id");
        return db.deals
          .filter((d) => d.status === "analysed" && (token ? d.anon_token === token : true) && (owner ? d.user_id === owner : true))
          .map((d) => ({ id: d.id }));
      }
      return [];
    },
    countRows: async () => 0,
    insertRow: async (table: string, row: Record<string, unknown>) => {
      const id = `00000000-0000-4000-8000-${String(++db.seq).padStart(12, "0")}`;
      if (table === "deals") {
        const key = (row.idempotency_key as string | undefined) ?? null;
        if (key !== null && !db.idempotencyColumn) throw missingColumn();
        // Index unique de la migration 019.
        if (key !== null && db.deals.some((d) => d.idempotency_key === key)) {
          throw new actual.SupabaseRequestError("doublon", 409, "23505");
        }
        db.deals.push({
          id,
          user_id: (row.user_id as string) ?? null,
          anon_token: (row.anon_token as string) ?? null,
          status: String(row.status),
          idempotency_key: key,
        });
      }
      if (table === "analyses") db.analyses.push({ id, deal_id: String(row.deal_id), payload: row.payload });
      return { id };
    },
    updateRows: async () => [],
    deleteRows: async (table: string, filter: string) => {
      const id = filter.replace("id=eq.", "");
      if (table === "deals") {
        db.deals = db.deals.filter((d) => d.id !== id);
        db.analyses = db.analyses.filter((a) => a.deal_id !== id);
      }
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "free_usage_consume") return null;
      const key = String(args.p_subject_hash);
      const used = db.freeUsage.get(key) ?? 0;
      if (used >= Number(args.p_limit)) return false;
      db.freeUsage.set(key, used + 1);
      return true;
    },
  };
});

vi.stubEnv("IP_HASH_SALT", "sel-de-test");
const { POST } = await import("@/app/api/analyse/route");

const TOKEN = "jeton-du-navigateur-auteur";
const OTHER_TOKEN = "jeton-dun-autre-navigateur";
const OFFER = "Bonjour, on aimerait une collaboration avec toi : 3 vidéos TikTok pour 300 €, dis-nous.";
const KEY = "cle0000000000000000000001";

function post(body: Record<string, unknown>, token: string | null = TOKEN) {
  return POST(
    new Request("https://www.negoscore.fr/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { cookie: `deal_anon_token=${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

async function json(response: Response) {
  return (await response.json()) as { analysisId?: string; error?: string; reason?: string; meta?: { replayed?: boolean } };
}

// Nombre d'analyses gratuites réellement consommées.
function freeConsumed(): number {
  return [...db.freeUsage.values()].reduce((sum, used) => sum + used, 0);
}

beforeEach(() => {
  db.deals = [];
  db.analyses = [];
  db.freeUsage.clear();
  db.idempotencyColumn = true;
  db.seq = 0;
  user.current = null;
  model.calls = 0;
  filet.allowed = true;
  filet.keys = [];
  filet.limits = [];
});

describe("mission #102, partie B — le filet horaire ne compte que les ouvertures", () => {
  it("lancer une analyse compte une ouverture, avec la limite des visiteurs sans compte", async () => {
    const response = await post({ text: OFFER, idempotencyKey: KEY });
    expect(response.status).toBe(200);
    // La première interrogation est l'ouverture, à la limite des visiteurs
    // sans compte. La seconde est le filet anti-abus de la gratuité
    // (lib/billing/entitlement.ts), qui ne concerne que les analyses offertes
    // et reste volontairement strict.
    expect(filet.limits[0]).toBe(OPENINGS_ANON);
    expect(filet.keys).toHaveLength(2);
  });

  it("filet saturé : refusé avant tout, rien n'est appelé ni consommé", async () => {
    filet.allowed = false;
    const response = await post({ text: OFFER, idempotencyKey: KEY });
    expect(response.status).toBe(429);
    const body = await json(response);
    expect(body.reason).toBe("rate_limited");
    // Le message parle de négociations, dit jusqu'à quand, et ne prétend pas
    // que des analyses ont été « lancées » : c'est l'ouverture qui est freinée.
    expect(body.error).toBe(tooManyOpenings(47));
    expect(model.calls).toBe(0);
    expect(freeConsumed()).toBe(0);
    expect(db.analyses).toHaveLength(0);
  });

  it("un compte connecté a son propre compteur, pas celui de son réseau", async () => {
    user.current = { id: "user-a", email: "a@exemple.test" };
    await post({ text: OFFER, idempotencyKey: KEY });
    const premier = filet.keys[0];

    filet.keys = [];
    user.current = { id: "user-b", email: "b@exemple.test" };
    await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000002" });

    // Même adresse, deux comptes : deux compteurs distincts.
    expect(filet.keys[0]).not.toBe(premier);
    expect(filet.limits.at(-1)).toBe(OPENINGS_ACCOUNT);
  });
});

describe("clé d'idempotence d'une analyse", () => {
  it("requête rejouée avec la même clé : un seul droit, un seul appel au modèle, le même résultat", async () => {
    const first = await json(await post({ text: OFFER, idempotencyKey: KEY }));
    expect(first.analysisId).toBeTruthy();
    expect(model.calls).toBe(1);
    expect(freeConsumed()).toBe(1);

    // Le navigateur n'a jamais reçu la réponse : il rejoue avec la même clé.
    const replay = await post({ text: OFFER, idempotencyKey: KEY });
    const body = await json(replay);
    expect(replay.status).toBe(200);
    expect(body.analysisId).toBe(first.analysisId);
    expect(body.meta?.replayed).toBe(true);
    // Rien de plus n'a été payé ni consommé.
    expect(model.calls).toBe(1);
    expect(freeConsumed()).toBe(1);
    expect(db.analyses).toHaveLength(1);
  });

  it("succès serveur mais échec réseau : la reprise retrouve le résultat", async () => {
    // Le serveur a terminé (analyse enregistrée), la réponse s'est perdue.
    await post({ text: OFFER, idempotencyKey: KEY });
    const enregistree = db.analyses[0].id;
    model.calls = 0;

    const reprise = await json(await post({ text: OFFER, idempotencyKey: KEY }));
    expect(reprise.analysisId).toBe(enregistree);
    expect(model.calls).toBe(0);
    expect(db.analyses).toHaveLength(1);
  });

  it("même clé depuis un autre navigateur : rien n'est rendu", async () => {
    const mine = await json(await post({ text: OFFER, idempotencyKey: KEY }));

    // Un autre jeton anonyme présente la même clé.
    const other = await json(await post({ text: OFFER, idempotencyKey: KEY }, OTHER_TOKEN));
    expect(other.analysisId).toBeTruthy();
    expect(other.analysisId).not.toBe(mine.analysisId);
    // Il a payé sa propre analyse, et n'a rien appris de celle du premier.
    expect(model.calls).toBe(2);
    expect(db.analyses).toHaveLength(2);
    // La clé reste attachée à la première analyse.
    expect(db.deals.filter((d) => d.idempotency_key === KEY)).toHaveLength(1);
  });

  it("un compte connecté ne récupère pas l'analyse anonyme d'une clé volée", async () => {
    await post({ text: OFFER, idempotencyKey: KEY });
    user.current = { id: "11111111-1111-4111-8111-111111111111", email: "nina@exemple.fr" };
    const asUser = await json(await post({ text: OFFER, idempotencyKey: KEY }, null));
    expect(asUser.analysisId).toBeTruthy();
    expect(db.analyses).toHaveLength(2);
  });

  it("deux clés différentes : deux analyses", async () => {
    const one = await json(await post({ text: OFFER, idempotencyKey: KEY }));
    // Deux demandes distinctes, donc deux clés et deux droits : chacune produit
    // sa propre analyse, aucune n'est rendue à la place de l'autre.
    const two = await json(await post({ text: OFFER, idempotencyKey: "cle0000000000000000000002" }, OTHER_TOKEN));
    expect(one.analysisId).not.toBe(two.analysisId);
    expect(model.calls).toBe(2);
    expect(db.analyses).toHaveLength(2);
  });

  it("sans clé, le comportement d'avant ne change pas", async () => {
    const first = await json(await post({ text: OFFER }));
    expect(first.analysisId).toBeTruthy();
    expect(db.deals[0].idempotency_key).toBeNull();
  });

  it("migration non appliquée : l'analyse passe quand même, sans idempotence", async () => {
    db.idempotencyColumn = false;
    const response = await post({ text: OFFER, idempotencyKey: KEY });
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.analysisId).toBeTruthy();
    expect(db.analyses).toHaveLength(1);
  });

  it("une clé mal formée est ignorée, elle ne fait pas échouer l'analyse", async () => {
    const response = await post({ text: OFFER, idempotencyKey: "trop court" });
    expect(response.status).toBe(200);
    expect(db.deals[0].idempotency_key).toBeNull();
  });
});
