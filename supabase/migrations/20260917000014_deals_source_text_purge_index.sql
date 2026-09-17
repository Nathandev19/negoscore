-- Purge quotidienne du texte collé des offres (lib/privacy/purge.ts) : au bout
-- de 29 jours, deals.raw_text est remplacé par NULL, le deal et son analyse
-- restent. Aucune contrainte ne change : raw_text accepte déjà NULL.
-- Cet index partiel ne couvre que les deals dont le texte n'est pas encore
-- effacé : la requête quotidienne reste rapide quand la table grossit.
-- Optionnel : la purge fonctionne sans lui.
create index if not exists deals_created_at_with_raw_text_idx
  on public.deals (created_at)
  where raw_text is not null;
