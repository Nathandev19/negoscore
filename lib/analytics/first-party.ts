import { insertIfAbsent } from "@/lib/supabase/server";

export const PRODUCT_EVENTS = [
  "landing_view", "pricing_view", "analysis_started", "analysis_completed", "feedback_submitted", "signup",
  "negotiation_started", "negotiation_turn", "negotiation_concluded", "checkout_started", "purchase_completed",
] as const;
export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

export type Attribution = {
  path?: string | null; referrer_host?: string | null; utm_source?: string | null; utm_medium?: string | null;
  utm_campaign?: string | null; utm_content?: string | null;
};

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._~-]+/g, "_").slice(0, max);
  return normalized || null;
}

export function parseAttribution(value: unknown): Attribution {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    path: typeof input.path === "string" && input.path.startsWith("/") ? input.path.slice(0, 300) : null,
    referrer_host: clean(input.referrer_host, 255),
    utm_source: clean(input.utm_source, 100), utm_medium: clean(input.utm_medium, 100),
    utm_campaign: clean(input.utm_campaign, 150), utm_content: clean(input.utm_content, 150),
  };
}

export async function recordProductEvent(input: {
  event: ProductEventName; userId?: string | null; attribution?: Attribution; entityType?: string | null;
  entityId?: string | null; metadata?: Record<string, string | number | boolean | null>; dedupeKey?: string | null;
}): Promise<void> {
  const a = input.attribution ?? {};
  try {
    await insertIfAbsent("product_events", {
      event_name: input.event, user_id: input.userId ?? null, path: a.path ?? null, referrer_host: a.referrer_host ?? null,
      utm_source: a.utm_source ?? null, utm_medium: a.utm_medium ?? null, utm_campaign: a.utm_campaign ?? null,
      utm_content: a.utm_content ?? null, entity_type: input.entityType ?? null, entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {}, dedupe_key: input.dedupeKey ?? null,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "product_telemetry_error", name: input.event, detail: error instanceof Error ? error.message.slice(0, 120) : "inconnu" }));
  }
}
