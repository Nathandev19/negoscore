-- Mission #127, partie A — une visite sur la page d'exemple est une visite.
--
-- CONSTAT, production, 01/10 : un clic réel sur negoscore.fr/exemple depuis le
-- navigateur intégré d'Instagram n'apparaissait nulle part dans /admin. Ni sous
-- instagram · dm_exemple, ni en non_attribue, ni dans le total des visites.
--
-- CAUSE RÉELLE, établie en exécutant la page : l'événement EST écrit. La route
-- d'enregistrement (app/api/vue/route.ts) insère bien une ligne `example_view`
-- avec ses UTM, sans erreur. Mais le tableau de bord ne comptait comme
-- « visite » que `landing_view` et `pricing_view` :
--   - la tuile « Visites mesurées » n'additionnait que ces deux-là ;
--   - la courbe d'activité (`page_views`) non plus ;
--   - et surtout, la ligne d'acquisition `instagram · lancement · dm_exemple`
--     existait avec 0 visite, 0 analyse, 0 inscription, 0 achat — une ligne de
--     zéros, en bas d'un tableau trié par visites décroissantes.
-- Le chemin court marchait, la mesure marchait, le COMPTAGE ne suivait pas.
--
-- Cette migration ne touche ni au schéma, ni aux lignes, ni aux index : elle
-- remplace une fonction. `guide_view` entre dans le même compte, pour la même
-- raison — un guide est une page d'arrivée depuis un moteur de recherche.
--
-- La liste des quatre noms est reprise à l'identique dans lib/admin/data.ts
-- (VISIT_EVENTS) ; tests/pages-mesurees.test.tsx vérifie qu'elles ne divergent
-- pas.

begin;

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
  select date_trunc('day', occurred_at)::date as day,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as page_views,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'signup')::int as signups,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered group by 1 order by 1
), acquisition as (
  select coalesce(utm_source, 'non_attribue') as source,
    coalesce(utm_campaign, 'non_attribue') as campaign,
    coalesce(utm_content, 'non_attribue') as content,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as visits,
    count(*) filter (where event_name = 'analysis_started')::int as analyses,
    count(*) filter (where event_name = 'signup')::int as signups,
    count(*) filter (where event_name = 'purchase_completed')::int as purchases
  from filtered group by 1,2,3 order by visits desc, analyses desc limit 100
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
  'example', to_jsonb(example_totals)
) from feedback, purchase_totals, example_totals;
$$;

commit;

-- Effet sur l'historique : aucune ligne n'est réécrite. Les vues de guide et
-- d'exemple déjà enregistrées depuis la migration 20260928000033 entrent
-- rétroactivement dans le compte des visites — elles étaient là, elles n'étaient
-- pas comptées.
--
-- Rollback (manuel) : recréer admin_dashboard_metrics dans sa version de la
-- migration 20260928000033. Rien d'autre à défaire.
