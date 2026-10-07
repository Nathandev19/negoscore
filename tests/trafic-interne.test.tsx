import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expiredInternalCookieHeader,
  INTERNAL_COOKIE,
  internalCookieHeader,
  internalList,
  internalToken,
  internalTokenValid,
  isInternalEmail,
  markSecret,
  markSecretValid,
  parseInternalEmails,
} from "@/lib/telemetry/internal";

// Mission #118 — le cockpit ne compte aucun de mes comptes, ni aucun de mes
// appareils.
//
// Au 25/09 le cockpit affichait 10 visites et 1 analyse terminée : toutes de
// Nathan, EN PRODUCTION. La télémétrie de #103 sépare les environnements, pas
// les personnes. Trois cas à couvrir, et le troisième est le plus important :
//   1. connecté avec OWNER_EMAIL ;
//   2. connecté avec un autre compte de test (liste INTERNAL_EMAILS) ;
//   3. DÉCONNECTÉ, sur le téléphone ou le PC.

const OWNER = "nathan@exemple.test";
const TEST_ACCOUNT = "nathan+test@exemple.test";
const VISITEUSE = "camille@exemple.test";
const SEL = "sel-de-test";
const SUPABASE = "https://projet.supabase.test";

// ─── Le magasin de cookies que lit lib/telemetry/tagged.ts ─────────────────
const jar = vi.hoisted(() => ({ value: null as string | null, throws: false }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (jar.throws) throw new Error("hors contexte de requête");
    return { get: (name: string) => (name === "ns_interne" && jar.value !== null ? { value: jar.value } : undefined) };
  },
}));

// ─── Supabase, pour la seconde source : le COMPTE qui écrit la ligne ───────
const db = vi.hoisted(() => ({ profiles: {} as Record<string, string | null>, reads: [] as string[], fail: false }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.reads.push(`${table}?${query}`);
    if (db.fail) throw new Error("panne");
    const id = /id=eq\.([^&]+)/.exec(query)?.[1] ?? "";
    const email = db.profiles[decodeURIComponent(id)];
    return email === undefined ? [] : [{ email }];
  },
}));

// ─── Ce dont la fin de connexion a besoin, et qui n'est pas le sujet ───────
vi.mock("@/lib/auth/account", () => ({
  ensureAccount: async () => ({ created: false }),
  attachAnonDeals: async () => ({ attached: 0, refused: false }),
}));
vi.mock("@/lib/auth/login-claims", () => ({
  redeemLoginClaim: async () => null,
  // Mission #162 — la réclamation rend aussi l'attribution relevée à la demande.
  redeemLoginClaimFull: async () => ({ anonToken: null, attribution: null }),
}));
vi.mock("@/lib/billing/free-usage", () => ({ mergeFreeUsage: async () => undefined }));
vi.mock("@/lib/analytics/first-party", () => ({ recordProductEvent: async () => undefined }));

const { withEnvironment, forgetInternalAccounts } = await import("@/lib/telemetry/tagged");
const { GET: porte, POST: marquer } = await import("@/app/api/interne/route");
const { default: InternalBrowserPage } = await import("@/app/interne/page");
const { completeSignIn } = await import("@/lib/auth/sign-in");

beforeEach(() => {
  vi.stubEnv("IP_HASH_SALT", SEL);
  vi.stubEnv("OWNER_EMAIL", OWNER);
  vi.stubEnv("INTERNAL_EMAILS", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  jar.value = null;
  jar.throws = false;
  db.profiles = {};
  db.reads = [];
  db.fail = false;
  forgetInternalAccounts();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tag = async (options?: { userId?: string | null }) => {
  let written: Record<string, unknown> = {};
  await withEnvironment(async (extra) => {
    written = extra;
    return null;
  }, options);
  return written;
};

// ───────────────────────────────────────────────────────────────────────────
describe("la liste des adresses internes", () => {
  it("plusieurs adresses, plusieurs séparateurs, casse et espaces ignorés", () => {
    expect(parseInternalEmails(" A@x.test, b@x.test;c@x.test\n D@x.test ")).toEqual([
      "a@x.test",
      "b@x.test",
      "c@x.test",
      "d@x.test",
    ]);
  });

  it("variable absente ou vide : la liste est vide, et rien ne casse", () => {
    expect(parseInternalEmails(undefined)).toEqual([]);
    expect(parseInternalEmails("")).toEqual([]);
    expect(parseInternalEmails("   ,  ; ")).toEqual([]);
  });

  it("cas 1 — le propriétaire est interne sans figurer dans la liste", () => {
    expect(isInternalEmail(OWNER, "", OWNER)).toBe(true);
    expect(isInternalEmail(OWNER, undefined, OWNER)).toBe(true);
    // Et il n'y figure qu'une fois s'il y est aussi.
    expect(internalList(OWNER, OWNER)).toEqual([OWNER]);
  });

  it("cas 2 — mes autres comptes de test, par la liste", () => {
    expect(isInternalEmail(TEST_ACCOUNT, `${TEST_ACCOUNT},autre@x.test`, OWNER)).toBe(true);
    expect(isInternalEmail("autre@x.test", `${TEST_ACCOUNT},autre@x.test`, OWNER)).toBe(true);
  });

  it("une visiteuse n'est jamais interne, et une adresse vide non plus", () => {
    expect(isInternalEmail(VISITEUSE, `${TEST_ACCOUNT}`, OWNER)).toBe(false);
    expect(isInternalEmail(null, `${TEST_ACCOUNT}`, OWNER)).toBe(false);
    expect(isInternalEmail("", `${TEST_ACCOUNT}`, OWNER)).toBe(false);
    expect(isInternalEmail("   ", `${TEST_ACCOUNT}`, OWNER)).toBe(false);
  });

  it("aucune variable configurée : personne n'est interne", () => {
    expect(internalList("", "")).toEqual([]);
    expect(isInternalEmail(OWNER, "", "")).toBe(false);
    expect(isInternalEmail(VISITEUSE, undefined, undefined)).toBe(false);
  });

  it("la comparaison ignore la casse et les espaces des deux côtés", () => {
    expect(isInternalEmail("  NATHAN@Exemple.Test ", "", OWNER)).toBe(true);
    expect(isInternalEmail(TEST_ACCOUNT, ` ${TEST_ACCOUNT.toUpperCase()} `, "")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le cookie ne se fabrique pas", () => {
  it("signé par le secret serveur : il se valide avec lui, et avec aucun autre", () => {
    const token = internalToken(SEL);
    expect(internalTokenValid(token, SEL)).toBe(true);
    expect(internalTokenValid(token, "un-autre-sel")).toBe(false);
  });

  it("aucune valeur devinable ne passe", () => {
    for (const forgery of ["1", "true", "v1.", "v1.0", "ns_interne", "", "v1." + "a".repeat(64), internalToken(SEL).slice(0, -1)]) {
      expect(internalTokenValid(forgery, SEL), forgery).toBe(false);
    }
  });

  it("secret absent : ni émission ni validation — personne n'est interne", () => {
    expect(internalCookieHeader(null)).toBeNull();
    expect(internalTokenValid(internalToken(SEL), null)).toBe(false);
  });

  it("posé httpOnly, sur tout le site, pour deux ans, et Secure en production", () => {
    const header = internalCookieHeader(SEL) ?? "";
    expect(header).toContain(`${INTERNAL_COOKIE}=${internalToken(SEL)}`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${60 * 60 * 24 * 730}`);
    expect(header).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    expect(internalCookieHeader(SEL)).toContain("Secure");
  });

  it("le retrait efface, il ne repose rien", () => {
    expect(expiredInternalCookieHeader()).toContain(`${INTERNAL_COOKIE}=;`);
    expect(expiredInternalCookieHeader()).toContain("Max-Age=0");
  });

  it("aucune adresse, aucun identifiant dans la valeur du cookie", () => {
    const header = internalCookieHeader(SEL) ?? "";
    for (const secret of [OWNER, TEST_ACCOUNT, SEL]) expect(header).not.toContain(secret);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ce qui part en base", () => {
  it("cas 3 — navigateur marqué, déconnecté : la ligne est interne", async () => {
    jar.value = internalToken(SEL);
    expect(await tag()).toEqual({ environment: "test", internal: true });
    // Aucun compte n'a été lu : le cookie suffit, sans entrée-sortie.
    expect(db.reads).toEqual([]);
  });

  it("navigateur ordinaire : la ligne compte comme celle d'un visiteur", async () => {
    expect(await tag()).toEqual({ environment: "test", internal: false });
  });

  it("cookie forgé : refusé, la ligne reste celle d'un visiteur", async () => {
    jar.value = "1";
    expect(await tag()).toEqual({ environment: "test", internal: false });
    jar.value = internalToken("le-sel-d-un-autre");
    expect(await tag()).toEqual({ environment: "test", internal: false });
  });

  it("cas 1 et 2 sans navigateur — le COMPTE décide (webhook Whop)", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    db.profiles = { "u-nathan": OWNER, "u-test": TEST_ACCOUNT, "u-camille": VISITEUSE };
    expect(await tag({ userId: "u-nathan" })).toMatchObject({ internal: true });
    expect(await tag({ userId: "u-test" })).toMatchObject({ internal: true });
    expect(await tag({ userId: "u-camille" })).toMatchObject({ internal: false });
  });

  it("profil sans adresse, ou introuvable : on ne marque pas", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    db.profiles = { "u-vide": null };
    expect(await tag({ userId: "u-vide" })).toMatchObject({ internal: false });
    expect(await tag({ userId: "u-inconnu" })).toMatchObject({ internal: false });
  });

  it("profil illisible : on ne marque pas, et on n'échoue pas", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    db.fail = true;
    expect(await tag({ userId: "u-test" })).toMatchObject({ internal: false });
  });

  it("aucune adresse interne configurée : aucune requête n'est faite", async () => {
    vi.stubEnv("OWNER_EMAIL", "");
    vi.stubEnv("INTERNAL_EMAILS", "");
    db.profiles = { "u-nathan": OWNER };
    expect(await tag({ userId: "u-nathan" })).toMatchObject({ internal: false });
    expect(db.reads).toEqual([]);
  });

  it("le même compte n'est pas relu à chaque événement d'une même analyse", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    db.profiles = { "u-test": TEST_ACCOUNT };
    await tag({ userId: "u-test" });
    await tag({ userId: "u-test" });
    await tag({ userId: "u-test" });
    expect(db.reads).toHaveLength(1);
  });

  it("hors contexte de requête (tâche planifiée) : pas de cookie à lire, et rien ne casse", async () => {
    jar.throws = true;
    expect(await tag()).toEqual({ environment: "test", internal: false });
  });

  it("l'identifiant de compte est encodé avant d'entrer dans la requête", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    await tag({ userId: "u/../x&select=*" });
    expect(db.reads[0]).toContain("u%2F..%2Fx%26select%3D*");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("l'environnement n'a pas bougé", () => {
  it("« interne » n'est pas devenu un environnement", async () => {
    const { TELEMETRY_ENVIRONMENTS, resolveEnvironment } = await import("@/lib/telemetry/environment");
    expect([...TELEMETRY_ENVIRONMENTS]).toEqual(["production", "preview", "development", "test", "unknown"]);
    // La fonction reste PURE : elle ne décide que sur ce qu'on lui donne, et
    // ne connaît rien du trafic interne.
    expect(resolveEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    const source = readFileSync("lib/telemetry/environment.ts", "utf8");
    expect(source).not.toMatch(/internal|interne/i);
    expect(source).not.toMatch(/cookies?\(|next\/headers/);
  });

  it("le CHECK de la migration #103 n'est pas rouvert", () => {
    const sql = readFileSync("supabase/migrations/20260925000032_telemetry_internal.sql", "utf8");
    expect(sql).not.toContain("environment_check");
    expect(sql).not.toMatch(/'internal'\s*\)/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la porte : /api/interne", () => {
  const ACCESS = "sb_access_token";
  const ask = (query: string, cookie?: string) =>
    porte(new Request(`https://negoscore.fr/api/interne${query}`, { headers: cookie ? { cookie } : {} }));
  const setCookies = (r: Response) => r.headers.getSetCookie().filter((c) => c.startsWith(`${INTERNAL_COOKIE}=`));

  // Faux Supabase Auth : /user répond pour l'adresse donnée ; null = refus.
  const authAs = (email: string | null) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (email === null ? Response.json({ msg: "refus" }, { status: 401 }) : Response.json({ id: "u1", email }))),
    );

  it("déconnecté : la route n'existe pas, et ne pose rien", async () => {
    authAs(null);
    const response = await ask("");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(setCookies(response)).toEqual([]);
  });

  it("connecté avec une adresse ordinaire : exactement la même réponse", async () => {
    authAs(VISITEUSE);
    const refus = await ask("", `${ACCESS}=jeton`);
    authAs(null);
    const inconnue = await ask("");
    expect(refus.status).toBe(inconnue.status);
    expect(await refus.text()).toBe(await inconnue.text());
    expect(setCookies(refus)).toEqual([]);
  });

  it("connecté avec une adresse interne : le navigateur est marqué", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    authAs(TEST_ACCOUNT);
    const response = await ask("", `${ACCESS}=jeton`);
    expect(response.status).toBe(200);
    const [cookie] = setCookies(response);
    expect(cookie).toBeDefined();
    expect(internalTokenValid(/ns_interne=([^;]+)/.exec(cookie)?.[1], SEL)).toBe(true);
  });

  it("le propriétaire aussi, sans figurer dans INTERNAL_EMAILS", async () => {
    authAs(OWNER);
    expect((await ask("", `${ACCESS}=jeton`)).status).toBe(200);
  });

  it("?retirer : le navigateur redevient un visiteur", async () => {
    authAs(OWNER);
    const response = await ask("?retirer=1", `${ACCESS}=jeton`);
    expect(response.status).toBe(200);
    expect(setCookies(response)[0]).toContain("Max-Age=0");
  });

  it("secret serveur absent : refus clair, aucun cookie constant posé", async () => {
    vi.stubEnv("IP_HASH_SALT", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authAs(OWNER);
    const response = await ask("", `${ACCESS}=jeton`);
    expect(response.status).toBe(503);
    expect(setCookies(response)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mission #127, partie B — MARQUER UN NAVIGATEUR QUI NE PEUT PAS SE CONNECTER.
//
// Les navigateurs intégrés d'Instagram et de TikTok n'ont pas de barre
// d'adresse modifiable : on n'y atteint une page qu'en cliquant un lien, et s'y
// connecter demande d'ouvrir un email ailleurs. Vérifier un lien depuis ces
// applications comptait donc comme une vraie visite de créatrice.
//
// C'est le MÊME marquage que celui du reste de ce fichier — le même cookie, lu
// par le même chemin — ouvert par un secret au lieu d'une session.
describe("marquer ce navigateur par un secret", () => {
  const CLE = "un-secret-de-test-assez-long";
  const page = (cle: string | null) =>
    InternalBrowserPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(cle === null ? {} : { cle }),
    });
  const html = async (cle: string) => renderToStaticMarkup(await page(cle)).replace(/&#x27;|&#39;/g, "'");
  const post = (champs: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(champs)) form.append(k, v);
    return marquer(new Request("https://negoscore.fr/api/interne", { method: "POST", body: form }));
  };
  const poses = (r: Response) => r.headers.getSetCookie().filter((c) => c.startsWith(`${INTERNAL_COOKIE}=`));

  beforeEach(() => {
    vi.stubEnv("INTERNAL_MARK_SECRET", CLE);
  });

  it("sans le bon secret, la page n'existe pas — 404, jamais 401", async () => {
    for (const mauvais of [null, "", "autre", CLE.slice(0, -1), `${CLE} `]) {
      await expect(page(mauvais), String(mauvais)).rejects.toThrow(/NEXT_(HTTP_ERROR_FALLBACK|NOT_FOUND)/);
    }
  });

  it("variable non configurée : personne ne peut marquer, même avec une clé", async () => {
    vi.stubEnv("INTERNAL_MARK_SECRET", "");
    await expect(page(CLE)).rejects.toThrow();
    expect((await post({ cle: CLE, action: "marquer" })).status).toBe(404);
    expect((await post({ cle: "", action: "marquer" })).status).toBe(404);
  });

  // Un secret par défaut serait un secret public : variable absente, AUCUNE
  // valeur n'ouvre la porte, pas même celles qu'on essaierait en premier.
  it("aucune valeur de repli : la variable absente ferme la porte à tout le monde", async () => {
    for (const vide of ["", "   "]) {
      vi.stubEnv("INTERNAL_MARK_SECRET", vide);
      expect(markSecret()).toBeNull();
      for (const essai of ["defaut", "default", "interne", "negoscore", "secret", "1", "true", CLE]) {
        expect(markSecretValid(essai), essai).toBe(false);
        expect((await post({ cle: essai, action: "marquer" })).status, essai).toBe(404);
      }
    }
  });

  it("la page dit en toutes lettres que ce navigateur n'est PAS marqué", async () => {
    jar.value = null;
    const rendu = await html(CLE);
    expect(rendu).toContain("n’est PAS marqué");
    expect(rendu).not.toContain("EST marqué comme interne");
    // Et le bouton propose de le marquer.
    expect(rendu).toContain("Marquer ce navigateur comme interne");
  });

  it("la page dit en toutes lettres qu'il EST marqué, et propose de retirer", async () => {
    jar.value = internalToken(SEL);
    const rendu = await html(CLE);
    expect(rendu).toContain("Ce navigateur EST marqué comme interne");
    expect(rendu).toContain("Retirer la marque");
    expect(rendu).not.toContain("n’est PAS marqué");
  });

  it("un cookie forgé ne fait pas dire à la page qu'il est marqué", async () => {
    jar.value = "1";
    expect(await html(CLE)).toContain("n’est PAS marqué");
  });

  it("marquer : le cookie est posé, signé, pour deux ans, et on revient sur la page", async () => {
    const response = await post({ cle: CLE, action: "marquer" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/interne?cle=${encodeURIComponent(CLE)}`);
    const [cookie] = poses(response);
    expect(cookie).toBeDefined();
    expect(internalTokenValid(/ns_interne=([^;]+)/.exec(cookie)?.[1], SEL)).toBe(true);
    // Deux ans, et les attributs demandés.
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 730}`);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    vi.stubEnv("NODE_ENV", "production");
    expect(poses(await post({ cle: CLE, action: "marquer" }))[0]).toContain("Secure");
  });

  it("retirer : le cookie est effacé, et rien n'est reposé", async () => {
    const response = await post({ cle: CLE, action: "retirer" });
    expect(response.status).toBe(303);
    expect(poses(response)[0]).toContain("Max-Age=0");
  });

  it("mauvais secret sur le formulaire : 404, et aucun cookie", async () => {
    for (const mauvais of ["", "autre", CLE.slice(0, -1)]) {
      const response = await post({ cle: mauvais, action: "marquer" });
      expect(response.status, mauvais).toBe(404);
      expect(poses(response), mauvais).toEqual([]);
    }
    // Sans aucun champ non plus.
    expect((await post({})).status).toBe(404);
  });

  it("la page ne produit aucun événement de visite", async () => {
    const source = readFileSync("app/interne/page.tsx", "utf8");
    // Aucun IMPORT des deux émetteurs : le commentaire de la page les nomme
    // pour dire qu'elle n'en a pas, ce qui n'est pas la même chose.
    const imports = source.split(/\r?\n/).filter((ligne) => ligne.startsWith("import"));
    for (const emetteur of ["view-pixel", "first-party-view", "track-view"]) {
      expect(imports.join(" "), emetteur).not.toContain(emetteur);
    }
    expect(source).not.toMatch(/<(ViewPixel|FirstPartyView|TrackView)\b/);
    const { MEASURED_PAGES } = await import("@/lib/analytics/views");
    expect(Object.keys(MEASURED_PAGES)).not.toContain("/interne");
    // Ni indexée, ni dans le sitemap : ce n'est pas une page publique.
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/);
    const { PUBLIC_PAGES } = await import("@/lib/seo");
    expect(PUBLIC_PAGES.map((p) => p.path)).not.toContain("/interne");
  });

  it("un navigateur marqué est interne SUR TOUTES LES PAGES, pas seulement dans /admin", async () => {
    const cookie = /ns_interne=([^;]+)/.exec(poses(await post({ cle: CLE, action: "marquer" }))[0])?.[1];
    jar.value = cookie ?? null;
    // C'est le même chemin d'écriture que tous les événements du produit :
    // landing_view, analyse, avis, achat passent tous par withEnvironment.
    expect(await tag()).toEqual({ environment: "test", internal: true });
  });

  it("le secret n'est jamais écrit dans le dépôt", () => {
    for (const fichier of ["lib/telemetry/internal.ts", "app/interne/page.tsx", "app/api/interne/route.ts"]) {
      const source = readFileSync(fichier, "utf8");
      // Le nom de la variable, oui. Une valeur par défaut, jamais.
      expect(source, fichier).not.toMatch(/INTERNAL_MARK_SECRET\s*(\|\||\?\?)/);
    }
    expect(readFileSync("lib/telemetry/internal.ts", "utf8")).toContain("INTERNAL_MARK_SECRET");
  });
});

describe("le marquage automatique", () => {
  const jwt = (exp: number) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;
  const FRESH = jwt(4102444800);

  const supabaseAs = (email: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/token")) {
          return Response.json({ access_token: FRESH, refresh_token: "nouveau", expires_in: 3600, user: { id: "u1", email } });
        }
        return Response.json({ id: "u1", email });
      }),
    );

  const marked = (r: Response) =>
    r.headers.getSetCookie().some((c) => c.startsWith(`${INTERNAL_COOKIE}=`) && !/Max-Age=0/.test(c));

  const signIn = (email: string) =>
    completeSignIn(
      new Request("https://negoscore.fr/auth/callback"),
      { accessToken: "a", refreshToken: "r", expiresIn: 3600, user: { id: "u1", email } },
      "/compte",
      { source: "callback" },
    );

  it("cas 1 et 2 — se connecter avec une adresse interne marque ce navigateur", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(marked(await signIn(TEST_ACCOUNT))).toBe(true);
    expect(marked(await signIn(OWNER))).toBe(true);
  });

  it("une visiteuse qui se connecte n'est pas marquée", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(marked(await signIn(VISITEUSE))).toBe(false);
  });

  it("une visiteuse qui se connecte sur MON appareil ne le démarque pas", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await signIn(VISITEUSE);
    // Aucun en-tête n'efface le marquage : seul /api/interne?retirer le fait.
    expect(response.headers.getSetCookie().filter((c) => c.startsWith(`${INTERNAL_COOKIE}=`))).toEqual([]);
  });

  it("le proxy marque une session interne déjà ouverte, sur une page de compte", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    supabaseAs(TEST_ACCOUNT);
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("http://localhost:3000/compte", { headers: { cookie: `sb_access_token=${FRESH}` } }));
    expect(marked(response)).toBe(true);
  });

  it("une visiteuse connectée n'est jamais marquée", async () => {
    vi.stubEnv("INTERNAL_EMAILS", TEST_ACCOUNT);
    supabaseAs(VISITEUSE);
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("http://localhost:3000/compte", { headers: { cookie: `sb_access_token=${FRESH}` } }));
    expect(marked(response)).toBe(false);
  });

  it("le cookie déjà posé n'est pas reposé à chaque navigation", async () => {
    supabaseAs(OWNER);
    const { proxy } = await import("@/proxy");
    const cookie = `sb_access_token=${FRESH}; ${INTERNAL_COOKIE}=${internalToken(SEL)}`;
    const response = await proxy(new NextRequest("http://localhost:3000/compte", { headers: { cookie } }));
    expect(response.headers.getSetCookie().filter((c) => c.startsWith(`${INTERNAL_COOKIE}=`))).toEqual([]);
  });

  it("aucun appel supplémentaire à Supabase : sur une page publique, rien n'est vérifié ni marqué", async () => {
    supabaseAs(OWNER);
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("http://localhost:3000/", { headers: { cookie: `sb_access_token=${FRESH}` } }));
    expect(marked(response)).toBe(false);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le cockpit", () => {
  it("les requêtes admin écartent l'interne partout où elles écartaient le hors-production", () => {
    const sql = readFileSync("supabase/migrations/20260925000032_telemetry_internal.sql", "utf8");
    // Les lignes de commentaire sont écartées : la requête de LECTURE des
    // jours déjà passés, elle, n'a pas à filtrer l'interne — aucune ligne ne
    // le porte avant cette migration.
    const filters = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .flatMap((line) => line.match(/environment\s*=\s*'production'[^\n]*/g) ?? []);
    expect(filters.length).toBeGreaterThanOrEqual(7);
    for (const filter of filters) {
      // La seule exception est le compteur de l'interne lui-même.
      if (/and\s+internal\b/.test(filter)) continue;
      expect(filter, filter).toMatch(/not\s+(\w+\.)?internal\b/);
    }
    expect(sql).toContain("'internal', (select total from internal_events)");
  });

  it("la colonne est ajoutée sur les cinq tables comptées, et l'historique n'est pas réécrit", () => {
    const sql = readFileSync("supabase/migrations/20260925000032_telemetry_internal.sql", "utf8");
    for (const table of ["product_events", "analysis_feedback", "analyses", "deals", "purchases"]) {
      expect(sql, table).toContain(`alter table public.${table} add column if not exists internal boolean not null default false;`);
    }
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bupdate\s+public\./i);
  });

  it("deux compteurs distincts à l'écran, et ils ne se recouvrent pas", async () => {
    const { excludedNotice, internalNotice } = await import("@/lib/admin/data");
    const data = {
      counts: {}, excluded: 218, internal: 37, paid_pro: 0, granted_pro: 0,
      feedback: { total: 0, fair: 0, not_fair: 0 },
      purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
      timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 }, tier_changes: [],
    };
    expect(excludedNotice(data)).toContain("218 événement(s) hors production");
    expect(internalNotice(data)).toContain("37 événement(s)");
    expect(internalNotice(data)).toMatch(/interne/i);
    expect(internalNotice({ ...data, internal: 0 })).toContain("0 événement(s)");
  });

  it("le compteur s'affiche, même si la migration n'est pas encore appliquée", async () => {
    const { internalNotice } = await import("@/lib/admin/data");
    // Mission #132 — rendu par le composant client du cockpit.
    const page = readFileSync("components/admin/cockpit.tsx", "utf8");
    expect(page).toContain("internalNotice(data)");
    // RPC d'avant la migration : pas de champ `internal`, et zéro plutôt
    // qu'un affichage cassé.
    const data = readFileSync("lib/admin/data.ts", "utf8");
    expect(data).toContain("internal: data.internal ?? 0");
    expect(internalNotice({
      counts: {}, excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
      feedback: { total: 0, fair: 0, not_fair: 0 },
      purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
      timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 }, tier_changes: [],
    })).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("rien ne change pour un utilisateur", () => {
  it("le cookie est annoncé dans la politique de confidentialité", async () => {
    const { COOKIES } = await import("@/lib/legal/cookies");
    expect(COOKIES.join(" ")).toContain(INTERNAL_COOKIE);
  });

  it("la page de confidentialité l'affiche vraiment", async () => {
    const { COOKIES } = await import("@/lib/legal/cookies");
    const ligne = COOKIES.find((c) => c.startsWith(INTERNAL_COOKIE));
    expect(ligne).toBeDefined();
    const markup = renderToStaticMarkup(<ul>{COOKIES.map((c) => <li key={c}>{c}</li>)}</ul>);
    expect(markup).toContain(INTERNAL_COOKIE);
  });

  it("la clé service_role n'est pas lue par un module de plus", () => {
    const source = readFileSync("lib/telemetry/internal.ts", "utf8");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).toContain("serverSalt");
  });
});
