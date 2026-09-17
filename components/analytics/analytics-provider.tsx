"use client";

import { useEffect } from "react";
import { clearAnalyticsResidue, initAnalytics, track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

// Initialise la mesure d'audience, puis signale une arrivée par magic link
// (le callback ajoute ?connexion=ok) et nettoie l'URL.
export function AnalyticsProvider() {
  useEffect(() => {
    // Avant tout : effacer ce qu'une ancienne visite a laissé (mission #050).
    clearAnalyticsResidue();
    initAnalytics();
    const url = new URL(window.location.href);
    if (url.searchParams.get("connexion") === "ok") {
      track(ANALYTICS_EVENTS.magicLinkClicked);
      url.searchParams.delete("connexion");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);
  return null;
}
