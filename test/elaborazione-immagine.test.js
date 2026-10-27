"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calcolaDimensioniRidotte, elaboraImmagine, LATO_MASSIMO_PX } = require("../admin/elaborazione-immagine.js");

test("non ridimensiona un'immagine già entro il limite", () => {
  const r = calcolaDimensioniRidotte(1200, 800, 2400);
  assert.deepEqual(r, { larghezza: 1200, altezza: 800, ridimensionata: false });
});

test("non ridimensiona un'immagine esattamente al limite", () => {
  const r = calcolaDimensioniRidotte(2400, 1600, 2400);
  assert.equal(r.ridimensionata, false);
});

test("ridimensiona mantenendo le proporzioni per un'immagine orizzontale oltre il limite", () => {
  const r = calcolaDimensioniRidotte(4800, 3200, 2400);
  assert.equal(r.ridimensionata, true);
  assert.equal(r.larghezza, 2400);
  assert.equal(r.altezza, 1600); // stesso rapporto 3:2 dell'originale
});

test("ridimensiona mantenendo le proporzioni per un'immagine verticale oltre il limite", () => {
  const r = calcolaDimensioniRidotte(3200, 4800, 2400);
  assert.equal(r.ridimensionata, true);
  assert.equal(r.altezza, 2400);
  assert.equal(r.larghezza, 1600);
});

test("il rapporto larghezza/altezza resta quello originale entro un errore di arrotondamento trascurabile", () => {
  const originale = 4032 / 3024; // fotocamera di uno smartphone comune
  const r = calcolaDimensioniRidotte(4032, 3024, 2400);
  const ridotto = r.larghezza / r.altezza;
  assert.ok(Math.abs(originale - ridotto) < 0.01, `rapporto alterato: ${originale} vs ${ridotto}`);
});

test("usa LATO_MASSIMO_PX come soglia di default", () => {
  const r = calcolaDimensioniRidotte(LATO_MASSIMO_PX + 100, 100);
  assert.equal(r.ridimensionata, true);
});

test("non produce mai una dimensione pari a zero per immagini estreme", () => {
  const r = calcolaDimensioniRidotte(100000, 1, 2400);
  assert.ok(r.larghezza >= 1);
  assert.ok(r.altezza >= 1);
});

test("elaboraImmagine ripiega sul file originale se createImageBitmap non è disponibile (ambiente senza browser)", async () => {
  // In Node, createImageBitmap non esiste affatto: verifica il percorso di
  // sicurezza che mantiene il file invariato invece di far fallire l'upload.
  const fileFinto = { type: "image/jpeg", size: 12345, name: "foto.jpg" };
  const risultato = await elaboraImmagine(fileFinto);
  assert.equal(risultato.blob, fileFinto);
  assert.equal(risultato.ridimensionata, false);
});
