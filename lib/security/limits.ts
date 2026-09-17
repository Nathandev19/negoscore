// Limites horaires des routes publiques autres que l'analyse, comptées par le
// même mécanisme que les analyses (lib/security/usage-guard.ts) : aucun second
// compteur. Les valeurs sont larges devant un usage normal — elles n'existent
// que pour qu'une boucle automatique ne puisse pas créer des lignes ou des URL
// de dépôt sans fin (mission #062, B1 et B2).

// Préparations de dépôt de fichier : chacune crée une ligne deals, une ligne
// deal_documents et une URL signée. Un créateur qui hésite entre trois photos
// en demande trois ; vingt en une heure n'arrive pas à la main.
export const UPLOAD_URLS_PER_HOUR = 20;

// Même chose par jeton anonyme ou par compte, quand il en existe déjà un.
export const UPLOAD_URLS_PER_SUBJECT_PER_HOUR = 12;

// Lecture du droit d'analyser : le formulaire l'appelle une fois à l'ouverture.
export const RIGHTS_PER_HOUR = 60;
