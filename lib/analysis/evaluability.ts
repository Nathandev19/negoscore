import type { Analysis } from "@/lib/schema";

// Évaluabilité d'une offre : peut-on lui donner un verdict ?
// Décidée uniquement à partir des champs extraits du deal, jamais d'un
// jugement du modèle. input_quality.missing_critical sert à afficher ce qui
// manque, il ne décide jamais de l'état.
//
//   complete       périmètre, prix et conditions connus → score et estimation habituels
//   terms_unknown  périmètre et prix connus, conditions inconnues
//                  → estimation comparée au montant proposé, aucun verdict
//   unpriced       périmètre connu, prix inconnu → estimation indicative, aucun verdict
//   incomplete     périmètre inconnu             → ni score ni estimation
//
// Le score ne pénalise que ce qui est écrit. Sans montant, il retombe vers 50,
// « Deal correct » : d'où « unpriced ». Sans conditions, aucune pénalité ne
// peut se déclencher et un prix aligné suffit à « Excellent deal » : d'où
// « terms_unknown ». Dans les deux cas, l'absence d'information serait lue
// comme une absence de risque.

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

// Conditions : ce qui fait qu'un même prix est un bon ou un mauvais échange.
// Un élément est connu quand l'offre l'écrit, y compris sans limite (usage à
// vie, révisions illimitées).
export const TERM_KEYS = ["duration", "territory", "payment_terms", "exclusivity", "ip_transfer", "revisions"] as const;
export type TermKey = (typeof TERM_KEYS)[number];

// Seuil choisi avant tout relevé : un seul élément ne suffit pas à juger un
// échange, les six seraient trop exigeants pour un DM ordinaire.
export const MIN_KNOWN_TERMS = 2;

function termKnown(deal: Deal, key: TermKey): boolean {
  switch (key) {
    case "duration":
      return deal.usage.duration_months !== null || deal.usage.perpetual;
    case "territory":
      return deal.usage.territory !== null;
    case "payment_terms":
      return deal.payment.terms_days !== null;
    case "exclusivity":
      return deal.exclusivity.present;
    case "ip_transfer":
      return deal.ip_transfer !== "none" && deal.ip_transfer !== "unclear";
    case "revisions":
      return deal.revisions.count !== null || deal.revisions.unlimited;
  }
}

export function knownTerms(deal: Deal): TermKey[] {
  return TERM_KEYS.filter((key) => termKnown(deal, key));
}

export function missingTermKeys(deal: Deal): TermKey[] {
  return TERM_KEYS.filter((key) => !termKnown(deal, key));
}

export function termsKnown(deal: Deal): boolean {
  return knownTerms(deal).length >= MIN_KNOWN_TERMS;
}

export function evaluability(deal: Deal): Evaluability {
  if (!scopeKnown(deal)) return "incomplete";
  if (!priceKnown(deal)) return "unpriced";
  return termsKnown(deal) ? "complete" : "terms_unknown";
}

// Manques déterministes du périmètre et du prix, dans l'ordre du deal.
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

const TERM_LABEL: Record<TermKey, string> = {
  duration: "La durée d'utilisation des contenus",
  territory: "Le territoire de diffusion",
  payment_terms: "Le délai de paiement",
  exclusivity: "L'existence ou non d'une exclusivité",
  ip_transfer: "Qui détient les droits sur les contenus : licence ou cession",
  revisions: "Le nombre de révisions prévues",
};

const TERM_HINT: Record<TermKey, RegExp> = {
  duration: /dur[ée]e|combien de temps|p[ée]riode/i,
  territory: /territoire|pays|zone|g[ée]ograph/i,
  payment_terms: /paiement|r[èe]glement|facturation/i,
  exclusivity: /exclusivit/i,
  ip_transfer: /propri[ée]t|cession|licence|droits? d'auteur/i,
  revisions: /r[ée]vision|retours?\b|modification/i,
};

// Liste affichée quand l'offre n'est pas évaluable : d'abord ce que le modèle a
// relevé, puis les manques déterministes qu'il n'a pas signalés. Conditions
// inconnues : les conditions ; sinon le périmètre et le prix.
export function missingInformation(analysis: Pick<Analysis, "deal" | "input_quality" | "evaluability">): string[] {
  const fromModel = analysis.input_quality.missing_critical.map((item) => item.trim()).filter(Boolean);
  const notFlagged = (hint: RegExp) => !fromModel.some((item) => hint.test(item));
  const added =
    analysis.evaluability === "terms_unknown"
      ? missingTermKeys(analysis.deal)
          .filter((key) => notFlagged(TERM_HINT[key]))
          .map((key) => TERM_LABEL[key])
      : missingKeys(analysis.deal)
          .filter((key) => notFlagged(MISSING_HINT[key]))
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

const TERM_REQUEST: Record<Analysis["language"], Record<TermKey, string>> = {
  fr: {
    duration: "la durée pendant laquelle les contenus seront utilisés",
    territory: "les pays ou la zone de diffusion",
    payment_terms: "le délai de paiement",
    exclusivity: "s'il y a une exclusivité, et sur quelle durée",
    ip_transfer: "si vous souhaitez une licence d'utilisation ou une cession des droits",
    revisions: "le nombre de révisions prévues",
  },
  en: {
    duration: "how long the content will be used",
    territory: "the countries or region where it will run",
    payment_terms: "the payment terms",
    exclusivity: "whether there is any exclusivity, and for how long",
    ip_transfer: "whether you need a usage licence or a transfer of rights",
    revisions: "the number of revision rounds",
  },
};

function requestMessage(language: Analysis["language"], items: string[], intro: { fr: string; en: string }): string {
  const lines = items.map((item) => `- ${item}`);
  if (language === "en") {
    return ["Hello,", "", intro.en, ...lines, "", "With these details, I will get back to you quickly.", "", "Best regards,"].join("\n");
  }
  return ["Bonjour,", "", intro.fr, ...lines, "", "Avec ces éléments, je vous réponds rapidement.", "", "Belle journée,"].join("\n");
}

// Message pour une offre incomplète : aucun tarif, seulement les questions
// nécessaires pour pouvoir chiffrer.
export function incompleteRequestMessage(deal: Deal, language: Analysis["language"]): string {
  return requestMessage(
    language,
    missingKeys(deal).map((key) => REQUEST_ITEM[language][key]),
    {
      fr: "Merci pour votre message, cette collaboration m'intéresse. Avant de vous faire une proposition, pourriez-vous me préciser :",
      en: "Thank you for your message, I would be happy to discuss this collaboration. Before I send you a proposal, could you tell me:",
    },
  );
}

// Message pour une offre aux conditions inconnues : aucun tarif, on demande
// les conditions avant de pouvoir s'engager.
export function termsRequestMessage(deal: Deal, language: Analysis["language"]): string {
  return requestMessage(
    language,
    missingTermKeys(deal).map((key) => TERM_REQUEST[language][key]),
    {
      fr: "Merci pour votre proposition, elle m'intéresse. Avant de confirmer, pourriez-vous me préciser les conditions de la collaboration :",
      en: "Thank you for your offer, I am interested. Before confirming, could you specify the terms of the collaboration:",
    },
  );
}
