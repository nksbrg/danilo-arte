-- Policy RLS sulla tabella public.opere.
-- Lettura: pubblica (anche utenti anonimi — è il sito pubblico).
-- Scrittura (insert/update/delete): solo is_verified_admin().

drop policy if exists "opere_lettura_pubblica" on public.opere;
create policy "opere_lettura_pubblica"
  on public.opere
  for select
  to anon, authenticated
  using (true);

drop policy if exists "opere_insert_admin_mfa" on public.opere;
create policy "opere_insert_admin_mfa"
  on public.opere
  for insert
  to authenticated
  with check (public.is_verified_admin());

drop policy if exists "opere_update_admin_mfa" on public.opere;
create policy "opere_update_admin_mfa"
  on public.opere
  for update
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

drop policy if exists "opere_delete_admin_mfa" on public.opere;
create policy "opere_delete_admin_mfa"
  on public.opere
  for delete
  to authenticated
  using (public.is_verified_admin());

-- Nessuna policy per il ruolo "anon" su insert/update/delete: di conseguenza
-- sono negati di default (RLS nega tutto ciò che nessuna policy permette
-- esplicitamente).
