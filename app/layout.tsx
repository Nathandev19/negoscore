import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Polices auto-hébergées par next/font, avec police de repli ajustée en taille
// (adjustFontFallback) : pas de décalage de mise en page à leur arrivée.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--font-bricolage" });

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description: BRAND.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-surface">
        <AnalyticsProvider />
        {children}
      </body>
    </html>
  );
}
