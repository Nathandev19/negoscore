-- Les preuves de consentement au paiement documentent une transaction
-- commerciale : elles sont conservées quand l'utilisateur supprime son compte.
-- La clé étrangère vers auth.users supprimait ces lignes en cascade : elle est
-- retirée. user_id reste renseigné, sans lien vers une identité qui n'existe plus.
alter table public.checkout_consents drop constraint if exists checkout_consents_user_id_fkey;

-- Permet au serveur de vérifier, avant de supprimer un compte, qu'aucune clé
-- étrangère ne supprimera plus ces preuves. Tant que cette migration n'est pas
-- appliquée, la fonction n'existe pas et la suppression d'un compte qui a des
-- consentements est refusée.
create or replace function public.checkout_consents_survive_account_deletion()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.checkout_consents'::regclass
      and contype = 'f'
  );
$$;

revoke all on function public.checkout_consents_survive_account_deletion() from public, anon, authenticated;
grant execute on function public.checkout_consents_survive_account_deletion() to service_role;
