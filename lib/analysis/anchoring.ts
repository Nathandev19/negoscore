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
