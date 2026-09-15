# CURRENT

## CURRENT STATUS
Mission #001 terminée : squelette complet, UI fonctionnelle sur fixture JSON locale. Aucune IA, base de données, paiement ni appel réseau.

## WHAT EXISTS
- `/` landing FR mobile-first, zone de dépôt au-dessus du pli.
- `/analyse` input en 3 modes (texte, photo, PDF), validation client, écran de chargement simulé (2,5 s).
- `/analyse/demo` résultat complet rendu depuis `lib/fixtures/analysis-sample.json`, contre-offre et message floutés, gate email factice (console.log).
- `/mentions-legales`, `/confidentialite`, `/cgv` : placeholders.
- `lib/schema.ts` (Zod), `lib/brand.ts` (point de renommage unique), tests Vitest (fixture + marque).

## CURRENT BLOCKER
Aucun pour le code. Nom de marque non verrouillé. Textes juridiques à fournir.

## CURRENT MISSION
#001 — init du repo et squelette UI. Terminée.

## NEXT MISSION
#002 — benchmark des modèles IA sur nos propres fixtures, puis branchement de l'analyse réelle sur le schéma existant.

## LAUNCH BLOCKERS
- Nom de marque et domaine.
- Modèle IA choisi et clé `LLM_API_KEY`.
- Supabase (stockage, suppression à 30 jours), Resend (gate email), Whop (paiement), PostHog.
- Compte Vercel Pro.
- Mentions légales, politique de confidentialité, CGV rédigées par un professionnel.
- Validation par un juriste du contenu « alerte légale FR » (seuil, mentions obligatoires).
