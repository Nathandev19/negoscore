-- Mission #086 — l'avis porte sur les chiffres réellement jugés.
--
-- Depuis la mission #084, après un tour de négociation, la page montre la
-- fourchette et le score des termes ACTUELS. L'avis « Cette estimation te
-- paraît juste ? » enregistre désormais ces chiffres-là (colonnes existantes
-- score, total_low, total_high, rate_table_version, profile_tier), et le tour
-- auquel ils correspondent :
--   - 0 : l'offre d'origine, telle qu'analysée ;
--   - 2 à 5 : les termes après ce tour de négociation (numérotation de la page,
--     où l'analyse d'origine est le tour 1).
-- La forme du deal jugé se lit, pour la page des retours, dans
-- negotiation_turns (payload->deal_after du tour) : rien de plus n'est copié
-- ici, ni termes ni texte d'offre.
--
-- NULL : avis enregistré avant cette migration. La page des retours le traite
-- comme un avis sur l'offre d'origine, et affiche que c'est supposé.
-- Toujours écrit par l'application une fois la migration appliquée : sans
-- cette colonne, l'avis est refusé plutôt qu'enregistré sans son tour.
--
-- À appliquer à la main, APRÈS 20260917000016 (analysis_feedback) et
-- 20260919000022 (negotiation_turns).

alter table public.analysis_feedback
  add column if not exists turn_number int
  check (turn_number is null or turn_number = 0 or turn_number between 2 and 5);
