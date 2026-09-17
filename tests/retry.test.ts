import { beforeEach, describe, expect, it, vi } from "vitest";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import type { Extraction } from "@/lib/llm/prompt";

// Mission #043 : relance gratuite d'une analyse incomplète, par la route réelle
// /api/analyse. Base en mémoire (deals, analyses, free_usage), modèle remplacé
// par des extractions fixes : AUCUN appel au modèle.

type DealRow = { id: string; user_id: string | null; anon_token: string | null; status: string };
type AnalysisRow = {
  id: string;
  deal_id: string;
  payload: { evaluability: string; deal: { brand: string | null } };
  created_at: string;
  retried_at: string | null;
  is_retry: boolean;
  retry_of: string | null;
};

const db = vi.hoisted(() => ({
  deals: [] as DealRow[],
  analyses: [] as AnalysisRow[],
  freeUsage: new Map<string, number>(),
  retryColumns: true,
  seq: 0,
  credits: new Map<string, { plan: string; balance: number; period_end: string | null }>(),
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));
const model = vi.hoisted(() => ({ next: [] as Array<Extraction | Error>, calls: 0 }));

vi.mock("@/lib/llm/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/extract")>();
  return {
    ...actual,
    extractDeal: async () => {
      model.calls += 1;
      const next = model.next.shift();
      if (!next) throw new Error("extraction non prévue par le test");
      if (next instanceof Error) throw next;
      return {
        extraction: next,
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
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => user.current }));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: true, count: 1, retryInMinutes: 0 }),
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/rates/tier-preference", () => ({ preferredTier: async () => "starter" }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const param = (query: string, key: string) => {
    const match = query.match(new RegExp(`(?:^|&)${key}=([^&]+)`));
    return match ? decodeURIComponent(match[1]) : undefined;
  };
  // Valeur d'un filtre « clé=eq.valeur ».
  const eq = (query: string, key: string) => {
    const raw = param(query, key);
    return raw?.startsWith("eq.") ? raw.slice(3) : undefined;
  };
  const missingColumn = () => new actual.SupabaseRequestError("colonne absente", 400, "42703");
  const dealOf = (row: AnalysisRow) => db.deals.find((d) => d.id === row.deal_id)!;
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table === "free_usage") {
        const hash = eq(query, "subject_hash") ?? "";
        return db.freeUsage.has(hash) ? [{ used: db.freeUsage.get(hash) }] : [];
      }
      if (table === "deals") {
        const token = eq(query, "anon_token");
        const owner = eq(query, "user_id");
        return db.deals
          .filter((d) => d.status === "analysed" && (token ? d.anon_token === token : true) && (owner ? d.user_id === owner : true))
          .map((d) => ({ id: d.id }));
      }
      if (table === "credits") {
        const owner = eq(query, "user_id") ?? "";
        return db.credits.has(owner) ? [db.credits.get(owner)] : [];
      }
      if (table === "analyses") {
        if (!db.retryColumns && /retried_at|is_retry|retry_of/.test(query)) throw missingColumn();
        // Quota Pro : analyses du compte, relances exclues si le filtre est demandé.
        const periodOwner = eq(query, "deal.user_id");
        if (periodOwner) {
          return db.analyses
            .filter((a) => dealOf(a).user_id === periodOwner && !(param(query, "is_retry") === "is.false" && a.is_retry))
            .map((a) => ({ id: a.id }));
        }
        const retryOf = eq(query, "retry_of");
        if (retryOf) return db.analyses.filter((a) => a.retry_of === retryOf).map((a) => ({ id: a.id }));
        const row = db.analyses.find((a) => a.id === eq(query, "id"));
        if (!row) return [];
        const deal = dealOf(row);
        return [
          {
            created_at: row.created_at,
            retried_at: row.retried_at,
            is_retry: row.is_retry,
            evaluability: row.payload.evaluability,
            brand: row.payload.deal.brand,
            deal: { anon_token: deal.anon_token, user_id: deal.user_id },
          },
        ];
      }
      return [];
    },
    countRows: async () => 0,
    insertRow: async (table: string, row: Record<string, unknown>) => {
      const id = `00000000-0000-4000-8000-${String(++db.seq).padStart(12, "0")}`;
      if (table === "deals") {
        db.deals.push({ id, user_id: (row.user_id as string) ?? null, anon_token: (row.anon_token as string) ?? null, status: String(row.status) });
      }
      if (table === "analyses") {
        if (!db.retryColumns && "retry_of" in row) throw missingColumn();
        if (row.retry_of && db.analyses.some((a) => a.retry_of === row.retry_of)) {
          throw new actual.SupabaseRequestError("doublon", 409, "23505");
        }
        db.analyses.push({
          id,
          deal_id: String(row.deal_id),
          payload: row.payload as AnalysisRow["payload"],
          created_at: new Date().toISOString(),
          retried_at: null,
          is_retry: row.is_retry === true,
          retry_of: (row.retry_of as string) ?? null,
        });
      }
      return { id };
    },
    updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
      if (table === "deals") return [];
      if (!db.retryColumns) throw new actual.SupabaseRequestError("colonne absente", 400, "PGRST204");
      const rows = db.analyses.filter((a) => {
        if (a.id !== eq(filter, "id")) return false;
        const retried = param(filter, "retried_at");
        if (retried === "is.null" && a.retried_at !== null) return false;
        if (retried?.startsWith("eq.") && a.retried_at !== retried.slice(3)) return false;
        if (param(filter, "is_retry") === "is.false" && a.is_retry) return false;
        return true;
      });
      for (const row of rows) row.retried_at = (patch.retried_at as string | null) ?? null;
      return rows.map((r) => ({ id: r.id }));
    },
    deleteRows: async (table: string, filter: string) => {
      const id = eq(filter, "id");
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
const { reserveAnalysis } = await import("@/lib/billing/entitlement");
const { freeSubjectHash } = await import("@/lib/billing/free-usage");
const { claimRetry, decideRetry, retryStateFor, RETRY_WINDOW_DAYS, sameOffer } = await import("@/lib/analysis/retry");

const TOKEN = "jeton-du-navigateur-auteur";
const OTHER_TOKEN = "jeton-d-un-autre-navigateur";
const OFFER_TEXT = "Bonjour, on aimerait une collaboration avec toi, dis-nous ce que tu en penses.";

function extraction(overrides: { deliverables?: Extraction["deal"]["deliverables"]; brand?: string | null } = {}): Extraction {
  const base = structuredClone(sampleExtraction) as unknown as Extraction;
  return {
    ...base,
    deal: {
      ...base.deal,
      ...(overrides.deliverables ? { deliverables: overrides.deliverables } : {}),
      ...(overrides.brand !== undefined ? { brand: overrides.brand } : {}),
    },
  };
}
const INCOMPLETE = () => extraction({ deliverables: [] });
const COMPLETE = () => extraction();

async function analyse(body: Record<string, unknown>, token: string | null = TOKEN) {
  const response = await POST(
    new Request("http://localhost:3000/api/analyse", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { cookie: `deal_anon_token=${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const freeUsed = (token = TOKEN) => db.freeUsage.get(freeSubjectHash({ kind: "anon", token })) ?? 0;
const row = (id: unknown) => db.analyses.find((a) => a.id === id)!;

// Première analyse gratuite, qui ressort incomplète.
async function incompleteOriginal(): Promise<string> {
  model.next.push(INCOMPLETE());
  const first = await analyse({ text: OFFER_TEXT });
  expect(first.status).toBe(200);
  expect(row(first.body.analysisId).payload.evaluability).toBe("incomplete");
  expect(freeUsed()).toBe(1);
  return first.body.analysisId as string;
}

beforeEach(() => {
  db.deals = [];
  db.analyses = [];
  db.freeUsage.clear();
  db.retryColumns = true;
  db.credits.clear();
  user.current = null;
  model.next = [];
  model.calls = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});

describe("relance d'une analyse incomplète", () => {
  it("incomplète puis relance complète : un seul droit gratuit décompté, la relance est liée à l'origine", async () => {
    const originId = await incompleteOriginal();
    model.next.push(COMPLETE());
    const retry = await analyse({ text: `${OFFER_TEXT} 2 vidéos TikTok, 300 €, droits pub 6 mois.`, retryOf: originId });
    expect(retry.status).toBe(200);
    expect(retry.body.meta).toMatchObject({ retry: true });
    expect(row(retry.body.analysisId)).toMatchObject({ is_retry: true, retry_of: originId });
    expect(row(retry.body.analysisId).payload.evaluability).toBe("complete");
    expect(row(originId).retried_at).not.toBeNull();
    // Compteur durable exact : 1, pas 2.
    expect(freeUsed()).toBe(1);
    // Et la relance n'a pas ouvert de nouveau droit : une analyse normale est refusée.
    const third = await analyse({ text: OFFER_TEXT });
    expect(third.status).toBe(402);
    expect(third.body.reason).toBe("free_used");
    expect(freeUsed()).toBe(1);
  });

  it("incomplète deux fois : la relance incomplète ne rouvre pas de troisième droit, et le dit", async () => {
    const originId = await incompleteOriginal();
    model.next.push(INCOMPLETE());
    const retry = await analyse({ text: `${OFFER_TEXT} Toujours flou.`, retryOf: originId });
    expect(retry.status).toBe(200);
    expect(row(retry.body.analysisId).payload.evaluability).toBe("incomplete");

    const callsBefore = model.calls;
    const retryOfRetry = await analyse({ text: `${OFFER_TEXT} Encore.`, retryOf: retry.body.analysisId });
    expect(retryOfRetry.status).toBe(409);
    expect(retryOfRetry.body.reason).toBe("retry_retry_still_incomplete");
    const again = await analyse({ text: `${OFFER_TEXT} Encore.`, retryOf: originId });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("retry_used");
    expect(model.calls).toBe(callsBefore);
    expect(freeUsed()).toBe(1);

    // Ce que la page de résultat de la relance affiche.
    expect(await retryStateFor(retry.body.analysisId as string)).toMatchObject({ kind: "retry_still_incomplete" });
    expect(await retryStateFor(originId)).toMatchObject({ kind: "used", retryId: retry.body.analysisId });
  });

  it("relance par quelqu'un d'autre : introuvable, aucun appel au modèle, rien de réservé", async () => {
    const originId = await incompleteOriginal();
    const other = await analyse({ text: OFFER_TEXT, retryOf: originId }, OTHER_TOKEN);
    expect(other.status).toBe(404);
    const noCookie = await analyse({ text: OFFER_TEXT, retryOf: originId }, null);
    expect(noCookie.status).toBe(404);
    user.current = { id: "user-b", email: "b@example.com" };
    expect((await analyse({ text: OFFER_TEXT, retryOf: originId }, null)).status).toBe(404);
    expect(model.calls).toBe(1);
    expect(row(originId).retried_at).toBeNull();
    expect(freeUsed(OTHER_TOKEN)).toBe(0);
  });

  it("relance d'une analyse déjà relancée : refusée avant l'appel au modèle", async () => {
    const originId = await incompleteOriginal();
    model.next.push(COMPLETE());
    expect((await analyse({ text: OFFER_TEXT, retryOf: originId })).status).toBe(200);
    const calls = model.calls;
    const second = await analyse({ text: OFFER_TEXT, retryOf: originId });
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe("retry_used");
    expect(model.calls).toBe(calls);
    expect(freeUsed()).toBe(1);
  });

  it("supprimer la relance ne rouvre pas le droit", async () => {
    const originId = await incompleteOriginal();
    model.next.push(COMPLETE());
    const retry = await analyse({ text: OFFER_TEXT, retryOf: originId });
    const retryDeal = row(retry.body.analysisId).deal_id;
    db.deals = db.deals.filter((d) => d.id !== retryDeal);
    db.analyses = db.analyses.filter((a) => a.deal_id !== retryDeal);
    const again = await analyse({ text: OFFER_TEXT, retryOf: originId });
    expect(again.status).toBe(409);
    expect(freeUsed()).toBe(1);
  });

  it("échec du modèle pendant la relance : la relance est rendue, rien n'est décompté", async () => {
    const { ExtractionError } = await import("@/lib/llm/extract");
    const originId = await incompleteOriginal();
    model.next.push(new ExtractionError("sortie invalide"));
    const failed = await analyse({ text: OFFER_TEXT, retryOf: originId });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toContain("Ta relance gratuite n'a pas été utilisée");
    expect(row(originId).retried_at).toBeNull();
    expect(db.analyses.filter((a) => a.is_retry)).toEqual([]);
    model.next.push(COMPLETE());
    expect((await analyse({ text: OFFER_TEXT, retryOf: originId })).status).toBe(200);
    expect(freeUsed()).toBe(1);
  });

  it("autre marque que l'offre d'origine : refusée sans rien décompter, la relance reste disponible", async () => {
    const originId = await incompleteOriginal();
    model.next.push(extraction({ brand: "Une Tout Autre Marque" }));
    const different = await analyse({ text: OFFER_TEXT, retryOf: originId });
    expect(different.status).toBe(422);
    expect(different.body.reason).toBe("retry_different_offer");
    expect(row(originId).retried_at).toBeNull();
    expect(db.analyses).toHaveLength(1);
    expect(freeUsed()).toBe(1);
  });

  it("seule une analyse incomplète se relance ; texte seulement ; identifiant invalide", async () => {
    model.next.push(COMPLETE());
    const complete = await analyse({ text: OFFER_TEXT });
    expect((await analyse({ text: OFFER_TEXT, retryOf: complete.body.analysisId })).status).toBe(400);
    expect((await analyse({ storagePath: "x/y.pdf", retryOf: complete.body.analysisId })).status).toBe(400);
    expect((await analyse({ text: OFFER_TEXT, retryOf: "pas-un-uuid" })).status).toBe(404);
    expect(model.calls).toBe(1);
  });

  it("au-delà de la fenêtre : refusée, avec le délai dans le message", async () => {
    const originId = await incompleteOriginal();
    row(originId).created_at = new Date(Date.now() - (RETRY_WINDOW_DAYS + 1) * 24 * 3600 * 1000).toISOString();
    const late = await analyse({ text: OFFER_TEXT, retryOf: originId });
    expect(late.status).toBe(409);
    expect(late.body.reason).toBe("retry_expired");
    expect(late.body.error).toContain("14 jours");
  });

  it("deux relances simultanées : une seule obtient la réservation", async () => {
    const originId = await incompleteOriginal();
    const viewer = { user: null, anonToken: TOKEN };
    const [a, b] = await Promise.all([claimRetry(originId, viewer), claimRetry(originId, viewer)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("migration 018 non appliquée : pas de relance proposée, les analyses normales marchent", async () => {
    db.retryColumns = false;
    const originId = await incompleteOriginal();
    expect(await retryStateFor(originId)).toBeNull();
    const refused = await analyse({ text: OFFER_TEXT, retryOf: originId });
    expect(refused.status).toBe(503);
    expect(model.calls).toBe(1);
  });
});

describe("quota Pro : les relances ne comptent pas", () => {
  const PRO = { id: "user-pro", email: "pro@example.com" };
  function seed(analyses: number, retries: number) {
    db.credits.set(PRO.id, { plan: "pro", balance: 0, period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString() });
    db.deals.push({ id: "deal-pro", user_id: PRO.id, anon_token: null, status: "analysed" });
    for (let i = 0; i < analyses + retries; i++) {
      db.analyses.push({
        id: `pro-${i}`,
        deal_id: "deal-pro",
        payload: { evaluability: "complete", deal: { brand: null } },
        created_at: new Date().toISOString(),
        retried_at: null,
        is_retry: i >= analyses,
        retry_of: null,
      });
    }
  }

  it("29 analyses et 1 relance sur un quota de 30 : encore une analyse", async () => {
    seed(29, 1);
    const grant = await reserveAnalysis({ user: PRO, anonToken: null, ip: "203.0.113.9" });
    expect(grant).toMatchObject({ allowed: true, plan: "pro" });
  });

  it("30 analyses hors relances : quota atteint", async () => {
    seed(30, 0);
    const grant = await reserveAnalysis({ user: PRO, anonToken: null, ip: "203.0.113.9" });
    expect(grant).toMatchObject({ allowed: false, reason: "no_credit" });
  });
});

describe("décision de relance", () => {
  const base = { created_at: "2026-09-17T10:00:00.000Z", retried_at: null, is_retry: false, evaluability: "incomplete" };

  it("fenêtre de 14 jours, bornes comprises", () => {
    expect(decideRetry(base, new Date("2026-10-01T10:00:00.000Z"))).toMatchObject({ kind: "available" });
    expect(decideRetry(base, new Date("2026-10-01T10:00:00.001Z"))).toEqual({ kind: "expired" });
  });

  it("états : autre évaluabilité, déjà relancée, relance incomplète", () => {
    for (const evaluability of ["complete", "unpriced", "terms_unknown"]) {
      expect(decideRetry({ ...base, evaluability })).toEqual({ kind: "not_applicable" });
    }
    expect(decideRetry({ ...base, retried_at: "2026-09-18T10:00:00.000Z" }, new Date("2026-09-18T11:00:00.000Z"))).toEqual({ kind: "used" });
    expect(decideRetry({ ...base, is_retry: true }, new Date("2026-09-18T11:00:00.000Z"))).toEqual({ kind: "retry_still_incomplete" });
  });

  it("même offre : marques égales aux accents, à la casse et à la ponctuation près, ou absentes", () => {
    expect(sameOffer("Maison Ortie", "maison-ortie")).toBe(true);
    expect(sameOffer("Ortie", "Maison Ortie")).toBe(true);
    expect(sameOffer("Crème d'Été", "creme dete")).toBe(true);
    expect(sameOffer(null, "Maison Ortie")).toBe(true);
    expect(sameOffer("Maison Ortie", null)).toBe(true);
    expect(sameOffer("Maison Ortie", "Nova Sportswear")).toBe(false);
  });
});
