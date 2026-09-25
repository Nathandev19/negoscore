import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Identité technique d'une requête : IP hachée et jeton anonyme.

export const ANON_COOKIE = "deal_anon_token";
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

// Le sel serveur du produit : IP_HASH_SALT si défini, sinon la clé
// service_role, qui est elle aussi un secret serveur. Un seul endroit le lit,
// et tests/security.test.ts fige cette liste.
//
// Mission #118 — il signe aussi le cookie de trafic interne
// (lib/telemetry/internal.ts) : cette fonction existe pour que ce module-là
// n'ait pas à lire la clé service_role lui-même.
export function serverSalt(): string | null {
  return process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

// HMAC-SHA256 de l'IP avec le sel serveur. L'IP en clair n'est ni stockée ni
// journalisée.
export function hashIp(ip: string, salt: string | null | undefined = serverSalt()): string {
  if (!salt) throw new Error("Sel serveur absent pour hacher l'IP");
  return createHmac("sha256", salt).update(ip).digest("hex");
}

export function newAnonToken(): string {
  return randomBytes(32).toString("base64url");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function anonCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ANON_COOKIE}=${token}; Path=/; Max-Age=${ANON_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

export function sameToken(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
