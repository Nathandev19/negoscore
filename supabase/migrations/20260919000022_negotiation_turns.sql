-- Mission #080 — la négociation après le premier message.
--
-- Une ligne par tour suivant d'une analyse (la réponse de la marque collée par
-- la personne, et ce que l'outil en a tiré), plus au plus une ligne de
-- conclusion. L'analyse d'origine reste le tour 1 : elle n'est jamais réécrite.
--
-- À appliquer à la main, APRÈS 20260918000021 (login_claims).

create table if not exists public.negotiation_turns (
  id uuid primary key default gen_random_uuid(),
  -- Analyse d'origine. Supprimer l'analyse supprime tout le fil.
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  -- Seul un compte a des tours suivants : sert au quota Pro (un tour compte
  -- comme une analyse) et part avec le compte.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'reply' : un tour (réponse de la marque), numéroté de 2 à 5.
  -- 'conclusion' : la personne décide d'accepter sans nouvelle réponse de la
  -- marque ; récapitulatif calculé par le code, sans appel au modèle, gratuit.
  kind text not null check (kind in ('reply', 'conclusion')),
  turn_number int check (turn_number between 2 and 5),
  constraint negotiation_turns_number_by_kind check ((kind = 'reply') = (turn_number is not null)),
  -- Texte collé par la personne. Remis à NULL au bout de 30 jours, comme le
  -- texte des offres (deals.raw_text). Le tour, lui, reste.
  brand_reply text check (brand_reply is null or char_length(brand_reply) <= 20000),
  -- Résultat complet validé par le schéma applicatif : lecture du modèle,
  -- termes du deal après ce tour, chiffrage du moteur, message, conclusion.
  payload jsonb not null,
  model text,
  prompt_version text,
  rate_table_version text not null,
  cost_cents numeric,
  latency_ms int,
  -- Clé d'idempotence tirée par le navigateur, comme pour les analyses (#060).
  idempotency_key text,
  created_at timestamptz not null default now()
);

-- Un tour par numéro et par analyse : deux envois simultanés du même tour ne
-- peuvent pas s'enregistrer tous les deux.
create unique index if not exists negotiation_turns_turn_key
  on public.negotiation_turns (analysis_id, turn_number)
  where kind = 'reply';
-- Une seule conclusion par analyse.
create unique index if not exists negotiation_turns_conclusion_key
  on public.negotiation_turns (analysis_id)
  where kind = 'conclusion';
create unique index if not exists negotiation_turns_idempotency_key
  on public.negotiation_turns (idempotency_key)
  where idempotency_key is not null;
-- Quota Pro (tours du compte sur la période) et purge des 30 jours.
create index if not exists negotiation_turns_user_created_idx
  on public.negotiation_turns (user_id, created_at);
create index if not exists negotiation_turns_reply_purge_idx
  on public.negotiation_turns (created_at)
  where brand_reply is not null;

-- Écrit et lu uniquement par le serveur (clé de service), après contrôle du
-- propriétaire de l'analyse : aucun accès direct depuis le navigateur.
alter table public.negotiation_turns enable row level security;
revoke all on table public.negotiation_turns from anon, authenticated;
