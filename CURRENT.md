# CURRENT

## CURRENT STATUS
Negoscore (marque verrouillée, domaine negoscore.fr). Mission #004 livrée : chiffrage plafonné et dégressif, base Supabase validée (RLS, bucket, usage_guard), connexion par magic link, rattachement des analyses anonymes, contenu verrouillé retiré côté serveur, crédits vérifiés avant l'appel au modèle.

## WHAT EXISTS
- `/analyse` : texte ou photo (URL signée, dépôt direct), PDF en 501. Réponse 402 et paywall quand le droit d'analyser manque.
- `/analyse/resultat/[id]` : visiteur anonyme propriétaire = contre-offre et message retirés de la réponse ; propriétaire connecté = analyse complète.
- `/connexion` (magic link PKCE), `/auth/callback` (profil, crédits gratuits, rattachement du jeton anonyme), `/auth/deconnexion`, `/historique`, `/offres`.
- `proxy.ts` : rafraîchit la session avant le rendu, n'autorise rien.
- `lib/billing/` : offres (`plans.ts`) et droits (`entitlement.ts`) : anonyme 1 analyse (jeton + IP hachée), pack décrémenté, pro 30 par période, échec jamais consommé.
- `lib/rates/` : table `fr-2026.1.json` avec poids, dégressivité et plafonds de majoration ; contrôle de vraisemblance.
- `evals/` : `pnpm eval`, `pnpm eval:vision`, `pnpm eval:pipeline`, `pnpm eval:rescore`.
- Tests : `pnpm test` (hors ligne) ; `pnpm test:integration` (RLS, stockage, usage_guard, callback, rattachement, droits).

## CURRENT BLOCKER
Envoi réel du magic link non vérifié (aucune boîte de réception de test) : URL de redirection à autoriser dans Supabase Auth, SMTP à configurer.

## CURRENT MISSION
#004 — correction du chiffrage, auth, crédits.

## NEXT MISSION
#005 — paiement Whop (webhooks, whop_events, attribution des crédits).

## LAUNCH BLOCKERS
- SMTP Supabase (Resend) et URL de redirection de production autorisée.
- Suppression effective des documents après `delete_after` (tâche planifiée à écrire).
- Lecture des PDF : aucune bibliothèque dans le projet.
- Compte Vercel Pro, variables d'environnement serveur (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`).
- Mentions légales, confidentialité, CGV rédigées par un professionnel ; validation juridique de `lib/legal/fr.ts`.
- Recalibrage de la table de tarifs (poids, dégressivité, plafonds) sur des offres réelles.
