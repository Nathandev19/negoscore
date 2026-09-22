// Indicateur « plus de droit gratuit dans ce navigateur » (mission #046), pour
// dire AVANT la saisie qu'une analyse ne passera pas, sans casser le rendu
// statique de l'accueil ni appeler le serveur à chaque visite.
//
// Posé par /api/analyse quand l'analyse gratuite de ce navigateur vient d'être
// décomptée, ou refusée faute de droit. Lisible par le navigateur (non
// httpOnly), valeur constante : aucun identifiant. Il ne décide RIEN : le droit
// réel est vérifié par le serveur à chaque analyse. Il ne sert qu'à l'affichage
// d'un visiteur sans compte ; un compte connecté interroge /api/droits.
//
// Même durée que le jeton anonyme (ANON_COOKIE_MAX_AGE, lib/security/request.ts,
// égalité vérifiée par test) : un navigateur dont le jeton a expiré obtient un
// nouveau jeton, et l'indicateur disparaît avec l'ancien.
//
// Module sans dépendance serveur : importé aussi par le formulaire d'analyse.

export const RIGHT_HINT_COOKIE = "ns_gratuit";
export const RIGHT_HINT_VALUE = "utilise";
export const RIGHT_HINT_MAX_AGE = 60 * 60 * 24 * 30;

export const NO_FREE_LEFT_MESSAGE =
  "Tu as utilisé ta négociation gratuite. Choisis une formule pour négocier d'autres deals.";

export function rightHintCookieHeader(secure: boolean): string {
  return `${RIGHT_HINT_COOKIE}=${RIGHT_HINT_VALUE}; Path=/; Max-Age=${RIGHT_HINT_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function hasNoFreeRightHint(cookieString: string): boolean {
  return cookieString.split(";").some((part) => part.trim() === `${RIGHT_HINT_COOKIE}=${RIGHT_HINT_VALUE}`);
}

// Ce que le formulaire affiche selon ce qu'il sait (fonction pure, testée).
//   refused : refus reçu du serveur au dernier clic (fait foi) ;
//   signedIn : indicateur de session ; account : réponse de /api/droits ;
//   anonUsed : indicateur de ce module.
export type RightView = { blocked: false } | { blocked: true; message: string; offerSignIn: boolean };

export function rightView(input: {
  refused: { message: string } | null;
  signedIn: boolean;
  account: { allowed: boolean; message?: string } | null;
  anonUsed: boolean;
}): RightView {
  const { refused, signedIn, account, anonUsed } = input;
  if (refused) return { blocked: true, message: refused.message, offerSignIn: !signedIn };
  if (signedIn) {
    // Compte : seule la réponse du serveur compte ; avant elle, rien n'est bloqué.
    if (account && !account.allowed) return { blocked: true, message: account.message ?? NO_FREE_LEFT_MESSAGE, offerSignIn: false };
    return { blocked: false };
  }
  return anonUsed ? { blocked: true, message: NO_FREE_LEFT_MESSAGE, offerSignIn: true } : { blocked: false };
}
