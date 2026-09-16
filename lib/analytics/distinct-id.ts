// Identifiant anonyme de PostHog, transporté du navigateur jusqu'au webhook
// pour que l'achat se rattache au parcours. Ce n'est ni un email, ni un
// identifiant de compte : seulement la clé anonyme du navigateur.

const MAX_LENGTH = 200;
const ALLOWED = /^[A-Za-z0-9_-]+$/;

// Renvoie l'identifiant s'il est exploitable, sinon null. Aucune exception :
// un champ douteux est ignoré, jamais une raison de refuser un paiement.
export function sanitizeDistinctId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return null;
  return ALLOWED.test(trimmed) ? trimmed : null;
}
