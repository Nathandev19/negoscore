-- Mission #067 — l'analyse suit la personne, pas le navigateur.
--
-- Jusqu'ici, une analyse faite sans compte n'était rattachée au compte que si
-- le cookie anonyme (deal_anon_token) était présent AU CLIC sur le lien de
-- connexion. Ouvert dans un autre navigateur (Safari → application Gmail), le
-- lien connectait bien la personne, mais l'analyse restait anonyme : 404.
--
-- Une « réclamation » est enregistrée au moment où la personne DEMANDE le lien,
-- depuis le navigateur qui porte le jeton anonyme. Elle dit : « la personne qui
-- ouvrira CE lien, connectée avec CETTE adresse, pourra récupérer les analyses
-- de CE jeton ».
--
--   email       adresse demandée, en minuscules ;
--   anon_token  jeton anonyme lu dans le cookie httpOnly de la demande, côté
--               serveur, jamais reçu du formulaire ni de l'adresse ;
--   nonce_hash  empreinte SHA-256 d'un secret aléatoire glissé dans le lien
--               envoyé par email. Le secret lui-même n'est jamais stocké ;
--   expires_at  2 heures après la demande (lib/auth/login-claims.ts).
--
-- Une réclamation ne sert qu'une fois : elle est supprimée quand elle est
-- utilisée. Les réclamations expirées sont supprimées par la purge quotidienne.
create table if not exists public.login_claims (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  anon_token text not null,
  nonce_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists login_claims_expires_at_idx on public.login_claims (expires_at);

-- Serveur uniquement : RLS activée sans aucune politique, privilèges retirés.
-- Seule la clé service_role (qui contourne la RLS) lit et écrit.
alter table public.login_claims enable row level security;
revoke all on table public.login_claims from anon, authenticated;
