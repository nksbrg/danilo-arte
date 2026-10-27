-- Classificazione delle opere in tre macro-categorie (ricami, fuori_di_tela,
-- paciughi), richiesta per organizzare la homepage in tre sezioni verticali
-- distinte invece dell'attuale galleria unica. Vedi CATEGORIE-OPERE.md.
--
-- Migrazione indipendente da 0007_dimensioni_immagine.sql (PR #4, non ancora
-- mergiata su main a questa data): nessuna dipendenza fra le due, nessun
-- conflitto di nome di colonna o di vincolo. Le due migrazioni si applicano
-- in un ordine qualunque l'una rispetto all'altra.
--
-- Non cancella né altera le opere esistenti, non tocca Storage, non tocca
-- policy RLS o autenticazione (restano quelle di 0001-0006).

alter table public.opere
  add column if not exists categoria text;

-- Valori tecnici stabili (snake_case, in inglese/italiano semplice, pensati
-- per non cambiare mai una volta scelti): l'etichetta leggibile ("Fuori di
-- tela", non "fuori_di_tela") vive solo nell'interfaccia (admin/app.js,
-- index.html), mai nel database.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opere_categoria_valida'
  ) then
    alter table public.opere
      add constraint opere_categoria_valida
      check (categoria is null or categoria in ('ricami', 'fuori_di_tela', 'paciughi'));
  end if;
end
$$;

-- NULL è ammesso DI PROPOSITO: le opere già presenti nel database non hanno
-- (e non possono avere) una categoria assegnata retroattivamente in modo
-- automatico (richiesta esplicita: nessuna categoria arbitraria). Il sito
-- pubblico le mostra in una sezione "da classificare" temporanea e discreta
-- finché non vengono classificate a mano dal pannello (vedi index.html e
-- admin/app.js). La colonna NON è quindi obbligatoria in questa migrazione.
--
-- Quando Danilo avrà classificato tutte le opere esistenti, rendere la
-- categoria obbligatoria con una migrazione successiva (NON qui: va fatto
-- solo dopo aver verificato che non resti alcuna riga NULL):
--
--   -- 1) verificare prima che non ci siano più righe da classificare:
--   select count(*) from public.opere where categoria is null;
--   -- deve restituire 0
--
--   -- 2) solo allora:
--   alter table public.opere alter column categoria set not null;
--
comment on column public.opere.categoria is
  'Macro-categoria dell''opera: ricami | fuori_di_tela | paciughi (vincolo opere_categoria_valida). NULL per le opere esistenti non ancora classificate: mostrate sul sito in una sezione provvisoria "da classificare". Rendere NOT NULL con una migrazione successiva, solo dopo aver classificato tutte le opere esistenti (vedi commento sopra).';

-- Indice composto: la homepage e il pannello ordinano sempre per
-- (ordine, titolo) all'interno di ciascuna categoria (stesso criterio
-- d'ordinamento già in uso su tutta la tabella, vedi opere_ordine_titolo_idx
-- in 0001_opere.sql), ora spesso filtrato anche per categoria.
create index if not exists opere_categoria_ordine_idx
  on public.opere (categoria, ordine, titolo);
