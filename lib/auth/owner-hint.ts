// Indicateur « propriétaire » pour l'affichage de l'en-tête (mission #080),
// sur le modèle de l'indicateur de session (lib/auth/session-hint.ts).
//
// Posé à la connexion (et à chaque rafraîchissement de session) quand l'adresse
// vérifiée par Supabase est celle de OWNER_EMAIL ; effacé avec les cookies de
// session, et effacé aussi quand l'adresse n'est pas (ou plus) celle-là. Lisible
// par le navigateur, valeur constante : aucune adresse, aucun jeton.
//
// Il n'autorise RIEN. Il ne fait qu'afficher un lien vers /dev/retours ; le
// proxy et la page vérifient l'adresse de la session côté serveur. Posé à la
// main, il ne mène qu'à la réponse d'une page inexistante.
//
// Module sans dépendance serveur : il est aussi importé par l'en-tête client.

export const OWNER_HINT_COOKIE = "ns_proprio";
export const OWNER_HINT_VALUE = "1";
// Même durée que l'indicateur de session.
const OWNER_HINT_MAX_AGE = 60 * 60 * 24 * 30;

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function ownerHintCookieHeader(): string {
  return `${OWNER_HINT_COOKIE}=${OWNER_HINT_VALUE}; Path=/; Max-Age=${OWNER_HINT_MAX_AGE}; SameSite=Lax${secureFlag()}`;
}

export function expiredOwnerHintCookieHeader(): string {
  return `${OWNER_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`;
}

// Posé si owner, effacé sinon : un indicateur périmé (adresse changée,
// variable modifiée) disparaît au prochain rafraîchissement de session.
export function ownerHintCookieHeaderFor(owner: boolean): string {
  return owner ? ownerHintCookieHeader() : expiredOwnerHintCookieHeader();
}

export function hasOwnerHint(cookieString: string): boolean {
  return cookieString.split(";").some((part) => part.trim() === `${OWNER_HINT_COOKIE}=${OWNER_HINT_VALUE}`);
}
