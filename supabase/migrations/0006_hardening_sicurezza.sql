-- Hardening di sicurezza segnalato da Supabase Security Advisor.
-- Non elimina né ricrea alcuna funzione esistente (requisito esplicito):
-- usa ALTER FUNCTION (search_path) e REVOKE (grants), che non toccano il
-- corpo né la firma di nessuna funzione e non possono rompere dipendenze
-- (trigger, policy, altre funzioni che le chiamano).

-- ---------------------------------------------------------------------
-- 1) search_path mutabile su set_updated_at() e has_mfa()
-- ---------------------------------------------------------------------
-- Senza un search_path fissato, una funzione che risolve nomi non
-- qualificati (tabelle, funzioni) dipende dal search_path di CHI la invoca:
-- in teoria, un ruolo con permesso di creare oggetti in uno schema che
-- precede "public" nel proprio search_path potrebbe far risolvere un nome
-- non qualificato verso un proprio oggetto "ombra" invece di quello
-- previsto. Il rischio concreto qui è basso (set_updated_at() usa solo
-- "now()", risolto comunque da pg_catalog prima di qualunque search_path
-- personalizzato; has_mfa() chiama solo auth.jwt(), già qualificato), ma
-- fissare il search_path è la correzione raccomandata da Supabase e non ha
-- controindicazioni: non cambia il comportamento osservabile.
--
-- Usiamo ALTER FUNCTION invece di CREATE OR REPLACE: non tocca il corpo
-- della funzione già in uso dal trigger opere_set_updated_at (0001) né da
-- is_verified_admin() (0002/0005), quindi non può introdurre regressioni.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.has_mfa() set search_path = public, pg_temp;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE su public.opere. search_path fissato esplicitamente (Supabase Security Advisor).';
comment on function public.has_mfa() is
  'true se la sessione corrente ha completato la verifica MFA (aal2). Non più usata da is_verified_admin() (vedi 0005). search_path fissato esplicitamente (Supabase Security Advisor).';

-- ---------------------------------------------------------------------
-- 2) public.rls_auto_enable(): SECURITY DEFINER eseguibile da anon/authenticated
-- ---------------------------------------------------------------------
-- Questa funzione NON è definita in nessuna migrazione di questo
-- repository: è stata creata direttamente nel progetto Supabase reale
-- (dashboard o SQL Editor), presumibilmente come funzione di un event
-- trigger che abilita automaticamente la RLS sulle tabelle nuove — da qui
-- il nome e il motivo per cui è SECURITY DEFINER (serve a eseguire
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY con privilegi elevati).
--
-- Un event trigger invoca la propria funzione come parte dell'esecuzione
-- del comando DDL stesso: l'esecuzione NON passa dal controllo dei
-- permessi EXECUTE del ruolo che ha emesso il DDL. Revocare EXECUTE da
-- PUBLIC/anon/authenticated non disabilita quindi l'event trigger, ma
-- impedisce a chiunque di chiamarla direttamente come funzione (incluso
-- tramite l'endpoint RPC che PostgREST espone automaticamente per ogni
-- funzione con EXECUTE concesso a anon/authenticated) — che è esattamente
-- il problema segnalato da Security Advisor.
--
-- Scritta in modo DIFENSIVO con un blocco DO: se la funzione non esiste in
-- un dato ambiente (es. un progetto Supabase creato da zero a partire da
-- queste sole migrazioni, dove questa funzione "fuori banda" non è mai
-- stata creata), la migrazione non fallisce e non fa nulla per questa
-- parte — non presumiamo che la funzione esista ovunque.
do $$
declare
  esiste boolean;
  usata_da_event_trigger boolean;
begin
  esiste := to_regprocedure('public.rls_auto_enable()') is not null;

  if not esiste then
    raise notice '[0006] public.rls_auto_enable() non trovata in questo database: nessuna azione necessaria qui.';
    return;
  end if;

  select exists (
    select 1 from pg_event_trigger et
    where et.evtfoid = to_regprocedure('public.rls_auto_enable()')
  ) into usata_da_event_trigger;

  if usata_da_event_trigger then
    raise notice '[0006] public.rls_auto_enable() risulta collegata a un event trigger: ok, verrà comunque invocata correttamente anche dopo la revoca dei permessi EXECUTE sotto (gli event trigger non passano dal controllo EXECUTE del chiamante).';
  else
    raise warning '[0006] public.rls_auto_enable() ESISTE ma non risulta collegata a nessun event trigger in questo database. Verificare manualmente a cosa serve prima di fare affidamento sulla sola revoca dei permessi: se non è usata da nulla, valutare se eliminarla del tutto (non fatto qui, per non eliminare oggetti senza averne verificato le dipendenze).';
  end if;

  execute 'revoke all on function public.rls_auto_enable() from public';
  execute 'revoke all on function public.rls_auto_enable() from anon';
  execute 'revoke all on function public.rls_auto_enable() from authenticated';

  raise notice '[0006] EXECUTE su public.rls_auto_enable() revocato da PUBLIC, anon e authenticated.';
end
$$;
