-- Whitelist amministrativa e funzioni di autorizzazione.
--
-- Perché una tabella a parte invece di `raw_user_meta_data` o `app_metadata`:
-- `user_metadata` è modificabile dall'utente stesso tramite l'API pubblica
-- di Supabase Auth (updateUser) — usarlo per decidere chi è amministratore
-- permetterebbe a chiunque di auto-promuoversi. `app_metadata` non è
-- modificabile dal client, ma resta comunque un campo libero senza storicità
-- né vincoli: una tabella dedicata, scrivibile solo da service_role (quindi
-- MAI dal frontend o dal pannello), è il modo esplicito e verificabile
-- raccomandato da Supabase per un elenco di ruoli amministrativi.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

comment on table public.admins is
  'Whitelist amministrativa. Scrivibile SOLO con la service_role key (mai dal client). Vedi README-SUPABASE.md, sezione "Creare un amministratore".';

alter table public.admins enable row level security;
-- Nessuna policy = nessun accesso da anon/authenticated, nemmeno in lettura.
-- Solo service_role (che bypassa sempre RLS) può leggerla o scriverla: lo fa
-- un amministratore dalla SQL Editor di Supabase o uno script eseguito a
-- mano con la service_role key, mai il sito o il pannello pubblicati.

-- is_admin(): l'utente della sessione corrente è nella whitelist?
-- SECURITY DEFINER: gira con i privilegi di chi l'ha creata (il proprietario
-- del database), quindi può leggere public.admins anche se RLS la blocca per
-- il ruolo "authenticated" — ma la funzione restituisce solo un booleano,
-- non i contenuti della tabella: non introduce una via per leggerla.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'true se l''utente della sessione corrente è nella whitelist amministrativa.';

-- has_mfa(): la sessione corrente ha completato la verifica a due fattori?
-- Supabase imposta il claim "aal" (Authenticator Assurance Level) nel JWT:
-- "aal1" = solo password, "aal2" = password + secondo fattore verificato.
-- Leggerlo dal JWT (non da una tabella) garantisce che rifletta la sessione
-- *corrente*, non uno stato "ha MFA attiva" generico e quindi aggirabile da
-- una sessione più vecchia che non l'ha mai verificata.
create or replace function public.has_mfa()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

comment on function public.has_mfa() is
  'true se la sessione corrente ha completato la verifica MFA (aal2), non solo se l''utente ha un fattore TOTP registrato.';

-- is_verified_admin(): la condizione che usano TUTTE le policy di scrittura
-- su opere e sullo storage. Richiede entrambe le cose: whitelist E MFA sulla
-- sessione corrente. Da sola, l'appartenenza al ruolo "authenticated" di
-- Supabase NON è mai sufficiente.
create or replace function public.is_verified_admin()
returns boolean
language sql
stable
as $$
  select public.is_admin() and public.has_mfa();
$$;

comment on function public.is_verified_admin() is
  'Condizione richiesta da ogni policy di scrittura: whitelist admins + sessione con MFA verificata (aal2). Mai "authenticated" da solo.';

-- mio_stato_admin(): permette al pannello di mostrare un messaggio corretto
-- ("non sei autorizzato" vs "attiva la verifica in due passaggi") invece di
-- un generico errore del database. Espone SOLO lo stato dell'utente che
-- chiama, mai il contenuto della tabella admins: sicuro da esporre a
-- "authenticated". La vera barriera resta is_verified_admin() nelle policy,
-- non questa funzione, che serve solo per i messaggi dell'interfaccia.
create or replace function public.mio_stato_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_admin', public.is_admin(),
    'has_mfa', public.has_mfa()
  );
$$;

comment on function public.mio_stato_admin() is
  'Stato admin/MFA del SOLO utente che chiama. Usata dal pannello per i messaggi, non per decidere i permessi (quelli restano nelle policy RLS).';

grant execute on function public.mio_stato_admin() to authenticated;
