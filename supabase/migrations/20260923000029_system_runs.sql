-- Mission #099, point 2 (audit A5) — rien ne prévenait si la purge s'arrêtait.
--
-- La purge quotidienne (app/api/purge/route.ts, cron Vercel) tient les
-- promesses de la politique de confidentialité : documents et textes collés
-- effacés au bout de 30 jours, paiements Whop rattrapés. Si le cron cesse de
-- passer — secret retiré, tâche désactivée — rien ne le disait : le silence a
-- exactement la même tête que le bon fonctionnement.
--
-- Une ligne par tâche récurrente, avec la date de son dernier passage RÉUSSI.
-- Le passage suivant compare : au-delà de 48 h, il journalise « purge_en_retard »
-- avec le nombre d'heures écoulées.
--
-- Écrite et lue uniquement par le serveur (clé de service).

create table if not exists public.system_runs (
  job text primary key,
  last_success_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.system_runs enable row level security;
revoke all on table public.system_runs from anon, authenticated;
