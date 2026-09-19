import { z } from "zod";
import { analysisSchema } from "@/lib/schema";

// Mission #080 — la négociation après le premier message.
//
// Deux schémas distincts :
//   - turnReadingSchema : ce que le MODÈLE a le droit de produire. Une lecture
//     de la réponse de la marque, avec une citation exacte pour chaque point
//     affirmé, et un brouillon de message SANS aucun montant ;
//   - turnPayloadSchema : ce que le CODE enregistre après vérification. Les
//     citations y ont été confrontées au texte collé, les termes du deal mis à
//     jour groupe par groupe, et tout chiffre vient du moteur de tarifs.
// Module sans dépendance serveur : il est aussi importé par la page.

export const dealSchema = analysisSchema.shape.deal;
export type Deal = z.infer<typeof dealSchema>;

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
export const ASK_STATUSES = ["granted", "refused", "countered", "unanswered"] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

export const ASK_STATUS_LABEL: Record<AskStatus, string> = {
  granted: "Accordé",
  refused: "Refusé",
  countered: "Contre-proposé",
  unanswered: "Toujours sans réponse",
};

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

// ─── Sortie du modèle ────────────────────────────────────────────────────────

export const turnReadingSchema = z.object({
  relevance: z.enum(RELEVANCE),
  // Phrase courte : pourquoi ce n'est pas une réponse, quand ce n'en est pas une.
  relevance_note: z.string(),
  outcome: z.enum(OUTCOMES),
  // Mission #080 quater, A7 — accord global sans détail (« c'est d'accord pour
  // tout ») : l'extrait qui le dit, une seule fois. null s'il n'y en a pas.
  global_agreement: z.string().nullable(),
  asks: z.array(
    z.object({
      id: z.string(),
      status: z.enum(ASK_STATUSES),
      // Extrait mot pour mot de la réponse de la marque : le plus court passage
      // qui dit CE point. null si « unanswered », ou si le point n'est accordé
      // que par l'accord global.
      quote: z.string().nullable(),
    }),
  ),
  // Groupes de termes que la marque change dans CETTE réponse, avec l'extrait
  // qui le dit. Les nouvelles valeurs sont lues dans « deal ».
  changes: z.array(z.object({ group: z.enum(TERM_GROUPS), quote: z.string() })),
  // Le deal tel que le modèle le comprend après cette réponse. Seuls les groupes
  // listés dans « changes » ET cités exactement en sont repris par le code.
  deal: dealSchema,
  brand_questions: z.array(z.object({ question: z.string(), quote: z.string() })),
  // Ce que le modèle n'est pas sûr d'avoir compris (F7), en phrases courtes.
  uncertainties: z.array(z.string()),
  // Brouillon du message suivant : aucun montant, aucune date. La contre-offre
  // est insérée par le code à la place de {{CONTRE_OFFRE}}.
  next_message: z.object({ text: z.string(), tone: z.string() }),
});
export type TurnReading = z.infer<typeof turnReadingSchema>;

// ─── Ce qui est enregistré ───────────────────────────────────────────────────

export const TIER_VALUES = ["starter", "confirmed", "experienced"] as const;

// Chiffrage d'un état du deal : UNIQUEMENT des sorties du moteur de tarifs.
export const pricingSchema = z.object({
  total_low: z.number().nullable(),
  total_high: z.number().nullable(),
  counter_low: z.number().nullable(),
  counter_high: z.number().nullable(),
  rate_table_version: z.string(),
  tier: z.enum(TIER_VALUES),
});
export type Pricing = z.infer<typeof pricingSchema>;

export const askSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(ASK_STATUSES),
  quote: z.string().nullable(),
  // Tour où ce statut a été constaté. null : jamais répondu.
  turn: z.number().nullable(),
  // Accordé par un accord global, sans que la marque détaille ce point.
  global: z.boolean().default(false),
  // Mission #080 quinquies, C — demande restée sans réponse explicite, mais un
  // terme a changé, preuve à l'appui, exactement dans son sens : le groupe de
  // termes et le tour. null : rien de tel. Ce n'est PAS un accord.
  aligned_group: z.enum(TERM_GROUPS).nullable().default(null),
  aligned_turn: z.number().nullable().default(null),
});
export type Ask = z.infer<typeof askSchema>;

export const termChangeSchema = z.object({
  group: z.enum(TERM_GROUPS),
  before: z.string(),
  after: z.string(),
  quote: z.string(),
});
export type TermChange = z.infer<typeof termChangeSchema>;

export const conclusionSchema = z.object({
  // brand_accepted : la marque a accepté dans un tour. creator_accepted : la
  // personne a décidé d'accepter les termes en l'état.
  source: z.enum(["brand_accepted", "creator_accepted"]),
  recap: z.array(z.object({ label: z.string(), value: z.string() })),
  unclear: z.array(z.string()),
  message: z.string(),
  legal_note: z.string(),
});
export type Conclusion = z.infer<typeof conclusionSchema>;

export const messageSchema = z.object({
  text: z.string(),
  tone: z.string(),
  // true : le brouillon du modèle a été écarté par les contrôles, remplacé par
  // un message simple écrit par le code. Les raisons sont affichées.
  fallback: z.boolean(),
  fallback_reasons: z.array(z.string()),
});
export type TurnMessage = z.infer<typeof messageSchema>;

export const TURN_SCHEMA_VERSION = "1";

export const turnPayloadSchema = z.object({
  schema_version: z.literal(TURN_SCHEMA_VERSION),
  tier: z.enum(TIER_VALUES),
  outcome: z.enum(OUTCOMES),
  asks: z.array(askSchema),
  changes: z.array(termChangeSchema),
  // Changements lus par le modèle mais NON retenus : aucune citation exacte.
  ignored_changes: z.array(z.object({ group: z.enum(TERM_GROUPS), quote: z.string() })),
  // Le deal avant et après ce tour. deal_after est la lecture du tour, telle
  // qu'affichée ; une correction de lecture (mission ultérieure) la
  // remplacerait et referait le chiffrage par le code, sans nouvel appel.
  deal_before: dealSchema,
  deal_after: dealSchema,
  // Au moins un terme a changé depuis l'analyse d'origine (ce tour ou avant).
  changed_since_origin: z.boolean(),
  pricing_before: pricingSchema,
  // null : aucun terme n'a changé dans ce tour, la fourchette ne bouge pas.
  pricing_after: pricingSchema.nullable(),
  brand_questions: z.array(z.object({ question: z.string(), quote: z.string() })),
  uncertainties: z.array(z.string()),
  message: messageSchema,
  conclusion: conclusionSchema.nullable(),
});
export type TurnPayload = z.infer<typeof turnPayloadSchema>;

export const conclusionPayloadSchema = z.object({
  schema_version: z.literal(TURN_SCHEMA_VERSION),
  tier: z.enum(TIER_VALUES),
  deal: dealSchema,
  conclusion: conclusionSchema,
});
export type ConclusionPayload = z.infer<typeof conclusionPayloadSchema>;

// Tours suivants : 2 à 5. L'analyse d'origine est le tour 1.
export const FIRST_TURN = 2;
export const LAST_TURN = 5;
export const MIN_REPLY_LENGTH = 2;
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
