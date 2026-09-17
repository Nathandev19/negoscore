"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { HeaderNav } from "@/components/header-nav";
import { hasSessionHint } from "@/lib/auth/session-hint";

// Composant client : les pages publiques restent statiques. L'état vient de
// l'indicateur de session, jamais d'un jeton ; il ne sert qu'à choisir les liens.
// Rendu serveur et hydratation : « Se connecter », l'état de la majorité des
// visiteurs (trafic TikTok, sans cookie), utilisable sans JavaScript. Un
// visiteur connecté voit ses liens de compte juste après l'hydratation ; s'il
// clique avant, /connexion le renvoie vers son compte.

// Le cookie ne change qu'avec un chargement complet de page (connexion,
// déconnexion, suppression) : aucun abonnement n'est nécessaire.
const subscribe = () => () => undefined;

export function SiteHeader() {
  const signedIn = useSyncExternalStore(
    subscribe,
    () => hasSessionHint(document.cookie),
    () => false,
  );
  return <HeaderNav signedIn={signedIn} pathname={usePathname()} />;
}
