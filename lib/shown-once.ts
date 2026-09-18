// Messages « montrés une fois » (mission #068) : bandeau de connexion ou de
// déconnexion, pastille « Débloqué à l'instant ». Chacun appartient à la page
// où il est apparu, et ne vaut que pour CETTE visite de la page.
//
// Le défaut corrigé : la valeur était mémorisée pour toute la durée du
// document, rattachée à un chemin. Quitter la page par un lien interne puis y
// revenir sans rechargement complet — même chemin — la réaffichait.
//
// La règle : dès que la personne se trouve sur un autre chemin, tout message
// rattaché à un chemin différent est consommé, pour de bon, dans ce document.
// Le rechargement complet repart d'un registre vide ; le message ne revient
// alors que si sa source existe encore (cookie reposé par le serveur, ancre
// dans l'adresse).
//
// Module sans React ni dépendance : un registre en mémoire, testable seul.
// noteLocation est appelé à chaque changement de chemin par
// components/shown-once-tracker.tsx, monté dans la mise en page.

type Entry = { pathname: string; spent: boolean };

const entries = new Map<string, Entry>();

// Enregistre un message apparu sur ce chemin. Sans effet s'il est déjà connu,
// consommé ou non : un message ne s'enregistre qu'une fois par document.
export function showOnce(key: string, pathname: string): void {
  if (!entries.has(key)) entries.set(key, { pathname, spent: false });
}

// Le message est-il à afficher sur ce chemin, maintenant ?
export function isShowing(key: string, pathname: string): boolean {
  const entry = entries.get(key);
  return entry !== undefined && !entry.spent && entry.pathname === pathname;
}

// Consommé à la main : bandeau fermé par son bouton.
export function spend(key: string): void {
  const entry = entries.get(key);
  if (entry) entry.spent = true;
}

// La personne est maintenant sur ce chemin : tout message né ailleurs est consommé.
export function noteLocation(pathname: string): void {
  for (const entry of entries.values()) {
    if (entry.pathname !== pathname) entry.spent = true;
  }
}

// Pour les tests : un document neuf.
export function resetShownOnce(): void {
  entries.clear();
}
