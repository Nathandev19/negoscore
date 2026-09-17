-- Compteur durable des analyses gratuites consommées. Le décompte ne repose
-- plus sur les deals encore présents : supprimer une analyse ne rend pas le
-- droit gratuit. Une ligne ne contient qu'une empreinte (HMAC du jeton anonyme
-- ou de l'identifiant de compte), un nombre et une date : aucune donnée d'offre.
create table if not exists public.free_usage (
  subject_hash text primary key,
  used int not null default 0 check (used >= 0),
  last_used_at timestamptz not null default now()
);

alter table public.free_usage enable row level security;
revoke all on table public.free_usage from anon, authenticated;

-- Consomme une analyse gratuite si le plafond n'est pas atteint, de façon
-- atomique (deux analyses simultanées ne peuvent pas passer toutes les deux).
-- Renvoie true si l'analyse a été décomptée, false si le plafond était atteint.
create or replace function public.free_usage_consume(p_subject_hash text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed boolean;
begin
  if p_limit < 1 then
    return false;
  end if;
  insert into public.free_usage as f (subject_hash, used, last_used_at)
  values (p_subject_hash, 1, now())
  on conflict (subject_hash) do update
    set used = f.used + 1, last_used_at = now()
    where f.used < p_limit
  returning true into consumed;
  return coalesce(consumed, false);
end;
$$;

-- À la connexion, l'usage gratuit du navigateur anonyme est reporté sur le
-- compte : on garde le plus grand des deux compteurs.
create or replace function public.free_usage_merge(p_from text, p_into text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.free_usage as f (subject_hash, used, last_used_at)
  select p_into, used, last_used_at from public.free_usage where subject_hash = p_from
  on conflict (subject_hash) do update
    set used = greatest(f.used, excluded.used),
        last_used_at = greatest(f.last_used_at, excluded.last_used_at);
$$;

revoke all on function public.free_usage_consume(text, int) from public, anon, authenticated;
revoke all on function public.free_usage_merge(text, text) from public, anon, authenticated;
grant execute on function public.free_usage_consume(text, int) to service_role;
grant execute on function public.free_usage_merge(text, text) to service_role;
