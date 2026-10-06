import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_EVENTS } from "@/lib/analytics/first-party";
import { MEASURED_PAGES } from "@/lib/analytics/views";

// Mission #142 — PostHog retiré, la mesure PREMIÈRE PARTIE ne perd rien.
//
// Il coûtait ~380 ms de blocage du fil principal et 96,7 ko transférés sur
// chaque page, pour chaque visiteur (mesuré en #141). Et personne ne le lisait :
// la règle du projet depuis #103 est « on lit /admin, jamais PostHog ».
//
// Ce fichier tient la condition posée par la mission : aucun événement de
// /api/events ou de /api/vue ne disparaît, et le cockpit affiche exactement les
// mêmes chiffres après qu'avant.
//
// LE CAS LE PLUS DÉLICAT, ET IL EST RÉGLÉ : trois composants émettaient à la
// fois vers PostHog et en première partie — ou le paraissaient. Vérification
// faite, AUCUN ne le faisait : les événements du cockpit sont tous écrits par
// le SERVEUR (recordProductEvent), et les appels track() du navigateur
// n'alimentaient que PostHog. Le détail est dans le rapport de la mission.

const lire = (p: string) => readFileSync(p, "utf8");

// Les écrans et routes qui écrivent de la mesure première partie.
const ÉMETTEURS = [
  "components/analytics/first-party-view.tsx",
  "components/analytics/view-pixel.tsx",
  "components/result/tier-selector.tsx",
  "app/api/events/route.ts",
  "app/api/vue/route.ts",
  "app/api/analyse/route.ts",
  "app/api/checkout/route.ts",
  "app/api/whop/webhook/route.ts",
  "lib/analytics/first-party.ts",
];

describe("la mesure première partie survit au retrait de PostHog", () => {
  it("aucun émetteur ne mentionne la bibliothèque retirée", () => {
    for (const fichier of ÉMETTEURS) {
      const source = lire(fichier);
      expect(source, fichier).not.toContain("posthog");
      expect(source, fichier).not.toContain("captureServerEvent");
      expect(source, fichier).not.toContain("@/lib/analytics/client");
      expect(source, fichier).not.toContain("@/lib/analytics/events");
    }
  });

  it("les modules de la mesure tierce n'existent plus, et aucun n'est importé", () => {
    for (const disparu of [
      "lib/analytics/client",
      "lib/analytics/server",
      "lib/analytics/events",
      "lib/analytics/distinct-id",
      "components/analytics/track-view",
      "components/analytics/paywall-view",
      "components/analytics/analytics-provider",
    ]) {
      expect(() => lire(`${disparu}.ts`), disparu).toThrow();
      expect(() => lire(`${disparu}.tsx`), disparu).toThrow();
    }
  });

  it("la table des événements du produit est INTACTE", () => {
    // C'est elle que lit le cockpit. Si un nom disparaissait, une colonne du
    // tableau de bord tomberait à zéro sans que rien ne le dise.
    expect([...PRODUCT_EVENTS]).toEqual([
      "landing_view",
      "pricing_view",
      "analysis_started",
      "analysis_completed",
      "feedback_submitted",
      "signup",
      "negotiation_started",
      "negotiation_turn",
      "negotiation_concluded",
      "checkout_started",
      "purchase_completed",
      "guide_view",
      "example_view",
      "tier_changed",
      "analysis_page_view",
    ]);
  });

  it("les pages mesurées par le pixel incluent l'analyse", () => {
    expect(Object.keys(MEASURED_PAGES).sort()).toEqual(
      ["/analyse", "/analyse/demo", "/combien-facturer", "/droits-utilisation", "/produits-offerts"].sort(),
    );
  });

  it("les deux vues du navigateur partent toujours, et seules elles", () => {
    const route = lire("app/api/events/route.ts");
    expect(route).toContain('const PUBLIC_EVENTS = ["landing_view", "pricing_view", "tier_changed"]');
    // L'accueil et les tarifs les émettent toujours.
    expect(lire("app/page.tsx")).toContain('<FirstPartyView event="landing_view" />');
    expect(lire("app/tarifs/page.tsx")).toContain('<FirstPartyView event="pricing_view" />');
  });

  it("le revenu reste écrit, côté serveur, dans product_events", () => {
    const webhook = lire("app/api/whop/webhook/route.ts");
    expect(webhook).toContain('event: "purchase_completed"');
    expect(webhook).toContain("recordProductEvent");
    // Et plus rien ne part vers un tiers depuis ce chemin.
    expect(webhook).not.toContain("captureServerEvent");
  });

  it("le checkout reste mesuré, sans identifiant anonyme à transporter", () => {
    const checkout = lire("app/api/checkout/route.ts");
    expect(checkout).toContain('event: "checkout_started"');
    // `ph_distinct_id` n'existait que pour relier l'achat au parcours DANS
    // PostHog. L'attribution première partie, elle, voyage toujours.
    expect(checkout).not.toContain("ph_distinct_id");
    expect(checkout).toContain("attribution");
    expect(lire("lib/billing/whop-events.ts")).not.toContain("ph_distinct_id");
    expect(lire("components/offers/plan-checkout-form.tsx")).not.toContain("ph_distinct_id");
  });

  it("le nettoyage des résidus d'avant la mission #049 reste fait", () => {
    // Un visiteur venu avant garde un cookie ph_… jusqu'à 12 mois. Plus rien ne
    // l'écrit ni ne le lit, mais il ne s'effacerait pas seul : on continue de
    // le retirer.
    const nettoyage = lire("components/arrival-cleanup.tsx");
    expect(nettoyage).toContain("clearAnalyticsResidue");
    expect(nettoyage).toContain('RESIDUE_PREFIX = "ph_"');
    // Et le paramètre ?connexion=ok continue d'être retiré de l'adresse.
    expect(nettoyage).toContain('url.searchParams.delete("connexion")');
    expect(lire("app/layout.tsx")).toContain("<ArrivalCleanup />");
  });

  it("plus aucun sous-traitant tiers de mesure n'est déclaré", () => {
    // Laisser un sous-traitant déclaré qui n'existe plus est aussi faux que
    // d'en oublier un (le piège de #139, dans l'autre sens).
    const page = lire("app/confidentialite/page.tsx");
    expect(page).not.toContain("PostHog");
    for (const reste of ["Supabase —", "Vercel —", "OpenAI —", "Resend —"]) {
      expect(page, reste).toContain(reste);
    }
  });
});
