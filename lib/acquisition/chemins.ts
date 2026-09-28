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

export type ShortPath = { source: string; content: string };

// chemin (sans barre oblique, en minuscules) → le réseau d'où vient la visite,
// et ce qui l'a produite.
//
// Mission #119 — la source était une constante unique, « tiktok ». Le compte
// Instagram @negoscore étant en service, elle serait devenue FAUSSE : le
// cockpit aurait rangé des visites Instagram sous TikTok, et c'est exactement
// le genre de chiffre qu'on ne peut plus corriger après coup. Elle est donc
// descendue dans la table, une ligne à la fois. Le reste ne bouge pas :
// ajouter un chemin, c'est toujours ajouter UNE ligne ici, et rien ailleurs.
export const SHORT_PATHS: Readonly<Record<string, ShortPath>> = {
  dm: { source: "tiktok", content: "video_1_negociation" },
  verdicts: { source: "tiktok", content: "video_2_verdicts" },
  produits: { source: "tiktok", content: "video_3_produits" },
  capture: { source: "tiktok", content: "video_4_capture" },
  niveau: { source: "tiktok", content: "video_5_niveau" },
  // Lien de profil, pour le jour où la bio devient cliquable.
  tiktok: { source: "tiktok", content: "bio" },
  // Instagram autorise un lien cliquable en bio sans vérification
  // d'entreprise : c'est le seul canal qui ne dépend pas du numéro INSEE.
  // Le chemin reste tapable, pour le cas où il est dicté en story.
  //
  // `bio_instagram` et non `bio` : la source suffirait à distinguer les deux
  // lignes du cockpit, mais deux chemins qui portent le même utm_content
  // deviennent indiscernables le jour où on ne regarde que cette colonne.
  insta: { source: "instagram", content: "bio_instagram" },
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
export function shortPathTarget(pathname: string): string | null {
  const entry = entryFor(SHORT_PATHS, key(pathname));
  if (entry === undefined) return null;
  const params = new URLSearchParams({
    utm_source: entry.source,
    utm_medium: ACQUISITION_UTM.medium,
    utm_campaign: ACQUISITION_UTM.campaign,
    utm_content: entry.content,
  });
  return `/?${params.toString()}`;
}
