import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { PLANS } from "@/lib/billing/plans";
import { FAQ } from "@/lib/content/home";
import { SELLER } from "@/lib/legal/identity";
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
    // Titre et description écrits pour ce que quelqu'un tape dans un moteur
    // (mission #051). Le H1 de la page reste la phrase de marque : le titre
    // d'onglet répond à la question, le H1 s'adresse à qui est déjà arrivé.
    // L'accueil vise « mon offre vaut combien », le guide vise « combien je
    // dois facturer » (mission #055) : deux intentions, deux titres.
    path: "/",
    title: `Cette collab vaut combien ? Négocie ton deal — ${BRAND.name}`,
    description:
      "Copilote de négociation pour créateurs UGC : ce que le deal vaut en euros, ce que tu cèdes, quoi répondre. Première négociation gratuite, sans compte.",
  },
  {
    path: "/analyse",
    title: "Analyser un deal",
    description:
      "Colle le DM, le mail ou le brief d'une marque, ou dépose une capture ou le PDF : fourchette en euros, points à négocier, et la négociation tour par tour.",
  },
  {
    path: "/analyse/demo",
    title: "Exemple : une offre de marque analysée",
    // « offre fictive » : la page affiche elle-même que l'offre est inventée
    // (mission #052). La description ne peut pas promettre autre chose.
    description:
      "Exemple sur une offre fictive : ce que valent les vidéos, les droits publicitaires et l'exclusivité, et par quoi commencer la négociation avec la marque.",
  },
  {
    path: "/combien-facturer",
    title: "Tarifs UGC : combien facturer une vidéo, une story, une photo",
    description:
      "Les fourchettes par vidéo selon ton niveau, ce que valent les droits pub et l'exclusivité, et les chiffres sur lesquels ouvrir la négociation avec une marque.",
  },
  {
    path: "/produits-offerts",
    title: "Collab contre produits offerts : ça vaut quoi ?",
    description:
      "Une marque te paie en produits. Ce que ça vaut vraiment, quand c'est acceptable, quand ça ne l'est jamais, et comment ouvrir la négociation sans te brader.",
  },
  {
    path: "/droits-utilisation",
    title: "Droits d'utilisation UGC : ce que tu vends vraiment",
    description:
      "Une marque veut diffuser ta vidéo en pub ? Ce n'est plus de la création, c'est une licence. Durée, supports, exclusivité : ce que ça vaut en négociation.",
  },
  {
    path: "/tarifs",
    title: "Tarifs",
    // Longueur tenue par tests/seo.test.tsx : les résumés de PLANS y entrent,
    // donc la phrase d'introduction reste courte.
    description: `Une négociation = un deal entier. ${PLANS.filter((plan) => plan.id !== "free")
      .map((plan) => `${plan.name} : ${plan.price}${plan.period ? ` ${plan.period}` : ""}, ${plan.summary.toLowerCase()}`)
      .join(". ")}. Prix TTC.`,
  },
  {
    path: "/cgv",
    title: "Conditions générales de vente",
    description: `Conditions de vente de ${BRAND.name} : ce que couvre une négociation, les formules et leurs prix, le paiement, la rétractation et la résiliation.`,
  },
  {
    path: "/confidentialite",
    title: "Politique de confidentialité",
    description: `Les données traitées par ${BRAND.name} pour une négociation, leurs durées de conservation, les cookies, les sous-traitants et l'exercice de tes droits.`,
  },
  {
    path: "/mentions-legales",
    title: "Mentions légales",
    description: `L'éditeur, l'hébergeur et le contact de ${BRAND.name}, le copilote de négociation pour créateurs UGC. Identité de l'entreprise et moyen de nous écrire.`,
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
  "/admin",
] as const;

// Métadonnées d'une page publique : titre, description, adresse canonique, et
// aperçu de partage. L'image (app/opengraph-image.tsx, commune à tout le site)
// est redonnée ici explicitement : les métadonnées se fusionnent en surface, et
// un openGraph défini par la page efface l'image héritée (constaté au build du
// 17/09/2026 sur /tarifs, /cgv, /analyse/demo).
const OG_IMAGE = { url: "/opengraph-image", ...SITE_PREVIEW_SIZE, alt: SITE_PREVIEW_ALT, type: "image/png" };
const TWITTER_IMAGE = { url: "/twitter-image", ...SITE_PREVIEW_SIZE, alt: SITE_PREVIEW_ALT, type: "image/png" };

// ─────────────────────────────────────────────────────────────────────────────
// DONNÉES STRUCTURÉES (mission #051)
//
// Ce qui est déclaré ici doit être vrai et vérifiable sur la page. Sont donc
// INTERDITS, et vérifiés par tests/seo.test.tsx : aggregateRating, review,
// ratingValue, et tout nombre d'utilisateurs, d'analyses ou de clients. Nous
// n'avons aucun avis et aucun chiffre réel ; un balisage inventé est une fausse
// déclaration. Les prix viennent de la source unique (lib/billing/plans.ts).
// ─────────────────────────────────────────────────────────────────────────────

// Logo carré 512 px, fond bleu opaque (app/icon2.tsx) : Google demande une
// image carrée d'au moins 112 px, sans transparence.
export const ORGANIZATION_LOGO = `${CANONICAL_ORIGIN}/icon2`;

// Comptes publics qui existent RÉELLEMENT, vérifiés à la main. Seul endroit à
// compléter quand un compte s'ouvre : il alimente sameAs. Un compte inexistant
// ici serait un signal négatif pour Google, et une fausse déclaration.
// Vérifiés le 18/09/2026 (mission #072) : TikTok (statusCode 0, uniqueId
// negoscore) et Instagram (page de profil @negoscore, pas « Profile n'est pas
// disponible »), chacun comparé à un compte inexistant.
export const SOCIAL_PROFILES = ["https://www.tiktok.com/@negoscore", "https://www.instagram.com/negoscore"] as const;

// Identifiants des trois entités (mission #069) : ils relient l'organisation,
// le site et l'application entre eux, et d'une page à l'autre.
export const ORGANIZATION_ID = `${CANONICAL_ORIGIN}/#organisation`;
export const WEBSITE_ID = `${CANONICAL_ORIGIN}/#site`;
export const APPLICATION_ID = `${CANONICAL_ORIGIN}/#application`;

// Mission #072 : l'adresse de contact est celle du pied de page (SELLER.email),
// jamais recopiée. Volontairement ABSENTS, et interdits par test : adresse
// postale, fondateur, date de fondation. L'adresse des mentions légales est une
// obligation légale, pas une raison de la servir en format machine, où elle
// devient moissonnable ; le nom du fondateur n'est pas décidé, donc pas publié.
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: BRAND.name,
    url: CANONICAL_ORIGIN,
    logo: ORGANIZATION_LOGO,
    email: SELLER.email,
    sameAs: [...SOCIAL_PROFILES],
  };
}

export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: BRAND.name,
    url: CANONICAL_ORIGIN,
    inLanguage: "fr-FR",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

// Offres : un Offer par formule, construit à partir de PLANS (lib/billing/plans.ts),
// la source de /tarifs. Le prix n'est jamais réécrit ici ; il est seulement
// converti au format attendu par schema.org (point décimal).
// Périodicité d'un abonnement → code d'unité UN/CEFACT. Une périodicité que
// cette table ne connaît pas fait échouer le build plutôt que de déclarer un
// rythme de facturation faux.
const PERIOD_UNIT: Record<string, string> = { "par mois": "MON" };

function periodUnit(period: string): string {
  const unit = PERIOD_UNIT[period];
  if (!unit) throw new Error(`Périodicité sans code d'unité schema.org : « ${period} ». Compléter PERIOD_UNIT dans lib/seo.ts.`);
  return unit;
}

function schemaPrice(displayed: string): string {
  return displayed.replace(/\s|€/g, "").replace(",", ".");
}

// Ce qu'est Negoscore, déclaré sur l'accueil et sur /tarifs (mission #069).
// La description est celle de l'accueil (PUBLIC_PAGES) : la promesse réelle du
// site, écrite une seule fois. Le résumé de chaque offre vient aussi de PLANS.
// Mission #093 : ce qui est déclaré ici décrit l'unité réellement vendue, la
// négociation, avec les mêmes mots et les mêmes nombres que la page.
export function softwareApplicationJsonLd() {
  const home = PUBLIC_PAGES.find((page) => page.path === "/");
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": APPLICATION_ID,
    name: BRAND.name,
    description: home?.description,
    url: CANONICAL_ORIGIN,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "fr-FR",
    publisher: { "@id": ORGANIZATION_ID },
    offers: PLANS.map((plan) => {
      const price = schemaPrice(plan.price);
      return {
        "@type": "Offer",
        name: plan.name,
        description: plan.summary,
        price,
        priceCurrency: "EUR",
        // Mission #122 — le prix affiché inclut la taxe. Exact : le compte Whop
        // est réglé sur « Type de taxe : Inclusif », et Whop, revendeur
        // (merchant of record), la collecte et la reverse selon le pays de
        // l'acheteur. Le montant publié est donc celui qui sera payé.
        //
        // AUCUN champ `seller` ici, et c'est délibéré : une absence n'affirme
        // rien, un vendeur faux affirmerait quelque chose d'inexact sur une
        // page publique. Le sujet se règle dans les CGV, en toutes lettres.
        valueAddedTaxIncluded: true,
        url: `${CANONICAL_ORIGIN}/tarifs`,
        // Abonnement : la périodicité vient de PLANS (PRO_PERIOD), dite avec
        // la propriété prévue pour (référence : 1 période), et non plus dans
        // « category », qui désigne une catégorie de produit.
        ...(plan.period
          ? {
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price,
                priceCurrency: "EUR",
                referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: periodUnit(plan.period) },
              },
            }
          : {}),
      };
    }),
  };
}

// FAQ de l'accueil (mission #093, étape 7). Balisée UNIQUEMENT parce qu'elle
// est réellement affichée, et à partir du MÊME tableau que la page
// (lib/content/home.ts) : les questions et réponses balisées ne peuvent donc
// pas diverger de celles qui sont lues à l'écran.
export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${CANONICAL_ORIGIN}/#faq`,
    inLanguage: "fr-FR",
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

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
