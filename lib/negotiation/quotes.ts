// Mission #080, F4 et F7 — une affirmation sur la marque n'est retenue que si
// l'extrait cité figure MOT POUR MOT dans ce qu'elle a écrit. Sinon, le point
// est traité comme sans réponse claire : l'outil ne prête rien à la marque.

// Mise en forme neutre avant comparaison : casse, espaces, apostrophes et
// guillemets typographiques, points de suspension. Les accents restent : un
// extrait sans accent là où la marque en a mis n'est pas une citation exacte.
export function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/…/g, "...")
    .replace(/[  \s]+/g, " ")
    .trim();
}

// Une citation trop courte (« ok », « oui ») est recevable si elle est dans le
// texte : c'est souvent toute la réponse. Une citation vide ne l'est jamais.
export function quoteIsIn(quote: string | null | undefined, source: string): boolean {
  if (!quote) return false;
  // Guillemets ou points de suspension ajoutés autour par le modèle : retirés.
  const cleaned = normalizeForQuote(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  if (cleaned.length === 0) return false;
  return normalizeForQuote(source).includes(cleaned);
}
