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

export const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    price: PRICE.free,
    period: null,
    summary: `${FREE_ANALYSES} analyse`,
    features: ["Score, points à négocier et fourchette", "Contre-offre et message après connexion par email"],
  },
  {
    id: "pack",
    name: "Pack Deal",
    price: PRICE.pack,
    period: null,
    summary: `${PACK_ANALYSES} analyses`,
    features: ["Analyse complète à chaque crédit", "Historique de tes analyses"],
  },
  {
    id: "pro",
    name: "Pro",
    price: PRICE.pro,
    period: PRO_PERIOD,
    summary: `Jusqu'à ${PRO_ANALYSES_PER_PERIOD} analyses par mois`,
    features: ["Analyse complète à chaque fois", "Historique de tes analyses"],
  },
] as const;

// Formule mise en avant sur l'accueil et sur /tarifs : une seule. Le Pack est
// l'achat sans engagement qui suit l'analyse gratuite.
export const FEATURED_PLAN: (typeof PLANS)[number]["id"] = "pack";
