-- Mission #099, point 1 (audit A1) — une analyse ne reste jamais visible sans
-- avoir été décomptée.
--
-- La route enregistre l'analyse AVANT de décompter le droit (c'est voulu : on
-- ne débite qu'un résultat réellement produit). Si le décompte est refusé — le
-- dernier droit vient d'être pris par une autre analyse — la route supprime
-- l'analyse qu'elle vient d'écrire. Mais cette suppression peut échouer à son
-- tour (base injoignable, fonction coupée) : l'analyse reste alors en base,
-- consultable, sans que rien ait été débité.
--
-- Une ligne ici par analyse dans ce cas. Le rattrapage quotidien
-- (lib/analysis/debit-recovery.ts) retente le décompte ; si le droit n'est
-- toujours pas là, il supprime l'analyse. analysis_id en clé primaire : deux
-- passages du rattrapage ne créent pas deux lignes, et une analyse supprimée
-- emporte la sienne (cascade).
--
-- resolution :
--   'decompte'  — le droit a fini par être débité, l'analyse reste ;
--   'supprimee' — aucun droit disponible, l'analyse a été supprimée.
--
-- Écrite et lue uniquement par le serveur (clé de service).
--
-- À appliquer à la main, APRÈS 20260915000001 (analyses).

create table if not exists public.pending_debits (
  analysis_id uuid primary key references public.analyses (id) on delete cascade,
  -- Le deal porteur : c'est lui qu'on supprime, l'analyse part en cascade.
  deal_id uuid not null,
  -- Compte à débiter. NULL : analyse lancée sans compte (gratuité du jeton).
  user_id uuid references auth.users (id) on delete cascade,
  anon_token text,
  plan text not null check (plan in ('free', 'pack', 'pro', 'retry')),
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  resolved_at timestamptz,
  resolution text check (resolution in ('decompte', 'supprimee')),
  updated_at timestamptz not null default now()
);

-- Le rattrapage lit les lignes non réglées, les plus anciennes d'abord.
create index if not exists pending_debits_open_idx
  on public.pending_debits (resolved_at, created_at);

alter table public.pending_debits enable row level security;
revoke all on table public.pending_debits from anon, authenticated;
