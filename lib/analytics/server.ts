import { ANALYTICS_EVENTS, type AnalyticsEvent, type AnalyticsProperties } from "@/lib/analytics/events";

// Envoi d'événements depuis le serveur. Sert au revenu : purchase_completed
// ne doit pas dépendre du retour de l'utilisateur sur le site.
// L'identifiant envoyé est l'identifiant de compte, jamais l'email.

const DEFAULT_HOST = "https://eu.i.posthog.com";

export async function captureServerEvent(
  event: AnalyticsEvent,
  distinctId: string,
  properties: AnalyticsProperties = {},
): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_HOST).replace(/\/+$/, "");
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $process_person_profile: false },
        timestamp: new Date().toISOString(),
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "analytics_error", name: event, detail: error instanceof Error ? error.message.slice(0, 120) : "inconnu" }),
    );
  }
}

export { ANALYTICS_EVENTS };
