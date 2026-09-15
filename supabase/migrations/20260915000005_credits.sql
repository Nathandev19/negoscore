-- Solde de crédits d'un compte.
create table public.credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  plan text not null default 'free' check (plan in ('free', 'pack', 'pro')),
  period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.credits enable row level security;

-- Lecture de sa propre ligne uniquement. Aucune écriture depuis le client :
-- un utilisateur ne doit pas pouvoir créditer son propre compte. Les
-- écritures passent par le serveur (clé service_role, webhooks Whop).
create policy "credits_select_own" on public.credits
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.credits from anon;
revoke insert, update, delete on table public.credits from authenticated;
