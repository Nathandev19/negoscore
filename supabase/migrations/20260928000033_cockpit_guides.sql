-- Mission #120 — les guides et la page d'exemple deviennent lisibles dans le
-- cockpit.
--
-- Deux nouveaux noms d'événement : `guide_view` et `example_view`. Ils
-- s'écrivent dans public.product_events comme tous les autres, avec leur
-- `environment` (migration 31) et leur `internal` (migration 32) — les filtres
-- du cockpit s'appliquent donc à eux sans rien ajouter, et `counts` les compte
-- déjà puisqu'il agrège par event_name.
--
-- IL FAUT EN REVANCHE LES AUTORISER. La table porte depuis la migration 30 une
-- contrainte CHECK qui énumère les noms d'événement admis. Constaté en
-- exécutant vraiment la page sur le serveur de développement : sans cet ajout,
-- chaque vue est refusée en HTTP 400 et ne laisse qu'une ligne
-- `product_telemetry_error` dans les journaux — l'écriture échoue en silence,
-- la page s'affiche normalement, et le cockpit reste vide sans dire pourquoi.
-- La contrainte est étendue, jamais remplacée par autre chose : les onze noms
-- d'origine sont repris à l'identique.
--
-- Cette migration ajoute ensuite la RÉPONSE À UNE QUESTION que `counts` ne peut
-- pas donner : combien de gens sont arrivés sur un guide, et combien d'entre
-- eux ont cliqué vers l'exemple chiffré. La jointure se fait sur le chemin du
-- guide, présent des deux côtés :
--   - `path` pour la vue du guide ;
--   - `entity_id` pour la vue de l'exemple, où la route d'enregistrement
--     (app/api/vue/route.ts) écrit le chemin d'ORIGINE du clic, lu dans le
--     paramètre ?de= et validé contre une table fermée. `entity_id` nul = la
--     personne est arrivée directement sur l'exemple.
--
-- Aucune ligne n'est supprimée ni modifiée, aucun index n'est touché : ceux de
-- la migration 32 couvrent déjà (environment, internal, event_name, occurred_at).

begin;

-- ─── 1. Les deux noms d'événement sont admis ───────────────────────────────

alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check
  check (event_name in (
    'landing_view', 'pricing_view', 'analysis_started', 'analysis_completed',
    'feedback_submitted', 'signup', 'negotiation_started', 'negotiation_turn',
    'negotiation_concluded', 'checkout_started', 'purchase_completed',
    'guide_view', 'example_view'
  ));

-- ─── 2. Le chemin guide → exemple, dans le tableau de bord ─────────────────

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
-- ─── Mission #120 — le chemin guide → exemple ──────────────────────────────
), guide_views as (
  select path, count(*)::int as views
  from filtered where event_name = 'guide_view' and path is not null group by 1
), example_origin as (
  select entity_id as path, count(*)::int as to_example
  from filtered where event_name = 'example_view' and entity_id is not null group by 1
), guides as (
  -- Jointure externe des deux côtés : un guide vu sans aucun clic doit
  -- apparaître avec un zéro, et un clic dont le guide n'a enregistré aucune vue
  -- (mesure bloquée, images désactivées) ne doit pas disparaître non plus.
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

-- Rollback (manuel) : recréer admin_dashboard_metrics dans sa version de la
-- migration 20260925000032, puis remettre la contrainte d'origine :
--   alter table public.product_events drop constraint if exists product_events_event_name_check;
--   alter table public.product_events add constraint product_events_event_name_check
--     check (event_name in ('landing_view','pricing_view','analysis_started','analysis_completed',
--       'feedback_submitted','signup','negotiation_started','negotiation_turn',
--       'negotiation_concluded','checkout_started','purchase_completed'));
-- Ce retour en arrière ÉCHOUE si des vues de guide ont déjà été enregistrées :
-- il faudrait alors les supprimer d'abord, ce qui est une perte de données et
-- une décision à prendre en connaissance de cause. Cette migration, elle, n'en
-- détruit aucune.
--
-- Aucune colonne ajoutée, aucun index créé ou supprimé, aucune ligne réécrite.
