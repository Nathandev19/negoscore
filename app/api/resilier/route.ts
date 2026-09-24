import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { furthestPeriodEnd, isProActive, type PlanState } from "@/lib/billing/plan-access";
import { findMembershipId } from "@/lib/billing/subscription";
import { sendEmail } from "@/lib/email/send";
import { cancellationConfirmationEmail } from "@/lib/email/templates";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { selectRows, updateRows } from "@/lib/supabase/server";
import { cancelMembershipAtPeriodEnd } from "@/lib/whop/api";

export const runtime = "nodejs";

// Résiliation en ligne de l'abonnement Pro : un clic, sans justification,
// sans paiement. L'annulation prend effet à la fin de la période en cours.

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // Mission #089 : authentification injoignable n'est pas « pas de session ».
  // On ne sait rien de la personne : on le dit, sans rien affirmer d'autre.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("resilier");
    return redirect("/resilier?erreur=indisponible");
  }
  const user = session.kind === "valid" ? session.user : null;
  if (!user) return redirect(`/connexion?next=${encodeURIComponent("/resilier")}`);

  try {
    const [credits] = await selectRows<PlanState>(
      "credits",
      `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
    );
    // Nos données font foi : un Pro dont la période est passée n'a plus rien à résilier.
    if (!isProActive(credits ?? null)) return redirect("/resilier?etat=aucun");
    // Déjà résilié : inutile de rappeler le prestataire de paiement.
    if (credits.cancelled_at) return redirect("/resilier?etat=deja");

    const membershipId = await findMembershipId(user);
    if (!membershipId) {
      console.error(JSON.stringify({ event: "cancel_error", reason: "membership_introuvable" }));
      return redirect("/resilier?erreur=introuvable");
    }

    const membership = await cancelMembershipAtPeriodEnd(membershipId);
    if (!membership) return redirect("/resilier?erreur=whop");

    // Mission #113, E — la plus lointaine des deux, comme le webhook. Whop ne
    // connaît que la fin de l'abonnement résilié ; une période empilée par un
    // second abonnement ou par un paiement rattrapé va plus loin, et elle est
    // payée. La prendre telle quelle retirait au compte ce qu'il avait réglé.
    const endsAt = furthestPeriodEnd(membership.renewal_period_end, credits.period_end);
    // La demande est datée chez nous : l'accès reste ouvert jusqu'à period_end,
    // quelle que soit la façon dont le prestataire coupe l'abonnement.
    await updateRows("credits", `user_id=eq.${user.id}&cancelled_at=is.null`, {
      cancelled_at: new Date().toISOString(),
      ...(endsAt ? { period_end: endsAt } : {}),
      updated_at: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        event: "subscription_cancelled",
        ends_at: endsAt,
        status: membership.status,
        // Whop coupe parfois tout de suite : sans effet ici, c'est period_end
        // qui porte l'accès de l'utilisateur.
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
