-- Mission #118 — le cockpit ne compte aucun compte ni aucun appareil du
-- propriétaire.
--
-- La migration 31 sépare production / preview / development / test. Elle ne
-- sépare pas le trafic interne de celui des visiteurs : au 25/09, les 10
-- visites et l'unique analyse terminée venaient toutes de Nathan, EN
-- PRODUCTION. Le seul chiffre qui compte pendant le lancement était illisible.
--
-- POURQUOI UNE COLONNE ET PAS UNE VALEUR DE `environment` :
--   `environment` répond à « quel déploiement a écrit cette ligne »,
--   `internal` à « qui l'a produite ». Les deux sont orthogonales — on est
--   interne sur la production comme sur une prévisualisation — et les fondre
--   obligerait à perdre l'une des deux. Le CHECK de la migration 31 reste donc
--   intact, et rien de ce qu'elle a écrit n'est réinterprété.
--
-- AUCUNE ligne n'est supprimée ni reclassifiée. L'historique bascule en
-- `internal = false` par le DEFAULT : les jours déjà passés continuent de
-- compter le trafic du propriétaire, et c'est assumé. Le cockpit repart propre
-- à partir du marquage des appareils, pas avant.

begin;

-- ─── 1. La colonne, sur les tables que /admin compte ────────────────────────

alter table public.product_events add column if not exists internal boolean not null default false;
alter table public.analysis_feedback add column if not exists internal boolean not null default false;
alter table public.analyses add column if not exists internal boolean not null default false;
alter table public.deals add column if not exists internal boolean not null default false;
alter table public.purchases add column if not exists internal boolean not null default false;

-- ─── 2. Les index, calqués sur le filtre réel des requêtes admin ────────────
--
-- Toutes les requêtes du cockpit filtrent désormais LES DEUX champs. Les index
-- de la migration 31 sont remplacés par les mêmes, avec `internal` en seconde
-- position : les garder tous les deux n'apporterait rien et ferait payer deux
-- écritures d'index pour une. Aucune donnée n'est touchée ; la section
-- « Rollback » les recrée à l'identique.

create index if not exists product_events_env_internal_time_idx
  on public.product_events (environment, internal, occurred_at desc);
create index if not exists product_events_env_internal_name_time_idx
  on public.product_events (environment, internal, event_name, occurred_at desc);
create index if not exists analysis_feedback_env_internal_updated_idx
  on public.analysis_feedback (environment, internal, updated_at desc);
create index if not exists analyses_env_internal_created_idx
  on public.analyses (environment, internal, created_at desc);
create index if not exists deals_env_internal_created_idx
  on public.deals (environment, internal, created_at desc);
create index if not exists purchases_env_internal_paid_idx
  on public.purchases (environment, internal, paid_at desc);

drop index if exists public.product_events_env_time_idx;
drop index if exists public.product_events_env_name_time_idx;
drop index if exists public.analysis_feedback_env_updated_idx;
drop index if exists public.analyses_env_created_idx;
drop index if exists public.deals_env_created_idx;
drop index if exists public.purchases_env_paid_idx;

-- ─── 3. Le tableau de bord écarte l'interne, et dit combien ─────────────────
--
-- Deux compteurs côte à côte, et ils ne se recouvrent pas :
--   - `excluded` : lignes hors production (local, prévisualisation, tests,
--     historique d'avant la migration 31) — inchangé ;
--   - `internal` : lignes DE PRODUCTION écartées parce qu'elles viennent du
--     propriétaire. C'est le compteur de la mission #118, et c'est la preuve
--     visible que le marquage travaille.
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
  'acquisition', coalesce((select jsonb_agg(to_jsonb(acquisition)) from acquisition), '[]'::jsonb)
) from feedback, purchase_totals;
$$;

-- ─── 4. Les listes comptent la même chose que le tableau de bord ────────────
--
-- Même filtre, sinon un dossier créé depuis mon téléphone continuerait de
-- gonfler la colonne « Dossiers » et la liste des analyses. Les colonnes
-- affichées et l'ordre ne changent pas : seule la provenance des lignes est
-- restreinte. Les comptes, eux, restent tous listés — un compte interne n'est
-- pas caché, ce sont ses lignes qui ne sont plus comptées.
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
    (select count(*)::int from public.deals d where d.user_id=p.id and d.environment='production' and not d.internal) as analyses,
    greatest(p.created_at,
      coalesce((select max(d.created_at) from public.deals d where d.user_id=p.id and d.environment='production' and not d.internal), p.created_at),
      coalesce((select max(pe.occurred_at) from public.product_events pe where pe.user_id=p.id and pe.environment='production' and not pe.internal), p.created_at)
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
  where a.environment='production' and not a.internal
), page as (
  select * from base order by created_at desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)
)
select jsonb_build_object('total',(select count(*) from base),'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb));
$$;

commit;

-- ─── Lire les jours DÉJÀ PASSÉS, sans rien réécrire ─────────────────────────
--
-- Avant cette migration, aucune ligne ne porte la marque : les chiffres des
-- jours passés incluent le propriétaire et ne peuvent pas être nettoyés sans
-- réécrire l'historique, ce qu'on ne fait pas. Ils se LISENT en revanche très
-- bien, à la main, en écartant les comptes connus. Requête de lecture seule :
--
--   with interne(email) as (values ('adresse-1@exemple.fr'), ('adresse-2@exemple.fr'))
--   select date_trunc('day', pe.occurred_at)::date as jour,
--          count(*) filter (where pr.email is null) as sans_compte,
--          count(*) filter (where pr.email in (select email from interne)) as comptes_internes,
--          count(*) filter (where pr.email is not null and pr.email not in (select email from interne)) as autres_comptes
--   from public.product_events pe
--   left join public.profiles pr on pr.id = pe.user_id
--   where pe.environment = 'production'
--   group by 1 order by 1;
--
-- (Les adresses se remplacent par celles de OWNER_EMAIL et INTERNAL_EMAILS ;
--  elles ne sont écrites nulle part dans le code, et n'ont pas à l'être.)
--
-- `sans_compte` reste ambigu : une visite déconnectée du propriétaire y est
-- indiscernable d'une visite d'inconnu. C'est exactement le trou que cette
-- migration ferme pour la suite, et qu'elle ne peut pas fermer en arrière.

-- Rollback (manuel) : recréer les trois fonctions dans leur version de la
-- migration 20260924000031, puis
--   create index if not exists product_events_env_time_idx on public.product_events (environment, occurred_at desc);
--   create index if not exists product_events_env_name_time_idx on public.product_events (environment, event_name, occurred_at desc);
--   create index if not exists analysis_feedback_env_updated_idx on public.analysis_feedback (environment, updated_at desc);
--   create index if not exists analyses_env_created_idx on public.analyses (environment, created_at desc);
--   create index if not exists deals_env_created_idx on public.deals (environment, created_at desc);
--   create index if not exists purchases_env_paid_idx on public.purchases (environment, paid_at desc);
--   drop index if exists public.product_events_env_internal_time_idx;  -- idem pour les cinq autres
--   alter table public.product_events drop column if exists internal;  -- idem sur les quatre autres tables
-- Aucune donnée n'est perdue par ce retour en arrière : la colonne ajoutée est
-- la seule chose que cette migration écrit.
