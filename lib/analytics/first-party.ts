import { insertIfAbsent, isMissingColumn } from "@/lib/supabase/server";
import { normalizeReferrer } from "@/lib/analytics/referrer";
import { withEnvironment } from "@/lib/telemetry/tagged";

export const PRODUCT_EVENTS = [
  "landing_view", "pricing_view", "analysis_started", "analysis_completed", "feedback_submitted", "signup",
  "negotiation_started", "negotiation_turn", "negotiation_concluded", "checkout_started", "purchase_completed",
  // Mission #120 — les pages d'arrivée depuis un moteur de recherche. UN SEUL
  // nom pour les trois guides : `path` est déjà enregistré et les distingue,
  // trois noms d'événement ne diraient rien de plus et rendraient chaque
  // nouveau guide dépendant d'un changement de code.
  "guide_view", "example_view",
  // Mission #130 — le niveau choisi sur une page de résultat. Le payload
  // de l'analyse, lui, ne bouge pas : il porte la fourchette, le score et
  // la contre-offre calculés AU niveau qu'il déclare, et y réécrire le
  // niveau sans recalculer le reste rendrait la ligne fausse.
  "tier_changed",
  // Mission #157 — arrivée sur l'analyse, distincte des visites historiques.
  "analysis_page_view",
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
    referrer_host: typeof input.referrer_host === "string" ? normalizeReferrer(input.referrer_host, "") : null,
    utm_source: clean(input.utm_source, 100), utm_medium: clean(input.utm_medium, 100),
    utm_campaign: clean(input.utm_campaign, 150), utm_content: clean(input.utm_content, 150),
  };
}

export async function recordProductEvent(input: {
  event: ProductEventName; userId?: string | null; attribution?: Attribution; entityType?: string | null;
  entityId?: string | null; metadata?: Record<string, string | number | boolean | null>; dedupeKey?: string | null;
}): Promise<void> {
  const a = input.attribution ?? {};
  const referrerDomain = a.referrer_host == null ? null : normalizeReferrer(a.referrer_host, "");
  try {
    await withEnvironment((environment) =>
      insertEvent({
        ...environment,
        event_name: input.event, user_id: input.userId ?? null, path: a.path ?? null, referrer_host: referrerDomain,
        ...(referrerDomain ? { referrer_domain: referrerDomain } : {}),
        utm_source: a.utm_source ?? null, utm_medium: a.utm_medium ?? null, utm_campaign: a.utm_campaign ?? null,
        utm_content: a.utm_content ?? null, entity_type: input.entityType ?? null, entity_id: input.entityId ?? null,
        metadata: input.metadata ?? {}, dedupe_key: input.dedupeKey ?? null,
      }),
      // Mission #131 — et le diagnostic (empreinte, raison, famille d'agent),
      // qui n'existe que sur cette table.
      // Mission #118 — le compte qui produit l'événement, pour les écritures
      // sans navigateur : le webhook Whop écrit purchase_completed depuis une
      // requête de Whop, qui ne porte pas le cookie interne.
      { userId: input.userId ?? null, diagnostic: true },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "product_telemetry_error", name: input.event, detail: error instanceof Error ? error.message.slice(0, 120) : "inconnu" }));
  }
}

async function insertEvent(row: Record<string, unknown>): Promise<void> {
  try {
    await insertIfAbsent("product_events", row);
  } catch (error) {
    // Le code peut être déployé avant que Nathan applique la migration à la
    // main. Les événements continuent alors d'être écrits, sans ce champ.
    if (!isMissingColumn(error)) throw error;
    const previousSchema = { ...row };
    delete previousSchema.referrer_domain;
    await insertIfAbsent("product_events", previousSchema);
  }
}
