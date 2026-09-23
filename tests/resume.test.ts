import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextResume, RECHECK_MIN_MS, RESUME_DEADLINE_MS, type LocalAttempt } from "@/lib/analysis/resume";

// Mission #102, partie A — une analyse lancée survit à la mise en arrière-plan.
//
// Rejeu du test mobile du 23/09/2026 : on lance l'analyse, on quitte Safari,
// on revient. Rien ici ne touche au réseau : c'est la DÉCISION qui est mise à
// l'épreuve, celle que le composant applique au retour au premier plan.

const CLE = "cle-de-tentative-0000000001";
const DEPART = 1_800_000_000_000;

function local(patch: Partial<LocalAttempt> = {}): LocalAttempt {
  return { key: CLE, startedAt: DEPART, lastCheckAt: null, ...patch };
}

// Une absence longue, mais en deçà du délai au-delà duquel plus rien n'arrive.
const RETOUR = DEPART + 40_000;

describe("retour au premier plan", () => {
  it("1. absence longue, travail terminé pendant l'absence : le résultat s'affiche", () => {
    // Premier geste au retour : demander au serveur, jamais relancer.
    expect(nextResume({ local: local(), server: null, now: RETOUR })).toEqual({ action: "verifier", key: CLE });

    const decision = nextResume({
      local: local({ lastCheckAt: RETOUR }),
      server: { kind: "done", analysisId: "a1" },
      now: RETOUR + 200,
    });
    expect(decision).toEqual({ action: "afficher", analysisId: "a1" });
  });

  it("2. absence longue, travail toujours en cours : l'attente reprend", () => {
    const decision = nextResume({ local: local({ lastCheckAt: RETOUR }), server: { kind: "unknown" }, now: RETOUR + 200 });
    expect(decision).toEqual({ action: "attendre" });
  });

  it("3. absence longue, travail jamais arrivé : échec annoncé, rien n'est relancé", () => {
    const tard = DEPART + RESUME_DEADLINE_MS;
    const decision = nextResume({ local: local({ lastCheckAt: tard }), server: { kind: "unknown" }, now: tard });
    expect(decision).toEqual({ action: "echec" });
    // Et surtout : aucune décision ne demande de relancer une analyse.
    expect(decision.action).not.toBe("relancer");
  });

  it("4. deux retours rapprochés : une seule resynchronisation", () => {
    // Safari envoie visibilitychange PUIS pageshow au retour du cache arrière.
    const premier = nextResume({ local: local(), server: null, now: RETOUR });
    expect(premier).toEqual({ action: "verifier", key: CLE });

    // Le composant note l'instant de la vérification : le second événement,
    // dans la foulée, ne repart pas.
    const second = nextResume({ local: local({ lastCheckAt: RETOUR }), server: null, now: RETOUR + RECHECK_MIN_MS - 1 });
    expect(second).toEqual({ action: "attendre" });

    // Plus tard, un nouveau retour peut redemander.
    const plusTard = nextResume({ local: local({ lastCheckAt: RETOUR }), server: null, now: RETOUR + RECHECK_MIN_MS });
    expect(plusTard).toEqual({ action: "verifier", key: CLE });
  });

  it("5. aucune tentative en cours : rien à rattraper, et rien n'est lancé", () => {
    expect(nextResume({ local: { key: null, startedAt: null, lastCheckAt: null }, server: null, now: RETOUR })).toEqual({ action: "rien" });
    // Clé gardée sans départ (stockage à moitié écrit) : on ne devine pas.
    expect(nextResume({ local: { key: CLE, startedAt: null, lastCheckAt: null }, server: null, now: RETOUR })).toEqual({ action: "rien" });
  });

  it("6. vérification injoignable : on attend, on n'annonce pas un échec qui n'en est pas un", () => {
    const decision = nextResume({ local: local({ lastCheckAt: RETOUR }), server: { kind: "unreachable" }, now: RETOUR + 200 });
    expect(decision).toEqual({ action: "attendre" });
  });

  it("7. le résultat arrive même très tard : il passe devant le délai", () => {
    const tard = DEPART + RESUME_DEADLINE_MS + 60_000;
    expect(nextResume({ local: local({ lastCheckAt: tard }), server: { kind: "done", analysisId: "a2" }, now: tard })).toEqual({
      action: "afficher",
      analysisId: "a2",
    });
  });
});

// ─── La route qui répond, et ce qu'elle ne fait pas ─────────────────────────

const db = vi.hoisted(() => ({
  deals: [] as Array<{ id: string; user_id: string | null; anon_token: string | null; analyses: Array<{ id: string }>; idempotency_key: string }>,
  user: null as { id: string; email: string } | null,
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => db.user));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    if (table !== "deals") throw new Error(table);
    const key = decodeURIComponent(query.match(/idempotency_key=eq\.([^&]+)/)?.[1] ?? "");
    return db.deals.filter((deal) => deal.idempotency_key === key);
  },
}));

const { GET } = await import("@/app/api/analyse/etat/route");

function ask(key: string, cookie: string | null = null): Promise<Response> {
  return GET(
    new Request(`https://negoscore.fr/api/analyse/etat?cle=${encodeURIComponent(key)}`, {
      headers: cookie ? { cookie: `deal_anon_token=${cookie}` } : {},
    }),
  );
}

beforeEach(() => {
  db.deals = [];
  db.user = null;
});

describe("la route d'état ne fait que lire", () => {
  it("8. l'analyse produite pendant l'absence est rendue à son navigateur", async () => {
    db.deals = [{ id: "d1", user_id: null, anon_token: "jeton-du-navigateur", analyses: [{ id: "a1" }], idempotency_key: CLE }];
    const response = await ask(CLE, "jeton-du-navigateur");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ etat: "faite", analysisId: "a1" });
    // Rien ne doit pouvoir être mis en cache par un intermédiaire.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("9. la même clé présentée par un autre navigateur ne rend rien", async () => {
    db.deals = [{ id: "d1", user_id: null, anon_token: "jeton-du-navigateur", analyses: [{ id: "a1" }], idempotency_key: CLE }];
    expect(await (await ask(CLE, "un-autre-jeton")).json()).toEqual({ etat: "inconnu" });
    expect(await (await ask(CLE)).json()).toEqual({ etat: "inconnu" });
  });

  it("10. aucune trace de cette clé : « inconnu », et rien n'est lancé pour autant", async () => {
    expect(await (await ask(CLE, "jeton-du-navigateur")).json()).toEqual({ etat: "inconnu" });
    // Cette route ne sait ni appeler le modèle, ni réserver un droit, ni
    // compter quoi que ce soit : elle ne peut pas lancer une seconde analyse.
    const source = (await import("node:fs")).readFileSync("app/api/analyse/etat/route.ts", "utf8");
    expect(source).not.toMatch(/extractDeal|reserveAnalysis|hitUsageGuard|insertRow|updateRows/);
  });
});

// ─── L'écran d'attente ──────────────────────────────────────────────────────

describe("l'écran d'attente reste juste au retour", () => {
  it("11. le temps écoulé se calcule de deux horodatages, jamais par incrément", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/loading-steps.tsx", "utf8");
    // Une minuterie gelée par iOS ne fait que retarder le rendu : à la reprise,
    // la différence des horodatages redonne le bon temps.
    expect(source).toContain("const elapsed = (respondedAt ?? now) - startedAt;");
    expect(source).toContain("setNow(Date.now())");
    // Rien qui s'ajoute à un compteur : pas d'incrément.
    expect(source).not.toMatch(/setNow\(\s*\(?\w+\)?\s*=>\s*\w+\s*\+/);
    expect(source).not.toMatch(/elapsed\s*\+=|seconds\s*\+\+/);
  });

  it("12. l'écran dit que le travail continue quand on quitte l'application", async () => {
    const { readFileSync } = await import("node:fs");
    const { WORK_SURVIVES_BACKGROUND } = await import("@/lib/content/vocabulaire");
    expect(WORK_SURVIVES_BACKGROUND).toBe("L'analyse continue même si tu quittes l'application.");
    const source = readFileSync("components/loading-steps.tsx", "utf8");
    // La phrase vient du vocabulaire, elle n'est pas réécrite dans le composant.
    expect(source).toContain("{WORK_SURVIVES_BACKGROUND}");
    expect(source).not.toContain("continue même si tu quittes");
  });
});
