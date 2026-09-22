-- Mission #090 — ce qui vient d'être acheté, pour la page « Merci ».
--
-- Constat : la page décrivait l'état du compte (« Abonnement Pro actif
-- jusqu'au… ») au lieu de l'achat qui venait d'être payé. Une abonnée Pro qui
-- achète un Pack Deal n'y voyait rien de ses 3 analyses, et pouvait croire son
-- paiement perdu — donc payer une seconde fois.
--
-- Le solde ne dit pas ce qui a été acheté : +3 analyses sur un compte qui en
-- avait 2 est indiscernable d'un autre mouvement. Seul le webhook Whop sait ce
-- qui a été payé. Il écrit donc ici une ligne par achat honoré, au moment même
-- où il accorde la contrepartie (crédit du pack, activation de l'abonnement).
--
-- event_id : l'événement Whop qui a produit cet achat, clé unique. Un rejeu du
-- webhook ou le rattrapage quotidien ne créent donc jamais deux lignes, comme
-- pour le crédit lui-même (whop_event_credit, migration 019).
--
-- Écrite et lue uniquement par le serveur (clé de service), comme whop_events :
-- la page « Merci » lit la ligne de la personne connectée, côté serveur.
--
-- À appliquer à la main, APRÈS 20260915000006 (whop_events).

create table if not exists public.purchases (
  event_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- « pack » : analyses ajoutées. « pro » : abonnement activé.
  plan text not null check (plan in ('pack', 'pro')),
  -- Analyses ajoutées par cet achat (0 pour un abonnement).
  analyses_added int not null default 0 check (analyses_added >= 0),
  -- Fin de période pour un abonnement, sinon NULL.
  period_end timestamptz,
  paid_at timestamptz not null default now()
);

-- Les achats récents d'une personne, du plus récent au plus ancien : c'est la
-- seule lecture que fait la page.
create index if not exists purchases_user_paid_idx on public.purchases (user_id, paid_at desc);

alter table public.purchases enable row level security;
revoke all on table public.purchases from anon, authenticated;
