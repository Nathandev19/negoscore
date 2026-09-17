import { BRAND } from "@/lib/brand";
import type { PlanKey } from "@/lib/whop/api";
import { SELLER } from "@/lib/legal/identity";
import type { Email } from "@/lib/email/send";

// Contenu des emails. Celui de confirmation d'achat est fourni par l'éditeur
// et repris mot pour mot : c'est la troisième condition de l'article
// L221-28 13° (confirmation de l'accord sur support durable).

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const PLAN_NAME: Record<PlanKey, string> = { pack: "Pack Deal", pro: "Pro" };
const PLAN_OBTAINED: Record<PlanKey, string> = {
  pack: "3 analyses ajoutées à ton compte",
  pro: "accès Pro, 30 analyses par mois",
};

function signature(): string {
  return `— ${BRAND.name}\n${SELLER.name}, EI — ${SELLER.address.replace(", France", "")}\nSIRET ${SELLER.siret}`;
}

function amountLine(amount: number | null, currency: string | null): string {
  if (amount === null) return "Montant : voir le reçu Whop";
  const value = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return currency && currency.toLowerCase() !== "eur" ? `Montant : ${value} ${currency.toUpperCase()}` : `Montant : ${value} €`;
}

export function purchaseConfirmationEmail(options: {
  to: string;
  plan: PlanKey;
  amount: number | null;
  currency: string | null;
  date: Date;
  siteUrl: string;
}): Email {
  const { to, plan, amount, currency, date, siteUrl } = options;
  const text = [
    "Bonjour,",
    "",
    "Ton paiement est confirmé.",
    "",
    `Offre : ${PLAN_NAME[plan]}`,
    amountLine(amount, currency),
    `Date : ${DATE.format(date)}`,
    "",
    `Ce que tu as obtenu : ${PLAN_OBTAINED[plan]}`,
    "",
    "Tu as accepté, au moment du paiement, que l'exécution du service commence immédiatement, avant la fin du délai de rétractation de 14 jours, et tu as reconnu perdre ton droit de rétractation une fois le service fourni. Cet email constitue la confirmation de cet accord.",
    "",
    `Tes conditions générales de vente : ${siteUrl}/cgv`,
    `Une question : ${SELLER.email}`,
    "",
    signature(),
  ].join("\n");

  return { to, subject: `Confirmation de ton achat ${BRAND.name}`, text };
}

export function cancellationConfirmationEmail(options: { to: string; endsAt: Date | null; siteUrl: string }): Email {
  const { to, endsAt, siteUrl } = options;
  const text = [
    "Bonjour,",
    "",
    "Ta résiliation est enregistrée.",
    "",
    endsAt
      ? `Ton abonnement Pro reste actif jusqu'au ${DATE.format(endsAt)}, puis il s'arrête. Aucun nouveau paiement ne sera prélevé.`
      : "Ton abonnement Pro s'arrête à la fin de la période en cours. Aucun nouveau paiement ne sera prélevé.",
    "",
    "Les crédits d'analyse achetés séparément restent acquis.",
    "",
    `Tes conditions générales de vente : ${siteUrl}/cgv`,
    `Une question : ${SELLER.email}`,
    "",
    signature(),
  ].join("\n");

  return { to, subject: `Résiliation de ton abonnement ${BRAND.name}`, text };
}

export function accountDeletionEmail(options: { to: string; siteUrl: string }): Email {
  const { to, siteUrl } = options;
  const text = [
    "Bonjour,",
    "",
    "Ton compte est supprimé.",
    "",
    "Ce qui a été supprimé : ton adresse email de connexion, tes offres déposées et leurs fichiers, tes analyses, et tes crédits d'analyse restants, qui ne sont pas remboursés.",
    "",
    "Ce qui est conservé : l'historique de tes paiements et tes preuves de consentement au paiement, que la loi nous oblige à garder.",
    "",
    "Si tu n'es pas à l'origine de cette suppression, écris-nous vite.",
    "",
    `Tes conditions générales de vente : ${siteUrl}/cgv`,
    `Une question : ${SELLER.email}`,
    "",
    signature(),
  ].join("\n");

  return { to, subject: `Suppression de ton compte ${BRAND.name}`, text };
}
