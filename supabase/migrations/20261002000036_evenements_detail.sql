-- Mission #131 — voir les événements un par un.
--
-- /admin ne montrait que des totaux. Quand une ligne bougeait, on ne pouvait
-- savoir ni qui l'avait produite, ni quand, ni si deux lignes venaient de la
-- même personne. Le 01/10, trois questions ont coûté une heure chacune.
--
-- Trois colonnes de DIAGNOSTIC s'ajoutent à product_events. Elles ne décident
-- de rien : aucune RPC du cockpit ne les lit, aucun filtre ne s'y appuie. Elles
-- servent à lire une ligne, et seulement ça.
--
--   visitor         l'empreinte du jour, 6 caractères (voir plus bas)
--   internal_reason pourquoi la ligne est écartée : cookie, compte, mesure
--   agent_family    la famille de navigateur, jamais le user-agent
--
-- CE QUI N'EST PAS AJOUTÉ, ET VOLONTAIREMENT : l'adresse IP et le user-agent
-- brut. L'IP n'est jamais écrite, nulle part. Le user-agent identifierait un
-- appareil bien mieux que l'empreinte, et pour toujours.

-- ─── L'empreinte de visiteur, sans IP ──────────────────────────────────────
--
--   empreinte = sha256( sel_du_jour + adresse IP + user-agent )
--
-- C'est le mécanisme de Plausible et de Fathom, celui qui garde le site dans
-- l'exemption de consentement de la CNIL — donc sans bandeau cookies.
--
-- Le sel est tiré au hasard par le serveur, le même pour toute la journée, et
-- la purge quotidienne efface ceux de plus de deux jours. Une fois le sel
-- détruit, deux journées ne peuvent plus être reliées : même appareil, même
-- adresse, même navigateur, et pourtant deux empreintes sans rapport. La
-- question « cette personne est-elle revenue la semaine dernière ? » devient
-- sans réponse, y compris pour nous. C'est le prix, et il est voulu.
create table if not exists public.telemetry_salts (
  day date primary key,
  salt text not null check (char_length(salt) between 32 and 128),
  created_at timestamptz not null default now()
);

alter table public.telemetry_salts enable row level security;
-- Aucune politique : seule la clé de service écrit et lit cette table. Le sel
-- ne doit jamais atteindre un navigateur.

-- ─── Les trois colonnes de diagnostic ──────────────────────────────────────

-- Six caractères hexadécimaux, pas davantage : il n'existe nulle part de hash
-- complet à recouper. 16,7 millions de valeurs ; à cent événements par jour, la
-- probabilité que deux appareils différents partagent une empreinte dans la
-- même journée est de l'ordre de 0,03 %.
alter table public.product_events
  add column if not exists visitor text check (visitor is null or visitor ~ '^[0-9a-f]{6}$');

-- Table fermée : trois raisons, et rien d'autre. Une ligne interne SANS raison
-- serait un marquage qu'on ne peut pas vérifier.
alter table public.product_events
  add column if not exists internal_reason text
  check (internal_reason is null or internal_reason in ('cookie', 'compte', 'mesure'));

alter table public.product_events
  add column if not exists agent_family text
  check (agent_family is null or agent_family in (
    'mesure', 'robot', 'instagram', 'tiktok', 'edge', 'chrome', 'firefox', 'safari', 'inconnu'
  ));

-- La vue détaillée lit les 200 derniers événements, tous environnements
-- confondus : l'index du temps existe déjà (product_events_time_idx).

-- ─── À APPLIQUER À LA MAIN, puis à vérifier ────────────────────────────────
--
--   select count(*) filter (where visitor is not null) as avec_empreinte,
--          count(*) as total
--   from public.product_events
--   where occurred_at > now() - interval '1 hour';
--
-- Avant la migration, les trois colonnes n'existent pas et le code écrit sans
-- elles (lib/telemetry/tagged.ts, repli descendant). Après, elles se
-- remplissent toutes seules. Les lignes antérieures gardent trois valeurs
-- nulles : on ne recalcule pas une empreinte qu'on n'a pas mesurée.
--
-- ─── POUR REVENIR EN ARRIÈRE ───────────────────────────────────────────────
--
--   alter table public.product_events drop column if exists visitor;
--   alter table public.product_events drop column if exists internal_reason;
--   alter table public.product_events drop column if exists agent_family;
--   drop table if exists public.telemetry_salts;
