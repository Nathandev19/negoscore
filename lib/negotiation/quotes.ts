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

// Mission #081, A — une citation vraie peut dire le contraire de la marque.
// Vu en production : la marque écrit « on ne peut pas s'engager sur un délai
// de paiement inférieur à 45 jours », l'outil cite « délai de paiement
// inférieur à 45 jours ». Mot pour mot, mais coupé de sa négation : à l'écran,
// ça se lit comme un accord.
//
// Une citation n'est donc recevable que si, dans la même phrase, rien avant
// elle ne la nie, ne la restreint, ne la conditionne ni ne la borne. Ces mots
// servent aussi à lire un nombre (lib/negotiation/written.ts) : « pas moins de
// 45 jours » est une borne, pas une valeur.
export const QUALIFIER =
  /(^|[^\p{L}])(?:n'|jusqu'|qu'à condition|(?:ne|pas|jamais|aucune?|ni|sauf|except[ée]e?s?|hormis|impossible|refus\p{L}*|condition|conditions|r[ée]serve|si|s'il|moins|au plus|au moins|minimum|maximum|max|min|inf[ée]rieure?s?|sup[ée]rieure?s?|not|no|never|unless|except|only if|at least|at most|up to|cannot|can't|won't|don't|doesn't|less|more than)(?![\p{L}]))/iu;

// Début de la phrase qui contient la position donnée.
export function clauseStart(text: string, index: number): number {
  const before = text.slice(0, index);
  const cut = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(";"), before.lastIndexOf(":"), before.lastIndexOf("\n"));
  return cut + 1;
}

// La phrase de la marque, de son début jusqu'à la fin de la citation : ce qui
// est montré à la créatrice quand une citation est refusée pour ce motif.
function clauseOf(source: string, quote: string): string {
  const at = source.toLowerCase().indexOf(quote.toLowerCase());
  if (at < 0) return quote;
  return source.slice(clauseStart(source, at), at + quote.length).trim();
}

export type QuoteCheck = { ok: true } | { ok: false; reason: "absent" } | { ok: false; reason: "cut"; clause: string };

// Citation présente mot pour mot ET non coupée de ce qui la nie ou la
// conditionne. Une citation qui commence elle-même par la négation (« on ne
// peut pas… ») est recevable : c'est la phrase entière.
export function checkQuote(quote: string | null | undefined, source: string): QuoteCheck {
  if (!quoteIsIn(quote, source)) return { ok: false, reason: "absent" };
  const text = normalizeForQuote(source);
  const cleaned = normalizeForQuote(quote as string).replace(/^["'.\s]+|["'.\s]+$/g, "");
  // Une seule occurrence libre suffit : la même phrase peut apparaître deux fois.
  for (let at = text.indexOf(cleaned); at >= 0; at = text.indexOf(cleaned, at + 1)) {
    if (!QUALIFIER.test(text.slice(clauseStart(text, at), at))) return { ok: true };
  }
  return { ok: false, reason: "cut", clause: clauseOf(source, (quote as string).trim()) };
}
