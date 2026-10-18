-- Mission #202, chantier D — POUVOIR EXPLIQUER LA QUEUE DE LATENCE D'UN TOUR.
--
-- `negotiation_turns.latency_ms` enferme TOUT l'appel au modèle, reprises
-- comprises : il est ouvert ligne 159 de lib/llm/extract.ts (avant la boucle
-- d'essais) et fermé ligne 205 (au premier essai dont la sortie passe le
-- schéma). Entre les deux il peut y avoir DEUX appels complets — MAX_ATTEMPTS
-- vaut 2 — plus une reprise réseau du SDK (maxRetries: 1).
--
-- Conséquence : une ligne à 36 243 ms et une ligne à 18 000 ms peuvent décrire
-- le même modèle à la même vitesse, l'une ayant simplement payé deux fois.
-- Aujourd'hui rien ne permet de les distinguer après coup, et c'est pour ça
-- que la queue de latence n'a pas pu être expliquée dans cette mission.
--
-- Ces deux colonnes sont déjà calculées à chaque tour (StructuredUsage.attempts
-- et .schemaValidFirstTry) : elles sont simplement jetées. Mêmes colonnes que
-- ce que l'éval enregistre déjà dans evals/results/.
--
-- À APPLIQUER À LA MAIN. Rien dans le code ne les écrit encore : les écrire
-- avant que la migration soit passée ferait échouer l'insertion de CHAQUE
-- tour. L'ordre est donc : appliquer ceci d'abord, brancher l'écriture ensuite.

alter table public.negotiation_turns
  add column if not exists attempts smallint;

alter table public.negotiation_turns
  add column if not exists schema_valid_first_try boolean;

comment on column public.negotiation_turns.attempts is
  'Nombre d''essais du modèle compris dans latency_ms (1 ou 2). NULL : tour enregistré avant la mission #202.';
comment on column public.negotiation_turns.schema_valid_first_try is
  'La sortie du premier essai passait le schéma. false : latency_ms contient deux appels.';
