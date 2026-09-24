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

export const ACQUISITION_UTM = {
  source: "tiktok",
  medium: "organic_social",
  campaign: "lancement",
} as const;

// chemin (sans barre oblique, en minuscules) → valeur de utm_content.
export const SHORT_PATHS: Readonly<Record<string, string>> = {
  dm: "video_1_negociation",
  verdicts: "video_2_verdicts",
  produits: "video_3_produits",
  capture: "video_4_capture",
  niveau: "video_5_niveau",
  // Lien de profil, pour le jour où la bio devient cliquable.
  tiktok: "bio",
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
  const content = entryFor(SHORT_PATHS, key(pathname));
  if (content === undefined) return null;
  const params = new URLSearchParams({
    utm_source: ACQUISITION_UTM.source,
    utm_medium: ACQUISITION_UTM.medium,
    utm_campaign: ACQUISITION_UTM.campaign,
    utm_content: content,
  });
  return `/?${params.toString()}`;
}
