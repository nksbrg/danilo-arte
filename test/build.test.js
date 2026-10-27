"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { leggiOpere, costruisciCatalogoPubblico, contenutoConfigSupabase } = require("../scripts/build.js");

function creaCartellaFixture(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opere-test-"));
  for (const [nome, contenuto] of Object.entries(file)) {
    fs.writeFileSync(path.join(dir, nome), JSON.stringify(contenuto), "utf8");
  }
  return dir;
}

function opera(overrides) {
  return {
    titolo: "Opera",
    immagine: "/assets/x.jpg",
    stato: "pubblicata",
    ordine: 0,
    ...overrides,
  };
}

test("esclude bozza, nascosta e archiviata dal catalogo pubblico", () => {
  const dir = creaCartellaFixture({
    "a.json": opera({ titolo: "A", stato: "pubblicata", ordine: 1 }),
    "b.json": opera({ titolo: "B", stato: "bozza", ordine: 2 }),
    "c.json": opera({ titolo: "C", stato: "nascosta", ordine: 3 }),
    "d.json": opera({ titolo: "D", stato: "archiviata", ordine: 4 }),
  });

  const catalogo = costruisciCatalogoPubblico(leggiOpere(dir));

  assert.equal(catalogo.length, 1);
  assert.equal(catalogo[0].titolo, "A");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("ordina per 'ordine' in modo deterministico", () => {
  const dir = creaCartellaFixture({
    "a.json": opera({ titolo: "Terza", stato: "pubblicata", ordine: 3 }),
    "b.json": opera({ titolo: "Prima", stato: "pubblicata", ordine: 1 }),
    "c.json": opera({ titolo: "Seconda", stato: "pubblicata", ordine: 2 }),
  });

  const catalogo = costruisciCatalogoPubblico(leggiOpere(dir));

  assert.deepEqual(
    catalogo.map((o) => o.titolo),
    ["Prima", "Seconda", "Terza"]
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a parità di 'ordine' il risultato non dipende dall'ordine di lettura dei file", () => {
  const file = {
    "z-ultimo-alfabeticamente.json": opera({ titolo: "Zeta", stato: "pubblicata", ordine: 1 }),
    "a-primo-alfabeticamente.json": opera({ titolo: "Alfa", stato: "pubblicata", ordine: 1 }),
  };
  const dir = creaCartellaFixture(file);

  const catalogo1 = costruisciCatalogoPubblico(leggiOpere(dir));
  const catalogo2 = costruisciCatalogoPubblico(leggiOpere(dir));

  // Stesso risultato a ogni esecuzione, e risolto per titolo (A-Z) a parità
  // di "ordine", non per ordine di lettura del filesystem.
  assert.deepEqual(
    catalogo1.map((o) => o.titolo),
    ["Alfa", "Zeta"]
  );
  assert.deepEqual(catalogo1, catalogo2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("lancia un errore leggibile se manca il titolo", () => {
  const dir = creaCartellaFixture({
    "senza-titolo.json": { immagine: "/assets/x.jpg", stato: "pubblicata" },
  });

  assert.throws(() => leggiOpere(dir), /titolo/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("lancia un errore leggibile se manca l'immagine", () => {
  const dir = creaCartellaFixture({
    "senza-immagine.json": { titolo: "Senza foto", stato: "pubblicata" },
  });

  assert.throws(() => leggiOpere(dir), /immagine/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("lancia un errore leggibile se 'stato' non è un valore ammesso", () => {
  const dir = creaCartellaFixture({
    "stato-sbagliato.json": opera({ stato: "qualcosa-che-non-esiste" }),
  });

  assert.throws(() => leggiOpere(dir), /stato/i);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("cartella content/opere assente produce un catalogo vuoto, non un errore", () => {
  const dirInesistente = path.join(os.tmpdir(), "non-esiste-" + Date.now());
  assert.deepEqual(leggiOpere(dirInesistente), []);
});

test("contenutoConfigSupabase incorpora URL e chiave quando presenti nell'ambiente", () => {
  const js = contenutoConfigSupabase({
    SUPABASE_URL: "https://esempio.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "chiave-di-prova",
  });
  assert.match(js, /window\.SUPABASE_URL = "https:\/\/esempio\.supabase\.co";/);
  assert.match(js, /window\.SUPABASE_PUBLISHABLE_KEY = "chiave-di-prova";/);
});

test("contenutoConfigSupabase produce stringhe vuote (non un errore) se le variabili mancano", () => {
  const js = contenutoConfigSupabase({});
  assert.match(js, /window\.SUPABASE_URL = "";/);
  assert.match(js, /window\.SUPABASE_PUBLISHABLE_KEY = "";/);
});

test("contenutoConfigSupabase non è vulnerabile a injection tramite valori con virgolette", () => {
  const valoreOstile = 'https://x.co";window.rubato=true;//';
  const js = contenutoConfigSupabase({
    SUPABASE_URL: valoreOstile,
    SUPABASE_PUBLISHABLE_KEY: "chiave",
  });
  // La virgoletta nel valore deve restare racchiusa (ed escapata) dentro la
  // stringa assegnata, non "rompere" fuori per diventare codice eseguibile:
  // eseguendo la riga generata si deve ottenere lo stesso valore originale.
  const riga = js.split("\n").find((r) => r.startsWith("window.SUPABASE_URL"));
  const window_ = {};
  // eslint-disable-next-line no-new-func
  new Function("window", riga)(window_);
  assert.equal(window_.SUPABASE_URL, valoreOstile);
});
