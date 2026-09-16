import { createHmac, timingSafeEqual } from "node:crypto";

// Vérification de signature des webhooks Whop (schéma Standard Webhooks).
// Docs : https://docs.whop.com/developer/guides/webhooks
// En-têtes : webhook-id, webhook-timestamp, webhook-signature.
// Contenu signé : `{webhook-id}.{webhook-timestamp}.{corps brut}`,
// HMAC-SHA256 encodé en base64, en-tête au format « v1,<signature> »
// (plusieurs signatures possibles, séparées par des espaces).

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get("webhook-id"),
    timestamp: headers.get("webhook-timestamp"),
    signature: headers.get("webhook-signature"),
  };
}

// Whop distribue un secret préfixé « ws_ ». La documentation demande de le
// passer tel quel ; selon l'implémentation, la clé est soit ces octets, soit
// la partie après le préfixe décodée en base64. Les deux sont acceptées, sans
// jamais accepter autre chose que ce secret.
function candidateKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, "utf8")];
  const withoutPrefix = secret.replace(/^(ws_|whsec_)/, "");
  if (withoutPrefix !== secret) {
    keys.push(Buffer.from(withoutPrefix, "utf8"));
    const decoded = Buffer.from(withoutPrefix, "base64");
    if (decoded.length > 0) keys.push(decoded);
  }
  return keys;
}

function signaturesFromHeader(header: string): string[] {
  return header
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part));
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isFreshTimestamp(timestamp: string, nowMs = Date.now()): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  return Math.abs(nowMs / 1000 - seconds) <= SIGNATURE_TOLERANCE_SECONDS;
}

export function verifyWhopSignature(rawBody: string, headers: WebhookHeaders, secret: string, nowMs = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  if (!isFreshTimestamp(timestamp, nowMs)) return false;

  const signed = `${id}.${timestamp}.${rawBody}`;
  const received = signaturesFromHeader(signature);
  if (received.length === 0) return false;

  for (const key of candidateKeys(secret)) {
    const expected = createHmac("sha256", key).update(signed).digest("base64");
    if (received.some((candidate) => equals(candidate, expected))) return true;
  }
  return false;
}

// Utilitaire de test : fabrique l'en-tête tel que Whop l'enverrait.
export function signWebhook(rawBody: string, id: string, timestamp: string, secret: string): string {
  const signature = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return `v1,${signature}`;
}
