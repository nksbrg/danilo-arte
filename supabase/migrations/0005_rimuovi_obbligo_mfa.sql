-- Rimuove l'obbligo di verifica MFA per le operazioni amministrative, su
-- richiesta esplicita. is_verified_admin() ora richiede ESCLUSIVAMENTE
-- l'appartenenza alla whitelist public.admins (is_admin()): non verifica più
-- has_mfa() né il claim "aal" del JWT.
--
-- Le policy RLS su public.opere e storage.objects (migrazioni 0003 e 0004)
-- non vengono toccate: usano già is_verified_admin(), quindi ereditano
-- automaticamente il nuovo comportamento senza bisogno di essere riscritte.
-- Restano quindi scrivibili SOLO dagli utenti nella whitelist admins — un
-- utente semplicemente autenticato ma non in whitelist continua a non poter
-- scrivere nulla (invariato, vedi supabase/tests/rls.sql).
--
-- has_mfa() resta definita (non viene eliminata): non è più usata da
-- is_verified_admin(), ma rimuoverla non è necessario e la si lascia
-- disponibile per un eventuale ripristino futuro dell'obbligo MFA.

create or replace function public.is_verified_admin()
returns boolean
language sql
stable
as $$
  select public.is_admin();
$$;

comment on function public.is_verified_admin() is
  'Condizione richiesta da ogni policy di scrittura: whitelist admins. MFA non più obbligatoria (vedi 0005_rimuovi_obbligo_mfa.sql).';
