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

// Identifiant anonyme du navigateur, à transmettre au paiement pour relier
// l'achat au parcours. null quand la mesure est désactivée (DNT, pas de clé).
export function analyticsDistinctId(): string | null {
  if (!ready) return null;
  try {
    return posthog.get_distinct_id() || null;
  } catch {
    return null;
  }
}
