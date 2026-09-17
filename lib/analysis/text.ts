// Longueur maximale du texte d'offre analysé. Source unique (mission #062,
// D1) : le formulaire annonce la limite, le serveur l'applique, et l'analyse
// dit ce qui s'est passé si elle a été atteinte. Les trois ne peuvent plus
// annoncer trois chiffres différents.

export const MAX_TEXT_LENGTH = 60_000;

// Écrit avec une espace normale, comme le message déjà en production.
export const MAX_TEXT_LENGTH_LABEL = "60 000";

export const TEXT_TRUNCATED_NOTE = `Ton texte dépassait ${MAX_TEXT_LENGTH_LABEL} caractères : seul le début a été analysé.`;
