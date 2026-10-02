import { entryFor } from "@/lib/lookup";

// Mission #106 — des chemins courts, tapables à la main, qui portent
// l'attribution.
//
// Le compte TikTok part de zéro abonné : pas de lien cliquable en bio, donc
// des adresses dictées à l'oral et tapées au clavier, sans le moindre
// paramètre. Sans ces chemins, le cockpit (mission #103) ne verrait jamais
// d'où viennent les visites.
//
// Le navigateur ne pose rien : c'est le SERVEUR qui redirige vers l'accueil en
// ajoutant les UTM, et l'événement landing_view les lit ensuite exactement
// comme ceux d'un lien UTM classique (components/analytics/first-party-view).
//
// Ce fichier est la SEULE source. Ajouter un chemin, c'est ajouter une ligne
// dans la table ci-dessous : ni route, ni fichier, ni condition ailleurs.

// Ce qui est commun à tous les chemins : le même mode d'acquisition, la même
// campagne. La SOURCE, elle, est portée par chaque ligne — voir plus bas.
export const ACQUISITION_UTM = {
  medium: "organic_social",
  campaign: "lancement",
} as const;

// Mission #125 — une ligne peut désormais porter sa DESTINATION. Jusqu'ici
// tous les chemins menaient à l'accueil, parce qu'ils sortaient tous d'une
// vidéo qui disait « va sur negoscore.fr ». Le lien envoyé en DM, lui, doit
// pouvoir arriver directement sur l'exemple chiffré. `to` absent = l'accueil,
// donc les huit chemins existants ne changent pas d'un octet.
// Mission #137 — et une ligne peut être SERVIE SUR PLACE plutôt que
// redirigée. Une redirection coûte un aller-retour complet : ~230 ms
// mesurés en #134 sur le lien envoyé en DM, avant que la page ne commence
// à se charger. `servi` dit « rends le contenu de `to` à cette adresse-ci,
// sans déplacer le navigateur ». L'attribution ne change pas : elle vient
// de cette table, et c'est /api/vue qui la relit (voir shortPathAttribution).
export type ShortPath = { source: string; content: string; to?: string; servi?: boolean };

// Destination par défaut : l'accueil.
const DEFAULT_TARGET = "/";

// chemin (sans barre oblique, en minuscules) → le réseau d'où vient la visite,
// et ce qui l'a produite.
//
// Mission #119 — la source était une constante unique, « tiktok ». Le compte
// Instagram @negoscore étant en service, elle serait devenue FAUSSE : le
// cockpit aurait rangé des visites Instagram sous TikTok, et c'est exactement
// le genre de chiffre qu'on ne peut plus corriger après coup. Elle est donc
// descendue dans la table, une ligne à la fois. Le reste ne bouge pas :
// ajouter un chemin, c'est toujours ajouter UNE ligne ici, et rien ailleurs.
//
// Mission #124 — et la prospection par DM est une SOURCE À PART ENTIÈRE, au
// même titre que la bio Instagram. Elle n'est pas du trafic de vidéo : une
// créatrice à qui on écrit directement n'a rien vu, rien cherché, et son taux
// de conversion n'a aucune raison de ressembler à celui d'une vidéo. Les
// mélanger rendait les deux illisibles.
export const SHORT_PATHS: Readonly<Record<string, ShortPath>> = {
  // Mission #124 — RÉPARATION. Ce chemin était l'ancien raccourci de la
  // vidéo 1 TikTok (#106). Il sert depuis le 29/09 de lien envoyé en réponse
  // aux DM de prospection Instagram, et aucune vidéo ne l'a jamais dicté : les
  // vidéos se terminent sur « negoscore.fr » seul. Trois visites réelles de
  // créatrices Instagram étaient donc déjà rangées sous TikTok.
  dm: { source: "instagram", content: "dm_prospection" },
  // La vidéo 1 récupère un chemin à elle, que `dm` lui tenait lieu. Les quatre
  // autres avaient déjà le leur.
  negociation: { source: "tiktok", content: "video_1_negociation" },
  verdicts: { source: "tiktok", content: "video_2_verdicts" },
  produits: { source: "tiktok", content: "video_3_produits" },
  capture: { source: "tiktok", content: "video_4_capture" },
  niveau: { source: "tiktok", content: "video_5_niveau" },
  // Lien de profil, pour le jour où la bio devient cliquable.
  //
  // Mission #145 — ce jour est arrivé, et le contenu passe de `bio` à
  // `bio_tiktok`. La bio TikTok portait « negoscore.fr » nu : aucune
  // attribution, donc des visites rangées en « direct » alors qu'on sait d'où
  // elles viennent. C'est ce chemin-ci qu'on y colle désormais.
  //
  // `bio_tiktok` et non `bio`, pour la raison déjà écrite sous `insta` : la
  // source suffirait à distinguer les deux lignes du cockpit, mais deux
  // chemins qui portent le même utm_content deviennent indiscernables le jour
  // où on ne regarde que cette colonne. Les lignes déjà enregistrées sous
  // `bio` restent sous `bio` — voir le rapport de la #145 pour le SQL qui les
  // renomme, si tu veux une seule ligne au lieu de deux.
  tiktok: { source: "tiktok", content: "bio_tiktok" },
  // Instagram autorise un lien cliquable en bio sans vérification
  // d'entreprise : c'est le seul canal qui ne dépend pas du numéro INSEE.
  // Le chemin reste tapable, pour le cas où il est dicté en story.
  //
  // `bio_instagram` et non `bio` : la source suffirait à distinguer les deux
  // lignes du cockpit, mais deux chemins qui portent le même utm_content
  // deviennent indiscernables le jour où on ne regarde que cette colonne.
  insta: { source: "instagram", content: "bio_instagram" },
  // Mission #125 — LE SEUL CHEMIN QUI NE MÈNE PAS À L'ACCUEIL.
  //
  // Constat : ~1 500 vues TikTok et 10 DM Instagram n'ont produit aucune
  // analyse. L'accueil demande, comme première action, de coller le message
  // d'une marque — plusieurs minutes d'effort réclamées avant d'avoir rien
  // montré. /analyse/demo, elle, affiche un résultat complet dès l'arrivée,
  // sans chargement. C'est cette page-là qu'on envoie en DM.
  //
  // `/dm` ne bouge pas : il reste le lien « je veux tester la mienne ». Les
  // deux portent un utm_content distinct, pour qu'on puisse enfin comparer
  // deux façons d'entrer dans le produit.
  //
  // Mission #137 — et le SEUL qui soit servi sur place : l'adresse reste
  // /exemple dans le navigateur, le contenu est celui de /analyse/demo, et
  // il n'y a plus de redirection sur le chemin.
  exemple: { source: "instagram", content: "dm_exemple", to: "/analyse/demo", servi: true },
};

// Un chemin tapé à la main ne respecte ni la casse ni la barre oblique finale :
// /DM, /dm/ et /dm mènent au même endroit. Un chemin à plusieurs segments n'en
// est pas un : /dm/autre chose n'est pas /dm.
function key(pathname: string): string {
  return pathname.trim().toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");
}

// L'adresse vers laquelle rediriger, ou null si ce chemin n'est pas dans la
// table. null ne veut PAS dire « accueil » : un chemin inconnu reste une
// adresse inconnue, et rend un 404 comme n'importe quelle autre.
// Mission #113, C — `SHORT_PATHS[cle]` répondait aussi pour les clés
// héritées d'Object.prototype : /constructor et /__proto__ redirigeaient vers
// l'accueil avec un utm_content fabriqué, au lieu de rendre 404 comme toute
// autre adresse inconnue.
// L'attribution d'un chemin court servi sur place, et la page qu'il affiche.
// C'est ce que /api/vue relit : sur /exemple, l'adresse ne porte aucun
// paramètre, et pourtant la visite est bien « instagram · lancement ·
// dm_exemple ». Une seule source de vérité, la table ci-dessus.
export type ShortPathAttribution = {
  to: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
};

// Une ligne est servie sur place si elle le dit ET si elle a une destination.
// Les deux conditions comptent : une destination seule reste une redirection
// — c'est le cas de tout chemin qu'on ajouterait demain vers une autre page.
export function servedAttribution(entry: ShortPath | undefined): ShortPathAttribution | null {
  if (entry === undefined || !entry.servi || !entry.to) return null;
  return {
    to: entry.to,
    utm_source: entry.source,
    utm_medium: ACQUISITION_UTM.medium,
    utm_campaign: ACQUISITION_UTM.campaign,
    utm_content: entry.content,
  };
}

export function shortPathAttribution(pathname: string): ShortPathAttribution | null {
  return servedAttribution(entryFor(SHORT_PATHS, key(pathname)));
}

// Ce chemin est-il servi sur place plutôt que redirigé ?
export function shortPathIsServed(pathname: string): boolean {
  return shortPathAttribution(pathname) !== null;
}

export function shortPathTarget(pathname: string): string | null {
  const entry = entryFor(SHORT_PATHS, key(pathname));
  if (entry === undefined) return null;
  const params = new URLSearchParams({
    utm_source: entry.source,
    utm_medium: ACQUISITION_UTM.medium,
    utm_campaign: ACQUISITION_UTM.campaign,
    utm_content: entry.content,
  });
  // La destination vient de la table, elle aussi : aucune condition ailleurs,
  // aucune adresse écrite dans le proxy.
  return `${entry.to ?? DEFAULT_TARGET}?${params.toString()}`;
}
