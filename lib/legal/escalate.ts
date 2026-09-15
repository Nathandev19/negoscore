import { isWorldwide } from "@/lib/rates/engine";
import type { Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];
type Escalation = Analysis["escalate_to_professional"];

// Six règles booléennes. Une seule suffit pour conseiller un professionnel.
const RULES: Array<[(deal: Deal) => boolean, string]> = [
  [
    (d) => (d.payment.amount_eur ?? 0) >= 3000,
    "Le montant dépasse 3 000 € : fais relire le contrat avant de signer.",
  ],
  [
    (d) => d.ip_transfer === "full_assignment",
    "La marque demande une cession totale de tes droits sur les vidéos.",
  ],
  [(d) => d.usage.perpetual, "La marque veut utiliser tes vidéos sans limite de durée."],
  [
    (d) => d.exclusivity.present && (d.exclusivity.duration_months ?? 0) > 6,
    "L'exclusivité dure plus de 6 mois.",
  ],
  [
    (d) => isWorldwide(d.usage.territory) && (d.usage.perpetual || (d.usage.duration_months ?? 0) > 12),
    "Tes vidéos seraient diffusées dans le monde entier pendant plus d'un an.",
  ],
  [
    (d) => d.ai_training_rights === "present",
    "La marque veut pouvoir utiliser tes vidéos pour entraîner une IA.",
  ],
];

export function computeEscalation(deal: Deal): Escalation {
  const reasons = RULES.filter(([rule]) => rule(deal)).map(([, reason]) => reason);
  return { required: reasons.length > 0, reasons };
}
