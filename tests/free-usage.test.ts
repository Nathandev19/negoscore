import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionError, MissingApiKeyError } from "@/lib/llm/extract";
import { classifyModelError, modelFailureMessage } from "@/lib/llm/errors";

// Compteur durable des gratuités et droits d'analyse, sans réseau : une base en
// mémoire remplace Supabase (deals, crédits, free_usage).
const db = vi.hoisted(() => ({
  deals: [] as Array<{ id: string; user_id: string | null; anon_token: string | null; status: string }>,
  credits: new Map<string, { plan: string; balance: number; period_end: string | null }>(),
  freeUsage: new Map<string, number>(),
  freeUsageTable: true,
  guard: new Map<string, number>(),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const missing = () => new actual.SupabaseRequestError("table absente", 404, "PGRST205");
  const ownerMatch = (query: string, deal: (typeof db.deals)[number]) => {
    const user = query.match(/user_id=eq\.([^&]+)/)?.[1];
    const token = query.match(/anon_token=eq\.([^&]+)/)?.[1];
    return (user ? deal.user_id === user : true) && (token ? deal.anon_token === decodeURIComponent(token) : true) && deal.status === "analysed";
  };
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table === "free_usage") {
        if (!db.freeUsageTable) throw missing();
        const hash = query.match(/subject_hash=eq\.([^&]+)/)?.[1] ?? "";
        return db.freeUsage.has(hash) ? [{ used: db.freeUsage.get(hash) }] : [];
      }
      if (table === "credits") {
        const user = query.match(/user_id=eq\.([^&]+)/)?.[1] ?? "";
        return db.credits.has(user) ? [db.credits.get(user)] : [];
      }
      if (table === "deals") return db.deals.filter((d) => ownerMatch(query, d)).map((d) => ({ id: d.id }));
      return [];
    },
    countRows: async (table: string, query: string) => (table === "deals" ? db.deals.filter((d) => ownerMatch(query, d)).length : 0),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "usage_guard_hit") {
        const key = String(args.p_ip_hash);
        const count = (db.guard.get(key) ?? 0) + 1;
        db.guard.set(key, count);
        return [{ allowed: count <= Number(args.p_limit), hit_count: count, retry_after_seconds: 60 }];
      }
      if (!db.freeUsageTable) throw missing();
      if (fn === "free_usage_consume") {
        const key = String(args.p_subject_hash);
        const used = db.freeUsage.get(key) ?? 0;
        if (used >= Number(args.p_limit)) return false;
        db.freeUsage.set(key, used + 1);
        return true;
      }
      return null;
    },
    adjustInteger: async (table: string, filter: string, column: string, delta: number, guard: (n: number) => boolean) => {
      if (table === "usage_guard") {
        const key = filter.replace("ip_hash=eq.", "");
        const current = db.guard.get(key) ?? 0;
        if (!guard(current)) return null;
        db.guard.set(key, current + delta);
        return current + delta;
      }
      const user = filter.replace("user_id=eq.", "");
      const row = db.credits.get(user);
      if (!row || !guard(row.balance)) return null;
      row.balance += delta;
      return row.balance;
    },
  };
});

vi.stubEnv("IP_HASH_SALT", "sel-de-test");
const { reserveAnalysis } = await import("@/lib/billing/entitlement");

const USER = { id: "user-gratuit", email: "g@example.com" };
const IP = "203.0.113.9";

beforeEach(() => {
  db.deals = [];
  db.credits.clear();
  db.freeUsage.clear();
  db.freeUsageTable = true;
  db.guard.clear();
});

// Le parcours d'une analyse réussie, tel que le fait la route : vérifier, enregistrer, décompter.
async function analyse(owner: { user?: typeof USER; token?: string }) {
  const grant = await reserveAnalysis({ user: owner.user ?? null, anonToken: owner.token ?? null, commitAnonToken: owner.token ?? null, ip: IP });
  if (!grant.allowed) return grant;
  const deal = { id: `deal-${db.deals.length + 1}`, user_id: owner.user?.id ?? null, anon_token: owner.token ?? null, status: "analysed" };
  db.deals.push(deal);
  expect(await grant.commit()).toBe(true);
  return { ...grant, dealId: deal.id };
}

function deleteDeal(id: string) {
  db.deals = db.deals.filter((d) => d.id !== id);
}

describe("gratuité : un compteur durable, pas les lignes vivantes", () => {
  it("compte gratuit : analyser, supprimer, réessayer → refusé", async () => {
    db.credits.set(USER.id, { plan: "free", balance: 0, period_end: null });
    const first = await analyse({ user: USER });
    expect(first.allowed).toBe(true);
    deleteDeal((first as { dealId: string }).dealId);
    expect(db.deals).toEqual([]);

    const again = await reserveAnalysis({ user: USER, anonToken: null, ip: IP });
    expect(again).toMatchObject({ allowed: false, reason: "no_credit" });
  });

  it("visiteur anonyme : analyser, supprimer, réessayer avec le même navigateur → refusé", async () => {
    const first = await analyse({ token: "jeton-a" });
    deleteDeal((first as { dealId: string }).dealId);
    expect(await reserveAnalysis({ user: null, anonToken: "jeton-a", ip: IP })).toMatchObject({ allowed: false, reason: "free_used" });
  });

  it("compte avec un crédit payé restant : accepté après suppression, et le crédit est décompté", async () => {
    db.credits.set(USER.id, { plan: "pack", balance: 2, period_end: null });
    const first = await analyse({ user: USER });
    deleteDeal((first as { dealId: string }).dealId);
    expect(db.credits.get(USER.id)?.balance).toBe(1);
    const again = await analyse({ user: USER });
    expect(again).toMatchObject({ allowed: true, plan: "pack" });
    expect(db.credits.get(USER.id)?.balance).toBe(0);
  });

  it("le compteur ne contient qu'une empreinte et un nombre", async () => {
    await analyse({ token: "jeton-secret-du-navigateur" });
    const [[key, value]] = [...db.freeUsage.entries()];
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("jeton-secret-du-navigateur");
    expect(value).toBe(1);
  });

  it("vérifier ne décompte rien : seul le commit, après l'enregistrement, décompte", async () => {
    db.credits.set(USER.id, { plan: "pack", balance: 1, period_end: null });
    const grant = await reserveAnalysis({ user: USER, anonToken: null, ip: IP });
    expect(grant.allowed).toBe(true);
    expect(db.credits.get(USER.id)?.balance).toBe(1);
    db.credits.get(USER.id)!.balance = 0; // pris entre-temps par une autre analyse
    expect(await (grant as { commit: () => Promise<boolean> }).commit()).toBe(false);
  });

  it("avant la migration 015 : retombe sur le décompte par deals, sans casser", async () => {
    db.freeUsageTable = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = await analyse({ token: "jeton-b" });
    expect(first.allowed).toBe(true);
    expect(await reserveAnalysis({ user: null, anonToken: "jeton-b", ip: IP })).toMatchObject({ allowed: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("free_usage_missing"));
    warn.mockRestore();
  });
});

describe("classement des échecs du modèle", () => {
  it("chaque panne a sa cause, et le bon message", () => {
    const quota = classifyModelError(new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "q", new Headers()));
    expect(quota).toMatchObject({ kind: "unavailable", event: "analyse_failed_quota", status: 429, provider: "openai" });
    expect(classifyModelError(new OpenAI.RateLimitError(429, { code: "rate_limit_exceeded" }, "r", new Headers()))?.event).toBe("analyse_failed_rate_limit");
    expect(classifyModelError(new OpenAI.APIConnectionTimeoutError())).toMatchObject({ kind: "timeout", event: "analyse_failed_timeout" });
    expect(classifyModelError(new OpenAI.APIUserAbortError())).toMatchObject({ kind: "timeout" });
    expect(classifyModelError(new OpenAI.InternalServerError(503, {}, "p", new Headers()))?.event).toBe("analyse_failed_provider_error");
    expect(classifyModelError(new OpenAI.AuthenticationError(401, { code: "invalid_api_key" }, "k", new Headers()))?.event).toBe("analyse_failed_auth");
    expect(classifyModelError(new MissingApiKeyError("absente"))?.event).toBe("analyse_failed_missing_key");
    expect(classifyModelError(new ExtractionError("sortie"))?.event).toBe("analyse_failed_invalid_output");
    expect(classifyModelError(new Error("autre"))).toBeNull();
  });

  it("messages : jamais de code, jamais la faute de l'utilisateur, le droit est rassuré", () => {
    expect(modelFailureMessage("unavailable", "pack")).toBe(
      "L'analyse est momentanément indisponible. Ta négociation n'a pas été décomptée, réessaie dans quelques minutes.",
    );
    expect(modelFailureMessage("timeout", "free")).toContain("Ton analyse gratuite n'a pas été utilisée");
    expect(modelFailureMessage("unavailable", "pro")).toContain("n'a pas été décomptée de ton abonnement");
    for (const kind of ["unavailable", "timeout"] as const) {
      expect(modelFailureMessage(kind, "pack")).not.toMatch(/\d{3}|erreur|error|ta connexion|vérifie/i);
    }
  });
});
