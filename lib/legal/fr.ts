import { formatEur } from "@/lib/money";
import type { Analysis } from "@/lib/schema";

// Couche légale FR. Règle unique, codée en dur, jamais générée par le modèle.
// C'est le seul fichier du projet autorisé à contenir un énoncé juridique.

type Deal = Analysis["deal"];
type FrLegal = Analysis["fr_legal"];

// Seuil du contrat écrit obligatoire. Exporté depuis la mission #061 : la page
// /produits-offerts l'affiche, elle ne le réécrit pas.
export const WRITTEN_CONTRACT_THRESHOLD_EUR = 1000;

const DISCLAIMER = "C'est une information générale, pas un conseil juridique.";

// Mission #214 — L'OBLIGATION DE CONTRAT ÉCRIT A UNE CONDITION D'ENTRÉE, ET
// LE PRODUIT L'AFFIRMAIT SANS ELLE.
//
// Les seules références que ce fichier a le droit de porter :
//
//   — loi n° 2023-451 du 9 juin 2023 visant à encadrer l'influence
//     commerciale. Son article 1er définit l'activité d'influence
//     commerciale : les personnes qui « mobilisent leur notoriété auprès de
//     leur audience » pour promouvoir des biens ou des services. Ce n'est pas
//     une formalité de préambule, c'est une CONDITION D'ENTRÉE : elle
//     restreint tout le champ de la loi ;
//   — l'article 8 de cette même loi impose un contrat écrit au-delà d'un
//     seuil fixé par décret ;
//   — le décret n° 2025-1137 fixe ce seuil à 1 000 € HT, en vigueur depuis le
//     1er janvier 2026.
//
// Conséquence, et c'est elle qui manquait à l'écran : une prestation d'UGC
// pur — le créateur livre des vidéos à la marque, la marque les diffuse sur
// ses propres canaux ou en publicité, le créateur ne publie rien auprès de sa
// propre audience — ne mobilise pas la notoriété du créateur auprès de son
// audience. Elle sort du champ de la loi 2023-451, et l'obligation de contrat
// écrit au-delà de 1 000 € HT ne s'y applique pas.
//
// Ce qui reste vrai dans TOUS les cas, sans condition de notoriété et sans
// seuil de montant : l'article L131-3 du Code de la propriété intellectuelle.
// C'est lui l'ossature du volet contractuel, et c'est lui qui porte le message
// par défaut.
const CHAMP =
  "La loi du 9 juin 2023 sur l'influence commerciale s'applique quand un créateur mobilise sa notoriété auprès de son audience pour promouvoir un produit ou un service.";

// Montant écrit par le formateur des euros, avec une espace insécable avant « HT » :
// « 1 000 € HT » ne se coupe jamais en fin de ligne. Même raison pour le
// numéro du décret et pour « 1er janvier ».
const SEUIL = `${formatEur(WRITTEN_CONTRACT_THRESHOLD_EUR)}\u00a0HT`;
const SEUIL_SOURCE = "seuil fixé par le décret n°\u00a02025-1137, en vigueur depuis le 1er\u00a0janvier 2026";

// Ce que le produit COMPARE au seuil. C'est une phrase sur le produit, pas sur
// le texte de loi : additionner le montant et la valeur des produits offerts
// est une décision du dépôt (mission #057), elle ne se présente donc pas comme
// une citation.
const CE_QUI_EST_COMPTE =
  "Ce que le produit compare à ce seuil : le montant proposé, plus la valeur des produits offerts quand l'offre la chiffre.";

// L131-3, repris sur ses propres termes — ceux de l'article, pas une
// paraphrase de mémoire : « chacun des droits cédés fasse l'objet d'une
// mention distincte dans l'acte », « le domaine d'exploitation […] délimité
// quant à son étendue et à sa destination, quant au lieu et quant à la
// durée ». La citation intégrale, guillemets compris, vit sur
// /droits-utilisation ; ici c'est l'exigence, pas la citation.
const RIGHTS_NOTE =
  "Dès qu'il y a cession de droits, quel que soit le montant et quel que soit le mode de diffusion, l'article L131-3 du Code de la propriété intellectuelle demande que chacun des droits cédés fasse l'objet d'une mention distincte dans l'acte, et que le domaine d'exploitation soit délimité quant à son étendue et à sa destination, quant au lieu et quant à la durée.";

// Mission #104, A2 — un libellé n'est une mention que s'il se LIT. Espaces,
// mais aussi caractères de largeur nulle et marques de formatage : une puce
// qui n'affiche rien ne doit ni s'afficher ni être comptée.
//
// Mission #115, B2 — l'ensemble était incomplet. `\s` ne couvre ni les
// caractères de formatage au-delà de U+2060 (U+2061 à U+2064, U+2066 à
// U+2069), ni les remplisseurs que les polices ne dessinent pas : U+2800
// (point braille vide), U+3164 (remplisseur hangûl), U+180E (séparateur
// mongol). Une puce faite de ces caractères-là s'affichait vide et se comptait
// quand même. La catégorie Unicode fait le travail à notre place : `\p{Cf}`
// couvre tout le formatage, celui d'aujourd'hui comme celui de demain.
const INVISIBLE = /[\s\u00ad\u180e\u2800\u3164\ufeff]|\p{Cf}/gu;

export function readableClause(label: string): boolean {
  return label.replace(INVISIBLE, "") !== "";
}

// Les mentions réellement affichables, dans l'ordre. Le nombre annoncé et les
// puces affichées sortent de CETTE fonction, jamais de deux chemins séparés.
export function readableClauses(clauses: readonly string[]): string[] {
  return clauses.filter(readableClause).map((clause) => clause.trim());
}

// Mission #115, B1 — LE NOMBRE ANNONCÉ ET LES PUCES SORTENT D'ICI, ENSEMBLE.
//
// Vu en production le 24/09, après la mission #104 qui affirmait l'avoir
// corrigé : « 5 mentions obligatoires absentes », suivi de cinq puces sans
// texte. La #104 avait fait filtrer les deux côtés par la même fonction, mais
// laissait l'appelant appeler cette fonction deux fois et compter d'un côté,
// rendre de l'autre. Deux appels, c'est déjà deux chemins.
//
// Ici, il n'y a plus qu'un objet : la liste rendue est celle qui a été comptée,
// et le texte du résumé est construit à partir de sa longueur. Aucun composant
// ne peut plus les faire diverger, ni en oublier le filtre.
export type MissingClausesView = { clauses: string[]; count: number; hint: string };

export function missingClausesView(legal: Pick<FrLegal, "missing_mandatory_clauses">): MissingClausesView {
  const clauses = readableClauses(legal.missing_mandatory_clauses);
  const count = clauses.length;
  const hint =
    count === 0
      ? "Aucune mention obligatoire ne manque à l'offre."
      : count === 1
        ? "1 mention obligatoire absente de l'offre."
        : `${count} mentions obligatoires absentes de l'offre.`;
  return { clauses, count, hint };
}

// Mission #214 — LA VUE DU BLOC LÉGAL, EN UN SEUL OBJET.
//
// Même règle qu'en #115 : le résumé annoncé et les puces rendues sortent d'ici
// ensemble. Le bloc porte maintenant DEUX listes — les mentions du contrat
// écrit (loi 2023-451, seulement quand son champ est réuni) et les mentions de
// la cession de droits (L131-3, toujours) — et un seul résumé doit les décrire
// toutes les deux.
export type LegalNoticeView = {
  clauses: string[];
  count: number;
  rights: string[];
  rightsTransfer: boolean;
  hint: string;
};

export function legalNoticeView(
  legal: Pick<FrLegal, "missing_mandatory_clauses" | "missing_rights_clauses" | "rights_transfer" | "diffusion">,
): LegalNoticeView {
  const { clauses, count, hint: mandatoryHint } = missingClausesView(legal);
  const rights = readableClauses(legal.missing_rights_clauses);
  // Le résumé doit décrire TOUTES les puces du bloc : le nombre annoncé reste
  // égal au nombre de puces rendues, somme des deux listes comprise. C'est
  // l'invariant des missions #104 et #115, qu'une deuxième liste pouvait
  // casser en silence.
  const rightsPhrase = rights.length === 1 ? "1 point à obtenir sur la cession de droits" : `${rights.length} points à obtenir sur la cession de droits`;
  const hint =
    count > 0 && rights.length > 0
      ? `${mandatoryHint.replace(/\.$/, "")}, et ${rightsPhrase}.`
      : count > 0
        ? mandatoryHint
        : rights.length > 0
          ? `${rightsPhrase[0].toUpperCase()}${rightsPhrase.slice(1)}.`
          : legal.diffusion === "createur"
            ? mandatoryHint
            : legal.rights_transfer
              ? "La cession de droits est délimitée sur les quatre points."
              : "Rien ne manque dans ce que le produit vérifie.";
  return { clauses, count, rights, rightsTransfer: legal.rights_transfer, hint };
}

function isFrenchLaw(governingLaw: string | null): boolean {
  return governingLaw !== null && /fran(ce|çais|çaise|cais|caise)|french/i.test(governingLaw);
}

// Mission #214 — LE MODE DE DIFFUSION, LU SUR CE QUE LE MODÈLE EXTRAIT DÉJÀ.
//
// Trois valeurs, et la troisième n'est pas un repli poli : c'est le cas où le
// produit n'a pas de quoi trancher, et où il ne doit donc rien affirmer de
// ferme, ni dans un sens ni dans l'autre.
//
//   — « createur » : l'offre demande une publication sur le compte du
//     créateur. La notoriété est mobilisée auprès de son audience, le champ de
//     la loi 2023-451 est réuni ;
//   — « marque » : aucune publication demandée au créateur, et l'offre dit
//     positivement que la marque diffuse de son côté (ses comptes, ou la
//     publicité payante). C'est l'UGC pur, hors du champ ;
//   — « inconnu » : tout le reste.
//
// DEUX PIÈGES, et ils vont en sens inverse.
//
// 1. `publication_required === false` ne veut PAS dire « le créateur ne publie
//    pas ». Le prompt dit « true seulement si le créateur doit publier sur son
//    propre compte » : false confond donc « l'offre dit non » et « l'offre
//    n'en parle pas ». On ne peut pas en déduire seul la sortie du champ —
//    il faut que la diffusion par la marque soit, elle, positivement écrite.
//
// 2. Le marquage blanc (`whitelisting`) et les Spark Ads ne sont PAS des
//    canaux de la marque : la publicité part du compte du créateur, ou elle
//    pousse une publication du créateur. Ce n'est donc ni « exclusivement sur
//    les canaux de la marque », ni une publication du créateur établie. Les
//    classer d'un côté ou de l'autre serait trancher une question que les
//    références ci-dessus ne tranchent pas : ils vont dans « inconnu ».
//
// `normalizeDeal` recopie `publication_required` dans `usage.organic` ; c'est
// sans effet ici, parce que `publication_required` est lu AVANT.
export type Diffusion = FrLegal["diffusion"];

export function diffusionDe(deal: Deal): Diffusion {
  if (deal.publication_required) return "createur";
  if (deal.usage.whitelisting || deal.usage.spark_ads) return "inconnu";
  if (deal.usage.organic || deal.usage.paid_ads) return "marque";
  return "inconnu";
}

// Mission #214, point 3 — LE VOLET L131-3, DANS TOUS LES CAS DE CESSION.
//
// Il n'existait pas : les sept « mentions obligatoires » couvraient la
// propriété intellectuelle par une seule entrée (« Droits et obligations, dont
// la propriété intellectuelle »), qui ne dit pas ce que l'article demande. Les
// quatre points ci-dessous sont les quatre que l'article nomme, et rien de
// plus.
//
// Une cession existe dès que la marque obtient un droit d'utilisation :
// « license » ou « full_assignment ». « unclear » en est une aussi — l'offre
// prévoit un usage sans dire lequel —, et c'est précisément le cas où ces
// quatre points manquent le plus. Seul « none » sort : aucune utilisation
// prévue, donc rien à délimiter.
export function hasRightsTransfer(deal: Deal): boolean {
  return deal.ip_transfer !== "none";
}

function rightsClauses(deal: Deal): Array<[string, boolean]> {
  const { usage } = deal;
  return [
    ["Mention distincte de chacun des droits cédés", deal.ip_transfer === "unclear"],
    [
      "Étendue et destination de l'exploitation (supports et usages)",
      !usage.organic && !usage.paid_ads && !usage.whitelisting && !usage.spark_ads,
    ],
    ["Lieu de l'exploitation (territoire)", usage.territory === null && (usage.territory_zones ?? []).length === 0],
    ["Durée de l'exploitation", usage.duration_months === null && !usage.perpetual],
  ];
}

export function computeFrLegal(deal: Deal): FrLegal {
  const applicable = deal.governing_law === null || isFrenchLaw(deal.governing_law);

  const amount = deal.payment.amount_eur;
  const inKind = deal.in_kind_value_eur;
  // Le seuil se compte produits offerts compris : une offre payée uniquement
  // en produits peut le dépasser (mission #057). Le total est donc évalué dès
  // qu'une des deux valeurs est écrite, et n'est inconnu que si aucune ne
  // l'est.
  const total = amount === null && inKind === null ? null : (amount ?? 0) + (inKind ?? 0);
  const threshold: FrLegal["threshold_1000_reached"] =
    total === null ? "unknown" : total >= WRITTEN_CONTRACT_THRESHOLD_EUR ? "yes" : "no";

  const diffusion = diffusionDe(deal);
  const rightsTransfer = hasRightsTransfer(deal);
  // Mission #214, point 4 — LA GRAVITÉ SUIT LA BASE.
  //
  // Ces sept mentions sont celles du contrat écrit de la loi 2023-451 : elles
  // n'ont de caractère obligatoire que dans le champ de cette loi. Hors de ce
  // champ — et tant qu'on ne sait pas si on y est —, les annoncer comme
  // « absentes » serait exactement l'affirmation sans sa condition que cette
  // mission corrige. Le volet L131-3 prend alors le relais, et lui ne dépend
  // ni du montant ni du mode de diffusion.
  const clauses: Array<[string, boolean]> = [
    ["Identification des parties", deal.brand === null],
    ["Description des prestations", deal.deliverables.length === 0],
    ["Rémunération ou méthode de détermination", amount === null],
    ["Valeur des avantages en nature", deal.in_kind_value_eur === null],
    ["Modalités de paiement", deal.payment.terms_days === null && deal.payment.schedule === null],
    ["Droits et obligations, dont la propriété intellectuelle", deal.ip_transfer === "unclear"],
    ["Soumission au droit français", !isFrenchLaw(deal.governing_law)],
  ];
  const mandatory = applicable && diffusion === "createur";

  const status =
    threshold === "yes"
      ? "Le montant de cette offre atteint ce seuil : demande un contrat écrit avant de commencer."
      : threshold === "no"
        ? "Le montant de cette offre reste sous ce seuil."
        : "Le montant n'est pas connu : impossible de savoir si ce seuil est atteint.";

  // Les trois branches. Aucune n'affirme l'obligation sans sa condition, et
  // aucune ne la nie sur une base incertaine. Le volet L131-3 ferme les trois
  // dès qu'il y a cession.
  const scope =
    diffusion === "createur"
      ? `${CHAMP} C'est le cas ici : l'offre demande une publication sur ton compte. Dans ce cadre, un contrat écrit est obligatoire au-delà de ${SEUIL} (${SEUIL_SOURCE}). ${status} ${CE_QUI_EST_COMPTE}`
      : diffusion === "marque"
        ? `${CHAMP} Ici, l'offre ne te demande aucune publication : la marque diffuse les contenus sur ses propres canaux, publicité comprise. Cette collaboration sort donc du champ de cette loi, et son obligation de contrat écrit au-delà de ${SEUIL} ne s'y applique pas.`
        : `${CHAMP} L'offre ne dit pas assez clairement qui diffuse : selon la façon dont les vidéos seront diffusées, un contrat écrit peut être obligatoire au-delà de ${SEUIL} (${SEUIL_SOURCE}), ou pas du tout exigé.`;

  const note = applicable
    ? [scope, rightsTransfer ? RIGHTS_NOTE : null, DISCLAIMER].filter((part) => part !== null).join(" ")
    : `Cette offre semble soumise à un autre droit que le droit français : cette vérification ne s'applique pas. ${DISCLAIMER}`;

  return {
    applicable,
    diffusion,
    threshold_1000_reached: threshold,
    written_contract_required: applicable && mandatory && threshold === "yes",
    rights_transfer: applicable && rightsTransfer,
    // Mission #100, point 3 — un libellé vide ne compte pas comme une mention.
    // Le calcul n'en produit pas (ce sont des littéraux), mais une analyse
    // enregistrée peut en porter : on ne les laisse pas repartir d'ici.
    missing_mandatory_clauses: mandatory ? readableClauses(clauses.filter(([, missing]) => missing).map(([label]) => label)) : [],
    missing_rights_clauses:
      applicable && rightsTransfer ? readableClauses(rightsClauses(deal).filter(([, missing]) => missing).map(([label]) => label)) : [],
    note,
  };
}
