import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction } from "@/lib/fixtures/preview-states";

// Mission #067, partie A — l'analyse suit la personne, pas le navigateur.
// Parcours complet sur une fausse base : demande du lien depuis le navigateur
// de l'analyse (A), puis clic sur le lien depuis un autre navigateur (B), sans
// cookie anonyme. Aucun appel réseau : Supabase Auth et PostgREST sont simulés.

type Deal = { id: string; anon_token: string | null; user_id: string | null };
type Claim = { id: string; email: string; anon_token: string; nonce_hash: string; expires_at: string };

const db = vi.hoisted(() => ({
  deals: [] as Deal[],
  claims: [] as Claim[],
  payload: null as unknown,
}));
const auth = vi.hoisted(() => ({
  email: "nina@exemple.test",
  userId: "7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e",
  redirectTo: null as string | null,
}));
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

const param = (filter: string, key: string, op: string) => {
  const found = filter.match(new RegExp(`(?:^|&)${key}=${op}\\.([^&]*)`))?.[1];
  return found === undefined ? undefined : decodeURIComponent(found);
};

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    insertIfAbsent: async () => undefined,
    insertRow: async (table: string, row: Record<string, unknown>) => {
      if (table !== "login_claims") throw new Error(`insertion inattendue : ${table}`);
      const claim = { id: `claim-${db.claims.length + 1}`, ...row } as Claim;
      db.claims.push(claim);
      return claim;
    },
    deleteRowsReturning: async (table: string, filter: string, key: string) => {
      if (table !== "login_claims") throw new Error(`suppression inattendue : ${table}`);
      const hash = param(filter, "nonce_hash", "eq");
      const email = param(filter, "email", "eq");
      const after = param(filter, "expires_at", "gt");
      const before = param(filter, "expires_at", "lt");
      const hit = db.claims.filter(
        (c) =>
          (hash === undefined || c.nonce_hash === hash) &&
          (email === undefined || c.email === email) &&
          (after === undefined || c.expires_at > after) &&
          (before === undefined || c.expires_at < before),
      );
      db.claims = db.claims.filter((c) => !hit.includes(c));
      return hit.map((c) => String(c[key as keyof Claim]));
    },
    selectRows: async (table: string, query: string) => {
      if (table === "deals") {
        const token = param(query, "anon_token", "eq");
        return db.deals.filter((d) => d.anon_token === token && d.user_id !== null).map((d) => ({ user_id: d.user_id }));
      }
      if (table === "analyses") {
        const deal = db.deals.find((d) => d.id === param(query, "id", "eq"));
        return deal
          ? [{ payload: db.payload, deal: { ...deal, source_type: "text", raw_text: "offre", deal_documents: [] } }]
          : [];
      }
      return [];
    },
    updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
      if (table !== "deals") return [];
      const token = param(filter, "anon_token", "eq");
      const hit = db.deals.filter((d) => d.anon_token === token && d.user_id === null);
      for (const deal of hit) Object.assign(deal, patch);
      return hit.map((d) => ({ id: d.id }));
    },
  };
});
const freeUsage = vi.hoisted(() => ({ merge: vi.fn(async () => undefined) }));
vi.mock("@/lib/billing/free-usage", () => ({ mergeFreeUsage: freeUsage.merge }));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: true, count: 1, retryInMinutes: 1 }),
  releaseUsageGuard: async () => undefined,
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
// Contexte de requête du formulaire de connexion (action serveur).
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    set: () => undefined,
  }),
  headers: async () => new Headers({ host: "localhost:3000", "x-forwarded-for": "203.0.113.7" }),
}));

const { requestMagicLink } = await import("@/app/connexion/actions");
const { GET: confirm } = await import("@/app/auth/confirm/route");
const { loadResultForViewer } = await import("@/lib/analysis/load");
const { createLoginClaim, LOGIN_CLAIM_TTL_MINUTES } = await import("@/lib/auth/login-claims");
const { runPurge } = await import("@/lib/privacy/purge");

const SITE = "http://localhost:3000";
const TOKEN = "jeton-anonyme-du-navigateur-A";
const DEAL = "11111111-1111-4111-8111-111111111111";
const OTHER_DEAL = "22222222-2222-4222-8222-222222222222";

// Demande du lien depuis un navigateur qui porte (ou non) un jeton anonyme.
async function requestLink(email: string, next: string, anonToken: string | null) {
  browser.cookies = new Map(anonToken ? [["deal_anon_token", anonToken]] : []);
  const form = new FormData();
  form.set("email", email);
  form.set("next", next);
  const state = await requestMagicLink({ status: "idle", message: null }, form);
  expect(state.status).toBe("sent");
  return auth.redirectTo as string;
}

// Le lien tel que le gabarit Supabase le fabrique : {{ .RedirectTo }} inséré
// tel quel (encoded = false) ou encodé.
function emailLink(redirectTo: string, encoded = false) {
  return `${SITE}/auth/confirm?token_hash=h&type=email&next=${encoded ? encodeURIComponent(redirectTo) : redirectTo}`;
}

// Clic sur le lien, dans un navigateur donné (cookie anonyme ou rien).
async function click(link: string, as: { email: string; userId: string }, cookie?: string) {
  auth.email = as.email;
  auth.userId = as.userId;
  return confirm(new Request(link, { headers: cookie ? { cookie } : {} }));
}

const NINA = { email: "nina@exemple.test", userId: "7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e" };
const MALO = { email: "malo@exemple.test", userId: "0a0b0c0d-1111-4222-8333-444455556666" };

beforeEach(() => {
  process.env.IP_HASH_SALT = "sel-de-test";
  db.deals = [{ id: DEAL, anon_token: TOKEN, user_id: null }];
  db.claims = [];
  db.payload = composeAnalysis(baseExtraction());
  auth.redirectTo = null;
  freeUsage.merge.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("A5 — lien ouvert dans un autre navigateur", () => {
  it.each([false, true])("l'analyse est rattachée et s'ouvre débloquée (RedirectTo encodé : %s)", async (encoded) => {
    const redirectTo = await requestLink(NINA.email, `/analyse/resultat/${DEAL}#message`, TOKEN);
    expect(redirectTo).toMatch(/&reclamation=[A-Za-z0-9_-]{32}$/);
    // Ce qui est stocké : l'adresse, le jeton, l'empreinte du secret — jamais le secret.
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({ email: NINA.email, anon_token: TOKEN });
    expect(redirectTo).not.toContain(db.claims[0].nonce_hash);

    // Navigateur B : aucun cookie anonyme.
    const response = await click(emailLink(redirectTo, encoded), NINA);
    expect(response.headers.get("location")).toBe(`/analyse/resultat/${DEAL}?connexion=ok#message`);
    expect(db.deals[0].user_id).toBe(NINA.userId);
    // Réclamation utilisée : supprimée, elle ne peut plus resservir.
    expect(db.claims).toEqual([]);

    const result = await loadResultForViewer(DEAL, { user: { id: NINA.userId, email: NINA.email }, anonToken: null });
    expect(result?.unlocked).toBe(true);
    expect(result?.analysis.ready_to_send_message).not.toBeNull();
  });

  it("dans le navigateur d'origine, le cookie suffit toujours (comportement inchangé)", async () => {
    const redirectTo = await requestLink(NINA.email, `/analyse/resultat/${DEAL}`, TOKEN);
    await click(emailLink(redirectTo), NINA, `deal_anon_token=${TOKEN}`);
    expect(db.deals[0].user_id).toBe(NINA.userId);
  });
});

describe("A5 — l'identifiant d'une analyse d'autrui ne suffit pas", () => {
  it("se connecter avec next=/analyse/resultat/<id d'autrui> : rien n'est rattaché, 404", async () => {
    // Malo connaît l'identifiant, demande un lien depuis SON navigateur (son propre jeton).
    const redirectTo = await requestLink(MALO.email, `/analyse/resultat/${DEAL}`, "jeton-de-malo");
    await click(emailLink(redirectTo), MALO);
    expect(db.deals[0].user_id).toBeNull();
    expect(await loadResultForViewer(DEAL, { user: { id: MALO.userId, email: MALO.email }, anonToken: null })).toBeNull();
  });

  it("un secret inventé ou recopié d'une autre forme : refusé", async () => {
    await requestLink(NINA.email, "/historique", TOKEN);
    for (const forged of ["x".repeat(32), "../../etc", DEAL]) {
      await click(`${SITE}/auth/confirm?token_hash=h&type=email&next=%2Fhistorique&reclamation=${forged}`, MALO);
    }
    expect(db.deals[0].user_id).toBeNull();
    expect(db.claims).toHaveLength(1);
  });

  it("le vrai secret, mais une session pour une autre adresse : refusé, et la réclamation reste à Nina", async () => {
    // Le lien de Nina est tombé entre les mains de Malo (email transféré),
    // qui se connecte avec sa propre adresse.
    const redirectTo = await requestLink(NINA.email, "/historique", TOKEN);
    await click(emailLink(redirectTo), MALO);
    expect(db.deals[0].user_id).toBeNull();
    expect(db.claims).toHaveLength(1);
  });

  it("une réclamation ne sert qu'une fois", async () => {
    const redirectTo = await requestLink(NINA.email, "/historique", TOKEN);
    await click(emailLink(redirectTo), NINA);
    db.deals.push({ id: OTHER_DEAL, anon_token: TOKEN, user_id: null });
    await click(emailLink(redirectTo), NINA);
    expect(db.deals.find((d) => d.id === OTHER_DEAL)?.user_id).toBeNull();
  });

  it("sans jeton anonyme à la demande : aucune réclamation, lien inchangé", async () => {
    const redirectTo = await requestLink(NINA.email, "/historique", null);
    expect(redirectTo).not.toContain("reclamation");
    expect(db.claims).toEqual([]);
  });
});

describe("A5 — autorisation expirée", () => {
  it(`plus de ${LOGIN_CLAIM_TTL_MINUTES} minutes après la demande : refusée`, async () => {
    const past = new Date(Date.now() - (LOGIN_CLAIM_TTL_MINUTES + 1) * 60_000);
    const nonce = await createLoginClaim(NINA.email, TOKEN, past);
    await click(`${SITE}/auth/confirm?token_hash=h&type=email&next=%2Fhistorique&reclamation=${nonce}`, NINA);
    expect(db.deals[0].user_id).toBeNull();
  });

  it("juste avant l'échéance : acceptée", async () => {
    const past = new Date(Date.now() - (LOGIN_CLAIM_TTL_MINUTES - 1) * 60_000);
    const nonce = await createLoginClaim(NINA.email, TOKEN, past);
    await click(`${SITE}/auth/confirm?token_hash=h&type=email&next=%2Fhistorique&reclamation=${nonce}`, NINA);
    expect(db.deals[0].user_id).toBe(NINA.userId);
  });

  it("la purge quotidienne supprime les réclamations expirées, et elles seules", async () => {
    await createLoginClaim(NINA.email, TOKEN, new Date(Date.now() - 3 * 3600_000));
    await createLoginClaim(MALO.email, "autre", new Date());
    const report = await runPurge(new Date(), { loginClaimIds: db.claims.map((c) => c.id) });
    expect(report.login_claims).toBe(1);
    expect(db.claims.map((c) => c.email)).toEqual([MALO.email]);
  });
});

describe("A5 — plusieurs analyses du même jeton", () => {
  it("toutes rattachées, et seulement celles-là", async () => {
    const third = "33333333-3333-4333-8333-333333333333";
    db.deals.push(
      { id: OTHER_DEAL, anon_token: TOKEN, user_id: null },
      { id: third, anon_token: TOKEN, user_id: null },
      { id: "44444444-4444-4444-8444-444444444444", anon_token: "jeton-d-un-autre", user_id: null },
    );
    const redirectTo = await requestLink(NINA.email, "/historique", TOKEN);
    await click(emailLink(redirectTo), NINA);
    expect(db.deals.filter((d) => d.user_id === NINA.userId).map((d) => d.id).sort()).toEqual([DEAL, OTHER_DEAL, third].sort());
    expect(db.deals.find((d) => d.anon_token === "jeton-d-un-autre")?.user_id).toBeNull();
  });
});

describe("RISQUE ACCEPTÉ (#068) — un lien non sollicité, cliqué par son destinataire", () => {
  it("rattache au compte de la personne qui clique les analyses du jeton de celui qui a demandé le lien, ET lui reporte l'analyse gratuite consommée sous ce jeton", async () => {
    // Malo, dans son navigateur, a lancé une analyse gratuite (jeton de Malo),
    // puis demande un lien de connexion en saisissant l'adresse de Nina.
    const MALO_TOKEN = "jeton-de-malo";
    db.deals = [{ id: OTHER_DEAL, anon_token: MALO_TOKEN, user_id: null }];
    const redirectTo = await requestLink(NINA.email, "/historique", MALO_TOKEN);

    // Nina reçoit cet email qu'elle n'a pas demandé, et clique.
    await click(emailLink(redirectTo), NINA);

    // 1. L'analyse de Malo arrive sur le compte de Nina.
    expect(db.deals[0].user_id).toBe(NINA.userId);
    // 2. La gratuité consommée par Malo est reportée sur le compte de Nina :
    //    l'analyse gratuite de Nina peut être perdue.
    expect(freeUsage.merge).toHaveBeenCalledWith(MALO_TOKEN, NINA.userId);
    // Ce test documente un comportement VOULU. S'il échoue, c'est que la
    // réclamation ou le report de gratuité ont changé : vérifie que c'est un
    // choix, puis mets à jour le commentaire de lib/auth/sign-in.ts.
  });
});
