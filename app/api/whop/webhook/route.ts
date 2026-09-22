import { randomUUID } from "node:crypto";
import { ANALYTICS_EVENTS, captureServerEvent } from "@/lib/analytics/server";
import { applyWhopEvent, type WhopEvent } from "@/lib/billing/whop-events";
import { sendEmail } from "@/lib/email/send";
import { purchaseConfirmationEmail } from "@/lib/email/templates";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { insertRow, selectRows, SupabaseRequestError, updateRows } from "@/lib/supabase/server";
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
      // Événement déjà enregistré. Il n'est un doublon que s'il a été TRAITÉ :
      // sans processed_at, c'est une tentative interrompue, et la reprise de
      // Whop doit pouvoir la terminer (mission #060).
      const [row] = await selectRows<{ processed_at: string | null }>(
        "whop_events",
        `select=processed_at&event_id=eq.${encodeURIComponent(parsed.id)}&limit=1`,
      );
      if (row?.processed_at) {
        console.log(JSON.stringify({ event: "whop_webhook_duplicate", type: parsed.type }));
        return ok({ received: true, duplicate: true });
      }
      console.warn(JSON.stringify({ event: "whop_webhook_reprise", type: parsed.type }));
    } else {
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
  }

  try {
    const outcome = await applyWhopEvent(parsed);
    // Mission #092, B — paiement encaissé qu'on n'a pas su rattacher à un
    // compte : l'événement N'EST PAS marqué traité, pour que le rattrapage
    // quotidien réessaie pendant 30 jours. On répond quand même 200 : Whop
    // n'a rien à rejouer, c'est notre base qui manque d'un compte.
    if (!outcome.pending) {
      await updateRows("whop_events", `event_id=eq.${encodeURIComponent(parsed.id)}`, {
        processed_at: new Date().toISOString(),
      });
    }
    console.log(
      JSON.stringify({ event: "whop_webhook", type: parsed.type, handled: outcome.handled, reason: outcome.reason }),
    );

    if (outcome.handled && outcome.userId && outcome.plan && parsed.type === "payment.succeeded") {
      // Revenu mesuré côté serveur, jamais depuis le navigateur. L'identifiant
      // anonyme du navigateur rattache l'achat au parcours mesuré. À défaut, un
      // identifiant aléatoire à usage unique : jamais l'identifiant de compte ni
      // l'email, la mesure d'audience reste anonyme. L'achat n'est alors pas
      // rattaché au parcours ; attribution « account » signale ce cas.
      await captureServerEvent(ANALYTICS_EVENTS.purchaseCompleted, outcome.analyticsId ?? randomUUID(), {
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
    // Traitement échoué : on répond 500 pour que Whop REJOUE (mission #060).
    // Un paiement encaissé doit toujours finir par créditer ; répondre 200
    // condamnait l'événement, puisque la ligne reste sans processed_at et que
    // rien ne serait revenu la chercher. Le crédit ne peut pas être accordé
    // deux fois : il passe par whop_event_credit, qui marque et crédite dans
    // la même transaction. Politique de reprise Whop : 12 reprises après le
    // premier envoi (30 s, 2 min, 8 min, 30 min, 1 h, 3 h, 6 h, puis toutes
    // les 12 h), sur environ 71 heures, pour tout ce qui n'est pas un 2xx en
    // moins de 5 secondes. Le rattrapage quotidien
    // (lib/billing/webhook-recovery.ts) prend le relais au-delà.
    return ok({ received: true, handled: false, retry: true }, 500);
  }
}
