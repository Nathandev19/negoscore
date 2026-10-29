-- Mission #209 — LE COMPORTEMENT EN PAGE, parce que le funnel ne peut pas
-- séparer deux hypothèses.
--
-- Constat : 400 visites payantes, zéro analyse. Le cockpit mesure les ÉTAPES
-- (visite → arrivée → analyse → inscription → achat) et rien de ce qui se
-- passe À L'INTÉRIEUR d'une page. Deux explications restaient donc ouvertes
-- sans pouvoir être distinguées : le trafic n'était pas réel, ou la page
-- n'appelle aucune action.
--
-- UN SEUL ÉVÉNEMENT NOUVEAU, `page_engagement`, émis une fois par page vue, au
-- départ de la page. Pas un flux : ni un événement par palier de défilement,
-- ni un battement périodique. Il n'y a donc rien à reconstituer — une ligne
-- par page vue, et aucun identifiant qui relie deux lignes.
--
-- CE QU'IL SE PASSE SI CETTE MIGRATION N'EST PAS ENCORE APPLIQUÉE : l'insert
-- est refusé par la contrainte de liste fermée, recordProductEvent l'attrape
-- et journalise `product_telemetry_error`. Les pages fonctionnent exactement
-- comme avant — la mesure part après l'affichage et ne bloque rien.
--
-- À APPLIQUER À LA MAIN. Aucune donnée ancienne n'est reconstruite : les
-- visites déjà enregistrées n'ont pas de comportement en page, et elles
-- n'en auront jamais.

begin;

-- ─── 1. Le nouvel événement entre dans la liste fermée ─────────────────────
--
-- Liste reprise de la migration 40, plus une ligne. Rien d'autre ne change.
alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check
  check (event_name in (
    'landing_view', 'pricing_view', 'analysis_started', 'analysis_completed',
    'feedback_submitted', 'signup', 'negotiation_started', 'negotiation_turn',
    'negotiation_concluded', 'checkout_started', 'purchase_completed',
    'guide_view', 'example_view', 'tier_changed', 'analysis_page_view',
    'carte_partagee', 'carte_telechargee',
    'page_engagement'
  ));

-- ─── 2. LA FORME DU RELEVÉ, VÉRIFIÉE PAR LA BASE AUSSI ─────────────────────
--
-- `metadata` est un jsonb libre depuis la migration 30, et aucun événement ne
-- l'avait jamais agrégé. À partir du moment où le cockpit LIT ces clés, un
-- jsonb libre n'est plus acceptable : une faute de frappe côté code créerait
-- une catégorie silencieuse que personne ne verrait dans un graphique.
--
-- La route valide déjà ces valeurs contre une liste fermée (app/api/events/
-- route.ts). Cette contrainte est la seconde barrière, et la seule qui tienne
-- si un jour une autre écriture arrive par un autre chemin : CINQ clés,
-- exactement, chacune dans son vocabulaire.
--
-- Les tranches, et pas des valeurs exactes : une durée à la milliseconde près
-- est une empreinte, une tranche n'en est pas une.
alter table public.product_events drop constraint if exists product_events_engagement_metadata_check;
alter table public.product_events add constraint product_events_engagement_metadata_check
  check (
    event_name <> 'page_engagement'
    or (
      -- Exactement ces cinq clés, ni plus ni moins.
      (select array_agg(k order by k) from jsonb_object_keys(metadata) as k)
        = array['dwell', 'first_action', 'input', 'scroll', 'scrolled']
      -- Les bornes, et d'où elles viennent, sont écrites une seule fois :
      -- lib/analytics/engagement.ts. 90 % est la borne publiée de GA4 pour
      -- « a atteint le bas de la page » ; 5 s le seul seuil que Microsoft
      -- Clarity publie ; 10 s celui d'une session « engagée » de GA4.
      and metadata->>'scroll' in ('0', '1-25', '26-50', '51-75', '76-89', '90-100')
      and metadata->>'dwell' in ('0-1s', '1-5s', '5-10s', '10-30s', '30s+')
      and metadata->>'first_action' in ('0-1s', '1-5s', '5-10s', '10s+', 'aucun')
      and metadata->>'input' in ('aucun', 'text', 'photo', 'pdf')
      and jsonb_typeof(metadata->'scrolled') = 'boolean'
      -- Un défilement EST un geste : « a défilé » avec « premier geste :
      -- aucun » décrirait une mesure cassée.
      and (metadata->>'scrolled' = 'false' or metadata->>'first_action' <> 'aucun')
    )
  );

-- L'agrégation lit event_name, path et utm_medium sur une période. L'index
-- existant (environment, event_name, occurred_at desc) de la migration 31
-- couvre déjà le filtre ; celui-ci sert au regroupement par page et par canal.
create index if not exists product_events_engagement_idx
  on public.product_events (environment, event_name, path, utm_medium)
  where event_name = 'page_engagement';

-- ─── 3. Le cockpit sait lire le comportement en page ───────────────────────
--
-- Fonction reprise ENTIÈRE depuis la migration 38 (referrer_domain), avec
-- deux CTE ajoutées et deux clés de plus dans l'objet rendu. Tout le reste est
-- identique au caractère près : `create or replace` remplace la fonction
-- complète, donc une omission ici supprimerait un bloc du cockpit.
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
), engagement as (
  -- Mission #209 — LE COMPORTEMENT EN PAGE, par page et par CANAL.
  --
  -- Le canal est `utm_medium`, pas la source : c'est lui qui distingue le
  -- payant (paid_social) de la portée organique (organic_social), du message
  -- privé (dm) et de l'arrivée directe (aucun utm). Le regroupement de la
  -- migration 30 par source/campagne/contenu ne le porte pas, et c'est
  -- exactement la comparaison demandée ici.
  --
  -- QUATRE COMPTEURS STRICTEMENT EMBOÎTÉS, et trois mesures à part.
  --
  -- L'ordre n'est pas décoratif : un défilement EST un geste (le relevé
  -- appelle noterGeste sur l'événement scroll), donc `scrolled` est inclus
  -- dans `interacted`, et jamais l'inverse. L'ordre naïf — total, a défilé,
  -- a fait un geste — aurait produit un entonnoir qui remonte, et le
  -- graphique l'aurait masqué en bornant le taux à 100 %.
  --
  --   total          pages vues où la mesure a pu partir
  --   interacted     un geste quelconque : défilement, pointeur, touche
  --   scrolled       la page a bougé d'au moins un pixel
  --   read_to_end    90 % atteints, la borne publiée de GA4 pour « lue »
  --
  -- `input_touched` n'est PAS dans l'entonnoir : on peut toucher le champ sans
  -- avoir défilé, il n'est donc pas inclus dans `scrolled`. C'est la mesure
  -- qui compte le plus, et elle se lit sur le total.
  --
  -- `under_5s` et `idle_no_action` sont les deux branches de la « faible
  -- intention » telle que Microsoft Clarity la définit : moins de cinq
  -- secondes, OU resté plus longtemps sans interagir. Les deux pointent vers
  -- un trafic qui n'a jamais regardé la page.
  select path,
    coalesce(utm_medium, 'direct') as medium,
    count(*)::int as total,
    count(*) filter (where metadata->>'first_action' <> 'aucun')::int as interacted,
    count(*) filter (where metadata->>'scrolled' = 'true')::int as scrolled,
    count(*) filter (where metadata->>'scroll' = '90-100')::int as read_to_end,
    count(*) filter (where metadata->>'input' <> 'aucun')::int as input_touched,
    count(*) filter (where metadata->>'dwell' in ('0-1s', '1-5s'))::int as under_5s,
    count(*) filter (where metadata->>'first_action' = 'aucun' and metadata->>'dwell' not in ('0-1s', '1-5s'))::int as idle_no_action
  from filtered
  where event_name = 'page_engagement' and path is not null
  group by 1, 2 order by 3 desc limit 50
), engagement_scroll as (
  -- La distribution de la profondeur atteinte, par canal. Une seule mesure —
  -- des pages vues — répartie en tranches.
  select coalesce(utm_medium, 'direct') as medium,
    metadata->>'scroll' as bucket,
    count(*)::int as total
  from filtered
  where event_name = 'page_engagement' and metadata->>'scroll' is not null
  group by 1, 2 order by 1, 2
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
  'tier_changes', coalesce((select jsonb_agg(to_jsonb(tier_changes)) from tier_changes), '[]'::jsonb),
  'engagement', coalesce((select jsonb_agg(to_jsonb(engagement)) from engagement), '[]'::jsonb),
  'engagement_scroll', coalesce((select jsonb_agg(to_jsonb(engagement_scroll)) from engagement_scroll), '[]'::jsonb)
) from feedback, purchase_totals, example_totals;
$$;

commit;
