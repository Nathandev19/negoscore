// Mission #120 — les robots ne gonflent pas les compteurs.
//
// Question posée par la mission : le robot de Google va explorer ces pages
// régulièrement, est-ce que ses passages vont les gonfler ? La réponse est OUI
// si on ne fait rien, et ce n'était déjà pas faux avant cette mission : le
// moteur de rendu de Google EXÉCUTE le JavaScript et charge les images d'une
// page, donc aussi bien le useEffect de FirstPartyView (landing_view,
// pricing_view) que l'image de mesure ajoutée ici.
//
// CE QU'ON ÉCARTE, ET COMMENT. Les robots qui se nomment. Tous ceux qui
// comptent — Googlebot, son outil d'inspection, Bingbot, les aperçus de lien
// des réseaux et des messageries, les explorateurs SEO, les collecteurs pour
// modèles de langage — annoncent leur nom dans l'en-tête User-Agent. C'est une
// convention, pas une garantie : un robot peut mentir, et celui-là sera compté
// comme une visite. On ne prétend donc pas filtrer « les robots », mais « les
// robots qui disent qui ils sont », ce qui est l'essentiel du trafic
// automatique d'un site qui vient d'ouvrir.
//
// Aucun filtrage par IP, aucune résolution inverse : ce serait un appel réseau
// sur le chemin d'une page, pour un gain nul sur ce volume.

const ROBOT =
  /bot\b|bots?\/|crawler|crawling|spider|scraper|slurp|archiver|feedfetcher|mediapartners|adsbot|apis-google|google-inspectiontool|google-read-aloud|googleweblight|storebot|bingpreview|yandex|baidu|sogou|exabot|ia_archiver|ahrefs|semrush|mj12|dotbot|petal|seznam|applebot|duckduck|facebookexternalhit|facebookcatalog|twitterbot|linkedinbot|pinterest|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|embedly|quora link preview|redditbot|flipboard|vkshare|w3c_validator|lighthouse|headlesschrome|phantomjs|puppeteer|playwright|python-requests|curl\/|wget\/|libwww|httpclient|okhttp|axios\/|node-fetch|go-http-client|java\/|scrapy/i;

export function isRobot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // Aucun navigateur n'omet son User-Agent.
  return ROBOT.test(userAgent);
}

// Le signal « Do Not Track » du navigateur, lu côté SERVEUR. La page de
// confidentialité annonce qu'il est respecté ; jusqu'ici seul le composant
// client le vérifiait (navigator.doNotTrack), donc seulement pour les visiteurs
// qui avaient JavaScript. L'en-tête vaut pour tout le monde.
//
// Sec-GPC est le signal qui a remplacé DNT dans les navigateurs récents : le
// refuser aussi, c'est tenir la même promesse avec le mot d'aujourd'hui.
export function refusesTracking(headers: Headers): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}
