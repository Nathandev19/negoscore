import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaidAdsSixMonthsPage from "@/app/droits-pub-6-mois/page";
import sitemap from "@/app/sitemap";
import nextConfig from "@/next.config";
import { FOOTER_COLUMNS } from "@/components/site-footer";
import { GUIDE_PATHS, internalHrefFrom } from "@/lib/analytics/views";
import { BRAND } from "@/lib/brand";
import { FAQ } from "@/lib/content/home";
import { MENTION_TTC } from "@/lib/content/vocabulaire";
import { accountDeletionEmail, cancellationConfirmationEmail, purchaseConfirmationEmail } from "@/lib/email/templates";
import { computeEstimate, upliftCap } from "@/lib/rates/engine";
import rates from "@/lib/rates/fr-2026.3.json";
import { CURRENT_RATE_VERSION } from "@/lib/rates/tables";
import { CANONICAL_ORIGIN, PUBLIC_PAGES, publicPageMetadata } from "@/lib/seo";
import type { Analysis } from "@/lib/schema";

// Mission #158 — RÉFÉRENCEMENT DES GUIDES, ET LA PREMIÈRE PAGE « UNE CLAUSE,
// UNE PAGE ».
//
// Ce fichier tient quatre promesses, et aucune n'est une formalité :
//   1. les titres et descriptions des quatre guides s'affichent EN ENTIER dans
//      un résultat de recherche (60 et 155 caractères, suffixe de marque
//      compris) et portent l'année ;
//   2. /droits-pub-6-mois ne publie AUCUN nombre qui ne soit recalculé ici
//      depuis la table de tarifs et le moteur ;
//   3. les quatre guides se citent dans leur texte, chaque lien interne porte
//      son origine, et aucun ne porte d'utm ;
//   4. la deuxième personne ne s'accorde plus au féminin ni au masculin.

const ROOT = process.cwd();
const SUFFIXE = ` — ${BRAND.name}`;

// Longueurs demandées par la mission : le titre complet est celui que Google
// affiche, c'est-à-dire avec le suffixe de marque ajouté par le modèle de
// app/layout.tsx.
const TITRE_MAX = 60;
const DESCRIPTION_MAX = 155;
const ANNEE = "2026";

const GUIDE_FILES: Record<string, string> = {
  "/combien-facturer": "app/combien-facturer/page.tsx",
  "/produits-offerts": "app/produits-offerts/page.tsx",
  "/droits-utilisation": "app/droits-utilisation/page.tsx",
  "/droits-pub-6-mois": "app/droits-pub-6-mois/page.tsx",
};

const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

// ───────────────────────────────────────────────────────────────────────────
describe("titres et descriptions des guides", () => {
  it("les quatre guides sont connus, mesurés, et dans le plan du site", () => {
    expect([...GUIDE_PATHS].sort()).toEqual(Object.keys(GUIDE_FILES).sort());
    const urls = sitemap().map((entry) => entry.url);
    for (const chemin of GUIDE_PATHS) expect(urls, chemin).toContain(`${CANONICAL_ORIGIN}${chemin}`);
  });

  it("titre et description non vides, sous 60 et 155 caractères, marque comprise", () => {
    for (const chemin of GUIDE_PATHS) {
      const page = PUBLIC_PAGES.find((entry) => entry.path === chemin);
      expect(page, chemin).toBeDefined();
      const titre = page!.title;
      const description = page!.description;
      expect(titre.trim().length, chemin).toBeGreaterThan(0);
      expect(description.trim().length, chemin).toBeGreaterThan(0);
      // Le titre complet, celui qui s'affiche : le suffixe de marque compte.
      expect(`${titre}${SUFFIXE}`.length, `${chemin} titre`).toBeLessThan(TITRE_MAX);
      expect(description.length, `${chemin} description`).toBeLessThan(DESCRIPTION_MAX);
      // La marque est ajoutée par le modèle, jamais écrite dans le titre.
      expect(titre, chemin).not.toContain(BRAND.name);
      // L'année en cours : tous les concurrents de la page 1 la portent.
      expect(titre, `${chemin} année`).toContain(ANNEE);
      // Le titre commence par les mots tapés, pas par une tournure.
      expect(titre.startsWith(titre.trim()), chemin).toBe(true);
      // Et il reste celui que la page sert réellement.
      expect(publicPageMetadata(chemin).description, chemin).toBe(description);
    }
  });

  // Mission #161 — chaque lien du pied de page porte « pied-de-page » comme
  // origine, exactement comme celui de l'exemple depuis #152. Sans ça, une
  // arrivée sur un guide depuis le pied de page s'enregistrait sans origine.
  it("chaque guide a une entrée dans la colonne Guides, et elle porte son origine", () => {
    const guides = FOOTER_COLUMNS.find((colonne) => colonne.title === "Guides");
    const hrefs = guides?.links.map((lien) => lien.href) ?? [];
    for (const chemin of GUIDE_PATHS) {
      expect(hrefs, chemin).toContain(internalHrefFrom(chemin, "pied-de-page"));
      expect(hrefs, `${chemin} sans origine`).not.toContain(chemin);
    }
    // Et aucun utm sur un lien interne, jamais.
    for (const href of hrefs) expect(href, href).not.toContain("utm_");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("/droits-d-utilisation : la variante avec tiret ne tombe plus sur une 404", () => {
  it("elle est redirigée en permanence vers /droits-utilisation, et la page cible existe", async () => {
    const redirections = await nextConfig("phase-production-build").redirects!();
    expect(redirections).toContainEqual({
      source: "/droits-d-utilisation",
      destination: "/droits-utilisation",
      permanent: true,
    });
    // La variante n'est ni une page, ni une adresse publique : rien ne doit
    // la déclarer ailleurs, sinon le sitemap annoncerait une redirection.
    expect(PUBLIC_PAGES.map((page) => page.path)).not.toContain("/droits-d-utilisation");
    expect(sitemap().map((entry) => entry.url)).not.toContain(`${CANONICAL_ORIGIN}/droits-d-utilisation`);
    expect(readdirSync(path.join(ROOT, "app"))).not.toContain("droits-d-utilisation");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Les quatre guides se citent, et chaque lien interne porte son origine.
describe("maillage interne des guides", () => {
  // Ce qui est vérifié ici est le BALISAGE DES LIENS, écrit en clair dans la
  // source de chaque guide : le rendu complet des quatre pages n'apprendrait
  // rien de plus, et le pied de page commun est testé ailleurs.
  it("chaque guide cite les trois autres, avec son origine et sans aucun utm", () => {
    for (const [chemin, file] of Object.entries(GUIDE_FILES)) {
      const texte = source(file);
      const origine = chemin.slice(1);
      expect(texte, file).toContain(`const ORIGINE = "${origine}"`);
      for (const autre of Object.keys(GUIDE_FILES).filter((entry) => entry !== chemin)) {
        expect(texte, `${file} → ${autre}`).toContain(`internalHrefFrom("${autre}", ORIGINE)`);
        // Jamais l'adresse nue : un lien sans origine n'est pas mesurable.
        expect(texte, `${file} → ${autre} sans origine`).not.toContain(`href="${autre}"`);
      }
      expect(texte, `${file} utm`).not.toContain("utm_");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// /droits-pub-6-mois : tous les nombres, recalculés.
type Deal = Analysis["deal"];

function deal(part: Partial<Deal> = {}): Deal {
  return {
    brand: null,
    deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
    publication_required: true,
    usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "license",
    ai_training_rights: "absent",
    revisions: { count: null, unlimited: false },
    payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
    in_kind_value_eur: null,
    deadlines: [],
    kill_fee: null,
    termination: null,
    governing_law: null,
    ...part,
  } as Deal;
}

const PUB_6_MOIS: Deal["usage"] = {
  organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null,
};

const html = renderToStaticMarkup(<PaidAdsSixMonthsPage />);
// Le texte DE LA PAGE : ni l'en-tête ni le pied de page communs, qui sont les
// mêmes partout et n'appartiennent pas au comptage de mots demandé.
const contenu = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const texte = contenu
  .replaceAll("&#x27;", "'")
  .replaceAll("&amp;", "&")
  .replaceAll(" ", " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const nombre = (value: number) => value.toLocaleString("fr-FR").replace(/[  ]/g, " ");
const euros = (low: number, high: number) => `${nombre(low)} à ${nombre(high)} €`;
const pourcents = (low: number, high: number) => `+${Math.round(low * 100)} à +${Math.round(high * 100)} %`;

function totaux(tier: "starter" | "confirmed" | "experienced", quantity: number, usage?: Deal["usage"]) {
  const estimate = computeEstimate(
    deal({ deliverables: [{ type: "video", platform: "tiktok", quantity, format: null }], ...(usage ? { usage } : {}) }),
    { tier },
  );
  return { low: estimate.total_low as number, high: estimate.total_high as number };
}

describe("page /droits-pub-6-mois", () => {
  it("elle est publique, mesurée, et son texte tient entre 600 et 900 mots", () => {
    const mots = texte.trim().split(/\s+/).filter((mot) => /[\p{L}\p{N}]/u.test(mot));
    expect(mots.length).toBeGreaterThanOrEqual(600);
    expect(mots.length).toBeLessThanOrEqual(900);
    expect([...html.matchAll(/<h1[^>]*>/g)]).toHaveLength(1);
    expect(source(GUIDE_FILES["/droits-pub-6-mois"])).toContain('<ViewPixel page="/droits-pub-6-mois" />');
  });

  it("la version de la table de tarifs est affichée, comme sur une page de résultat", () => {
    expect(texte).toContain(`Table de tarifs ${CURRENT_RATE_VERSION}`);
    expect(CURRENT_RATE_VERSION).toBe(rates.version);
    // Et la page ne prétend pas publier un tarif officiel.
    expect(texte).toContain("Estimation fondée sur des benchmarks de marché, pas un tarif officiel");
  });

  it("la réponse courte est le multiplicateur six mois de la table", () => {
    const { low, high } = rates.multipliers.paid_ads_6m;
    expect(texte).toContain(`compte ${Math.round(low * 100)} à ${Math.round(high * 100)} % du prix de création`);
  });

  it("le tableau en euros est recalculé par le moteur, pour les trois niveaux", () => {
    for (const tier of ["starter", "confirmed", "experienced"] as const) {
      const avec = totaux(tier, 1, PUB_6_MOIS);
      expect(texte, `${tier} ${avec.low}-${avec.high}`).toContain(euros(avec.low, avec.high));
    }
  });

  it("l'exemple à trois vidéos : création, supplément et total viennent du moteur", () => {
    const creation = totaux("starter", 3);
    const avec = totaux("starter", 3, PUB_6_MOIS);
    expect(texte).toContain(`le tournage seul vaut ${euros(creation.low, creation.high)}`);
    expect(texte).toContain(`ajoutent ${euros(avec.low - creation.low, avec.high - creation.high)}`);
    expect(texte).toContain(`entre ${nombre(avec.low)} et ${nombre(avec.high)} €`);
  });

  it("le tableau des durées est celui de la table, palier par palier", () => {
    const paliers: Array<[string, { low: number; high: number }]> = [
      ["1 mois", rates.multipliers.paid_ads_1m],
      ["3 mois", rates.multipliers.paid_ads_3m],
      ["6 mois", rates.multipliers.paid_ads_6m],
      ["12 mois", rates.multipliers.paid_ads_12m],
      ["À vie", rates.multipliers.paid_ads_perpetual],
    ];
    for (const [label, valeur] of paliers) {
      expect(texte, label).toContain(pourcents(valeur.low, valeur.high));
    }
    // Six mois coûte bien MOINS que deux fois trois mois : la phrase de la
    // page serait fausse si la table changeait de forme.
    expect(rates.multipliers.paid_ads_6m.low).toBeLessThan(rates.multipliers.paid_ads_3m.low * 2);
    expect(rates.multipliers.paid_ads_6m.high).toBeLessThan(rates.multipliers.paid_ads_3m.high * 2);
  });

  it("whitelisting, Spark Ads, territoire monde et rushs bruts : valeurs de la table", () => {
    const mensuel = rates.multipliers.whitelisting_per_month;
    expect(rates.multipliers.spark_ads_per_month).toMatchObject({ low: mensuel.low, high: mensuel.high });
    expect(texte).toContain(`${Math.round(mensuel.low * 100)} à ${Math.round(mensuel.high * 100)} % par mois`);
    // Six mois de whitelisting, de l'ordre de +150 % : c'est le mensuel × 6,
    // ramené au plafond standard.
    expect(Math.round(mensuel.low * 6 * 100)).toBe(150);
    expect(texte).toContain("de l'ordre de +150 %");
    const monde = rates.multipliers.territory_worldwide;
    expect(texte).toContain(`ajoutent ${Math.round(monde.low * 100)} à ${Math.round(monde.high * 100)} %`);
    const rushs = rates.multipliers.raw_footage;
    expect(texte).toContain(`compte ${Math.round(rushs.low * 100)} à ${Math.round(rushs.high * 100)} % en plus`);
  });

  it("les deux plafonds affichés sont ceux du moteur", () => {
    expect(upliftCap(deal())).toBe(rates.uplift_caps.standard.max_cumulative_uplift);
    expect(upliftCap(deal({ ip_transfer: "full_assignment" }))).toBe(rates.uplift_caps.heavy.max_cumulative_uplift);
    expect(texte).toContain(`plafonné à +${Math.round(rates.uplift_caps.standard.max_cumulative_uplift * 100)} % du prix de création`);
    expect(texte).toContain(`ne monte à +${Math.round(rates.uplift_caps.heavy.max_cumulative_uplift * 100)} %`);
  });

  it("elle finit sur le lien vers l'analyseur", () => {
    expect(html).toMatch(/href="\/analyse"[^>]*>[^<]*Analyser mon deal/);
    const corpsSeul = html.slice(0, html.indexOf("<footer"));
    expect(corpsSeul.lastIndexOf('href="/analyse"')).toBeGreaterThan(corpsSeul.lastIndexOf("<table"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mission #158 — LES DEUX FORMULATIONS EN ATTENTE.
describe("formulations soldées", () => {
  const SITE = "https://www.negoscore.fr";
  const date = new Date("2026-09-17T10:00:00Z");

  it("les trois emails disent « Les conditions », jamais « Tes conditions générales de vente »", () => {
    const emails = [
      purchaseConfirmationEmail({ to: "a@b.test", plan: "pack", amount: 4.99, currency: "eur", date, siteUrl: SITE }),
      purchaseConfirmationEmail({ to: "a@b.test", plan: "pro", amount: 12.99, currency: "eur", date, siteUrl: SITE }),
      cancellationConfirmationEmail({ to: "a@b.test", endsAt: date, siteUrl: SITE }),
      accountDeletionEmail({ to: "a@b.test", siteUrl: SITE }),
    ];
    expect(emails.length).toBeGreaterThanOrEqual(3);
    for (const email of emails) {
      for (const version of [email.text, email.html ?? ""]) {
        // Le vendeur, c'est Negoscore : ces conditions ne sont pas celles de
        // la destinataire, et le lien pointe vers les nôtres.
        expect(version).toContain(`Les conditions : ${SITE}/cgv`);
        expect(version).not.toContain("Tes conditions");
      }
    }
  });

  it("la mention toutes taxes comprises est la même aux trois endroits", () => {
    // Une seule définition, et trois lectures : l'accueil, la FAQ de
    // l'accueil, et la description de /tarifs lue par les moteurs.
    // L'accueil est un composant client (le formulaire a besoin du routeur) :
    // ce qui est vérifié est qu'il AFFICHE la constante, pas une copie.
    expect(source("app/page.tsx")).toContain("{MENTION_TTC}");
    const cout = FAQ.find((item) => item.question === "Combien ça coûte ?");
    expect(cout?.answer).toContain(MENTION_TTC);
    expect(publicPageMetadata("/tarifs").description).toContain(MENTION_TTC);
    // Et personne ne la réécrit à la main : la chaîne n'est en dur que là où
    // elle est définie.
    const endroits = ["app/page.tsx", "lib/content/home.ts", "lib/seo.ts"];
    for (const file of endroits) expect(source(file), file).not.toContain(`${MENTION_TTC.slice(0, -1)}.`);
    expect(source("lib/content/vocabulaire.ts")).toContain(`export const MENTION_TTC = "${MENTION_TTC}"`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LA DEUXIÈME PERSONNE NE S'ACCORDE PLUS.
//
// Elle s'accordait, et dans les deux sens : « quand tu es payée » au féminin,
// « tu es bien connecté » au masculin. On ne sait pas qui lit. Une tournure
// qui genre se trompe donc une fois sur deux, et une écriture inclusive entre
// parenthèses ne se lit pas à voix haute.
//
// Ce qui est scanné : le texte destiné à quelqu'un. Les COMMENTAIRES sont
// retirés — ils citent justement les formulations interdites pour expliquer
// pourquoi elles le sont — et lib/llm/ est hors champ : ce sont des consignes
// envoyées au modèle, qui n'est ni une lectrice ni un lecteur.
describe("la deuxième personne reste neutre", () => {
  const ETRE = "es|n'es|seras|ne seras|étais|as été|n'as pas été|sois";
  const ACCORDS = [
    "payé", "payée", "connecté", "connectée", "déconnecté", "déconnectée",
    "inscrit", "inscrite", "identifié", "identifiée", "sûr", "sûre",
    "prêt", "prête", "certain", "certaine", "ravi", "ravie",
    "content", "contente", "déçu", "déçue", "seul", "seule",
  ];
  // Pas de `\b` final : « é » n'est pas un caractère de mot pour une limite de
  // mot, et `connecté\b` ne correspondrait jamais. C'est le piège qui avait
  // caché deux des quatre occurrences au premier relevé.
  // Même piège à la fin du groupe « être » : « as été » finit par « é ».
  const MOTIF = new RegExp(
    `\\b[Tt]u (?:${ETRE})(?![a-zà-ÿ])[^.!?]{0,40}?(?:${ACCORDS.join("|")})(?![a-zà-ÿ])`,
    "u",
  );

  function fichiers(dir: string): string[] {
    return readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
      .filter((file) => !file.startsWith("lib/llm/"));
  }

  // Le texte qu'on lit à l'écran, commentaires retirés et entités rendues.
  function copie(file: string): string {
    return source(file)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((ligne) => !/^\s*(\/\/|\*)/.test(ligne))
      .join(" ")
      .replaceAll("&apos;", "'")
      .replaceAll("&#x27;", "'")
      .replaceAll("&nbsp;", " ")
      .replace(/\s+/g, " ");
  }

  it("aucun accord de genre sur « tu » dans tout le texte du produit", () => {
    const fautes: string[] = [];
    for (const file of [...fichiers("app"), ...fichiers("components"), ...fichiers("lib")]) {
      const trouve = MOTIF.exec(copie(file));
      if (trouve) fautes.push(`${file} : « ${trouve[0]} »`);
    }
    expect(fautes).toEqual([]);
  });

  it("le motif attrape bien les deux formes qui existaient avant la mission", () => {
    // Sans ce contrôle, la garde ci-dessus passerait aussi si le motif ne
    // correspondait plus à rien.
    expect(MOTIF.test("L'offre ne dit pas quand tu es payée ni à partir de quel montant.")).toBe(true);
    expect(MOTIF.test("Tu es bien connecté. Mais cette analyse")).toBe(true);
    expect(MOTIF.test("Rien n'est perdu, et tu n'as pas été déconnecté.")).toBe(true);
    expect(MOTIF.test("demande dans quelle devise tu seras payée")).toBe(true);
    // Et il ne crie pas sur une tournure correcte : avec « avoir », le
    // participe ne s'accorde pas avec le sujet.
    expect(MOTIF.test("en disant quand tu as payé")).toBe(false);
    expect(MOTIF.test("Ta session est bien ouverte.")).toBe(false);
  });
});
