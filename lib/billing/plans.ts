// Formules vendues (le mot « offre » est réservé à ce que la marque propose). Source unique pour la page /tarifs et les quotas serveur.

export const FREE_ANALYSES = 1;
export const PACK_ANALYSES = 3;
export const PRO_ANALYSES_PER_PERIOD = 30;

export const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    price: "0 €",
    period: null,
    summary: `${FREE_ANALYSES} analyse`,
    features: ["Score, points à négocier et fourchette", "Contre-offre et message après connexion par email"],
  },
  {
    id: "pack",
    name: "Pack Deal",
    price: "4,99 €",
    period: null,
    summary: `${PACK_ANALYSES} analyses`,
    features: ["Analyse complète à chaque crédit", "Historique de tes analyses"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "12,99 €",
    period: "par mois",
    summary: `Jusqu'à ${PRO_ANALYSES_PER_PERIOD} analyses par mois`,
    features: ["Analyse complète à chaque fois", "Historique de tes analyses"],
  },
] as const;

// Formule mise en avant sur l'accueil et sur /tarifs : une seule. Le Pack est
// l'achat sans engagement qui suit l'analyse gratuite.
export const FEATURED_PLAN: (typeof PLANS)[number]["id"] = "pack";
