import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalNotice } from "@/components/result/analysis-blocks";
import { excerpt } from "@/components/result/negotiation/negotiation-thread";
import { RAW_FOOTAGE_LABEL } from "@/lib/content/labels";
import { tooManyOpenings } from "@/lib/content/vocabulaire";
import { dealRecapRows } from "@/lib/display";
import { computeFrLegal, readableClauses } from "@/lib/legal/fr";
import { currentState } from "@/lib/negotiation/current";
import { computeEstimate } from "@/lib/rates/engine";
import { TIERS, type Tier } from "@/lib/rates/tier";
import { clientIp, hashIp } from "@/lib/security/request";
import { limitRule, limitVerdict, OPENINGS_ACCOUNT, OPENINGS_ANON } from "@/lib/security/limite";
import { shareCardTexts } from "@/lib/share-card/element";
import sample from "@/lib/fixtures/sample-extraction.json";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #104 — l'écran de résultat, la carte partageable et la limite
// anonyme. Deux analyses réelles servent de cas de référence (23/09/2026).

type Deal = Analysis["deal"];
const BASE_DEAL = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);
const deal = (patch: Partial<Deal>): Deal => ({ ...BASE_DEAL, ...patch });

// ─── A1 — l'addition affichée tombe juste ───────────────────────────────────

// Un échantillon qui couvre plusieurs niveaux, plusieurs combinaisons de
// droits, avec et sans plafond de majoration.
const ECHANTILLON: Array<{ nom: string; deal: Deal }> = [
  {
    nom: "cas 1 — 1 TikTok, droits pub 12 mois, 250 €",
    deal: deal({
      brand: null,
      deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
      usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 12, territory: null },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      ip_transfer: "none",
      payment: { amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
      in_kind_value_eur: null,
    }),
  },
  {
    nom: "cas 2 — droits 6 mois, exclusivité 3 mois, rushs, deux plateformes",
    deal: deal({
      deliverables: [
        { type: "video", platform: "tiktok", quantity: 3, format: null },
        { type: "story", platform: "instagram", quantity: 2, format: null },
      ],
      usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null },
      exclusivity: { present: true, duration_months: 3, category: "cosmétique" },
      raw_footage: true,
      ip_transfer: "license",
      payment: { amount_eur: 450, currency: "EUR", terms_days: 30, schedule: null },
    }),
  },
  {
    nom: "plafond atteint — tout demandé, à vie, cession totale",
    deal: deal({
      deliverables: [{ type: "video", platform: "tiktok", quantity: 4, format: null }],
      usage: { organic: true, paid_ads: true, whitelisting: true, spark_ads: true, perpetual: true, duration_months: 24, territory: "monde entier" },
      exclusivity: { present: true, duration_months: 12, category: "tout" },
      raw_footage: true,
      ip_transfer: "full_assignment",
    }),
  },
  {
    nom: "sans aucun droit — création seule",
    deal: deal({
      deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
      usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      ip_transfer: "none",
    }),
  },
  {
    nom: "forfait en plus — accroches et CTA",
    deal: deal({
      deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: "3 hooks" }],
      usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 3, territory: null },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      ip_transfer: "none",
    }),
  },
];

describe("A1 — le total affiché est la somme des lignes affichées", () => {
  it("sur tout l'échantillon, à tous les niveaux, plafond ou non", () => {
    for (const tier of TIERS as readonly Tier[]) {
      for (const { nom, deal: subject } of ECHANTILLON) {
        const estimate = computeEstimate(subject, { tier });
        const sommeBasse = (estimate.base_low ?? 0) + estimate.lines.reduce((sum, line) => sum + line.eur_low, 0);
        const sommeHaute = (estimate.base_high ?? 0) + estimate.lines.reduce((sum, line) => sum + line.eur_high, 0);

        expect(estimate.total_low, `${nom} / ${tier} (bas)`).toBe(sommeBasse);
        expect(estimate.total_high, `${nom} / ${tier} (haut)`).toBe(sommeHaute);
        // Des euros entiers : rien à recomposer pour refaire l'addition.
        expect(Number.isInteger(estimate.total_low)).toBe(true);
        expect(estimate.lines.every((line) => Number.isInteger(line.eur_low) && Number.isInteger(line.eur_high))).toBe(true);
      }
    }
  });

  it("le plafond de majoration est réparti sur les lignes, pas retranché du seul total", () => {
    const plafonne = ECHANTILLON[2].deal;
    const estimate = computeEstimate(plafonne, { tier: "starter" });
    expect(estimate.assumptions.some((note) => note.includes("s'arrête à ce plafond"))).toBe(true);
    // L'addition tombe juste MALGRÉ le plafond : c'est ce qui prouve qu'il a
    // été appliqué ligne par ligne.
    const somme = (estimate.base_low ?? 0) + estimate.lines.reduce((sum, line) => sum + line.eur_low, 0);
    expect(estimate.total_low).toBe(somme);
  });

  it("allonger un droit ne fait jamais baisser le total : l'arrondi ne renverse pas l'ordre", () => {
    const at = (months: number) =>
      computeEstimate(
        deal({
          deliverables: [{ type: "photo", platform: "instagram", quantity: 4, format: null }],
          usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: months, territory: "Europe" },
          exclusivity: { present: true, duration_months: 2, category: null },
          raw_footage: false,
          ip_transfer: "none",
        }),
        { tier: "starter" },
      );
    for (let months = 1; months < 24; months += 1) {
      expect(at(months + 1).total_high, `${months} → ${months + 1} mois`).toBeGreaterThanOrEqual(at(months).total_high as number);
    }
  });
});

// ─── A2 — aucune puce vide, jamais ──────────────────────────────────────────

const legal = (clauses: string[]): Analysis["fr_legal"] => ({
  applicable: true,
  threshold_1000_reached: "no",
  written_contract_required: false,
  missing_mandatory_clauses: clauses,
  note: "Information générale.",
});

const puces = (html: string) => html.match(/<li>(.*?)<\/li>/g) ?? [];
const lisible = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&#xE9;", "é");

describe("A2 — le nombre annoncé et les puces affichées sont toujours égaux", () => {
  it("cas 1 : quatre mentions annoncées, quatre puces qui portent leur libellé", () => {
    const frLegal = computeFrLegal(ECHANTILLON[0].deal);
    expect(frLegal.missing_mandatory_clauses).toHaveLength(4);
    const html = renderToStaticMarkup(<LegalNotice legal={frLegal} />);
    expect(puces(html)).toHaveLength(4);
    expect(lisible(html)).toContain("4 mentions obligatoires absentes de l'offre.");
    for (const clause of frLegal.missing_mandatory_clauses) expect(html).toContain(`<li>${clause}</li>`);
    // Aucune puce sans texte.
    expect(html).not.toMatch(/<li>\s*<\/li>/);
  });

  it("des entrées invisibles : ni comptées, ni affichées", () => {
    // Espace, espace insécable, caractère de largeur nulle, marque de format.
    const html = renderToStaticMarkup(<LegalNotice legal={legal(["Modalités de paiement", "", "   ", " ", "​", "﻿"])} />);
    expect(lisible(html)).toContain("1 mention obligatoire absente de l'offre.");
    expect(puces(html)).toEqual(["<li>Modalités de paiement</li>"]);
  });

  it("toutes invisibles : le résumé et la liste disparaissent ensemble", () => {
    const html = renderToStaticMarkup(<LegalNotice legal={legal(["", "​", " "])} />);
    expect(lisible(html)).toContain("Aucune mention obligatoire ne manque à l'offre.");
    expect(puces(html)).toHaveLength(0);
    expect(lisible(html)).not.toContain("Mentions absentes de l'offre");
  });

  // Mission #115, B1 — la garde de la #104 n'a pas suffi : les deux côtés
  // filtraient bien par la même fonction, mais l'APPELAIENT chacun de leur
  // côté, et comptaient d'un côté, rendaient de l'autre. Le nombre et la liste
  // sortent maintenant d'un seul objet (missingClausesView).
  it("le compte et les puces sortent du MÊME objet, pas de deux appels", () => {
    expect(readableClauses(["a", "", "​", " b "])).toEqual(["a", "b"]);
    const rendu = readFileSync("components/result/analysis-blocks.tsx", "utf8");
    expect(rendu).toContain("missingClausesView(legal)");
    expect(rendu).not.toContain("readableClauses(");
    const calcul = readFileSync("lib/legal/fr.ts", "utf8");
    expect(calcul).toContain("readableClauses(");
  });
});

// ─── A3 — un concept, un libellé, en français ───────────────────────────────

describe("A3 — aucune chaîne visible en anglais pour un concept français", () => {
  it("les rushs bruts portent le même nom dans le chiffrage et dans le deal lu", () => {
    const withRushes = ECHANTILLON[1].deal;
    const estimate = computeEstimate(withRushes, { tier: "starter" });
    const ligne = estimate.lines.find((line) => line.topic === "raw_footage");
    expect(ligne?.label).toBe(RAW_FOOTAGE_LABEL);
    expect(dealRecapRows(withRushes).find((row) => row.value === "Inclus")?.label).toBe(RAW_FOOTAGE_LABEL);
    expect(RAW_FOOTAGE_LABEL).toBe("Rushs bruts");
  });

  it("« Raw footage » n'apparaît plus dans aucun libellé rendu à l'écran", () => {
    for (const file of ["lib/rates/engine.ts", "lib/display.ts", "components/result/analysis-blocks.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("Raw footage");
    }
    // Et le mot ne revient pas par la fourchette calculée.
    for (const { deal: subject } of ECHANTILLON) {
      for (const line of computeEstimate(subject, { tier: "confirmed" }).lines) {
        expect(line.label).not.toMatch(/raw footage/i);
      }
    }
  });
});

// ─── A4 — l'extrait identifie le message, il ne salue pas ───────────────────

describe("A4 — l'extrait du message sortant", () => {
  it("une salutation n'est jamais l'extrait", () => {
    const message = "Bonjour Camille,\n\nMerci pour votre message.\n\nPour ce projet, mon tarif se situe entre 845 € et 1 088 €.\n\nBelle journée,";
    const extrait = excerpt(message);
    expect(extrait).not.toMatch(/^Bonjour|^Hello|^Salut/);
    expect(extrait).not.toMatch(/^Merci/);
    // Ce qui identifie CE message : son tarif.
    expect(extrait).toContain("845");
  });

  it("sans tarif, la première ligne utile, jamais la politesse", () => {
    expect(excerpt("Hello,\nMerci pour ta proposition.\nJe peux te livrer la semaine du 12.")).toBe("Je peux te livrer la semaine du 12.");
  });

  it("un message qui n'est que politesse : on rend quelque chose plutôt que rien", () => {
    expect(excerpt("Bonjour,")).toBe("Bonjour,");
    expect(excerpt("")).toBe("");
  });
});

// ─── D — la carte porte le montant du message d'acceptation ─────────────────

const fil = (turns: Array<{ turnNumber: number; dealAmount: number | null; offered: number | null }>, concluded: number | null = null) => ({
  turns: turns.map((turn) => ({
    turnNumber: turn.turnNumber,
    payload: {
      deal_after: deal({ payment: { amount_eur: turn.dealAmount, currency: "EUR", terms_days: null, schedule: null } }),
      closing: { accept: { offered: turn.offered } },
      conclusion: null,
    },
  })),
  conclusion:
    concluded === null
      ? null
      : {
          payload: {
            deal: deal({ payment: { amount_eur: 600, currency: "EUR", terms_days: null, schedule: null } }),
            conclusion: { offered: concluded },
          },
        },
});

const view = (amount: number | null) =>
  ({
    deal: deal({ payment: { amount_eur: amount, currency: "EUR", terms_days: null, schedule: null }, in_kind_value_eur: null }),
    estimate: { total_low: 1260, total_high: 3060, rate_table_version: "fr-2026.3" },
    evaluability: "complete" as const,
    score: { value: 60, band: "fair" as const },
    profile_tier: "confirmed" as const,
  }) as unknown as Parameters<typeof shareCardTexts>[0];

describe("D — carte et message d'acceptation disent le même montant", () => {
  // Six états de négociation, du plus simple au plus retors.
  const etats: Array<{ nom: string; thread: ReturnType<typeof fil>; attendu: number | null }> = [
    { nom: "plafond annoncé après un montant ferme", thread: fil([{ turnNumber: 2, dealAmount: 600, offered: 900 }]), attendu: 900 },
    { nom: "montant ferme après un plafond", thread: fil([{ turnNumber: 2, dealAmount: 600, offered: 900 }, { turnNumber: 3, dealAmount: 900, offered: null }]), attendu: null },
    { nom: "aucun montant sur la table", thread: fil([{ turnNumber: 2, dealAmount: null, offered: null }]), attendu: null },
    { nom: "plafond plus bas que les termes", thread: fil([{ turnNumber: 2, dealAmount: 900, offered: null }]), attendu: null },
    { nom: "deux tours, plafond au dernier", thread: fil([{ turnNumber: 2, dealAmount: 600, offered: null }, { turnNumber: 3, dealAmount: 600, offered: 900 }]), attendu: 900 },
    { nom: "conclusion enregistrée", thread: fil([{ turnNumber: 2, dealAmount: 600, offered: 900 }], 900), attendu: 900 },
  ];

  it("le montant de la carte est LU, pas recalculé", () => {
    const route = readFileSync("app/analyse/resultat/[id]/carte/route.ts", "utf8");
    expect(route).toContain("negotiated?.offered");
    // Plus aucun second calcul dans la route.
    expect(route).not.toContain("offeredAmount");
    expect(route).not.toContain("pricingOf");
  });

  it("sur six états, carte = message d'acceptation", () => {
    for (const { nom, thread, attendu } of etats) {
      const state = currentState(thread);
      expect(state, nom).not.toBeNull();
      // Ce que porte l'acceptation, enregistré par le moteur.
      expect(state?.offered, nom).toBe(attendu);

      // Ce que la carte affiche, à partir de cette même valeur.
      const carte = shareCardTexts(view(state?.deal.payment.amount_eur ?? null), state?.offered ?? null);
      const montant = state?.offered ?? state?.deal.payment.amount_eur ?? null;
      if (montant === null) {
        expect(carte.proposes, nom).toBeNull();
      } else {
        expect(carte.proposes, nom).toContain(String(montant).slice(0, 1));
        expect(carte.proposes, nom).not.toBeNull();
      }
    }
  });

  it("le plafond annoncé passe devant les termes, et 600 € ne s'affiche plus", () => {
    const state = currentState(fil([{ turnNumber: 2, dealAmount: 600, offered: 900 }]));
    const carte = shareCardTexts(view(600), state?.offered ?? null);
    expect(carte.proposes).toContain("900");
    expect(carte.proposes).not.toContain("600");
  });

  it("la carte reste anonyme", () => {
    const carte = shareCardTexts(view(600), 900);
    expect(JSON.stringify(carte)).not.toMatch(/marque exemple|camille/i);
  });
});

// ─── E — la limite anonyme ──────────────────────────────────────────────────

describe("E — le filet anonyme ne bloque plus des visiteurs entre eux", () => {
  const compteur = () => {
    const counts = new Map<string, number>();
    return (requester: { userId: string | null; ip: string }) => {
      const rule = limitRule("ouverture", requester);
      if (!rule) return limitVerdict(null, null);
      const count = (counts.get(rule.key) ?? 0) + 1;
      counts.set(rule.key, count);
      return limitVerdict(rule, { allowed: count <= rule.limit, retryInMinutes: 42 });
    };
  };

  it("30 ouvertures anonymes depuis la même adresse passent, la 31e est refusée", () => {
    expect(OPENINGS_ANON).toBe(30);
    const hit = compteur();
    for (let index = 0; index < 30; index += 1) {
      expect(hit({ userId: null, ip: "203.0.113.7" }).allowed, `ouverture ${index + 1}`).toBe(true);
    }
    expect(hit({ userId: null, ip: "203.0.113.7" }).allowed).toBe(false);
  });

  it("un compte n'est pas affecté par le compteur anonyme de son adresse, ni l'inverse", () => {
    const hit = compteur();
    for (let index = 0; index <= OPENINGS_ANON; index += 1) hit({ userId: null, ip: "203.0.113.7" });
    expect(hit({ userId: null, ip: "203.0.113.7" }).allowed).toBe(false);
    // Même adresse, mais connectée : son compteur est vierge.
    expect(hit({ userId: "user-a", ip: "203.0.113.7" }).allowed).toBe(true);
    // Et réciproquement : saturer le compte ne ferme pas la porte aux anonymes
    // d'une autre adresse.
    for (let index = 0; index <= OPENINGS_ACCOUNT; index += 1) hit({ userId: "user-a", ip: "203.0.113.7" });
    expect(hit({ userId: "user-a", ip: "203.0.113.7" }).allowed).toBe(false);
    expect(hit({ userId: null, ip: "198.51.100.4" }).allowed).toBe(true);
  });

  it("deux adresses IPv6 distinctes ont deux compteurs distincts", () => {
    const first = "2a01:cb00:1234:5600:1111:2222:3333:4444";
    const second = "2a01:cb00:1234:5600:1111:2222:3333:4445";
    // L'adresse est prise ENTIÈRE, jamais tronquée sur un préfixe partagé.
    const request = (ip: string) => new Request("https://negoscore.fr/api/analyse", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
    expect(clientIp(request(first))).toBe(first);
    expect(hashIp(first, "sel")).not.toBe(hashIp(second, "sel"));
    expect(limitRule("ouverture", { userId: null, ip: first })?.key).not.toBe(limitRule("ouverture", { userId: null, ip: second })?.key);

    const hit = compteur();
    for (let index = 0; index <= OPENINGS_ANON; index += 1) hit({ userId: null, ip: first });
    expect(hit({ userId: null, ip: first }).allowed).toBe(false);
    expect(hit({ userId: null, ip: second }).allowed).toBe(true);
  });

  it("le refus ne reproche rien à qui n'a rien lancé", () => {
    const reseau = tooManyOpenings(42, "adresse");
    expect(reseau).toContain("depuis ce réseau");
    expect(reseau).toContain("42 min");
    expect(reseau).not.toMatch(/tu as lancé|analyses en une heure|crédit/i);
    expect(tooManyOpenings(42, "compte")).toContain("avec ce compte");
  });
});
