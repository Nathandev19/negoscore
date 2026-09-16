// Envoi d'emails par l'API Resend. Aucun SDK : un POST suffit.
// Un échec est journalisé et réessayé une fois, jamais propagé à l'appelant.

const ENDPOINT = "https://api.resend.com/emails";
const RETRIES = 1;

export type Email = { to: string; subject: string; text: string };
export type SendOutcome = { sent: boolean; reason?: string; attempts: number };

export function senderAddress(): string {
  return process.env.EMAIL_FROM?.trim() || "contact@negoscore.fr";
}

async function post(email: Email, apiKey: string): Promise<{ ok: boolean; detail: string }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: senderAddress(), to: [email.to], subject: email.subject, text: email.text }),
    cache: "no-store",
  });
  if (response.ok) return { ok: true, detail: "" };
  const detail = await response.text().catch(() => "");
  return { ok: false, detail: `HTTP ${response.status} ${detail.slice(0, 200)}` };
}

export async function sendEmail(email: Email, context: Record<string, unknown> = {}): Promise<SendOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({ event: "email_error", reason: "missing_api_key", ...context }));
    return { sent: false, reason: "missing_api_key", attempts: 0 };
  }

  let lastReason = "";
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    try {
      const result = await post(email, apiKey);
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
