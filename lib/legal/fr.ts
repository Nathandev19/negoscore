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
const INVISIBLE = /[\s\u00ad\u200b-\u200f\u2060\ufeff]/gu;

export function readableClause(label: string): boolean {
  return label.replace(INVISIBLE, "") !== "";
}

// Les mentions réellement affichables, dans l'ordre. Le nombre annoncé et les
// puces affichées sortent de CETTE fonction, jamais de deux chemins séparés.
export function readableClauses(clauses: readonly string[]): string[] {
  return clauses.filter(readableClause).map((clause) => clause.trim());
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
