import { PLANS } from "@/lib/billing/plans";
import { COPILOT_PROMISE, ESTIMATE_DISCLAIMER, exchanges, MENTION_TTC, NEGOTIATION_EXCHANGES, WHAT_IS_A_NEGOTIATION } from "@/lib/content/vocabulaire";
import { RETRY_WINDOW_DAYS } from "@/lib/analysis/retry-window";
import rates from "@/lib/rates/fr-2026.3.json";
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
  {
    title: "Tu réponds, elle répond",
    text: `Colle sa réponse : on te dit ce qu'elle accorde, ce qu'elle refuse, et on écrit le message suivant. Jusqu'à ${exchanges(NEGOTIATION_EXCHANGES)} avec la marque, puis la conclusion, dans la même négociation.`,
  },
] as const;

export const TRUST = [
  {
    title: "Une table de tarifs versionnée",
    text: `Les prix viennent d'une table française versionnée (${rates.version} aujourd'hui). La version utilisée est affichée sur chaque négociation.`,
  },
  {
    title: "Ce que le score lit, et ce qu'il ne peut pas savoir",
    // Liste complétée (mission #061) : l'entraînement IA et les rushs non
    // couverts sont deux malus réellement appliqués (lib/rates/score.ts).
    text: "Il lit le prix, le délai de paiement, les droits cédés, l'exclusivité, les révisions, l'usage de tes contenus pour entraîner une IA et les rushs bruts demandés sans être payés, écrits dans l'offre. Il ne peut pas savoir si la marque paiera à temps ni si le brief va déraper : aucune offre ne dépasse 90/100.",
  },
  {
    title: "Tes offres effacées au bout de 30 jours",
    // « À tout moment » était faux sans compte (mission #061) : le navigateur
    // perd l'accès à son analyse au bout de 30 jours, et la purge l'efface.
    text: "Le texte collé, les captures et les PDF sont effacés au bout de 30 jours au plus ; l'analyse reste. La purge tourne tous les jours, et tu peux supprimer une analyse depuis sa page tant que tu y as accès : avec ton compte, sans limite de temps ; sans compte, pendant 30 jours, après quoi elle est effacée d'elle-même.",
  },
  {
    title: "Un copilote, pas un décideur",
    text: `${COPILOT_PROMISE} ${ESTIMATE_DISCLAIMER}`,
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
    answer: `D'une table de tarifs française, versionnée (${rates.version}) : des benchmarks observés sur des offres UGC en France, complétés par des valeurs interpolées là où les observations manquent. Le tarif de base part du niveau « Je débute » ; sur la page de résultat, tu choisis ton niveau et tout est recalculé. Chaque négociation affiche la version de la table utilisée.`,
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
      "Ils servent à produire ton analyse, grâce à un prestataire d'analyse automatisée (OpenAI, États-Unis), et à rien d'autre. Une capture ou un PDF part en entier : ce qui est à l'écran autour de l'offre part avec. Le texte collé et les fichiers déposés sont effacés au bout de 30 jours au plus ; l'analyse, elle, reste tant que ton compte existe. Sans compte, elle est effacée au bout de 30 jours, et tu peux la supprimer toi-même depuis sa page jusque-là.",
  },
  {
    question: "C'est un conseil juridique ?",
    answer:
      "Non. C'est une analyse éducative fondée sur des benchmarks de marché. Les repères sur la loi française qu'on affiche sont une information générale, pas un avis sur ton cas.",
  },
  {
    question: "Qu'est-ce qu'une négociation ?",
    answer: `${WHAT_IS_A_NEGOTIATION} C'est l'unité facturée : une négociation vaut pour un deal, quel que soit le nombre de messages échangés avec la marque.`,
  },
  {
    question: "Combien ça coûte ?",
    // Relance gratuite d'une analyse incomplète : mission #043, FAQ corrigée en #046.
    answer: `Ta première négociation est gratuite. Si l'analyse ressort incomplète parce que le message de la marque ne dit pas assez ce qu'elle demande, tu peux la relancer gratuitement une fois, dans les ${RETRY_WINDOW_DAYS} jours, avec les précisions obtenues, sans que ça compte comme une négociation de plus. Ensuite : ${PLANS_TEXT}. ${MENTION_TTC}`,
  },
] as const;

