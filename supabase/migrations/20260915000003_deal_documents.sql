-- Fichier déposé dans le bucket privé deal-documents. Le chemin contient deux
-- UUID aléatoires : il n'est pas devinable, et il ne donne accès à rien sans
-- URL signée générée par le serveur.
create table public.deal_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  storage_path text not null unique,
  mime text not null,
  bytes int not null check (bytes > 0),
  delete_after timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create index deal_documents_deal_id_idx on public.deal_documents (deal_id);
create index deal_documents_delete_after_idx on public.deal_documents (delete_after);

alter table public.deal_documents enable row level security;

-- Pas de colonne user_id : la propriété passe par le deal parent.
create policy "deal_documents_select_own" on public.deal_documents
  for select to authenticated using (
    exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid()))
  );
create policy "deal_documents_insert_own" on public.deal_documents
  for insert to authenticated with check (
    exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid()))
  );
create policy "deal_documents_update_own" on public.deal_documents
  for update to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid())));
create policy "deal_documents_delete_own" on public.deal_documents
  for delete to authenticated using (
    exists (select 1 from public.deals d where d.id = deal_id and d.user_id = (select auth.uid()))
  );

revoke all on table public.deal_documents from anon;
