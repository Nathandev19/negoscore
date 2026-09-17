# CURRENT

## CURRENT STATUS
Negoscore en production sur www.negoscore.fr. Mission #007 livrée : réexpédition des emails reçus sur l'adresse de contact vers une boîte personnelle, par webhook Resend entrant.

## WHAT EXISTS
- Analyse : texte et photo (PDF en 501), chiffrage déterministe plafonné, contenu verrouillé retiré côté serveur pour un visiteur non connecté.
- Comptes : magic link, rattachement de l'analyse anonyme, `/historique`.
- Crédits : gratuit 1 analyse, Pack Deal 3 analyses, Pro 30 par période. Droit vérifié avant l'appel au modèle ; un échec ne consomme rien.
- Paiement : `/tarifs` (ancienne adresse `/offres`, redirigée ; case de consentement obligatoire), `/api/checkout`, `/api/whop/webhook`, `/merci` qui attend le crédit.
- Analytics : `lib/analytics/` côté navigateur (sans donnée de deal, DNT respecté, enregistrement de session désactivé) et `purchase_completed` émis par le webhook.
- Pages légales : `/mentions-legales`, `/confidentialite`, `/cgv` complétées ; seul le médiateur reste en `[[À COMPLÉTER]]`.
- Après achat : email de confirmation (troisième condition de l'article L221-28 13°), envoyé une fois par événement.
- `/resilier` : résiliation en ligne, annulation Whop à la fin de la période, email de confirmation, crédits pack conservés.
- `/api/email/inbound` : webhook Resend entrant, signature Svix vérifiée, réexpédition vers `FORWARD_INBOUND_TO` avec Reply-To d'origine et pièces jointes. Rien n'est stocké.

## CURRENT BLOCKER
`RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_INBOUND_WEBHOOK_SECRET` et `FORWARD_INBOUND_TO` absentes de l'environnement : sans elles, ni la confirmation d'achat ni la réexpédition du courrier ne fonctionnent.

## CURRENT MISSION
#007 — réexpédition de l'adresse de contact.

## NEXT MISSION
#008 — à définir.

## LAUNCH BLOCKERS
- Médiateur de la consommation : adhésion à souscrire, puis remplir le dernier `[[À COMPLÉTER]]` des CGV.
- `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_INBOUND_WEBHOOK_SECRET`, `FORWARD_INBOUND_TO` à renseigner, et webhook entrant à déclarer chez Resend.
- Permissions de la clé API Whop pour la résiliation : `membership:cancel`, `member:basic:read`, `member:email:read`.
- Achat réel de bout en bout à faire une fois (Pack puis Pro), webhook et crédits vérifiés.
- Suppression effective des documents après `delete_after` (tâche planifiée à écrire).
- Lecture des PDF : aucune bibliothèque dans le projet.
- Recalibrage de la table de tarifs (poids, dégressivité, plafonds) sur des offres réelles.
- Validation par un juriste de `lib/legal/fr.ts`.
