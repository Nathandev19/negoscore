-- « Cette estimation te paraît juste ? » : une réponse par analyse, modifiable.
-- Sert à trancher la question ouverte depuis le début : la table de tarifs
-- est-elle trop haute, ou le marché sous-paie-t-il ?
-- Contenu : la réponse, un commentaire facultatif de 200 caractères, et un
-- instantané de ce qui a été montré (version de la table, score, fourchette).
-- Aucun identifiant de personne, aucun texte d'offre. La réponse disparaît
-- avec l'analyse (suppression de l'analyse ou du compte).
create table if not exists public.analysis_feedback (
  analysis_id uuid primary key references public.analyses (id) on delete cascade,
  rating text not null check (rating in ('too_low', 'fair', 'too_high')),
  comment text check (comment is null or char_length(comment) between 1 and 200),
  rate_table_version text not null,
  score int check (score is null or score between 0 and 100),
  total_low int,
  total_high int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Écrit et lu uniquement par le serveur (clé de service), après contrôle du
-- rattachement de l'analyse : aucun accès direct depuis le navigateur.
alter table public.analysis_feedback enable row level security;
revoke all on table public.analysis_feedback from anon, authenticated;
