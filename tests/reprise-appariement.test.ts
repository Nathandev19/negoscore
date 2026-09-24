import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/sample-extraction.json";
import type { Extraction } from "@/lib/llm/prompt";
import { nextResume, RESUME_TICK_MS, RECHECK_MIN_MS, revealDelay, type LocalAttempt } from "@/lib/analysis/resume";

// Mission #108 — la reprise doit être immédiate, et les deux événements d'une
// analyse doivent être appariés.

// ─── A — la reprise ─────────────────────────────────────────────────────────

const CLE = "cle-de-tentative-0000000001";
const DEPART = 1_800_000_000_000;
const RETOUR = DEPART + 70_000;

const local = (patch: Partial<LocalAttempt> = {}): LocalAttempt => ({
  key: CLE,
  startedAt: DEPART,
  lastCheckAt: null,
  checking: false,
  ...patch,
});

describe("A — au retour, la vérification part sans attendre", () => {
  it("serveur déjà terminé : la décision est prise au premier événement, pas au tour suivant", () => {
    // Premier événement de retour : rien n'a encore été vérifié.
    const premier = nextResume({ local: local(), server: null, now: RETOUR });
    expect(premier).toEqual({ action: "verifier", key: CLE });

    // La réponse arrive : on affiche, sans autre attente.
    const decision = nextResume({
      local: local({ lastCheckAt: RETOUR, checking: false }),
      server: { kind: "done", analysisId: "a1" },
      now: RETOUR + 40,
    });
    expect(decision).toEqual({ action: "afficher", analysisId: "a1" });

    // Et l'ouverture ne rejoue aucune animation : elle est immédiate.
    expect(revealDelay("reprise", 720)).toBe(0);
    expect(revealDelay("reponse", 720)).toBe(720);
  });

  it("un aller-retour de deux secondes : la vérification part aussi tout de suite", () => {
    // Aucune période de chauffe : ce qui déclenche, c'est le retour, pas
    // l'ancienneté de la tentative.
    expect(nextResume({ local: local(), server: null, now: DEPART + 500 })).toEqual({ action: "verifier", key: CLE });
    expect(nextResume({ local: local(), server: null, now: DEPART + 2_000 })).toEqual({ action: "verifier", key: CLE });
  });

  it("trois retours en une seconde : un seul appel en vol", () => {
    // Le premier part.
    expect(nextResume({ local: local(), server: null, now: RETOUR }).action).toBe("verifier");
    // Le deuxième arrive pendant que le premier est en vol.
    expect(nextResume({ local: local({ lastCheckAt: RETOUR, checking: true }), server: null, now: RETOUR + 10 }).action).toBe("attendre");
    // Le troisième aussi, même une fois l'appel revenu, tant que la seconde
    // n'est pas écoulée : rien de neuf à demander.
    expect(nextResume({ local: local({ lastCheckAt: RETOUR, checking: false }), server: null, now: RETOUR + 300 }).action).toBe("attendre");
    // Et un appel LENT ne s'en fait pas doubler : même longtemps après, tant
    // qu'il est en vol, rien d'autre ne part.
    expect(nextResume({ local: local({ lastCheckAt: RETOUR, checking: true }), server: null, now: RETOUR + 30_000 }).action).toBe("attendre");
  });

  it("la vérification suivante repart dès la seconde écoulée : un réseau endormi ne fige pas l'écran", () => {
    // Première vérification tombée sur un réseau encore endormi.
    const injoignable = nextResume({ local: local({ lastCheckAt: RETOUR }), server: { kind: "unreachable" }, now: RETOUR + 200 });
    expect(injoignable).toEqual({ action: "attendre" });

    // Le battement relance, sans attendre un nouvel événement de retour.
    const relance = nextResume({ local: local({ lastCheckAt: RETOUR, checking: false }), server: null, now: RETOUR + RECHECK_MIN_MS });
    expect(relance).toEqual({ action: "verifier", key: CLE });
    expect(RESUME_TICK_MS).toBeLessThanOrEqual(RECHECK_MIN_MS);
  });

  it("serveur toujours en cours : l'attente reprend, et rien n'est relancé", () => {
    const decision = nextResume({ local: local({ lastCheckAt: RETOUR }), server: { kind: "unknown" }, now: RETOUR + 100 });
    expect(decision).toEqual({ action: "attendre" });
    // Aucune décision ne relance une analyse : ce module ne sait ni appeler le
    // réseau, ni produire autre chose que les cinq actions prévues.
    const source = readFileSync("lib/analysis/resume.ts", "utf8");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain('method: "POST"');
  });
});

describe("A — la requête d'origine ne retarde pas la reprise", () => {
  const source = readFileSync("components/deal-input.tsx", "utf8");

  it("la reprise conclut par elle-même, sans attendre la requête d'origine", () => {
    // L'appel d'état et la conclusion sont dans le même chemin : rien n'attend
    // la promesse du POST d'origine.
    expect(source).toMatch(/const server = await serverAttempt\(first\.key\);/);
    expect(source).toMatch(/finish\("reprise"\)/);
  });

  it("settledRef protège de la double conclusion, pas de la reprise", () => {
    // La garde est lue AVANT de conclure, jamais avant de vérifier l'état.
    const resync = source.slice(source.indexOf("async function resync()"), source.indexOf("const onBack"));
    expect(resync).toContain("if (stale || settledRef.current) return;");
    expect(resync).toContain("nextResume(");
    // finish() pose la garde, et la pose une seule fois.
    expect(source).toMatch(/if \(!outcome \|\| settledRef\.current\) return;\s*\n\s*settledRef\.current = true;/);
  });

  it("aucun délai, aucun anti-rebond avant le premier appel", () => {
    const resync = source.slice(source.indexOf("async function resync()"), source.indexOf("const onBack"));
    expect(resync).not.toMatch(/setTimeout|delay|debounce|sleep/i);
    // L'écoute couvre les trois événements, et un battement de sécurité.
    expect(source).toContain('document.addEventListener("visibilitychange", onBack)');
    expect(source).toContain('window.addEventListener("pageshow", onBack)');
    expect(source).toContain('window.addEventListener("online", onBack)');
    expect(source).toContain("setInterval(onBack, RESUME_TICK_MS)");
  });
});

// ─── B — les événements appariés ────────────────────────────────────────────

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  events: [] as Row[],
  deals: [] as Row[],
  analyses: [] as Row[],
  free: new Map<string, number>(),
  modelFails: false,
  user: null as { id: string; email: string } | null,
}));

vi.mock("@/lib/llm/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/extract")>()),
  extractDeal: async () => {
    if (db.modelFails) throw new Error("modèle indisponible");
    return {
      extraction: structuredClone(sample) as unknown as Extraction,
      model: "test", inputTokens: 1, outputTokens: 1, reasoningTokens: 0, reasoningEffort: null,
      textVerbosity: "low", costEur: 0, latencyMs: 1, schemaValidFirstTry: true, attempts: 1,
    };
  },
}));
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => db.user));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: true, count: 1, retryInMinutes: 0 }),
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/rates/tier-preference", () => ({ preferredTier: async () => "starter" }));
// Le droit d'analyser n'est pas le sujet de ce fichier : il est accordé, et
// c'est l'appariement des deux événements qui est mis à l'épreuve.
vi.mock("@/lib/billing/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/entitlement")>()),
  reserveAnalysis: async () => ({ allowed: true, plan: "free" as const, commit: async () => true, release: async () => undefined }),
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const eq = (query: string, key: string) => {
    const match = query.match(new RegExp(`(?:^|&)${key}=eq\\.([^&]+)`));
    return match ? decodeURIComponent(match[1]) : undefined;
  };
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table === "deals") {
        const key = eq(query, "idempotency_key");
        if (key) {
          const deal = db.deals.find((row) => row.idempotency_key === key);
          return deal ? [{ ...deal, analyses: db.analyses.filter((a) => a.deal_id === deal.id).map((a) => ({ id: a.id })) }] : [];
        }
        return [];
      }
      if (table === "free_usage") return [{ used: db.free.get("u") ?? 0 }];
      return [];
    },
    insertRow: async (table: string, row: Row) => {
      const saved = { id: `${table}-${(table === "deals" ? db.deals : db.analyses).length + 1}`, ...row };
      if (table === "deals") db.deals.push(saved);
      else db.analyses.push(saved);
      return saved;
    },
    insertIfAbsent: async (table: string, row: Row) => {
      if (table !== "product_events") return;
      const key = row.dedupe_key;
      if (typeof key === "string" && db.events.some((event) => event.dedupe_key === key)) return;
      db.events.push(row);
    },
    upsertRow: async () => undefined,
    updateRows: async () => [],
    deleteRows: async () => [],
    adjustInteger: async () => undefined,
    countRows: async () => 0,
    rpc: async () => [],
  };
});

const { POST } = await import("@/app/api/analyse/route");

const OFFER = "Bonjour, on te propose 300 € pour 2 vidéos TikTok, avec les droits pub 6 mois.";

function post(body: Record<string, unknown>, cookie?: string) {
  return POST(
    new Request("https://negoscore.fr/api/analyse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.7",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

// Le jeton anonyme posé par la première réponse : sans lui, le rejeu vient
// d'un autre navigateur et n'est plus un rejeu.
function anonCookie(response: Response): string {
  const posed = response.headers.getSetCookie().find((value) => value.startsWith("deal_anon_token="));
  return posed ? posed.split(";")[0] : "";
}

const named = (name: string) => db.events.filter((event) => event.event_name === name);

beforeEach(() => {
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
  db.events = [];
  db.deals = [];
  db.analyses = [];
  db.free = new Map();
  db.modelFails = false;
  db.user = null;
});

describe("B — un lancement, une fin, le même identifiant", () => {
  it("une analyse menée à son terme : exactement un de chaque, appariés", async () => {
    const response = await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000001" });
    expect(response.status).toBe(200);

    expect(named("analysis_started")).toHaveLength(1);
    expect(named("analysis_completed")).toHaveLength(1);
    const [started] = named("analysis_started");
    const [completed] = named("analysis_completed");
    // LE point de la mission : un seul identifiant relie les deux bouts.
    expect(started.entity_id).toBe(completed.entity_id);
    expect(started.entity_type).toBe("analysis_run");
    expect(completed.entity_type).toBe("analysis_run");
    expect(String(started.entity_id)).toHaveLength(36);
    // L'identifiant de l'analyse reste lisible, en métadonnée.
    expect((completed.metadata as Row).analysis_id).toBe(db.analyses[0].id);
  });

  it("une analyse qui échoue : un lancement, aucune fin", async () => {
    db.modelFails = true;
    await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000002" });

    expect(named("analysis_started")).toHaveLength(1);
    expect(named("analysis_completed")).toHaveLength(0);
  });

  it("un rejeu idempotent : aucun événement supplémentaire", async () => {
    const premiere = await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000003" });
    const avant = db.events.length;

    const rejeu = await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000003" }, anonCookie(premiere));
    expect((await rejeu.json()).meta?.replayed).toBe(true);
    expect(db.events).toHaveLength(avant);
    expect(named("analysis_started")).toHaveLength(1);
    expect(named("analysis_completed")).toHaveLength(1);
  });

  it("deux analyses lancées avec la MÊME clé par des propriétaires différents : deux lancements comptés", async () => {
    // C'est le cas qui produisait « plus de terminées que de lancées » : la
    // clé du navigateur servait de clé de déduplication au lancement.
    await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000004" });
    db.deals[0].anon_token = "un-autre-navigateur";

    await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000004" });
    expect(named("analysis_started")).toHaveLength(2);
    expect(named("analysis_completed")).toHaveLength(2);
  });

  it("Do Not Track : ni lancement, ni fin", async () => {
    const response = await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000005", doNotTrack: true });
    expect(response.status).toBe(200);
    expect(named("analysis_started")).toHaveLength(0);
    expect(named("analysis_completed")).toHaveLength(0);
    // La symétrie tient : aucun des deux, jamais l'un sans l'autre.
    expect(db.events.filter((event) => String(event.event_name).startsWith("analysis_"))).toHaveLength(0);
  });

  it("un drapeau qui n'est pas exactement vrai ne coupe rien", async () => {
    await post({ text: OFFER, idempotencyKey: "cle-de-test-0000000006", doNotTrack: "oui" });
    expect(named("analysis_started")).toHaveLength(1);
  });

  it("sur une série d'analyses, terminées ≤ lancées, toujours", async () => {
    for (const [index, echoue] of [false, true, false, true, false].entries()) {
      db.modelFails = echoue;
      await post({ text: OFFER, idempotencyKey: `cle-de-test-000000001${index}` });
      expect(named("analysis_completed").length, `après ${index + 1} analyses`).toBeLessThanOrEqual(named("analysis_started").length);
    }
    expect(named("analysis_started")).toHaveLength(5);
    expect(named("analysis_completed")).toHaveLength(3);
  });
});

describe("B — le navigateur n'émet aucun des deux", () => {
  it("les deux événements ne sont écrits que par la route qui exécute l'analyse", () => {
    for (const file of ["components/deal-input.tsx", "components/analytics/first-party-view.tsx", "app/api/events/route.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("analysis_started");
      expect(source, file).not.toContain("analysis_completed");
    }
    // L'endpoint public n'accepte toujours que les deux vues de page.
    expect(readFileSync("app/api/events/route.ts", "utf8")).toContain('["landing_view", "pricing_view"]');
    const route = readFileSync("app/api/analyse/route.ts", "utf8");
    expect(route).toContain("const runId = crypto.randomUUID();");
    expect(route).toContain("dedupeKey: `${event}:${runId}`");
  });
});
