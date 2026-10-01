// Mission #137 — LES CONSTANTES DE LA NÉGOCIATION, SANS AUCUNE DÉPENDANCE.
//
// Ce module ne contient que des valeurs et des libellés. Il est volontairement
// SANS IMPORT : c'est sa raison d'être.
//
// Mesuré en #134 : zod pesait 390,3 ko décodés sur les quatre pages du site,
// y compris /tarifs qui n'en a aucun usage. Il entrait par UNE ligne —
// lib/content/vocabulaire.ts importait `LAST_TURN` depuis
// lib/negotiation/types.ts, où les constantes cohabitaient avec les schémas.
// Un import de valeur embarque tout le module, et donc zod.
//
// lib/negotiation/types.ts réexporte tout ce qui suit : aucun appelant côté
// serveur ne change. Les modules que le navigateur atteint, eux, importent
// ICI, et n'embarquent plus rien.
// Termes du deal suivis d'un tour à l'autre (B2 : livrables, durée, territoire,
// exclusivité, montant, plus ce qui change le chiffrage ou la conclusion). Un
// changement n'est retenu que groupe par groupe, et seulement avec une citation
// exacte de la marque : jamais un chiffre qui bouge en silence.
export const TERM_GROUPS = [
  "deliverables",
  "amount",
  "in_kind",
  "usage_rights",
  "usage_duration",
  "territory",
  "exclusivity",
  "payment_terms",
  "publication",
] as const;
export type TermGroup = (typeof TERM_GROUPS)[number];

export const TERM_GROUP_LABEL: Record<TermGroup, string> = {
  deliverables: "Livrables",
  amount: "Rémunération",
  in_kind: "Produits offerts",
  usage_rights: "Droits d'utilisation",
  usage_duration: "Durée des droits",
  territory: "Territoire",
  exclusivity: "Exclusivité",
  payment_terms: "Paiement",
  publication: "Publication sur tes comptes",
};

// Ce que la marque a fait de chaque demande du dernier message.
// partial (mission #082) : la marque fait ce qui est demandé, mais pas
// entièrement ; ce qui reste à préciser est dit (champ « remaining »).
export const ASK_STATUSES = ["granted", "partial", "refused", "countered", "unanswered"] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

export const ASK_STATUS_LABEL: Record<AskStatus, string> = {
  granted: "Accordé",
  partial: "Accordé en partie",
  refused: "Refusé",
  countered: "Contre-proposé",
  unanswered: "Toujours sans réponse",
};

// Mission #083, A1 — ce qui s'affiche pour un point dont la lecture n'a pas pu
// être vérifiée dans la réponse de la marque.
export const UNVERIFIED_LABEL = "Non vérifiable";
export const UNVERIFIED_HINT =
  "L'outil n'a pas retrouvé mot pour mot la phrase de la marque sur ce point : relis sa réponse toi-même avant de le considérer comme accordé ou non.";

// Allure générale de la réponse.
//   accepted  : la marque accepte ce qui a été demandé ;
//   partial   : elle accepte une partie ;
//   counter   : elle propose d'autres termes ;
//   refused   : elle refuse en bloc ;
//   vague     : elle répond sans rien trancher ;
//   question  : elle pose une question à la créatrice.
export const OUTCOMES = ["accepted", "partial", "counter", "refused", "vague", "question"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  accepted: "La marque accepte",
  partial: "La marque accepte en partie",
  counter: "La marque propose d'autres termes",
  refused: "La marque refuse",
  vague: "La marque ne tranche pas",
  question: "La marque te pose une question",
};

// Le texte collé est-il une réponse à CETTE offre ? (B3)
export const RELEVANCE = ["reply", "other_offer", "unrelated", "unsure"] as const;


export const TIER_VALUES = ["starter", "confirmed", "experienced"] as const;


// Mission #095 — les points que la négociation doit refermer, avec leur statut
// et la CITATION EXACTE du message de la marque qui les renseigne. C'est la
// mémoire du fil : un point « répondu » ne peut plus être redemandé.
export const POINT_KEYS = [
  "territory",
  "formats",
  "content_duration",
  "revisions",
  "payment",
  "usage_duration",
  "exclusivity",
  "validation",
  "amount",
] as const;
export type PointKey = (typeof POINT_KEYS)[number];

// unknown : la marque n'en a rien dit. answered : elle l'a renseigné.
// refused : elle l'a renseigné en disant qu'elle ne bougerait pas.
export const POINT_STATUSES = ["unknown", "answered", "refused"] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

export const POINT_STATUS_LABEL: Record<PointStatus, string> = {
  unknown: "Inconnu",
  answered: "Répondu",
  refused: "Refusé",
};


export const TURN_SCHEMA_VERSION = "1";


// Tours suivants : 2 à 5. L'analyse d'origine est le tour 1.
export const FIRST_TURN = 2;
export const LAST_TURN = 5;
// Mission #099, point 3 (audit C2) — « ok » déclenchait un appel au modèle
// complet pour deux caractères. Une vraie réponse de marque, même brève, en
// fait plus de vingt : en dessous, c'est un accusé de réception, et la lecture
// est refusée AVANT tout appel.
export const MIN_REPLY_LENGTH = 20;
export const TOO_SHORT_REPLY_MESSAGE =
  "Colle le dernier message de la marque, en entier : l'outil a besoin de ses mots pour lire ce qu'elle accorde. Un « ok » ou un accusé de réception ne suffit pas.";
export const MAX_REPLY_LENGTH = 8000;

// B3 — texte qui n'est pas une réponse à cette offre : dit tel quel, rien
// d'inventé, rien d'enregistré.
export const OFF_TOPIC_MESSAGE = {
  other_offer: "Ce texte ressemble à une autre offre, pas à la réponse de la marque à celle-ci. Pour une nouvelle offre, lance une nouvelle analyse.",
  unrelated: "Ce texte ne ressemble pas à une réponse de la marque à cette offre. Colle le message que la marque t'a envoyé.",
  unsure: "L'outil n'est pas sûr que ce texte soit la réponse de la marque à cette offre, et préfère ne rien inventer. Colle son message tel qu'elle te l'a envoyé.",
} as const;

// Mission #080 ter — l'unité facturée est le deal : une analyse couvre une
// offre du premier message à la conclusion, ses tours compris. Les tours ne
// consomment ni crédit ni quota. Le suivi est ouvert à la personne connectée
// qui a lancé l'analyse, quelle que soit sa formule, gratuite comprise.
export type ThreadAccess = "open" | "signed_out";


export const TURN_FAILURE_MESSAGE = {
  timeout: "La lecture de la réponse a pris trop de temps et n'a pas abouti. Réessaie dans quelques minutes.",
  unavailable: "La lecture de la réponse est momentanément indisponible. Réessaie dans quelques minutes.",
} as const;
