import { z } from "zod";
import { analysisSchema } from "@/lib/schema";
// Mission #137 — les constantes et les libellés vivent désormais dans un
// module SANS dépendance, pour que l'écran puisse les lire sans embarquer
// zod. Ils sont réexportés ici : tous les appelants existants gardent leur
// import, et ce fichier reste la porte d'entrée côté serveur.
export * from "@/lib/negotiation/libelles";
import {
  ASK_STATUSES,
  OUTCOMES,
  POINT_KEYS,
  POINT_STATUSES,
  RELEVANCE,
  TERM_GROUPS,
  TIER_VALUES,
  TURN_SCHEMA_VERSION,
} from "@/lib/negotiation/libelles";

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
      // « partial » seulement : ce que la marque n'a pas couvert, en quelques
      // mots (« les supports de diffusion »). null sinon.
      remaining: z.string().nullable(),
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
  // Accordé en partie (mission #082) : ce qui reste à préciser.
  remaining: z.string().nullable().default(null),
  // Mission #083, A1 — le modèle a lu une réponse sur ce point, mais sa
  // citation a été écartée (introuvable mot pour mot, ou coupée de ce qui la
  // nie) : le tour où c'est arrivé. Ce n'est ni un accord ni une absence de
  // réponse : l'écran dit que ce n'est pas vérifiable. null : rien de tel.
  unverified_turn: z.number().nullable().default(null),
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
  // Mission #104, D — le montant que CE message porte. Même valeur que
  // closing.accept.offered : le point de vérité unique du montant proposé
  // (mission #096). null : c'est le montant retenu dans les termes. Écrit ici
  // pour que la carte partageable le LISE au lieu de le recalculer.
  offered: z.number().nullable().default(null),
});
export type Conclusion = z.infer<typeof conclusionSchema>;

export const pointSchema = z.object({
  key: z.enum(POINT_KEYS),
  status: z.enum(POINT_STATUSES),
  // Extrait du texte collé, découpé par le code : exact par construction.
  quote: z.string().nullable(),
  turn: z.number().nullable(),
  // Mission #098 — la marque a dit qu'elle ne bougerait plus sur ce point.
  // Ce n'est pas un refus de répondre : le point peut être « répondu » ET
  // fermé à la discussion (« jusqu'à 900 €, je ne reviendrai pas dessus »).
  firm: z.boolean().default(false),
  // Ce point a-t-il été demandé à la marque ? Un point jamais posé ne figure
  // pas dans ce qui reste à obtenir.
  asked: z.boolean().default(false),
  // Mission #100, point 1 — ce que la marque a bien renseigné, mais sans
  // détailler (« la procédure de validation n'est pas détaillée »). Ce n'est
  // pas une incertitude de LECTURE : l'outil a lu, et il lui reste une
  // réserve. Elle s'affiche sous la citation du point, jamais dans le bloc des
  // doutes, où elle se lisait comme une contradiction.
  reserves: z.array(z.string()).default([]),
  // Mission #099, point 6 (audit B17) — la marque est revenue sur ce point.
  // Ce qu'elle en disait AVANT, avec son tour : écrasé en silence, un
  // changement de position ne se voyait pas. null : elle n'a rien changé.
  previous: z
    .object({ status: z.enum(POINT_STATUSES), quote: z.string().nullable(), turn: z.number().nullable() })
    .nullable()
    .default(null),
});
export type PointState = z.infer<typeof pointSchema>;

// Mission #095, défaut 1 — où tombe le montant que la marque met sur la table,
// par rapport à la fourchette du moteur. Tout y est calculé par le code.
export const situationSchema = z.object({
  kind: z.enum(["below", "inside", "above"]),
  // « ceiling » : la marque annonce un plafond (« jusqu'à 900 € »), pas un
  // montant retenu dans les termes.
  source: z.enum(["firm", "ceiling"]),
  amount: z.number(),
  low: z.number(),
  high: z.number(),
  gap: z.number(),
  // La phrase telle qu'elle est écrite dans le message.
  sentence: z.string(),
});
export type Situation = z.infer<typeof situationSchema>;

// Mission #095, défaut 3 — l'état final proposé à la créatrice : le deal tel
// qu'il est, et les deux messages prêts à envoyer, avec ce que chacun implique.
export const closingSchema = z.object({
  recap: z.array(z.object({ label: z.string(), value: z.string() })),
  settled: z.array(z.object({ label: z.string(), value: z.string() })),
  accept: z.object({
    implies: z.string(),
    text: z.string(),
    // Mission #096 — le montant que porte l'acceptation quand il vient du
    // plafond annoncé par la marque, et non des termes retenus. null : c'est
    // le montant des termes.
    offered: z.number().nullable().default(null),
  }),
  hold: z.object({ implies: z.string(), text: z.string() }),
});
export type Closing = z.infer<typeof closingSchema>;

export const messageSchema = z.object({
  text: z.string(),
  tone: z.string(),
  // true : le brouillon du modèle a été écarté par les contrôles, remplacé par
  // un message simple écrit par le code. Les raisons sont affichées.
  fallback: z.boolean(),
  fallback_reasons: z.array(z.string()),
});
export type TurnMessage = z.infer<typeof messageSchema>;

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
  // Mission #085 — les termes ont changé, mais la table de l'analyse n'existe
  // plus dans le code : rien n'est chiffré (ni fourchette, ni contre-offre),
  // et l'écran le dit. Jamais la table actuelle à sa place.
  pricing_unavailable: z.boolean().default(false),
  brand_questions: z.array(z.object({ question: z.string(), quote: z.string() })),
  uncertainties: z.array(z.string()),
  message: messageSchema,
  // Mission #095 — mémoire des points, accumulée tour après tour. Défaut vide :
  // les tours enregistrés avant cette mission restent lisibles.
  points: z.array(pointSchema).default([]),
  // Le montant mis sur la table par la marque, situé dans la fourchette.
  situation: situationSchema.nullable().default(null),
  // Mission #096 — le plafond que la marque a annoncé, celui qui fait foi au
  // moment de ce tour : le plus RÉCENT, jamais le plus élevé. Il n'est pas un
  // terme convenu (règle #081) ; il sert à ne pas accepter moins que ce qui a
  // été proposé. null : aucun plafond en cours.
  stated_ceiling: z.number().nullable().default(null),
  // Questions du modèle supprimées parce qu'un point y était déjà répondu.
  dropped_questions: z.array(z.object({ point: z.enum(POINT_KEYS), sentence: z.string() })).default([]),
  // Tout est refermé et un montant est sur la table : plus de question, l'état
  // final et les deux messages. null : la négociation continue.
  closing: closingSchema.nullable().default(null),
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
