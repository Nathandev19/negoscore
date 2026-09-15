-- Une offre soumise à l'analyse. Anonyme : user_id null et anon_token posé
-- par le serveur dans un cookie httpOnly. Le rattachement au compte viendra en #004.
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  anon_token text,
  source_type text not null check (source_type in ('text', 'image', 'pdf')),
  raw_text text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint deals_has_owner check (user_id is not null or anon_token is not null)
);

create index deals_user_id_idx on public.deals (user_id);
create index deals_anon_token_idx on public.deals (anon_token);

alter table public.deals enable row level security;

-- Un utilisateur ne lit et n'écrit que ses propres deals. Les deals anonymes
-- (user_id null) ne sont lisibles par aucun client : seul le serveur y accède.
create policy "deals_select_own" on public.deals
  for select to authenticated using (user_id = (select auth.uid()));
create policy "deals_insert_own" on public.deals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "deals_update_own" on public.deals
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "deals_delete_own" on public.deals
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on table public.deals from anon;
