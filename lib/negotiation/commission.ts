// Importé de lib/money, pas de lib/display : display lit ce module pour la
// ligne « Commission » du deal, et deux modules ne doivent pas s'importer l'un
// l'autre.
import { formatEurRange } from "@/lib/money";
import type { Analysis } from "@/lib/schema";

// Mission #116 — UNE OFFRE À COMMISSION DIT CE QU'IL FAUT OBTENIR.
//
// Offre réelle du 24/09 : 2 vidéos TikTok, 15 % sur les ventes via un code
// promo, aucun fixe, droits pub 6 mois. Le produit s'en sortait bien — pas de
// score inventé, « Offre à chiffrer », une fourchette pour le travail et les
// droits, un signal grave sur l'absence de fixe. Il manquait la sortie : la
// créatrice lisait « c'est mauvais » sans lire « voilà ce qu'il faut obtenir
// pour que ça tienne ».
//
// LA RÈGLE QUI COMMANDE TOUT CE FICHIER : on ne chiffre JAMAIS une commission.
// Lui donner une valeur en euros demanderait le prix du produit, un taux de
// conversion et la taille de l'audience — trois choses que le produit n'a pas
// et qu'il aurait tort d'inventer. Aucune estimation de gains, aucun
// « potentiel », aucune projection. Le seul chiffre que ces points portent est
// celui de la CRÉATION, que le moteur de tarifs calcule déjà.

type Deal = Analysis["deal"];
type Point = Analysis["negotiate"][number];
type RedFlag = Analysis["red_flags"][number];

// L'offre porte-t-elle une rémunération variable ? Le drapeau fait foi, mais un
// taux ou une commission par vente écrits valent déclaration : le modèle peut
// remplir l'un sans cocher l'autre.
export const NO_VARIABLE_PAY: Deal["variable_pay"] = {
  present: false,
  rate_percent: null,
  base: null,
  per_sale_eur: null,
  attribution_days: null,
  payout: null,
};

// Le champ est optionnel à l'entrée du schéma : une analyse enregistrée avant
// cette mission n'en porte pas, et un deal construit à la main non plus. Toute
// lecture passe par ici, et retombe sur « aucune commission ».
export function variablePayOf(deal: { variable_pay?: Deal["variable_pay"] }): Deal["variable_pay"] {
  return deal.variable_pay ?? NO_VARIABLE_PAY;
}

export function hasVariablePay(deal: { variable_pay?: Deal["variable_pay"] }): boolean {
  const pay = variablePayOf(deal);
  return pay.present || pay.rate_percent !== null || pay.per_sale_eur !== null;
}

// L'offre demande-t-elle aussi des droits publicitaires ? C'est ce qui rend le
// point B4 applicable — et c'est le plus vicieux des cinq.
function brandRuns(deal: Pick<Deal, "usage">): boolean {
  const { usage } = deal;
  return usage.paid_ads || usage.whitelisting || usage.spark_ads;
}

// Un point à négocier déjà produit par le modèle traite-t-il le même sujet ?
// On n'en crée pas un second : les cinq points s'AJOUTENT à l'analyse, ils ne
// la doublent pas.
type Candidate = { label: string; why: string; sameAs: RegExp };

const FIXED = /\bfixe\b|garanti|minimum\s+garanti|forfait/i;
const RATE = /assiette|base\s+de\s+calcul|sur\s+quoi\s+porte|taux\s+(?:de\s+)?commission|pourcentage/i;
const ATTRIBUTION = /attribution|rattach[ée]|cookie|dur[ée]e\s+du\s+code/i;
const ADS_ATTRIBUTION = /(?:attribution|rattach[ée]|code).{0,40}(?:pub|publicit)|(?:pub|publicit).{0,40}(?:attribution|rattach[ée]|code)/i;
const PAYOUT = /versement|revers[ée]|seuil|fr[ée]quence\s+de\s+paiement|quand\s+.{0,20}pay/i;

// LES CINQ POINTS, dans l'ordre où ils comptent.
//
// Ils sont formulés comme les autres points de « Ce qu'il faut négocier » :
// une demande, puis pourquoi. Pas une leçon, pas un avertissement.
export function commissionCandidates(deal: Deal, baseLow: number | null, baseHigh: number | null): Candidate[] {
  const out: Candidate[] = [];

  // B1 — le seul point qui porte un chiffre, et c'est celui de la CRÉATION,
  // jamais le total : le total inclut les droits, qui se négocient à part. Le
  // travail est fait d'avance, il se paie d'avance.
  //
  // Il ne s'ajoute que si l'offre n'annonce aucun fixe : demander un fixe à
  // qui en propose déjà un n'aurait pas de sens.
  if (deal.payment.amount_eur === null) {
    const range = formatEurRange(baseLow, baseHigh);
    out.push({
      label: "Obtenir un fixe qui couvre au moins la création",
      why: range
        ? `La création des contenus est un travail fait d'avance, qu'il y ait des ventes ou non : ${range} pour ce lot. La commission vient en plus, elle ne remplace pas ce montant.`
        : "La création des contenus est un travail fait d'avance, qu'il y ait des ventes ou non. La commission vient en plus, elle ne remplace pas un fixe.",
      sameAs: FIXED,
    });
  }

  // B2 — 15 % de quoi ? Sans assiette écrite, le pourcentage ne veut rien dire.
  out.push({
    label: "Faire écrire le taux de commission et son assiette",
    why: "Un pourcentage sans assiette ne veut rien dire : demande sur quoi il porte — prix de vente, panier, hors taxes, hors frais de port — et que ce soit écrit.",
    sameAs: RATE,
  });

  // B3 — sans attribution écrite, elle est ce que la marque décide. Le libellé
  // évite le mot « durée » : il est réservé aux droits et à l'exclusivité, que
  // le recalcul après un tour suit de près (mission #084).
  out.push({
    label: "Faire écrire combien de temps une vente reste rattachée à ton code",
    why: "Sans attribution écrite, c'est la marque qui décide si une vente compte pour toi. Demande le nombre de jours, et que ce soit dans l'accord.",
    sameAs: ATTRIBUTION,
  });

  // B4 — le plus vicieux, et il ne s'ajoute que si la marque diffuse.
  if (brandRuns(deal)) {
    out.push({
      label: "Vérifier que les publicités de la marque n'annulent pas ton attribution",
      why: "Quand la marque diffuse elle-même ton contenu en publicité, les ventes qui en découlent peuvent échapper à ton code. Demande par écrit que ces ventes restent rattachées à toi.",
      sameAs: ADS_ATTRIBUTION,
    });
  }

  // B5 — un seuil de déclenchement peut rendre une commission inatteignable.
  out.push({
    label: "Faire écrire quand la commission est versée, et à partir de quel seuil",
    why: "Un seuil de déclenchement peut rendre une commission inatteignable. Demande la fréquence, le délai et le montant minimum de versement.",
    sameAs: PAYOUT,
  });

  return out;
}

// Les points à ajouter, une fois retirés ceux qu'un point existant traite déjà.
export function commissionPoints(deal: Deal, existing: readonly Point[], baseLow: number | null, baseHigh: number | null): Point[] {
  if (!hasVariablePay(deal)) return [];
  const already = existing.map((point) => `${point.label} ${point.why}`);
  return commissionCandidates(deal, baseLow, baseHigh)
    .filter((candidate) => !already.some((text) => candidate.sameAs.test(text)))
    .map((candidate) => ({
      label: candidate.label,
      why: candidate.why,
      priority: 0,
      // AUCUN euro n'est jamais associé à ces points : ils ne portent pas
      // d'impact chiffré, parce qu'une commission ne se chiffre pas.
      eur_impact_low: null,
      eur_impact_high: null,
      topic: "other" as const,
    }));
}

// Mission #116, partie C — LE SIGNAL DIT AUSSI LA SORTIE.
//
// Le modèle écrivait « Aucune rémunération fixe — Grave. Tu n'as aucune
// garantie de paiement si les ventes générées sont faibles. » C'est vrai, et
// ça s'arrête là. Le signal est désormais écrit par le moteur : il dit ce qui
// rend l'offre défendable, sans rien promettre.
export const NO_FIXED_PAY_FLAG: RedFlag = {
  label: "Aucune rémunération fixe",
  severity: "high",
  why: "Tout ton revenu dépend des ventes, que tu ne maîtrises pas : si elles sont faibles, tu as travaillé pour rien. Un fixe qui couvre au moins la création rend l'offre défendable — la commission devient alors un bonus, pas un salaire.",
};

// Le signal du modèle sur ce même sujet, qu'on remplace par le nôtre.
const NO_FIXED_SIGNAL =
  /(?:aucune?|pas\s+de|sans)\s+(?:\p{L}+\s+){0,2}fixe|uniquement\s+(?:[àa]\s+la\s+)?commission|r[ée]mun[ée]ration\s+(?:100\s*%\s*)?variable|pas\s+de\s+garantie\s+de\s+paiement/iu;

// Les signaux, une fois le sujet « aucun fixe » remis d'aplomb.
//
// Trois cas :
//   - commission SANS fixe : le signal du moteur remplace celui du modèle, à
//     la place qu'il occupait ;
//   - commission AVEC fixe : un signal « aucune rémunération fixe » serait
//     FAUX. Il est retiré ;
//   - aucune commission : rien ne change, à l'octet près.
export function commissionRedFlags(deal: Deal, existing: readonly RedFlag[]): RedFlag[] {
  if (!hasVariablePay(deal)) return [...existing];
  const matches = (flag: RedFlag) => NO_FIXED_SIGNAL.test(`${flag.label} ${flag.why}`);
  if (deal.payment.amount_eur !== null) return existing.filter((flag) => !matches(flag));
  const index = existing.findIndex(matches);
  if (index === -1) return [NO_FIXED_PAY_FLAG, ...existing];
  return existing.map((flag, position) => (position === index ? NO_FIXED_PAY_FLAG : flag)).filter((flag, position) => position === index || !matches(flag));
}
