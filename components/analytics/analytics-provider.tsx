"use client";

import { useEffect } from "react";
import { clearAnalyticsResidue, initAnalytics, track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

// Initialise la mesure d'audience, puis signale une arrivée par magic link
// (le callback ajoute ?connexion=ok) et nettoie l'URL.
//
// Mission #137 — LA MESURE TIERCE ATTEND QUE LA PAGE SOIT UTILISABLE.
//
// Mesuré en #134 : posthog-js était téléchargé et ouvert dès le premier rendu,
// pendant que le fil principal était saturé, pour ne s'initialiser qu'à
// 6 642 ms. Il part maintenant en import dynamique, après l'événement `load`
// et sur un temps mort du navigateur.
//
// Ce qui est fait TOUT DE SUITE ne change pas : le nettoyage des résidus de
// l'ancienne configuration (#050), le signalement du magic link et le nettoyage
// de l'adresse. `track` est resté synchrone et met l'événement en file : il
// part dès que la bibliothèque est là, et aucun n'est perdu.
export function AnalyticsProvider() {
  useEffect(() => {
    // Avant tout : effacer ce qu'une ancienne visite a laissé (mission #050).
    clearAnalyticsResidue();
    const url = new URL(window.location.href);
    if (url.searchParams.get("connexion") === "ok") {
      track(ANALYTICS_EVENTS.magicLinkClicked);
      url.searchParams.delete("connexion");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }

    const lancer = () => void initAnalytics();
    const planifier = () => {
      // Un temps mort si le navigateur en propose un, sinon un délai court.
      // Le `timeout` garantit que la mesure finit par partir même sur une page
      // qui n'est jamais au repos.
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(lancer, { timeout: 3000 });
      else window.setTimeout(lancer, 1000);
    };
    if (document.readyState === "complete") {
      planifier();
      return;
    }
    window.addEventListener("load", planifier, { once: true });
    return () => window.removeEventListener("load", planifier);
  }, []);
  return null;
}
