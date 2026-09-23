"use client";

import { useEffect } from "react";

export type ClientAttribution = {
  path: string;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
};

const value = (params: URLSearchParams, key: string) => params.get(key)?.trim().toLowerCase() || null;

export function currentAttribution(): ClientAttribution {
  const params = new URLSearchParams(window.location.search);
  let referrer: string | null = null;
  try {
    referrer = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : null;
  } catch {
    referrer = null;
  }
  return {
    path: window.location.pathname,
    referrer_host: referrer,
    utm_source: value(params, "utm_source"), utm_medium: value(params, "utm_medium"),
    utm_campaign: value(params, "utm_campaign"), utm_content: value(params, "utm_content"),
  };
}

export function FirstPartyView({ event }: { event: "landing_view" | "pricing_view" }) {
  useEffect(() => {
    if (navigator.doNotTrack === "1") return;
    void fetch("/api/events", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ event, attribution: currentAttribution() }),
    });
  }, [event]);
  return null;
}
