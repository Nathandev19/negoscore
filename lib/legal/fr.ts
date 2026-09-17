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
    missing_mandatory_clauses: applicable ? clauses.filter(([, missing]) => missing).map(([label]) => label) : [],
    note,
  };
}
