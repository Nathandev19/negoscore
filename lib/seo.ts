import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { PLANS } from "@/lib/billing/plans";
import { SITE_PREVIEW_ALT, SITE_PREVIEW_SIZE } from "@/lib/share-card/site-preview";

// Référencement et aperçus de partage (mission #047). Pas de pages écrites
// pour les moteurs : seulement des titres, descriptions et adresses propres
// pour les pages qui existent déjà.

// Adresse officielle. Constaté en production le 17/09/2026 : https://negoscore.fr
// répond 308 vers https://www.negoscore.fr (réglage des domaines Vercel), et
// http:// redirige vers https://. C'est donc www qui est servi : les adresses
// canoniques, le sitemap et les aperçus l'utilisent, pour ne jamais annoncer
// une adresse qui redirige. Le nom affiché reste « negoscore.fr » (BRAND.domain).
export const CANONICAL_ORIGIN = "https://www.negoscore.fr";

export type PublicPage = { path: string; title: string; description: string };

// Pages publiques et stables : indexables, dans le sitemap, avec un titre et
// une description qui ont un sens hors du site. Aucune autre page ne l'est.
export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: `Une marque te propose une collab ? Colle son message : ${BRAND.name} te dit ce qu'elle vaut en euros, ce que tu cèdes et quoi répondre. Première analyse gratuite.`,
  },
  {
    path: "/analyse",
    title: "Analyser un deal",
    description: "Colle le DM, le mail ou le brief d'une marque, ou envoie une capture ou le PDF : fourchette en euros, points à négocier et, si l'offre est assez précise, un score sur 100.",
  },
  {
    path: "/analyse/demo",
    title: "Exemple d'analyse",
    description: "Une offre de collab inventée, chiffrée comme une vraie : fourchette en euros, score sur 100, ce qu'il faut négocier et le message à envoyer.",
  },
  {
    path: "/tarifs",
    title: "Tarifs",
    description: `Première analyse gratuite. ${PLANS.filter((plan) => plan.id !== "free")
      .map((plan) => `${plan.name} : ${plan.price}${plan.period ? ` ${plan.period}` : ""}, ${plan.summary.toLowerCase()}`)
      .join(". ")}. Prix TTC.`,
  },
  {
    path: "/cgv",
    title: "Conditions générales de vente",
    description: `Conditions de vente des analyses ${BRAND.name} : formules et prix, paiement, rétractation, résiliation de l'abonnement.`,
  },
  {
    path: "/confidentialite",
    title: "Politique de confidentialité",
    description: `Données traitées par ${BRAND.name}, durées de conservation, cookies, sous-traitants et exercice de tes droits.`,
  },
  {
    path: "/mentions-legales",
    title: "Mentions légales",
    description: `Éditeur, hébergeur et contact de ${BRAND.name}.`,
  },
];

// Préfixes jamais indexés : pages liées à une personne (analyses, compte,
// paiement), étapes de connexion, routes techniques. Interdits dans robots.txt,
// marqués noindex dans leurs métadonnées, et X-Robots-Tag sur les routes qui ne
// sont pas des pages (next.config.ts).
export const PRIVATE_PREFIXES = [
  "/analyse/resultat/",
  "/analyse/supprimee",
  "/api/",
  "/auth/",
  "/compte",
  "/connexion",
  "/historique",
  "/merci",
  "/resilier",
  "/dev/",
] as const;

// Métadonnées d'une page publique : titre, description, adresse canonique, et
// aperçu de partage. L'image (app/opengraph-image.tsx, commune à tout le site)
// est redonnée ici explicitement : les métadonnées se fusionnent en surface, et
// un openGraph défini par la page efface l'image héritée (constaté au build du
// 17/09/2026 sur /tarifs, /cgv, /analyse/demo).
const OG_IMAGE = { url: "/opengraph-image", ...SITE_PREVIEW_SIZE, alt: SITE_PREVIEW_ALT, type: "image/png" };
const TWITTER_IMAGE = { url: "/twitter-image", ...SITE_PREVIEW_SIZE, alt: SITE_PREVIEW_ALT, type: "image/png" };

export function publicPageMetadata(path: string): Metadata {
  const page = PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`Page publique inconnue : ${path}`);
  // L'accueil porte le titre complet ; les autres passent par le modèle « %s — Negoscore ».
  const title = path === "/" ? { absolute: page.title } : page.title;
  const shareTitle = path === "/" ? page.title : `${page.title} — ${BRAND.name}`;
  return {
    title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: BRAND.name,
      url: path,
      title: shareTitle,
      description: page.description,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description: page.description, images: [TWITTER_IMAGE] },
  };
}
