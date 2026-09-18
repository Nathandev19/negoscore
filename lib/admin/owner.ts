import type { SessionUser } from "@/lib/auth/session";

// Mission #077 — pages réservées au propriétaire du site (retours sur
// l'estimation). Aucune notion de rôle, aucune colonne en base : une seule
// adresse, portée par la variable d'environnement OWNER_EMAIL, comparée côté
// serveur à l'adresse de la session vérifiée auprès de Supabase Auth (jamais
// à une adresse lue dans un cookie ou dans l'adresse de la page).
//
// Variable absente ou vide : personne n'est propriétaire, les pages n'existent
// pour personne.
//
// Lue par son nom écrit en toutes lettres (process.env.OWNER_EMAIL), jamais par
// une clé calculée (mission #079). Ce n'est pas une variable NEXT_PUBLIC_ : elle
// n'est PAS copiée dans le code au build, le serveur la lit à l'exécution.
// C'est voulu (une adresse n'a pas à être figée dans les fichiers déployés) et
// ça fonctionne : le proxy tourne sous Node.js (Next 16), avec un vrai
// process.env. Conséquence : après avoir ajouté ou changé la variable dans
// Vercel, il faut un NOUVEAU déploiement pour qu'elle soit vue.
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

export function isOwnerEmail(email: string | null | undefined, configured: string | undefined = process.env.OWNER_EMAIL): boolean {
  if (!email || !configured) return false;
  const expected = normalize(configured);
  return expected !== "" && normalize(email) === expected;
}

export function isOwner(user: Pick<SessionUser, "email"> | null): boolean {
  return user !== null && isOwnerEmail(user.email);
}

// Mission #079 — pourquoi une personne CONNECTÉE n'a pas eu la page. Écrit dans
// les journaux du serveur (Vercel → Logs), jamais à l'écran : la réponse reste
// celle d'une page inexistante. Aucune adresse n'est écrite, ni celle de la
// session ni celle de la variable : seulement la forme de la variable, de quoi
// repérer des guillemets ou un espace collés par erreur.
export type OwnerRefusal = "session_non_verifiee" | "variable_absente" | "adresse_differente";

export function ownerRefusal(sessionEmail: string | null | undefined, configured: string | undefined = process.env.OWNER_EMAIL): OwnerRefusal {
  if (!sessionEmail) return "session_non_verifiee";
  if (!configured || configured.trim() === "") return "variable_absente";
  return "adresse_differente";
}

export function ownerRefusalLog(reason: OwnerRefusal, configured: string | undefined = process.env.OWNER_EMAIL): string {
  const value = configured ?? "";
  return JSON.stringify({
    event: "owner_page_refused",
    reason,
    variable: {
      presente: configured !== undefined,
      longueur: value.length,
      espaces_autour: value !== value.trim(),
      guillemets: /^\s*["']|["']\s*$/.test(value),
      arobase: value.includes("@"),
    },
  });
}
