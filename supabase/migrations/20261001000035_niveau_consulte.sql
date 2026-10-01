-- Mission #130 — un changement de niveau laisse une trace.
--
-- CONSTAT, 01/10 : les huit analyses enregistrées affichaient toutes
-- « starter », sans exception, depuis le 24/09.
--
-- ÉTABLI AVANT DE CORRIGER : ce n'est pas un défaut d'écriture. Changer de
-- niveau sur une page de résultat recalcule tout DANS LE NAVIGATEUR
-- (lib/analysis/recompute.ts, mission #039) et n'écrit rien sur la ligne de
-- l'analyse : ni mise à jour, ni nouvelle ligne. Le seul `update` jamais posé
-- sur public.analyses concerne `retried_at` (migration 018). Le niveau vit
-- dans `payload -> profile_tier`, écrit une fois à l'insertion, et
-- `admin_analyses_page` lit bien ce champ-là : la colonne de /admin montre
-- donc le niveau DU CALCUL, et elle s'appelle désormais « Niveau initial ».
--
-- CE QUE CETTE MIGRATION AJOUTE : le niveau consulté devient un événement, et
-- le tableau de bord en donne le compte par niveau. On n'écrase PAS le niveau
-- de l'analyse : son payload porte la fourchette, le score et la contre-offre
-- calculés à ce niveau-là, et y réécrire le niveau sans recalculer le reste
-- rendrait la ligne fausse.

begin;

-- ─── 1. Le nom d'événement est admis ──────────────────────────────────────
--
-- Même précaution qu'en 20260928000033 : sans cet ajout, chaque signalement
-- repart en HTTP 400 et l'erreur est avalée par recordProductEvent. Les
-- treize noms déjà admis sont repris à l'identique.

alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check
  check (event_name in (
    'landing_view', 'pricing_view', 'analysis_started', 'analysis_completed',
    'feedback_submitted', 'signup', 'negotiation_started', 'negotiation_turn',
    'negotiation_concluded', 'checkout_started', 'purchase_completed',
    'guide_view', 'example_view', 'tier_changed'
  ));

-- ─── 2. Le tableau de bord compte les niveaux consultés ───────────────────
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

-- Aucune ligne réécrite, aucune colonne ajoutée, aucun index touché : une
-- contrainte étendue et une fonction remplacée.
--
-- Rollback (manuel) : recréer admin_dashboard_metrics dans sa version de la
-- migration 20261001000034, puis remettre la contrainte à ses treize noms.
-- Ce retour en arrière ÉCHOUE si des changements de niveau ont déjà été
-- enregistrés : il faudrait les supprimer d'abord, ce qui est une perte de
-- données et une décision à prendre en connaissance de cause.
