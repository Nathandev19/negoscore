// Mission #132 — LES QUATRE COULEURS DU COCKPIT, ET RIEN D'AUTRE.
//
// Assignation FIXE : une série garde sa couleur quoi qu'il arrive, même si une
// autre disparaît du graphique. Jamais de cycle, jamais de couleur générée à
// partir d'un index — c'est comme ça qu'on finit par lire une courbe pour une
// autre d'une période à la suivante.
//
// Les quatre valeurs ont été vérifiées sur le fond crème : bande de
// clarté, plancher de chroma, séparation daltonienne des paires adjacentes
// (ΔE ≥ 10,1), contraste ≥ 3:1. Elles ne se recomposent pas. Une cinquième
// série demande une vérification, pas une improvisation.
//
// `visites` vaut exactement --color-marque : c'est la couleur de la marque, et
// les visites sont la mesure qui porte tout le reste.
export const SERIES = ["visites", "analyses", "inscriptions", "achats"] as const;
export type Series = (typeof SERIES)[number];

// Les valeurs vivent dans app/globals.css, comme toutes les couleurs du
// produit : visites 1f3cff (c'est --color-marque), analyses c77d00,
// inscriptions 0f9b8e, achats b5179e. Ce module ne fait que les nommer.
export const SERIES_COLOR: Readonly<Record<Series, string>> = {
  visites: "var(--color-serie-visites)",
  analyses: "var(--color-serie-analyses)",
  inscriptions: "var(--color-serie-inscriptions)",
  achats: "var(--color-serie-achats)",
};

export const SERIES_LABEL: Readonly<Record<Series, string>> = {
  visites: "Visites",
  analyses: "Analyses",
  inscriptions: "Inscriptions",
  achats: "Achats",
};

// La couleur ne porte JAMAIS seule l'identité d'une série : chaque pastille est
// accompagnée du nom, et le texte garde les couleurs d'encre. « Brun » et
// « noir » étaient indiscernables à l'écran dans l'ancienne légende en phrase.
export function seriesColor(series: Series): string {
  return SERIES_COLOR[series];
}
