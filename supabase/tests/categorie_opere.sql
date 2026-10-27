-- Test del vincolo opere_categoria_valida (0008_categorie_opere.sql).
-- Eseguito da test/run-rls-tests.sh su un database Postgres locale "nudo",
-- dopo lo shim auth/storage e tutte le migrazioni reali.

\set ON_ERROR_STOP on

do $$
declare
  danilo_id uuid := '11111111-1111-1111-1111-111111111111';
  ha_sollevato_errore boolean;
  id_inserita uuid;
  categoria_letta text;
begin
  -- Riusa l'admin/bucket già creati da rls.sql nella stessa esecuzione dello
  -- script; se questo file viene eseguito da solo, li crea qui.
  if not exists (select 1 from auth.users where id = danilo_id) then
    insert into auth.users (id, email) values (danilo_id, 'danilo@example.com');
  end if;
  if not exists (select 1 from public.admins where user_id = danilo_id) then
    insert into public.admins (user_id, email) values (danilo_id, 'danilo@example.com');
  end if;

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', danilo_id, 'aal', 'aal1')::text, false);

  -- TEST 1: un'opera senza categoria (NULL) si inserisce correttamente —
  -- deve restare possibile: è il caso delle opere esistenti non ancora
  -- classificate, non deve mai diventare un errore.
  insert into public.opere (titolo, image_path, categoria)
    values ('Categorie — senza categoria', 'categorie/test-null.jpg', null)
    returning id into id_inserita;
  select categoria into categoria_letta from public.opere where id = id_inserita;
  if categoria_letta is not null then
    raise exception 'TEST 1 fallito: categoria attesa NULL, trovata %', categoria_letta;
  end if;

  -- TEST 1b: una colonna categoria omessa dall'INSERT (comportamento di
  -- un'applicazione che non la invia affatto) equivale a NULL, non a un
  -- errore: stesso principio del test 1, ma senza nominare la colonna.
  insert into public.opere (titolo, image_path)
    values ('Categorie — categoria omessa', 'categorie/test-omessa.jpg');

  -- TEST 2: ciascuna delle tre categorie ammesse si inserisce correttamente.
  insert into public.opere (titolo, image_path, categoria) values
    ('Categorie — ricami', 'categorie/test-ricami.jpg', 'ricami'),
    ('Categorie — fuori di tela', 'categorie/test-fdt.jpg', 'fuori_di_tela'),
    ('Categorie — paciughi', 'categorie/test-paciughi.jpg', 'paciughi');

  -- TEST 3: un valore non ammesso viene rifiutato dal vincolo CHECK.
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path, categoria)
      values ('Categorie — valore non valido', 'categorie/test-non-valido.jpg', 'acquerelli');
  exception when check_violation then
    ha_sollevato_errore := true;
  end;
  if not ha_sollevato_errore then
    raise exception 'TEST 3 fallito: un valore di categoria non ammesso è stato accettato';
  end if;

  -- TEST 3b: anche una stringa vuota (non NULL, non uno dei tre valori) è
  -- rifiutata — un errore comune lato interfaccia se un campo venisse
  -- inviato come stringa vuota invece che come NULL.
  ha_sollevato_errore := false;
  begin
    insert into public.opere (titolo, image_path, categoria)
      values ('Categorie — stringa vuota', 'categorie/test-vuota.jpg', '');
  exception when check_violation then
    ha_sollevato_errore := true;
  end;
  if not ha_sollevato_errore then
    raise exception 'TEST 3b fallito: una categoria vuota ("") è stata accettata';
  end if;

  -- TEST 4: un'opera esistente senza categoria può essere classificata in un
  -- secondo momento con un UPDATE (il caso reale: Danilo assegna una
  -- categoria dal pannello a un'opera già pubblicata).
  update public.opere set categoria = 'ricami' where id = id_inserita;
  select categoria into categoria_letta from public.opere where id = id_inserita;
  if categoria_letta is distinct from 'ricami' then
    raise exception 'TEST 4 fallito: categoria attesa ''ricami'', trovata %', coalesce(categoria_letta, 'NULL');
  end if;

  -- TEST 4b: un UPDATE che tenta di impostare un valore non valido viene
  -- rifiutato, senza modificare la riga (stesso vincolo, verificato anche in
  -- update oltre che in insert).
  ha_sollevato_errore := false;
  begin
    update public.opere set categoria = 'non-valida' where id = id_inserita;
  exception when check_violation then
    ha_sollevato_errore := true;
  end;
  if not ha_sollevato_errore then
    raise exception 'TEST 4b fallito: un UPDATE con categoria non valida è stato accettato';
  end if;
  select categoria into categoria_letta from public.opere where id = id_inserita;
  if categoria_letta is distinct from 'ricami' then
    raise exception 'TEST 4b fallito: la categoria valida precedente è stata alterata nonostante il rifiuto (trovata %)', coalesce(categoria_letta, 'NULL');
  end if;

  reset role;

  -- Pulizia: rimuove solo le righe inserite da questo test.
  delete from public.opere where image_path like 'categorie/test-%';

  raise notice '=== TEST categorie_opere SUPERATO ===';
end
$$;
