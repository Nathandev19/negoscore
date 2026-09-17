// Brouillon du texte collé dans le formulaire d'analyse (mission #046) : le
// texte saisi n'est jamais perdu, même si l'analyse est refusée faute de droit
// et que la personne part choisir une formule ou se connecter avant de revenir.
//
// Gardé dans le navigateur seulement (localStorage), jamais envoyé ailleurs
// qu'à l'analyse. Effacé dès qu'une analyse aboutit, et ignoré au-delà de
// DRAFT_TTL_MS. Toute erreur de stockage (navigation privée, stockage bloqué)
// est silencieuse : le formulaire marche simplement sans brouillon.

export const DRAFT_KEY = "negoscore_brouillon";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type StoredDraft = { text: string; savedAt: number };

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(store: DraftStorage | null = storage(), now = Date.now()): string {
  try {
    const raw = store?.getItem(DRAFT_KEY);
    if (!raw) return "";
    const draft = JSON.parse(raw) as StoredDraft;
    if (typeof draft.text !== "string" || now - draft.savedAt > DRAFT_TTL_MS) return "";
    return draft.text;
  } catch {
    return "";
  }
}

export function saveDraft(text: string, store: DraftStorage | null = storage(), now = Date.now()): void {
  try {
    if (text.trim() === "") store?.removeItem(DRAFT_KEY);
    else store?.setItem(DRAFT_KEY, JSON.stringify({ text, savedAt: now } satisfies StoredDraft));
  } catch {
    // stockage indisponible
  }
}

export function clearDraft(store: DraftStorage | null = storage()): void {
  try {
    store?.removeItem(DRAFT_KEY);
  } catch {
    // stockage indisponible
  }
}

// Abonnement pour useSyncExternalStore : un autre onglet peut modifier le brouillon.
export function subscribeDraft(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
