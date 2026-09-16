import { getRequestUser } from "@/lib/auth/request-user";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/billing/consent";
import { insertRow } from "@/lib/supabase/server";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { createCheckoutUrl, fallbackCheckoutUrl, type PlanKey } from "@/lib/whop/api";

export const runtime = "nodejs";

// Départ vers le paiement Whop. Le compte est rattaché par les metadata de la
// configuration de checkout ; à défaut, le webhook rapproche par l'email de
// l'acheteur. Le consentement est enregistré avant le départ.

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const plan = String(form?.get("plan") ?? "");
  const consent = form?.get("consent");
  if (plan !== "pack" && plan !== "pro") return redirect("/offres?erreur=offre");

  const user = await getRequestUser(request);
  if (!user) return redirect(`/connexion?next=${encodeURIComponent("/offres")}`);
  if (consent !== "on") return redirect(`/offres?erreur=consentement&offre=${plan}`);

  const origin = configuredSiteUrl() ?? originFromHeaders(request.headers);
  const redirectUrl = `${origin}/merci?offre=${plan}`;

  try {
    const checkout = await createCheckoutUrl({
      plan: plan as PlanKey,
      metadata: { user_id: user.id, plan },
      redirectUrl,
    });
    await insertRow("checkout_consents", {
      user_id: user.id,
      plan,
      consent_version: CONSENT_VERSION,
      consent_text: CONSENT_TEXT,
      accepted_at: new Date().toISOString(),
      checkout_configuration_id: checkout?.checkoutConfigurationId ?? null,
    });
    console.log(
      JSON.stringify({ event: "checkout_started", plan, attached: checkout !== null ? "metadata" : "email_fallback" }),
    );
    // Repli : lien de paiement simple, le webhook rapprochera par l'email.
    return redirect(checkout?.url ?? fallbackCheckoutUrl(plan as PlanKey));
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "checkout_error",
        plan,
        detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
      }),
    );
    return redirect("/offres?erreur=indisponible");
  }
}
