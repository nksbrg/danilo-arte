-- Tabella principale: le opere d'arte mostrate sul sito pubblico.
-- Non esiste un concetto di "bozza/pubblicata/nascosta" a livello di dato:
-- ogni riga presente in questa tabella è, per definizione, pubblicata.
-- Questo riflette la richiesta esplicita di non avere stati editoriali nel
-- pannello: un'opera salvata è visibile, un'opera eliminata non lo è più.

create extension if not exists pgcrypto;

create table if not exists public.opere (
  id uuid primary key default gen_random_uuid(),
  titolo text not null,
  tecnica text,
  dimensioni text,
  anno integer,
  descrizione text,
  ordine integer not null default 0,
  -- Percorso dell'oggetto nel bucket Storage "opere" (es. "2026/uuid.jpg"),
  -- NON l'URL completo: l'URL pubblico si costruisce a partire da questo
  -- percorso + l'URL del progetto Supabase. Tenerli separati evita di dover
  -- riscrivere ogni riga se in futuro cambia il dominio del progetto.
  image_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint opere_titolo_non_vuoto check (char_length(btrim(titolo)) > 0),
  constraint opere_image_path_non_vuoto check (char_length(btrim(image_path)) > 0),
  constraint opere_anno_plausibile check (anno is null or anno between 1000 and 3000)
);

comment on table public.opere is
  'Opere pubblicate sul sito. Ogni riga è automaticamente visibile al pubblico: niente colonna di stato editoriale per scelta di prodotto (vedi README-SUPABASE.md).';
comment on column public.opere.image_path is
  'Percorso dentro al bucket Storage "opere", non un URL assoluto.';

-- Ordinamento stabile e deterministico: per "ordine", poi per "titolo" a
-- parità, mai per created_at o per l'ordine fisico delle righe.
create index if not exists opere_ordine_titolo_idx
  on public.opere (ordine, titolo);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists opere_set_updated_at on public.opere;
create trigger opere_set_updated_at
  before update on public.opere
  for each row
  execute function public.set_updated_at();

alter table public.opere enable row level security;
-- Le policy vere e proprie sono in 0003_opere_rls.sql (dopo le funzioni di
-- autorizzazione definite in 0002). Fino ad allora la tabella, con RLS
-- abilitata e zero policy, non è leggibile né scrivibile da anon/authenticated:
-- comportamento sicuro di default anche se le migrazioni successive non
-- venissero mai applicate.

-- GRANT a livello di tabella: su un progetto Supabase reale sono già
-- presenti di default per ogni tabella in "public" (la piattaforma li
-- imposta alla creazione del progetto). Li rendiamo comunque espliciti qui
-- per rendere questa migrazione autosufficiente e verificabile — anche in
-- un ambiente Postgres "nudo" senza il bootstrap di Supabase (come usato
-- per testare queste policy in locale) — e perché un GRANT mancante
-- bloccherebbe l'operazione con un generico "permission denied" PRIMA
-- ancora che le policy RLS vengano valutate, mascherando la vera causa.
-- La vera barriera di sicurezza restano le policy RLS sopra, non questi
-- GRANT: senza RLS abilitata questi permessi da soli sarebbero troppo ampi.
grant select on public.opere to anon, authenticated;
grant insert, update, delete on public.opere to authenticated;
