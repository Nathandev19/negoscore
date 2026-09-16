// Envoi d'emails par l'API Resend. Aucun SDK : un POST suffit.
// Un échec est journalisé et réessayé une fois, jamais propagé à l'appelant.
// Docs : https://resend.com/docs/api-reference/emails/send-email

const ENDPOINT = "https://api.resend.com/emails";
const RETRIES = 1;

export type Attachment = { filename: string; content: string; content_type?: string };
export type Email = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Attachment[];
};
export type SendOutcome = { sent: boolean; reason?: string; attempts: number };

// L'adresse d'expédition vient de l'environnement : aucune adresse en dur.
export function senderAddress(): string | null {
  return process.env.EMAIL_FROM?.trim() || null;
}

async function post(email: Email, apiKey: string, from: string): Promise<{ ok: boolean; detail: string }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      ...(email.attachments && email.attachments.length > 0 ? { attachments: email.attachments } : {}),
    }),
    cache: "no-store",
  });
  if (response.ok) return { ok: true, detail: "" };
  const detail = await response.text().catch(() => "");
  return { ok: false, detail: `HTTP ${response.status} ${detail.slice(0, 200)}` };
}

export async function sendEmail(email: Email, context: Record<string, unknown> = {}): Promise<SendOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = senderAddress();
  if (!apiKey || !from) {
    const reason = !apiKey ? "missing_api_key" : "missing_from_address";
    console.error(JSON.stringify({ event: "email_error", reason, ...context }));
    return { sent: false, reason, attempts: 0 };
  }

  let lastReason = "";
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    try {
      const result = await post(email, apiKey, from);
      if (result.ok) {
        // L'adresse du destinataire n'est pas journalisée.
        console.log(JSON.stringify({ event: "email_sent", subject: email.subject, attempts: attempt, ...context }));
        return { sent: true, attempts: attempt };
      }
      lastReason = result.detail;
    } catch (caught) {
      lastReason = caught instanceof Error ? caught.message.slice(0, 200) : "inconnu";
    }
  }
  console.error(JSON.stringify({ event: "email_error", reason: lastReason, attempts: RETRIES + 1, ...context }));
  return { sent: false, reason: lastReason, attempts: RETRIES + 1 };
}
