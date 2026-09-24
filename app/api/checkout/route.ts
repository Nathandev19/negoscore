import { sanitizeDistinctId } from "@/lib/analytics/distinct-id";
import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/billing/consent";
import { isProActive, type PlanState } from "@/lib/billing/plan-access";
import { insertRow, selectRows } from "@/lib/supabase/server";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { checkoutUrlForConfiguration, createCheckoutUrl, type PlanKey } from "@/lib/whop/api";
import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";

export const runtime = "nodejs";

// Départ vers le paiement Whop. Le compte est rattaché par les metadata de la
// configuration de checkout ; à défaut, le webhook rapproche par l'email de
// l'acheteur. Le consentement est enregistré avant le départ.

// Même achat relancé coup sur coup (double clic, retour arrière puis nouvel
// envoi) : pendant cette fenêtre, la même page de paiement Whop est renvoyée
// au lieu d'en créer une seconde (mission #071).
export const DUPLICATE_CHECKOUT_WINDOW_MS = 2 * 60 * 1000;

function checkoutAttribution(value: FormDataEntryValue | null) {
  try {
    return parseAttribution(JSON.parse(String(value || "{}")));
  } catch {
    return parseAttribution(null);
  }
}

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const plan = String(form?.get("plan") ?? "");
  const consent = form?.get("consent");
  if (plan !== "pack" && plan !== "pro") return redirect("/tarifs?erreur=formule");

  // Mission #089 : authentification injoignable n'est pas « pas de session ».
  // On ne sait rien de la personne : on le dit, sans rien affirmer d'autre.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("checkout");
    return redirect("/tarifs?erreur=indisponible");
  }
  const user = session.kind === "valid" ? session.user : null;
  if (!user) return redirect(`/connexion?next=${encodeURIComponent("/tarifs")}`);
  if (consent !== "on") return redirect(`/tarifs?erreur=consentement&formule=${plan}`);

  // Un abonnement Pro en cours ne se reprend pas : l'interface ne peut pas
  // être la seule protection contre un double paiement.
  if (plan === "pro") {
    const [credits] = await selectRows<PlanState>(
      "credits",
      `select=plan,balance,period_end&user_id=eq.${user.id}&limit=1`,
    );
    if (isProActive(credits ?? null)) {
      console.log(JSON.stringify({ event: "checkout_refused", plan, reason: "abonnement_deja_actif" }));
      return redirect("/tarifs?erreur=deja_pro");
    }
  }

  // Même formule demandée par le même compte il y a moins de 2 minutes : on
  // renvoie vers la page de paiement déjà ouverte. Deux envois ne font jamais
  // deux pages de paiement. Le consentement de ce paiement est déjà enregistré.
  const since = new Date(Date.now() - DUPLICATE_CHECKOUT_WINDOW_MS).toISOString();
  const [recent] = await selectRows<{ checkout_configuration_id: string | null }>(
    "checkout_consents",
    `select=checkout_configuration_id&user_id=eq.${user.id}&plan=eq.${plan}&checkout_configuration_id=not.is.null&accepted_at=gt.${encodeURIComponent(since)}&order=accepted_at.desc&limit=1`,
  ).catch(() => []);
  if (recent?.checkout_configuration_id) {
    console.log(JSON.stringify({ event: "checkout_reused", plan }));
    return redirect(checkoutUrlForConfiguration(recent.checkout_configuration_id));
  }

  // Identifiant de mesure d'audience : transmis s'il est propre, ignoré sinon.
  const analyticsId = sanitizeDistinctId(form?.get("ph_distinct_id"));
  const attribution = checkoutAttribution(form?.get("attribution") ?? null);
  const origin = configuredSiteUrl() ?? originFromHeaders(request.headers);
  const redirectUrl = `${origin}/merci?formule=${plan}`;

  try {
    const checkout = await createCheckoutUrl({
      plan: plan as PlanKey,
      metadata: {
        user_id: user.id, plan, ...(analyticsId ? { ph_distinct_id: analyticsId } : {}),
        ...Object.fromEntries(Object.entries(attribution).filter(([, value]) => value !== null)),
      },
      redirectUrl,
    });
    // Mission #112, A1 — UN PAIEMENT QU'ON NE SAURA PAS ATTRIBUER N'A PAS LIEU.
    //
    // Avant : quand la création de session échouait (clé API absente, Whop en
    // erreur, réseau), la route renvoyait quand même vers une page de paiement
    // STATIQUE, sans l'identifiant du compte. La personne payait, et le webhook
    // n'avait plus que l'adresse de l'acheteur pour deviner qui créditer — une
    // adresse qui, avec Apple Pay, n'est pas celle du compte. Le client payait,
    // son compte restait gratuit, et rien ne le lui disait.
    //
    // Règle déjà posée dans ce projet pour les analyses (aucun droit consommé
    // sans résultat rendu), appliquée ici à l'argent : rien n'est encaissé
    // qu'on ne sache pas rattacher. Aucun consentement n'est enregistré non
    // plus : il n'y a pas de vente à consentir.
    if (!checkout) {
      console.error(JSON.stringify({ event: "checkout_refused", plan, reason: "session_sans_identifiant" }));
      return redirect(`/tarifs?erreur=session&formule=${plan}`);
    }
    await insertRow("checkout_consents", {
      user_id: user.id,
      plan,
      consent_version: CONSENT_VERSION,
      consent_text: CONSENT_TEXT,
      accepted_at: new Date().toISOString(),
      checkout_configuration_id: checkout.checkoutConfigurationId,
    });
    await recordProductEvent({
      event: "checkout_started", userId: user.id, attribution, entityType: "checkout", entityId: checkout.checkoutConfigurationId,
      metadata: { plan, attached: true },
      dedupeKey: `checkout:${checkout.checkoutConfigurationId}`,
    });
    console.log(
      JSON.stringify({ event: "checkout_started", plan, attached: "metadata", analytics_id: analyticsId !== null }),
    );
    return redirect(checkout.url);
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "checkout_error",
        plan,
        detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
      }),
    );
    return redirect("/tarifs?erreur=indisponible");
  }
}
