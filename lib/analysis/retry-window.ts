// Fenêtre de relance gratuite d'une analyse incomplète (lib/analysis/retry.ts).
// Module sans dépendance serveur : aussi cité par la FAQ et les textes affichés.
//
// 14 jours : une marque répond à une demande de précisions en quelques jours,
// parfois une semaine ou deux. Au-delà, ce n'est plus la même négociation, et
// une réservation ouverte sans limite deviendrait un stock de droits gratuits.
export const RETRY_WINDOW_DAYS = 14;
