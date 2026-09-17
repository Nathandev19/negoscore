"use client";

import { useSyncExternalStore } from "react";
import { HeaderNav } from "@/components/header-nav";
import { hasSessionHint } from "@/lib/auth/session-hint";

// Composant client : les pages publiques restent statiques. L'état vient de
// l'indicateur de session, jamais d'un jeton ; il ne sert qu'à choisir les liens.
// Côté serveur et pendant l'hydratation, l'état est inconnu (null).

// Le cookie ne change qu'avec un chargement complet de page (connexion,
// déconnexion, suppression) : aucun abonnement n'est nécessaire.
const subscribe = () => () => undefined;

export function SiteHeader() {
  const signedIn = useSyncExternalStore(
    subscribe,
    () => hasSessionHint(document.cookie),
    () => null,
  );
  return <HeaderNav signedIn={signedIn} />;
}
