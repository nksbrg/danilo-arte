-- Test automatici delle policy RLS reali definite in supabase/migrations/.
-- Eseguito da test/run-rls-tests.sh su un database Postgres locale "nudo"
-- (dopo aver applicato _shim_supabase_auth.sql e le migrazioni vere).
--
-- Ogni asserzione fallita interrompe lo script con un errore esplicito
-- (RAISE EXCEPTION): uno script che arriva fino in fondo e stampa il
-- messaggio finale significa che le policy si comportano come documentato.

\set ON_ERROR_STOP on

do $$
declare
  danilo_id uuid := '11111111-1111-1111-1111-111111111111';
  estraneo_id uuid := '22222222-2222-2222-2222-222222222222';
  n int;
  nuovo_id uuid;
  nuovo_titolo text;
  ha_sollevato_errore boolean;
begin
  -- Setup -------------------------------------------------------------
  insert into auth.users (id, email) values
    (danilo_id, 'danilo@example.com'),
    (estraneo_id, 'estraneo@example.com');
  insert into public.admins (user_id, email) values (danilo_id, 'danilo@example.com');
  insert into storage.buckets (id, name, public)
    values ('opere', 'opere', true)
    on conflict (id) do nothing;

  -- TEST 1: anon legge opere (nessun errore, 0 righe) ------------------
  set role anon;
  perform set_config('request.jwt.claims', '', false);
  select count(*) into n from public.opere;
  if n <> 0 then raise exception 'TEST 1 fallito: attese 0 righe, trovate %', n; end if;
  reset role;

  -- TEST 2: anon non può inserire opere --------------------------------
  set role anon;
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path) values ('x', 'x.jpg');
  exception when insufficient_privilege then
    ha_sollevato_errore := true;
  end;
  reset role;
  if not ha_sollevato_errore then raise exception 'TEST 2 fallito: anon ha potuto inserire un''opera'; end if;

  -- TEST 3: authenticated senza whitelist e senza MFA non può inserire --
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', estraneo_id, 'aal', 'aal1')::text, false);
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path) values ('x', 'x.jpg');
  exception when insufficient_privilege then
    ha_sollevato_errore := true;
  end;
  reset role;
  if not ha_sollevato_errore then raise exception 'TEST 3 fallito: un utente non admin ha potuto inserire un''opera'; end if;

  -- TEST 4: admin in whitelist ma senza MFA (aal1) non può inserire -----
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal1')::text, false);
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path) values ('x', 'x.jpg');
  exception when insufficient_privilege then
    ha_sollevato_errore := true;
  end;
  reset role;
  if not ha_sollevato_errore then raise exception 'TEST 4 fallito: un admin SENZA sessione MFA (aal1) ha potuto inserire'; end if;

  -- TEST 5: admin in whitelist CON MFA (aal2) può inserire --------------
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal2')::text, false);
  insert into public.opere (titolo, image_path, ordine)
    values ('Opera vera', 'opere/vera.jpg', 1)
    returning id into nuovo_id;
  reset role;
  if nuovo_id is null then raise exception 'TEST 5 fallito: un admin CON sessione MFA non ha potuto inserire'; end if;

  -- TEST 6: anon ora vede la riga appena inserita -----------------------
  set role anon;
  perform set_config('request.jwt.claims', '', false);
  select count(*) into n from public.opere where id = nuovo_id;
  reset role;
  if n <> 1 then raise exception 'TEST 6 fallito: anon non vede l''opera pubblicata (%)', n; end if;

  -- TEST 7: admin con MFA può aggiornare ---------------------------------
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal2')::text, false);
  update public.opere set titolo = 'Opera vera (modificata)' where id = nuovo_id
    returning titolo into nuovo_titolo;
  reset role;
  if nuovo_titolo is distinct from 'Opera vera (modificata)' then
    raise exception 'TEST 7 fallito: l''admin con MFA non ha potuto aggiornare l''opera';
  end if;

  -- TEST 8: utente autenticato con MFA ma NON admin non può eliminare ----
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', estraneo_id, 'aal', 'aal2')::text, false);
  delete from public.opere where id = nuovo_id;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'TEST 8 fallito: un utente non admin ha eliminato un''opera (% righe)', n; end if;

  -- TEST 9: admin con MFA può eliminare ----------------------------------
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal2')::text, false);
  delete from public.opere where id = nuovo_id;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'TEST 9 fallito: l''admin con MFA non ha potuto eliminare (% righe)', n; end if;

  -- TEST 10: STORAGE - anon legge oggetti nel bucket (nessun errore) ----
  set role anon;
  perform set_config('request.jwt.claims', '', false);
  select count(*) into n from storage.objects where bucket_id = 'opere';
  reset role;
  if n <> 0 then raise exception 'TEST 10 fallito: attese 0 righe storage, trovate %', n; end if;

  -- TEST 11: STORAGE - anon non può inserire oggetti ---------------------
  set role anon;
  ha_sollevato_errore := false;
  begin
    insert into storage.objects (bucket_id, name) values ('opere', 'x.jpg');
  exception when insufficient_privilege then
    ha_sollevato_errore := true;
  end;
  reset role;
  if not ha_sollevato_errore then raise exception 'TEST 11 fallito: anon ha potuto caricare un file nello storage'; end if;

  -- TEST 12: STORAGE - admin con MFA può inserire oggetti -----------------
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal2')::text, false);
  insert into storage.objects (bucket_id, name) values ('opere', 'foto-vera.jpg');
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'TEST 12 fallito: l''admin con MFA non ha potuto caricare un file'; end if;

  -- TEST 13: ordinamento deterministico (parità di "ordine" -> titolo) ---
  insert into public.opere (titolo, image_path, ordine) values
    ('Zeta', 'z.jpg', 5), ('Alfa', 'a.jpg', 5), ('Beta', 'b.jpg', 1);
  if (
    select array_agg(titolo order by ordine, titolo)
    from public.opere where titolo in ('Zeta', 'Alfa', 'Beta')
  ) <> array['Beta', 'Alfa', 'Zeta'] then
    raise exception 'TEST 13 fallito: ordinamento non deterministico';
  end if;

  -- TEST 14: mio_stato_admin() riflette correttamente whitelist + MFA ----
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal1')::text, false);
  if (select public.mio_stato_admin()) <> jsonb_build_object('is_admin', true, 'has_mfa', false) then
    reset role;
    raise exception 'TEST 14a fallito: mio_stato_admin() errato per admin senza MFA';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal2')::text, false);
  if (select public.mio_stato_admin()) <> jsonb_build_object('is_admin', true, 'has_mfa', true) then
    reset role;
    raise exception 'TEST 14b fallito: mio_stato_admin() errato per admin con MFA';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', estraneo_id, 'aal', 'aal2')::text, false);
  if (select public.mio_stato_admin()) <> jsonb_build_object('is_admin', false, 'has_mfa', true) then
    reset role;
    raise exception 'TEST 14c fallito: mio_stato_admin() errato per utente non admin';
  end if;
  reset role;

  raise notice '=== TUTTI I 14 TEST RLS SUPERATI ===';
end
$$;
