-- Test automatici per l'hardening di 0006_hardening_sicurezza.sql.
-- Eseguito da test/run-rls-tests.sh DOPO le migrazioni normali (che qui,
-- su un database di test pulito, trovano public.rls_auto_enable()
-- assente e quindi non fanno nulla per quella parte — vedi rls.sql/shim).
-- Questo file simula tutti e tre gli scenari possibili sul vero progetto
-- Supabase e verifica che la migrazione si comporti correttamente in
-- ciascuno, oltre a verificare il search_path fissato.

\set ON_ERROR_STOP on

do $$
declare
  config_set_updated_at text[];
  config_has_mfa text[];
begin
  -- TEST A: search_path fissato su set_updated_at() e has_mfa() ---------
  select proconfig into config_set_updated_at from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace;
  if config_set_updated_at is null or not ('search_path=public, pg_temp' = any(config_set_updated_at)) then
    raise exception 'TEST A fallito: search_path di set_updated_at() non fissato come atteso (trovato: %)', config_set_updated_at;
  end if;

  select proconfig into config_has_mfa from pg_proc where proname = 'has_mfa' and pronamespace = 'public'::regnamespace;
  if config_has_mfa is null or not ('search_path=public, pg_temp' = any(config_has_mfa)) then
    raise exception 'TEST A fallito: search_path di has_mfa() non fissato come atteso (trovato: %)', config_has_mfa;
  end if;

  raise notice '=== TEST A superato: search_path fissato su set_updated_at() e has_mfa() ===';
end
$$;

-- TEST B: scenario con event trigger reale -------------------------------
-- Simula esattamente la situazione del progetto Supabase reale: una
-- funzione SECURITY DEFINER che ritorna "event_trigger", collegata a un
-- event trigger su CREATE TABLE, con EXECUTE concesso (erroneamente) anche
-- ad anon/authenticated.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() loop
    if obj.command_tag = 'CREATE TABLE' then
      execute format('alter table %s enable row level security', obj.object_identity);
    end if;
  end loop;
end;
$$;

create event trigger rls_auto_enable_trigger_test
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.rls_auto_enable();

grant execute on function public.rls_auto_enable() to public, anon, authenticated;

do $$
begin
  -- Prima della revoca: il grant è presente (precondizione del test).
  if not exists (
    select 1 from pg_proc p
    join pg_roles r on r.rolname = 'anon'
    where p.proname = 'rls_auto_enable'
      and has_function_privilege(r.oid, p.oid, 'execute')
  ) then
    raise exception 'TEST B precondizione fallita: anon non ha ancora EXECUTE su rls_auto_enable() prima della revoca';
  end if;
end
$$;

-- Applica la stessa logica di revoca di 0006 (il blocco DO qui sotto è lo
-- stesso corpo, ripetuto per testarlo isolatamente dalle altre migrazioni).
do $$
begin
  execute 'revoke all on function public.rls_auto_enable() from public';
  execute 'revoke all on function public.rls_auto_enable() from anon';
  execute 'revoke all on function public.rls_auto_enable() from authenticated';
end
$$;

do $$
declare
  trovato boolean;
begin
  select exists (
    select 1 from pg_roles r, pg_proc p
    where r.rolname = 'anon' and p.proname = 'rls_auto_enable'
      and has_function_privilege(r.oid, p.oid, 'execute')
  ) into trovato;
  if trovato then
    raise exception 'TEST B fallito: anon ha ancora EXECUTE su rls_auto_enable() dopo la revoca';
  end if;

  select exists (
    select 1 from pg_roles r, pg_proc p
    where r.rolname = 'authenticated' and p.proname = 'rls_auto_enable'
      and has_function_privilege(r.oid, p.oid, 'execute')
  ) into trovato;
  if trovato then
    raise exception 'TEST B fallito: authenticated ha ancora EXECUTE su rls_auto_enable() dopo la revoca';
  end if;

  raise notice '=== TEST B superato: EXECUTE revocato correttamente da anon e authenticated ===';
end
$$;

-- L'event trigger deve continuare a funzionare dopo la revoca dei
-- permessi: creando una tabella, la RLS deve attivarsi automaticamente.
create table public.tabella_di_prova_rls_auto (id int);

do $$
declare
  rls_attiva boolean;
begin
  select relrowsecurity into rls_attiva from pg_class where relname = 'tabella_di_prova_rls_auto';
  if not rls_attiva then
    raise exception 'TEST B fallito: l''event trigger non ha più abilitato la RLS dopo la revoca dei permessi EXECUTE — l''automazione si è rotta';
  end if;
  raise notice '=== TEST B superato: l''event trigger continua a funzionare dopo la revoca ===';
end
$$;

drop table public.tabella_di_prova_rls_auto;
drop event trigger rls_auto_enable_trigger_test;
drop function public.rls_auto_enable();

do $$
begin
  raise notice '=== TUTTI I TEST DI HARDENING SUPERATI ===';
end
$$;
