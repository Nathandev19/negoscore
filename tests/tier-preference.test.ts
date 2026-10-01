import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Niveau mémorisé pour les analyses suivantes (missions #039 et #065) : sur le
// compte (autre appareil) et dans un cookie du navigateur (avec ou sans
// compte). Depuis la #065, chacun porte le moment du choix et c'est le PLUS
// RÉCENT qui gagne. L'analyse elle-même garde son niveau de calcul.

const db = vi.hoisted(() => ({
  profile: { rate_tier: null as string | null, rate_tier_at: null as string | null },
  // rate_tier_at absente (migration 020 non appliquée).
  missingAt: false,
  // rate_tier absente aussi (migration 017 non appliquée).
  missingColumn: false,
  // Échec quelconque de l'écriture (panne réseau vers la base…).
  failWrites: false,
  updates: [] as Array<{ filter: string; patch: Record<string, unknown> }>,
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (db.missingColumn) throw new actual.SupabaseRequestError("colonne absente", 400, "42703");
      if (db.missingAt && query.includes("rate_tier_at")) throw new actual.SupabaseRequestError("colonne absente", 400, "42703");
      return table === "profiles" ? [{ ...db.profile }] : [];
    },
    // Fausse base qui applique vraiment l'écriture conditionnelle
    // « or=(rate_tier_at.is.null,rate_tier_at.lt."…") ».
    updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
      if (db.failWrites) throw new Error("base injoignable");
      if (db.missingColumn) throw new actual.SupabaseRequestError("colonne absente", 400, "PGRST204");
      if (db.missingAt && ("rate_tier_at" in patch || filter.includes("rate_tier_at"))) {
        throw new actual.SupabaseRequestError("colonne absente", 400, "PGRST204");
      }
      db.updates.push({ filter, patch });
      const bound = filter.match(/rate_tier_at\.lt\.%22([^%]*(?:%[0-9A-F]{2}[^%]*)*)%22/)?.[1];
      if (bound !== undefined) {
        const limit = decodeURIComponent(bound);
        const stored = db.profile.rate_tier_at;
        if (stored !== null && !(Date.parse(stored) < Date.parse(limit))) return [];
      }
      Object.assign(db.profile, patch);
      return table === "profiles" ? [{ ...db.profile }] : [];
    },
  };
});
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));

const { preferredTier } = await import("@/lib/rates/tier-preference");
const { POST } = await import("@/app/api/niveau/route");
const { rememberTier } = await import("@/components/result/tier-selector");
const { encodeTierCookie } = await import("@/lib/rates/tier");

const ACCOUNT = { id: "user-a", email: "a@example.com" };
const T1 = Date.parse("2026-09-18T08:00:00.000Z");
const T2 = Date.parse("2026-09-18T09:00:00.000Z");

function request(cookie: string | null, body?: unknown) {
  return new Request("http://localhost:3000/api/niveau", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const cookieOf = (tier: "starter" | "confirmed" | "experienced", at: number) => `negoscore_niveau=${encodeTierCookie(tier, at)}`;

// Navigateur simulé pour rememberTier : un seul cookie de niveau (le dernier
// écrit), l'indicateur de session s'il y a une session, un faux fetch.
const browser = vi.hoisted(() => ({
  signedIn: false,
  tierCookie: null as string | null,
  // Mission #130 — deux destinations, deux listes. `posts` reste ce que
  // ces tests surveillent depuis #064 : ce qui part vers le COMPTE.
  posts: [] as Array<{ tier: string; at: number }>,
  // Le signalement du niveau consulté, qui part pour tout le monde.
  events: [] as Array<{ event: string; tier: string }>,
  answer: "ok" as "ok" | "503" | "network",
}));

let warnings: string[] = [];
let logs: string[] = [];

beforeEach(() => {
  db.profile = { rate_tier: null, rate_tier_at: null };
  db.missingAt = false;
  db.missingColumn = false;
  db.failWrites = false;
  db.updates = [];
  user.current = null;
  browser.signedIn = false;
  browser.tierCookie = null;
  browser.posts = [];
  browser.events = [];
  browser.answer = "ok";
  warnings = [];
  logs = [];
  vi.spyOn(console, "warn").mockImplementation((line: string) => void warnings.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(String(line)));
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
  vi.stubGlobal("window", { location: { protocol: "https:" } });
  vi.stubGlobal("document", {
    get cookie() {
      return [browser.signedIn ? "ns_session=1" : null, browser.tierCookie].filter(Boolean).join("; ");
    },
    set cookie(value: string) {
      if (value.startsWith("negoscore_niveau=")) browser.tierCookie = value.split(";")[0];
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const corps = JSON.parse(String(init.body));
      if (String(url).includes("/api/events")) browser.events.push(corps);
      else browser.posts.push(corps);
      if (browser.answer === "network") throw new TypeError("Failed to fetch");
      return new Response(null, { status: browser.answer === "503" ? 503 : 204 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Laisse finir les promesses lancées sans attente par rememberTier.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("niveau utilisé pour une nouvelle analyse", () => {
  it("sans choix : le défaut de la table (starter depuis fr-2026.3)", async () => {
    expect(await preferredTier(request(null), null)).toBe("starter");
  });

  it("visiteur anonyme : le cookie, ancien format comme nouveau", async () => {
    expect(await preferredTier(request("negoscore_niveau=experienced"), null)).toBe("experienced");
    expect(await preferredTier(request(cookieOf("confirmed", T1)), null)).toBe("confirmed");
  });

  it("cookie trafiqué : ignoré", async () => {
    expect(await preferredTier(request("negoscore_niveau=nano"), null)).toBe("starter");
    expect(await preferredTier(request("negoscore_niveau=nano.123"), null)).toBe("starter");
  });

  it("cookie non daté (écrit avant la #065) : le compte garde la main, comme avant", async () => {
    db.profile = { rate_tier: "experienced", rate_tier_at: null };
    expect(await preferredTier(request("negoscore_niveau=starter"), ACCOUNT)).toBe("experienced");
  });

  it("compte daté plus récent que le cookie : le compte", async () => {
    db.profile = { rate_tier: "experienced", rate_tier_at: new Date(T2).toISOString() };
    expect(await preferredTier(request(cookieOf("starter", T1)), ACCOUNT)).toBe("experienced");
    expect(db.updates).toEqual([]);
  });

  it("colonnes absentes (migrations non appliquées) : le cookie, sans bloquer l'analyse", async () => {
    db.missingColumn = true;
    expect(await preferredTier(request(cookieOf("confirmed", T1)), ACCOUNT)).toBe("confirmed");
  });

  it("seule rate_tier_at absente : le cookie daté l'emporte sur le compte non daté", async () => {
    db.missingAt = true;
    db.profile = { rate_tier: "experienced", rate_tier_at: null };
    expect(await preferredTier(request(cookieOf("starter", T1)), ACCOUNT)).toBe("starter");
  });
});

describe("/api/niveau", () => {
  it("compte connecté : niveau et moment du choix, écrits seulement si plus récents", async () => {
    user.current = ACCOUNT;
    expect((await POST(request(null, { tier: "starter", at: T1 }))).status).toBe(204);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].filter).toBe(
      `id=eq.user-a&or=(rate_tier_at.is.null,rate_tier_at.lt.%22${encodeURIComponent(new Date(T1).toISOString())}%22)`,
    );
    expect(db.updates[0].patch).toEqual({ rate_tier: "starter", rate_tier_at: new Date(T1).toISOString() });
  });

  it("un moment dans le futur est ramené à maintenant", async () => {
    user.current = ACCOUNT;
    await POST(request(null, { tier: "starter", at: Date.now() + 86_400_000 }));
    expect(Date.parse(String(db.profile.rate_tier_at))).toBeLessThanOrEqual(Date.now());
  });

  it("sans compte : rien n'est écrit (le cookie suffit)", async () => {
    expect((await POST(request(null, { tier: "starter", at: T1 }))).status).toBe(204);
    expect(db.updates).toEqual([]);
  });

  it("niveau inconnu : refusé et journalisé", async () => {
    user.current = ACCOUNT;
    expect((await POST(request(null, { tier: "nano" }))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
    expect(db.updates).toEqual([]);
    expect(warnings.join(" ")).toContain("rate_tier_rejected");
  });

  it("colonnes absentes : 503 journalisé, sans erreur non gérée", async () => {
    user.current = ACCOUNT;
    db.missingColumn = true;
    expect((await POST(request(null, { tier: "starter", at: T1 }))).status).toBe(503);
    expect(warnings.join(" ")).toContain("rate_tier_missing");
  });

  it("base injoignable : 503 journalisé", async () => {
    user.current = ACCOUNT;
    db.failWrites = true;
    expect((await POST(request(null, { tier: "starter", at: T1 }))).status).toBe(503);
    expect(logs.join(" ")).toContain("rate_tier_error");
  });
});

// ─── Les sept scénarios de la mission #065 ───────────────────────────────────

describe("#064 — 1. changement de niveau puis rechargement", () => {
  it("le choix tient pour la suite ; l'analyse, elle, se rouvre sur son niveau de calcul (option c)", async () => {
    browser.signedIn = true;
    user.current = ACCOUNT;
    db.profile = { rate_tier: "experienced", rate_tier_at: new Date(T1).toISOString() };
    rememberTier("starter", T2);
    await settle();
    // Rechargement : un nouveau passage serveur relit la préférence.
    expect(await preferredTier(request(browser.tierCookie), ACCOUNT)).toBe("starter");
    // L'analyse enregistrée n'est pas touchée : aucune écriture ailleurs que profiles.
    expect(db.updates.every((u) => u.filter.startsWith("id=eq.user-a"))).toBe(true);
  });
});

describe("#064 — 2. changement de niveau puis nouvelle analyse", () => {
  it("la nouvelle analyse utilise le nouveau niveau, même si le compte portait l'ancien", async () => {
    user.current = ACCOUNT;
    db.profile = { rate_tier: "experienced", rate_tier_at: new Date(T1).toISOString() };
    expect(await preferredTier(request(cookieOf("starter", T2)), ACCOUNT)).toBe("starter");
  });
});

describe("#064 — 3. sans compte, le cookie seul", () => {
  it("le choix est écrit dans le cookie, aucun envoi au serveur, et la suite l'utilise", async () => {
    rememberTier("confirmed", T2);
    await settle();
    expect(browser.posts).toEqual([]);
    // Mission #130 — rien ne part vers le COMPTE, mais le niveau consulté
    // est signalé : c'est la seule trace d'un changement de niveau, et elle
    // ne dépend pas d'avoir un compte.
    expect(browser.events).toEqual([expect.objectContaining({ event: "tier_changed", tier: "confirmed" })]);
    expect(browser.tierCookie).toBe(cookieOf("confirmed", T2));
    expect(await preferredTier(request(browser.tierCookie), null)).toBe("confirmed");
  });
});

describe("#064 — 4. deux onglets, le dernier choix gagne", () => {
  it("cookie : le dernier écrit ; compte : l'envoi le plus ancien arrivé en dernier ne l'écrase pas", async () => {
    browser.signedIn = true;
    user.current = ACCOUNT;
    rememberTier("confirmed", T1); // onglet A
    rememberTier("starter", T2); // onglet B, plus tard
    await settle();
    expect(browser.tierCookie).toBe(cookieOf("starter", T2));

    // Les deux envois arrivent dans le désordre : B d'abord, puis A.
    const [fromA, fromB] = browser.posts;
    await POST(request(null, fromB));
    await POST(request(null, fromA));
    expect(db.profile.rate_tier).toBe("starter");
    expect(logs.join(" ")).toContain("rate_tier_stale");
    expect(await preferredTier(request(browser.tierCookie), ACCOUNT)).toBe("starter");
  });
});

describe("#065 — 5. analyse faite sans compte, rouverte connecté", () => {
  it("le choix part sur le compte : rien ne dépend plus de la propriété de l'analyse", async () => {
    browser.signedIn = true;
    rememberTier("experienced", T2);
    await settle();
    expect(browser.posts).toEqual([{ tier: "experienced", at: T2 }]);
    // Et la route n'a besoin que de la session, pas de l'analyse.
    user.current = ACCOUNT;
    expect((await POST(request(null, browser.posts[0]))).status).toBe(204);
    expect(db.profile.rate_tier).toBe("experienced");
  });

  it("la page ne décide plus seule d'envoyer ou non (plus de rememberOnAccount)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["components/result/analysis-result.tsx", "app/analyse/resultat/[id]/page.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("rememberOnAccount");
    }
  });
});

describe("#065 — 6. niveau choisi déconnecté, puis connexion", () => {
  it("le cookie plus récent l'emporte, et le compte est rattrapé pour les autres appareils", async () => {
    rememberTier("starter", T2); // déconnecté : rien n'est envoyé
    await settle();
    expect(browser.posts).toEqual([]);

    db.profile = { rate_tier: "experienced", rate_tier_at: new Date(T1).toISOString() };
    user.current = ACCOUNT; // connexion
    expect(await preferredTier(request(browser.tierCookie), ACCOUNT)).toBe("starter");
    expect(db.profile).toEqual({ rate_tier: "starter", rate_tier_at: new Date(T2).toISOString() });
    expect(warnings.join(" ")).toContain('"reason":"cookie_plus_recent"');
  });
});

describe("#065 — 7. POST en échec", () => {
  it("échec réseau ou serveur : journalisé dans le navigateur, rien à l'écran, le cookie tient", async () => {
    browser.signedIn = true;
    browser.answer = "network";
    rememberTier("starter", T1);
    browser.answer = "503";
    rememberTier("confirmed", T2);
    await settle();
    expect(warnings.filter((w) => w.includes("rate_tier_save_failed"))).toHaveLength(2);
    expect(browser.tierCookie).toBe(cookieOf("confirmed", T2));
  });

  it("à l'analyse suivante, le cookie gagne sur le compte resté ancien, et le compte est rattrapé", async () => {
    db.profile = { rate_tier: "experienced", rate_tier_at: new Date(T1).toISOString() };
    user.current = ACCOUNT;
    expect(await preferredTier(request(cookieOf("confirmed", T2)), ACCOUNT)).toBe("confirmed");
    expect(db.profile.rate_tier).toBe("confirmed");
    expect(warnings.join(" ")).toContain("rate_tier_reconciled");
  });

  it("si le rattrapage échoue aussi : journalisé, et l'analyse part quand même au bon niveau", async () => {
    db.profile = { rate_tier: "experienced", rate_tier_at: new Date(T1).toISOString() };
    db.failWrites = true;
    user.current = ACCOUNT;
    expect(await preferredTier(request(cookieOf("confirmed", T2)), ACCOUNT)).toBe("confirmed");
    expect(logs.join(" ")).toContain('"operation":"reconcile"');
  });
});
