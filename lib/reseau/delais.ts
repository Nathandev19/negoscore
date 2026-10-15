// Mission #194, B — UN APPEL QUI TRAÎNE NE BLOQUE PLUS SANS PLAFOND.
// Mission #195, B — et les appels au prestataire de paiement en font partie.
//
// Aucun fetch du projet ne portait de délai. Un appel sortant pouvait donc
// occuper une fonction jusqu'au plafond de la plateforme, pendant que la
// personne regarde un écran qui ne dit rien.
//
// Module FEUILLE, sans aucun import : il est lu par lib/supabase/server.ts
// (clé service_role), par lib/auth/session.ts (clé anon) et par
// lib/whop/api.ts (clé Whop) — trois magasins de clés qui ne doivent pas se
// rencontrer, tests/security.test.ts vérifiant que la clé de service n'est lue
// que par deux fichiers. D'où lib/reseau/ et non lib/supabase/ : il a quitté
// ce dossier en #195, quand il a cessé de ne servir qu'à Supabase.
//
// C'est aussi, par conséquence utile, le seul endroit où TOUS les plafonds
// sortants du projet se lisent d'un coup d'œil.

// Trois plafonds, trois usages. Ils ne sont pas réglés sur « ce qui est long »
// mais sur « à partir de quand attendre ne sert plus à rien » :
//
//   PostgREST  une requête sur un index, dans la MÊME région que la fonction
//              depuis la partie A de cette mission. Au-delà de 5 s, ce n'est
//              plus de la latence, c'est une panne.
//   Auth       plus généreux : la vérification d'un jeton passe par un service
//              distinct, et une déconnexion à tort coûte infiniment plus cher
//              qu'une seconde d'attente.
//   Storage    un transfert d'octets, pas une requête : un PDF de plusieurs
//              mégaoctets sur un réseau mobile a le droit de prendre du temps.
export const DELAI_POSTGREST_MS = 5_000;
export const DELAI_AUTH_MS = 8_000;
export const DELAI_STORAGE_MS = 15_000;

// Mission #195 — WHOP, sur le chemin du PAIEMENT. Le plus généreux des quatre
// après Storage : un appel au prestataire traverse un service tiers, et une
// page de paiement qui n'ouvre pas coûte une vente. Mais il a un plafond,
// parce qu'un appel qui traîne indéfiniment la coûte aussi — et laisse en plus
// une fonction occupée.
export const DELAI_WHOP_MS = 10_000;

// Pose le plafond sur un appel sortant, sans écraser un signal déjà fourni :
// celui de l'appelant garde son effet, et le délai s'y ajoute.
export function avecDelai(init: RequestInit, ms: number): RequestInit {
  const delai = AbortSignal.timeout(ms);
  return { ...init, signal: init.signal ? AbortSignal.any([init.signal, delai]) : delai };
}

// Un délai dépassé se reconnaît à son nom. fetch rejette avec une
// DOMException « TimeoutError » quand le signal de AbortSignal.timeout se
// déclenche, et « AbortError » quand c'est un signal de l'appelant.
//
// CE QUE CETTE FONCTION SERT À DÉCIDER, ET C'EST TOUT L'ENJEU : un délai
// dépassé veut dire « on n'a PAS PU demander », jamais « on a demandé et la
// réponse est non ». lib/auth/session-state.ts appelle ça « indisponible », et
// la différence n'est pas cosmétique : proxy.ts efface les cookies de session
// sur un refus. Classer un délai dépassé comme un refus déconnecterait
// quelqu'un pour un simple ralentissement de réseau.
export function estDelaiDepasse(caught: unknown): boolean {
  if (!(caught instanceof Error)) return false;
  return caught.name === "TimeoutError" || caught.name === "AbortError";
}
