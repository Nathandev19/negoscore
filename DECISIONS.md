# DECISIONS

Uniquement les décisions difficiles à inverser.

1. **Whop plutôt que Stripe au MVP** — la distribution affiliée est stratégique.
2. **Vercel Pro requis au lancement** — le plan Hobby est réservé à un usage personnel non commercial.
3. **Modèle IA : openai/gpt-5.6-luna** — choisi par éval le 15/09/2026, constante unique dans `lib/llm/model.ts`, aucun routeur ni repli.
   - **MODEL_SELECTED** : openai/gpt-5.6-luna. Éval `evals/results/2026-09-15T07-45-12-414Z.json` (20 fixtures, prompt de production).
   - **WHY** : seul candidat à passer les critères 1 (zéro hallucination interdite) et 2 (schéma valide ≥ 95 %). Faits critiques 99,6 %, schéma 100 %, latence p50 14,2 s / p95 19,9 s, 0,00171 € par analyse.
   - **WHAT IT BEAT** : google/gemini-3.6-flash (faits 100 %, schéma 100 %, 1 hallucination détectée, 0,01026 € par analyse, 6 fois plus cher) et anthropic/claude-sonnet-5 (faits 100 %, schéma 90 %, 0,02739 € par analyse, 16 fois plus cher). L'hallucination de Gemini (« demandes abusives ») est un faux positif probable du détecteur ; même requalifié, Gemini est à moins de 3 points et Luna gagne au critère 4, le coût.
   - **KNOWN LIMITATIONS** : n'accepte pas `temperature` (valeur par défaut du modèle, sorties non strictement reproductibles) ; une éval préliminaire a produit une quantité aberrante (32025 vidéos), d'où le contrôle de plausibilité avec reprise dans `extract.ts` ; a manqué une durée Spark Ads exprimée en jours (« 30 jours ») ; confiance parfois « low » alors qu'un montant est présent ; 20 fixtures synthétiques seulement, aucune offre réelle.
4. **BRAND_STATUS = LOCKED** — Negoscore. Vérifié le 15/09/2026 : negoscore.fr absent du registre AFNIC avant achat, recherche INPI FR+EU+WO renvoyant une seule marque NEGOSCORE (FR94510763, déposée en 1994 par CEGOS, statut "marque expirée", classes 09/16/41), aucune collision web active. Nom isolé dans `lib/brand.ts` et protégé par test. Le dossier et le package restent nommés creator-deal-copilot : renommer n'apporte rien.
5. **Distribution faceless** — le produit sera filmé en screen recording vertical, jamais présenté par une personne.
6. **Le modèle n'invente jamais un prix** — il extrait et rédige ; chiffrage, score, couche légale, escalade, impacts et contre-offre sont calculés par du code déterministe (`lib/rates`, `lib/legal`, `lib/analysis/compose.ts`) depuis une table de tarifs versionnée.
