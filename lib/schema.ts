import { z } from "zod";

export const analysisSchema = z.object({
  schema_version: z.string(),
  // Ajouté en 1.1 (voir lib/analysis/evaluability.ts), « terms_unknown » en 1.2.
  // Une analyse 1.0 n'a pas ce champ : elle a été produite quand toute offre
  // recevait un score, elle est donc relue comme « complete » et s'affiche
  // comme avant. Une analyse 1.1 garde l'état sous lequel elle a été produite.
  evaluability: z.enum(["complete", "terms_unknown", "unpriced", "incomplete"]).default("complete"),
  // Niveau avec lequel la fourchette a été calculée (mission #039, schéma 1.4).
  // Une analyse antérieure n'a pas ce champ : elle a été calculée au niveau
  // « confirmed », le seul utilisé jusque-là. Valeur écrite en dur, et non le
  // niveau par défaut de la table, pour que l'historique ne change pas si ce
  // défaut change un jour.
  // Même liste que TIERS (lib/rates/tier.ts, vérifié par tests/tier.test.ts) :
  // écrite ici sans alias, ce fichier est aussi exécuté tel quel par Node (pnpm eval).
  profile_tier: z.enum(["starter", "confirmed", "experienced"]).default("confirmed"),
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
      // Mission #160 — LES ZONES DEMANDÉES, extraites par le modèle, chiffrées
      // par le code. `territory` reste le texte tel qu'écrit (il s'affiche dans
      // « Le deal proposé ») ; ce champ-ci est la donnée.
      //
      // Un tableau de chaînes, pas une énumération : une valeur inconnue doit
      // être ÉCARTÉE, jamais faire échouer la lecture d'une analyse. La liste
      // fermée vit dans la table de tarifs (territory_zones), le tri est fait
      // par lib/rates/zones.ts, et une analyse enregistrée avant ce champ le
      // lit comme un tableau vide — donc exactement le chiffrage d'avant.
      //
      // OPTIONNEL à l'entrée, comme variable_pay plus bas et pour la même
      // raison : une analyse enregistrée avant ce champ doit se relire sans
      // erreur. Après normalizeDeal il existe toujours, trié par la liste
      // fermée — tout ce qui lit un deal normalisé peut s'y fier.
      territory_zones: z.array(z.string()).max(20).optional(),
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
    // Mission #116 — RÉMUNÉRATION VARIABLE : commission sur les ventes, code
    // promo, lien d'affiliation, partenariat au chiffre d'affaires.
    //
    // Elle n'est JAMAIS chiffrée en euros : lui donner une valeur demanderait
    // le prix du produit, un taux de conversion et la taille de l'audience —
    // trois choses que le produit n'a pas. Ce champ ne sert qu'à LIRE ce que
    // l'offre écrit, et à en déduire ce qu'il faut obtenir par écrit.
    //
    // Tous les champs ont une valeur par défaut : une analyse enregistrée avant
    // cette mission se relit sans erreur, avec « aucune commission ».
    variable_pay: z
      .object({
        present: z.boolean().default(false),
        // Taux en pourcentage, tel qu'il est écrit (15 pour « 15 % »).
        rate_percent: z.number().nullable().default(null),
        // Assiette : sur quoi porte le pourcentage (« prix de vente HT »,
        // « panier »). null : l'offre ne le dit pas, et c'est un point à obtenir.
        base: z.string().nullable().default(null),
        // Commission fixe par vente, quand l'offre en annonce une.
        per_sale_eur: z.number().nullable().default(null),
        // Durée d'attribution du code ou du lien, en jours.
        attribution_days: z.number().nullable().default(null),
        // Modalités de versement, telles qu'écrites (fréquence, seuil).
        payout: z.string().nullable().default(null),
      })
      .default({ present: false, rate_percent: null, base: null, per_sale_eur: null, attribution_days: null, payout: null }),
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
      // Sujet du point (1.4) : permet de recalculer l'impact en euros quand le
      // niveau change. Absent des analyses antérieures (retrouvé par recoupement).
      topic: z.string().optional(),
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
