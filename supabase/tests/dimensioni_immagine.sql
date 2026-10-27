-- Test del vincolo aggiunto in 0007_dimensioni_immagine.sql. Eseguito da
-- test/run-rls-tests.sh dopo rls.sql/hardening.sql, sullo stesso database
-- di test (migrazioni già applicate).

\set ON_ERROR_STOP on

do $$
declare
  danilo_id uuid;
  ha_sollevato_errore boolean;
  n int;
begin
  select user_id into danilo_id from public.admins limit 1;
  if danilo_id is null then
    raise exception 'TEST dimensioni_immagine: precondizione fallita, nessun admin trovato (eseguire dopo rls.sql)';
  end if;

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal2')::text, false);

  -- Entrambe NULL: ammesso (comportamento di sempre, opere esistenti).
  insert into public.opere (titolo, image_path) values ('Senza dimensioni', 'x1.jpg');

  -- Entrambe valorizzate con valori plausibili: ammesso.
  insert into public.opere (titolo, image_path, larghezza_px, altezza_px) values ('Con dimensioni', 'x2.jpg', 1200, 800);

  -- Solo una valorizzata: deve fallire.
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path, larghezza_px) values ('Solo larghezza', 'x3.jpg', 1200);
  exception when check_violation then
    ha_sollevato_errore := true;
  end;
  if not ha_sollevato_errore then
    raise exception 'TEST dimensioni_immagine fallito: ammessa larghezza_px senza altezza_px';
  end if;

  -- Valore non positivo: deve fallire.
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path, larghezza_px, altezza_px) values ('Dimensioni negative', 'x4.jpg', -10, 800);
  exception when check_violation then
    ha_sollevato_errore := true;
  end;
  if not ha_sollevato_errore then
    raise exception 'TEST dimensioni_immagine fallito: ammesso un valore non positivo';
  end if;

  reset role;

  select count(*) into n from public.opere where image_path in ('x1.jpg', 'x2.jpg');
  if n <> 2 then
    raise exception 'TEST dimensioni_immagine fallito: attese 2 righe valide inserite, trovate %', n;
  end if;

  delete from public.opere where image_path in ('x1.jpg', 'x2.jpg');

  raise notice '=== TEST dimensioni_immagine SUPERATO ===';
end
$$;
