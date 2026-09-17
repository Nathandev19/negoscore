import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_HINT_COOKIE } from "@/lib/auth/session-hint";
import { nextFromEmailLink, signedInRedirectPath } from "@/lib/auth/sign-in";
import { SIGN_IN_OTP_TYPES, SUPABASE_EMAIL_OTP_TYPES } from "@/lib/auth/otp-types";

const auth = vi.hoisted(() => ({
  session: {
    accessToken: "access-token-test",
    refreshToken: "refresh-token-test",
    expiresIn: 3600,
    user: { id: "7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e", email: "nina@example.com" },
  },
  verify: vi.fn(),
  exchange: vi.fn(),
  ensure: vi.fn(async () => undefined),
  attach: vi.fn(async () => ({ attached: 1, refused: false })),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  verifyOtpTokenHash: auth.verify,
  exchangeCode: auth.exchange,
}));
vi.mock("@/lib/auth/account", () => ({ ensureAccount: auth.ensure, attachAnonDeals: auth.attach }));

const SITE = "http://localhost:3000";

async function confirm(query: string, cookie?: string) {
  const { GET } = await import("@/app/auth/confirm/route");
  return GET(new Request(`${SITE}/auth/confirm?${query}`, { headers: cookie ? { cookie } : {} }));
}

function cookieNames(response: Response): string[] {
  return response.headers.getSetCookie().map((c) => c.split("=")[0]);
}

beforeEach(() => {
  auth.verify.mockReset();
  auth.exchange.mockReset();
  auth.ensure.mockClear();
  auth.attach.mockClear();
  auth.verify.mockResolvedValue({ session: auth.session, error: null });
});

describe("/auth/confirm", () => {
  it("vérifie le token_hash avec le type reçu, sans vérificateur PKCE", async () => {
    const response = await confirm("token_hash=pkce_abc123&type=email");
    expect(auth.verify).toHaveBeenCalledWith("pkce_abc123", "email");
    expect(auth.exchange).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });

  it("pose la session dans les mêmes cookies httpOnly, plus ns_session, et efface le cookie anonyme", async () => {
    const response = await confirm("token_hash=h&type=email", "deal_anon_token=anon");
    const cookies = response.headers.getSetCookie();
    const access = cookies.find((c) => c.startsWith("sb_access_token="));
    const refresh = cookies.find((c) => c.startsWith("sb_refresh_token="));
    expect(access).toContain("sb_access_token=access-token-test");
    expect(access).toContain("HttpOnly");
    expect(refresh).toContain("sb_refresh_token=refresh-token-test");
    expect(refresh).toContain("HttpOnly");
    expect(cookies).toContain(`${SESSION_HINT_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`);
    expect(cookies.some((c) => c.startsWith("deal_anon_token=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(auth.ensure).toHaveBeenCalledWith(auth.session.user);
    expect(auth.attach).toHaveBeenCalledWith(auth.session.user.id, "anon");
  });

  it("mêmes cookies de session que la route callback", async () => {
    const { GET: callback } = await import("@/app/auth/callback/route");
    auth.exchange.mockResolvedValue(auth.session);
    const viaCallback = await callback(new Request(`${SITE}/auth/callback?code=c`, { headers: { cookie: "sb_pkce_verifier=v" } }));
    const viaConfirm = await confirm("token_hash=h&type=email");
    const sessionCookies = (r: Response) =>
      r.headers.getSetCookie().filter((c) => /^(sb_access_token|sb_refresh_token|ns_session)=/.test(c));
    expect(sessionCookies(viaConfirm)).toEqual(sessionCookies(viaCallback));
  });

  it("next conservé, qu'il soit un chemin ou l'URL complète de {{ .RedirectTo }}", async () => {
    expect((await confirm("token_hash=h&type=email&next=%2Fhistorique")).headers.get("location")).toBe("/historique?connexion=ok");
    const redirectTo = encodeURIComponent(`${SITE}/auth/callback?next=${encodeURIComponent("/analyse/resultat/abc")}`);
    expect((await confirm(`token_hash=h&type=email&next=${redirectTo}`)).headers.get("location")).toBe(
      "/analyse/resultat/abc?connexion=ok",
    );
    // Gabarit non encodé par Supabase : même résultat.
    expect((await confirm(`token_hash=h&type=email&next=${SITE}/auth/callback?next=%2Fhistorique`)).headers.get("location")).toBe(
      "/historique?connexion=ok",
    );
    expect((await confirm("token_hash=h&type=email")).headers.get("location")).toBe("/compte?connexion=ok");
  });

  it("next externe, en //, ou vers une page de connexion : destination sûre", async () => {
    for (const next of ["https://exemple.test/vol", "//exemple.test", "%2F%2Fexemple.test", "/connexion", "/auth/confirm", "https://exemple.test/auth/callback?next=/historique"]) {
      const location = (await confirm(`token_hash=h&type=email&next=${next}`)).headers.get("location");
      expect(location, next).toBe("/compte?connexion=ok");
    }
  });

  it("échec de vérification : /connexion avec le message existant, aucune session posée, cause journalisée", async () => {
    auth.verify.mockResolvedValue({ session: null, error: { status: 403, code: "otp_expired" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await confirm("token_hash=h&type=email&next=%2Fhistorique");
    expect(response.headers.get("location")).toBe("/connexion?erreur=lien&next=%2Fhistorique");
    expect(cookieNames(response)).toEqual([]);
    expect(auth.ensure).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "auth_confirm_failed", reason: "otp_expired", status: 403 });
    warn.mockRestore();
  });

  it("type absent ou hors des types de connexion : refus sans appel à Supabase", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const query of ["token_hash=h", "token_hash=h&type=recovery", "token_hash=h&type=invite", "token_hash=h&type=email_change", "token_hash=h&type=sms", "type=email"]) {
      const response = await confirm(query);
      expect(response.headers.get("location"), query).toBe("/connexion?erreur=lien&next=%2Fcompte");
      expect(cookieNames(response)).toEqual([]);
    }
    expect(auth.verify).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("types acceptés : sous-ensemble des types email de Supabase", () => {
    for (const type of SIGN_IN_OTP_TYPES) expect(SUPABASE_EMAIL_OTP_TYPES).toContain(type);
    expect(SIGN_IN_OTP_TYPES).toContain("email");
  });
});

describe("/auth/callback, conservée pendant la bascule", () => {
  it("échange toujours un code PKCE avec le vérificateur du navigateur", async () => {
    const { GET: callback } = await import("@/app/auth/callback/route");
    auth.exchange.mockResolvedValue(auth.session);
    const response = await callback(
      new Request(`${SITE}/auth/callback?code=c&next=%2Fhistorique`, { headers: { cookie: "sb_pkce_verifier=v" } }),
    );
    expect(auth.exchange).toHaveBeenCalledWith("c", "v");
    expect(response.headers.get("location")).toBe("/historique?connexion=ok");
    expect(cookieNames(response)).toEqual(expect.arrayContaining(["sb_access_token", "sb_refresh_token", "ns_session", "sb_pkce_verifier"]));
  });

  it("sans vérificateur (autre navigateur) : lien refusé comme avant", async () => {
    const { GET: callback } = await import("@/app/auth/callback/route");
    const response = await callback(new Request(`${SITE}/auth/callback?code=c`));
    expect(response.headers.get("location")).toBe("/connexion?erreur=lien&next=%2Fhistorique");
    expect(auth.exchange).not.toHaveBeenCalled();
  });
});

describe("règles de destination", () => {
  it("chemin interne uniquement, jamais de boucle", () => {
    expect(signedInRedirectPath("/historique")).toBe("/historique");
    expect(signedInRedirectPath(null)).toBe("/compte");
    expect(signedInRedirectPath("//x.test")).toBe("/compte");
    expect(signedInRedirectPath("/connexion?next=/compte")).toBe("/compte");
    expect(signedInRedirectPath("/auth/callback")).toBe("/compte");
    expect(nextFromEmailLink("https://autre.test/historique", SITE)).toBeNull();
    expect(nextFromEmailLink(`${SITE}/offres?x=1`, SITE)).toBe("/offres?x=1");
    expect(nextFromEmailLink("pas une url", SITE)).toBeNull();
  });
});
