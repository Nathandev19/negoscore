import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RightsAssignmentPage from "@/app/cession-droits-ugc/page";
import UgcContractPage from "@/app/contrat-ugc/page";
import UsageRightsPage from "@/app/droits-utilisation/page";
import sitemap from "@/app/sitemap";
import { FOOTER_COLUMNS } from "@/components/site-footer";
import { EXAMPLE_ORIGINS, GUIDE_PATHS, MEASURED_PAGES } from "@/lib/analytics/views";
import { BRAND } from "@/lib/brand";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import { SEUIL_ASSIETTE, SEUIL_CE_QUE_LE_PRODUIT_COMPTE } from "@/lib/legal/fr";
import { computeEstimate } from "@/lib/rates/engine";
import rates from "@/lib/rates/fr-2026.4.json";
import { CURRENT_RATE_VERSION } from "@/lib/rates/tables";
import { CANONICAL_ORIGIN, PUBLIC_PAGES, publicPageMetadata } from "@/lib/seo";
import type { Analysis } from "@/lib/schema";

// Mission #216 — LE CLUSTER DES DROITS, ET POURQUOI CES PAGES-LÀ.
//
// Search Console, trois mois au 22/11/2026 : le site est indexé, 45 impressions
// sur 28 jours, position moyenne 33,6, UN clic. Les seules requêtes qui rendent
// quelque chose : « achat de droits ugc » (24), « négos » et « negos » (6, de
// la navigation), « contrat ugc » (3). Et /combien-facturer, la page la plus
// travaillée, fait ZÉRO impression.
//
// Ce que ces chiffres disent : le pari « les créatrices cherchent combien
// facturer » est invisible ; ce qu'elles cherchent, ce sont les DROITS.
//
// D'où ce cluster : /droits-utilisation devient le pilier, /contrat-ugc et
// /cession-droits-ugc en sont les satellites. Deux pages, pas dix — et chacune
// répond à une requête RELEVÉE, pas supposée.
//
// Ce fichier tient ce qui ne doit pas se perdre :
//   1. le maillage est un GRAPHE vérifié, pas une intention : aucune page
//      orpheline, aucune à plus de deux clics de l'accueil ;
//   2. aucun chiffre publié qui ne soit recalculé depuis la table fr-2026.4 ;
//   3. aucune référence juridique au-delà de celles de la #215, et la
//      condition de champ de la #215 appliquée au contenu ;
//   4. aucune page qui répète une autre ;
//   5. chaque page finit sur le même geste : coller une offre.

const ROOT = process.cwd();
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const PILIER = "/droits-utilisation";
const SATELLITES = ["/contrat-ugc", "/cession-droits-ugc"] as const;
const CLUSTER = [PILIER, ...SATELLITES] as const;

const FICHIERS: Record<string, string> = {
  "/combien-facturer": "app/combien-facturer/page.tsx",
  "/produits-offerts": "app/produits-offerts/page.tsx",
  "/droits-utilisation": "app/droits-utilisation/page.tsx",
  "/droits-pub-6-mois": "app/droits-pub-6-mois/page.tsx",
  "/exclusivite-ugc": "app/exclusivite-ugc/page.tsx",
  "/contrat-ugc": "app/contrat-ugc/page.tsx",
  "/cession-droits-ugc": "app/cession-droits-ugc/page.tsx",
  "/": "app/page.tsx",
  "/analyse": "app/analyse/page.tsx",
  "/tarifs": "app/tarifs/page.tsx",
};

// Le texte réellement lu : le contenu du <main>, sans l'en-tête ni le pied de
// page communs, et sans balises.
function texteDe(Page: () => React.ReactElement): string {
  const html = renderToStaticMarkup(<Page />);
  return html
    .slice(html.indexOf("<main"), html.indexOf("</main>"))
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll(" ", " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PAGES = {
  "/droits-utilisation": texteDe(UsageRightsPage),
  "/contrat-ugc": texteDe(UgcContractPage),
  "/cession-droits-ugc": texteDe(RightsAssignmentPage),
} as const;

// ───────────────────────────────────────────────────────────────────────────
describe("1 — le maillage est un graphe, et il est vérifié", () => {
  // Les liens SORTANTS d'une page : ceux écrits dans son corps, plus ceux du
  // pied de page, qui est rendu sur toutes les pages. Un lien de pied de page
  // est un vrai chemin : c'est lui qui met chaque guide à un clic de l'accueil.
  const PIED = FOOTER_COLUMNS.flatMap((colonne) =>
    colonne.links.map((lien) => lien.href.split("?")[0]).filter((href) => href.startsWith("/")),
  );

  function sortants(chemin: string): string[] {
    const texte = source(FICHIERS[chemin]);
    const internes = [...texte.matchAll(/internalHrefFrom\("([^"]+)"/g)].map((m) => m[1]);
    const nus = [...texte.matchAll(/href="(\/[^"?#]*)"/g)].map((m) => m[1]);
    return [...new Set([...internes, ...nus, ...PIED])].filter((cible) => cible !== chemin);
  }

  it("aucune page du cluster n'est orpheline : au moins un lien entrant d'ailleurs", () => {
    for (const cible of CLUSTER) {
      const entrants = Object.keys(FICHIERS).filter((depart) => depart !== cible && sortants(depart).includes(cible));
      expect(entrants.length, `${cible} n'a aucun lien entrant`).toBeGreaterThan(0);
    }
  });

  it("chaque page du cluster se rejoint depuis l'accueil en deux clics au plus", () => {
    // Parcours en largeur réel depuis « / », sur le graphe construit ci-dessus.
    const profondeur = new Map<string, number>([["/", 0]]);
    let file = ["/"];
    while (file.length > 0) {
      const suivante: string[] = [];
      for (const courante of file) {
        const d = profondeur.get(courante)!;
        if (d >= 2) continue;
        for (const cible of sortants(courante)) {
          if (!profondeur.has(cible) && FICHIERS[cible]) {
            profondeur.set(cible, d + 1);
            suivante.push(cible);
          }
        }
      }
      file = suivante;
    }
    for (const cible of CLUSTER) {
      expect(profondeur.get(cible), `${cible} à plus de deux clics`).toBeLessThanOrEqual(2);
    }
  });

  it("le pilier cite ses deux satellites, et chaque satellite cite le pilier", () => {
    const pilier = source(FICHIERS[PILIER]);
    for (const satellite of SATELLITES) {
      expect(pilier, `pilier → ${satellite}`).toContain(`internalHrefFrom("${satellite}", ORIGINE)`);
      expect(source(FICHIERS[satellite]), `${satellite} → pilier`).toContain(`internalHrefFrom("${PILIER}", ORIGINE)`);
    }
    // Et les deux satellites se citent l'un l'autre : l'un dit ce qui doit être
    // écrit, l'autre ce que la clause la plus chère coûte.
    expect(source(FICHIERS["/contrat-ugc"])).toContain('internalHrefFrom("/cession-droits-ugc", ORIGINE)');
    expect(source(FICHIERS["/cession-droits-ugc"])).toContain('internalHrefFrom("/contrat-ugc", ORIGINE)');
  });

  it("les deux satellites sont publics, mesurés, et leur origine est dans la liste fermée", () => {
    for (const chemin of SATELLITES) {
      expect(PUBLIC_PAGES.map((page) => page.path), chemin).toContain(chemin);
      expect(sitemap().map((entry) => entry.url), chemin).toContain(`${CANONICAL_ORIGIN}${chemin}`);
      expect(GUIDE_PATHS as readonly string[], chemin).toContain(chemin);
      expect(MEASURED_PAGES[chemin], chemin).toBe("guide_view");
      // Sans cette entrée, un clic DEPUIS cette page arrive sans origine :
      // `viewPixelUrl` jette ce que la table fermée ne connaît pas.
      expect(EXAMPLE_ORIGINS[chemin.slice(1)], chemin).toBe(chemin);
      expect(source(FICHIERS[chemin])).toContain(`<ViewPixel page="${chemin}" />`);
      // Un seul H1 par page.
      const html = renderToStaticMarkup(chemin === "/contrat-ugc" ? <UgcContractPage /> : <RightsAssignmentPage />);
      expect([...html.matchAll(/<h1[^>]*>/g)], chemin).toHaveLength(1);
    }
  });

  it("titres et descriptions s'affichent en entier, et portent l'année", () => {
    const suffixe = ` — ${BRAND.name}`;
    for (const chemin of CLUSTER) {
      const page = PUBLIC_PAGES.find((entry) => entry.path === chemin)!;
      expect(`${page.title}${suffixe}`.length, `${chemin} titre`).toBeLessThan(60);
      expect(page.description.length, `${chemin} description`).toBeLessThan(155);
      expect(page.title, `${chemin} année`).toContain("2026");
      expect(publicPageMetadata(chemin).description, chemin).toBe(page.description);
    }
    // Mission #216 — le pilier porte enfin les mots tapés.
    expect(PUBLIC_PAGES.find((page) => page.path === PILIER)!.title).toContain("Achat de droits UGC");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("2 — aucun chiffre qui ne vienne de la table fr-2026.4", () => {
  type Deal = Analysis["deal"];
  const deal = (part: Partial<Deal> = {}): Deal =>
    ({
      brand: null,
      deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
      publication_required: true,
      diffusion: "creator",
      usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null, territory_zones: [] },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      ip_transfer: "license",
      ai_training_rights: "absent",
      revisions: { count: null, unlimited: false },
      payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
      in_kind_value_eur: null,
      variable_pay: { present: false, rate_percent: null, base: null, per_sale_eur: null, attribution_days: null, payout: null },
      deadlines: [],
      kill_fee: null,
      termination: null,
      governing_law: null,
      ...part,
    }) as Deal;

  const nombre = (value: number) => value.toLocaleString("fr-FR").replace(/[  ]/g, " ");
  const euros = (low: number, high: number) => `${nombre(low)} à ${nombre(high)} €`;
  // Même nombre, autre tournure : la page met le total en relief dans une
  // phrase (« entre X et Y € »), comme /droits-pub-6-mois.
  const entre = (low: number, high: number) => `entre ${nombre(low)} et ${nombre(high)} €`;
  const pourcents = (low: number, high: number) => `+${Math.round(low * 100)} à +${Math.round(high * 100)} %`;

  function total(tier: "starter" | "confirmed" | "experienced", part: Partial<Deal>, quantity = 1) {
    const estimate = computeEstimate(
      deal({ ...part, deliverables: [{ type: "video", platform: "tiktok", quantity, format: null }] }),
      { tier },
    );
    return { low: estimate.total_low as number, high: estimate.total_high as number };
  }

  const CESSION: Partial<Deal> = { ip_transfer: "full_assignment" };

  it("/cession-droits-ugc : les trois niveaux sont le total recalculé par le moteur", () => {
    const texte = PAGES["/cession-droits-ugc"];
    for (const tier of ["starter", "confirmed", "experienced"] as const) {
      const { low, high } = total(tier, CESSION);
      expect(texte, `${tier} ${euros(low, high)}`).toContain(euros(low, high));
    }
  });

  it("/cession-droits-ugc : les trois vidéos et le cumul avec la pub sont recalculés aussi", () => {
    const trois = total("starter", CESSION, 3);
    expect(PAGES["/cession-droits-ugc"]).toContain(entre(trois.low, trois.high));
    const cumul = total("starter", {
      ...CESSION,
      usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null, territory_zones: [] },
    });
    expect(PAGES["/cession-droits-ugc"]).toContain(euros(cumul.low, cumul.high));
    // Et le plafond du moteur est bien atteint sur ce cumul : la page le dit,
    // elle ne l'invente pas.
    const plafond = rates.uplift_caps.heavy.max_cumulative_uplift;
    expect(cumul.high).toBe(Math.round(rates.base_rates_eur.starter.high * (1 + plafond)));
    expect(PAGES["/cession-droits-ugc"]).toContain("plafonné");
  });

  it("la majoration de cession annoncée est celle de la table", () => {
    const m = rates.multipliers.ip_full_assignment;
    expect(PAGES["/cession-droits-ugc"]).toContain(`${Math.round(m.low * 100)} à ${Math.round(m.high * 100)} %`);
    expect(PAGES["/cession-droits-ugc"]).toContain(pourcents(m.low, m.high));
  });

  it("le sommaire des prix du pilier : chaque ligne vient d'un multiplicateur de la table", () => {
    const texte = PAGES[PILIER];
    const m = rates.multipliers;
    for (const [nom, cle] of [
      ["pub 1 mois", "paid_ads_1m"],
      ["pub 6 mois", "paid_ads_6m"],
      ["pub 12 mois", "paid_ads_12m"],
      ["pub à vie", "paid_ads_perpetual"],
      ["marquage blanc", "whitelisting_per_month"],
      ["exclusivité 3 mois", "exclusivity_3m"],
      ["exclusivité 6 mois et plus", "exclusivity_6m_plus"],
      ["rushs", "raw_footage"],
      ["monde", "territory_worldwide"],
      ["cession", "ip_full_assignment"],
    ] as const) {
      const ligne = m[cle];
      expect(texte, `${nom} (${cle})`).toContain(pourcents(ligne.low, ligne.high));
    }
  });

  it("les deux pages qui chiffrent disent de quelle table viennent leurs nombres", () => {
    for (const chemin of [PILIER, "/cession-droits-ugc"] as const) {
      expect(PAGES[chemin], chemin).toContain(`Table de tarifs ${CURRENT_RATE_VERSION}`);
      expect(PAGES[chemin], chemin).toContain("pas un tarif officiel");
    }
    expect(CURRENT_RATE_VERSION).toBe(rates.version);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("3 — les références juridiques, et la condition de champ de la #215", () => {
  const sources = CLUSTER.map((chemin) => [chemin, source(FICHIERS[chemin])] as const);

  it("aucune référence au-delà de celles autorisées, texte ET source", () => {
    for (const [chemin, brut] of sources) {
      const articles = [...new Set(brut.match(/\bL\d{3}-\d+/g) ?? [])];
      expect(articles, `${chemin} articles`).toEqual(articles.length > 0 ? ["L131-3"] : []);
      const numeros = [...new Set(brut.match(/\d{4}-\d{3,4}/g) ?? [])];
      for (const numero of numeros) {
        expect(["2023-451", "2025-1137"], `${chemin} : n° ${numero}`).toContain(numero);
      }
      for (const interdit of [/code de commerce/i, /code civil/i, /code de la consommation/i, /RGPD/, /jurisprudence/i]) {
        expect(brut, `${chemin} ${interdit}`).not.toMatch(interdit);
      }
    }
  });

  it("l'obligation de contrat écrit n'est jamais affirmée sans sa condition de champ", () => {
    // Règle de la #215, appliquée au CONTENU : la loi du 9 juin 2023 ne couvre
    // que qui mobilise sa notoriété auprès de son audience. Une page qui parle
    // de l'obligation dit à qui elle s'applique, et ce qui vaut sinon.
    for (const chemin of CLUSTER) {
      const texte = PAGES[chemin];
      if (!/contrat écrit/i.test(texte)) continue;
      expect(texte, `${chemin} : condition de champ`).toMatch(/mobilise[^.]{0,120}notoriété[^.]{0,120}audience/i);
      expect(texte, `${chemin} : le cas hors champ`).toMatch(/ne s(?:'|’)applique pas/i);
      expect(texte, `${chemin} : ce qui vaut quand même`).toContain("L131-3");
    }
  });

  it("/contrat-ugc énonce le seuil, son décret, et sa date d'entrée en vigueur", () => {
    const texte = PAGES["/contrat-ugc"];
    expect(texte).toContain("à partir de 1 000 € HT");
    expect(texte).toContain("décret n° 2025-1137 du 28 novembre 2025");
    expect(texte).toContain("en vigueur depuis le 1er janvier 2026");
    expect(texte).toContain("loi n° 2023-451 du 9 juin 2023");
    // « au-delà de » dirait le contraire du calcul : l'article 8, II exonère ce
    // qui est INFÉRIEUR au seuil (mission #215).
    expect(texte).not.toContain("au-delà de 1 000");
  });

  it("l'assiette du seuil est littéralement celle de l'analyse", () => {
    // Même garantie que /produits-offerts depuis la #215 : la page REND les
    // constantes de lib/legal/fr.ts, elle ne les recopie pas. Le contenu et le
    // produit ne peuvent donc pas énoncer deux règles différentes.
    expect(PAGES["/contrat-ugc"]).toContain(SEUIL_ASSIETTE);
    expect(PAGES["/contrat-ugc"]).toContain(SEUIL_CE_QUE_LE_PRODUIT_COMPTE);
    expect(source(FICHIERS["/contrat-ugc"])).toContain("{SEUIL_ASSIETTE} {SEUIL_CE_QUE_LE_PRODUIT_COMPTE}");
    expect(source(FICHIERS["/contrat-ugc"])).not.toContain("au cours de la même année");
  });

  it("chaque page qui énonce du droit dit qu'elle n'est pas un conseil juridique", () => {
    for (const [chemin, brut] of sources) {
      if (!brut.includes("L131-3")) continue;
      expect(PAGES[chemin], chemin).toMatch(/pas un conseil juridique/i);
    }
  });

  it("le pilier garde la citation intégrale de L131-3, et personne ne la recopie", () => {
    // Une citation, une fois. Les satellites portent l'EXIGENCE et renvoient au
    // pilier pour le texte.
    const citation = "La transmission des droits de l'auteur est subordonnée à la condition";
    expect(PAGES[PILIER]).toContain(citation);
    for (const satellite of SATELLITES) expect(PAGES[satellite], satellite).not.toContain(citation);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LE GESTE FINAL, identique sur toutes les pages PAR CONSTRUCTION : la
// mission #216 demande que chaque page du cluster finisse sur le même geste,
// et cette phrase-là est une affirmation sur le produit (gratuit, sans
// compte, la réponse se débloque avec un email). La faire varier d'une page à
// l'autre, ce serait promettre des choses différentes du même service. Elle
// est donc exclue du comptage des répétitions, et le bloc 5 vérifie qu'elle
// est bien là partout.
const GESTE =
  "Colle le message tel que tu l'as reçu. " +
  "On te dit ce que le deal vaut en euros et ce qui manque dedans : c'est gratuit et sans compte. " +
  `La réponse à envoyer, mot pour mot, se débloque avec ton email. Analyser mon deal ${FULL_EXAMPLE.label}`;

// Les deux mentions que chaque page DOIT porter mot pour mot : la provenance
// des chiffres (c'est le disclaimer de la table elle-même) et le fait que ce
// n'est pas un conseil juridique. Les faire varier serait dire deux choses
// différentes de la même mesure et du même avertissement.
const MENTIONS = [
  `Estimation fondée sur des benchmarks de marché, pas un tarif officiel. Table de tarifs ${CURRENT_RATE_VERSION}`,
  "Information générale, pas un conseil juridique. Nous ne sommes pas avocats",
];

// Les termes de l'article L131-3. On ne les reformule pas : la consigne de la
// #215 interdit de réécrire un texte de loi, donc deux pages qui énoncent la
// même exigence emploient forcément les mêmes mots. Le pilier en porte la
// citation intégrale, les satellites l'exigence ; aucun des deux ne peut la
// dire autrement.
const ARTICLE =
  "que chacun des droits cédés fasse l'objet d'une mention distincte dans l'acte de cession et que le domaine " +
  "d'exploitation des droits cédés soit délimité quant à son étendue et à sa destination, quant au lieu et quant à la durée";

describe("4 — aucune page ne répète une autre", () => {
  // « Du texte qui répète la même chose sous trois titres différents » est
  // exactement ce que la mission refuse. On le MESURE : des suites de huit mots
  // communes à deux pages du cluster. Huit mots, c'est trop long pour une
  // tournure de hasard et trop court pour échapper à un copier-coller.
  function empreintes(texte: string): Set<string> {
    const mots = texte
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + 8 <= mots.length; i += 1) out.add(mots.slice(i, i + 8).join(" "));
    return out;
  }

  it("deux pages du cluster ne partagent aucune suite de huit mots", () => {
    const fautes: string[] = [];
    for (let i = 0; i < CLUSTER.length; i += 1) {
      for (let j = i + 1; j < CLUSTER.length; j += 1) {
        const a = empreintes(PAGES[CLUSTER[i]]);
        const b = empreintes(PAGES[CLUSTER[j]]);
        // L'assiette du seuil est une CONSTANTE partagée volontairement : elle
        // est exclue, et son partage est garanti ailleurs (bloc 3).
        const partagees = [...a].filter((suite) => b.has(suite));
        // Deux exclusions, et deux seulement : l'assiette du seuil est une
        // constante PARTAGÉE VOLONTAIREMENT (bloc 3 le garantit), et le nom
        // d'un article de loi est identique par construction — on ne demande
        // pas à deux pages de citer L131-3 sous deux noms différents.
        const attendues = empreintes(
          [
            SEUIL_ASSIETTE,
            SEUIL_CE_QUE_LE_PRODUIT_COMPTE,
            "l'article L131-3 du Code de la propriété intellectuelle demande",
            ARTICLE,
            GESTE,
            ...MENTIONS,
          ].join(" "),
        );
        const reelles = partagees.filter((suite) => !attendues.has(suite));
        for (const suite of reelles) fautes.push(`${CLUSTER[i]} / ${CLUSTER[j]} : « ${suite} »`);
      }
    }
    expect(fautes).toEqual([]);
  });

  it("chaque page du cluster a son propre poids de texte", () => {
    for (const chemin of CLUSTER) {
      const mots = PAGES[chemin].split(/\s+/).filter((mot) => /[\p{L}\p{N}]/u.test(mot));
      expect(mots.length, `${chemin} : ${mots.length} mots`).toBeGreaterThanOrEqual(600);
      expect(mots.length, `${chemin} : ${mots.length} mots`).toBeLessThanOrEqual(1400);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("5 — chaque page finit sur le même geste : coller une offre", () => {
  it("un bouton vers /analyse, et le lien vers l'exemple chiffré", () => {
    for (const chemin of CLUSTER) {
      const brut = source(FICHIERS[chemin]);
      expect(brut, `${chemin} → /analyse`).toContain('<Link href="/analyse">');
      expect(brut, `${chemin} → exemple`).toContain("exampleHrefFrom(ORIGINE)");
      // Et le geste est le DERNIER de la page : rien après la dernière section.
      const dernier = PAGES[chemin].lastIndexOf("Analyser mon deal");
      expect(dernier, `${chemin} : le bouton n'est pas en fin de page`).toBeGreaterThan(PAGES[chemin].length * 0.8);
    }
  });

  it("aucun formulaire d'email, aucun lead magnet", () => {
    // La mission l'exclut explicitement. Le texte peut DIRE que la réponse se
    // débloque avec un email — c'est vrai —, mais aucune page du cluster ne
    // demande une adresse pour télécharger quoi que ce soit.
    for (const chemin of CLUSTER) {
      const brut = source(FICHIERS[chemin]);
      for (const interdit of [/<form/i, /type="email"/, /newsletter/i, /télécharge[rz]?\s+(?:le|la|notre|ton)/i, /\.pdf/i]) {
        expect(brut, `${chemin} ${interdit}`).not.toMatch(interdit);
      }
    }
  });
});
