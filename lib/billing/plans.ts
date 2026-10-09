// Formules vendues (le mot « offre » est réservé à ce que la marque propose). Source unique pour la page /tarifs et les quotas serveur.

export const FREE_ANALYSES = 1;
export const PACK_ANALYSES = 3;
export const PRO_ANALYSES_PER_PERIOD = 30;

// SEUL ENDROIT DU DÉPÔT où un prix est écrit (mission #049). Tout affichage,
// page de vente, CGV, page de résiliation ou email, passe par ces constantes.
// tests/prices.test.ts échoue si une somme en euros réapparaît ailleurs.
// Le montant réellement débité vient de Whop : il est vérifié contre PRICE par
// tests-integration/auth-billing.test.ts.
export const PRICE = {
  free: "0 €",
  pack: "4,99 €",
  pro: "12,99 €",
} as const;

// Périodicité de l'abonnement, écrite une seule fois elle aussi.
export const PRO_PERIOD = "par mois";

// Ce que contient une négociation est le MÊME dans les trois formules (mission
// #062, C2) : score, points à négocier, fourchette, contre-offre, messages et
// conclusion. La seule différence est le NOMBRE de négociations, déjà dans
// « summary ». Mission #093 : l'unité vendue s'appelle une négociation, ici
// comme dans toute la copie publique — c'est l'unité réellement facturée, du
// premier message jusqu'à la conclusion. La formule gratuite n'est pas
// amputée : elle demande seulement un email pour afficher la contre-offre.
export const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    price: PRICE.free,
    period: null,
    summary: `${FREE_ANALYSES} négociation`,
    features: [
      "Le deal en entier : analyse de l'offre, réponses à la marque, conclusion",
      "Verdict, points à négocier et fourchette en euros",
      "Contre-offre et messages à envoyer, après ton email",
    ],
  },
  {
    id: "pack",
    name: "Pack Deal",
    price: PRICE.pack,
    period: null,
    summary: `${PACK_ANALYSES} négociations complètes`,
    features: [
      "Le deal en entier : analyse de l'offre, réponses à la marque, conclusion",
      "Verdict, points à négocier et fourchette en euros",
      "Contre-offre et messages à envoyer, sans autre étape",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: PRICE.pro,
    period: PRO_PERIOD,
    summary: `Jusqu'à ${PRO_ANALYSES_PER_PERIOD} négociations par mois`,
    features: [
      "Le deal en entier : analyse de l'offre, réponses à la marque, conclusion",
      "Verdict, points à négocier et fourchette en euros",
      "Contre-offre et messages à envoyer, sans autre étape",
    ],
  },
] as const;

// Formule mise en avant sur l'accueil et sur /tarifs : une seule. Le Pack est
// l'achat sans engagement qui suit la négociation gratuite.
export const FEATURED_PLAN: (typeof PLANS)[number]["id"] = "pack";

// Nom affiché d'une formule payante (mission #090 : la page « Merci » nomme
// le produit acheté).
export const PLAN_LABEL: Record<"pack" | "pro", string> = {
  pack: "Pack Deal",
  pro: "abonnement Pro",
};
