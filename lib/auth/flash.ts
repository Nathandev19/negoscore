// Confirmation de connexion et de déconnexion (mission #046). Le serveur pose
// un cookie éphémère juste avant la redirection ; le bandeau (components/
// flash-banner.tsx) le lit une fois, l'efface aussitôt, et s'affiche sur la
// page d'arrivée seulement.
//
// Valeur constante, aucun identifiant ni adresse email. Lisible par le
// navigateur (non httpOnly) : les pages d'arrivée sont statiques. Il n'autorise
// rien. Durée courte : s'il n'est pas lu (JavaScript bloqué), il disparaît seul.
//
// Module sans dépendance serveur.

export const FLASH_COOKIE = "ns_flash";
export const FLASH_KINDS = ["connexion", "deconnexion"] as const;
export type FlashKind = (typeof FLASH_KINDS)[number];
const FLASH_MAX_AGE = 60;

export function flashCookieHeader(kind: FlashKind, secure: boolean): string {
  return `${FLASH_COOKIE}=${kind}; Path=/; Max-Age=${FLASH_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function expiredFlashCookie(): string {
  return `${FLASH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readFlash(cookieString: string): FlashKind | null {
  for (const part of cookieString.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === FLASH_COOKIE && (FLASH_KINDS as readonly string[]).includes(value)) return value as FlashKind;
  }
  return null;
}

// Visible seulement sur la page d'arrivée, tant qu'il n'a pas été fermé : la
// navigation suivante le fait disparaître.
export function flashVisible(flash: { pathname: string } | null, pathname: string, dismissed: boolean): boolean {
  return flash !== null && !dismissed && flash.pathname === pathname;
}

export type FlashMessage = { title: string; text: string | null; link: { href: string; label: string } | null };

// Message selon la page d'arrivée. Jamais d'adresse email.
export function flashMessage(kind: FlashKind, pathname: string): FlashMessage {
  if (kind === "deconnexion") {
    return { title: "Déconnexion réussie.", text: "Ce navigateur n'a plus accès à ton compte ni à tes analyses.", link: null };
  }
  const title = "Connexion réussie.";
  // Page de résultat : le bandeau ne dit rien de l'analyse (mission #067). Il
  // s'affiche avant de savoir si la page a pu l'ouvrir, et affirmait « Cette
  // analyse est débloquée » au-dessus d'une page introuvable. C'est la page
  // elle-même qui le dit, et seulement quand elle l'affiche : pastille
  // « Débloqué à l'instant » sur les blocs ouverts, ou explication sur la 404.
  if (pathname.startsWith("/analyse/resultat/")) return { title, text: null, link: null };
  if (pathname === "/historique") return { title, text: "Voici toutes tes analyses.", link: null };
  if (pathname === "/compte") return { title, text: "Voici ton compte et tes crédits.", link: null };
  if (pathname === "/tarifs") return { title, text: "Tu peux maintenant choisir une formule.", link: null };
  if (pathname === "/analyse") return { title, text: "Colle l'offre d'une marque pour l'analyser.", link: null };
  return { title, text: "Tu peux analyser un deal et retrouver tes analyses.", link: { href: "/historique", label: "Mes analyses" } };
}
