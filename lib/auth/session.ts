import { createHash, randomBytes } from "node:crypto";
import { sessionStateFrom } from "@/lib/auth/session-state";

// Session Supabase Auth côté serveur, par l'API REST. Magic link uniquement,
// en PKCE : le vérificateur reste dans un cookie httpOnly, le code du lien
// est échangé par le serveur. Les jetons vivent dans des cookies httpOnly.

export const ACCESS_COOKIE = "sb_access_token";
export const REFRESH_COOKIE = "sb_refresh_token";
export const VERIFIER_COOKIE = "sb_pkce_verifier";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const VERIFIER_MAX_AGE = 60 * 15;

export type SessionUser = { id: string; email: string | null };
export type Session = { accessToken: string; refreshToken: string; expiresIn: number; user: SessionUser };

export class AuthConfigError extends Error {}

function authConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new AuthConfigError("Configuration Supabase Auth absente");
  return { url: url.replace(/\/+$/, ""), anonKey };
}

async function authFetch(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { url, anonKey } = authConfig();
  return fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${init.token ?? anonKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
}

function toSession(body: unknown): Session | null {
  const b = body as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { id?: string; email?: string };
  };
  if (!b?.access_token || !b.refresh_token || !b.user?.id) return null;
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresIn: b.expires_in ?? 3600,
    user: { id: b.user.id, email: b.user.email ?? null },
  };
}

export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// Envoie le magic link. Le compte est créé à la première demande.
export async function sendMagicLink(email: string, challenge: string, redirectTo: string): Promise<boolean> {
  const response = await authFetch(`/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    body: JSON.stringify({ email, create_user: true, code_challenge: challenge, code_challenge_method: "s256" }),
  });
  return response.ok;
}

export async function exchangeCode(code: string, verifier: string): Promise<Session | null> {
  const response = await authFetch("/token?grant_type=pkce", {
    method: "POST",
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  return response.ok ? toSession(await response.json()) : null;
}

export type VerifyOutcome = { session: Session; error: null } | { session: null; error: { status: number; code: string } };

// Lien au format token_hash (modèle d'email personnalisé), équivalent REST de
// supabase.auth.verifyOtp({ token_hash, type }). Aucun vérificateur PKCE
// requis : le lien fonctionne depuis n'importe quel navigateur. La cause d'un
// échec est renvoyée pour être journalisée (lien expiré, déjà servi…).
export async function verifyOtpTokenHash(tokenHash: string, type: string): Promise<VerifyOutcome> {
  const response = await authFetch("/verify", {
    method: "POST",
    body: JSON.stringify({ token_hash: tokenHash, type }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // corps vide ou non JSON
  }
  const session = response.ok ? toSession(body) : null;
  if (session) return { session, error: null };
  const b = (body ?? {}) as { error_code?: unknown; error?: unknown; code?: unknown };
  const code = [b.error_code, b.error, b.code].find((value) => typeof value === "string") as string | undefined;
  return { session: null, error: { status: response.status, code: code ?? (response.ok ? "session_absente" : "inconnu") } };
}

export async function verifyTokenHash(tokenHash: string, type: string): Promise<Session | null> {
  return (await verifyOtpTokenHash(tokenHash, type)).session;
}

// Trois issues, jamais deux (mission #070). « Refusée » : Supabase a répondu
// que cette session n'existe plus ou ne vaut rien (compte supprimé, session
// révoquée, jeton de rafraîchissement expiré ou déjà utilisé) — on peut, et on
// doit, effacer les cookies. « Indisponible » : Supabase n'a pas pu répondre
// (réseau, 5xx, 429) — on ne sait RIEN de la session, on n'y touche pas.
//
// Mission #089 bis — le partage lui-même vit dans lib/auth/session-state.ts,
// module pur sans dépendance : un seul endroit décide, et il se teste seul.
// Ce fichier ne fait plus que traduire un appel réseau en « AuthCall ».

export type RefreshOutcome =
  | { kind: "refreshed"; session: Session }
  | { kind: "rejected"; status: number }
  | { kind: "unavailable"; status: number | null };

export async function refreshSessionOutcome(refreshToken: string): Promise<RefreshOutcome> {
  let response: Response;
  try {
    response = await authFetch("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return { kind: "unavailable", status: null };
  }
  const session = response.ok ? toSession(await response.json().catch(() => null)) : null;
  // Réponse 200 illisible : « indisponible », pas « invalide » (session-state).
  const state = sessionStateFrom({ kind: "reponse", status: response.status, user: session !== null });
  if (state === "valide" && session) return { kind: "refreshed", session };
  return state === "indisponible" ? { kind: "unavailable", status: response.status } : { kind: "rejected", status: response.status };
}

export async function refreshSession(refreshToken: string): Promise<Session | null> {
  const outcome = await refreshSessionOutcome(refreshToken).catch(() => null);
  return outcome?.kind === "refreshed" ? outcome.session : null;
}

export type AccessCheck =
  | { kind: "valid"; user: SessionUser }
  | { kind: "rejected"; status: number }
  | { kind: "unavailable"; status: number | null };

// Vérifie le jeton auprès de Supabase : aucune confiance dans le contenu du cookie.
export async function checkAccessToken(accessToken: string): Promise<AccessCheck> {
  let response: Response;
  try {
    response = await authFetch("/user", { token: accessToken });
  } catch {
    return { kind: "unavailable", status: null };
  }
  const body = response.ok ? ((await response.json().catch(() => null)) as { id?: string; email?: string } | null) : null;
  const state = sessionStateFrom({ kind: "reponse", status: response.status, user: Boolean(body?.id) });
  if (state === "valide" && body?.id) return { kind: "valid", user: { id: body.id, email: body.email ?? null } };
  return state === "indisponible" ? { kind: "unavailable", status: response.status } : { kind: "rejected", status: response.status };
}

// Mission #089 — la session d'une requête, dans le vocabulaire de la mission
// #070 (checkAccessToken, refreshSessionOutcome), plus le cas sans cookie :
//   - « valid » : session vérifiée par Supabase ;
//   - « absent » : aucun jeton d'accès ;
//   - « rejected » : Supabase a répondu que ce jeton ne vaut rien ;
//   - « unavailable » : Supabase n'a pas pu répondre. On ne sait RIEN de la
//     session : ce n'est pas une absence de session, et aucune route ne doit
//     la traiter comme telle (ni visiteuse anonyme, ni « connecte-toi »).
// « absent » et « rejected » se comportent comme avant : pas de session.
export type SessionCheck = AccessCheck | { kind: "absent" };

export async function sessionFromAccessToken(accessToken: string | null | undefined): Promise<SessionCheck> {
  if (!accessToken) return { kind: "absent" };
  try {
    return await checkAccessToken(accessToken);
  } catch {
    return { kind: "unavailable", status: null };
  }
}

// Utilisateur connecté, ou null. null couvre aussi une PANNE de Supabase : à
// n'employer que là où une panne ne peut rien produire de faux (sinon :
// sessionFromAccessToken).
export async function userFromAccessToken(accessToken: string | null | undefined): Promise<SessionUser | null> {
  const check = await sessionFromAccessToken(accessToken);
  return check.kind === "valid" ? check.user : null;
}

// Levée par une page serveur quand l'authentification est injoignable : la
// page d'erreur (app/error.tsx) dit alors « réessaie dans un instant », au lieu
// d'un « connecte-toi » ou d'un « introuvable » faux.
export class AuthUnavailableError extends Error {
  constructor() {
    super("Authentification Supabase injoignable");
    this.name = "AuthUnavailableError";
  }
}

export async function signOut(accessToken: string): Promise<void> {
  await authFetch("/logout", { method: "POST", token: accessToken }).catch(() => undefined);
}

// Expiration lue dans le jeton, sans vérifier la signature : sert seulement à
// décider d'un rafraîchissement, jamais à autoriser.
export function accessTokenExpiresSoon(accessToken: string, marginSeconds = 60): boolean {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as { exp?: number };
    return !payload.exp || payload.exp * 1000 - Date.now() < marginSeconds * 1000;
  } catch {
    return true;
  }
}

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookieHeaders(session: Session): string[] {
  return [
    `${ACCESS_COOKIE}=${session.accessToken}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag()}`,
    `${REFRESH_COOKIE}=${session.refreshToken}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag()}`,
  ];
}

export function verifierCookieHeader(verifier: string): string {
  return `${VERIFIER_COOKIE}=${verifier}; Path=/auth; Max-Age=${VERIFIER_MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag()}`;
}

export function expiredCookieHeader(name: string, path = "/"): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag()}`;
}

// Chemin de retour interne : voir lib/auth/next-path.ts (sans dépendance serveur).
export { safeNextPath } from "@/lib/auth/next-path";
