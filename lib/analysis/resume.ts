// Mission #102, partie A — une analyse lancée doit survivre à la mise en
// arrière-plan.
//
// Constaté au test mobile du 23/09/2026 (iPhone, Safari) : on lance l'analyse,
// on quitte l'application le temps qu'elle tourne, on revient, et l'écran est
// figé. iOS gèle les minuteries d'un onglet en arrière-plan et coupe ses
// connexions : la requête longue ne se termine jamais côté navigateur, et rien
// ne va rechercher l'état réel.
//
// Le travail, lui, va au bout : l'appel au modèle a son propre délai
// (lib/llm/extract.ts), il n'est pas rattaché à la connexion du navigateur, et
// l'analyse est enregistrée. Il ne manque que la resynchronisation.
//
// Ce module ne connaît ni le DOM ni le réseau : il décide QUOI faire à partir
// de ce qu'on sait localement, de ce que le serveur répond et de l'heure. Le
// composant fait le geste. Même séparation que lib/ui/reveal.ts.

// Deux retours au premier plan rapprochés (visibilitychange puis pageshow, que
// Safari envoie tous les deux) ne déclenchent qu'une vérification.
export const RECHECK_MIN_MS = 1_000;

// Au-delà, une demande dont le serveur ne sait rien n'arrivera plus : la route
// d'analyse s'arrête d'elle-même à 120 s (maxDuration), marge comprise.
export const RESUME_DEADLINE_MS = 150_000;

export type LocalAttempt = {
  // Clé d'idempotence de la tentative en cours. null : rien à rattraper.
  key: string | null;
  // Départ de la tentative (Date.now()). null : rien à rattraper.
  startedAt: number | null;
  // Dernière vérification lancée. null : aucune.
  lastCheckAt: number | null;
};

// Ce que le serveur sait de cette clé. null : on ne lui a pas encore demandé.
export type ServerAttempt =
  // Analyse produite et enregistrée : elle est à nous, on l'affiche.
  | { kind: "done"; analysisId: string }
  // Rien en base pour cette clé : soit le travail court encore, soit il n'est
  // jamais parti. Le temps écoulé tranche.
  | { kind: "unknown" }
  // Le serveur a répondu que la tentative a échoué, sans rien décompter.
  | { kind: "failed" }
  // La vérification elle-même n'a pas abouti : on ne conclut rien.
  | { kind: "unreachable" };

export type ResumeDecision =
  // Le résultat est là : on l'affiche.
  | { action: "afficher"; analysisId: string }
  // Le travail court encore : l'attente reprend, l'écran reste honnête.
  | { action: "attendre" }
  // Demander au serveur où il en est. JAMAIS relancer l'analyse : cette
  // vérification ne lit que l'état de CETTE clé (app/api/analyse/etat).
  | { action: "verifier"; key: string }
  // Rien n'a abouti et plus rien n'arrivera : on le dit, sans rien relancer.
  | { action: "echec" }
  // Aucune tentative en cours : il n'y a rien à rattraper.
  | { action: "rien" };

export function nextResume({
  local,
  server,
  now,
}: {
  local: LocalAttempt;
  server: ServerAttempt | null;
  now: number;
}): ResumeDecision {
  if (local.key === null || local.startedAt === null) return { action: "rien" };

  if (server === null) {
    // Vérification déjà lancée à l'instant : une seule par retour.
    if (local.lastCheckAt !== null && now - local.lastCheckAt < RECHECK_MIN_MS) return { action: "attendre" };
    return { action: "verifier", key: local.key };
  }

  if (server.kind === "done") return { action: "afficher", analysisId: server.analysisId };
  if (server.kind === "failed") return { action: "echec" };
  // Vérification injoignable : le réseau du téléphone revient souvent juste
  // après. On garde l'attente plutôt que d'annoncer un échec qui n'en est pas un.
  if (server.kind === "unreachable") return { action: "attendre" };
  // Le serveur ne connaît pas cette clé : il travaille peut-être encore.
  return now - local.startedAt >= RESUME_DEADLINE_MS ? { action: "echec" } : { action: "attendre" };
}
