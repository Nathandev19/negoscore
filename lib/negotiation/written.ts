import { normalizeForQuote } from "@/lib/negotiation/quotes";
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

export type Unwritten = { group: TermGroup; value: string; reason: "not_written" | "brand_account" };

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
  sources: readonly string[],
  quotes: Partial<Record<TermGroup, string>>,
): { deal: Deal; unwritten: Unwritten[] } {
  const deal: Deal = structuredClone(candidate);
  const unwritten: Unwritten[] = [];
  const reject = (group: TermGroup, value: string, reason: Unwritten["reason"] = "not_written") => unwritten.push({ group, value, reason });

  for (const group of groups) {
    switch (group) {
      case "deliverables": {
        const unsupported = deal.deliverables.some((d, index) => {
          const was = before.deliverables[index];
          if (was && sameValue(was, d)) return false;
          const quantityOk = d.quantity === null || (was && was.quantity === d.quantity) || numberWritten(d.quantity, sources);
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
        if (now === null ? was !== null : now !== was && !numberWritten(now, sources)) {
          reject(group, now === null ? "aucun montant" : `${now} €`);
          deal.payment = { ...deal.payment, amount_eur: was, currency: before.payment.currency };
        }
        break;
      }
      case "in_kind": {
        const now = deal.in_kind_value_eur;
        const was = before.in_kind_value_eur;
        if (now === null ? was !== null : now !== was && !numberWritten(now, sources)) {
          reject(group, now === null ? "aucune valeur" : `${now} €`);
          deal.in_kind_value_eur = was;
        }
        break;
      }
      case "usage_duration": {
        const { duration_months: months, perpetual } = deal.usage;
        const monthsOk = months === null || months === before.usage.duration_months || numberWritten(months, sources, "months");
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
        const monthsOk = months === null || months === before.exclusivity.duration_months || numberWritten(months, sources, "months");
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
        if (days !== null && days !== before.payment.terms_days && !numberWritten(days, sources)) {
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

// Ce que l'écran dit d'une valeur écartée : à la créatrice, en « tu ».
export function unwrittenDoubt(item: Unwritten): string {
  const label = TERM_GROUP_LABEL[item.group];
  if (item.reason === "brand_account") {
    return "La marque parle de publier sur son propre compte, pas sur les tiens : la publication sur tes comptes n'a pas été retenue.";
  }
  return `« ${label} » : l'outil a cru lire « ${item.value} », mais ce n'est pas écrit dans la réponse de la marque. Ce n'est pas retenu : fais-le-lui préciser.`;
}
