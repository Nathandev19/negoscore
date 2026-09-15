-- Résultat complet d'une analyse, validé par le schéma applicatif.
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  rate_table_version text not null,
  payload jsonb not null,
  score int check (score is null or score between 0 and 100),
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  cost_cents numeric,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index analyses_deal_id_idx on public.analyses (deal_id);

alter table public.analyses enable row level security;

create policy "analyses_select_own" on public.analyses
  for select to authenticated using (
    exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid()))
  );
create policy "analyses_insert_own" on public.analyses
  for insert to authenticated with check (
    exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid()))
  );
create policy "analyses_update_own" on public.analyses
  for update to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid())));
create policy "analyses_delete_own" on public.analyses
  for delete to authenticated using (
    exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid()))
  );

revoke all on table public.analyses from anon;
