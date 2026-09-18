import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import type { Extraction } from "@/lib/llm/prompt";

// Mission #075, A — le formulaire d'analyse envoyé SANS JavaScript. L'action
// serveur est appelée comme le navigateur l'appelle (le texte collé, rien
// d'autre), et elle traverse la VRAIE route /api/analyse : base en mémoire,
// modèle simulé, AUCUN appel au modèle payant. Les protections testées ici
// sont donc celles de la route elle-même, pas une copie.

type DealRow = { id: string; user_id: string | null; anon_token: string | null; status: string; idempotency_key: string | null };

const db = vi.hoisted(() => ({
  deals: [] as DealRow[],
  analyses: [] as Array<{ id: string; deal_id: string }>,
  freeUsage: new Map<string, number>(),
  seq: 0,
}));
const model = vi.hoisted(() => ({ calls: 0 }));
const guard = vi.hoisted(() => ({ allowed: true, keys: [] as string[] }));
const browser = vi.hoisted(() => ({
  cookies: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  ip: "203.0.113.7",
}));
const nav = vi.hoisted(() => ({ redirectedTo: null as string | null }));

vi.mock("@/lib/llm/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/extract")>()),
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
}));
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => null }));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async (key: string) => {
    guard.keys.push(key);
    return { allowed: guard.allowed, count: guard.allowed ? 1 : 6, retryInMinutes: 37 };
  },
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/rates/tier-preference", () => ({ preferredTier: async () => "starter" }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const eq = (query: string, key: string) => {
    const raw = query.match(new RegExp(`(?:^|&)${key}=([^&]+)`))?.[1];
    const value = raw ? decodeURIComponent(raw) : undefined;
    return value?.startsWith("eq.") ? value.slice(3) : undefined;
  };
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
          return db.deals
            .filter((d) => d.idempotency_key === key)
            .map((d) => ({ ...d, analyses: db.analyses.filter((a) => a.deal_id === d.id).map((a) => ({ id: a.id })) }));
        }
        const token = eq(query, "anon_token");
        return db.deals.filter((d) => d.status === "analysed" && (token ? d.anon_token === token : true)).map((d) => ({ id: d.id }));
      }
      return [];
    },
    countRows: async () => 0,
    insertRow: async (table: string, row: Record<string, unknown>) => {
      const id = `00000000-0000-4000-8000-${String(++db.seq).padStart(12, "0")}`;
      if (table === "deals") {
        db.deals.push({
          id,
          user_id: (row.user_id as string) ?? null,
          anon_token: (row.anon_token as string) ?? null,
          status: String(row.status),
          idempotency_key: (row.idempotency_key as string | undefined) ?? null,
        });
      }
      if (table === "analyses") db.analyses.push({ id, deal_id: String(row.deal_id) });
      return { id };
    },
    updateRows: async () => [],
    deleteRows: async () => undefined,
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
// Le navigateur sans JavaScript : ses cookies, son adresse IP.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...browser.cookies.entries()].map(([name, c]) => ({ name, value: c.value })),
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name)?.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => void browser.cookies.set(name, { value, options }),
  }),
  headers: async () => new Headers({ "x-forwarded-for": browser.ip, host: "localhost:3000" }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    nav.redirectedTo = url;
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.stubEnv("IP_HASH_SALT", "sel-de-test");
const { analyseWithoutJs } = await import("@/lib/forms/no-js-actions");

const OFFER = "Bonjour ! On aimerait 2 vidéos TikTok pour notre sérum, 300 €, droits pub 6 mois.";

// Ce que le navigateur envoie : le texte collé, et rien d'autre.
async function submit(text: string) {
  const form = new FormData();
  form.set("text", text);
  nav.redirectedTo = null;
  try {
    return await analyseWithoutJs({ status: "idle" }, form);
  } catch (caught) {
    if (caught instanceof Error && caught.message === "NEXT_REDIRECT") return "redirection";
    throw caught;
  }
}

beforeEach(() => {
  db.deals = [];
  db.analyses = [];
  db.freeUsage.clear();
  db.seq = 0;
  model.calls = 0;
  guard.allowed = true;
  guard.keys = [];
  browser.cookies.clear();
  browser.ip = "203.0.113.7";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("formulaire d'analyse sans JavaScript", () => {
  it("le formulaire est envoyable par le navigateur seul : action serveur et champ nommé", () => {
    const source = readFileSync(path.join(process.cwd(), "components/deal-input.tsx"), "utf8");
    expect(source).toContain("action={noJsAction}");
    expect(source).toMatch(/aria-label="Message de la marque"\s+name="text"/);
  });

  it("envoi réussi : l'analyse est faite par la route, et la personne arrive sur son résultat", async () => {
    expect(await submit(OFFER)).toBe("redirection");
    expect(model.calls).toBe(1);
    expect(nav.redirectedTo).toBe(`/analyse/resultat/${db.analyses[0].id}`);
  });

  it("texte trop court : message du serveur, et le texte collé est rendu tel quel", async () => {
    const state = await submit("trop court");
    expect(state).toMatchObject({ status: "error", message: "Colle au moins 20 caractères du message de la marque.", text: "trop court" });
    expect(model.calls).toBe(0);
  });
});

describe("A3 — les protections de la route tiennent sans JavaScript", () => {
  it("cookie anonyme : posé côté serveur à la première analyse, httpOnly, et c'est lui qui porte l'analyse", async () => {
    await submit(OFFER);
    const cookie = browser.cookies.get("deal_anon_token");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.options).toMatchObject({ httpOnly: true, path: "/" });
    expect(db.deals[0].anon_token).toBe(cookie?.value);
  });

  it("limitation du nombre de demandes : par IP (celle du navigateur), refus avec le délai, rien d'appelé, texte gardé", async () => {
    guard.allowed = false;
    const state = await submit(OFFER);
    expect(state).toMatchObject({ status: "error", message: "Tu as lancé 5 analyses en une heure. Réessaie dans 37 min.", text: OFFER });
    expect(model.calls).toBe(0);
    // Deux navigateurs, deux IP : deux compteurs différents.
    browser.ip = "198.51.100.9";
    await submit(OFFER);
    expect(new Set(guard.keys).size).toBeGreaterThan(1);
  });

  it("garde d'utilisation : l'analyse gratuite déjà prise est refusée, avec le lien vers les tarifs, texte gardé", async () => {
    await submit(OFFER); // la gratuite de ce navigateur
    const state = await submit(`${OFFER} Autre offre, autre texte.`);
    expect(state).toMatchObject({ status: "error", paywall: true, text: `${OFFER} Autre offre, autre texte.` });
    expect(model.calls).toBe(1);
  });

  it("clé d'idempotence : le même envoi répété retombe sur la même analyse, sans nouvel appel ni décompte", async () => {
    await submit(OFFER);
    const first = nav.redirectedTo;
    // « Renvoyer le formulaire » : même navigateur (cookie posé), même texte.
    expect(await submit(OFFER)).toBe("redirection");
    expect(nav.redirectedTo).toBe(first);
    expect(model.calls).toBe(1);
    expect(db.analyses).toHaveLength(1);
  });
});
