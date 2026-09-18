import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Familjen_Grotesk } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { DraftExpiry } from "@/components/draft-expiry";
import { FlashBanner } from "@/components/flash-banner";
import { ShownOnceTracker } from "@/components/shown-once-tracker";
import { JsonLd } from "@/components/seo/json-ld";
import { BRAND } from "@/lib/brand";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { JS_FLAG_SCRIPT } from "@/lib/no-js";
import { CANONICAL_ORIGIN, organizationJsonLd, webSiteJsonLd } from "@/lib/seo";
import "./globals.css";

// Polices auto-hébergées par next/font, avec police de repli ajustée en taille
// (adjustFontFallback) : pas de décalage de mise en page à leur arrivée.
const familjen = Familjen_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-familjen" });
// Police variable : on charge aussi les axes de taille optique et de largeur,
// pour régler la largeur au maximum de l'axe (font-stretch: 100%).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "wdth"],
  variable: "--font-bricolage",
});

// Valeurs communes à toutes les pages. Les pages publiques précisent titre,
// description, adresse canonique et aperçu (lib/seo.ts) ; les pages privées
// gardent cet aperçu générique, sans aucune donnée d'analyse, et sont en noindex.
export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description: BRAND.tagline,
  applicationName: BRAND.name,
  openGraph: { type: "website", locale: "fr_FR", siteName: BRAND.name },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Couleur de thème = le fond du site (mission #051). L'interface du
  // navigateur prolonge alors la page au lieu de poser un bandeau bleu que
  // rien ne prolonge en haut de l'écran. Le site n'a pas de mode sombre.
  themeColor: STATIC_PALETTE.creme,
  // Schéma de couleurs (mission #063) : « only light », rendu en
  // <meta name="color-scheme" content="only light">. C'est le mot-clé « only »
  // qui interdit à Chrome Android d'assombrir lui-même la page ; « light » seul
  // ne suffit pas. Sans lui, nos couleurs seraient réécrites à l'écran et les
  // contrastes vérifiés par tests/design.test.ts ne vaudraient plus rien.
  // Les e-mails, eux, restent en « light dark » (lib/email/layout.ts) : ils ont
  // un vrai bloc @media (prefers-color-scheme: dark). Deux surfaces, deux
  // règles, volontairement — ne pas les harmoniser.
  colorScheme: "only light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${familjen.variable} ${bricolage.variable} h-full antialiased`}
    >
      <head>
        {/* Mission #076 — « JavaScript actif », posé avant le premier affichage.
            Les messages pour une personne sans JavaScript (data-sans-js) et ce
            qui ne fonctionne qu'avec lui (data-avec-js) sont montrés ou
            masqués par globals.css selon cet attribut, JAMAIS par <noscript> :
            quand les scripts sont bloqués après la lecture de la page
            (extension, politique de sécurité, vue web d'une application), le
            navigateur a lu <noscript> comme du texte brut, et c'est le code
            qui s'affiche ou rien du tout. Ce script-ci ne s'exécute pas dans ce
            cas non plus : les messages restent visibles, en vrai balisage.
            Un attribut plutôt qu'une classe : React ne gère pas cet attribut
            sur <html> et ne le retire donc jamais (suppressHydrationWarning :
            il est ajouté avant l'hydratation, volontairement). */}
        <script dangerouslySetInnerHTML={{ __html: JS_FLAG_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-creme">
        {/* L'entité derrière le site : nom, adresse canonique, logo, compte
            public. Rien de chiffré, rien d'invérifiable (mission #051). */}
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={webSiteJsonLd()} />
        {/* Lien d'évitement (mission #062, A4) : invisible tant qu'il n'a pas
            le focus, il permet de sauter l'en-tête au clavier. */}
        <a
          href="#contenu"
          className="sr-only rounded-control bg-encre px-4 py-2 font-semibold text-creme focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Aller au contenu
        </a>
        <AnalyticsProvider />
        {/* Voit chaque changement de page : un message montré une fois ne
            revient pas quand on revient sur sa page (mission #068). */}
        <ShownOnceTracker />
        {/* Confirmation de connexion ou de déconnexion, au-dessus de la page d'arrivée. */}
        <FlashBanner />
        {/* N'affiche rien : efface le brouillon d'offre périmé (mission #062, D2). */}
        <DraftExpiry />
        {children}
      </body>
    </html>
  );
}
