-- Niveau de la créatrice (mission #039) : la ligne de la table de tarifs
-- utilisée pour la fourchette (starter, confirmed, experienced).
-- Une préférence de calcul, pas une donnée sensible : aucune information sur
-- l'audience, les revenus ou l'identité, seulement quelle ligne de la table
-- appliquer.
--
-- À appliquer APRÈS 20260917000016 (analysis_feedback).
--
-- Le niveau d'une analyse enregistrée n'a pas besoin de colonne : il est dans
-- analyses.payload (champ profile_tier, schéma 1.4). Une analyse plus ancienne
-- n'a pas ce champ et a été calculée au niveau confirmed.

-- Niveau mémorisé sur le compte, pour les analyses suivantes (y compris depuis
-- un autre appareil). NULL : jamais choisi, le défaut de la table s'applique.
alter table public.profiles
  add column if not exists rate_tier text
  check (rate_tier is null or rate_tier in ('starter', 'confirmed', 'experienced'));

-- Niveau affiché au moment de l'avis « trop basse / juste / trop haute ». Sans
-- lui, un avis ne dit rien de la table : « trop haute » au niveau expérimenté et
-- « trop haute » au niveau débutant ne sont pas la même réponse.
-- Toujours écrit par l'application. NULL seulement pour un avis enregistré avant
-- cette migration : les chiffres étaient alors ceux du niveau confirmed, imposé
-- et non choisi.
alter table public.analysis_feedback
  add column if not exists profile_tier text
  check (profile_tier is null or profile_tier in ('starter', 'confirmed', 'experienced'));
