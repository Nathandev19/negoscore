# CURRENT

## CURRENT STATUS
Negoscore (marque verrouillée, domaine negoscore.fr). Mission #002 terminée : analyse réelle en mode texte, chiffrage déterministe, modèle choisi par éval.

## WHAT EXISTS
- `/` landing et `/analyse` : le mode texte appelle `/api/analyse` ; Photo et PDF affichent « Bientôt disponible ».
- `/analyse/resultat` : dernière analyse réelle, lue depuis le sessionStorage du navigateur.
- `/analyse/demo` : résultat sur la fixture locale, sans appel réseau.
- `app/api/analyse/route.ts` : texte seul (60 000 caractères max), 5 analyses par IP et par heure en mémoire, mode fichier en 501.
- `lib/llm/` : prompt et schéma d'extraction, un seul modèle (`model.ts`), un appel plus une reprise (`extract.ts`).
- `lib/rates/` : table de tarifs `fr-2026.1.json`, calculateur, score. `lib/legal/` : couche légale FR et escalade, déterministes.
- `lib/analysis/compose.ts` : assemble sortie du modèle et calculs, validé par le schéma complet.
- `evals/` : 20 fixtures synthétiques, harness `pnpm eval`, résultats horodatés.
- Tests Vitest : marque, fixture, moteur de tarifs, composition.

## CURRENT BLOCKER
Aucun pour le code. Textes juridiques à fournir. Table de tarifs à recalibrer (valeurs « low » interpolées).

## CURRENT MISSION
#002 — moteur de tarifs, éval des modèles, pipeline réel. Terminée.

## NEXT MISSION
#003 — upload signé Supabase pour Photo et PDF, puis OCR ou lecture de document.

## LAUNCH BLOCKERS
- Supabase (stockage, suppression à 30 jours), Resend (gate email), Whop (paiement), PostHog.
- Rate limiting persistant : la limite en mémoire ne tient pas entre instances serverless.
- Compte Vercel Pro, avec `OPENAI_API_KEY` en variable d'environnement.
- Mentions légales, politique de confidentialité, CGV rédigées par un professionnel.
- Validation par un juriste de `lib/legal/fr.ts` (seuil, mentions obligatoires, texte de la note).
- Recalibrage de la table de tarifs sur des offres réelles.
