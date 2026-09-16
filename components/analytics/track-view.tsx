"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";
import type { AnalyticsEvent, AnalyticsProperties } from "@/lib/analytics/events";

// Émet un événement au premier rendu d'une page serveur.
export function TrackView({ event, properties }: { event: AnalyticsEvent; properties?: AnalyticsProperties }) {
  useEffect(() => {
    track(event, properties ?? {});
    // Une seule fois par page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
