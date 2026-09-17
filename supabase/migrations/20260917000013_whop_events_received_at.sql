-- Date de réception de chaque événement Whop. La purge à 5 ans du journal des
-- paiements se fonde sur coalesce(processed_at, received_at) : un événement
-- jamais traité est ainsi purgé lui aussi. Les lignes existantes reçoivent la
-- date d'application de la migration, ou processed_at quand il est connu.
alter table public.whop_events add column if not exists received_at timestamptz;

update public.whop_events
set received_at = coalesce(processed_at, now())
where received_at is null;

alter table public.whop_events alter column received_at set default now();
alter table public.whop_events alter column received_at set not null;

create index if not exists whop_events_received_at_idx on public.whop_events (received_at);
