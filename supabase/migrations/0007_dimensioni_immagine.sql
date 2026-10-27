-- Aggiunge le dimensioni (in pixel) della fotografia salvata, per poter
-- riservare lo spazio corretto nel layout del sito pubblico PRIMA che
-- l'immagine si carichi (riduce il layout shift, vedi Core Web Vitals).
--
-- Non modifica le policy RLS: sono già definite a livello di tabella
-- (0003_opere_rls.sql) e si applicano automaticamente anche alle nuove
-- colonne, senza bisogno di essere riscritte. Non tocca l'autenticazione.
--
-- Colonne facoltative (nullable): le opere già esistenti restano NULL su
-- questi due campi (non vengono mai modificate le fotografie già presenti,
-- né si cerca di ricalcolarne le dimensioni). Il frontend pubblico gestisce
-- il caso NULL esattamente come oggi, senza alcuna differenza visibile.

alter table public.opere
  add column if not exists larghezza_px integer,
  add column if not exists altezza_px integer;

-- "ADD CONSTRAINT IF NOT EXISTS" non esiste in PostgreSQL: lo stesso
-- risultato idempotente si ottiene controllando pg_constraint a mano.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opere_dimensioni_px_plausibili'
  ) then
    -- NOTA: un CHECK con "AND" tra due confronti che coinvolgono colonne
    -- NULL non basta per rifiutare "una valorizzata e l'altra no" — in SQL
    -- NULL AND <qualunque cosa> non è FALSE, quindi la riga passerebbe
    -- comunque. Per questo il vincolo confronta prima esplicitamente lo
    -- stato NULL delle due colonne (devono essere entrambe NULL o
    -- entrambe valorizzate), e solo poi, se valorizzate, ne controlla il
    -- segno. Verificato con un test reale (dimensioni_immagine.sql) che
    -- prova anche il caso "solo una delle due colonne impostata".
    alter table public.opere
      add constraint opere_dimensioni_px_plausibili
      check (
        (larghezza_px is null) = (altezza_px is null)
        and (larghezza_px is null or (larghezza_px > 0 and altezza_px > 0))
      );
  end if;
end
$$;

comment on column public.opere.larghezza_px is
  'Larghezza in pixel della fotografia salvata in Storage. Facoltativa (NULL per le opere caricate prima di questa modifica): usata solo per riservare lo spazio nel layout, mai per l''autorizzazione o la validazione.';
comment on column public.opere.altezza_px is
  'Altezza in pixel della fotografia salvata in Storage. Vedi larghezza_px.';
