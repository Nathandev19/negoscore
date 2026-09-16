import {
  isFreshTimestamp,
  SIGNATURE_TOLERANCE_SECONDS,
  signStandardWebhook,
  verifyStandardWebhook,
  type SignatureHeaders,
} from "@/lib/webhooks/standard";

// Signature des webhooks Whop : schéma Standard Webhooks, en-têtes
// webhook-id, webhook-timestamp, webhook-signature.
// Docs : https://docs.whop.com/developer/guides/webhooks

export { isFreshTimestamp, SIGNATURE_TOLERANCE_SECONDS };
export type WebhookHeaders = SignatureHeaders;

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get("webhook-id"),
    timestamp: headers.get("webhook-timestamp"),
    signature: headers.get("webhook-signature"),
  };
}

export function verifyWhopSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  nowMs = Date.now(),
): boolean {
  return verifyStandardWebhook(rawBody, headers, secret, nowMs);
}

// Utilitaire de test : fabrique l'en-tête tel que Whop l'enverrait.
export function signWebhook(rawBody: string, id: string, timestamp: string, secret: string): string {
  return signStandardWebhook(rawBody, id, timestamp, secret);
}
