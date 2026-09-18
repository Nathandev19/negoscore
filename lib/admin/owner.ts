import type { SessionUser } from "@/lib/auth/session";

// Mission #077 — pages réservées au propriétaire du site (retours sur
// l'estimation). Aucune notion de rôle, aucune colonne en base : une seule
// adresse, portée par la variable d'environnement OWNER_EMAIL, comparée côté
// serveur à l'adresse de la session vérifiée auprès de Supabase Auth (jamais
// à une adresse lue dans un cookie ou dans l'adresse de la page).
//
// Variable absente ou vide : personne n'est propriétaire, les pages n'existent
// pour personne.
export const OWNER_EMAIL_ENV = "OWNER_EMAIL";

// Préfixe des pages réservées. Le proxy (proxy.ts) y répond comme à une adresse
// inexistante pour toute autre personne, avant le moindre rendu.
export const OWNER_PAGES_PREFIX = "/dev/retours";

export function isOwnerPath(pathname: string): boolean {
  return pathname === OWNER_PAGES_PREFIX || pathname.startsWith(`${OWNER_PAGES_PREFIX}/`);
}

// Toute la zone /dev, fermée en production aux autres que le propriétaire. Ses
// pages de prévisualisation n'y existent pas (extension .dev.tsx, voir
// next.config.ts) ; la fermer ENTIÈREMENT rend /dev/retours indiscernable de
// n'importe quelle adresse /dev inexistante, jusqu'aux en-têtes de réponse
// (la réécriture du proxy en ajoute un, voir proxy.ts). En développement, les
// prévisualisations restent ouvertes.
export function isDevZone(pathname: string): boolean {
  return pathname === "/dev" || pathname.startsWith("/dev/");
}

const normalize = (email: string) => email.trim().toLowerCase();

export function isOwnerEmail(email: string | null | undefined, configured: string | undefined = process.env[OWNER_EMAIL_ENV]): boolean {
  if (!email || !configured) return false;
  const expected = normalize(configured);
  return expected !== "" && normalize(email) === expected;
}

export function isOwner(user: Pick<SessionUser, "email"> | null): boolean {
  return user !== null && isOwnerEmail(user.email);
}
