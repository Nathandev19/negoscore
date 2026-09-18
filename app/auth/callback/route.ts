import {
  exchangeCode,
  expiredCookieHeader,
  safeNextPath,
  VERIFIER_COOKIE,
  verifyTokenHash,
  type Session,
} from "@/lib/auth/session";
import { claimFromLink } from "@/lib/auth/login-claims";
import { completeSignIn, redirectResponse } from "@/lib/auth/sign-in";
import { readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

// Retour du magic link au format PKCE ({{ .ConfirmationURL }}) : ne fonctionne
// que dans le navigateur qui a demandé le lien, où le vérificateur est en
// cookie. Conservée pendant la bascule vers /auth/confirm, qui fonctionne
// depuis n'importe quel navigateur : les liens déjà envoyés restent valables
// une heure. Crée le profil à la première connexion et rattache l'analyse anonyme.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const clearVerifier = expiredCookieHeader(VERIFIER_COOKIE, "/auth");
  // Message d'erreur écrit dans la page, lisible sans JavaScript (mission #074).
  const failed = redirectResponse(`/connexion/lien-expire?next=${encodeURIComponent(next)}`, [clearVerifier]);

  let session: Session | null = null;
  try {
    if (code) {
      const verifier = readCookie(request, VERIFIER_COOKIE);
      if (!verifier) return failed;
      session = await exchangeCode(code, verifier);
    } else if (tokenHash && (type === "magiclink" || type === "email")) {
      session = await verifyTokenHash(tokenHash, type);
    }
    if (!session) return failed;
    return await completeSignIn(request, session, next, { extraCookies: [clearVerifier], source: "callback", claim: claimFromLink(url) });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "auth_callback_error",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return failed;
  }
}
