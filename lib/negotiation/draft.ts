import { DRAFT_TTL_MS, type DraftStorage } from "@/lib/draft";

// Mission #099, points 13 et 14 (audits B15 et C3) — la réponse de la marque
// collée dans le fil ne se perd plus, et la clé d'idempotence non plus.
//
// Ce qui se perdait : on colle 8 000 caractères, l'outil refuse (texte trop
// long, hors sujet, panne), on recharge la page — tout est parti. Et la clé
// d'idempotence vivait dans un useRef : après un rechargement en plein
// traitement, un second envoi n'était plus reconnu comme le même tour. L'index
// unique de la base restait le dernier filet ; il redevient le dernier, plus
// le premier.
//
// Même règle que le brouillon du formulaire d'analyse (lib/draft.ts) : gardé
// dans le navigateur seulement, une clé par analyse, effacé dès qu'un tour
// aboutit et au-delà de 24 heures. Stockage indisponible (navigation privée,
// quota plein, cookies bloqués) : tout continue de fonctionner, sans
// brouillon — aucune lecture ni écriture n'est laissée sans filet.

type StoredTurnDraft = { reply: string; key: string | null; savedAt: number };

export function threadDraftKey(analysisId: string): string {
  return `negoscore_tour_${analysisId}`;
}

function storage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(analysisId: string, store: DraftStorage | null, now: number): StoredTurnDraft | null {
  try {
    const raw = store?.getItem(threadDraftKey(analysisId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as StoredTurnDraft;
    if (typeof draft.reply !== "string" || typeof draft.savedAt !== "number" || now - draft.savedAt > DRAFT_TTL_MS) {
      store?.removeItem(threadDraftKey(analysisId));
      return null;
    }
    return { reply: draft.reply, key: typeof draft.key === "string" ? draft.key : null, savedAt: draft.savedAt };
  } catch {
    return null;
  }
}

// Le texte seul : valeur stable, lisible par useSyncExternalStore sans boucle.
export function readThreadReply(analysisId: string, store: DraftStorage | null = storage(), now = Date.now()): string {
  return read(analysisId, store, now)?.reply ?? "";
}

// La clé d'idempotence gardée avec lui. null : aucun envoi en cours.
export function readThreadKey(analysisId: string, store: DraftStorage | null = storage(), now = Date.now()): string | null {
  return read(analysisId, store, now)?.key ?? null;
}

export function saveThreadDraft(
  analysisId: string,
  draft: { reply: string; key: string | null },
  store: DraftStorage | null = storage(),
  now = Date.now(),
): void {
  try {
    // Rien à garder : un champ vide et aucun envoi en cours.
    if (draft.reply.trim() === "" && draft.key === null) store?.removeItem(threadDraftKey(analysisId));
    else store?.setItem(threadDraftKey(analysisId), JSON.stringify({ ...draft, savedAt: now } satisfies StoredTurnDraft));
  } catch {
    // stockage indisponible
  }
}

export function clearThreadDraft(analysisId: string, store: DraftStorage | null = storage()): void {
  try {
    store?.removeItem(threadDraftKey(analysisId));
  } catch {
    // stockage indisponible
  }
}

// Abonnement pour useSyncExternalStore : un autre onglet peut l'avoir changé.
export function subscribeThreadDraft(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
