-- Emulazione MINIMA degli schemi auth/storage di Supabase, usata SOLO per
-- collaudare in locale, su un PostgreSQL qualunque, le policy RLS reali
-- definite in supabase/migrations/. Non è Supabase: niente GoTrue, niente
-- API REST, niente verifica TOTP reale. Riproduce fedelmente il
-- comportamento documentato di auth.uid()/auth.jwt() (lettura del claim JWT
-- dalla session variable "request.jwt.claims", impostata da PostgREST ad
-- ogni richiesta su un progetto Supabase vero).
--
-- Da eseguire UNA VOLTA su un database Postgres vuoto dedicato ai test,
-- PRIMA delle migrazioni in supabase/migrations/. Vedi test/run-rls-tests.sh.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated;
grant select on all tables in schema auth to anon, authenticated;

-- Su un progetto Supabase reale questi GRANT su storage.objects sono già
-- impostati dalla piattaforma: li replichiamo qui solo per il test locale.
grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;
