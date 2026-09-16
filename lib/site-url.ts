import { headers } from "next/headers";

// URL publique du site, pour construire les liens de retour (magic link,
// paiement). NEXT_PUBLIC_SITE_URL fait foi ; à défaut, on reprend l'origine
// de la requête en cours.

export function configuredSiteUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

export function originFromHeaders(requestHeaders: Headers): string {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function siteUrl(): Promise<string> {
  return configuredSiteUrl() ?? originFromHeaders(await headers());
}
