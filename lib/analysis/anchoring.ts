// Ancrage de la contre-offre et position d'une rémunération dans la
// fourchette estimée. Le produit sert à faire monter la rémunération : la
// contre-offre part toujours au-dessus de ce que la marque propose déjà.

export type CounterRange = { low: number | null; high: number | null };

const NO_COUNTER: CounterRange = { low: null, high: null };

//   pas d'estimation totale          → aucune contre-offre chiffrée
//   montant absent                   → [bas, haut]
//   montant < bas                    → [bas, haut]
//   bas ≤ montant < haut             → [milieu(montant, haut), haut]
//   montant ≥ haut                   → aucune contre-offre chiffrée : les
//                                      leviers sont les conditions
// Invariant : la borne basse est toujours strictement au-dessus du montant.
export function counterOfferRange(amount: number | null, low: number | null, high: number | null): CounterRange {
  if (low === null || high === null) return NO_COUNTER;
  if (amount === null || amount < low) return { low, high };
  if (amount >= high) return NO_COUNTER;
  // Arrondi à l'euro supérieur : le milieu reste strictement au-dessus du montant.
  return { low: Math.ceil((amount + high) / 2), high };
}

// Mission #109, C — premier palier de contre-offre.
//
// Quand la marque propose moins que le plancher, la contre-offre est toute la
// fourchette. Sur le cas du PDF (450 € proposés, 760 – 1 530 € estimés), ça
// revient à demander 3,4 fois l'offre : défendable comme valeur, inutilisable
// tel quel comme message — beaucoup renoncent plutôt que d'envoyer ça.
//
// L'écran donne donc DEUX chiffres, pas un : ce que le lot vaut, et un premier
// palier pour qui ne veut pas tout demander d'un coup. Ce palier n'invente
// rien : c'est le plancher de la fourchette, déjà calculé, déjà affiché comme
// borne basse. Le produit ne choisit pas à la place du créateur, il lui montre
// les deux stratégies.
//
// null : le montant n'est pas sous le plancher (ou rien n'est chiffrable). Le
// cas « montant dans la fourchette » ne change pas.
export function counterFirstStep(amount: number | null, low: number | null, high: number | null): number | null {
  if (amount === null || low === null || high === null) return null;
  return amount < low ? low : null;
}

export type RangePosition = "below" | "bottom" | "middle" | "top" | "above";

// Où se situe une valeur dans la fourchette, par tiers.
export function rangePosition(value: number, low: number, high: number): RangePosition {
  if (value < low) return "below";
  if (value >= high) return "above";
  const share = (value - low) / (high - low);
  if (share < 1 / 3) return "bottom";
  if (share < 2 / 3) return "middle";
  return "top";
}

export const POSITION_LABEL: Record<RangePosition, string> = {
  below: "en dessous de notre fourchette",
  bottom: "tout en bas de notre fourchette",
  middle: "au milieu de notre fourchette",
  top: "en haut de notre fourchette",
  above: "au-dessus de notre fourchette",
};

// Mission #082 — la contre-offre est-elle exactement la fourchette estimée ?
// Oui quand la marque propose moins que le bas (« below ») ou n'écrit aucun
// montant (« no_amount ») : l'écran ne montre alors le chiffre qu'une fois.
export function counterSameAsEstimate(
  amount: number | null,
  counter: { amount_low: number | null; amount_high: number | null } | undefined,
  estimate: { total_low: number | null; total_high: number | null },
): "below" | "no_amount" | null {
  if (!counter || counter.amount_low === null) return null;
  if (counter.amount_low !== estimate.total_low || counter.amount_high !== estimate.total_high) return null;
  return amount === null ? "no_amount" : "below";
}
