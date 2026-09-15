# CURRENT

## CURRENT STATUS
Negoscore (marque verrouillée, domaine negoscore.fr). Mission #003 livrée côté code : vision évaluée (Luna pour tout), livrables pondérés, schéma Supabase, dépôt signé, limite persistante, analyses enregistrées. Les migrations ne sont pas encore appliquées sur le projet Supabase.

## WHAT EXISTS
- `/analyse` : texte, photo et PDF. Photo et PDF : URL signée (`/api/upload-url`), dépôt direct dans le bucket privé, puis analyse par chemin.
- `/analyse/resultat/[id]` : analyse lue en base, visible seulement par le navigateur qui l'a lancée (cookie httpOnly anonyme).
- `/analyse/demo` : résultat sur la fixture locale, sans appel réseau.
- `app/api/analyse/route.ts` : texte (60 000 caractères max) ou image ; PDF en 501 et fichier supprimé ; 5 analyses par heure par IP hachée dans `usage_guard` ; écrit `deals` et `analyses`.
- `lib/llm/` : un modèle pour le texte et l'image (`model.ts`), `extractDeal` et `extractDealFromImage`.
- `lib/rates/` : table `fr-2026.1.json` avec poids des livrables, calculateur, score. `lib/legal/` : couche légale FR et escalade.
- `lib/supabase/server.ts` : accès REST serveur avec la clé service_role. `supabase/migrations/` : 8 migrations.
- `evals/` : 20 fixtures texte (`pnpm eval`), 8 captures (`pnpm eval:vision`, générées par `pnpm eval:vision:fixtures`), recalcul des hallucinations (`pnpm eval:rescore`).
- Tests : `pnpm test` hors ligne ; `pnpm test:integration` contre Supabase (RLS, bucket, usage_guard).

## CURRENT BLOCKER
Migrations à appliquer sur le projet Supabase (sur ton feu vert), puis `pnpm test:integration` et un dépôt d'image réel.

## CURRENT MISSION
#003 — vision, correctifs tarifs, Supabase.

## NEXT MISSION
#004 — comptes, rattachement des analyses anonymes, crédits.

## LAUNCH BLOCKERS
- Suppression effective des documents après `delete_after` (tâche planifiée à écrire).
- Lecture des PDF : aucune bibliothèque dans le projet.
- Resend (gate email), Whop (paiement), PostHog.
- Compte Vercel Pro, variables d'environnement serveur (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`).
- Mentions légales, politique de confidentialité, CGV rédigées par un professionnel.
- Validation par un juriste de `lib/legal/fr.ts`.
- Recalibrage de la table de tarifs sur des offres réelles, poids photo et story compris.
