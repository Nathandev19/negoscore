import { PLANS } from "@/lib/billing/plans";
import rates from "@/lib/rates/fr-2026.2.json";
import { MAX_PDF_PAGES } from "@/lib/upload";

// Textes de la page d'accueil. Les prix et la version de la table viennent du
// code (lib/billing/plans.ts, lib/rates) : jamais réécrits à la main.

export const STEPS = [
  { title: "Tu colles l'offre", text: "Le message, la capture ou le PDF." },
  { title: "On lit ce qui est écrit", text: "Livrables, droits, exclusivité, délais." },
  {
    title: "Tu obtiens le chiffre",
    text: "Une fourchette en euros et, si l'offre est assez précise, un score sur 100. Avec ton email : la contre-offre et le message à envoyer.",
  },
] as const;

export const TRUST = [
  {
    title: "Une table de tarifs versionnée",
    text: `Les prix viennent d'une table française versionnée (${rates.version} aujourd'hui). La version utilisée est affichée sur chaque analyse.`,
  },
  {
    title: "Ce que le score lit, et ce qu'il ne peut pas savoir",
    text: "Il lit le prix, le délai de paiement, les droits cédés, l'exclusivité et les révisions écrits dans l'offre. Il ne peut pas savoir si la marque paiera à temps ni si le brief va déraper : aucune offre ne dépasse 90/100.",
  },
  {
    title: "Tes offres effacées au bout de 30 jours",
    text: "Le texte collé, les captures et les PDF sont effacés au bout de 30 jours au plus ; l'analyse reste. La purge tourne tous les jours, et tu peux supprimer une analyse à tout moment depuis sa page.",
  },
  {
    title: "Pas un conseil juridique",
    text: "C'est une analyse éducative fondée sur des benchmarks de marché. On te le dit ici, avant que tu paies.",
  },
] as const;

const PLANS_TEXT = PLANS.map((plan) => `${plan.name} : ${plan.price}${plan.period ? ` ${plan.period}` : ""} (${plan.summary})`).join(", ");

export const FAQ = [
  {
    question: "D'où viennent les prix ?",
    answer: `D'une table de tarifs française, versionnée (${rates.version}) : des benchmarks observés sur des offres UGC en France, complétés par des valeurs interpolées là où les observations manquent. Le tarif de base suppose un créateur confirmé, avec un portfolio. Chaque analyse affiche la version de la table utilisée.`,
  },
  {
    question: "Ça marche pour quel type d'offre ?",
    answer:
      `Les offres de collaboration envoyées par une marque : message privé, email, brief ou contrat, en français ou en anglais. Tu peux coller le texte, envoyer une capture d'écran ou déposer le PDF (${MAX_PDF_PAGES} pages et 10 Mo au plus, sans mot de passe). Un PDF scanné est lu comme une image.`,
  },
  {
    question: "Et si l'offre ne donne pas de montant ?",
    answer:
      "On calcule quand même ce que valent les contenus demandés, et on te le montre comme une fourchette indicative, sans score. S'il manque aussi ce qui est demandé ou les droits d'utilisation, on te dit quoi faire préciser à la marque avant de chiffrer.",
  },
  {
    question: "Qu'est-ce que vous faites de mes documents ?",
    answer:
      "Ils servent à produire ton analyse, grâce à un prestataire d'analyse automatisée, et à rien d'autre. Le texte collé et les fichiers déposés sont effacés au bout de 30 jours au plus ; l'analyse, elle, reste. Avec ou sans compte, tu peux supprimer une analyse à tout moment depuis sa page de résultat.",
  },
  {
    question: "C'est un conseil juridique ?",
    answer:
      "Non. C'est une analyse éducative fondée sur des benchmarks de marché. Les repères sur la loi française qu'on affiche sont une information générale, pas un avis sur ton cas.",
  },
  {
    question: "Combien ça coûte ?",
    answer: `Ta première analyse est gratuite. Ensuite : ${PLANS_TEXT}. Prix TTC.`,
  },
] as const;

