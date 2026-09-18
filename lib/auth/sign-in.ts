import { attachAnonDeals, ensureAccount } from "@/lib/auth/account";
import { redeemLoginClaim } from "@/lib/auth/login-claims";
import { mergeFreeUsage } from "@/lib/billing/free-usage";
import { expiredCookieHeader, sessionCookieHeaders, type Session } from "@/lib/auth/session";
export { signedInRedirectPath } from "@/lib/auth/next-path";
import { flashCookieHeader } from "@/lib/auth/flash";
import { sessionHintCookieHeader } from "@/lib/auth/session-hint";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

// Fin de connexion commune aux deux formats de lien magique.

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
    if (url.pathname.startsWith("/auth/")) {
      const inner = url.searchParams.get("next");
      // Adresse insérée non encodée par le gabarit : l'ancre du chemin interne
      // (#message, mission #067) arrive comme ancre de l'adresse de retour.
      return inner && url.hash && !inner.includes("#") ? `${inner}${url.hash}` : inner;
    }
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

// Profil créé si besoin, analyses anonymes rattachées, cookies de session et
// indicateur d'affichage posés, cookie anonyme effacé.
//
// Deux sources de jeton anonyme à rattacher (mission #067) :
//   - le cookie de CE navigateur, s'il est là (lien ouvert là où il a été demandé) ;
//   - la réclamation enregistrée à la demande du lien (lib/auth/login-claims.ts),
//     utilisable seulement avec le secret du lien ET une session pour la même
//     adresse — c'est elle qui fait marcher un lien ouvert dans un autre navigateur.
export async function completeSignIn(
  request: Request,
  session: Session,
  next: string,
  options: { extraCookies?: string[]; source: "callback" | "confirm"; claim?: string | null },
): Promise<Response> {
  await ensureAccount(session.user);
  const anonToken = readCookie(request, ANON_COOKIE);
  const claimedToken = await redeemLoginClaim(options.claim ?? null, session.user.email);
  const tokens = [...new Set([anonToken, claimedToken].filter((token): token is string => Boolean(token)))];

  let attached = 0;
  let refused = false;
  for (const token of tokens) {
    const attach = await attachAnonDeals(session.user.id, token);
    attached += attach.attached;
    refused ||= attach.refused;
    // La gratuité consommée sous ce jeton suit le compte, même si l'analyse a
    // été supprimée depuis : se connecter ne rend pas une analyse gratuite.
    // Un échec ici ne doit jamais empêcher la connexion : il est journalisé.
    if (!attach.refused) {
      await mergeFreeUsage(token, session.user.id).catch((error: unknown) =>
        console.error(
          JSON.stringify({ event: "free_usage_merge_error", detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu" }),
        ),
      );
    }
  }
  console.log(
    JSON.stringify({
      event: "auth_callback",
      source: options.source,
      attached_deals: attached,
      attach_refused: refused,
      // Secret présent dans le lien, et réclamation effectivement utilisée.
      claim_presented: Boolean(options.claim),
      claim_redeemed: claimedToken !== null,
    }),
  );

  const cookies = [
    ...sessionCookieHeaders(session),
    sessionHintCookieHeader(),
    // Bandeau « Connexion réussie » sur la page d'arrivée (components/flash-banner.tsx).
    flashCookieHeader("connexion", process.env.NODE_ENV === "production"),
    ...(options.extraCookies ?? []),
  ];
  if (anonToken) cookies.push(expiredCookieHeader(ANON_COOKIE));
  // ?connexion=ok sert à la mesure d'audience, le paramètre est retiré côté client.
  // Il se place avant l'ancre éventuelle (#message, mission #067) : après, il
  // ferait partie de l'ancre.
  const hashAt = next.indexOf("#");
  const path = hashAt === -1 ? next : next.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : next.slice(hashAt);
  const target = `${path}${path.includes("?") ? "&" : "?"}connexion=ok${hash}`;
  return redirectResponse(target, cookies);
}
