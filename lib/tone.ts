// Mission #084, B2 — le ton d'un message s'affiche dans un vocabulaire fixe,
// le même partout (premier message, tours, conclusion). Le modèle écrit son
// ton librement (« ferme et cordial », « Chaleureux et ferme ») : il est ramené
// ici à l'un de ces trois libellés, jamais affiché tel quel.
export const TONES = {
  firm: "Poli et ferme",
  warm: "Poli et chaleureux",
  clear: "Poli et clair",
} as const;
export type ToneLabel = (typeof TONES)[keyof typeof TONES];

const FIRM = /ferme|firm|assertive|direct/i;
const WARM = /chaleur|cordial|amical|aimable|bienveill|enthousias|sympa|warm|friendly/i;

// Ferme l'emporte : un message qui tient une position est d'abord ferme, même
// écrit chaleureusement. Sinon chaleureux, sinon clair.
export function toneLabel(raw: string | null | undefined): ToneLabel {
  const text = raw ?? "";
  if (FIRM.test(text)) return TONES.firm;
  if (WARM.test(text)) return TONES.warm;
  return TONES.clear;
}
