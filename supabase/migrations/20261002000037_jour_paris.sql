-- Mission #140 — la courbe d’activité regroupe par jour de PARIS.
--
-- CONSTAT : /admin affichait ses heures en UTC, et la courbe regroupait par
-- jour UTC. Deux heures d’écart avec les journaux Vercel et les DM Instagram
-- ont déjà produit une conclusion fausse le 01/10.
--
-- L’affichage est corrigé côté application (lib/admin/heure.ts) : il ne
-- demandait aucune migration. LE REGROUPEMENT, lui, se fait ici.
--
-- CE QUI CHANGE EXACTEMENT : une ligne, dans le CTE `days`.
--
--   avant : date_trunc('day', occurred_at)::date
--   après : date_trunc('day', occurred_at at time zone 'Europe/Paris')::date
--
-- `date_trunc` sur un timestamptz utilise le fuseau de la SESSION, et
-- PostgREST ouvre les siennes en UTC. Un événement de 00h30 à Paris tombait
-- donc dans la journée de la VEILLE — soit, l’été, deux heures de chaque nuit
-- rangées du mauvais côté. C’est précisément l’heure à laquelle on travaille.
--
-- RIEN D’AUTRE NE BOUGE. Aucune colonne, aucune ligne, aucun index, et aucun
-- autre CTE : les totaux, l’acquisition, les guides et le funnel ne regroupent
-- pas par jour et ne sont donc pas concernés. Les bornes de période
-- (`p_since`) restent des instants, comparés à des instants : elles n’ont
-- jamais eu de problème de fuseau.
--
-- ORDRE D’APPLICATION : cette migration REMPLACE `admin_dashboard_metrics`
-- dans sa version de 20261001000035. Les migrations 20260928000033,
-- 20261001000034 et 20261001000035 doivent donc être appliquées AVANT
-- celle-ci, sans quoi on perdrait ce qu’elles ajoutent. 20261002000036
-- n’ajoute que des colonnes de diagnostic : son ordre est indifférent.

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

-- ─── À VÉRIFIER APRÈS APPLICATION ──────────────────────────────────────────
--
-- Un événement de nuit doit changer de journée. Avec une ligne du 2 octobre à
-- 00h30 heure de Paris (soit le 1er octobre à 22h30 UTC) :
--
--   select occurred_at,
--          date_trunc('day', occurred_at)::date as jour_utc,
--          date_trunc('day', occurred_at at time zone 'Europe/Paris')::date as jour_paris
--   from public.product_events
--   where occurred_at between '2026-10-01T21:00:00Z' and '2026-10-02T02:00:00Z'
--   order by occurred_at;
--
-- ─── POUR REVENIR EN ARRIÈRE ───────────────────────────────────────────────
--
-- Recréer `admin_dashboard_metrics` dans sa version de la migration
-- 20261001000035 : elle est identique à celle-ci, à la ligne `date_trunc`
-- près. Aucune donnée n’est perdue dans un sens comme dans l’autre — seule
-- la répartition des barres de la courbe change.
