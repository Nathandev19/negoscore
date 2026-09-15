-- Profil créateur, une ligne par compte.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  platforms text[] not null default '{}',
  follower_range text,
  niche text,
  country text,
  base_rate_eur int check (base_rate_eur is null or base_rate_eur >= 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Un utilisateur ne lit et n'écrit que son propre profil.
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

revoke all on table public.profiles from anon;
