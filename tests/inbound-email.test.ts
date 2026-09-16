import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetForwardedMemory } from "@/lib/email/inbound";
import { signStandardWebhook } from "@/lib/webhooks/standard";

// Réexpédition des emails entrants. Aucun appel réseau réel : l'API Resend
// est remplacée par un faux fetch, et les charges sont fabriquées ici.
const { POST: inbound } = await import("@/app/api/email/inbound/route");

const SECRET = "whsec_c2VjcmV0LWRlLXRlc3Qtbm9uLXJlZWw=";
const DESTINATION = "boite@exemple.test";
const EMAIL_ID = "email_123";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function receivedEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: EMAIL_ID,
    from: "marque@exemple.test",
    to: ["contact@exemple.test"],
    subject: "Proposition de collaboration",
    text: "Bonjour, on aimerait travailler avec toi.",
    html: "<p>Bonjour, on aimerait travailler avec toi.</p>",
    created_at: "2026-09-16T09:30:00.000Z",
    ...overrides,
  };
}

function fakeFetch(email: Record<string, unknown> | null, attachments: unknown[] = []) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.includes("/attachments")) return Response.json({ data: attachments });
    if (url.includes("/emails/receiving/")) {
      return email ? Response.json(email) : new Response("not found", { status: 404 });
    }
    if (url.endsWith("/emails")) return Response.json({ id: "sent_1" });
    if (url.includes("download")) return new Response(Buffer.from("pièce jointe"));
    return new Response("inattendu", { status: 500 });
  });
}

function request(body: unknown, { secret = SECRET, signed = true, id = "msg_inbound_1" } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signed) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = signStandardWebhook(raw, id, timestamp, secret);
  }
  return inbound(new Request("http://localhost:3000/api/email/inbound", { method: "POST", headers, body: raw }));
}

const event = { type: "email.received", data: { email_id: EMAIL_ID } };

function sentEmail(): Record<string, unknown> {
  const call = calls.find((c) => c.url.endsWith("/emails") && c.init?.method === "POST");
  return call ? (JSON.parse(String(call.init?.body)) as Record<string, unknown>) : {};
}

beforeEach(() => {
  calls = [];
  resetForwardedMemory();
  vi.stubEnv("RESEND_API_KEY", "re_cle_de_test");
  vi.stubEnv("RESEND_INBOUND_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("FORWARD_INBOUND_TO", DESTINATION);
  vi.stubEnv("EMAIL_FROM", "contact@exemple.test");
  vi.stubGlobal("fetch", fakeFetch(receivedEmail()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("webhook des emails entrants", () => {
  it("refuse une requête non signée, sans rien réexpédier", async () => {
    const response = await request(event, { signed: false });
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuse une signature faite avec un autre secret", async () => {
    const response = await request(event, { secret: "whsec_YXV0cmUtc2VjcmV0" });
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuse un corps modifié après signature", async () => {
    const raw = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await inbound(
      new Request("http://localhost:3000/api/email/inbound", {
        method: "POST",
        headers: {
          "svix-id": "msg_inbound_1",
          "svix-timestamp": timestamp,
          "svix-signature": signStandardWebhook(raw, "msg_inbound_1", timestamp, SECRET),
        },
        body: raw.replace(EMAIL_ID, "email_999"),
      }),
    );
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("réexpédie vers la boîte configurée, avec l'expéditeur d'origine en Reply-To", async () => {
    const response = await request(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, forwarded: true });

    const sent = sentEmail();
    expect(sent.to).toEqual([DESTINATION]);
    expect(sent.from).toBe("contact@exemple.test");
    expect(sent.reply_to).toBe("marque@exemple.test");
    expect(sent.subject).toBe("[Negoscore] Proposition de collaboration");
    expect(String(sent.text)).toContain("De : marque@exemple.test");
    expect(String(sent.text)).toContain("Date : 2026-09-16T09:30:00.000Z");
    expect(String(sent.text)).toContain("Bonjour, on aimerait travailler avec toi.");
  });

  it("rejoué, le même email ne repart pas une seconde fois", async () => {
    await request(event);
    const sends = () => calls.filter((c) => c.url.endsWith("/emails") && c.init?.method === "POST").length;
    expect(sends()).toBe(1);

    const replay = await request(event, { id: "msg_inbound_2" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(sends()).toBe(1);
  });

  it("préfère l'adresse Reply-To d'origine quand elle existe", async () => {
    vi.stubGlobal("fetch", fakeFetch(receivedEmail({ reply_to: ["reponses@exemple.test"] })));
    await request(event);
    expect(sentEmail().reply_to).toBe("reponses@exemple.test");
  });

  it("transmet les pièces jointes, et signale celles qu'il ne peut pas joindre", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(receivedEmail(), [
        { id: "att_1", filename: "brief.pdf", content_type: "application/pdf", size: 12, download_url: "https://exemple.test/download/att_1" },
        { id: "att_2", filename: "video.mov", content_type: "video/quicktime", size: 50 * 1024 * 1024, download_url: "https://exemple.test/download/att_2" },
      ]),
    );
    await request(event);
    const sent = sentEmail();
    const attachments = sent.attachments as Array<{ filename: string; content: string; content_type: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ filename: "brief.pdf", content_type: "application/pdf" });
    expect(Buffer.from(attachments[0].content, "base64").toString()).toBe("pièce jointe");
    expect(String(sent.text)).toContain("Pièces jointes non réexpédiées : video.mov");
  });

  it("ignore un événement d'un autre type", async () => {
    const response = await request({ type: "email.delivered", data: { email_id: EMAIL_ID } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: "email.delivered" });
    expect(calls).toEqual([]);
  });

  it("demande un rejeu si le contenu n'est pas encore lisible", async () => {
    vi.stubGlobal("fetch", fakeFetch(null));
    const response = await request(event);
    expect(response.status).toBe(500);
    expect(calls.some((c) => c.url.endsWith("/emails") && c.init?.method === "POST")).toBe(false);
  });

  it("ne réexpédie rien si la boîte de destination n'est pas configurée", async () => {
    vi.stubEnv("FORWARD_INBOUND_TO", "");
    const response = await request(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ forwarded: false });
    expect(calls).toEqual([]);
  });
});
