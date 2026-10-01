"use client";

import { useEffect } from "react";

// Mission #142 — CE QUI RESTE QUAND LA MESURE TIERCE S'EN VA.
//
// Ce composant s'appelait AnalyticsProvider. Il faisait trois choses : démarrer
// PostHog, effacer ce qu'une ancienne configuration de PostHog avait laissé sur
// l'appareil, et nettoyer l'adresse après une arrivée par lien de connexion.
// PostHog est parti (il coûtait ~380 ms de blocage et 96,7 ko sur chaque page,
// pour une mesure que personne ne lisait : la règle du projet depuis #103 est
// « on lit /admin, jamais PostHog »). Les deux autres restent, et c'est tout ce
// que fait ce fichier.
//
// Il ne crée pas de frontière cliente supplémentaire : trois autres composants
// du layout en sont déjà, et la mission #141 a mesuré que les suivants coûtent
// zéro.

// Résidus laissés par l'ancienne configuration (mission #050) : un visiteur
// venu avant la mission #049 garde un cookie ph_… jusqu'à 12 mois, alors que la
// politique de confidentialité annonce qu'aucune mesure n'écrit sur l'appareil.
// Plus rien ne les écrit ni ne les lit depuis que PostHog est parti, mais ils
// ne s'effaceraient pas tout seuls avant un an : on continue de les retirer.
//
// Nettoyage silencieux : rien n'est affiché, rien n'est envoyé, et un stockage
// inaccessible (navigation privée, blocage) ne remonte aucune erreur. Seuls les
// noms de l'ancienne mesure sont touchés.
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

// Arrivée par lien de connexion : le callback ajoute ?connexion=ok pour que le
// bandeau de confirmation sache quoi dire (components/flash-banner.tsx). Le
// paramètre a fait son travail dès le premier rendu : on le retire de l'adresse
// pour qu'il ne soit ni partagé, ni rejoué au rechargement.
export function ArrivalCleanup() {
  useEffect(() => {
    clearAnalyticsResidue();
    const url = new URL(window.location.href);
    if (url.searchParams.get("connexion") === "ok") {
      url.searchParams.delete("connexion");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);
  return null;
}
