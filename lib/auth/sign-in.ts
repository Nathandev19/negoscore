import { attachAnonDeals, ensureAccount } from "@/lib/auth/account";
import { redeemLoginClaim } from "@/lib/auth/login-claims";
import { mergeFreeUsage } from "@/lib/billing/free-usage";
import { expiredCookieHeader, sessionCookieHeaders, type Session } from "@/lib/auth/session";
export { signedInRedirectPath } from "@/lib/auth/next-path";
import { flashCookieHeader } from "@/lib/auth/flash";
import { sessionHintCookieHeader } from "@/lib/auth/session-hint";
import { ownerHintCookieHeaderFor } from "@/lib/auth/owner-hint";
import { isOwnerEmail } from "@/lib/admin/owner";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";
import { internalCookieHeader, isInternalEmail } from "@/lib/telemetry/internal";
import { recordProductEvent } from "@/lib/analytics/first-party";

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
  const account = (await ensureAccount(session.user)) ?? { created: false };
  if (account.created) {
    await recordProductEvent({ event: "signup", userId: session.user.id, entityType: "user", entityId: session.user.id, dedupeKey: `signup:${session.user.id}` });
  }
  const anonToken = readCookie(request, ANON_COOKIE);
  const claimedToken = await redeemLoginClaim(options.claim ?? null, session.user.email);
  const tokens = [...new Set([anonToken, claimedToken].filter((token): token is string => Boolean(token)))];

  // RISQUE ACCEPTÉ (mission #068), à connaître avant de toucher à ce qui suit.
  // Une réclamation se crée avec le jeton du navigateur qui DEMANDE le lien,
  // pour l'adresse qu'il SAISIT — pas forcément la sienne. Quelqu'un peut donc
  // demander un lien avec son propre jeton et ton adresse. Si tu cliques cet
  // email que tu n'as pas demandé, sa réclamation est utilisée ici, et :
  //   1. ses analyses anonymes sont rattachées à TON compte (attachAnonDeals) ;
  //   2. l'analyse gratuite qu'il a consommée sous ce jeton est reportée sur
  //      TON compte (mergeFreeUsage) : ta propre analyse gratuite peut être
  //      perdue, sans que tu aies rien lancé.
  // Il ne peut rien te prendre d'autre : ni lire tes analyses, ni se connecter
  // à ton compte. La parade — n'utiliser la réclamation que si le cookie du
  // même jeton est présent — supprimerait le lien qui marche dans un autre
  // navigateur, donc l'atterrissage direct sur le message. Choix fait en
  // connaissance de cause ; le test « risque accepté » de
  // tests/login-claims.test.ts le fige, pour qu'un changement soit un choix.
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
    // Lien vers /dev/retours dans l'en-tête, pour le seul propriétaire
    // (mission #080). N'autorise rien : le proxy et la page revérifient.
    ownerHintCookieHeaderFor(isOwnerEmail(session.user.email)),
    // Bandeau « Connexion réussie » sur la page d'arrivée (components/flash-banner.tsx).
    flashCookieHeader("connexion", process.env.NODE_ENV === "production"),
    ...(options.extraCookies ?? []),
  ];
  // Mission #118 — se connecter avec une adresse interne marque ce navigateur,
  // définitivement et même après déconnexion : c'est ce qui règle les cas 1 et
  // 2 sans aucune manipulation, et le cas 3 par ricochet. Jamais retiré ici :
  // une autre adresse qui se connecte ensuite sur MON téléphone ne rend pas ce
  // téléphone à nouveau comptable. Seul /api/interne?retirer=1 le démarque.
  const internal = isInternalEmail(session.user.email) ? internalCookieHeader() : null;
  if (internal) cookies.push(internal);
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
