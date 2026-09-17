import { attachAnonDeals, ensureAccount } from "@/lib/auth/account";
import { mergeFreeUsage } from "@/lib/billing/free-usage";
import { expiredCookieHeader, safeNextPath, sessionCookieHeaders, type Session } from "@/lib/auth/session";
import { sessionHintCookieHeader } from "@/lib/auth/session-hint";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

// Fin de connexion commune aux deux formats de lien magique.

// Destination après connexion : chemin interne uniquement, jamais de retour
// vers une page de connexion (boucle). Règle partagée avec la garde de /connexion.
export function signedInRedirectPath(requested: string | null | undefined, fallback = "/compte"): string {
  const target = safeNextPath(requested, fallback);
  return target.startsWith("/connexion") || target.startsWith("/auth/") ? fallback : target;
}

// Le modèle d'email transmet {{ .RedirectTo }} : l'URL complète envoyée à
// Supabase (https://site/auth/callback?next=/historique), éventuellement
// encodée. On n'en garde que le chemin interne demandé ; une URL d'un autre
// site est ignorée.
export function nextFromEmailLink(value: string | null, siteOrigin: string): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    if (url.origin !== new URL(siteOrigin).origin) return null;
    if (url.pathname.startsWith("/auth/")) return url.searchParams.get("next");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

// Profil créé si besoin, analyse anonyme rattachée, cookies de session et
// indicateur d'affichage posés, cookie anonyme effacé.
export async function completeSignIn(
  request: Request,
  session: Session,
  next: string,
  options: { extraCookies?: string[]; source: "callback" | "confirm" },
): Promise<Response> {
  await ensureAccount(session.user);
  const anonToken = readCookie(request, ANON_COOKIE);
  const attach = await attachAnonDeals(session.user.id, anonToken);
  // La gratuité consommée par ce navigateur suit le compte, même si l'analyse
  // a été supprimée depuis : se connecter ne rend pas une analyse gratuite.
  // Un échec ici ne doit jamais empêcher la connexion : il est journalisé.
  if (anonToken && !attach.refused) {
    await mergeFreeUsage(anonToken, session.user.id).catch((error: unknown) =>
      console.error(
        JSON.stringify({ event: "free_usage_merge_error", detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu" }),
      ),
    );
  }
  console.log(
    JSON.stringify({
      event: "auth_callback",
      source: options.source,
      attached_deals: attach.attached,
      attach_refused: attach.refused,
    }),
  );

  const cookies = [...sessionCookieHeaders(session), sessionHintCookieHeader(), ...(options.extraCookies ?? [])];
  if (anonToken) cookies.push(expiredCookieHeader(ANON_COOKIE));
  // ?connexion=ok sert à la mesure d'audience, le paramètre est retiré côté client.
  const target = `${next}${next.includes("?") ? "&" : "?"}connexion=ok`;
  return redirectResponse(target, cookies);
}
