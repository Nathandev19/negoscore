// Chemins de retour après connexion. Module sans dépendance serveur : utilisé
// par le proxy (redirection d'une personne déjà connectée hors de /connexion),
// par les routes d'authentification et par le formulaire de connexion, rendu
// dans le navigateur depuis que /connexion est une page statique (mission #045).

// Chemin de retour interne uniquement : pas de redirection ouverte.
export function safeNextPath(value: string | null | undefined, fallback = "/historique"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

// Destination après connexion : chemin interne uniquement, jamais de retour
// vers une page de connexion (boucle). Règle partagée avec la garde de /connexion.
export function signedInRedirectPath(requested: string | null | undefined, fallback = "/compte"): string {
  const target = safeNextPath(requested, fallback);
  return target.startsWith("/connexion") || target.startsWith("/auth/") ? fallback : target;
}
