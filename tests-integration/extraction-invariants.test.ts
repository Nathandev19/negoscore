import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { extractDeal } from "@/lib/llm/extract";
import type { Analysis } from "@/lib/schema";

// Invariants d'extraction : ils appellent le modèle de production et coûtent
// des appels API. Lancés uniquement par `pnpm test:llm`, qui pose
// RUN_LLM_INVARIANTS=1 ; sautés partout ailleurs, y compris par
// `pnpm test:integration`, dont la configuration inclut ce dossier.
const enabled = process.env.RUN_LLM_INVARIANTS === "1";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "evals", "fixtures", name, "input.txt"), "utf8");
}

async function analyse(text: string): Promise<Analysis> {
  const { extraction } = await extractDeal(text);
  return composeAnalysis(extraction);
}

// Variante : autre nom de marque inventé, ponctuation, retours à la ligne et
// majuscules modifiés. AUCUN chiffre, AUCUNE durée, AUCUN droit ne change.
const VARIANTS: Array<{ name: string; brand: string; variant: string }> = [
  {
    name: "01-dm-cosmetique",
    brand: "Maison Corail",
    variant:
      "bonjour. on adore ton contenu. on te propose 300€ pour 2 vidéos tiktok, avec droits pub 6 mois ; 3 mois d'exclusivité sur la catégorie cosmétique ; raw footage inclus ; révisions illimitées ; paiement à 60 jours.\n\ndis-nous si ça te va\nl'équipe maison corail",
  },
  {
    name: "07-email-biscuits",
    brand: "Biscuiterie Solène",
    variant: `OBJET : COLLABORATION UGC — BISCUITERIE SOLÈNE
bonjour nora, je suis paul, responsable marketing chez biscuiterie solène, une marque de biscuits bio ; nous avons découvert ton compte, et nous aimons beaucoup ton univers.
nous cherchons une créatrice pour réaliser 2 vidéos UGC de 30 secondes qui ne seront pas publiées sur ton compte. Nous les utiliserons sur nos propres réseaux, et en publicité payante, pendant 3 mois, en France uniquement.
nous te proposons 500 € HT pour les deux vidéos ; nous aurons également besoin des rushs bruts ; deux séries de retours sont prévues ; le paiement se fait à 30 jours après la livraison ; et nous aimerions recevoir les vidéos sous 3 semaines après validation du brief.
est-ce que cela te conviendrait
bien à toi — paul garrigue, biscuiterie solène`,
  },
  {
    name: "11-brief-serum",
    brand: "Lumivert",
    variant: `Brief créateur : Lumivert.
campagne : sérum rosée de nuit. marque : lumivert (soins visage).

Livrables : 3 vidéos TikTok UGC, 30 à 60 secondes ; 2 hooks par vidéo ; pas de publication sur le compte du créateur.
Budget : 1 200 € HT pour l'ensemble.
Droits : publicité payante : 6 mois. whitelisting : 3 mois. territoire : France.
Exclusivité : 2 mois, catégorie soins visage.
Livraison : rushs bruts à fournir ; 2 séries de modifications ; script à valider le 1er octobre 2026, livraison finale le 15 octobre 2026.
Paiement : 30 jours fin de mois après réception de la facture.`,
  },
];

function withinPercent(a: number | null, b: number | null, percent: number): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= (percent / 100) * Math.max(Math.abs(a), Math.abs(b));
}

describe.skipIf(!enabled)("invariants d'extraction (modèle de production)", () => {
  it.each(VARIANTS)(
    "I11 — insensible au nom de marque et à la ponctuation : $name",
    async ({ name, variant }) => {
      const original = await analyse(fixture(name));
      const changed = await analyse(variant);
      const summary = (a: Analysis) =>
        `${a.evaluability}, ${a.estimate.total_low}–${a.estimate.total_high} €, score ${a.score?.value ?? "—"}`;
      const message = `origine : ${summary(original)} / variante : ${summary(changed)}\nvariante : ${JSON.stringify(changed.deal)}`;

      expect(changed.evaluability, message).toBe(original.evaluability);
      expect(withinPercent(original.estimate.total_low, changed.estimate.total_low, 10), message).toBe(true);
      expect(withinPercent(original.estimate.total_high, changed.estimate.total_high, 10), message).toBe(true);
      if (original.score === null || changed.score === null) {
        expect(changed.score, message).toBe(original.score);
      } else {
        expect(Math.abs(original.score.value - changed.score.value), message).toBeLessThan(5);
      }
    },
  );

  it.each([
    "Salut, on veut collab avec toi, ça te dit ?",
    "Hello ! On adore ton profil, on aimerait bosser avec toi sur notre prochaine campagne. Dispo ?",
    "Coucou, tu fais des collabs ? Envoie-nous tes tarifs stp",
  ])("I12 — un brief insuffisant n'est jamais analysé avec confiance : « %s »", async (text) => {
    const analysis = await analyse(text);
    const message = `${analysis.confidence}, ${analysis.evaluability} : ${JSON.stringify(analysis.deal)}`;
    expect(analysis.confidence, message).not.toBe("high");
    expect(analysis.evaluability, message).not.toBe("complete");
  });
});
