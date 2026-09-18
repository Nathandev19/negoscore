import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderNav, navItems, OWNER_NAV_ITEM } from "@/components/header-nav";
import { hasOwnerHint, OWNER_HINT_COOKIE } from "@/lib/auth/owner-hint";

// Mission #080, A — le lien vers /dev/retours dans l'en-tête, pour le seul
// propriétaire. L'indicateur choisit un lien, il n'autorise rien.

const OWNER = "nathan@exemple.test";
const SUPABASE = "https://projet.supabase.test";

const auth = vi.hoisted(() => ({ email: "nina@exemple.test" }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    verifyOtpTokenHash: async () => ({
      session: { accessToken: "a", refreshToken: "r", expiresIn: 3600, user: { id: "u1", email: auth.email } },
      error: null,
    }),
    signOut: async () => undefined,
  };
});
vi.mock("@/lib/auth/account", () => ({
  ensureAccount: async () => undefined,
  attachAnonDeals: async () => ({ attached: 0, refused: false }),
}));

const { GET: confirm } = await import("@/app/auth/confirm/route");
const { POST: signOutRoute } = await import("@/app/auth/deconnexion/route");
const { proxy } = await import("@/proxy");

const ownerHintSet = (r: Response) => r.headers.getSetCookie().filter((c) => c.startsWith(`${OWNER_HINT_COOKIE}=`));
const setsHint = (r: Response) => ownerHintSet(r).some((c) => c.startsWith(`${OWNER_HINT_COOKIE}=1;`) && !/Max-Age=0/.test(c));
const clearsHint = (r: Response) => ownerHintSet(r).some((c) => /Max-Age=0/.test(c));

// Jeton d'accès encore valide (exp en 2100) ou expiré : seul le proxy lit exp.
const jwt = (exp: number) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;
const FRESH = jwt(4102444800);
const EXPIRED = jwt(1);

// Faux Supabase Auth : /user et /token répondent pour l'adresse donnée ; null = session refusée.
function supabaseAs(email: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (email === null) return Response.json({ msg: "refus" }, { status: 400 });
      if (url.includes("/token")) {
        return Response.json({ access_token: FRESH, refresh_token: "nouveau", expires_in: 3600, user: { id: "u1", email } });
      }
      return Response.json({ id: "u1", email });
    }),
  );
}

const visit = (pathname: string, cookie: string) =>
  proxy(new NextRequest(`http://localhost:3000${pathname}`, { headers: cookie ? { cookie } : {} }));
const rewrittenTo = (r: Response) => {
  const target = r.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
};

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", OWNER);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("A1 — posé à la connexion pour le propriétaire, effacé avec la session", () => {
  it("connexion avec l'adresse du propriétaire : indicateur posé, sans aucune adresse dans sa valeur", async () => {
    auth.email = "Nathan@Exemple.test";
    const r = await confirm(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=email"));
    expect(setsHint(r)).toBe(true);
    expect(ownerHintSet(r)[0]).not.toMatch(/@|nathan/i);
  });

  it("connexion avec une autre adresse : indicateur effacé (un reste d'une session précédente disparaît)", async () => {
    auth.email = "nina@exemple.test";
    const r = await confirm(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=email"));
    expect(setsHint(r)).toBe(false);
    expect(clearsHint(r)).toBe(true);
  });

  it("déconnexion : effacé", async () => {
    const r = await signOutRoute(new Request("http://localhost:3000/auth/deconnexion", { method: "POST" }));
    expect(clearsHint(r)).toBe(true);
  });

  it("session refusée par Supabase : effacé avec les cookies de session", async () => {
    supabaseAs(null);
    const r = await visit("/", `sb_access_token=${EXPIRED}; sb_refresh_token=perime; ns_session=1; ${OWNER_HINT_COOKIE}=1`);
    expect(clearsHint(r)).toBe(true);
  });

  it("indicateur orphelin (aucun cookie de session) : effacé, sans appeler Supabase", async () => {
    supabaseAs(OWNER);
    const r = await visit("/", `${OWNER_HINT_COOKIE}=1`);
    expect(clearsHint(r)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("session rafraîchie : reposé pour le propriétaire, effacé pour une autre adresse", async () => {
    supabaseAs(OWNER);
    expect(setsHint(await visit("/", `sb_access_token=${EXPIRED}; sb_refresh_token=r`))).toBe(true);
    supabaseAs("nina@exemple.test");
    expect(clearsHint(await visit("/", `sb_access_token=${EXPIRED}; sb_refresh_token=r; ${OWNER_HINT_COOKIE}=1`))).toBe(true);
  });
});

describe("A1 — le lien dans l'en-tête", () => {
  it("seulement connecté ET propriétaire", () => {
    expect(navItems(true, true).main).toContainEqual(OWNER_NAV_ITEM);
    expect(navItems(true, false).main).not.toContainEqual(OWNER_NAV_ITEM);
    expect(navItems(false, true).main).not.toContainEqual(OWNER_NAV_ITEM);
    expect(renderToStaticMarkup(<HeaderNav signedIn owner />)).toContain('href="/dev/retours"');
    expect(renderToStaticMarkup(<HeaderNav signedIn owner={false} />)).not.toContain("/dev/retours");
    // Rendu serveur (état inconnu) : jamais le lien.
    expect(renderToStaticMarkup(<HeaderNav signedIn={null} />)).not.toContain("/dev/retours");
  });

  it("lecture de l'indicateur dans document.cookie", () => {
    expect(hasOwnerHint(`ns_session=1; ${OWNER_HINT_COOKIE}=1`)).toBe(true);
    expect(hasOwnerHint(`${OWNER_HINT_COOKIE}=0`)).toBe(false);
    expect(hasOwnerHint("ns_session=1")).toBe(false);
  });
});

describe("A2 — indicateur posé à la main : un lien qui ne mène qu'à une 404", () => {
  it("le lien s'affiche (l'en-tête ne sait rien de plus que le cookie)…", () => {
    expect(renderToStaticMarkup(<HeaderNav signedIn owner />)).toContain('href="/dev/retours"');
  });

  it("…mais sans session, /dev/retours répond comme une adresse inexistante", async () => {
    supabaseAs(OWNER);
    const r = await visit("/dev/retours", `ns_session=1; ${OWNER_HINT_COOKIE}=1`);
    expect(rewrittenTo(r)).toBe("/_introuvable");
  });

  it("…et avec la session d'une autre adresse, pareil", async () => {
    supabaseAs("nina@exemple.test");
    const r = await visit("/dev/retours", `sb_access_token=${FRESH}; ns_session=1; ${OWNER_HINT_COOKIE}=1`);
    expect(rewrittenTo(r)).toBe("/_introuvable");
  });

  it("la page elle-même ne lit pas l'indicateur : elle revérifie l'adresse de la session", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["app/dev/retours/page.tsx", "app/dev/retours/[id]/page.tsx", "lib/admin/owner.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/owner-hint|OWNER_HINT|hasOwnerHint/);
    }
    // Le proxy lit l'indicateur pour l'EFFACER, jamais pour décider : la seule
    // affectation de « owner » vient de l'adresse vérifiée par Supabase.
    const proxySource = readFileSync("proxy.ts", "utf8");
    expect(proxySource.match(/\bowner = [^;]+;/g)).toEqual(["owner = false;", "owner = isOwnerEmail(check.user.email);"]);
  });
});
