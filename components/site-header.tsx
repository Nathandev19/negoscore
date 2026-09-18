"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { HeaderNav, type HeaderTone } from "@/components/header-nav";
import { hasSessionHint } from "@/lib/auth/session-hint";
import { hasOwnerHint } from "@/lib/auth/owner-hint";

// Composant client : les pages publiques restent statiques. L'état vient de
// l'indicateur de session, jamais d'un jeton ; il ne sert qu'à choisir les liens.
// Rendu serveur et hydratation (mission #071) : état INCONNU. L'emplacement du
// lien de compte est réservé, invisible et inerte, au lieu d'affirmer
// « Se connecter » à une personne connectée. Il se remplit dès l'hydratation.
// Contrepartie assumée : sans JavaScript, l'en-tête n'offre pas ce lien.

// Le cookie ne change qu'avec un chargement complet de page (connexion,
// déconnexion, suppression) : aucun abonnement n'est nécessaire.
const subscribe = () => () => undefined;

export function SiteHeader({ tone = "creme" }: { tone?: HeaderTone }) {
  const signedIn = useSyncExternalStore(
    subscribe,
    () => hasSessionHint(document.cookie),
    () => null,
  );
  // Mission #080 : lien vers /dev/retours. Faux au rendu serveur, comme tout
  // ce qui dépend de la personne qui regarde.
  const owner = useSyncExternalStore(
    subscribe,
    () => hasOwnerHint(document.cookie),
    () => false,
  );
  return <HeaderNav signedIn={signedIn} owner={owner} pathname={usePathname()} tone={tone} />;
}
