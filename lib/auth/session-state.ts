// Mission #089 bis — la décision, et rien d'autre.
//
// Un appel d'authentification a trois issues, jamais deux :
//   - « valide »        : l'authentification a répondu, la session vaut ;
//   - « absente »       : l'authentification a RÉPONDU qu'il n'y a pas de
//                         session (aucun jeton, ou jeton refusé) ;
//   - « indisponible »  : on n'a PAS PU demander. On ne sait rien.
//
// « Absente » et « indisponible » se ressemblent au premier coup d'œil et ne
// se ressemblent en rien : la première autorise à effacer des cookies, à
// afficher « connecte-toi », à compter une analyse gratuite ; la seconde
// n'autorise rien de tout ça, parce qu'une abonnée sur un réseau mobile la
// déclenche plusieurs fois par jour.
//
// Module sans aucune dépendance : il se teste seul, et c'est le seul endroit
// où le partage se décide.

export type SessionState = "valide" | "absente" | "indisponible";

// Ce qu'un appel d'authentification a produit, avant toute interprétation.
export type AuthCall =
  // Rien à demander : pas de jeton sur la requête.
  | { kind: "aucun-jeton" }
  // L'appel n'a pas abouti : réseau coupé, DNS, délai dépassé, TLS.
  | { kind: "injoignable" }
  // L'appel a abouti : voici ce qui est revenu.
  | { kind: "reponse"; status: number; user: boolean };

// Codes qui disent « reviens plus tard », pas « cette session ne vaut rien ».
// Même partage que le client officiel supabase-js (auth-js, GoTrueClient) :
// il garde la session sur une erreur « retryable » et la retire sur les autres.
const RETRY_STATUS = new Set([408, 429]);

export function statusMeansUnavailable(status: number): boolean {
  return status >= 500 || RETRY_STATUS.has(status);
}

export function sessionStateFrom(call: AuthCall): SessionState {
  if (call.kind === "aucun-jeton") return "absente";
  if (call.kind === "injoignable") return "indisponible";
  // Réponse 200 sans utilisateur lisible : on ne conclut pas que la session
  // est invalide. On n'a rien compris, ce n'est pas la même chose.
  if (call.status >= 200 && call.status < 300) return call.user ? "valide" : "indisponible";
  return statusMeansUnavailable(call.status) ? "indisponible" : "absente";
}

// Passerelle vers le vocabulaire déjà en place (lib/auth/session.ts). Le
// paramètre est structurel : ce module ne dépend de rien.
export function sessionState(check: { kind: "valid" | "absent" | "rejected" | "unavailable" }): SessionState {
  if (check.kind === "valid") return "valide";
  if (check.kind === "unavailable") return "indisponible";
  return "absente";
}

// Les deux questions qu'on pose à un état, et qui ne se répondent pas pareil.

// A2 — a-t-on le droit de DÉTRUIRE quelque chose : effacer un cookie de
// session, déconnecter, jeter un brouillon, décompter une analyse, trancher
// sur un plan ? Seulement si l'authentification a répondu.
export function mayDestroy(state: SessionState): boolean {
  return state !== "indisponible";
}

// A4 — a-t-on le droit d'OUVRIR une porte ? Seulement sur une session valide.
// « Indisponible » refuse l'accès ; il ne l'ouvre pas au motif qu'on n'a pas
// pu vérifier, et il ne détruit rien non plus.
export function mayEnter(state: SessionState): boolean {
  return state === "valide";
}
