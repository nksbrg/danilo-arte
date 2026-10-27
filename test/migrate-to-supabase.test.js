"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classificaOpere, formattaReport } = require("../scripts/migrate-to-supabase.js");

function opera(overrides) {
  return { _file: "x.json", titolo: "Opera", immagine: "/img.jpg", stato: "pubblicata", ...overrides };
}

test("classifica come 'da migrare' le opere pubblicate o senza stato", () => {
  const { daMigrare } = classificaOpere([
    opera({ _file: "a.json", stato: "pubblicata" }),
    opera({ _file: "b.json", stato: undefined }),
  ]);
  assert.equal(daMigrare.length, 2);
});

test("classifica come 'da decidere' bozza, nascosta e archiviata — mai automatiche", () => {
  const { daMigrare, daDecidere } = classificaOpere([
    opera({ _file: "a.json", stato: "bozza" }),
    opera({ _file: "b.json", stato: "nascosta" }),
    opera({ _file: "c.json", stato: "archiviata" }),
  ]);
  assert.equal(daMigrare.length, 0);
  assert.equal(daDecidere.length, 3);
});

test("un'opera senza immagine finisce in 'senzaImmagine', non in 'daMigrare'", () => {
  const { daMigrare, senzaImmagine } = classificaOpere([
    opera({ _file: "a.json", immagine: undefined, stato: "pubblicata" }),
  ]);
  assert.equal(daMigrare.length, 0);
  assert.equal(senzaImmagine.length, 1);
});

test("rileva possibili duplicati per stesso titolo e anno (case-insensitive)", () => {
  const { duplicatiSospetti } = classificaOpere([
    opera({ _file: "a.json", titolo: "Senza Titolo", anno: 2020 }),
    opera({ _file: "b.json", titolo: "senza titolo", anno: 2020 }),
    opera({ _file: "c.json", titolo: "Altra opera", anno: 2020 }),
  ]);
  assert.equal(duplicatiSospetti.length, 1);
  assert.equal(duplicatiSospetti[0].length, 2);
});

test("nessun duplicato segnalato se titolo o anno differiscono", () => {
  const { duplicatiSospetti } = classificaOpere([
    opera({ _file: "a.json", titolo: "Opera", anno: 2020 }),
    opera({ _file: "b.json", titolo: "Opera", anno: 2021 }),
  ]);
  assert.equal(duplicatiSospetti.length, 0);
});

test("formattaReport produce un testo leggibile che cita ogni file", () => {
  const classificazione = classificaOpere([
    opera({ _file: "pubblicata.json", stato: "pubblicata" }),
    opera({ _file: "bozza.json", stato: "bozza" }),
  ]);
  const testo = formattaReport(classificazione);
  assert.match(testo, /pubblicata\.json/);
  assert.match(testo, /bozza\.json/);
});

test("non migra mai automaticamente bozza/nascosta/archiviata nel conteggio 'daMigrare'", () => {
  const tutte = [
    opera({ _file: "p.json", stato: "pubblicata" }),
    opera({ _file: "b.json", stato: "bozza" }),
    opera({ _file: "n.json", stato: "nascosta" }),
    opera({ _file: "ar.json", stato: "archiviata" }),
  ];
  const { daMigrare } = classificaOpere(tutte);
  assert.deepEqual(daMigrare.map((o) => o._file), ["p.json"]);
});
