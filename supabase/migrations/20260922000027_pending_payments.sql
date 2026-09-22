-- Mission #092 — aucun paiement encaissé ne reste sans contrepartie.
--
-- Deux trous, constatés en #090 bis, du même type : de l'argent encaissé par
-- Whop sans que personne soit crédité, et sans alerte.
--
--   1. « activation_attendue » : un paiement Pro n'accorde rien par lui-même,
--      l'accès vient de membership.activated. Si cet événement n'arrive jamais
--      (ou porte un plan non reconnu), le mois est payé et jamais ouvert.
--   2. « compte_introuvable » : ni les métadonnées du checkout ni l'email de
--      l'acheteur ne désignent un compte. L'événement était marqué traité :
--      Whop ne le rejouait pas, le rattrapage ne le reprenait pas.
--
-- Une ligne par paiement en attente de contrepartie, réglée par le rattrapage
-- quotidien (lib/billing/webhook-recovery.ts). event_id en clé : un rejeu du
-- webhook ou une seconde passe du rattrapage ne créent pas de doublon.
--
-- resolution :
--   'rattrape'  — période Pro ouverte par le rattrapage, faute d'activation ;
--   'active'    — l'activation est arrivée, le rattrapage n'a rien à faire ;
--   'rattache'  — le compte a été retrouvé, le crédit dû a été appliqué ;
--   'abandonne' — 30 jours sans compte correspondant.
--
-- activation_event_id : l'événement membership.activated reconnu comme étant
-- l'activation de CE paiement déjà honoré par le rattrapage. Il sert à ne pas
-- accorder une seconde période quand l'activation arrive après coup.
--
-- Écrite et lue uniquement par le serveur (clé de service), comme whop_events.
--
-- À appliquer à la main, APRÈS 20260915000006 (whop_events).

create table if not exists public.pending_payments (
  event_id text primary key,
  -- Compte rattaché quand il est connu ; NULL pour un paiement non rattachable.
  user_id uuid references auth.users (id) on delete cascade,
  -- Email de l'acheteur renvoyé par Whop, seule piste de rattachement.
  email text,
  plan text not null check (plan in ('pack', 'pro')),
  amount numeric,
  currency text,
  paid_at timestamptz not null default now(),
  reason text not null check (reason in ('activation_attendue', 'compte_introuvable')),
  resolved_at timestamptz,
  resolution text check (resolution in ('rattrape', 'active', 'rattache', 'abandonne')),
  activation_event_id text,
  updated_at timestamptz not null default now()
);

-- Les deux passes du rattrapage lisent les lignes non réglées, les plus
-- anciennes d'abord.
create index if not exists pending_payments_open_idx
  on public.pending_payments (reason, resolved_at, paid_at);

-- Rattachement par email : une lecture par email, en minuscules.
create index if not exists pending_payments_email_idx
  on public.pending_payments (lower(email)) where resolved_at is null;

alter table public.pending_payments enable row level security;
revoke all on table public.pending_payments from anon, authenticated;
