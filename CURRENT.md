# CURRENT

## CURRENT STATUS
Negoscore en production sur www.negoscore.fr. Mission #005 livrée côté code : chiffrage corrigé à l'affichage, paiement Whop (checkout rattaché, webhook signé et idempotent), mesure d'audience PostHog, pages légales avec les éléments manquants affichés en clair.

## WHAT EXISTS
- Analyse : texte et photo (PDF en 501), chiffrage déterministe plafonné, contenu verrouillé retiré côté serveur pour un visiteur non connecté.
- Comptes : magic link, rattachement de l'analyse anonyme, `/historique`.
- Crédits : gratuit 1 analyse, Pack Deal 3 analyses, Pro 30 par période. Droit vérifié avant l'appel au modèle ; un échec ne consomme rien.
- Paiement : `/offres` (case de consentement obligatoire), `/api/checkout`, `/api/whop/webhook`, `/merci` qui attend le crédit.
- Analytics : `lib/analytics/` côté navigateur (sans donnée de deal, DNT respecté, enregistrement de session désactivé) et `purchase_completed` émis par le webhook.
- Pages légales : `/mentions-legales`, `/confidentialite`, `/cgv`, chaque manque affiché en `[[À COMPLÉTER : …]]`.

## CURRENT BLOCKER
Migration `20260916000010_checkout_consents.sql` à appliquer : sans elle, `/api/checkout` renvoie l'utilisateur sur `/offres?erreur=indisponible`.

## CURRENT MISSION
#005 — paiement Whop, analytics, pages légales.

## NEXT MISSION
#006 — à définir.

## LAUNCH BLOCKERS
- Textes légaux à fournir : tous les `[[À COMPLÉTER]]` des trois pages, dont le texte exact de la case de consentement.
- Achat réel de bout en bout à faire une fois (Pack puis Pro), webhook et crédits vérifiés.
- Suppression effective des documents après `delete_after` (tâche planifiée à écrire).
- Lecture des PDF : aucune bibliothèque dans le projet.
- Recalibrage de la table de tarifs (poids, dégressivité, plafonds) sur des offres réelles.
- Validation par un juriste de `lib/legal/fr.ts`.
