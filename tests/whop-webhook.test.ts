import { describe, expect, it } from "vitest";
import { isFreshTimestamp, readWebhookHeaders, signWebhook, verifyWhopSignature } from "@/lib/whop/webhook";

// Secret de test, sans valeur : il ne sert qu'à signer des charges fabriquées.
const SECRET = "ws_test_secret_0123456789";
const BODY = JSON.stringify({ id: "msg_1", type: "payment.succeeded", data: { id: "pay_1" } });
const ID = "msg_1";

function headersFor(body: string, secret = SECRET, timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    id: ID,
    timestamp,
    signature: signWebhook(body, ID, timestamp, secret),
  };
}

describe("signature des webhooks Whop", () => {
  it("accepte une signature valide", () => {
    expect(verifyWhopSignature(BODY, headersFor(BODY), SECRET)).toBe(true);
  });

  it("refuse un corps modifié après signature", () => {
    const headers = headersFor(BODY);
    expect(verifyWhopSignature(BODY.replace("pay_1", "pay_2"), headers, SECRET)).toBe(false);
  });

  it("refuse une signature faite avec un autre secret", () => {
    expect(verifyWhopSignature(BODY, headersFor(BODY, "ws_autre_secret"), SECRET)).toBe(false);
  });

  it("refuse une requête sans en-tête de signature", () => {
    const headers = readWebhookHeaders(new Headers({ "webhook-id": ID }));
    expect(verifyWhopSignature(BODY, headers, SECRET)).toBe(false);
    expect(verifyWhopSignature(BODY, { id: null, timestamp: null, signature: null }, SECRET)).toBe(false);
  });

  it("refuse un horodatage trop ancien ou trop lointain", () => {
    const old = String(Math.floor(Date.now() / 1000) - 10 * 60);
    expect(verifyWhopSignature(BODY, headersFor(BODY, SECRET, old), SECRET)).toBe(false);
    const future = String(Math.floor(Date.now() / 1000) + 10 * 60);
    expect(verifyWhopSignature(BODY, headersFor(BODY, SECRET, future), SECRET)).toBe(false);
    expect(isFreshTimestamp(String(Math.floor(Date.now() / 1000)))).toBe(true);
    expect(isFreshTimestamp("pas-un-nombre")).toBe(false);
  });

  it("accepte plusieurs signatures dans l'en-tête, dont une valide", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const valid = signWebhook(BODY, ID, timestamp, SECRET);
    const header = { id: ID, timestamp, signature: `v1,autreSignatureBase64== ${valid}` };
    expect(verifyWhopSignature(BODY, header, SECRET)).toBe(true);
  });

  it("lit les en-têtes Standard Webhooks", () => {
    const headers = readWebhookHeaders(
      new Headers({ "webhook-id": "msg_9", "webhook-timestamp": "123", "webhook-signature": "v1,abc" }),
    );
    expect(headers).toEqual({ id: "msg_9", timestamp: "123", signature: "v1,abc" });
  });
});
