import { ANALYTICS_EVENTS, captureServerEvent } from "@/lib/analytics/server";
import { applyWhopEvent, type WhopEvent } from "@/lib/billing/whop-events";
import { sendEmail } from "@/lib/email/send";
import { purchaseConfirmationEmail } from "@/lib/email/templates";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { insertRow, SupabaseRequestError, updateRows } from "@/lib/supabase/server";
import { readWebhookHeaders, verifyWhopSignature } from "@/lib/whop/webhook";

export const runtime = "nodejs";

// Webhook Whop. La signature est vérifiée sur le corps brut avant toute
// interprétation, et chaque event_id n'est traité qu'une fois.

function ok(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  const headers = readWebhookHeaders(request.headers);
  const rawBody = await request.text();

  if (!secret || !verifyWhopSignature(rawBody, headers, secret)) {
    console.error(JSON.stringify({ event: "whop_webhook_rejected", reason: "signature", has_id: Boolean(headers.id) }));
    return ok({ error: "signature invalide" }, 401);
  }

  let parsed: WhopEvent;
  try {
    const body = JSON.parse(rawBody) as { id?: string; type?: string; data?: unknown };
    if (!body.id || !body.type) throw new Error("enveloppe incomplète");
    parsed = { id: body.id, type: body.type, data: (body.data ?? {}) as Record<string, unknown> };
  } catch {
    console.error(JSON.stringify({ event: "whop_webhook_rejected", reason: "corps illisible" }));
    return ok({ error: "corps illisible" }, 400);
  }

  // Idempotence : l'insertion de l'event_id fait office de verrou.
  try {
    await insertRow("whop_events", { event_id: parsed.id, type: parsed.type, payload: JSON.parse(rawBody) });
  } catch (caught) {
    if (caught instanceof SupabaseRequestError && (caught.status === 409 || caught.code === "23505")) {
      console.log(JSON.stringify({ event: "whop_webhook_duplicate", type: parsed.type }));
      return ok({ received: true, duplicate: true });
    }
    console.error(
      JSON.stringify({
        event: "whop_webhook_error",
        reason: "enregistrement",
        detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
      }),
    );
    // Erreur de stockage : on demande un rejeu.
    return ok({ error: "enregistrement impossible" }, 500);
  }

  try {
    const outcome = await applyWhopEvent(parsed);
    await updateRows("whop_events", `event_id=eq.${encodeURIComponent(parsed.id)}`, {
      processed_at: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({ event: "whop_webhook", type: parsed.type, handled: outcome.handled, reason: outcome.reason }),
    );

    if (outcome.handled && outcome.userId && outcome.plan && parsed.type === "payment.succeeded") {
      // Revenu mesuré côté serveur, jamais depuis le navigateur. L'identifiant
      // anonyme du navigateur prime : sans lui, l'achat ne rejoindrait pas le
      // parcours mesuré. À défaut, l'identifiant de compte sert de repli.
      await captureServerEvent(ANALYTICS_EVENTS.purchaseCompleted, outcome.analyticsId ?? outcome.userId, {
        plan: outcome.plan,
        amount: outcome.amount ?? null,
        currency: outcome.currency ?? null,
        attribution: outcome.analyticsId ? "browser" : "account",
      });

      // Confirmation d'achat sur support durable : troisième condition de
      // l'article L221-28 13°. Un échec est journalisé, jamais bloquant :
      // le compte est déjà crédité à ce stade.
      if (outcome.userEmail) {
        const siteUrl = configuredSiteUrl() ?? originFromHeaders(request.headers);
        await sendEmail(
          purchaseConfirmationEmail({
            to: outcome.userEmail,
            plan: outcome.plan,
            amount: outcome.amount ?? null,
            currency: outcome.currency ?? null,
            date: new Date(),
            siteUrl,
          }),
          { kind: "purchase_confirmation", event_id: parsed.id },
        );
      } else {
        console.error(JSON.stringify({ event: "email_error", reason: "no_account_email", event_id: parsed.id }));
      }
    }
    return ok({ received: true, handled: outcome.handled });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "whop_webhook_error",
        reason: "traitement",
        type: parsed.type,
        detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
      }),
    );
    // L'événement est déjà enregistré : on répond 200 pour ne pas faire
    // rejouer un traitement partiel. La ligne reste sans processed_at.
    return ok({ received: true, handled: false });
  }
}
