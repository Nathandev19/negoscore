-- Cockpit administrateur V1 : droits offerts distincts des abonnements payants,
-- ledger de crédits, audit append-only et télémétrie produit first-party.
-- Toutes ces données sont accessibles uniquement au serveur (service_role).

begin;

create table if not exists public.admin_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entitlement text not null check (entitlement = 'pro'),
  source text not null check (source = 'admin_grant'),
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  reason text check (reason is null or char_length(reason) between 1 and 500),
  granted_by uuid not null,
  revoked_at timestamptz,
  revoked_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  check (expires_at is null or expires_at > granted_at),
  check ((active and revoked_at is null) or not active)
);

create unique index if not exists admin_entitlements_one_active_grant
  on public.admin_entitlements (user_id, entitlement, source)
  where active;
create index if not exists admin_entitlements_user_active_idx
  on public.admin_entitlements (user_id, active, expires_at);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta int not null check (delta <> 0),
  balance_before int not null check (balance_before >= 0),
  balance_after int not null check (balance_after >= 0),
  reason text not null check (char_length(reason) between 1 and 500),
  source text not null check (source = 'admin'),
  admin_actor_id uuid not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 100),
  occurred_at timestamptz not null default now(),
  check (balance_after = balance_before + delta)
);

create index if not exists credit_ledger_user_time_idx
  on public.credit_ledger (user_id, occurred_at desc);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id uuid not null,
  action text not null check (action in ('grant_pro', 'revoke_pro_grant', 'adjust_credits')),
  target_type text not null check (target_type = 'user'),
  target_id text not null,
  reason text check (reason is null or char_length(reason) between 1 and 500),
  request_id text check (request_id is null or char_length(request_id) between 16 and 100),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz not null default now()
);

create unique index if not exists admin_audit_request_key
  on public.admin_audit_log (request_id)
  where request_id is not null;
create index if not exists admin_audit_target_time_idx
  on public.admin_audit_log (target_type, target_id, occurred_at desc);
create index if not exists admin_audit_actor_time_idx
  on public.admin_audit_log (actor_admin_id, occurred_at desc);

create or replace function public.admin_audit_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'admin audit log is append-only';
end;
$$;
drop trigger if exists admin_audit_append_only_trigger on public.admin_audit_log;
create trigger admin_audit_append_only_trigger
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_append_only();

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'landing_view', 'pricing_view', 'analysis_started', 'analysis_completed',
    'feedback_submitted', 'signup', 'negotiation_started', 'negotiation_turn',
    'negotiation_concluded', 'checkout_started', 'purchase_completed'
  )),
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  path text check (path is null or char_length(path) <= 300),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 255),
  utm_source text check (utm_source is null or (char_length(utm_source) <= 100 and utm_source = lower(utm_source))),
  utm_medium text check (utm_medium is null or (char_length(utm_medium) <= 100 and utm_medium = lower(utm_medium))),
  utm_campaign text check (utm_campaign is null or (char_length(utm_campaign) <= 150 and utm_campaign = lower(utm_campaign))),
  utm_content text check (utm_content is null or (char_length(utm_content) <= 150 and utm_content = lower(utm_content))),
  entity_type text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id text check (entity_id is null or char_length(entity_id) <= 120),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 8 and 200)
);

create unique index if not exists product_events_dedupe_key
  on public.product_events (dedupe_key)
  where dedupe_key is not null;
create index if not exists product_events_name_time_idx
  on public.product_events (event_name, occurred_at desc);
create index if not exists product_events_time_idx
  on public.product_events (occurred_at desc);
create index if not exists product_events_user_time_idx
  on public.product_events (user_id, occurred_at desc)
  where user_id is not null;
create index if not exists product_events_acquisition_time_idx
  on public.product_events (utm_source, utm_campaign, utm_content, occurred_at desc)
  where utm_source is not null;

create index if not exists analysis_feedback_updated_idx
  on public.analysis_feedback (updated_at desc);
create index if not exists purchases_paid_idx
  on public.purchases (paid_at desc);
create index if not exists analyses_created_idx
  on public.analyses (created_at desc);

alter table public.purchases
  add column if not exists amount numeric,
  add column if not exists currency text;

alter table public.admin_entitlements enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.product_events enable row level security;
revoke all on table public.admin_entitlements, public.credit_ledger, public.admin_audit_log, public.product_events from anon, authenticated;

-- Grant/retrait et audit partagent la même transaction. La clé de requête rend
-- un rejeu sans effet. Le vrai abonnement dans credits n'est jamais modifié.
create or replace function public.admin_set_pro_grant(
  p_actor uuid,
  p_user uuid,
  p_action text,
  p_expires_at timestamptz,
  p_reason text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_audit jsonb;
  before_value jsonb;
  after_value jsonb;
begin
  select after_state into existing_audit from public.admin_audit_log where request_id = p_request_id;
  if found then return existing_audit; end if;
  if p_action not in ('grant', 'revoke') then raise exception 'invalid action'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 2 or char_length(p_reason) > 500 then raise exception 'invalid reason'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'invalid expiry'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user'; end if;

  select to_jsonb(e) into before_value
  from public.admin_entitlements e
  where e.user_id = p_user and e.entitlement = 'pro' and e.source = 'admin_grant' and e.active
  limit 1;

  if p_action = 'grant' then
    update public.admin_entitlements
      set active = false, revoked_at = now(), revoked_by = p_actor
      where user_id = p_user and entitlement = 'pro' and source = 'admin_grant' and active;
    insert into public.admin_entitlements (user_id, entitlement, source, expires_at, reason, granted_by)
      values (p_user, 'pro', 'admin_grant', p_expires_at, trim(p_reason), p_actor)
      returning jsonb_build_object('id', id, 'active', active, 'source', source, 'expires_at', expires_at) into after_value;
  else
    update public.admin_entitlements
      set active = false, revoked_at = now(), revoked_by = p_actor
      where user_id = p_user and entitlement = 'pro' and source = 'admin_grant' and active;
    after_value := jsonb_build_object('active', false, 'source', 'admin_grant');
  end if;

  insert into public.admin_audit_log (actor_admin_id, action, target_type, target_id, reason, request_id, before_state, after_state)
    values (p_actor, case when p_action = 'grant' then 'grant_pro' else 'revoke_pro_grant' end,
      'user', p_user::text, trim(p_reason), p_request_id, before_value, after_value);
  return after_value;
end;
$$;

-- Verrouillage du solde, écriture du ledger et audit dans la même transaction.
create or replace function public.admin_adjust_credits(
  p_actor uuid,
  p_user uuid,
  p_delta int,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_balance int;
  new_balance int;
  previous jsonb;
begin
  select jsonb_build_object('balance_before', balance_before, 'balance_after', balance_after, 'delta', delta)
    into previous from public.credit_ledger where idempotency_key = p_idempotency_key;
  if found then return previous; end if;
  if p_delta = 0 or abs(p_delta) > 100000 then raise exception 'invalid delta'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 2 or char_length(p_reason) > 500 then raise exception 'invalid reason'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user'; end if;

  insert into public.credits (user_id, balance, plan) values (p_user, 0, 'free') on conflict (user_id) do nothing;
  select balance into old_balance from public.credits where user_id = p_user for update;
  new_balance := old_balance + p_delta;
  if new_balance < 0 then raise exception 'insufficient credits'; end if;
  update public.credits set balance = new_balance, updated_at = now() where user_id = p_user;
  insert into public.credit_ledger (user_id, delta, balance_before, balance_after, reason, source, admin_actor_id, idempotency_key)
    values (p_user, p_delta, old_balance, new_balance, trim(p_reason), 'admin', p_actor, p_idempotency_key);
  insert into public.admin_audit_log (actor_admin_id, action, target_type, target_id, reason, request_id, before_state, after_state)
    values (p_actor, 'adjust_credits', 'user', p_user::text, trim(p_reason), p_idempotency_key,
      jsonb_build_object('balance', old_balance), jsonb_build_object('balance', new_balance, 'delta', p_delta));
  return jsonb_build_object('balance_before', old_balance, 'balance_after', new_balance, 'delta', p_delta);
end;
$$;

-- Une seule réponse JSON déjà agrégée : aucune ligne d'événement ne part au navigateur.
create or replace function public.admin_dashboard_metrics(p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
with filtered as (
  select * from public.product_events where p_since is null or occurred_at >= p_since
), counts as (
  select event_name, count(*)::int as total from filtered group by event_name
), days as (
  select date_trunc('day', occurred_at)::date as day,
    count(*) filter (where event_name in ('landing_view','pricing_view'))::int as page_views,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'signup')::int as signups,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered group by 1 order by 1
), acquisition as (
  select coalesce(utm_source, 'non_attribue') as source,
    coalesce(utm_campaign, 'non_attribue') as campaign,
    coalesce(utm_content, 'non_attribue') as content,
    count(*) filter (where event_name in ('landing_view','pricing_view'))::int as visits,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'signup')::int as signups,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered group by 1,2,3 order by visits desc, analyses desc limit 100
), feedback as (
  select count(*)::int as total,
    count(*) filter (where rating = 'fair')::int as fair,
    count(*) filter (where rating in ('too_low','too_high'))::int as not_fair
  from public.analysis_feedback where p_since is null or updated_at >= p_since
), purchase_totals as (
  select count(*)::int as purchases,
    coalesce(sum(amount) filter (where upper(currency) = 'EUR'), 0) as revenue_eur,
    count(*) filter (where amount is not null and upper(currency) = 'EUR')::int as revenue_covered
  from public.purchases where p_since is null or paid_at >= p_since
)
select jsonb_build_object(
  'counts', coalesce((select jsonb_object_agg(event_name,total) from counts), '{}'::jsonb),
  'paid_pro', (select count(*)::int from public.credits where plan='pro' and period_end > now()),
  'granted_pro', (select count(*)::int from public.admin_entitlements where entitlement='pro' and source='admin_grant' and active and (expires_at is null or expires_at > now())),
  'feedback', to_jsonb(feedback),
  'purchases', to_jsonb(purchase_totals),
  'timeseries', coalesce((select jsonb_agg(to_jsonb(days)) from days), '[]'::jsonb),
  'acquisition', coalesce((select jsonb_agg(to_jsonb(acquisition)) from acquisition), '[]'::jsonb)
) from feedback, purchase_totals;
$$;

create or replace function public.admin_users_page(
  p_search text default '', p_offset int default 0, p_limit int default 25, p_sort text default 'recent'
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
with base as (
  select p.id, p.email, p.created_at, coalesce(c.balance,0) as balance, c.plan, c.period_end,
    exists(select 1 from public.admin_entitlements e where e.user_id=p.id and e.active and (e.expires_at is null or e.expires_at > now())) as admin_grant,
    (select count(*)::int from public.deals d where d.user_id=p.id) as analyses,
    greatest(p.created_at,
      coalesce((select max(d.created_at) from public.deals d where d.user_id=p.id), p.created_at),
      coalesce((select max(pe.occurred_at) from public.product_events pe where pe.user_id=p.id), p.created_at)
    ) as last_activity
  from public.profiles p left join public.credits c on c.user_id=p.id
  where coalesce(p.email,'') ilike '%' || coalesce(p_search,'') || '%'
), page as (
  select * from base order by
    case when p_sort='email' then email end asc nulls last,
    case when p_sort='analyses' then analyses end desc,
    case when p_sort='activity' then last_activity end desc,
    case when p_sort='recent' then created_at end desc,
    created_at desc
  offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)
)
select jsonb_build_object('total',(select count(*) from base),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb));
$$;

create or replace function public.admin_analyses_page(p_offset int default 0, p_limit int default 25)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
with base as (
  select a.id, a.created_at, d.user_id, p.email, a.score,
    a.payload #>> '{deal,payment,amount_eur}' as offered_amount,
    a.payload #>> '{estimate,total_low}' as estimate_low,
    a.payload #>> '{estimate,total_high}' as estimate_high,
    a.payload #>> '{profile_tier}' as profile_tier,
    (select f.rating from public.analysis_feedback f where f.analysis_id=a.id order by f.updated_at desc limit 1) as feedback,
    (select count(*)::int from public.negotiation_turns n where n.analysis_id=a.id and n.kind='reply') as turns,
    exists(select 1 from public.negotiation_turns n where n.analysis_id=a.id and (n.kind='conclusion' or n.payload->'conclusion' is not null)) as concluded
  from public.analyses a join public.deals d on d.id=a.deal_id left join public.profiles p on p.id=d.user_id
), page as (
  select * from base order by created_at desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)
)
select jsonb_build_object('total',(select count(*) from base),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb));
$$;

revoke all on function public.admin_set_pro_grant(uuid,uuid,text,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.admin_adjust_credits(uuid,uuid,int,text,text) from public, anon, authenticated;
revoke all on function public.admin_dashboard_metrics(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_users_page(text,int,int,text) from public, anon, authenticated;
revoke all on function public.admin_analyses_page(int,int) from public, anon, authenticated;
revoke all on function public.admin_audit_append_only() from public, anon, authenticated;
grant execute on function public.admin_set_pro_grant(uuid,uuid,text,timestamptz,text,text) to service_role;
grant execute on function public.admin_adjust_credits(uuid,uuid,int,text,text) to service_role;
grant execute on function public.admin_dashboard_metrics(timestamptz) to service_role;
grant execute on function public.admin_users_page(text,int,int,text) to service_role;
grant execute on function public.admin_analyses_page(int,int) to service_role;

commit;

-- Rollback (manual, only before production data depends on it): drop the trigger,
-- then the six functions above; drop product_events, admin_audit_log, credit_ledger and
-- admin_entitlements; then drop purchases.amount and purchases.currency.
