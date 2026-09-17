import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Familjen_Grotesk } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { FlashBanner } from "@/components/flash-banner";
import { BRAND } from "@/lib/brand";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { CANONICAL_ORIGIN } from "@/lib/seo";
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
  themeColor: STATIC_PALETTE.marque,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${familjen.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-creme">
        <AnalyticsProvider />
        {/* Confirmation de connexion ou de déconnexion, au-dessus de la page d'arrivée. */}
        <FlashBanner />
        {children}
      </body>
    </html>
  );
}
