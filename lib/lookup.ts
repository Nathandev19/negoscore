// Mission #113, C — une table de constantes interrogée avec une clé qui vient
// de l'utilisateur.
//
// `TABLE[cle]` ne cherche pas seulement dans la table : il cherche aussi dans
// Object.prototype. Une adresse fabriquée suffisait à obtenir une réponse d'une
// table qui ne contient rien de tel :
//
//   /tarifs?erreur=__proto__    → ERRORS["__proto__"] rend Object.prototype,
//                                 React refuse de rendre un objet, et la page
//                                 qui VEND affiche « Cette page n'a pas pu
//                                 s'afficher » ;
//   /constructor                → SHORT_PATHS["constructor"] rend une fonction,
//                                 le proxy redirige vers l'accueil avec un
//                                 utm_content fabriqué au lieu de rendre 404.
//
// Ici, une clé n'obtient une réponse que si elle appartient VRAIMENT à la
// table. Tout le reste est une clé inconnue, et se comporte comme telle.
//
// Module feuille, sans aucun import : il est employé aussi bien dans le proxy
// que dans des composants sous garde d'import (tests/tier.test.ts).

export function entryFor<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
