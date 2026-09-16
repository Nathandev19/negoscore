import type { Analysis } from "@/lib/schema";

// Évaluabilité d'une offre : peut-on lui donner un verdict ?
// Décidée uniquement à partir des champs extraits du deal, jamais d'un
// jugement du modèle. input_quality.missing_critical sert à afficher ce qui
// manque, il ne décide jamais de l'état.
//
//   complete    périmètre connu, prix connu   → score et estimation habituels
//   unpriced    périmètre connu, prix inconnu → estimation indicative, aucun verdict
//   incomplete  périmètre inconnu             → ni score ni estimation
//
// Sans montant, le score perd son seul levier positif (le ratio prix /
// estimation) et retombe vers 50, « Deal correct » : d'où l'état « unpriced »,
// distinct d'un « complete » dégradé.

type Deal = Analysis["deal"];
export type Evaluability = Analysis["evaluability"];

// Périmètre connu : on sait ce qui est livré et ce que la marque en fera.
export function scopeKnown(deal: Deal): boolean {
  const { usage } = deal;
  return (
    deal.deliverables.length > 0 &&
    (usage.organic || usage.paid_ads || usage.whitelisting || usage.spark_ads || usage.perpetual)
  );
}

// Prix connu : un montant ou une valeur de produits offerts est écrit.
export function priceKnown(deal: Deal): boolean {
  return deal.payment.amount_eur !== null || deal.in_kind_value_eur !== null;
}

export function evaluability(deal: Deal): Evaluability {
  if (!scopeKnown(deal)) return "incomplete";
  return priceKnown(deal) ? "complete" : "unpriced";
}

// Manques déterministes, dans l'ordre du deal.
export type MissingKey = "deliverables" | "usage" | "price";

export function missingKeys(deal: Deal): MissingKey[] {
  const { usage } = deal;
  const keys: MissingKey[] = [];
  if (deal.deliverables.length === 0) keys.push("deliverables");
  if (!(usage.organic || usage.paid_ads || usage.whitelisting || usage.spark_ads || usage.perpetual)) keys.push("usage");
  if (!priceKnown(deal)) keys.push("price");
  return keys;
}

const MISSING_LABEL: Record<MissingKey, string> = {
  deliverables: "Les contenus attendus : combien, de quel type, sur quelles plateformes",
  usage: "Les droits d'utilisation : ce que la marque fera des contenus et pendant combien de temps",
  price: "La rémunération proposée",
};

// Mots qui indiquent que le modèle a déjà signalé ce manque, pour ne pas le
// répéter avec d'autres mots. Sert uniquement à l'affichage de la liste.
const MISSING_HINT: Record<MissingKey, RegExp> = {
  deliverables: /livrable|contenu|vid[ée]o|photo|story|stories|format|nombre de/i,
  usage: /droit|usage|utilisation|diffusion|licence|pub/i,
  price: /r[ée]mun[ée]ration|budget|prix|montant|tarif|paiement|cachet|€/i,
};

// Liste affichée quand l'offre est incomplète : d'abord ce que le modèle a
// relevé, puis les manques déterministes qu'il n'a pas signalés.
export function missingInformation(analysis: Pick<Analysis, "deal" | "input_quality">): string[] {
  const fromModel = analysis.input_quality.missing_critical.map((item) => item.trim()).filter(Boolean);
  const added = missingKeys(analysis.deal)
    .filter((key) => !fromModel.some((item) => MISSING_HINT[key].test(item)))
    .map((key) => MISSING_LABEL[key]);
  return [...fromModel, ...added];
}

const REQUEST_ITEM: Record<Analysis["language"], Record<MissingKey, string>> = {
  fr: {
    deliverables: "les contenus attendus (nombre, format et plateformes)",
    usage: "l'utilisation prévue des contenus (publication, publicité, durée)",
    price: "le budget prévu pour cette collaboration",
  },
  en: {
    deliverables: "the expected content (number, format and platforms)",
    usage: "how the content will be used (posting, paid ads, duration)",
    price: "the budget planned for this collaboration",
  },
};

// Message pour une offre incomplète : aucun tarif, seulement les questions
// nécessaires pour pouvoir chiffrer.
export function incompleteRequestMessage(deal: Deal, language: Analysis["language"]): string {
  const items = missingKeys(deal).map((key) => `- ${REQUEST_ITEM[language][key]}`);
  if (language === "en") {
    return [
      "Hello,",
      "",
      "Thank you for your message, I would be happy to discuss this collaboration. Before I send you a proposal, could you tell me:",
      ...items,
      "",
      "With these details, I will get back to you quickly.",
      "",
      "Best regards,",
    ].join("\n");
  }
  return [
    "Bonjour,",
    "",
    "Merci pour votre message, cette collaboration m'intéresse. Avant de vous faire une proposition, pourriez-vous me préciser :",
    ...items,
    "",
    "Avec ces éléments, je vous réponds rapidement.",
    "",
    "Belle journée,",
  ].join("\n");
}
