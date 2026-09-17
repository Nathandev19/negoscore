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

// Le corps d'erreur de Resend n'est PAS lu (mission #062, E1) : un 4xx de
// validation recopie souvent la valeur du champ fautif — une adresse de
// réponse, un nom de pièce jointe, l'objet d'un message reçu. Seul le code
// HTTP sort d'ici ; le corps complet reste consultable dans Resend.
async function post(email: Email, apiKey: string, from: string): Promise<{ ok: boolean; status: number }> {
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
  return { ok: response.ok, status: response.status };
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
        // Ni l'adresse du destinataire ni l'objet ne sont journalisés
        // (mission #062, E1) : sur la réexpédition d'un email reçu, l'objet
        // est celui d'un tiers. Le « kind » passé par l'appelant dit de quel
        // message il s'agit, et il suffit à suivre un envoi.
        console.log(JSON.stringify({ event: "email_sent", attempts: attempt, ...context }));
        return { sent: true, attempts: attempt };
      }
      lastReason = `HTTP ${result.status}`;
    } catch (caught) {
      lastReason = caught instanceof Error ? caught.message.slice(0, 200) : "inconnu";
    }
  }
  console.error(JSON.stringify({ event: "email_error", reason: lastReason, attempts: RETRIES + 1, ...context }));
  return { sent: false, reason: lastReason, attempts: RETRIES + 1 };
}
