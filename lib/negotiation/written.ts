import { clauseStart, normalizeForQuote, QUALIFIER } from "@/lib/negotiation/quotes";
import { TERM_GROUP_LABEL, type Deal, type TermGroup } from "@/lib/negotiation/types";

// Mission #080 quater, A2 et A3 — on n'enregistre que ce qui est ÉCRIT.
//
// La citation prouve que la marque parle d'un terme ; elle ne prouve pas la
// valeur que le modèle en a tirée. Deux fautes réelles du modèle, vues à
// l'essai du 19/09/2026 :
//   - « solde à 30 jours » ajouté à un échéancier que la marque n'a pas écrit ;
//   - « publiées sur notre compte » (le compte de la MARQUE) lu comme une
//     publication sur les comptes de la créatrice.
// Chaque valeur changée est donc confrontée aux textes où elle peut être
// écrite : la réponse de la marque, et les demandes de la créatrice que la
// marque vient d'accepter (accepter « exclusivité ramenée à 1 mois », c'est
// écrire 1 mois). Une valeur qui n'y figure pas revient à ce qu'elle était, et
// le doute est dit à la créatrice : « pas de réponse claire », jamais un terme.

// bound : la valeur n'apparaît que dans une phrase qui la nie, la borne ou la
// conditionne (mission #081, B) ; clause : cette phrase.
export type Unwritten = { group: TermGroup; value: string; reason: "not_written" | "brand_account" | "bound"; clause?: string };

const FR_NUMBERS: Record<number, string[]> = {
  1: ["un", "une"],
  2: ["deux"],
  3: ["trois"],
  4: ["quatre"],
  5: ["cinq"],
  6: ["six"],
  7: ["sept"],
  8: ["huit"],
  9: ["neuf"],
  10: ["dix"],
  11: ["onze"],
  12: ["douze"],
  15: ["quinze"],
  18: ["dix-huit"],
  20: ["vingt"],
  24: ["vingt-quatre"],
  30: ["trente"],
  36: ["trente-six"],
  45: ["quarante-cinq"],
  60: ["soixante"],
  90: ["quatre-vingt-dix"],
};
const EN_NUMBERS: Record<number, string[]> = {
  1: ["one"],
  2: ["two"],
  3: ["three"],
  4: ["four"],
  5: ["five"],
  6: ["six"],
  7: ["seven"],
  8: ["eight"],
  9: ["nine"],
  10: ["ten"],
  11: ["eleven"],
  12: ["twelve"],
  30: ["thirty"],
  60: ["sixty"],
  90: ["ninety"],
};

// Le nombre est-il écrit, en chiffres (« 1 500 », « 1500 », « 1.500 ») ou en
// toutes lettres ? unit « months » : une durée, qui doit être suivie de « mois »
// (« d'un mois », « 6 mois »), ou écrite en années (« un an » vaut 12).
export function numberWritten(value: number, sources: readonly string[], unit: "months" | "plain" = "plain"): boolean {
  const text = sources.map(normalizeForQuote).join(" \n ");
  const spellings = (n: number) => [
    String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "[\\s.,]?"),
    ...(FR_NUMBERS[n] ?? []),
    ...(EN_NUMBERS[n] ?? []),
  ];
  const found = (n: number, after: string) =>
    spellings(n).some((spelling) => new RegExp(`(^|[^\\p{L}\\d])(d')?${spelling}${after}`, "u").test(text));
  if (unit === "plain") return found(value, "([^\\p{L}\\d]|$)");
  if (found(value, "\\s*(mois|months?)([^\\p{L}]|$)")) return true;
  return value % 12 === 0 && found(value / 12, "\\s+(an|ans|année|années|years?)([^\\p{L}]|$)");
}

// Mission #081, B — un nombre écrit dans une phrase qui le nie, le restreint,
// le conditionne ou le borne n'est pas une valeur : « on ne peut pas
// s'engager sur un délai inférieur à 45 jours » ne veut pas dire « 45 jours ».
// Une valeur est retenue si elle est écrite dans une demande que la marque
// accepte, ou si elle apparaît dans sa réponse au moins une fois hors d'une
// telle phrase. Sinon, clause : la phrase qui la borne, à montrer. Jamais la
// lecture la plus favorable à la marque : dans le doute, le terme ne bouge pas.
export type NumberCheck = { ok: true } | { ok: false; clause: string | null };

function numberPositions(value: number, text: string, unit: "months" | "plain"): number[] {
  const spellings = (n: number) => [
    String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "[\\s.,]?"),
    ...(FR_NUMBERS[n] ?? []),
    ...(EN_NUMBERS[n] ?? []),
  ];
  const positions = (n: number, after: string) =>
    spellings(n).flatMap((spelling) =>
      [...text.matchAll(new RegExp(`(^|[^\\p{L}\\d])((?:d')?${spelling}${after})`, "gu"))].map((m) => (m.index ?? 0) + m[1].length),
    );
  if (unit === "plain") return positions(value, "(?=[^\\p{L}\\d]|$)");
  const found = positions(value, "\\s*(?:mois|months?)(?=[^\\p{L}]|$)");
  return found.length > 0 || value % 12 !== 0 ? found : positions(value / 12, "\\s+(?:an|ans|année|années|years?)(?=[^\\p{L}]|$)");
}

export function numberCheck(
  value: number,
  texts: { brandReply: string; accepted: readonly string[] },
  unit: "months" | "plain" = "plain",
): NumberCheck {
  if (numberWritten(value, texts.accepted, unit)) return { ok: true };
  const text = normalizeForQuote(texts.brandReply);
  const at = numberPositions(value, text, unit);
  if (at.length === 0) return { ok: false, clause: null };
  if (at.some((position) => !QUALIFIER.test(text.slice(clauseStart(text, position), position)))) return { ok: true };
  const first = at[0];
  const end = text.slice(first).search(/[.!?;\n]/);
  return { ok: false, clause: text.slice(clauseStart(text, first), end < 0 ? undefined : first + end).trim() };
}

// Un texte (échéancier, territoire, catégorie) est-il écrit tel quel ? Chaque
// morceau séparé par une virgule doit l'être : « 50 % à la signature, solde à
// 30 jours » échoue si « solde à 30 jours » n'est écrit nulle part.
export function textWritten(value: string, sources: readonly string[]): boolean {
  const text = sources.map(normalizeForQuote).join(" \n ");
  return value
    .split(/[,;]| et /)
    .map((part) => normalizeForQuote(part).replace(/^[.\s]+|[.\s]+$/g, ""))
    .filter((part) => part.length > 0)
    .every((part) => text.includes(part));
}

// A2 — « notre compte », « nos réseaux » : la marque parle des SIENS. Une
// publication sur les comptes de la créatrice se dit à la deuxième personne.
const CREATOR_ACCOUNT = /\b(votre|vos|ton|tes)\s+(propres?\s+)?(compte|comptes|profil|profils|page|pages|cha[iî]ne|cha[iî]nes|feed|r[ée]seaux|story|stories|instagram|tiktok|youtube)\b|\bchez (vous|toi)\b|\byour (own )?(account|accounts|profile|page|channel|feed)\b/i;

const PERPETUAL = /sans limit|illimit|perp[ée]tu|[àa] vie|d[ée]finiti|sans fin|in perpetuity|forever|unlimited/i;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Revient sur chaque valeur changée qui n'est pas écrite. quotes : l'extrait
// cité pour chaque groupe (sert à la règle « notre compte »).
export function keepWritten(
  before: Deal,
  candidate: Deal,
  groups: readonly TermGroup[],
  texts: { brandReply: string; accepted: readonly string[] },
  quotes: Partial<Record<TermGroup, string>>,
): { deal: Deal; unwritten: Unwritten[] } {
  const deal: Deal = structuredClone(candidate);
  const unwritten: Unwritten[] = [];
  const sources = [texts.brandReply, ...texts.accepted];
  // Dernière phrase bornante rencontrée par num() : un refus de valeur qui en
  // vient est dit comme une borne, pas comme une valeur absente.
  let bound: string | null = null;
  const num = (value: number, unit: "months" | "plain" = "plain") => {
    const check = numberCheck(value, texts, unit);
    bound = check.ok ? null : check.clause;
    return check.ok;
  };
  const reject = (group: TermGroup, value: string, reason: Unwritten["reason"] = "not_written") => {
    if (reason === "not_written" && bound) unwritten.push({ group, value, reason: "bound", clause: bound });
    else unwritten.push({ group, value, reason });
    bound = null;
  };

  for (const group of groups) {
    switch (group) {
      case "deliverables": {
        const unsupported = deal.deliverables.some((d, index) => {
          const was = before.deliverables[index];
          if (was && sameValue(was, d)) return false;
          const quantityOk = d.quantity === null || (was && was.quantity === d.quantity) || num(d.quantity);
          const formatOk = d.format === null || (was && was.format === d.format) || textWritten(d.format, sources);
          return !quantityOk || !formatOk;
        });
        if (unsupported) {
          reject(group, deal.deliverables.map((d) => `${d.quantity ?? "?"} ${d.type}${d.format ? ` (${d.format})` : ""}`).join(", "));
          deal.deliverables = before.deliverables;
        }
        break;
      }
      case "amount": {
        const now = deal.payment.amount_eur;
        const was = before.payment.amount_eur;
        // Un montant écrit ne s'efface pas parce que le modèle ne sait pas le
        // représenter (fourchette acceptée, par exemple).
        if (now === null ? was !== null : now !== was && !num(now)) {
          reject(group, now === null ? "aucun montant" : `${now} €`);
          deal.payment = { ...deal.payment, amount_eur: was, currency: before.payment.currency };
        }
        break;
      }
      case "in_kind": {
        const now = deal.in_kind_value_eur;
        const was = before.in_kind_value_eur;
        if (now === null ? was !== null : now !== was && !num(now)) {
          reject(group, now === null ? "aucune valeur" : `${now} €`);
          deal.in_kind_value_eur = was;
        }
        break;
      }
      case "usage_duration": {
        const { duration_months: months, perpetual } = deal.usage;
        const monthsOk = months === null || months === before.usage.duration_months || num(months, "months");
        const perpetualOk = !perpetual || before.usage.perpetual || sources.some((source) => PERPETUAL.test(source));
        if (!monthsOk || !perpetualOk) {
          reject(group, perpetual ? "sans limite de durée" : `${months} mois`);
          deal.usage = { ...deal.usage, duration_months: before.usage.duration_months, perpetual: before.usage.perpetual };
        }
        break;
      }
      case "territory": {
        const now = deal.usage.territory;
        if (now !== null && now !== before.usage.territory && !textWritten(now, sources)) {
          reject(group, now);
          deal.usage = { ...deal.usage, territory: before.usage.territory };
        }
        break;
      }
      case "exclusivity": {
        const { duration_months: months, category } = deal.exclusivity;
        const monthsOk = months === null || months === before.exclusivity.duration_months || num(months, "months");
        const categoryOk = category === null || category === before.exclusivity.category || textWritten(category, sources);
        if (!monthsOk) {
          reject(group, `${months} mois`);
          deal.exclusivity = { ...deal.exclusivity, duration_months: before.exclusivity.duration_months };
        }
        if (!categoryOk) {
          reject(group, category as string);
          deal.exclusivity = { ...deal.exclusivity, category: before.exclusivity.category };
        }
        break;
      }
      case "payment_terms": {
        const { terms_days: days, schedule } = deal.payment;
        if (days !== null && days !== before.payment.terms_days && !num(days)) {
          reject(group, `${days} jours`);
          deal.payment = { ...deal.payment, terms_days: before.payment.terms_days };
        }
        if (schedule !== null && schedule !== before.payment.schedule && !textWritten(schedule, sources)) {
          reject(group, schedule);
          deal.payment = { ...deal.payment, schedule: before.payment.schedule };
        }
        break;
      }
      case "publication": {
        if (deal.publication_required && !before.publication_required && !CREATOR_ACCOUNT.test(quotes.publication ?? "")) {
          reject(group, "publication sur tes comptes", "brand_account");
          deal.publication_required = before.publication_required;
        }
        break;
      }
      case "usage_rights":
        // Des droits accordés ou retirés : c'est la citation qui le prouve,
        // aucune valeur chiffrée ou textuelle à retrouver.
        break;
    }
  }
  return { deal, unwritten };
}

// Mission #080 quinquies, C — un terme changé, preuve à l'appui, va-t-il
// exactement dans le sens d'une demande ? Oui quand la demande parle de ce
// terme ET que chaque nouvelle valeur y est écrite (« Paiement à 30 jours, 50 %
// à la signature » et un paiement passé à 30 jours, 50 % à la signature). Ce
// n'est pas un accord de la marque : seulement un constat sur les termes.
const TOPIC: Partial<Record<TermGroup, RegExp>> = {
  payment_terms: /paiement|payer|pay[ée]|acompte|signature|jours/i,
  exclusivity: /exclusivit/i,
  usage_duration: /droit|pub|usage|utilisation|diffusion/i,
  territory: /territoire|pays|monde|europe|france|zone|diffusion/i,
  in_kind: /produit|dotation|nature/i,
};

export function changeFollowsAsk(group: TermGroup, deal: Deal, label: string): boolean {
  const topic = TOPIC[group];
  if (!topic || !topic.test(label)) return false;
  const sources = [label];
  switch (group) {
    case "payment_terms": {
      const { terms_days: days, schedule } = deal.payment;
      if (days === null && schedule === null) return false;
      return (days === null || numberWritten(days, sources)) && (schedule === null || textWritten(schedule, sources));
    }
    case "exclusivity":
      if (!deal.exclusivity.present) return /supprim|retir|sans exclusivit|pas d'exclusivit|aucune exclusivit/i.test(label);
      return deal.exclusivity.duration_months !== null && numberWritten(deal.exclusivity.duration_months, sources, "months");
    case "usage_duration":
      return deal.usage.duration_months !== null && numberWritten(deal.usage.duration_months, sources, "months");
    case "territory":
      return deal.usage.territory !== null && textWritten(deal.usage.territory, sources);
    case "in_kind":
      return deal.in_kind_value_eur !== null && numberWritten(deal.in_kind_value_eur, sources);
    default:
      return false;
  }
}

// Mission #082, C — demande de LIMITER un terme (« limiter l'utilisation
// publicitaire… », « réduire l'exclusivité ») et changement prouvé qui le
// resserre (durée plus courte, territoire désormais défini, droits retirés) :
// la marque va dans le sens demandé. Le code ne laisse pas cela s'afficher en
// « contre-proposé » ; il n'en fait jamais un accord entier pour autant.
const LIMITING = /(limit|r[ée]dui|r[ée]duct|restrein|restrict|encadr|plafonn|born)/i;
const RESTRICT_TOPIC: Partial<Record<TermGroup, RegExp>> = {
  usage_duration: /droit|pub|usage|utilisation|diffusion/i,
  territory: /droit|pub|usage|utilisation|diffusion|territoire|pays|zone/i,
  usage_rights: /droit|pub|usage|utilisation|diffusion|support/i,
  exclusivity: /exclusivit/i,
};

export function changeRestrictsAsk(group: TermGroup, before: Deal, after: Deal, label: string): boolean {
  const topic = RESTRICT_TOPIC[group];
  if (!topic || !topic.test(label) || !LIMITING.test(label)) return false;
  switch (group) {
    case "usage_duration": {
      if (before.usage.perpetual && !after.usage.perpetual) return true;
      const was = before.usage.duration_months;
      const now = after.usage.duration_months;
      return was !== null && now !== null && now < was;
    }
    case "territory":
      return before.usage.territory === null && after.usage.territory !== null;
    case "usage_rights":
      return (["organic", "paid_ads", "whitelisting", "spark_ads"] as const).some((right) => before.usage[right] && !after.usage[right]);
    case "exclusivity": {
      if (before.exclusivity.present && !after.exclusivity.present) return true;
      const was = before.exclusivity.duration_months;
      const now = after.exclusivity.duration_months;
      return was !== null && now !== null && now < was;
    }
    default:
      return false;
  }
}

// Ce que l'écran dit d'une valeur écartée : à la créatrice, en « tu ».
export function unwrittenDoubt(item: Unwritten): string {
  const label = TERM_GROUP_LABEL[item.group];
  if (item.reason === "bound") {
    return `« ${label} » : la marque écrit « ${item.clause} ». C'est une limite ou une condition, pas une valeur convenue : le terme n'a pas été modifié.`;
  }
  if (item.reason === "brand_account") {
    return "La marque parle de publier sur son propre compte, pas sur les tiens : la publication sur tes comptes n'a pas été retenue.";
  }
  return `« ${label} » : l'outil a cru lire « ${item.value} », mais ce n'est pas écrit dans la réponse de la marque. Ce n'est pas retenu : fais-le-lui préciser.`;
}
