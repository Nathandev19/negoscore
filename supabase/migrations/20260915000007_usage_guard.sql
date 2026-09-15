-- Limitation d'usage persistante. L'IP n'est jamais stockée en clair : le
-- serveur envoie un HMAC-SHA256 de l'IP calculé avec un sel serveur.
create table public.usage_guard (
  id uuid primary key default gen_random_uuid(),
  fingerprint_hash text,
  ip_hash text not null,
  count int not null default 0,
  window_start timestamptz not null default now()
);

create unique index usage_guard_ip_hash_key on public.usage_guard (ip_hash);

alter table public.usage_guard enable row level security;
revoke all on table public.usage_guard from anon, authenticated;

-- Compte un essai pour ip_hash dans une fenêtre fixe, de façon atomique.
-- La fenêtre repart de zéro quand elle est échue. Chaque appel est compté,
-- y compris ceux qui dépassent la limite.
create or replace function public.usage_guard_hit(p_ip_hash text, p_limit int, p_window_seconds int)
returns table (allowed boolean, hit_count int, retry_after_seconds int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  guard public.usage_guard;
begin
  insert into public.usage_guard as g (ip_hash, count, window_start)
  values (p_ip_hash, 1, now())
  on conflict (ip_hash) do update set
    count = case
      when g.window_start <= now() - make_interval(secs => p_window_seconds) then 1
      else g.count + 1
    end,
    window_start = case
      when g.window_start <= now() - make_interval(secs => p_window_seconds) then now()
      else g.window_start
    end
  returning g.* into guard;

  return query select
    guard.count <= p_limit,
    guard.count,
    greatest(0, ceil(extract(epoch from (guard.window_start + make_interval(secs => p_window_seconds) - now()))))::int;
end;
$$;

revoke all on function public.usage_guard_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.usage_guard_hit(text, int, int) to service_role;
