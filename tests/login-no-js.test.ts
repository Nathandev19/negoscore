import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #074 — la connexion ne dépend pas du chargement d'un fichier.
// Sans JavaScript, le navigateur envoie le formulaire tel quel : pas de champ
// « next » (il n'existe que dans le navigateur), et la destination n'est
// connue que par l'adresse de la page qui envoie (en-tête Referer). Les
// protections doivent tenir exactement comme avec JavaScript.

const req = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  referer: null as string | null,
  guardAllowed: true,
  redirectTo: null as string | null,
  claims: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name) } : undefined),
    set: () => undefined,
  }),
  headers: async () =>
    new Headers({ host: "localhost:3000", "x-forwarded-for": "203.0.113.7", ...(req.referer ? { referer: req.referer } : {}) }),
}));
vi.mock("@/lib/site-url", () => ({ configuredSiteUrl: () => "http://localhost:3000", originFromHeaders: () => "http://localhost:3000" }));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: req.guardAllowed, count: req.guardAllowed ? 1 : 6, retryInMinutes: 42 }),
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  sendMagicLink: async (_email: string, _challenge: string, redirectTo: string) => {
    req.redirectTo = redirectTo;
    return true;
  },
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  insertRow: async (table: string, row: Record<string, unknown>) => {
    if (table === "login_claims") req.claims.push(row);
    return row;
  },
}));

const { requestMagicLink } = await import("@/app/connexion/actions");

// Ce que le navigateur envoie sans JavaScript : l'email, rien d'autre.
function noJsSubmit(email: string) {
  const form = new FormData();
  form.set("email", email);
  return requestMagicLink({ status: "idle", message: null }, form);
}

beforeEach(() => {
  process.env.IP_HASH_SALT = "sel-de-test";
  req.cookies = new Map();
  req.referer = null;
  req.guardAllowed = true;
  req.redirectTo = null;
  req.claims = [];
});

describe("envoi sans JavaScript", () => {
  it("le formulaire pointe directement vers l'action serveur", () => {
    const source = readFileSync(path.join(process.cwd(), "app/connexion/login-form.tsx"), "utf8");
    expect(source).toMatch(/<form action=\{action\}/);
    expect(source).not.toMatch(/action=\{\(formData\)/);
    // Mission #142 — la mesure tierce entourée d'un try n'existe plus : la
    // bibliothèque est partie, et avec elle le risque qu'elle bloque un
    // envoi. Plus rien ne s'exécute entre le clic et l'action serveur.
    expect(source).not.toContain("track(");
    expect(source).not.toContain("posthog");
  });

  it("la destination est reprise de l'adresse de la page, et gardée dans l'état « lien envoyé »", async () => {
    req.referer = `http://localhost:3000/connexion?next=${encodeURIComponent("/analyse/resultat/abc#message")}`;
    const state = await noJsSubmit("nina@exemple.test");
    expect(state).toMatchObject({ status: "sent", email: "nina@exemple.test", next: "/analyse/resultat/abc#message" });
    expect(req.redirectTo).toContain(`next=${encodeURIComponent("/analyse/resultat/abc#message")}`);
  });

  it("une adresse de page d'un autre site est ignorée : destination par défaut", async () => {
    req.referer = "https://exemple.test/connexion?next=/compte";
    const state = await noJsSubmit("nina@exemple.test");
    expect(state.next).toBe("/historique");
  });

  it("adresse invalide : message d'erreur renvoyé dans l'état, rendu par le serveur", async () => {
    const state = await noJsSubmit("a@b");
    expect(state).toMatchObject({ status: "error", message: "Cet email ne semble pas valide." });
    expect(req.redirectTo).toBeNull();
  });
});

describe("C — les protections tiennent sans JavaScript", () => {
  it("limitation des demandes : au-delà, refus avec le délai, et aucun lien envoyé", async () => {
    req.guardAllowed = false;
    const state = await noJsSubmit("nina@exemple.test");
    expect(state).toMatchObject({ status: "error", message: "Trop de demandes de lien. Réessaie dans 42 min." });
    expect(req.redirectTo).toBeNull();
  });

  it("réclamation #067 : le cookie anonyme est lu côté serveur, et le secret part dans le lien", async () => {
    req.cookies.set("deal_anon_token", "jeton-du-navigateur");
    req.referer = "http://localhost:3000/connexion?next=%2Fhistorique";
    const state = await noJsSubmit("nina@exemple.test");
    expect(state.status).toBe("sent");
    expect(req.claims).toHaveLength(1);
    expect(req.claims[0]).toMatchObject({ email: "nina@exemple.test", anon_token: "jeton-du-navigateur" });
    expect(req.redirectTo).toMatch(/&reclamation=[A-Za-z0-9_-]{32}$/);
  });
});
