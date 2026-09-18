import { verifyOtpTokenHash } from "@/lib/auth/session";
import { claimFromLink } from "@/lib/auth/login-claims";
import { completeSignIn, nextFromEmailLink, redirectResponse, signedInRedirectPath } from "@/lib/auth/sign-in";
import { SIGN_IN_OTP_TYPES, type SignInOtpType } from "@/lib/auth/otp-types";
import { configuredSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

// Retour du lien magique au format token_hash, modèle d'email :
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
// La vérification ne dépend d'aucun cookie posé au moment de la demande : le
// lien fonctionne depuis n'importe quel navigateur (TikTok → Gmail → Safari).
//
// Vérification directe sur GET, sans bouton : décision produit. Un scanner de
// messagerie qui pré-charge le lien consommerait le jeton à usage unique ;
// chaque échec est journalisé avec sa cause (auth_confirm_failed) pour le détecter.

function isSignInOtpType(value: string | null): value is SignInOtpType {
  return value !== null && (SIGN_IN_OTP_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = signedInRedirectPath(nextFromEmailLink(url.searchParams.get("next"), configuredSiteUrl() ?? url.origin));
  // Message d'erreur écrit dans la page, lisible sans JavaScript (mission #074).
  const failed = redirectResponse(`/connexion/lien-expire?next=${encodeURIComponent(next)}`);

  if (!tokenHash || !isSignInOtpType(type)) {
    // « type » refusé : c'est une valeur brute venue de l'adresse, donc
    // arbitraire. On journalise sa longueur, pas son contenu (mission #062, E2).
    console.warn(
      JSON.stringify({
        event: "auth_confirm_failed",
        reason: tokenHash ? "type_refuse" : "token_hash_absent",
        type_length: type?.length ?? 0,
      }),
    );
    return failed;
  }

  try {
    const outcome = await verifyOtpTokenHash(tokenHash, type);
    if (!outcome.session) {
      // Supabase répond otp_expired aussi bien pour un lien expiré que pour un
      // lien déjà servi, par exemple pré-chargé par un scanner.
      console.warn(
        JSON.stringify({ event: "auth_confirm_failed", reason: outcome.error.code, status: outcome.error.status, type }),
      );
      return failed;
    }
    // Secret de réclamation du lien (mission #067) : rattache l'analyse faite
    // sans compte même si ce navigateur n'est pas celui de la demande.
    return await completeSignIn(request, outcome.session, next, { source: "confirm", claim: claimFromLink(url) });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "auth_confirm_error",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return failed;
  }
}
