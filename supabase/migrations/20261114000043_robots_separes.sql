-- Mission #213 — LE COMPTEUR COMPTAIT DES ROBOTS QUI NE DISENT PAS LEUR NOM.
--
-- Constat releve dans /admin/evenements sur la fenetre 11 au 14/11/2026 : 5 a
-- 8 landing_view par jour sur l'accueil, toutes en « direct », sans referent,
-- empreinte differente a chaque fois, User-Agent Chrome. Sur 26 pages vues :
-- 0 defilement, 0 geste, 0 contact avec le champ de collage, et un
-- page_engagement 2 a 4 secondes apres le landing_view. Le trafic humain reel
-- de la periode se comptait sur trois doigts.
--
-- Ce que ca coute : le compteur de l'admin est la source autoritaire du
-- projet, trois canaux ont ete fermes sur la foi de ses denominateurs, et il
-- surestimait d'un ordre de grandeur.
--
-- CE QUE CETTE MIGRATION AJOUTE, ET POURQUOI TROIS COLONNES :
--
--   robot            le verdict, un booleen. C'est lui que l'agregation lit.
--   robot_reason     POURQUOI. Sans elle, un classement ne se relit pas, donc
--                    ne se corrige pas — et la mission demande explicitement
--                    de pouvoir reviser. Vocabulaire ferme, comme
--                    internal_reason depuis la migration 36.
--   agent_signature  la forme de l'agent, grossiere. C'est ce qui tranche la
--                    ou `visitor` ne peut pas : `visitor` hache sel+IP+agent,
--                    donc il change des que l'adresse change — c'est ce que
--                    le constat decrit (« empreinte differente a chaque
--                    fois »). La forme d'agent, elle, ne bouge pas.
--
-- SEPARER, PAS SUPPRIMER. Aucune ligne n'est effacee, aucune n'est reecrite.
-- Les lignes deja enregistrees gardent robot = false : elles ont ete comptees
-- comme humaines et le resteront, parce qu'on ne reecrit pas une mesure
-- passee. Ce que ca veut dire pour la lecture, sans detour : la fenetre du
-- 11 au 14/11 restera surestimee a l'ecran. Le filtre ne vaut que pour ce
-- qui arrive apres son application.
--
-- AUCUNE DONNEE PERSONNELLE. Pas d'adresse IP, ni en clair ni hachee — elle
-- n'entre que dans `visitor`, et seulement le temps d'un calcul (#131). Pas
-- de User-Agent brut : la contrainte ci-dessous l'interdit a la base, et pas
-- seulement au code.
--
-- A APPLIQUER A LA MAIN. Le code sait ecrire sans ces colonnes tant qu'elles
-- n'existent pas (lib/analytics/first-party.ts, repli en deux temps) : un
-- deploiement avant l'application de cette migration n'echoue pas, il perd
-- seulement le classement.

begin;

alter table public.product_events
  add column if not exists robot boolean not null default false;

alter table public.product_events
  add column if not exists robot_reason text;

alter table public.product_events
  add column if not exists agent_signature text;

comment on column public.product_events.robot is
  'Visite classee automatique. Exclue des compteurs par admin_dashboard_metrics, jamais supprimee.';
comment on column public.product_events.robot_reason is
  'Pourquoi la ligne est classee robot. Null quand robot vaut false.';
comment on column public.product_events.agent_signature is
  'Forme grossiere de l''agent : famille-version|plateforme|format. Jamais le User-Agent complet.';

-- LE VOCABULAIRE EST FERME, et la coherence est tenue DANS LES DEUX SENS :
-- une raison sans verdict serait aussi fausse qu'un verdict sans raison.
--
-- `coalesce(..., false)` : dans PostgreSQL, un CHECK dont l'expression vaut
-- NULL est SATISFAIT. C'est le trou trouve en #209 bis, et il se reouvrirait
-- ici — `robot_reason in (...)` vaut NULL quand la colonne est NULL, donc
-- toute la conjonction vaudrait NULL, donc n'importe quoi passerait.
alter table public.product_events drop constraint if exists product_events_robot_reason_check;
alter table public.product_events add constraint product_events_robot_reason_check
  check (
    coalesce(
      case when robot
        then robot_reason in ('declare', 'signature', 'prefetch', 'sans_agent', 'sans_indices')
        else robot_reason is null
      end,
      false
    )
  );

-- LE USER-AGENT BRUT NE PEUT PAS ENTRER DANS CETTE COLONNE, et c'est la base
-- qui le garantit, pas la relecture du code.
--
-- Pas une expression reguliere mais trois faits, chacun IMMUTABLE et lisible :
-- une forme d'agent est courte, elle ne contient aucune espace, et elle porte
-- exactement deux barres verticales. Toute chaine User-Agent reelle contient
-- des espaces et des parentheses : « Mozilla/5.0 (Windows NT 10.0) ... ». Elle
-- est donc refusee par le deuxieme fait, sans qu'on ait a deviner sa forme.
alter table public.product_events drop constraint if exists product_events_agent_signature_check;
alter table public.product_events add constraint product_events_agent_signature_check
  check (
    agent_signature is null
    or (
      length(agent_signature) <= 60
      and position(' ' in agent_signature) = 0
      and length(agent_signature) - length(replace(agent_signature, '|', '')) = 2
    )
  );

-- La fonction du cockpit, reemise en entier : `create or replace` remplace la
-- fonction ENTIERE, donc tout ce qui etait rendu par la migration 42 doit se
-- retrouver ici. C'est le texte de la 42, plus `not robot` dans `filtered`,
-- plus les CTE `robot_events`, `robot_reasons` et `agents_base`, plus les
-- deux cles. tests/migrations-moteur.test.ts l'execute sur un vrai moteur et
-- compare les cles rendues a celles que le cockpit lit.

create or replace function public.admin_dashboard_metrics(p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
with filtered as (
  -- Mission #213 — `not robot` s'ajoute ici, et nulle part ailleurs.
  --
  -- C'est le MEME endroit que `not internal` depuis la #118, et c'est
  -- volontaire : tout ce que le cockpit affiche descend de cette CTE, donc une
  -- exclusion ecrite ici vaut pour la tuile, la courbe, le funnel, le tableau
  -- par source et les releves de comportement, sans qu'aucun des six ait a la
  -- connaitre. Une exclusion ecrite dans six endroits aurait fini par diverger
  -- dans l'un d'eux, et c'est exactement le defaut de la #129 (deux nombres
  -- appeles « Visites » sur le meme ecran).
  select * from public.product_events
  where environment = 'production' and not internal and not robot
    and (p_since is null or occurred_at >= p_since)
), excluded as (
  select count(*)::int as total from public.product_events
  where environment <> 'production' and (p_since is null or occurred_at >= p_since)
), internal_events as (
  select count(*)::int as total from public.product_events
  where environment = 'production' and internal and (p_since is null or occurred_at >= p_since)
), robot_events as (
  -- Mission #213 — LES VISITES ECARTEES PARCE QUE CE N'EST PERSONNE.
  --
  -- `visits` compte les memes evenements que `visitCount` cote applicatif
  -- (lib/admin/data.ts, VISIT_EVENTS) : sinon le nombre affiche a cote des
  -- « visites humaines » ne serait pas comparable, et c'est precisement le
  -- defaut qu'on repare.
  --
  -- NE RECOUVRE NI `excluded` NI `internal` : production uniquement, non
  -- interne. Les trois compteurs d'exclusion restent disjoints, comme la #118
  -- l'a etabli pour les deux premiers.
  select count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as visits
  from public.product_events
  where environment = 'production' and not internal and robot
    and (p_since is null or occurred_at >= p_since)
), robot_reasons as (
  select coalesce(robot_reason, 'sans_raison') as reason,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as visits
  from public.product_events
  where environment = 'production' and not internal and robot
    and (p_since is null or occurred_at >= p_since)
  group by 1 having count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view')) > 0
  order by 2 desc, 1
), agents_base as (
  -- Humaines ET robots dans la meme liste, avec la colonne qui dit laquelle :
  -- deux tableaux separes ne permettraient pas de voir qu'une seule forme
  -- d'agent porte presque tout le trafic.
  select coalesce(agent_signature, 'inconnue') as signature, robot,
    count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view'))::int as visits
  from public.product_events
  where environment = 'production' and not internal
    and (p_since is null or occurred_at >= p_since)
  group by 1, 2
  having count(*) filter (where event_name in ('landing_view','pricing_view','guide_view','example_view')) > 0
  order by 3 desc, 1 limit 20
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
  'engagement_scroll', coalesce((select jsonb_agg(to_jsonb(engagement_scroll)) from engagement_scroll), '[]'::jsonb),
  'robots', jsonb_build_object(
    'visits', (select visits from robot_events),
    'reasons', coalesce((select jsonb_agg(to_jsonb(robot_reasons)) from robot_reasons), '[]'::jsonb)
  ),
  'agents', coalesce((select jsonb_agg(to_jsonb(agents_base)) from agents_base), '[]'::jsonb)
) from feedback, purchase_totals, example_totals;
$$;

commit;
