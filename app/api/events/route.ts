import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";

export const runtime = "nodejs";

const PUBLIC_EVENTS = ["landing_view", "pricing_view"] as const;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  let trustedOrigin = false;
  try {
    trustedOrigin = Boolean(origin) && new URL(origin as string).origin === new URL(request.url).origin;
  } catch {
    trustedOrigin = false;
  }
  if (!trustedOrigin || (site && site !== "same-origin")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { event?: unknown; attribution?: unknown } | null;
  if (!body || !(PUBLIC_EVENTS as readonly unknown[]).includes(body.event)) {
    return Response.json({ error: "invalid event" }, { status: 400 });
  }
  await recordProductEvent({ event: body.event as (typeof PUBLIC_EVENTS)[number], attribution: parseAttribution(body.attribution) });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
