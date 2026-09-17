import { deleteAccount, isDeletionConfirmed } from "@/lib/account/deletion";
import { getRequestUser } from "@/lib/auth/request-user";
import { ACCESS_COOKIE, expiredCookieHeader, REFRESH_COOKIE } from "@/lib/auth/session";
import { expiredSessionHintCookieHeader } from "@/lib/auth/session-hint";
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
  }
  return new Response(null, { status: 303, headers });
}

// Suppression définitive du compte connecté, après saisie du mot de confirmation.
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return redirect(`/connexion?next=${encodeURIComponent("/compte/supprimer")}`);

  const form = await request.formData().catch(() => null);
  if (!isDeletionConfirmed(form?.get("confirmation"))) return redirect("/compte/supprimer?erreur=confirmation");

  try {
    const result = await deleteAccount(user, readCookie(request, ACCESS_COOKIE));
    if (!result.deleted) {
      return result.blocker === "pro_active"
        ? redirect("/resilier?motif=suppression")
        : redirect("/compte/supprimer?erreur=indisponible");
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
