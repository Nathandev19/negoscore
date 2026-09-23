import { BRAND } from "@/lib/brand";
import { negotiations, NEGOTIATIONS } from "@/lib/content/vocabulaire";
import { PLANS } from "@/lib/billing/plans";
import type { PlanKey } from "@/lib/whop/api";
import { SELLER } from "@/lib/legal/identity";
import { renderEmail, type EmailBlock } from "@/lib/email/layout";
import type { Email } from "@/lib/email/send";

// Contenu des emails. Celui de confirmation d'achat est fourni par l'éditeur
// et repris mot pour mot : c'est la troisième condition de l'article
// L221-28 13° (confirmation de l'accord sur support durable).
//
// Chaque email a une version texte (celle qui fait foi, reprise telle quelle)
// et une version HTML à l'identité du site (lib/email/layout.ts), qui contient
// les mêmes phrases. Ajouts de la mission #044, marqués ADDED : ce que la
// personne peut faire maintenant et comment résilier.

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const PLAN_NAME: Record<PlanKey, string> = { pack: "Pack Deal", pro: "Pro" };
const PLAN_OBTAINED: Record<PlanKey, string> = {
  pack: `${negotiations(NEGOTIATIONS.pack)} ajoutées à ton compte`,
  pro: `accès Pro, jusqu'à ${negotiations(NEGOTIATIONS.proPerPeriod)} par mois`,
};

const CONSENT =
  "Tu as accepté, au moment du paiement, que l'exécution du service commence immédiatement, avant la fin du délai de rétractation de 14 jours, et tu as reconnu perdre ton droit de rétractation une fois le service fourni. Cet email constitue la confirmation de cet accord.";

function signature(): string {
  return `— ${BRAND.name}\n${SELLER.name}, EI — ${SELLER.address.replace(", France", "")}\nSIRET ${SELLER.siret}`;
}

// Montant réellement payé, reçu de Whop. À défaut, le prix de la formule lu dans
// la source unique des formules (lib/billing/plans.ts), jamais écrit à la main.
function amountValue(plan: PlanKey, amount: number | null, currency: string | null): string {
  if (amount === null) return PLANS.find((p) => p.id === plan)?.price ?? "voir le reçu Whop";
  const value = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return currency && currency.toLowerCase() !== "eur" ? `${value} ${currency.toUpperCase()}` : `${value} €`;
}

// Aucune mention de TVA dans cet email (mission #048) : Whop, vendeur de
// référence, affiche sa propre ligne de taxe au paiement. « Prix TTC. TVA non
// applicable, article 293 B du CGI » contredisait ce que l'acheteur venait de
// voir. Rien n'est affirmé à la place tant que le régime appliqué par Whop
// n'est pas confirmé par écrit. Les CGV et mentions légales gardent la mention
// 293 B, qui décrit le statut de l'entreprise.

export function purchaseConfirmationEmail(options: {
  to: string;
  plan: PlanKey;
  amount: number | null;
  currency: string | null;
  date: Date;
  siteUrl: string;
}): Email {
  const { to, plan, amount, currency, date, siteUrl } = options;
  const subject = `Confirmation de ton achat ${BRAND.name}`;
  const value = amountValue(plan, amount, currency);
  const analyseUrl = `${siteUrl}/analyse`;
  const cancelUrl = `${siteUrl}/resilier`;
  // ADDED (#044)
  const next = "Pour t'en servir, colle l'offre d'une marque sur la page Analyser un deal.";
  const cancel =
    "Pour résilier ton abonnement : en ligne, à tout moment, sur la page Résilier. Il reste actif jusqu'à la fin de la période payée, puis aucun nouveau paiement n'est prélevé.";

  const text = [
    "Bonjour,",
    "",
    "Ton paiement est confirmé.",
    "",
    `Formule : ${PLAN_NAME[plan]}`,
    `Montant : ${value}`,
    `Date : ${DATE.format(date)}`,
    "",
    `Ce que tu as obtenu : ${PLAN_OBTAINED[plan]}`,
    "",
    `${next} ${analyseUrl}`,
    ...(plan === "pro" ? ["", `${cancel} ${cancelUrl}`] : []),
    "",
    CONSENT,
    "",
    `Tes conditions générales de vente : ${siteUrl}/cgv`,
    `Une question : ${SELLER.email}`,
    "",
    signature(),
  ].join("\n");

  const blocks: EmailBlock[] = [
    // « Ton paiement est confirmé. » est le titre de l'email HTML : pas répété.
    { kind: "paragraph", text: "Bonjour," },
    {
      kind: "facts",
      rows: [
        { label: "Formule", value: PLAN_NAME[plan] },
        { label: "Montant", value },
        { label: "Date", value: DATE.format(date) },
        { label: "Ce que tu as obtenu", value: PLAN_OBTAINED[plan] },
      ],
    },
    { kind: "paragraph", text: next },
    { kind: "button", label: "Analyser un deal", url: analyseUrl },
    ...(plan === "pro"
      ? ([
          { kind: "heading", text: "Résilier" },
          { kind: "paragraph", text: cancel },
          { kind: "link", label: "Résilier mon abonnement", url: cancelUrl },
        ] satisfies EmailBlock[])
      : []),
    { kind: "heading", text: "Ton droit de rétractation" },
    { kind: "paragraph", text: CONSENT },
    { kind: "small", text: `Tes conditions générales de vente : ${siteUrl}/cgv` },
    { kind: "small", text: `Une question : ${SELLER.email}` },
  ];

  return {
    to,
    subject,
    text,
    html: renderEmail({
      subject,
      preheader: `${PLAN_NAME[plan]} : ${PLAN_OBTAINED[plan]}.`,
      title: "Ton paiement est confirmé.",
      blocks,
      siteUrl,
    }),
  };
}

export function cancellationConfirmationEmail(options: { to: string; endsAt: Date | null; siteUrl: string }): Email {
  const { to, endsAt, siteUrl } = options;
  const subject = `Résiliation de ton abonnement ${BRAND.name}`;
  const when = endsAt
    ? `Ton abonnement Pro reste actif jusqu'au ${DATE.format(endsAt)}, puis il s'arrête. Aucun nouveau paiement ne sera prélevé.`
    : "Ton abonnement Pro s'arrête à la fin de la période en cours. Aucun nouveau paiement ne sera prélevé.";
  const credits = "Les négociations achetées séparément restent acquises.";
  const text = [
    "Bonjour,",
    "",
    "Ta résiliation est enregistrée.",
    "",
    when,
    "",
    credits,
    "",
    `Tes conditions générales de vente : ${siteUrl}/cgv`,
    `Une question : ${SELLER.email}`,
    "",
    signature(),
  ].join("\n");

  return {
    to,
    subject,
    text,
    html: renderEmail({
      subject,
      preheader: endsAt ? `Actif jusqu'au ${DATE.format(endsAt)}, puis plus aucun prélèvement.` : "Plus aucun prélèvement après la période en cours.",
      title: "Ta résiliation est enregistrée",
      blocks: [
        { kind: "paragraph", text: "Bonjour," },
        { kind: "paragraph", text: when, strong: true },
        { kind: "paragraph", text: credits },
        // ADDED (#044)
        { kind: "button", label: "Voir mon compte", url: `${siteUrl}/compte` },
        { kind: "small", text: `Tes conditions générales de vente : ${siteUrl}/cgv` },
        { kind: "small", text: `Une question : ${SELLER.email}` },
      ],
      siteUrl,
    }),
  };
}

export function accountDeletionEmail(options: { to: string; siteUrl: string }): Email {
  const { to, siteUrl } = options;
  const subject = `Suppression de ton compte ${BRAND.name}`;
  const deleted =
    "Ce qui a été supprimé : ton adresse email de connexion, tes offres déposées et leurs fichiers, tes négociations, et les négociations achetées qu'il te restait, qui ne sont pas remboursées.";
  const kept =
    "Ce qui est conservé : l'historique de tes paiements et tes preuves de consentement au paiement, que la loi nous oblige à garder.";
  const alert = "Si tu n'es pas à l'origine de cette suppression, écris-nous vite.";
  const text = [
    "Bonjour,",
    "",
    "Ton compte est supprimé.",
    "",
    deleted,
    "",
    kept,
    "",
    alert,
    "",
    `Tes conditions générales de vente : ${siteUrl}/cgv`,
    `Une question : ${SELLER.email}`,
    "",
    signature(),
  ].join("\n");

  return {
    to,
    subject,
    text,
    html: renderEmail({
      subject,
      preheader: "Tes offres, tes négociations et celles qu'il te restait sont supprimées.",
      title: "Ton compte est supprimé",
      blocks: [
        { kind: "paragraph", text: "Bonjour," },
        { kind: "paragraph", text: deleted },
        { kind: "paragraph", text: kept },
        { kind: "paragraph", text: alert, strong: true },
        // Pas d'appel à revenir : un simple moyen d'écrire, pour l'alerte ci-dessus.
        { kind: "button", label: "Écrire au support", url: `mailto:${SELLER.email}` },
        { kind: "small", text: `Tes conditions générales de vente : ${siteUrl}/cgv` },
      ],
      siteUrl,
    }),
  };
}
