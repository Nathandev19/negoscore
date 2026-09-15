import { createHash, randomBytes } from "node:crypto";

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

// Lien au format token_hash (modèle d'email personnalisé).
export async function verifyTokenHash(tokenHash: string, type: string): Promise<Session | null> {
  const response = await authFetch("/verify", {
    method: "POST",
    body: JSON.stringify({ token_hash: tokenHash, type }),
  });
  return response.ok ? toSession(await response.json()) : null;
}

export async function refreshSession(refreshToken: string): Promise<Session | null> {
  const response = await authFetch("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return response.ok ? toSession(await response.json()) : null;
}

// Vérifie le jeton auprès de Supabase : aucune confiance dans le contenu du cookie.
export async function userFromAccessToken(accessToken: string | null | undefined): Promise<SessionUser | null> {
  if (!accessToken) return null;
  try {
    const response = await authFetch("/user", { token: accessToken });
    if (!response.ok) return null;
    const body = (await response.json()) as { id?: string; email?: string };
    return body.id ? { id: body.id, email: body.email ?? null } : null;
  } catch {
    return null;
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

// Chemin de retour interne uniquement : pas de redirection ouverte.
export function safeNextPath(value: string | null | undefined, fallback = "/historique"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
