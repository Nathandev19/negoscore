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

// Ce que contient une analyse est le MÊME dans les trois formules (mission
// #062, C2) : score, points à négocier, fourchette, contre-offre et message à
// envoyer. La seule différence est le nombre d'analyses, qui est déjà dans
// « summary ». Les anciennes formulations — « analyse complète à chaque
// crédit » en face de « score, points à négocier et fourchette » — laissaient
// croire que l'analyse gratuite était amputée. Elle ne l'est pas : elle
// demande seulement un email pour afficher la contre-offre, ce que la ligne
// de la formule gratuite dit maintenant explicitement.
export const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    price: PRICE.free,
    period: null,
    summary: `${FREE_ANALYSES} analyse`,
    features: ["Analyse complète : score, points à négocier, fourchette en euros", "Contre-offre et message à envoyer, après ton email"],
  },
  {
    id: "pack",
    name: "Pack Deal",
    price: PRICE.pack,
    period: null,
    summary: `${PACK_ANALYSES} analyses`,
    features: ["Analyse complète : score, points à négocier, fourchette en euros", "Contre-offre et message à envoyer, sans autre étape"],
  },
  {
    id: "pro",
    name: "Pro",
    price: PRICE.pro,
    period: PRO_PERIOD,
    summary: `Jusqu'à ${PRO_ANALYSES_PER_PERIOD} analyses par mois`,
    features: ["Analyse complète : score, points à négocier, fourchette en euros", "Contre-offre et message à envoyer, sans autre étape"],
  },
] as const;

// Formule mise en avant sur l'accueil et sur /tarifs : une seule. Le Pack est
// l'achat sans engagement qui suit l'analyse gratuite.
export const FEATURED_PLAN: (typeof PLANS)[number]["id"] = "pack";

// Nom affiché d'une formule payante (mission #090 : la page « Merci » nomme
// le produit acheté).
export const PLAN_LABEL: Record<"pack" | "pro", string> = {
  pack: "Pack Deal",
  pro: "abonnement Pro",
};
