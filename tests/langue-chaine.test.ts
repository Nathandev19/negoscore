import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseExtraction } from "@/lib/fixtures/preview-states";

// Mission #210 — LA CHAÎNE ENTIÈRE : reprise, puis réparation, JAMAIS d'échec.
//
// Le module lib/llm/langue.ts est éprouvé à part (tests/langue-sortie.test.ts).
// Ce fichier-ci éprouve ce qui compte pour l'utilisatrice : ce qui se passe
// quand le modèle fuit une fois, deux fois, et que le résultat doit malgré
// tout arriver à l'écran. Les deux exigences de la mission sont là :
//   — une sortie rejetée ne laisse NI page cassée NI analyse vide ;
//   — les cas légitimes ne sont pas cassés.

const PHRASE_DU_BUG =
  "Les contenus sont demandés en échange de produits בלבד, avec une éventuelle rémunération seulement pour une future collaboration.";

const appels = vi.hoisted(() => ({ sorties: [] as string[], recues: 0 }));

vi.mock("openai", () => {
  class OpenAI {
    responses = {
      create: async () => {
        const sortie = appels.sorties[appels.recues] ?? appels.sorties.at(-1) ?? "{}";
        appels.recues += 1;
        return {
          output_text: sortie,
          usage: {
            input_tokens: 1000,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 900,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        };
      },
    };
  }
  return { default: OpenAI };
});

const { extractDeal } = await import("@/lib/llm/extract");

const OFFRE = "On te propose notre routine complète en échange de 2 publications Instagram. Pas de budget pour cette campagne.";

// Une extraction valide, avec le risque qu'on veut faire fuir ou non.
function sortie(whyDuPremierRisque: string): string {
  const base = baseExtraction();
  return JSON.stringify({
    ...base,
    red_flags: [
      { label: "Aucune rémunération", severity: "high", why: whyDuPremierRisque },
      { label: "Droits non bornés", severity: "medium", why: "La durée d'utilisation n'est pas précisée." },
    ],
  });
}

let journal: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  appels.sorties = [];
  appels.recues = 0;
  vi.stubEnv("OPENAI_API_KEY", "cle-de-test");
  journal = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const dit = () => journal.mock.calls.flat().join(" ");

describe("une fuite au premier essai : on redemande au modèle", () => {
  it("DEUX APPELS, et la seconde sortie est celle qui arrive à l'écran", async () => {
    appels.sorties = [sortie(PHRASE_DU_BUG), sortie("Aucune rémunération n'est prévue.")];
    const resultat = await extractDeal(OFFRE);
    expect(appels.recues).toBe(2);
    expect(resultat.extraction.red_flags).toHaveLength(2);
    expect(resultat.extraction.red_flags[0].why).toBe("Aucune rémunération n'est prévue.");
    // Rien n'a été retiré : la reprise a suffi.
    expect(dit()).toContain("langue_fuite_reprise");
    expect(dit()).not.toContain("langue_fuite_reparee");
  });

  it("la reprise est comptée comme telle : le schéma n'était pas bon du premier coup", async () => {
    appels.sorties = [sortie(PHRASE_DU_BUG), sortie("Aucune rémunération prévue.")];
    const resultat = await extractDeal(OFFRE);
    expect(resultat.attempts).toBe(2);
    expect(resultat.schemaValidFirstTry).toBe(false);
  });
});

describe("une fuite aux DEUX essais : on répare, on n'échoue pas", () => {
  it("AUCUNE EXCEPTION, et l'analyse arrive complète sauf le point fautif", async () => {
    appels.sorties = [sortie(PHRASE_DU_BUG), sortie(PHRASE_DU_BUG)];
    const resultat = await extractDeal(OFFRE);
    expect(appels.recues).toBe(2);
    // Le point fautif part, l'autre reste : ni page cassée, ni analyse vide.
    expect(resultat.extraction.red_flags).toHaveLength(1);
    expect(resultat.extraction.red_flags[0].label).toBe("Droits non bornés");
    expect(dit()).toContain("langue_fuite_reparee");
  });

  it("LE RESTE DE L'ANALYSE EST INTACT : le deal, les points favorables, le message", async () => {
    const base = baseExtraction();
    appels.sorties = [sortie(PHRASE_DU_BUG), sortie(PHRASE_DU_BUG)];
    const resultat = await extractDeal(OFFRE);
    expect(resultat.extraction.deal).toEqual(base.deal);
    expect(resultat.extraction.good_points).toEqual(base.good_points);
    expect(resultat.extraction.ready_to_send_message).toEqual(base.ready_to_send_message);
    expect(resultat.extraction.negotiate).toEqual(base.negotiate);
  });

  it("une analyse dont TOUS les risques fuient rend une liste vide, pas une erreur", async () => {
    // Cas extrême : il ne reste aucun risque du modèle. L'analyse tient
    // quand même — le chiffrage, le verdict et la couche légale ne viennent
    // pas du modèle.
    const base = baseExtraction();
    const tous = JSON.stringify({
      ...base,
      red_flags: [{ label: "Aucune rémunération", severity: "high", why: PHRASE_DU_BUG }],
    });
    appels.sorties = [tous, tous];
    const resultat = await extractDeal(OFFRE);
    expect(resultat.extraction.red_flags).toEqual([]);
    expect(resultat.extraction.deal).toEqual(base.deal);
  });
});

describe("le chemin normal ne coûte rien", () => {
  it("une sortie propre : UN SEUL appel, aucun journal", async () => {
    appels.sorties = [sortie("Aucune rémunération n'est prévue pour cette campagne.")];
    const resultat = await extractDeal(OFFRE);
    expect(appels.recues).toBe(1);
    expect(resultat.schemaValidFirstTry).toBe(true);
    expect(dit()).not.toContain("langue_fuite");
  });

  it("LE MESSAGE PRÊT À ENVOYER N'EST PAS CONTRÔLÉ : il suit la langue de l'offre", async () => {
    // Le prompt le veut « dans la langue de l'offre » : le contrôler
    // refuserait une offre en hébreu, en russe ou en japonais. Il est exempté,
    // et ce test le verrouille.
    const base = baseExtraction();
    const avecMessageHebreu = JSON.stringify({
      ...base,
      ready_to_send_message: { ...base.ready_to_send_message, text: "שלום, תודה על ההצעה. {{CONTRE_OFFRE}}" },
    });
    appels.sorties = [avecMessageHebreu];
    const resultat = await extractDeal(OFFRE);
    expect(appels.recues).toBe(1);
    expect(resultat.extraction.ready_to_send_message.text).toContain("שלום");
    expect(dit()).not.toContain("langue_fuite");
  });

  it("LE NOM DE LA MARQUE N'EST PAS CONTRÔLÉ non plus", async () => {
    const base = baseExtraction();
    appels.sorties = [JSON.stringify({ ...base, deal: { ...base.deal, brand: "株式会社ABC" } })];
    const resultat = await extractDeal(OFFRE);
    expect(appels.recues).toBe(1);
    expect(resultat.extraction.deal.brand).toBe("株式会社ABC");
    expect(dit()).not.toContain("langue_fuite");
  });

  it("une offre DANS la langue qui fuyait ne déclenche rien", async () => {
    appels.sorties = [sortie(PHRASE_DU_BUG)];
    const resultat = await extractDeal("שלום, אנחנו מציעים לך שיתוף פעולה.");
    expect(appels.recues).toBe(1);
    expect(resultat.extraction.red_flags).toHaveLength(2);
    expect(dit()).not.toContain("langue_fuite");
  });
});

describe("ce qui part dans le journal", () => {
  it("il nomme le champ, l'écriture et les lettres — jamais la phrase", async () => {
    appels.sorties = [sortie(PHRASE_DU_BUG), sortie(PHRASE_DU_BUG)];
    await extractDeal(OFFRE);
    const brut = dit();
    expect(brut).toContain("red_flags[0].why");
    expect(brut).toContain("Hebrew");
    // La phrase décrit l'offre d'une créatrice : elle ne va pas dans un journal.
    expect(brut).not.toContain("rémunération");
    expect(brut).not.toContain("produits");
  });
});
