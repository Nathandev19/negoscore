-- Bucket privé des documents déposés. public = false : aucune URL publique.
-- Aucune politique n'est créée sur storage.objects pour ce bucket : ni anon
-- ni authenticated ne peuvent lire, lister, écrire ou supprimer. Le dépôt se
-- fait uniquement par URL signée générée côté serveur avec la clé service_role,
-- et la lecture uniquement par le serveur.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-documents',
  'deal-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
