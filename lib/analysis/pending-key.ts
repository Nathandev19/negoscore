// Clé d'idempotence gardée par le navigateur (mission #060).
//
// Elle est tirée AVANT l'envoi et conservée tant qu'aucun résultat n'a été
// affiché. Si la requête se perd — réseau coupé, onglet fermé, bouton pressé
// une seconde fois — la même clé repart, et le serveur rend l'analyse déjà
// produite au lieu d'en lancer une autre (lib/analysis/idempotency.ts).
//
// Une clé par usage : l'analyse et la relance n'utilisent pas la même entrée,
// pour qu'une relance en cours n'efface pas la clé d'une analyse en cours.
// Elle est effacée dès que le résultat est acquis, et jamais gardée plus
// longtemps que la fenêtre où la reprise a un sens.

const PREFIX = "negoscore_cle_";
const TTL_MS = 60 * 60 * 1000;

export type KeyUse = "analyse" | "relance";

type Stored = { key: string; at: number };

function storageKey(use: KeyUse): string {
  return `${PREFIX}${use}`;
}

function newKey(): string {
  try {
    return crypto.randomUUID().replaceAll("-", "");
  } catch {
    // Navigateur sans randomUUID : suffisant, la clé n'est pas un secret.
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

// Clé de la tentative en cours : celle qui a été gardée si elle est récente,
// sinon une neuve. Une reprise réutilise donc exactement la même.
export function pendingKey(use: KeyUse): string {
  try {
    const raw = window.localStorage.getItem(storageKey(use));
    if (raw) {
      const stored = JSON.parse(raw) as Stored;
      if (typeof stored?.key === "string" && Date.now() - stored.at < TTL_MS) return stored.key;
    }
  } catch {
    // Stockage inaccessible : la clé vaut pour cette tentative seulement.
  }
  const key = newKey();
  try {
    window.localStorage.setItem(storageKey(use), JSON.stringify({ key, at: Date.now() } satisfies Stored));
  } catch {
    // idem
  }
  return key;
}

// Résultat acquis : plus rien à rejouer.
export function clearPendingKey(use: KeyUse): void {
  try {
    window.localStorage.removeItem(storageKey(use));
  } catch {
    // idem
  }
}
