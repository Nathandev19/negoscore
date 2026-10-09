import { entryFor } from "@/lib/lookup";
import type { ProductEventName } from "@/lib/analytics/first-party";

// Mission #120 — les guides et la page d'exemple deviennent mesurables.
//
// Constat de #119 : seules `/` et `/tarifs` émettaient une vue. Quelqu'un qui
// arrivait de Google sur un guide, cliquait vers l'exemple chiffré et repartait
// était invisible de bout en bout — le lien ajouté en #119 fonctionnait sans
// qu'on puisse juger son effet.
//
// POURQUOI PAS LE COMPOSANT CLIENT EXISTANT (FirstPartyView) : il mesure dans
// le navigateur, avec un useEffect. Ces quatre pages-là sont statiques, lues
// par des gens qui arrivent d'un moteur de recherche, et la garantie #074 veut
// qu'elles tiennent sans JavaScript. Une mesure qui a besoin de JavaScript
// laisserait dehors exactement les visiteurs qu'on cherche à compter.
//
// LA MESURE EST DONC UNE IMAGE. Un point d'un pixel, transparent, dans le
// balisage : le navigateur le demande en chargeant la page, et c'est le SERVEUR
// qui enregistre la vue (app/api/vue/route.ts). Aucun script, aucun cookie
// posé, et ça marche avec JavaScript désactivé.

// LA TABLE FERMÉE des pages mesurées. Le navigateur ne choisit pas un chemin :
// il choisit une ENTRÉE de cette table, exactement comme /api/events ne laisse
// choisir qu'entre landing_view et pricing_view. Une valeur inconnue
// n'enregistre rien.
export const MEASURED_PAGES: Readonly<Record<string, ProductEventName>> = {
  "/combien-facturer": "guide_view",
  "/produits-offerts": "guide_view",
  "/droits-utilisation": "guide_view",
  // Mission #158 — quatrième guide.
  "/droits-pub-6-mois": "guide_view",
  // Mission #171 — cinquième guide.
  "/exclusivite-ugc": "guide_view",
  "/analyse/demo": "example_view",
  "/analyse": "analysis_page_view",
};

export type MeasuredPage = keyof typeof MEASURED_PAGES;

export const GUIDE_PATHS = [
  "/combien-facturer",
  "/produits-offerts",
  "/droits-utilisation",
  "/droits-pub-6-mois",
  "/exclusivite-ugc",
] as const;

export function eventForPage(page: string | null | undefined): ProductEventName | undefined {
  return page ? entryFor(MEASURED_PAGES, page) : undefined;
}

// ─── D'où vient la personne qui arrive sur l'exemple ───────────────────────
//
// Le référent interne ne répond pas à la question : avec la navigation côté
// client du routeur, `document.referrer` garde l'adresse de la PREMIÈRE page
// chargée, pas celle qu'on vient de quitter. Et le lire demanderait du
// JavaScript, ce qu'on refuse ici.
//
// Le lien porte donc son origine, en clair, dans l'adresse :
// /analyse/demo?de=combien-facturer. Table fermée là aussi — une valeur
// inconnue vaut « origine inconnue », jamais une erreur et jamais une ligne
// inventée dans le cockpit.
export const INTERNAL_ORIGIN_PARAM = "de";
export const EXAMPLE_ORIGIN_PARAM = INTERNAL_ORIGIN_PARAM;

export const EXAMPLE_ORIGINS: Readonly<Record<string, string>> = {
  accueil: "/",
  "combien-facturer": "/combien-facturer",
  "produits-offerts": "/produits-offerts",
  "droits-utilisation": "/droits-utilisation",
  // Mission #158 — quatrième guide, et la table sert maintenant aussi aux
  // liens d'un guide vers un autre : « d'où vient le lecteur » se lit de la
  // même façon pour une vue de guide et pour une vue de l'exemple.
  "droits-pub-6-mois": "/droits-pub-6-mois",
  // Mission #171 — cinquième guide.
  "exclusivite-ugc": "/exclusivite-ugc",
  // Mission #152 — le pied de page, présent sur toutes les pages. Ce n'est pas
  // une page d'origine mais un EMPLACEMENT : on ne peut pas savoir depuis
  // laquelle on a cliqué, et prétendre le contraire serait inventer une
  // mesure. Ce qui compte est ailleurs : une arrivée qui porte une origine
  // vient du site, une arrivée qui n'en porte pas vient d'un lien envoyé en
  // DM. C'est toute la distinction demandée.
  "pied-de-page": "/pied-de-page",
};

export function originPathFor(value: string | null | undefined): string | undefined {
  return value ? entryFor(EXAMPLE_ORIGINS, value) : undefined;
}

// L'emplacement du bouton fixe, distinct de la page que la visiteuse lisait.
// Comme pour « pied-de-page », l'origine désigne ici un emplacement du site.
export const ANALYSIS_ORIGINS: Readonly<Record<string, string>> = {
  "bouton-mobile": "/bouton-mobile",
};

export function analysisOriginFor(value: string | null | undefined): string | undefined {
  return value ? entryFor(ANALYSIS_ORIGINS, value) : undefined;
}

// Mission #161 — la clé d'origine telle qu'elle est écrite dans l'adresse
// d'une page, et SEULEMENT si l'une des deux tables fermées la connaît.
//
// Elle sert à décider si le pixel de mesure emporte le paramètre : une valeur
// fabriquée n'entre donc même pas dans notre propre requête. Le serveur
// revérifie de toute façon, table par table selon l'événement — ici on ne sait
// pas encore quelle vue sera enregistrée, donc on accepte les clés des deux.
export function knownOriginKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const connue = originPathFor(value) !== undefined || analysisOriginFor(value) !== undefined;
  return connue ? value : null;
}

// L'adresse d'un lien INTERNE qui porte son origine. Jamais d'utm sur un lien
// interne : les colonnes utm décrivent l'acquisition du visiteur, et un clic
// d'une page du site vers une autre ne doit pas la réécrire (mission #152).
// `?de=` est à part, et il est lu dans une table fermée.
//
// L'adresse du lien, depuis une page qui a une clé d'origine. Une visite SANS
// paramètre reste parfaitement valide : c'est une arrivée directe.
export function internalHrefFrom(to: string, origin: keyof typeof EXAMPLE_ORIGINS | null): string {
  return origin ? `${to}?${INTERNAL_ORIGIN_PARAM}=${origin}` : to;
}

export function exampleHrefFrom(origin: keyof typeof EXAMPLE_ORIGINS | null): string {
  return internalHrefFrom("/analyse/demo", origin);
}

// ─── L'adresse de l'image de mesure ────────────────────────────────────────
//
// Le chemin est dans l'adresse, et pas seulement dans l'en-tête Referer, pour
// deux raisons : le routeur navigue côté client d'un guide à l'autre sans
// recharger la page, et deux images de même adresse ne seraient demandées
// qu'une fois ; et un navigateur qui n'envoie pas de référent doit quand même
// pouvoir être compté.
export const VIEW_PIXEL_PATH = "/api/vue";

export function viewPixelSrc(page: MeasuredPage): string {
  return `${VIEW_PIXEL_PATH}?p=${encodeURIComponent(page)}`;
}

// Mission #161 — L'ADRESSE COMPLÈTE DE LA REQUÊTE DE MESURE, construite ici.
//
// Elle l'était dans le composant, et c'est là que l'origine se perdait :
// #158 a appris à la route à lire `?de=`, mais la route le lisait dans
// l'en-tête Referer, et personne ne le mettait dans la requête elle-même.
// Mesuré sur un build de production, adresse réellement émise :
//   GET /api/vue?p=%2Fproduits-offerts&r=direct
// Pas d'origine dedans. Le référent la portait et la chaîne marchait en
// local ; elle ne marchait donc qu'aussi longtemps que le navigateur envoyait
// l'adresse COMPLÈTE de la page, c'est-à-dire une chose que le site ne décide
// pas (politique de référent du navigateur, extension, intermédiaire réseau).
// L'origine voyage maintenant dans la requête, sous LE MÊME nom de paramètre
// que dans les liens — `de` — et le référent n'est plus qu'un repli.
//
// Le repli garde sa raison d'être : sans JavaScript, la mesure est un fond
// d'image écrit au rendu, et une page prérendue statiquement ne connaît pas
// les paramètres de l'adresse. Pour ces visiteurs-là, le référent est le seul
// chemin possible.
export function viewPixelUrl(page: MeasuredPage, pageSearch: string, referrerHost: string | null): string {
  const origine = knownOriginKey(new URLSearchParams(pageSearch).get(INTERNAL_ORIGIN_PARAM));
  return [
    viewPixelSrc(page),
    ...(origine === null ? [] : [`${INTERNAL_ORIGIN_PARAM}=${encodeURIComponent(origine)}`]),
    ...(referrerHost === null ? [] : [`r=${encodeURIComponent(referrerHost)}`]),
  ].join("&");
}
