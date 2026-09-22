import { WRITTEN_CONTRACT_THRESHOLD_EUR } from "@/lib/legal/fr";
import type { Pricing, TurnPayload } from "@/lib/negotiation/types";

// Contrôle indépendant du code : quels montants le produit a le droit
// d'afficher pour un tour. Partagé par les tests des scénarios (#080, F1) et
// par ceux de l'acceptation (#096, 7) — une seule définition, donc une seule
// chose à relire quand la règle bouge.

// Montants affichés en euros dans un rendu HTML, HORS citations de la marque
// (<q>, <blockquote>) : ce que la marque a écrit est montré tel quel, ce n'est
// pas un chiffre du produit. Le texte brut passe aussi par ici.
export function displayedAmounts(html: string): number[] {
  const text = html
    .replace(/<q\b[\s\S]*?<\/q>/g, " ")
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/g, " ")
    .replace(/<textarea\b[\s\S]*?<\/textarea>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return [...text.matchAll(/(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:,\d+)?\s?€/g)].map((m) => Number(m[1].replace(/[\s  ]/g, "")));
}

// Sorties du moteur (fourchettes, contre-offres, écarts entre elles), montants
// LUS dans les termes ou dans le message de la marque (montant proposé, valeur
// des produits, plafond annoncé) avec leurs écarts aux bornes, et le seuil
// légal du contrat écrit. Rien d'autre.
export function allowedAmounts(payload: TurnPayload): Set<number> {
  const pricing = [payload.pricing_before, ...(payload.pricing_after ? [payload.pricing_after] : [])];
  const engine = pricing.flatMap((p: Pricing) => [p.total_low, p.total_high, p.counter_low, p.counter_high]);
  const read = [payload.deal_before, payload.deal_after].flatMap((deal) => [deal.payment.amount_eur, deal.in_kind_value_eur]);
  // Mission #095 : le montant que la marque met sur la table, et son écart.
  if (payload.situation) read.push(payload.situation.amount, payload.situation.gap);
  // Mission #096 : le plafond annoncé, que l'acceptation peut porter.
  if (payload.stated_ceiling !== null) read.push(payload.stated_ceiling);
  const values = [...engine, ...read].filter((v): v is number => v !== null);
  const allowed = new Set(values);
  const current = payload.pricing_after ?? payload.pricing_before;
  if (payload.pricing_after) {
    const b = payload.pricing_before;
    const a = payload.pricing_after;
    for (const [x, y] of [
      [a.total_low, b.total_low],
      [a.total_high, b.total_high],
      [a.counter_low, b.counter_low],
      [a.counter_high, b.counter_high],
    ]) {
      if (x !== null && y !== null) allowed.add(Math.abs(x - y));
    }
  }
  for (const value of read.filter((v): v is number => v !== null)) {
    // Écart avec les deux bornes de la fourchette (mission #095 : un montant
    // proposé se situe par rapport au bas ET au haut).
    if (current.total_low !== null) allowed.add(Math.abs(value - current.total_low));
    if (current.total_high !== null) allowed.add(Math.abs(value - current.total_high));
  }
  allowed.add(0);
  // Seuil légal du contrat écrit (C4) : constante de lib/legal/fr.ts.
  allowed.add(WRITTEN_CONTRACT_THRESHOLD_EUR);
  return allowed;
}
