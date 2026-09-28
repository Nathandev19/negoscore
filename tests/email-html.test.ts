import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_TEMPLATE_VARIABLES, authTemplates, SIGN_IN_LINK } from "@/lib/email/auth-templates";
import { EMAIL_LOGO, EMAIL_WIDTH } from "@/lib/email/layout";
import { accountDeletionEmail, cancellationConfirmationEmail, purchaseConfirmationEmail } from "@/lib/email/templates";
import { SELLER } from "@/lib/legal/identity";

// Mission #044 : ce que les messageries rendent vraiment. Échoue si un email
// contient un <div> de mise en page, une feuille de style liée, une police
// personnalisée, une image de fond, ou dépasse 102 Ko (troncature Gmail).

const SITE = "https://www.negoscore.fr";
const GMAIL_CLIP_BYTES = 102 * 1024;
const ALLOWED_FONTS = new Set(["arial black", "arial", "helvetica", "sans-serif"]);

const date = new Date("2026-09-17T10:00:00Z");
const EMAILS: Array<{ name: string; html: string; supabase: boolean }> = [
  { name: "achat pack", html: purchaseConfirmationEmail({ to: "a@b.fr", plan: "pack", amount: 4.99, currency: "eur", date, siteUrl: SITE }).html!, supabase: false },
  { name: "achat pro", html: purchaseConfirmationEmail({ to: "a@b.fr", plan: "pro", amount: 12.99, currency: "eur", date, siteUrl: SITE }).html!, supabase: false },
  { name: "achat sans montant", html: purchaseConfirmationEmail({ to: "a@b.fr", plan: "pack", amount: null, currency: null, date, siteUrl: SITE }).html!, supabase: false },
  { name: "résiliation", html: cancellationConfirmationEmail({ to: "a@b.fr", endsAt: date, siteUrl: SITE }).html!, supabase: false },
  { name: "résiliation sans date", html: cancellationConfirmationEmail({ to: "a@b.fr", endsAt: null, siteUrl: SITE }).html!, supabase: false },
  { name: "suppression du compte", html: accountDeletionEmail({ to: "a@b.fr", siteUrl: SITE }).html!, supabase: false },
  ...authTemplates().map((t) => ({ name: t.name, html: t.html, supabase: true })),
];

describe.each(EMAILS)("email « $name »", ({ html, supabase }) => {
  it("pas de <div>, pas de feuille liée, pas de police personnalisée, pas d'image de fond", () => {
    expect(html).not.toMatch(/<div\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@font-face|@import|fonts\.googleapis|Bricolage|Familjen/i);
    expect(html).not.toMatch(/background-image|background:\s*url|url\(/i);
    const families = [...html.matchAll(/font-family:([^;"]+)/g)].flatMap((m) => m[1].split(",").map((f) => f.trim().replace(/'/g, "").toLowerCase()));
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) expect(ALLOWED_FONTS.has(family), family).toBe(true);
  });

  it("sous 102 Ko", () => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(GMAIL_CLIP_BYTES);
  });

  it("mise en page en tableaux de 600 px, mode sombre déclaré", () => {
    expect(html).toContain(`<table role="presentation" width="${EMAIL_WIDTH}"`);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain('bgcolor="#1f3cff"');
  });

  it("une seule image, avec texte alternatif et dimensions : l'email se lit sans elle", () => {
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('alt="Negoscore"');
    expect(images[0]).toContain(`width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}"`);
    // Sans image, le texte de l'email nomme quand même le produit.
    expect(html.replace(/<img\b[^>]*>/g, "").replace(/<[^>]+>/g, " ")).toMatch(/Negoscore/);
  });

  it("chaque bouton a son lien répété en texte", () => {
    const buttons = [...html.matchAll(/<td bgcolor="#1f3cff" style="background-color:#1f3cff;border-radius:6px;"><a href="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const url of buttons) {
      const visible = url.startsWith("mailto:") ? url.slice("mailto:".length) : url;
      expect(html).toContain(`>${visible}</a>`);
    }
  });

  it("pied : éditeur et politique de confidentialité ; pas d'emoji", () => {
    expect(html).toContain(SELLER.name);
    expect(html).toContain(SELLER.siret);
    expect(html).toContain(supabase ? "{{ .SiteURL }}/confidentialite" : `${SITE}/confidentialite`);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("gabarits Supabase (lien de connexion)", () => {
  it("toutes les variables du gabarit sont présentes, le lien est exactement celui qu'attend /auth/confirm", () => {
    const confirmRoute = readFileSync(path.join(process.cwd(), "app/auth/confirm/route.ts"), "utf8");
    expect(confirmRoute).toContain(SIGN_IN_LINK);
    for (const template of authTemplates()) {
      for (const variable of AUTH_TEMPLATE_VARIABLES) expect(template.html, `${template.name} ${variable}`).toContain(variable);
      // Bouton et lien texte : deux fois le lien complet, non échappé.
      expect(template.html.split(`href="${SIGN_IN_LINK}"`)).toHaveLength(3);
      expect(template.html).toContain("valable une heure");
      expect(template.html).toContain("Tu n'as rien demandé ?");
    }
  });

  it("les fichiers prêts à coller sont identiques à la source (pnpm email:templates)", () => {
    for (const template of authTemplates()) {
      const file = readFileSync(path.join(process.cwd(), template.file), "utf8").replace(/\r\n/g, "\n");
      expect(file, template.file).toBe(template.html);
    }
  });
});

describe("contenu", () => {
  it("confirmation d'achat : la confirmation de l'accord (L221-28 13°) est dans le texte ET dans le HTML", () => {
    const email = purchaseConfirmationEmail({ to: "a@b.fr", plan: "pro", amount: 12.99, currency: "eur", date, siteUrl: SITE });
    const consent = "Cet email constitue la confirmation de cet accord.";
    expect(email.text).toContain(consent);
    expect(email.html).toContain(consent);
    expect(email.html).toContain(`${SITE}/resilier`);
    expect(email.text).toContain(`${SITE}/resilier`);
  });

  it("confirmation d'achat sans montant reçu : le prix vient de la source unique des offres", () => {
    const email = purchaseConfirmationEmail({ to: "a@b.fr", plan: "pack", amount: null, currency: null, date, siteUrl: SITE });
    expect(email.text).toContain("Montant : 4,99 €");
    // Mission #122 — l'assertion visait le REPLI (« voir le reçu Whop »), pas
    // le mot : l'email dit désormais, à dessein, que le reçu est émis par Whop,
    // revendeur. Ce qu'elle protège est inchangé : le prix vient de PLANS.
    expect(email.text).not.toContain("voir le reçu Whop");
  });

  it("le pack n'annonce pas de résiliation", () => {
    const email = purchaseConfirmationEmail({ to: "a@b.fr", plan: "pack", amount: 4.99, currency: "eur", date, siteUrl: SITE });
    expect(email.html).not.toContain("/resilier");
  });
});

describe("mission #048 — aucune mention de TVA dans l'email d'achat", () => {
  it("ni « 293 B », ni « TVA », ni « TTC », dans le texte brut comme dans le HTML, pour chaque formule", () => {
    for (const plan of ["pack", "pro"] as const) {
      for (const amount of [4.99, null]) {
        const email = purchaseConfirmationEmail({ to: "a@b.fr", plan, amount, currency: amount === null ? null : "eur", date, siteUrl: SITE });
        for (const version of [email.text, email.html ?? ""]) {
          expect(version).not.toMatch(/293\s*B|TVA|TTC|\bHT\b/);
        }
      }
    }
  });
});
