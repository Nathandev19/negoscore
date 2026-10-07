import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #162 — L'ATTRIBUTION DOIT SURVIVRE AU LIEN DE CONNEXION.
//
// Mesuré en production le 07/10 :
//   16:54:14  landing_view      instagram · lancement · bio_instagram, empreinte 8aec1a
//   16:55:25  analysis_started  même empreinte
//   17:03:26  signup            non_attribue, empreinte d5f9ca
// Même personne, huit minutes d'écart, deux empreintes : le lien de connexion
// a été ouvert depuis la messagerie, donc dans un autre navigateur. L'empreinte
// ne peut pas relier les deux — le sel est tiré au hasard chaque jour (#131),
// c'est voulu, on n'y touche pas.
//
// Ce fichier rejoue le parcours ENTIER sur une fausse base : arrivée avec les
// UTM Instagram, analyse anonyme, demande du lien depuis ce navigateur, puis
// clic depuis un AUTRE navigateur — sans cookie, sans référent. Aucun appel
// réseau : PostgREST et Supabase Auth sont simulés.

type Ligne = Record<string, unknown>;

const db = vi.hoisted(() => ({
  deals: [] as Ligne[],
  claims: [] as Ligne[],
  evenements: [] as Ligne[],
  comptes: [] as string[],
  // Colonnes que la base REFUSE : sert à rejouer le déploiement fait avant que
  // la migration 20261007000039 soit appliquée à la main.
  colonnesAbsentes: [] as string[],
}));
const auth = vi.hoisted(() => ({
  email: "elise@exemple.test",
  userId: "7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e",
  redirectTo: null as string | null,
}));
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

const param = (filtre: string, cle: string, op: string) => {
  const trouve = filtre.match(new RegExp(`(?:^|&)${cle}=${op}\\.([^&]*)`))?.[1];
  return trouve === undefined ? undefined : decodeURIComponent(trouve);
};

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  // L'erreur que PostgREST rend sur une colonne qui n'existe pas (PGRST204).
  const colonneAbsente = (row: Ligne) => {
    const fautive = Object.keys(row).find((cle) => db.colonnesAbsentes.includes(cle));
    if (!fautive) return null;
    return new actual.SupabaseRequestError(`Could not find the '${fautive}' column`, 400, "PGRST204");
  };
  return {
    ...actual,
    insertIfAbsent: async (table: string, row: Ligne) => {
      if (table === "product_events") db.evenements.push(row);
    },
    insertRow: async (table: string, row: Ligne) => {
      const refus = colonneAbsente(row);
      if (refus) throw refus;
      const ligne = { id: `${table}-${Date.now()}-${Math.random()}`, ...row };
      if (table === "login_claims") db.claims.push(ligne);
      if (table === "deals") db.deals.push(ligne);
      return ligne;
    },
    deleteRowsReturningAll: async (table: string, filtre: string, select: string) => {
      if (table !== "login_claims") return [];
      const refus = colonneAbsente(Object.fromEntries(select.split(",").map((c) => [c, null])));
      if (refus) throw refus;
      const hash = param(filtre, "nonce_hash", "eq");
      const email = param(filtre, "email", "eq");
      const apres = param(filtre, "expires_at", "gt");
      const touches = db.claims.filter(
        (c) =>
          (hash === undefined || c.nonce_hash === hash) &&
          (email === undefined || c.email === email) &&
          (apres === undefined || String(c.expires_at) > apres),
      );
      db.claims = db.claims.filter((c) => !touches.includes(c));
      return touches.map((c) => ({ ...c }));
    },
    deleteRowsReturning: async (table: string, filtre: string, cle: string) => {
      if (table !== "login_claims") return [];
      const hash = param(filtre, "nonce_hash", "eq");
      const touches = db.claims.filter((c) => hash === undefined || c.nonce_hash === hash);
      db.claims = db.claims.filter((c) => !touches.includes(c));
      return touches.map((c) => String(c[cle]));
    },
    selectRows: async (table: string, query: string) => {
      if (table === "deals" && query.includes("utm_source")) {
        if (db.colonnesAbsentes.includes("utm_source")) {
          throw new actual.SupabaseRequestError("Could not find the 'utm_source' column", 400, "PGRST204");
        }
        const token = param(query, "anon_token", "eq");
        return db.deals.filter((d) => d.anon_token === token);
      }
      return [];
    },
    updateRows: async () => [],
    countRows: async () => 0,
  };
});

vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: true, count: 1, retryInMinutes: 1 }),
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/billing/free-usage", () => ({ mergeFreeUsage: async () => undefined }));
vi.mock("@/lib/auth/account", () => ({
  ensureAccount: async () => {
    const neuf = !db.comptes.includes(auth.userId);
    if (neuf) db.comptes.push(auth.userId);
    return { created: neuf };
  },
  attachAnonDeals: async () => ({ attached: 0, refused: false }),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  sendMagicLink: async (_email: string, _challenge: string, redirectTo: string) => {
    auth.redirectTo = redirectTo;
    return true;
  },
  verifyOtpTokenHash: async () => ({
    session: { accessToken: "a", refreshToken: "r", expiresIn: 3600, user: { id: auth.userId, email: auth.email } },
    error: null,
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    set: () => undefined,
  }),
  headers: async () => new Headers({ host: "localhost:3000", "x-forwarded-for": "203.0.113.7" }),
}));

const { requestMagicLink } = await import("@/app/connexion/actions");
const { GET: confirmer } = await import("@/app/auth/confirm/route");
const { CLAIM_PARAM } = await import("@/lib/auth/login-claims");

const TOKEN = "jeton-anonyme-d-elise";
const INSTAGRAM = {
  path: "/",
  referrer_host: "instagram.com",
  utm_source: "instagram",
  utm_medium: "organic_social",
  utm_campaign: "lancement",
  utm_content: "bio_instagram",
};

beforeEach(() => {
  // Le hachage d'IP du garde-fou de débit exige un sel serveur.
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
  db.deals = [];
  db.claims = [];
  db.evenements = [];
  db.comptes = [];
  db.colonnesAbsentes = [];
  browser.cookies = new Map();
  auth.redirectTo = null;
});

// Ce que le navigateur A a laissé derrière lui : un deal anonyme portant
// l'attribution de la visite qui l'a soumis (app/api/analyse/route.ts).
function analyseAnonyme(attribution: Record<string, string | null> | null = INSTAGRAM) {
  browser.cookies.set("deal_anon_token", TOKEN);
  db.deals.push({
    id: "deal-1",
    anon_token: TOKEN,
    user_id: null,
    created_at: new Date().toISOString(),
    utm_source: attribution?.utm_source ?? null,
    utm_medium: attribution?.utm_medium ?? null,
    utm_campaign: attribution?.utm_campaign ?? null,
    utm_content: attribution?.utm_content ?? null,
    referrer_host: attribution?.referrer_host ?? null,
  });
}

// La demande de lien, envoyée par le formulaire de /connexion.
async function demanderLeLien(champCache: string | null = null) {
  const form = new FormData();
  form.set("email", auth.email);
  if (champCache !== null) form.set("attribution", champCache);
  const etat = await requestMagicLink({ status: "idle", message: null }, form);
  expect(etat.status, etat.message ?? "").toBe("sent");
  return auth.redirectTo as string;
}

// Le clic, depuis la messagerie : AUTRE navigateur. Aucun cookie, aucun
// référent — exactement ce qui a été mesuré le 07/10.
async function cliquerDepuisLaMessagerie(redirectTo: string) {
  const reclamation = new URL(redirectTo).searchParams.get(CLAIM_PARAM);
  const lien = new URL("http://localhost:3000/auth/confirm");
  lien.searchParams.set("token_hash", "jeton-de-verification");
  lien.searchParams.set("type", "magiclink");
  lien.searchParams.set("next", "/historique");
  if (reclamation) lien.searchParams.set(CLAIM_PARAM, reclamation);
  // Pas d'en-tête Cookie, pas de Referer : un autre navigateur.
  return confirmer(new Request(lien, { headers: { host: "localhost:3000" } }));
}

const inscription = () => db.evenements.find((e) => e.event_name === "signup");

// ───────────────────────────────────────────────────────────────────────────
describe("le parcours réel du 07/10, de bout en bout", () => {
  it("arrivée Instagram, analyse, lien demandé ici, lien ouvert ailleurs : signup attribué", async () => {
    analyseAnonyme();
    const redirectTo = await demanderLeLien();

    // L'attribution est rangée AVEC LA DEMANDE, côté serveur.
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({
      email: auth.email,
      anon_token: TOKEN,
      utm_source: "instagram",
      utm_medium: "organic_social",
      utm_campaign: "lancement",
      utm_content: "bio_instagram",
      referrer_host: "instagram.com",
    });

    const reponse = await cliquerDepuisLaMessagerie(redirectTo);
    expect(reponse.status).toBe(303);

    // Et c'est là que tout se joue : le signup porte l'attribution de l'arrivée.
    expect(inscription()).toMatchObject({
      event_name: "signup",
      user_id: auth.userId,
      utm_source: "instagram",
      utm_medium: "organic_social",
      utm_campaign: "lancement",
      utm_content: "bio_instagram",
      referrer_host: "instagram.com",
    });
  });

  it("la réclamation ne sert qu'une fois : un second clic n'écrit pas un second signup", async () => {
    analyseAnonyme();
    const redirectTo = await demanderLeLien();
    await cliquerDepuisLaMessagerie(redirectTo);
    const premier = db.evenements.filter((e) => e.event_name === "signup").length;
    await cliquerDepuisLaMessagerie(redirectTo);
    expect(db.evenements.filter((e) => e.event_name === "signup")).toHaveLength(premier);
    expect(db.claims).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("on n'invente jamais une origine", () => {
  it("aucune attribution nulle part : signup non attribué, et la connexion marche quand même", async () => {
    analyseAnonyme(null);
    const redirectTo = await demanderLeLien();
    expect(db.claims[0]).toMatchObject({ utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, referrer_host: null });
    const reponse = await cliquerDepuisLaMessagerie(redirectTo);
    expect(reponse.status).toBe(303);
    expect(inscription()).toMatchObject({ event_name: "signup", utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null });
  });

  it("ni analyse ni UTM : aucune réclamation n'est créée pour rien", async () => {
    const redirectTo = await demanderLeLien();
    expect(db.claims).toHaveLength(0);
    expect(new URL(redirectTo).searchParams.get(CLAIM_PARAM)).toBeNull();
    await cliquerDepuisLaMessagerie(redirectTo);
    expect(inscription()).toMatchObject({ event_name: "signup", utm_source: null });
  });

  it("arrivée directe sur /connexion avec des UTM, sans analyse : la réclamation existe pour les porter", async () => {
    const depuisLaPage = { ...INSTAGRAM, path: "/connexion", utm_content: "dm_prospection", utm_medium: "dm" };
    const redirectTo = await demanderLeLien(JSON.stringify(depuisLaPage));
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({ anon_token: null, utm_source: "instagram", utm_content: "dm_prospection" });
    await cliquerDepuisLaMessagerie(redirectTo);
    expect(inscription()).toMatchObject({ utm_source: "instagram", utm_medium: "dm", utm_content: "dm_prospection" });
  });

  it("un champ caché fabriqué ne passe pas tel quel : il est borné et nettoyé comme partout", async () => {
    for (const fabrique of ["pas du json", "null", JSON.stringify({ utm_source: "A".repeat(500), path: "https://evil.test/x" }), "[]"]) {
      db.claims = [];
      await demanderLeLien(fabrique);
      const claim = db.claims[0];
      if (claim) expect(String(claim.utm_source ?? "")).toHaveLength(claim.utm_source ? 100 : 0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("une attribution déjà présente n'est jamais écrasée", () => {
  it("le champ caché gagne sur le premier contact, champ par champ", async () => {
    analyseAnonyme();
    // La page courante dit TikTok ; le premier contact disait Instagram. Ce que
    // la page sait l'emporte, et ce qu'elle ne dit pas est complété, jamais
    // remplacé (même règle qu'en #152 pour les liens internes).
    await demanderLeLien(JSON.stringify({ utm_source: "tiktok", utm_content: "video_1_negociation" }));
    expect(db.claims[0]).toMatchObject({
      utm_source: "tiktok",
      utm_content: "video_1_negociation",
      // Non dits par la page : complétés par le premier contact.
      utm_medium: "organic_social",
      utm_campaign: "lancement",
      referrer_host: "instagram.com",
    });
  });

  it("mergeAttribution ne remplace aucun champ déjà renseigné", async () => {
    const { mergeAttribution } = await import("@/lib/analytics/first-party");
    expect(mergeAttribution({ utm_source: "tiktok" }, { utm_source: "instagram", utm_campaign: "lancement" })).toMatchObject({
      utm_source: "tiktok",
      utm_campaign: "lancement",
    });
    expect(mergeAttribution(null, null)).toEqual({
      path: null, referrer_host: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("rien ne voyage dans l'adresse du lien envoyé par email", () => {
  it("le lien ne porte que la destination et un secret aléatoire", async () => {
    analyseAnonyme();
    const redirectTo = await demanderLeLien(JSON.stringify(INSTAGRAM));
    const url = new URL(redirectTo);
    const params = [...url.searchParams.keys()].sort();
    expect(params).toEqual(["next", CLAIM_PARAM].sort());
    // Aucune trace d'attribution, d'adresse email, de jeton anonyme ni
    // d'identifiant de compte : un lien de connexion transite par des serveurs
    // qu'on ne contrôle pas et finit dans des journaux.
    const entier = redirectTo.toLowerCase();
    for (const interdit of ["utm_", "instagram", "lancement", "bio_instagram", "elise", "exemple.test", TOKEN, auth.userId]) {
      expect(entier, interdit).not.toContain(interdit.toLowerCase());
    }
    // Le secret, lui, est bien aléatoire et ne dit rien : 32 caractères.
    expect(url.searchParams.get(CLAIM_PARAM)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la migration appliquée à la main : le déploiement d'avant ne casse rien", () => {
  it("colonnes absentes : la réclamation est créée quand même, et signup reste non attribué", async () => {
    db.colonnesAbsentes = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer_host"];
    analyseAnonyme();
    const redirectTo = await demanderLeLien(JSON.stringify(INSTAGRAM));
    // La réclamation existe : c'est elle qui rattache les analyses anonymes.
    // On perd la mesure, jamais le rattachement.
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({ anon_token: TOKEN });
    expect(db.claims[0].utm_source).toBeUndefined();
    const reponse = await cliquerDepuisLaMessagerie(redirectTo);
    expect(reponse.status).toBe(303);
    expect(inscription()).toMatchObject({ event_name: "signup", utm_source: null });
    // ET LA RÉCLAMATION A BIEN ÉTÉ CONSOMMÉE. C'est tout l'enjeu du repli en
    // lecture : sans lui, le DELETE échoue sur les colonnes absentes, la
    // réclamation survit, et les analyses anonymes ne sont jamais rattachées.
    // On perd la mesure, jamais le rattachement.
    expect(db.claims).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le formulaire envoie l'attribution de la page, et rien d'autre", () => {
  // Le formulaire est un composant client à état (useActionState) : il ne se
  // rend pas hors d'un arbre React. Ce qui est vérifié ici est donc le
  // BALISAGE qu'il déclare — le champ caché existe, il est caché, et il part
  // vide (la page est statique : une valeur figée au build ne dirait rien de
  // la visite).
  it("le champ caché est déclaré, caché, et vide au rendu", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/connexion/login-form.tsx", "utf8");
    expect(source).toContain('<input type="hidden" name="attribution" ref={attributionField} defaultValue="" />');
  });

  it("il est rempli à l'envoi, depuis l'attribution de la page courante", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/connexion/login-form.tsx", "utf8");
    expect(source).toContain("attributionField.current.value = JSON.stringify(currentAttribution())");
    // Dans onSubmit, et dans un try : la mesure ne peut jamais empêcher
    // l'envoi du formulaire de connexion.
    const envoi = source.slice(source.indexOf("function onSubmit"), source.indexOf("return ("));
    expect(envoi).toContain("currentAttribution()");
    expect(envoi).toContain("try {");
  });
});
