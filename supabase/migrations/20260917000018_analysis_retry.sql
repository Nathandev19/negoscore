-- Relance gratuite d'une analyse incomplète (mission #043, lib/analysis/retry.ts).
-- Une analyse « incomplete » ne donne aucun chiffre : la personne peut relancer
-- la même offre une fois, dans les 14 jours, sans consommer de nouveau droit.
-- Aucune donnée personnelle : une date et deux marqueurs techniques.

-- Sur l'analyse d'origine : moment où sa relance a été réservée. Posé AVANT
-- l'appel au modèle par une mise à jour conditionnelle (retried_at is null),
-- remis à NULL si la relance échoue. Reste posé si la relance est supprimée :
-- supprimer la relance ne rouvre pas le droit.
alter table public.analyses
  add column if not exists retried_at timestamptz;

-- Sur la relance : elle-même ne peut pas être relancée (is_retry), et elle est
-- exclue du quota mensuel Pro. is_retry ne dépend pas de retry_of : il reste
-- vrai si l'analyse d'origine est supprimée.
alter table public.analyses
  add column if not exists is_retry boolean not null default false;

-- Lien vers l'analyse d'origine, pour afficher « voir la relance ». Remis à NULL
-- si l'origine est supprimée.
alter table public.analyses
  add column if not exists retry_of uuid references public.analyses (id) on delete set null;

-- Une seule relance par analyse d'origine, garanti aussi par la base.
create unique index if not exists analyses_retry_of_key
  on public.analyses (retry_of)
  where retry_of is not null;
