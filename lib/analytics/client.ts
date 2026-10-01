"use client";

import type { PostHog } from "posthog-js";
import type { AnalyticsEvent, AnalyticsProperties } from "@/lib/analytics/events";

// Mesure d'audience côté navigateur. Sans clé, l'application fonctionne
// normalement et rien n'est envoyé. Aucune donnée de deal, aucun email :
// seules les propriétés listées dans lib/analytics/events.ts sont émises.
//
// Mission #137 — CHARGÉE À LA DEMANDE, PAS AVANT.
//
// Mesuré en #134 : posthog-js pesait 96,4 ko transférés et 290,2 ko décodés
// sur les quatre pages du site, et ne s'initialisait qu'à 6 642 ms. Six
// secondes payées d'avance, pendant que le fil principal était déjà saturé.
//
// L'import est donc dynamique, et il part une fois la page interactive. Deux
// conséquences à tenir :
//   - `track` reste SYNCHRONE : les événements émis avant l'arrivée de la
//     bibliothèque sont mis en file et envoyés ensuite, aucun n'est perdu ;
//   - rien n'est mis en file quand la mesure est éteinte (pas de clé, refus
//     de suivi) : la file ne grossit jamais pour rien.
//
// Ce module ne concerne QUE la mesure tierce. La mesure première partie — le
// pixel /api/vue, les événements /api/events, tout ce que lit le cockpit —
// n'en dépend pas d'une ligne : voir components/analytics/first-party-view.tsx
// et components/result/tier-selector.tsx, qui n'importent rien d'ici.

let posthog: PostHog | null = null;
let ready = false;
let chargement: Promise<void> | null = null;

// Les événements émis avant l'arrivée de la bibliothèque. Bornée : si le
// chargement échoue, cette file ne doit pas grandir indéfiniment.
const ATTENTE_MAX = 20;
const attente: Array<[AnalyticsEvent, AnalyticsProperties]> = [];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const signals = [navigator.doNotTrack, (window as { doNotTrack?: string }).doNotTrack];
  return signals.some((value) => value === "1" || value === "yes");
}

// Résidus laissés par l'ancienne configuration (mission #050) : un visiteur déjà
// venu garde un cookie ph_… jusqu'à 12 mois, alors que la politique de
// confidentialité annonce désormais qu'aucune mesure n'écrit sur l'appareil.
// Nettoyage silencieux au premier chargement : rien n'est affiché, rien n'est
// envoyé, et un stockage inaccessible (navigation privée, blocage) ne remonte
// aucune erreur. Seuls les noms de la mesure sont touchés.
const RESIDUE_PREFIX = "ph_";
const RESIDUE_KEY = "posthog";

export function clearAnalyticsResidue(): void {
  try {
    const names = document.cookie
      .split(";")
      .map((part) => part.split("=")[0]?.trim() ?? "")
      .filter((name) => name.startsWith(RESIDUE_PREFIX));
    for (const name of names) {
      // Le cookie a pu être posé sur l'hôte ou sur le domaine parent : on
      // expire les variantes, sans toucher à autre chose que ce nom.
      const host = window.location.hostname;
      const parent = host.split(".").slice(-2).join(".");
      for (const domain of [null, host, `.${host}`, `.${parent}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
      }
    }
  } catch {
    // Cookies inaccessibles : il n'y a rien à nettoyer et rien à signaler.
  }
  for (const storage of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = window[storage];
      for (const key of Object.keys(store)) {
        if (key.toLowerCase().includes(RESIDUE_KEY)) store.removeItem(key);
      }
    } catch {
      // Stockage bloqué : idem.
    }
  }
}

// La mesure est-elle allumée ? Répond SANS charger quoi que ce soit : c'est
// ce qui permet à `track` de décider en un instant s'il met en file ou s'il
// jette.
export function analyticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY) && !doNotTrack();
}

export function initAnalytics(): Promise<void> {
  if (chargement) return chargement;
  if (!analyticsEnabled()) return Promise.resolve();
  chargement = charger();
  return chargement;
}

async function charger(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY as string;
  // L'import dynamique crée un morceau à part, demandé seulement ici.
  const bibliotheque = await import("posthog-js");
  posthog = bibliotheque.default;
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
  // Ce qui a été émis pendant le chargement part maintenant, dans l'ordre.
  for (const [event, properties] of attente.splice(0)) posthog.capture(event, properties);
}

export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  if (ready && posthog) {
    posthog.capture(event, properties);
    return;
  }
  // Mesure éteinte : rien à mettre en file, rien à envoyer plus tard.
  if (!analyticsEnabled()) return;
  if (attente.length < ATTENTE_MAX) attente.push([event, properties]);
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
  if (!ready || !posthog) return null;
  try {
    const id = posthog.get_distinct_id();
    return !id || id === COOKIELESS_SENTINEL ? null : id;
  } catch {
    return null;
  }
}
