import { BRAND } from "@/lib/brand";

// Depuis combien de temps cette personne attend ses crédits après un paiement
// (mission #060), tous passages sur /merci confondus. Gardé dans l'onglet
// seulement : rafraîchir ne remet pas le compteur à zéro, fermer le navigateur
// oui. Au-delà de CREDIT_STUCK_MS, la page cesse d'annoncer que les crédits
// arrivent et dit quoi faire.
const KEY = `${BRAND.name.toLowerCase()}_merci_attente`;

export const CREDIT_STUCK_MS = 3 * 60 * 1000;

export function creditWaitingSince(): number {
  try {
    const stored = Number(window.sessionStorage.getItem(KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Stockage inaccessible : l'attente ne compte que pour cette page.
  }
  return Date.now();
}

export function clearCreditWait(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // rien à nettoyer
  }
}
