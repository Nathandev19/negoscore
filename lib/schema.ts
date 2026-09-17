import { z } from "zod";

export const analysisSchema = z.object({
  schema_version: z.string(),
  // Ajouté en 1.1 (voir lib/analysis/evaluability.ts), « terms_unknown » en 1.2.
  // Une analyse 1.0 n'a pas ce champ : elle a été produite quand toute offre
  // recevait un score, elle est donc relue comme « complete » et s'affiche
  // comme avant. Une analyse 1.1 garde l'état sous lequel elle a été produite.
  evaluability: z.enum(["complete", "terms_unknown", "unpriced", "incomplete"]).default("complete"),
  language: z.enum(["fr", "en"]),
  confidence: z.enum(["high", "medium", "low"]),
  input_quality: z.object({
    readable: z.boolean(),
    missing_critical: z.array(z.string()),
  }),
  deal: z.object({
    brand: z.string().nullable(),
    deliverables: z.array(
      z.object({
        type: z.enum(["video", "photo", "story", "live"]),
        platform: z.enum(["tiktok", "instagram", "youtube", "other"]).nullable(),
        // null : la marque ne dit pas combien elle en veut (« quelques vidéos »).
        // C'est une information manquante, pas une erreur : le moteur suppose un
        // contenu et l'écrit dans ses hypothèses. Ajouté en 1.3 ; une analyse
        // antérieure a toujours un nombre.
        quantity: z.number().nullable(),
        format: z.string().nullable(),
      }),
    ),
    publication_required: z.boolean(),
    usage: z.object({
      organic: z.boolean(),
      paid_ads: z.boolean(),
      whitelisting: z.boolean(),
      spark_ads: z.boolean(),
      duration_months: z.number().nullable(),
      territory: z.string().nullable(),
      perpetual: z.boolean(),
    }),
    exclusivity: z.object({
      present: z.boolean(),
      duration_months: z.number().nullable(),
      category: z.string().nullable(),
    }),
    raw_footage: z.boolean(),
    ip_transfer: z.enum(["none", "license", "full_assignment", "unclear"]),
    ai_training_rights: z.enum(["absent", "present", "unclear"]),
    revisions: z.object({
      count: z.number().nullable(),
      unlimited: z.boolean(),
    }),
    payment: z.object({
      amount_eur: z.number().nullable(),
      currency: z.string(),
      terms_days: z.number().nullable(),
      schedule: z.string().nullable(),
    }),
    in_kind_value_eur: z.number().nullable(),
    deadlines: z.array(z.string()),
    kill_fee: z.string().nullable(),
    termination: z.string().nullable(),
    governing_law: z.string().nullable(),
  }),
  // null quand l'offre n'est pas évaluable (« unpriced » ou « incomplete ») :
  // aucun verdict de qualité plutôt qu'un score par défaut.
  score: z
    .object({
      value: z.number(),
      band: z.enum(["bad", "weak", "fair", "good", "excellent"]),
    })
    .nullable(),
  good_points: z.array(z.object({ label: z.string(), why: z.string() })),
  negotiate: z.array(
    z.object({
      label: z.string(),
      why: z.string(),
      eur_impact_low: z.number().nullable(),
      eur_impact_high: z.number().nullable(),
      priority: z.number(),
    }),
  ),
  red_flags: z.array(
    z.object({
      label: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      why: z.string(),
    }),
  ),
  estimate: z.object({
    base_low: z.number().nullable(),
    base_high: z.number().nullable(),
    lines: z.array(
      z.object({
        label: z.string(),
        type: z.enum(["percent", "flat"]),
        low: z.number(),
        high: z.number(),
        eur_low: z.number(),
        eur_high: z.number(),
      }),
    ),
    total_low: z.number().nullable(),
    total_high: z.number().nullable(),
    assumptions: z.array(z.string()),
    rate_table_version: z.string(),
  }),
  fr_legal: z.object({
    applicable: z.boolean(),
    threshold_1000_reached: z.enum(["yes", "no", "unknown"]),
    written_contract_required: z.boolean(),
    missing_mandatory_clauses: z.array(z.string()),
    note: z.string(),
  }),
  escalate_to_professional: z.object({
    required: z.boolean(),
    reasons: z.array(z.string()),
  }),
  counter_offer: z.object({
    amount_low: z.number().nullable(),
    amount_high: z.number().nullable(),
    changes: z.array(z.string()),
  }),
  ready_to_send_message: z.object({
    tone: z.string(),
    text: z.string(),
  }),
});

export type Analysis = z.infer<typeof analysisSchema>;
