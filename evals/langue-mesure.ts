import { SYSTEM_PROMPT } from "@/lib/llm/prompt";

// Mission #211 — LA PARTIE DE L'ÉVAL DE LANGUE QUI SE TESTE SANS APPELER
// LE MODÈLE.
//
// evals/langue.ts appelle l'API dès son chargement : aucun test ne peut
// l'importer. Ce qui se vérifie gratuitement vit donc ici — la construction
// du prompt comparé, et l'arithmétique des intervalles.
//
// CE QUE ÇA PROTÈGE : les deux chiffres du rapport. Si la consigne de langue
// est reformulée dans lib/llm/prompt.ts, la condition « en tête » ne se
// construit plus et l'éval n'a plus de sens ; si un intervalle est faux, le
// rapport annonce une précision qu'il n'a pas. tests/eval-langue.test.ts
// tient les deux.

// ── LA CONDITION COMPARÉE ───────────────────────────────────────────────────
//
// La consigne de langue vit au début du bloc ANALYSE, cinquième paragraphe du
// prompt, premier point d'une liste de douze (lib/llm/prompt.ts:129).
// L'article de Marchisio et al. (EMNLP 2024) mesure qu'une consigne ISOLÉE en
// tête ou en fin de prompt tient mieux qu'une consigne noyée dans une liste.
//
// CE QUI CHANGE, ET RIEN D'AUTRE : la ligne est DÉPLACÉE, pas réécrite. Mêmes
// mots, même ponctuation. La reformuler en même temps rendrait un écart
// mesuré inattribuable, et laisserait ouverte l'explication « le prompt est
// plus long » — ici la longueur ne bouge que du tiret de liste retiré.
export const CONSIGNE_LANGUE =
  "- Écris en français naturel, tutoie le créateur, phrases courtes, sans jargon, sans emoji, même si l'offre est dans une autre langue.";

export function promptEnTete(): string {
  if (!SYSTEM_PROMPT.includes(`${CONSIGNE_LANGUE}\n`)) {
    throw new Error("la consigne de langue n'a pas été retrouvée dans SYSTEM_PROMPT — le prompt a changé, l'éval doit être relue");
  }
  const sans = SYSTEM_PROMPT.replace(`${CONSIGNE_LANGUE}\n`, "");
  return `${CONSIGNE_LANGUE.slice(2)}\n\n${sans}`;
}

// ── LES INTERVALLES ─────────────────────────────────────────────────────────
//
// Intervalle de Wilson, et non l'intervalle normal : sur un taux proche de
// zéro, l'intervalle normal donne une borne basse négative, et une largeur
// NULLE quand on observe zéro succès — il annoncerait « 0 % [0 % ; 0 %] », ce
// qui est faux et ferait conclure à l'absence de fuite. Wilson reste
// informatif à zéro succès (Agresti & Coull, 1998). z = 1,96 : 95 %.
const Z = 1.959964;

export function wilson(succes: number, total: number): { taux: number; bas: number; haut: number } {
  if (total === 0) return { taux: NaN, bas: NaN, haut: NaN };
  const p = succes / total;
  const d = 1 + (Z * Z) / total;
  const centre = (p + (Z * Z) / (2 * total)) / d;
  const demi = (Z * Math.sqrt((p * (1 - p)) / total + (Z * Z) / (4 * total * total))) / d;
  return { taux: p, bas: Math.max(0, centre - demi), haut: Math.min(1, centre + demi) };
}

// Différence de deux proportions, méthode de Newcombe (1998, méthode 10) :
// l'intervalle de la différence se construit à partir des DEUX intervalles de
// Wilson. Contrairement à l'intervalle de Wald sur la différence, il ne
// s'effondre pas quand l'un des deux taux vaut zéro — exactement le cas qu'on
// risque d'avoir sur une fuite rare.
export function newcombe(
  a: { s: number; n: number },
  b: { s: number; n: number },
): { diff: number; bas: number; haut: number } {
  const wa = wilson(a.s, a.n);
  const wb = wilson(b.s, b.n);
  const diff = a.s / a.n - b.s / b.n;
  const bas = diff - Math.sqrt((wa.taux - wa.bas) ** 2 + (wb.haut - wb.taux) ** 2);
  const haut = diff + Math.sqrt((wa.haut - wa.taux) ** 2 + (wb.taux - wb.bas) ** 2);
  return { diff, bas, haut };
}
