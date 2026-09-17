"use client";

import posthog from "posthog-js";
import type { AnalyticsEvent, AnalyticsProperties } from "@/lib/analytics/events";

// Mesure d'audience côté navigateur. Sans clé, l'application fonctionne
// normalement et rien n'est envoyé. Aucune donnée de deal, aucun email :
// seules les propriétés listées dans lib/analytics/events.ts sont émises.

let ready = false;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const signals = [navigator.doNotTrack, (window as { doNotTrack?: string }).doNotTrack];
  return signals.some((value) => value === "1" || value === "yes");
}

export function initAnalytics(): void {
  if (ready || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || doNotTrack()) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    // Mission #049 : aucun stockage sur l'appareil. Sans cookie, sans
    // localStorage et sans identifiant persistant, l'article 82 de la loi
    // informatique et libertés ne s'applique pas et aucun consentement n'est
    // demandé. PostHog reconstitue une session côté serveur, sans rien écrire
    // ici. L'option existe dans posthog-js 1.433.3 mais n'est pas encore
    // déclarée dans ses types, d'où le cast.
    ...({ cookieless_mode: "always" } as { cookieless_mode: "always" }),
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    respect_dnt: true,
    person_profiles: "never",
    // Les URL contiennent l'identifiant d'une analyse : il est masqué avant envoi.
    sanitize_properties: (properties) => {
      const cleaned: Record<string, unknown> = { ...properties };
      for (const key of ["$current_url", "$pathname", "$referrer", "$initial_current_url", "$initial_pathname"]) {
        const value = cleaned[key];
        if (typeof value === "string") cleaned[key] = value.replace(UUID, ":id");
      }
      return cleaned;
    },
  });
  ready = true;
}

export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  if (!ready) return;
  posthog.capture(event, properties);
}

// Sans stockage, PostHog n'a plus d'identifiant de navigateur : il renvoie ce
// jeton, le même pour tout le monde. Le transmettre au paiement rattacherait
// tous les achats à une seule personne fictive.
const COOKIELESS_SENTINEL = "$posthog_cookieless";

// Identifiant anonyme du navigateur, à transmettre au paiement pour relier
// l'achat au parcours. null quand la mesure est désactivée (DNT, pas de clé)
// et, depuis la mission #049, en mode sans stockage : il n'y a plus rien à
// relier côté navigateur.
export function analyticsDistinctId(): string | null {
  if (!ready) return null;
  try {
    const id = posthog.get_distinct_id();
    return !id || id === COOKIELESS_SENTINEL ? null : id;
  } catch {
    return null;
  }
}
