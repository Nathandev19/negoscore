-- Mission #080 bis, B — le message réellement envoyé à la marque.
--
-- La marque répond au message que la créatrice a ENVOYÉ, pas forcément à celui
-- que l'outil a proposé (elle a pu le modifier). Le tour suivant doit donc
-- lire la réponse à la lumière du message envoyé. Une ligne par tour :
--   - turn_number 1 : le message de l'analyse d'origine ;
--   - turn_number 2 à 5 : le message proposé à l'issue de ce tour.
-- source : « copied » (texte à l'écran au moment de la copie) ou « corrected »
-- (corrigé par la créatrice au moment de coller la réponse suivante).
-- Rien de plus : aucun appel au modèle, aucun crédit.
--
-- Conservé tant que l'analyse existe, supprimé avec elle ou avec le compte.
--
-- À appliquer à la main, APRÈS 20260919000022 (negotiation_turns).

create table if not exists public.negotiation_sent_messages (
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  turn_number int not null check (turn_number between 1 and 5),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 8000),
  source text not null check (source in ('copied', 'corrected')),
  updated_at timestamptz not null default now(),
  primary key (analysis_id, turn_number)
);

-- Écrit et lu uniquement par le serveur (clé de service), après contrôle du
-- propriétaire de l'analyse : aucun accès direct depuis le navigateur.
alter table public.negotiation_sent_messages enable row level security;
revoke all on table public.negotiation_sent_messages from anon, authenticated;
