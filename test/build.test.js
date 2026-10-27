"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { leggiOpere, costruisciCatalogoPubblico } = require("../scripts/build.js");

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
