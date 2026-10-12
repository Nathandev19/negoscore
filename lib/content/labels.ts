// Mission #104, A3 — les libellés d'un CONCEPT du produit, partagés par le
// moteur de chiffrage et par l'écran. Un concept, un nom, en français.
//
// Pourquoi un fichier à part de lib/content/vocabulaire.ts : le vocabulaire
// importe les formules et leurs quantités (lib/billing/plans.ts), et le
// composant de résultat a l'interdiction d'entraîner la facturation dans son
// graphe d'imports (garde de la mission #039, tests/tier.test.ts). Ce module
// est une feuille : il n'importe rien. Le vocabulaire le ré-exporte, pour
// qu'il reste la seule porte d'entrée quand on cherche un mot du produit.

// « Raw footage » s'affichait dans la décomposition du prix pendant que le
// reste du produit disait « rushs bruts » : un concept, deux noms, dont un en
// anglais, dans un produit francophone. L'orthographe retenue est celle déjà
// employée partout ailleurs — les guides, l'accueil, la consigne du modèle.
export const RAW_FOOTAGE_LABEL = "Rushs bruts";

// Mission #109, A — où se situe le montant DANS la fourchette, et pas seulement
// qu'il y est.
//
// Ce que disait l'écran sur le cas de référence (1 vidéo TikTok + pub 12 mois,
// 250 € proposés, fourchette 180 – 400 €) : « C'est dans les prix pour ces
// droits », au-dessus d'une contre-offre à 325 – 400 €. Les deux phrases se
// contredisaient : 250 € est au tiers bas de la fourchette, et l'outil demandait
// justement de monter. La phrase mesure désormais ce que le score mesurait déjà
// (pricePoints) et que personne ne disait.
export type WithinRange = "bottom" | "middle" | "top";

export const WITHIN_RANGE_SENTENCE: Record<WithinRange, string> = {
  bottom: "C'est dans les prix, mais tout en bas de la fourchette.",
  middle: "C'est dans les prix.",
  top: "C'est dans le haut de la fourchette.",
};

// Mission #109, C — l'offre est sous le plancher : l'écran donne la valeur du
// lot ET un point de départ, sans décider à la place du créateur.
export const COUNTER_FIRST_STEP_TITLE = "Si tu ne veux pas tout demander d'un coup";

export function counterFirstStepSentence(step: string, full: string): string {
  return `Commence à ${step} : c'est le bas de la fourchette, déjà au-dessus de ce que la marque propose. La fourchette complète, ${full}, est ce que ces droits valent — c'est toi qui choisis jusqu'où tu montes.`;
}


// Mission #181 — COMBIEN CETTE PERSONNE EN A, dit sobrement en tête de sa
// liste. Mission #183 — et le mot est « négociation ».
//
// Le compteur disait « analyses » sous un titre qui dit « Tes négociations » :
// deux mots pour le même contenu, sur le même écran. vocabulaire.ts tranche —
// l'unité est la négociation, « analyse » ne nomme plus que l'étape. Le
// compteur compte les lignes de la liste, que la page appelle des
// négociations : le nombre et le mot disent donc la même chose qu'elle.
//
// Le vocabulaire est contraint par ailleurs : les missions #174 à #178 ont
// retiré de tout écran de créatrice la note sur 100 et les mots qui la
// nommaient — ni « score » ni « note » ici (bloc de décision de la #176 dans
// vocabulaire.ts, et tests/note-contre-bande.test.tsx).
//
// Zéro se dit « Aucune négociation », jamais « 0 négociation » : un chiffre nu
// devant un pluriel approximatif est la faute que cette fonction existe pour
// éviter. Un seul élément se dit au singulier.
export function negociationsCount(total: number): string {
  if (total <= 0) return "Aucune négociation enregistrée pour l'instant.";
  return `${negotiations(total)} enregistrée${total > 1 ? "s" : ""}.`;
}

// La liste s'arrête à 100 lignes. Au-delà, le compteur dit la vérité — le
// nombre réel — et cette phrase dit pourquoi la liste est plus courte que
// lui. Sans elle, l'écran afficherait deux nombres qui se contredisent.
export function negociationsCountTruncated(total: number, shown: number): string {
  return `${negociationsCount(total)} Les ${shown} plus récentes sont listées.`;
}

// ══════════════ LE SOLDE DE NÉGOCIATIONS, ET SON TON ══════════════════════
//
// Mission #182 — ce qu'il RESTE, dit là où la personne décide de dépenser.
//
// LE MOT. C'est « négociation », pas « analyse » ni « crédit » : la mission
// #093 a tranché que l'unité vendue — celle qui est réellement décomptée — est
// la négociation, et c'est elle que ce solde compte. « Crédit » reste le mot
// de la base et du code. Le compteur de la #181 sur /historique, lui, compte
// des ANALYSES FAITES : deux nombres, deux mots, deux écrans.
//
// « 3 négociations », « 1 négociation », « 0 négociation » : en français, zéro
// prend le singulier.
export function negotiations(count: number): string {
  return `${count} négociation${count > 1 ? "s" : ""}`;
}

// LE SEUIL, ICI ET PAS DANS UN COMPOSANT. À une négociation près de la fin, le
// ton monte une fois. Pas plus bas : chez nous tout dépend de la PREMIÈRE
// analyse d'une personne, et quelqu'un qui en a une devant lui n'a aucune
// raison de rationner.
export const SOLDE_SEUIL_BAS = 1;

export type SoldeTon = "discret" | "bas" | "zero";

// Trois états. null (aucun plafond) est discret : il n'y a rien à ménager.
//
// `intact` : rien n'a encore été dépensé sur ce stock. Il reste discret quel
// que soit son nombre — une visiteuse qui arrive a UNE négociation, soit
// exactement le seuil bas, et lui dire « c'est ta dernière » avant qu'elle ait
// commencé est précisément le compteur criard que la mission interdit. Relevé
// à l'écran, pas déduit.
export function soldeTon(restantes: number | null, intact = false): SoldeTon {
  if (restantes === null) return "discret";
  if (restantes <= 0) return "zero";
  if (intact) return "discret";
  return restantes <= SOLDE_SEUIL_BAS ? "bas" : "discret";
}

export const SOLDE_ILLIMITE = "Négociations illimitées";

const JOUR = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

// LA PHRASE. Trois tons, et aucun compte à rebours.
//
//   discret   un nombre et un mot. On doit pouvoir l'ignorer.
//   bas       le ton monte UNE fois, en langage clair : ce qui se passe, pas
//             une urgence fabriquée. Ni « vite », ni « dernière chance ».
//   zéro      ce qui se passe ENSUITE. La date si le quota se recharge, sinon
//             par où en obtenir d'autres. Jamais un « 0 » sec.
export function soldeTexte(restantes: number | null, rechargeLe: Date | null, intact = false): string {
  if (restantes === null) return SOLDE_ILLIMITE;
  if (restantes > 0 && intact) {
    // Un stock intact s'annonce comme ce qu'il est : une offre, pas un reste.
    return `${negotiations(restantes)} offerte${restantes > 1 ? "s" : ""}, pour commencer`;
  }
  if (restantes <= 0) {
    return rechargeLe
      ? `Plus de négociation pour cette période. Ton quota se recharge le ${JOUR.format(rechargeLe)}.`
      : "Plus de négociation disponible. Les tarifs disent comment en avoir d'autres.";
  }
  if (restantes <= SOLDE_SEUIL_BAS) {
    return rechargeLe
      ? `${negotiations(restantes)} avant le ${JOUR.format(rechargeLe)}, où ton quota se recharge.`
      : `${negotiations(restantes)}, c'est ta dernière. Après, les tarifs disent comment continuer.`;
  }
  return `${negotiations(restantes)} restantes`;
}

// Version courte, pour l'en-tête : la place y est comptée, et un en-tête n'est
// pas l'endroit d'une phrase. Le ton, lui, est le même — c'est la même
// fonction qui le décide.
export function soldeBadge(restantes: number | null, intact = false): string {
  if (restantes === null) return SOLDE_ILLIMITE;
  if (restantes <= 0) return "Plus de négociation";
  if (intact) return `${negotiations(restantes)} offerte${restantes > 1 ? "s" : ""}`;
  return `${negotiations(restantes)} restante${restantes > 1 ? "s" : ""}`;
}

// Où aller quand il n'en reste plus. Un seul endroit l'écrit.
export const SOLDE_LIEN = { href: "/tarifs", label: "Voir les tarifs" } as const;
