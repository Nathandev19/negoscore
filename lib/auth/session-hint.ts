// Indicateur de session pour l'affichage de l'en-tête sur les pages statiques.
//
// Posé et effacé avec les cookies de session, lisible par le navigateur (non
// httpOnly). Sa valeur est une constante : aucun jeton, aucun email, aucune
// initiale, aucun identifiant. Il dit seulement « une session a été ouverte
// dans ce navigateur ». Il n'autorise RIEN : chaque page protégée et chaque
// route vérifient l'utilisateur auprès de Supabase à partir du cookie httpOnly.
//
// Module sans dépendance serveur : il est aussi importé par l'en-tête client.

export const SESSION_HINT_COOKIE = "ns_session";
export const SESSION_HINT_VALUE = "1";
// Même durée que les cookies de session (30 jours), prolongée à chaque rafraîchissement.
const SESSION_HINT_MAX_AGE = 60 * 60 * 24 * 30;

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionHintCookieHeader(): string {
  return `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}; Path=/; Max-Age=${SESSION_HINT_MAX_AGE}; SameSite=Lax${secureFlag()}`;
}

export function expiredSessionHintCookieHeader(): string {
  return `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`;
}

// Lecture de document.cookie : présence de l'indicateur avec sa valeur attendue.
export function hasSessionHint(cookieString: string): boolean {
  return cookieString
    .split(";")
    .some((part) => part.trim() === `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}`);
}
