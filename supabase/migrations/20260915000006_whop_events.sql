-- Journal idempotent des webhooks Whop. Serveur uniquement.
create table public.whop_events (
  event_id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz
);

-- RLS activée sans aucune politique, et privilèges retirés : ni anon ni
-- authenticated n'y accèdent. Seule la clé service_role (qui contourne la RLS) lit et écrit.
alter table public.whop_events enable row level security;
revoke all on table public.whop_events from anon, authenticated;
