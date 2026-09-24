-- Mission #103 — la télémétrie admin ne compte que la production.
--
-- Le développement local, les déploiements de prévisualisation et la suite de
-- tests écrivent dans la même base que la production : le cockpit mélangeait
-- trois mondes. Chaque ligne porte désormais l'environnement qui l'a produite,
-- décidé par le SERVEUR (lib/telemetry/environment.ts) et jamais par le client.
--
-- Contrainte CHECK plutôt que type énuméré : c'est ce que font toutes les
-- migrations de ce projet (product_events.event_name, admin_audit_log.action,
-- credit_ledger.source…). Un CHECK s'étend par un simple ALTER, là où un enum
-- Postgres impose un ALTER TYPE non transactionnel dans certaines versions.
--
-- AUCUNE ligne n'est supprimée ni reclassifiée : l'historique bascule en
-- 'unknown' par le DEFAULT et disparaît des chiffres par le filtre, pas par un
-- DELETE.

begin;

-- ─── 1. La colonne, sur les tables que /admin compte ────────────────────────

alter table public.product_events add column if not exists environment text not null default 'unknown';
alter table public.analysis_feedback add column if not exists environment text not null default 'unknown';
alter table public.analyses add column if not exists environment text not null default 'unknown';
alter table public.deals add column if not exists environment text not null default 'unknown';
alter table public.purchases add column if not exists environment text not null default 'unknown';

alter table public.product_events drop constraint if exists product_events_environment_check;
alter table public.product_events add constraint product_events_environment_check
  check (environment in ('production', 'preview', 'development', 'test', 'unknown'));
alter table public.analysis_feedback drop constraint if exists analysis_feedback_environment_check;
alter table public.analysis_feedback add constraint analysis_feedback_environment_check
  check (environment in ('production', 'preview', 'development', 'test', 'unknown'));
alter table public.analyses drop constraint if exists analyses_environment_check;
alter table public.analyses add constraint analyses_environment_check
  check (environment in ('production', 'preview', 'development', 'test', 'unknown'));
alter table public.deals drop constraint if exists deals_environment_check;
alter table public.deals add constraint deals_environment_check
  check (environment in ('production', 'preview', 'development', 'test', 'unknown'));
alter table public.purchases drop constraint if exists purchases_environment_check;
alter table public.purchases add constraint purchases_environment_check
  check (environment in ('production', 'preview', 'development', 'test', 'unknown'));

-- ─── 2. Les index, calqués sur le filtre des requêtes admin ─────────────────

create index if not exists product_events_env_time_idx
  on public.product_events (environment, occurred_at desc);
create index if not exists product_events_env_name_time_idx
  on public.product_events (environment, event_name, occurred_at desc);
create index if not exists analysis_feedback_env_updated_idx
  on public.analysis_feedback (environment, updated_at desc);
create index if not exists analyses_env_created_idx
  on public.analyses (environment, created_at desc);
create index if not exists deals_env_created_idx
  on public.deals (environment, created_at desc);
create index if not exists purchases_env_paid_idx
  on public.purchases (environment, paid_at desc);

-- ─── 3. Le tableau de bord ne compte que la production ──────────────────────
--
-- Deux changements de fond par rapport à la migration 30 :
--   - chaque source est filtrée sur environment = 'production' ;
--   - 'excluded' dit combien de lignes ont été écartées sur la période. C'est
--     la preuve visible, dans /admin, que le filtre travaille.
--
-- Le « Taux visite → analyse » disparaît de l'affichage (app/admin/page.tsx) :
-- il divisait des événements par des événements. Rien ne le remplace ici :
-- product_events ne porte pas d'identifiant commun au lancement et à la
-- complétion d'une même analyse, et on n'invente pas un taux.
create or replace function public.admin_dashboard_metrics(p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
with filtered as (
  select * from public.product_events
  where environment = 'production' and (p_since is null or occurred_at >= p_since)
), excluded as (
  select count(*)::int as total from public.product_events
  where environment <> 'production' and (p_since is null or occurred_at >= p_since)
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
  from public.analysis_feedback
  where environment = 'production' and (p_since is null or updated_at >= p_since)
), purchase_totals as (
  select count(*)::int as purchases,
    coalesce(sum(amount) filter (where upper(currency) = 'EUR'), 0) as revenue_eur,
    count(*) filter (where amount is not null and upper(currency) = 'EUR')::int as revenue_covered
  from public.purchases
  where environment = 'production' and (p_since is null or paid_at >= p_since)
)
select jsonb_build_object(
  'counts', coalesce((select jsonb_object_agg(event_name,total) from counts), '{}'::jsonb),
  'excluded', (select total from excluded),
  'paid_pro', (select count(*)::int from public.credits where plan='pro' and period_end > now()),
  'granted_pro', (select count(*)::int from public.admin_entitlements where entitlement='pro' and source='admin_grant' and active and (expires_at is null or expires_at > now())),
  'feedback', to_jsonb(feedback),
  'purchases', to_jsonb(purchase_totals),
  'timeseries', coalesce((select jsonb_agg(to_jsonb(days)) from days), '[]'::jsonb),
  'acquisition', coalesce((select jsonb_agg(to_jsonb(acquisition)) from acquisition), '[]'::jsonb)
) from feedback, purchase_totals;
$$;

-- ─── 4. Les listes comptent la même chose que le tableau de bord ────────────
--
-- Même filtre, sinon un dossier créé en local continuerait de gonfler la
-- colonne « Dossiers » et la liste des analyses. Les colonnes affichées et
-- l'ordre ne changent pas : seule la provenance des lignes est restreinte.
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
    (select count(*)::int from public.deals d where d.user_id=p.id and d.environment='production') as analyses,
    greatest(p.created_at,
      coalesce((select max(d.created_at) from public.deals d where d.user_id=p.id and d.environment='production'), p.created_at),
      coalesce((select max(pe.occurred_at) from public.product_events pe where pe.user_id=p.id and pe.environment='production'), p.created_at)
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
  where a.environment='production'
), page as (
  select * from base order by created_at desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)
)
select jsonb_build_object('total',(select count(*) from base),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb));
$$;

commit;

-- Rollback (manuel) : recréer les trois fonctions dans leur version de la
-- migration 20260923000030, puis
--   drop index if exists public.product_events_env_time_idx, public.product_events_env_name_time_idx,
--     public.analysis_feedback_env_updated_idx, public.analyses_env_created_idx,
--     public.deals_env_created_idx, public.purchases_env_paid_idx;
--   alter table public.product_events drop column if exists environment;  -- idem sur les quatre autres tables
-- Aucune donnée n'est perdue par ce retour en arrière : la colonne ajoutée est
-- la seule chose que cette migration écrit.
