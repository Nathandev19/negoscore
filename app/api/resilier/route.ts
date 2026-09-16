import { getRequestUser } from "@/lib/auth/request-user";
import { findMembershipId } from "@/lib/billing/subscription";
import { sendEmail } from "@/lib/email/send";
import { cancellationConfirmationEmail } from "@/lib/email/templates";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { selectRows } from "@/lib/supabase/server";
import { cancelMembershipAtPeriodEnd } from "@/lib/whop/api";

export const runtime = "nodejs";

// Résiliation en ligne de l'abonnement Pro : un clic, sans justification,
// sans paiement. L'annulation prend effet à la fin de la période en cours.

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return redirect(`/connexion?next=${encodeURIComponent("/resilier")}`);

  try {
    const [credits] = await selectRows<{ plan: string; period_end: string | null }>(
      "credits",
      `select=plan,period_end&user_id=eq.${user.id}&limit=1`,
    );
    if (credits?.plan !== "pro") return redirect("/resilier?etat=aucun");

    const membershipId = await findMembershipId(user);
    if (!membershipId) {
      console.error(JSON.stringify({ event: "cancel_error", reason: "membership_introuvable" }));
      return redirect("/resilier?erreur=introuvable");
    }

    const membership = await cancelMembershipAtPeriodEnd(membershipId);
    if (!membership) return redirect("/resilier?erreur=whop");

    const endsAt = membership.renewal_period_end ?? credits.period_end;
    console.log(
      JSON.stringify({
        event: "subscription_cancelled",
        ends_at: endsAt,
        status: membership.status,
        // Doit valoir true : sinon Whop a résilié immédiatement et l'accès
        // payé est perdu, contrairement à ce qu'annoncent la page et l'email.
        cancel_at_period_end: membership.cancel_at_period_end,
      }),
    );

    // Confirmation écrite. Un échec d'email ne remet pas la résiliation en cause.
    if (user.email) {
      const siteUrl = configuredSiteUrl() ?? originFromHeaders(request.headers);
      await sendEmail(
        cancellationConfirmationEmail({ to: user.email, endsAt: endsAt ? new Date(endsAt) : null, siteUrl }),
        { kind: "cancellation_confirmation" },
      );
    }
    return redirect("/resilier?etat=resilie");
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "cancel_error",
        reason: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
      }),
    );
    return redirect("/resilier?erreur=indisponible");
  }
}
