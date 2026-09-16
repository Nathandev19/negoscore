import type { Attachment, Email } from "@/lib/email/send";

// Réexpédition des emails reçus sur l'adresse de contact. Resend n'envoie que
// des métadonnées dans le webhook : le contenu est relu par l'API.
// Docs : https://resend.com/docs/dashboard/receiving/forward-emails
//        https://resend.com/docs/api-reference/emails/retrieve-received-email
//        https://resend.com/docs/api-reference/emails/list-received-email-attachments

const API_BASE = "https://api.resend.com";
// Au-delà, la pièce jointe n'est pas réexpédiée : elle est signalée dans le corps.
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

export type ReceivedEmail = {
  id: string;
  from?: string | null;
  to?: string[] | string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  reply_to?: string[] | string | null;
  created_at?: string | null;
};

export type ReceivedAttachment = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  size?: number | null;
  download_url?: string | null;
};

export class InboundConfigError extends Error {}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new InboundConfigError("RESEND_API_KEY absente");
  return key;
}

async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    cache: "no-store",
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "inbound_api_error", path, status: response.status }));
    return null;
  }
  return (await response.json()) as T;
}

export function getReceivedEmail(id: string): Promise<ReceivedEmail | null> {
  return get<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(id)}`);
}

export async function listAttachments(id: string): Promise<ReceivedAttachment[]> {
  const body = await get<{ data?: ReceivedAttachment[] } | ReceivedAttachment[]>(
    `/emails/receiving/${encodeURIComponent(id)}/attachments`,
  );
  if (!body) return [];
  return Array.isArray(body) ? body : (body.data ?? []);
}

function first(value: string[] | string | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// Les pièces jointes sont téléchargées puis réexpédiées en base64. Celles qui
// sont trop lourdes ou qui échouent au téléchargement sont listées dans le corps.
async function collectAttachments(
  items: ReceivedAttachment[],
): Promise<{ attachments: Attachment[]; skipped: string[] }> {
  const attachments: Attachment[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const item of items) {
    const name = item.filename ?? item.id;
    if (!item.download_url) {
      skipped.push(`${name} (lien de téléchargement absent)`);
      continue;
    }
    if ((item.size ?? 0) > MAX_ATTACHMENT_BYTES || total + (item.size ?? 0) > MAX_ATTACHMENTS_BYTES) {
      skipped.push(`${name} (trop volumineuse pour la réexpédition)`);
      continue;
    }
    try {
      const response = await fetch(item.download_url, { cache: "no-store" });
      if (!response.ok) {
        skipped.push(`${name} (téléchargement impossible)`);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES || total + bytes.byteLength > MAX_ATTACHMENTS_BYTES) {
        skipped.push(`${name} (trop volumineuse pour la réexpédition)`);
        continue;
      }
      total += bytes.byteLength;
      attachments.push({
        filename: name,
        content: bytes.toString("base64"),
        ...(item.content_type ? { content_type: item.content_type } : {}),
      });
    } catch {
      skipped.push(`${name} (téléchargement impossible)`);
    }
  }
  return { attachments, skipped };
}

function header(email: ReceivedEmail): string {
  const sender = first(email.from) ?? "expéditeur inconnu";
  const date = email.created_at ?? "date inconnue";
  return `Message reçu sur l'adresse de contact.\nDe : ${sender}\nDate : ${date}`;
}

// Construit l'email de réexpédition : objet préfixé, expéditeur d'origine en
// Reply-To, corps précédé de l'origine et de la date.
export async function buildForward(
  email: ReceivedEmail,
  to: string,
  subjectPrefix: string,
): Promise<Email> {
  const attachmentItems = await listAttachments(email.id).catch(() => [] as ReceivedAttachment[]);
  const { attachments, skipped } = await collectAttachments(attachmentItems);

  const intro = header(email);
  const notice =
    skipped.length > 0
      ? `\n\nPièces jointes non réexpédiées : ${skipped.join(", ")}. Retrouve-les dans le tableau de bord Resend.`
      : "";
  const body = email.text?.trim() ?? "";
  const text = `${intro}${notice}\n\n---\n\n${body || "(message sans texte brut, voir la version HTML)"}`;
  const html = email.html
    ? `<p>${intro.replace(/\n/g, "<br>")}</p>${notice ? `<p>${notice.trim()}</p>` : ""}<hr>${email.html}`
    : undefined;

  const replyTo = first(email.reply_to) ?? first(email.from) ?? undefined;
  const original = email.subject?.trim();
  return {
    to,
    subject: `${subjectPrefix} ${original && original.length > 0 ? original : "(sans objet)"}`.trim(),
    text,
    ...(html ? { html } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

// Mémoire courte des emails déjà réexpédiés : Resend peut livrer un même
// webhook plusieurs fois. Rien n'est écrit en base, aucun contenu n'est gardé.
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
const SEEN_MAX = 500;
const seen = new Map<string, number>();

export function alreadyForwarded(id: string, nowMs = Date.now()): boolean {
  for (const [key, at] of seen) {
    if (nowMs - at > SEEN_TTL_MS) seen.delete(key);
  }
  return seen.has(id);
}

export function markForwarded(id: string, nowMs = Date.now()): void {
  seen.set(id, nowMs);
  while (seen.size > SEEN_MAX) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

export function resetForwardedMemory(): void {
  seen.clear();
}
