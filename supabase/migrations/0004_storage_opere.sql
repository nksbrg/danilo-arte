-- Bucket Storage per le fotografie delle opere, e le sue policy.
-- Stesso criterio di autorizzazione della tabella opere: lettura pubblica,
-- scrittura solo is_verified_admin().

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'opere',
  'opere',
  true,
  10485760, -- 10 MB: limite lato Storage, oltre al controllo lato pannello
  array['image/jpeg', 'image/png', 'image/webp']
  -- HEIC (foto iPhone) volutamente escluso qui: i browser non lo
  -- visualizzano in modo affidabile e Supabase Storage non lo converte da
  -- solo. Vedi README-SUPABASE.md, sezione HEIC, per l'opzione di
  -- conversione lato pannello prima dell'upload.
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "opere_storage_lettura_pubblica" on storage.objects;
create policy "opere_storage_lettura_pubblica"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'opere');

drop policy if exists "opere_storage_insert_admin_mfa" on storage.objects;
create policy "opere_storage_insert_admin_mfa"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'opere' and public.is_verified_admin());

drop policy if exists "opere_storage_update_admin_mfa" on storage.objects;
create policy "opere_storage_update_admin_mfa"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'opere' and public.is_verified_admin())
  with check (bucket_id = 'opere' and public.is_verified_admin());

drop policy if exists "opere_storage_delete_admin_mfa" on storage.objects;
create policy "opere_storage_delete_admin_mfa"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'opere' and public.is_verified_admin());
