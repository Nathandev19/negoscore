import { BRAND } from "@/lib/brand";
import {
  alreadyForwarded,
  buildForward,
  getReceivedEmail,
  markForwarded,
  type ReceivedEmail,
} from "@/lib/email/inbound";
import { sendEmail } from "@/lib/email/send";
import { verifyStandardWebhook } from "@/lib/webhooks/standard";

export const runtime = "nodejs";

// Réexpédition des emails reçus sur l'adresse de contact vers la boîte
// personnelle. Rien n'est enregistré en base : cette route ne fait que
// relire l'email chez Resend et le renvoyer.
// Docs : https://resend.com/docs/dashboard/receiving/forward-emails

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  // En-têtes Svix, lus avant le corps : la signature porte sur le corps brut.
  const headers = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
  const rawBody = await request.text();

  if (!secret || !verifyStandardWebhook(rawBody, headers, secret)) {
    console.error(JSON.stringify({ event: "inbound_rejected", reason: "signature", has_id: Boolean(headers.id) }));
    return json({ error: "signature invalide" }, 401);
  }

  let type: string;
  let emailId: string | null;
  try {
    const body = JSON.parse(rawBody) as { type?: string; data?: { email_id?: string; id?: string } };
    type = body.type ?? "";
    emailId = body.data?.email_id ?? body.data?.id ?? null;
  } catch {
    console.error(JSON.stringify({ event: "inbound_rejected", reason: "corps illisible" }));
    return json({ error: "corps illisible" }, 400);
  }

  if (type !== "email.received") return json({ received: true, ignored: type });
  if (!emailId) {
    console.error(JSON.stringify({ event: "inbound_error", reason: "identifiant absent" }));
    return json({ received: true, forwarded: false });
  }

  const destination = process.env.FORWARD_INBOUND_TO?.trim();
  if (!destination) {
    console.error(JSON.stringify({ event: "inbound_error", reason: "FORWARD_INBOUND_TO absente" }));
    return json({ received: true, forwarded: false });
  }

  // Livraison au moins une fois : un email déjà réexpédié ne repart pas.
  if (alreadyForwarded(emailId)) {
    console.log(JSON.stringify({ event: "inbound_duplicate", email_id: emailId }));
    return json({ received: true, duplicate: true });
  }

  try {
    const email: ReceivedEmail | null = await getReceivedEmail(emailId);
    if (!email) {
      console.error(JSON.stringify({ event: "inbound_error", reason: "email introuvable", email_id: emailId }));
      // Rejeu souhaité : le contenu n'est peut-être pas encore disponible.
      return json({ error: "email introuvable" }, 500);
    }

    const forward = await buildForward({ ...email, id: emailId }, destination, `[${BRAND.shortName}]`);
    const outcome = await sendEmail(forward, { kind: "inbound_forward", email_id: emailId });
    if (!outcome.sent) return json({ error: "réexpédition impossible" }, 500);

    markForwarded(emailId);
    console.log(
      JSON.stringify({
        event: "inbound_forwarded",
        email_id: emailId,
        attachments: forward.attachments?.length ?? 0,
        has_reply_to: Boolean(forward.replyTo),
      }),
    );
    return json({ received: true, forwarded: true });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "inbound_error",
        email_id: emailId,
        detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
      }),
    );
    // Erreur technique : on demande un rejeu plutôt que de perdre le message.
    return json({ error: "réexpédition impossible" }, 500);
  }
}
