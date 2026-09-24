import { formatEur } from "@/lib/money";
import type { Analysis } from "@/lib/schema";

// Couche légale FR. Règle unique, codée en dur, jamais générée par le modèle.
// C'est le seul fichier du projet autorisé à contenir un énoncé juridique.

type Deal = Analysis["deal"];
type FrLegal = Analysis["fr_legal"];

// Seuil du contrat écrit obligatoire. Exporté depuis la mission #061 : la page
// /produits-offerts l'affiche, elle ne le réécrit pas.
export const WRITTEN_CONTRACT_THRESHOLD_EUR = 1000;

const DISCLAIMER = "C'est une information générale, pas un conseil juridique.";

// Montant écrit par le formateur des euros, avec une espace insécable avant « HT » :
// « 1 000 € HT » ne se coupe jamais en fin de ligne.
const BASE_NOTE =
  `En France, un contrat écrit est obligatoire quand une collaboration dépasse ${formatEur(WRITTEN_CONTRACT_THRESHOLD_EUR)}\u00a0HT cumulés sur l'année civile entre une même marque et un même créateur, avantages en nature inclus.`;

// Mission #104, A2 — un libellé n'est une mention que s'il se LIT. Espaces,
// mais aussi caractères de largeur nulle et marques de formatage : une puce
// qui n'affiche rien ne doit ni s'afficher ni être comptée.
//
// Mission #115, B2 — l'ensemble était incomplet. `\s` ne couvre ni les
// caractères de formatage au-delà de U+2060 (U+2061 à U+2064, U+2066 à
// U+2069), ni les remplisseurs que les polices ne dessinent pas : U+2800
// (point braille vide), U+3164 (remplisseur hangûl), U+180E (séparateur
// mongol). Une puce faite de ces caractères-là s'affichait vide et se comptait
// quand même. La catégorie Unicode fait le travail à notre place : `\p{Cf}`
// couvre tout le formatage, celui d'aujourd'hui comme celui de demain.
const INVISIBLE = /[\s\u00ad\u180e\u2800\u3164\ufeff]|\p{Cf}/gu;

export function readableClause(label: string): boolean {
  return label.replace(INVISIBLE, "") !== "";
}

// Les mentions réellement affichables, dans l'ordre. Le nombre annoncé et les
// puces affichées sortent de CETTE fonction, jamais de deux chemins séparés.
export function readableClauses(clauses: readonly string[]): string[] {
  return clauses.filter(readableClause).map((clause) => clause.trim());
}

// Mission #115, B1 — LE NOMBRE ANNONCÉ ET LES PUCES SORTENT D'ICI, ENSEMBLE.
//
// Vu en production le 24/09, après la mission #104 qui affirmait l'avoir
// corrigé : « 5 mentions obligatoires absentes », suivi de cinq puces sans
// texte. La #104 avait fait filtrer les deux côtés par la même fonction, mais
// laissait l'appelant appeler cette fonction deux fois et compter d'un côté,
// rendre de l'autre. Deux appels, c'est déjà deux chemins.
//
// Ici, il n'y a plus qu'un objet : la liste rendue est celle qui a été comptée,
// et le texte du résumé est construit à partir de sa longueur. Aucun composant
// ne peut plus les faire diverger, ni en oublier le filtre.
export type MissingClausesView = { clauses: string[]; count: number; hint: string };

export function missingClausesView(legal: Pick<FrLegal, "missing_mandatory_clauses">): MissingClausesView {
  const clauses = readableClauses(legal.missing_mandatory_clauses);
  const count = clauses.length;
  const hint =
    count === 0
      ? "Aucune mention obligatoire ne manque à l'offre."
      : count === 1
        ? "1 mention obligatoire absente de l'offre."
        : `${count} mentions obligatoires absentes de l'offre.`;
  return { clauses, count, hint };
}

function isFrenchLaw(governingLaw: string | null): boolean {
  return governingLaw !== null && /fran(ce|çais|çaise|cais|caise)|french/i.test(governingLaw);
}

export function computeFrLegal(deal: Deal): FrLegal {
  const applicable = deal.governing_law === null || isFrenchLaw(deal.governing_law);

  const amount = deal.payment.amount_eur;
  const inKind = deal.in_kind_value_eur;
  // Le seuil se compte « avantages en nature inclus » : une offre payée
  // uniquement en produits peut le dépasser (mission #057). Le total est donc
  // évalué dès qu'une des deux valeurs est écrite, et n'est inconnu que si
  // aucune ne l'est.
  const total = amount === null && inKind === null ? null : (amount ?? 0) + (inKind ?? 0);
  const threshold: FrLegal["threshold_1000_reached"] =
    total === null ? "unknown" : total >= WRITTEN_CONTRACT_THRESHOLD_EUR ? "yes" : "no";

  const clauses: Array<[string, boolean]> = [
    ["Identification des parties", deal.brand === null],
    ["Description des prestations", deal.deliverables.length === 0],
    ["Rémunération ou méthode de détermination", amount === null],
    ["Valeur des avantages en nature", deal.in_kind_value_eur === null],
    ["Modalités de paiement", deal.payment.terms_days === null && deal.payment.schedule === null],
    ["Droits et obligations, dont la propriété intellectuelle", deal.ip_transfer === "unclear"],
    ["Soumission au droit français", !isFrenchLaw(deal.governing_law)],
  ];

  const status =
    threshold === "yes"
      ? "Le montant de cette offre atteint ce seuil : demande un contrat écrit avant de commencer."
      : threshold === "no"
        ? "Le montant de cette offre reste sous ce seuil, mais le cumul de l'année compte."
        : "Le montant n'est pas connu : impossible de savoir si ce seuil est atteint.";

  const note = applicable
    ? `${BASE_NOTE} ${status} ${DISCLAIMER}`
    : `Cette offre semble soumise à un autre droit que le droit français : cette vérification ne s'applique pas. ${DISCLAIMER}`;

  return {
    applicable,
    threshold_1000_reached: threshold,
    written_contract_required: applicable && threshold === "yes",
    // Mission #100, point 3 — un libellé vide ne compte pas comme une mention.
    // Le calcul n'en produit pas (ce sont des littéraux), mais une analyse
    // enregistrée peut en porter : on ne les laisse pas repartir d'ici.
    missing_mandatory_clauses: applicable ? readableClauses(clauses.filter(([, missing]) => missing).map(([label]) => label)) : [],
    note,
  };
}
