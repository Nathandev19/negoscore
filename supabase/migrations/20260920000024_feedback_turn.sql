-- Mission #086 — l'avis porte sur les chiffres réellement jugés, UN AVIS PAR TOUR.
--
-- Depuis la mission #084, après un tour de négociation, la page montre la
-- fourchette et le score des termes ACTUELS. L'avis « Cette estimation te
-- paraît juste ? » enregistre ces chiffres-là (colonnes existantes score,
-- total_low, total_high, rate_table_version, profile_tier), et le tour auquel
-- ils correspondent :
--   - 0 : l'offre d'origine, telle qu'analysée ;
--   - 2 à 5 : les termes après ce tour de négociation (numérotation de la page,
--     où l'analyse d'origine est le tour 1).
--
-- Clé (analysis_id, turn_number) : un avis sur l'offre d'origine et un avis
-- après le tour 3 coexistent. Le premier ne doit JAMAIS être écrasé par le
-- second : c'est le seul qui juge un chiffrage non négocié.
--
-- La forme du deal jugé se lit, pour la page des retours, dans
-- negotiation_turns (payload->deal_after du tour) : rien de plus n'est copié
-- ici, ni termes ni texte d'offre.
--
-- turn_recorded : false pour les avis enregistrés avant cette migration. Leur
-- tour n'a pas été noté ; ils sont rangés sur l'offre d'origine (turn_number 0),
-- et la page des retours affiche que c'est supposé. true pour tout avis écrit
-- ensuite (valeur par défaut). turn_number n'a PAS de valeur par défaut :
-- l'application l'écrit toujours, et un envoi qui l'omettrait est refusé
-- plutôt qu'enregistré sur un tour deviné.
--
-- À appliquer à la main, APRÈS 20260917000016 (analysis_feedback),
-- 20260917000017 (profile_tier) et 20260919000022 (negotiation_turns).
-- Pendant la fenêtre entre la migration et le déploiement du code qui
-- l'utilise, l'ancien code ne peut plus enregistrer d'avis (clé de conflit
-- changée) : il répond « indisponible », il n'écrit rien de faux.

begin;

alter table public.analysis_feedback
  add column if not exists turn_number int,
  add column if not exists turn_recorded boolean;

-- Avis existants : un seul par analyse, tour non enregistré.
update public.analysis_feedback
  set turn_number = 0, turn_recorded = false
  where turn_number is null;

alter table public.analysis_feedback
  alter column turn_number set not null,
  alter column turn_recorded set default true,
  alter column turn_recorded set not null;

alter table public.analysis_feedback
  drop constraint if exists analysis_feedback_turn_number_check;
alter table public.analysis_feedback
  add constraint analysis_feedback_turn_number_check
  check (turn_number = 0 or turn_number between 2 and 5);

-- Un avis par tour, plus un avis par analyse.
alter table public.analysis_feedback
  drop constraint if exists analysis_feedback_pkey;
alter table public.analysis_feedback
  add constraint analysis_feedback_pkey primary key (analysis_id, turn_number);

commit;
