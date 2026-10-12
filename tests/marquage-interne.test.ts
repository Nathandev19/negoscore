import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import type { Extraction } from "@/lib/llm/prompt";
import { INTERNAL_COOKIE, internalToken } from "@/lib/telemetry/internal";

// Mission #181 — UNE ANALYSE PRODUITE PAR MOI RESSORT MARQUÉE.
//
// Constat du 12/10 : sur 40 analyses enregistrées, UNE SEULE portait
// internal = true, dont des analyses faites l'après-midi même depuis mon
// propre navigateur, avec /admin ouvert dans un autre onglet.
//
// Le marquage n'était pas cassé, il était AVEUGLE. La route d'analyse
// appelait withEnvironment avec le seul IDENTIFIANT du compte : la source
// « compte » allait donc relire l'adresse dans la table profiles, par une
// requête, alors que la session vérifiée portait déjà l'adresse. Profil
// illisible, ligne absente, liste de test vide : on ne marquait pas, et rien
// ne le disait. La source « cookie », elle, dépend d'un cookie que le proxy
// ne pose que sur les pages qui vérifient déjà la session — pas sur
// l'accueil, d'où partent toutes les analyses.
//
// Ce fichier appelle la VRAIE route /api/analyse, avec une base en mémoire et
// un modèle simulé : aucun appel au modèle payant. Il regarde ce qui part en
// base, pas ce que le code a l'air de faire.

type DealRow = { id: string; row: Record<string, unknown> };

const db = vi.hoisted(() => ({
  deals: [] as DealRow[],
  analyses: [] as DealRow[],
  // L'adresse que la table profiles renverrait. `null` = profil illisible,
  // c'est-à-dire exactement la panne qui faisait taire le marquage.
  profiles: {} as Record<string, string | null>,
  profilesFail: false,
  profilesReads: 0,
  seq: 0,
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));
// Le magasin de cookies que lit lib/telemetry/tagged.ts (next/headers), qui
// n'est pas celui de l'objet Request.
const jar = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === INTERNAL_COOKIE_NAME && jar.value !== null ? { value: jar.value } : undefined),
  }),
  headers: async () => new Headers(),
}));
const INTERNAL_COOKIE_NAME = "ns_interne";

vi.mock("@/lib/llm/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/extract")>();
  return {
    ...actual,
    extractDeal: async () => ({
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
    }),
  };
});
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: true, count: 1, retryInMinutes: 0 }),
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/rates/tier-preference", () => ({ preferredTier: async () => "starter" }));
vi.mock("@/lib/analytics/first-party", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/first-party")>()),
  recordProductEvent: async () => undefined,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      // La seconde source : l'adresse relue dans profiles.
      if (table === "profiles") {
        db.profilesReads += 1;
        if (db.profilesFail) throw new Error("profil illisible");
        const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(query)?.[1] ?? "");
        const email = db.profiles[id];
        return email === undefined ? [] : [{ email }];
      }
      return [];
    },
    countRows: async () => 0,
    insertRow: async (table: string, row: Record<string, unknown>) => {
      const id = `00000000-0000-4000-8000-${String(++db.seq).padStart(12, "0")}`;
      if (table === "deals") db.deals.push({ id, row });
      if (table === "analyses") db.analyses.push({ id, row });
      return { id };
    },
    updateRows: async () => [],
    deleteRows: async () => undefined,
    rpc: async (fn: string) => (fn === "free_usage_consume" ? true : null),
  };
});

vi.stubEnv("IP_HASH_SALT", "sel-de-test");
const { POST } = await import("@/app/api/analyse/route");
const { forgetInternalAccounts } = await import("@/lib/telemetry/tagged");

const OWNER = "nathan@exemple.test";
const COMPTE_DE_TEST = "nathan+test@exemple.test";
const VISITEUSE = "camille@exemple.test";
const OFFRE = "Bonjour, on aimerait une collaboration avec toi : 3 vidéos TikTok pour 300 €, dis-nous.";

function post(cookies: string[] = []) {
  return POST(
    new Request("https://www.negoscore.fr/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookies.length > 0 ? { cookie: cookies.join("; ") } : {}) },
      body: JSON.stringify({ text: OFFRE }),
    }),
  );
}

// Ce qui est RÉELLEMENT parti en base, sur les deux tables que la route écrit.
function marquages(): Array<{ table: string; internal: unknown; environment: unknown }> {
  return [
    ...db.deals.map((d) => ({ table: "deals", internal: d.row.internal, environment: d.row.environment })),
    ...db.analyses.map((a) => ({ table: "analyses", internal: a.row.internal, environment: a.row.environment })),
  ];
}

function poseLaMarque(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${INTERNAL_COOKIE}=`));
}

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", OWNER);
  vi.stubEnv("INTERNAL_EMAILS", COMPTE_DE_TEST);
  db.deals = [];
  db.analyses = [];
  db.profiles = {};
  db.profilesFail = false;
  db.profilesReads = 0;
  db.seq = 0;
  user.current = null;
  jar.value = null;
  forgetInternalAccounts();
});

describe("une insertion par le seul chemin qui écrit des analyses", () => {
  // LE TEST DE LA MISSION. Il échoue si une ligne écrite par ce chemin, dans
  // un contexte interne, ressort avec internal != true.
  it("connecté avec OWNER_EMAIL, SANS cookie et avec la table profiles en panne : les deux lignes sont internes", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    // Les deux autres sources sont volontairement coupées : c'est la
    // situation du 12/10, et c'est elle qui ne marquait rien.
    db.profilesFail = true;
    const response = await post();
    expect(response.status).toBe(200);
    expect(db.deals).toHaveLength(1);
    expect(db.analyses).toHaveLength(1);
    for (const ligne of marquages()) expect(ligne, ligne.table).toMatchObject({ internal: true });
  });

  it("connecté avec un compte de la liste INTERNAL_EMAILS : pareil", async () => {
    user.current = { id: "u-test", email: COMPTE_DE_TEST };
    db.profilesFail = true;
    expect((await post()).status).toBe(200);
    for (const ligne of marquages()) expect(ligne, ligne.table).toMatchObject({ internal: true });
  });

  it("l'adresse de la session suffit : la table profiles n'est même pas lue", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    await post();
    // Un aller-retour Supabase en moins par analyse, et surtout : plus rien
    // à échouer en silence entre la session et la ligne.
    expect(db.profilesReads).toBe(0);
  });

  it("déconnecté, mais ce navigateur porte la marque : les deux lignes sont internes", async () => {
    jar.value = internalToken("sel-de-test");
    expect((await post()).status).toBe(200);
    for (const ligne of marquages()) expect(ligne, ligne.table).toMatchObject({ internal: true });
  });

  it("une vraie visiteuse connectée n'est JAMAIS marquée : marquer à tort l'effacerait du cockpit", async () => {
    user.current = { id: "u-camille", email: VISITEUSE };
    expect((await post()).status).toBe(200);
    for (const ligne of marquages()) expect(ligne, ligne.table).toMatchObject({ internal: false });
  });

  it("une visiteuse anonyme non marquée non plus", async () => {
    expect((await post()).status).toBe(200);
    for (const ligne of marquages()) expect(ligne, ligne.table).toMatchObject({ internal: false });
  });

  it("l'environnement reste écrit sur les deux lignes : les deux champs sont orthogonaux", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    await post();
    for (const ligne of marquages()) expect(ligne, ligne.table).toMatchObject({ environment: "test" });
  });
});

describe("la route marque le navigateur, puisque l'accueil ne le fait pas", () => {
  it("session interne et cookie absent : la réponse pose la marque", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    expect(poseLaMarque(await post())).toBe(true);
  });

  it("cookie déjà là : rien n'est reposé", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    expect(poseLaMarque(await post([`${INTERNAL_COOKIE}=${internalToken("sel-de-test")}`]))).toBe(false);
  });

  it("une visiteuse connectée ne reçoit jamais cette marque", async () => {
    user.current = { id: "u-camille", email: VISITEUSE };
    expect(poseLaMarque(await post())).toBe(false);
  });

  it("une visiteuse anonyme non plus", async () => {
    expect(poseLaMarque(await post())).toBe(false);
  });

  it("la marque est httpOnly et vaut pour tout le site", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    const pose = (await post()).headers.getSetCookie().find((c) => c.startsWith(`${INTERNAL_COOKIE}=`)) ?? "";
    expect(pose).toContain("HttpOnly");
    expect(pose).toContain("Path=/");
  });
});

describe("le drapeau ne peut pas être omis par un appelant", () => {
  const tagged = readFileSync("lib/telemetry/tagged.ts", "utf8");

  it("internal n'est jamais un paramètre : il est calculé côté serveur", () => {
    // Le seul endroit où le mot est décidé, c'est ici, depuis la raison.
    expect(tagged).toContain("const internal = raison !== null;");
    // Le champ existe dans TelemetryTag — c'est la forme de ce qui est
    // ÉCRIT, remplie ici. Ce qu'aucune signature d'appel ne doit accepter,
    // c'est internal en ENTRÉE : la liste d'options est vérifiée juste après.
  });

  it("le compte est REQUIS : ni valeur par défaut, ni objet d'options optionnel", () => {
    // Deux points-virgules à surveiller : « account?: » rendrait le champ
    // facultatif, et « } = {}, » rendrait tout l'objet facultatif. L'un ou
    // l'autre et un appelant peut à nouveau se taire.
    expect(tagged).toContain("options: { account: InternalAccount | null; diagnostic?: boolean },");
    expect(tagged).not.toContain("account?:");
    expect(tagged).not.toContain("diagnostic?: boolean } = {}");
  });

  it("les deux insertions de la route passent le compte, explicitement", () => {
    const route = readFileSync("app/api/analyse/route.ts", "utf8");
    // Deux écritures marquées : le deal et l'analyse.
    expect(route.split("{ account: user },")).toHaveLength(3);
    // Et l'ancien contrat, qui ne portait que l'identifiant au marquage, a
    // disparu de cette route (« userId » survit ailleurs, pour le filet
    // horaire et les événements : ce n'est pas le même paramètre).
    expect(route).not.toContain("{ userId: user?.id ?? null },");
  });

  it("aucun appel de withEnvironment ne reste sans compte dans le dépôt", async () => {
    const { execSync } = await import("node:child_process");
    // Une capture brute : chaque appel, avec ce qui le suit jusqu'à la
    // parenthèse de fin. Si l'un n'a pas de compte, il sort d'ici.
    const sortie = execSync(
      'git grep -n --no-color "withEnvironment(" -- "lib/*.ts" "app/*.ts" "app/*.tsx" || true',
      { encoding: "utf8" },
    );
    const appels = sortie.split("\n").filter((l) => l.includes("withEnvironment(") && !l.includes("export async function"));
    expect(appels.length).toBeGreaterThan(0);
    // Le compilateur est la vraie garde (le champ est requis) ; cette
    // ligne-ci garantit qu'on n'a pas contourné en élargissant le type.
    expect(tagged).not.toContain("account?: InternalAccount");
  });
});

describe("la raison est journalisée, pas devinée", () => {
  it("la route écrit QUEL maillon a répondu, même quand aucun ne répond", async () => {
    const lignes: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args) => void lignes.push(String(args[0])));
    try {
      await post();
      const analyse = lignes.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "analyse");
      // Une valeur absente ne se lit pas ; « null » se lit.
      expect(analyse).toMatchObject({ marquage: null });
    } finally {
      log.mockRestore();
    }
  });

  it("et il nomme la source quand elle répond", async () => {
    user.current = { id: "u-nathan", email: OWNER };
    const lignes: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args) => void lignes.push(String(args[0])));
    try {
      await post();
      const analyse = lignes.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "analyse");
      expect(analyse).toMatchObject({ marquage: "compte" });
    } finally {
      log.mockRestore();
    }
  });
});
