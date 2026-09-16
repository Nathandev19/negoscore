-- Trace des consentements donnés au moment du paiement : case cochée par
-- l'utilisateur, texte affiché et date. Écrit par le serveur uniquement.
create table public.checkout_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('pack', 'pro')),
  consent_version text not null,
  consent_text text not null,
  accepted_at timestamptz not null default now(),
  checkout_configuration_id text,
  created_at timestamptz not null default now()
);

create index checkout_consents_user_id_idx on public.checkout_consents (user_id);

alter table public.checkout_consents enable row level security;

-- L'utilisateur peut relire ses propres consentements, jamais les écrire.
create policy "checkout_consents_select_own" on public.checkout_consents
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.checkout_consents from anon;
revoke insert, update, delete on table public.checkout_consents from authenticated;
