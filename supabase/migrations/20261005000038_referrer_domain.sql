-- Mission #154 — domaine du référent, distinct de l'attribution UTM.
-- A appliquer à la main dans Supabase. Aucune donnée ancienne n'est reconstruite.
begin;

alter table public.product_events
  add column if not exists referrer_domain text default null
  check (referrer_domain is null or (
    char_length(referrer_domain) <= 255
    and referrer_domain ~ '^[a-z0-9-]+([.][a-z0-9-]+)*$'
  ));

create or replace function public.admin_dashboard_metrics(p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
with filtered as (
  select * from public.product_events
  where environment = 'production' and not internal and (p_since is null or occurred_at >= p_since)
), excluded as (
  select count(*)::int as total from public.product_events
  where environment <> 'production' and (p_since is null or occurred_at >= p_since)
), internal_events as (
  select count(*)::int as total from public.product_events
  where environment = 'production' and internal and (p_since is null or occurred_at >= p_since)
), counts as (
  select event_name, count(*)::int as total from filtered group by event_name
), days as (
  -- Mission #140 — LE JOUR EST CELUI DE PARIS, PAS CELUI D'UTC.
  --
  -- `date_trunc('day', timestamptz)` utilise le fuseau de la SESSION, et
  -- PostgREST ouvre ses sessions en UTC. Un événement de 00h30 à Paris tombait
  -- donc dans la journée de la veille, et la courbe d'activité rangeait deux
  -- heures de chaque nuit du mauvais côté. `at time zone 'Europe/Paris'`
  -- convertit l'instant en heure locale avant de tronquer, changement d'heure
  -- compris : c'est la base de fuseaux de Postgres qui décide, jamais un
  -- décalage écrit en dur.
  select date_trunc('day', occurred_at at time zone 'Europe/Paris')::date as day,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as page_views,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'signup')::int as signups,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered group by 1 order by 1
), referrer_groups as (
  select coalesce(referrer_domain, 'inconnu') as referrer,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as visits,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered
  where coalesce(utm_source, 'non_attribue') = 'non_attribue'
    and coalesce(utm_campaign, 'non_attribue') = 'non_attribue'
    and coalesce(utm_content, 'non_attribue') = 'non_attribue'
  group by 1
), acquisition_base as (
  select coalesce(utm_source, 'non_attribue') as source,
    coalesce(utm_campaign, 'non_attribue') as campaign,
    coalesce(utm_content, 'non_attribue') as content,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as visits,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'signup')::int as signups,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered group by 1,2,3 order by visits desc, analyses desc limit 100
), acquisition as (
  select a.*,
    case when a.source = 'non_attribue' and a.campaign = 'non_attribue' and a.content = 'non_attribue'
      then (select jsonb_agg(to_jsonb(r) order by r.visits desc, r.referrer) from referrer_groups r)
      else null end as referrers
  from acquisition_base a order by a.visits desc, a.analyses desc
), guide_views as (
  select path, count(*)::int as views
  from filtered where event_name = 'guide_view' and path is not null group by 1
), example_origin as (
  select entity_id as path, count(*)::int as to_example
  from filtered where event_name = 'example_view' and entity_id is not null group by 1
), guides as (
  select coalesce(g.path, o.path) as path,
    coalesce(g.views, 0) as views,
    coalesce(o.to_example, 0) as to_example
  from guide_views g full outer join example_origin o on o.path = g.path
  order by 2 desc, 3 desc limit 50
), example_totals as (
  select count(*)::int as total,
    count(*) filter (where entity_id is null)::int as direct
  from filtered where event_name = 'example_view'
), tier_changes as (
  -- Mission #130 — le niveau VERS lequel on a basculé, écrit dans entity_id
  -- par app/api/events/route.ts, et validé là-bas contre la liste fermée des
  -- trois niveaux. `internal` et `environment` sont déjà filtrés par
  -- `filtered` : un essai depuis un appareil marqué ne compte pas.
  select entity_id as tier, count(*)::int as changes
  from filtered
  where event_name = 'tier_changed' and entity_id is not null
  group by 1 order by 2 desc
), feedback as (
  select count(*)::int as total,
    count(*) filter (where rating = 'fair')::int as fair,
    count(*) filter (where rating in ('too_low','too_high'))::int as not_fair
  from public.analysis_feedback
  where environment = 'production' and not internal and (p_since is null or updated_at >= p_since)
), purchase_totals as (
  select count(*)::int as purchases,
    coalesce(sum(amount) filter (where upper(currency) = 'EUR'), 0) as revenue_eur,
    count(*) filter (where amount is not null and upper(currency) = 'EUR')::int as revenue_covered
  from public.purchases
  where environment = 'production' and not internal and (p_since is null or paid_at >= p_since)
)
select jsonb_build_object(
  'counts', coalesce((select jsonb_object_agg(event_name,total) from counts), '{}'::jsonb),
  'excluded', (select total from excluded),
  'internal', (select total from internal_events),
  'paid_pro', (select count(*)::int from public.credits where plan='pro' and period_end > now()),
  'granted_pro', (select count(*)::int from public.admin_entitlements where entitlement='pro' and source='admin_grant' and active and (expires_at is null or expires_at > now())),
  'feedback', to_jsonb(feedback),
  'purchases', to_jsonb(purchase_totals),
  'timeseries', coalesce((select jsonb_agg(to_jsonb(days)) from days), '[]'::jsonb),
  'acquisition', coalesce((select jsonb_agg(to_jsonb(acquisition)) from acquisition), '[]'::jsonb),
  'guides', coalesce((select jsonb_agg(to_jsonb(guides)) from guides), '[]'::jsonb),
  'example', to_jsonb(example_totals),
  'tier_changes', coalesce((select jsonb_agg(to_jsonb(tier_changes)) from tier_changes), '[]'::jsonb)
) from feedback, purchase_totals, example_totals;
$$;

commit;
