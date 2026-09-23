import { tooManyOpenings } from "@/lib/content/vocabulaire";

// Mission #102, partie B — le filet horaire ne doit pas casser une négociation
// normale.
//
// Constaté au test mobile du 23/09/2026 : une analyse suivie de 2 échanges,
// puis 2 analyses par capture, et le produit refuse la suite en annonçant
// « 5 analyses en une heure ». Un échange était compté comme une analyse : la
// route des tours frappait le MÊME compteur, avec la même limite.
//
// L'unité vendue est la négociation : l'analyse, les échanges avec la marque,
// puis la conclusion. Une seule unité, cinq à six appels. Le filet ne compte
// donc plus que ce qui OUVRE une négociation ; ce qui se passe à l'intérieur
// d'une négociation déjà ouverte ne compte pas. Un abonné ne peut plus être
// arrêté au milieu de la seule chose qu'il a payée.
//
// Ce module ne parle ni à la base ni au réseau : il dit ce qu'il faut compter
// et ce qu'il faut répondre. Le compteur atomique reste usage_guard
// (lib/security/usage-guard.ts), sans changement de schéma.

// Ce que le demandeur essaie de faire.
export type LimitedAction =
  // Lancer une analyse : c'est ce qui ouvre une négociation.
  | "ouverture"
  // Coller une réponse de la marque : étape d'une négociation déjà ouverte.
  | "echange"
  // Préparer la conclusion : dernière étape de la même négociation.
  | "conclusion";

export type Requester = {
  // Compte connecté : le compteur lui est propre. Sans compte, c'est l'adresse
  // qui sert de repère, faute de mieux.
  userId: string | null;
  ip: string;
};

// Visiteur sans compte : filet strict, il n'a de toute façon qu'une seule
// négociation gratuite. C'est la protection anti-script, elle reste.
export const OPENINGS_ANON = 5;
// Compte connecté : de quoi ouvrir plusieurs négociations d'affilée sans
// jamais tomber dessus en usage normal. Ce compteur ne voit QUE les
// ouvertures, donc une négociation entière n'en consomme qu'une.
export const OPENINGS_ACCOUNT = 20;
export const LIMIT_WINDOW_SECONDS = 60 * 60;

export type LimitRule = {
  // Ce sur quoi porte le compteur. « compte » : l'activité d'un autre
  // utilisateur derrière la même adresse (wifi partagé, 4G, entreprise) ne peut
  // plus bloquer celui-ci.
  scope: "compte" | "adresse";
  // Clé en clair, à hacher par l'appelant (lib/security/request.ts, hashIp).
  key: string;
  limit: number;
  windowSeconds: number;
};

// Ce que cette action doit compter. null : rien — elle se déroule à
// l'intérieur d'une négociation déjà ouverte.
export function limitRule(action: LimitedAction, requester: Requester): LimitRule | null {
  if (action !== "ouverture") return null;
  if (requester.userId !== null) {
    return { scope: "compte", key: `negociation:compte:${requester.userId}`, limit: OPENINGS_ACCOUNT, windowSeconds: LIMIT_WINDOW_SECONDS };
  }
  return { scope: "adresse", key: requester.ip, limit: OPENINGS_ANON, windowSeconds: LIMIT_WINDOW_SECONDS };
}

export type LimitVerdict =
  // counted : ce passage a été compté dans le filet. false : il ne l'est pas,
  // et il n'y a donc rien à rendre si la suite échoue.
  | { allowed: true; counted: boolean }
  | { allowed: false; reason: "trop_d_ouvertures"; message: string; retryInMinutes: number };

// Le verdict, une fois le compteur interrogé. `hit` vaut null quand aucune
// règle ne s'applique : on ne l'interroge alors pas du tout.
export function limitVerdict(
  rule: LimitRule | null,
  hit: { allowed: boolean; retryInMinutes: number } | null,
): LimitVerdict {
  if (rule === null) return { allowed: true, counted: false };
  // Compteur non interrogé alors qu'une règle existait : on laisse passer
  // plutôt que de bloquer sur un état qu'on n'a pas lu.
  if (hit === null) return { allowed: true, counted: false };
  if (hit.allowed) return { allowed: true, counted: true };
  return {
    allowed: false,
    reason: "trop_d_ouvertures",
    message: tooManyOpenings(hit.retryInMinutes),
    retryInMinutes: hit.retryInMinutes,
  };
}
