import { deleteAccount, isDeletionConfirmed } from "@/lib/account/deletion";
import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { ACCESS_COOKIE, expiredCookieHeader, REFRESH_COOKIE } from "@/lib/auth/session";
import { expiredSessionHintCookieHeader } from "@/lib/auth/session-hint";
import { expiredOwnerHintCookieHeader } from "@/lib/auth/owner-hint";
import { sendEmail } from "@/lib/email/send";
import { accountDeletionEmail } from "@/lib/email/templates";
import { readCookie } from "@/lib/security/request";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";

export const runtime = "nodejs";

function redirect(location: string, clearSession = false) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (clearSession) {
    headers.append("Set-Cookie", expiredCookieHeader(ACCESS_COOKIE));
    headers.append("Set-Cookie", expiredCookieHeader(REFRESH_COOKIE));
    headers.append("Set-Cookie", expiredSessionHintCookieHeader());
    headers.append("Set-Cookie", expiredOwnerHintCookieHeader());
  }
  return new Response(null, { status: 303, headers });
}

// Suppression définitive du compte connecté, après saisie du mot de confirmation.
export async function POST(request: Request) {
  // Mission #089 : authentification injoignable n'est pas « pas de session ».
  // On ne sait rien de la personne : on le dit, sans rien affirmer d'autre.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("compte_supprimer");
    return redirect("/compte/supprimer?erreur=indisponible");
  }
  const user = session.kind === "valid" ? session.user : null;
  if (!user) return redirect(`/connexion?next=${encodeURIComponent("/compte/supprimer")}`);

  const form = await request.formData().catch(() => null);
  if (!isDeletionConfirmed(form?.get("confirmation"))) return redirect("/compte/supprimer?erreur=confirmation");

  try {
    const result = await deleteAccount(user, readCookie(request, ACCESS_COOKIE));
    if (!result.deleted) {
      // Mission #099, point 7 — deux refus, deux messages. « pro_active » est
      // un refus MÉTIER : la page l'explique et propose de résilier.
      // « consents_unprotected » est un refus TECHNIQUE de notre côté (la
      // migration qui protège les preuves de consentement n'est pas appliquée
      // en base) : la personne n'y peut rien, et « réessaie plus tard » serait
      // faux — rien ne changera sans nous.
      if (result.blocker === "consents_unprotected") {
        console.error(
          JSON.stringify({
            event: "suppression_bloquee_migration",
            user_id: user.id,
            detail: "checkout_consents_survive_account_deletion absente : appliquer la migration qui retire la cascade vers auth.users",
          }),
        );
        return redirect("/compte/supprimer?erreur=migration");
      }
      return redirect("/compte/supprimer");
    }

    // Confirmation écrite. Un échec d'email ne remet pas la suppression en cause.
    if (user.email) {
      const siteUrl = configuredSiteUrl() ?? originFromHeaders(request.headers);
      await sendEmail(accountDeletionEmail({ to: user.email, siteUrl }), { kind: "account_deletion" });
    }
    return redirect("/compte/supprime", true);
  } catch (caught) {
    console.error(
      JSON.stringify({ event: "account_deletion_error", reason: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
    );
    return redirect("/compte/supprimer?erreur=indisponible");
  }
}
