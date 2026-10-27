"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calcolaDimensioniRidotte, elaboraImmagine, LATO_MASSIMO_PX, haProfiloColoreNonStandard, trovaSottosequenzaBytes, trovaTestoUtf16BE } = require("../admin/elaborazione-immagine.js");

function bytesDi(...parti) {
  // Costruisce un ArrayBuffer concatenando stringhe ASCII (per i marcatori)
  // e array di byte arbitrari (per simulare il resto di un file binario).
  const bytes = [];
  for (const parte of parti) {
    if (typeof parte === "string") {
      for (let i = 0; i < parte.length; i++) bytes.push(parte.charCodeAt(i));
    } else {
      bytes.push(...parte);
    }
  }
  return new Uint8Array(bytes).buffer;
}

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
  assert.equal(risultato.profiloColoreEsteso, false);
});

// --- Rilevamento del profilo colore (vedi commento in testa a
// admin/elaborazione-immagine.js per i limiti dichiarati di questa euristica) ---

test("trovaSottosequenzaBytes trova un marcatore ASCII dentro un buffer binario", () => {
  const buf = new Uint8Array([0xff, 0xd8, 0x00, 0x49, 0x43, 0x43, 0x5f, 0x00, 0xaa]); // "ICC_" a metà
  assert.equal(trovaSottosequenzaBytes(buf, "ICC_"), 3);
});

test("trovaSottosequenzaBytes restituisce -1 se il marcatore non c'è", () => {
  const buf = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(trovaSottosequenzaBytes(buf, "ICC_PROFILE"), -1);
});

test("trovaSottosequenzaBytes rispetta il parametro 'inizio' (cerca solo da quel punto in poi)", () => {
  const buf = bytesDi("sRGB", [0, 0], "sRGB");
  assert.equal(trovaSottosequenzaBytes(new Uint8Array(buf), "sRGB", 1), 6);
});

test("haProfiloColoreNonStandard è false quando non c'è alcun marcatore ICC_PROFILE (immagine non taggata, sRGB per convenzione)", () => {
  const buf = bytesDi([0xff, 0xd8, 0xff, 0xe0], "JFIF", [0, 1, 2, 3, 4, 5]);
  assert.equal(haProfiloColoreNonStandard(buf), false);
});

test("haProfiloColoreNonStandard è false quando il profilo ICC_PROFILE contiene 'sRGB'", () => {
  const buf = bytesDi([0xff, 0xd8], "ICC_PROFILE", [0, 0], "sRGB IEC61966-2.1", [0, 0, 0]);
  assert.equal(haProfiloColoreNonStandard(buf), false);
});

test("haProfiloColoreNonStandard è true quando il profilo ICC_PROFILE NON contiene 'sRGB' (es. Display P3)", () => {
  const buf = bytesDi([0xff, 0xd8], "ICC_PROFILE", [0, 0], "Display P3", [0, 0, 0]);
  assert.equal(haProfiloColoreNonStandard(buf), true);
});

test("haProfiloColoreNonStandard è true per un profilo sconosciuto/non riconosciuto (comportamento conservativo di default)", () => {
  const buf = bytesDi([0xff, 0xd8], "ICC_PROFILE", [0, 0], "Adobe RGB (1998)", [0, 0, 0]);
  assert.equal(haProfiloColoreNonStandard(buf), true);
});

test("trovaTestoUtf16BE trova un testo codificato UTF-16BE (0x00 prima di ogni carattere)", () => {
  const buf = bytesDi([0xff, 0xd8], [0x00, 0x73, 0x00, 0x52, 0x00, 0x47, 0x00, 0x42]); // "sRGB" UTF-16BE
  assert.equal(trovaTestoUtf16BE(new Uint8Array(buf), "sRGB"), 2);
});

test("haProfiloColoreNonStandard non si lascia ingannare da un 'sRGB' che compare DOPO la fine dichiarata del segmento (es. nei dati binari dell'immagine, o in un secondo profilo incorporato più avanti nel file)", () => {
  // Riproduce esattamente il bug trovato con un browser reale durante
  // questa verifica (vedi scripts/check-admin-ui.js, test "profilo colore
  // esteso"): un file con un primo profilo "Display P3" (bounded dalla sua
  // stessa lunghezza dichiarata) seguito, più avanti nel file, da un secondo
  // blocco che contiene "sRGB" per tutt'altro motivo. Senza il limite alla
  // lunghezza dichiarata del segmento, la ricerca "a tutto il file"
  // troverebbe comunque quel secondo "sRGB" e concluderebbe (erroneamente)
  // che il profilo è sRGB.
  const marcatoreCorpo = "ICC_PROFILE\0" + String.fromCharCode(1, 1) + "Display P3 di prova";
  const lunghezza = marcatoreCorpo.length + 2; // +2 per il campo lunghezza stesso
  const buf = bytesDi(
    [0xff, 0xd8],
    [0xff, 0xe2, (lunghezza >> 8) & 0xff, lunghezza & 0xff],
    marcatoreCorpo,
    "PADDING-FUORI-DAL-SEGMENTO-sRGB-NON-DEVE-CONTARE"
  );
  assert.equal(haProfiloColoreNonStandard(buf), true);
});

test("haProfiloColoreNonStandard riconosce 'sRGB' anche se codificato UTF-16BE (tag ICC 'mluc', come genera davvero Chromium)", () => {
  // Byte reali osservati su un profilo sRGB incorporato da canvas.toBlob()
  // in Chromium durante questa verifica: la descrizione del profilo è nel
  // tag 'mluc' (multi localized unicode), che codifica il testo in
  // UTF-16BE — una ricerca ASCII semplice di "sRGB" fallirebbe qui, dando
  // un falso positivo (verificato: era proprio il bug trovato con un
  // browser reale, poi corretto). Vedi anche scripts/check-admin-ui.js.
  const mlucSrgb = [0x00, 0x73, 0x00, 0x52, 0x00, 0x47, 0x00, 0x42]; // "sRGB" UTF-16BE
  const buf = bytesDi([0xff, 0xd8], "ICC_PROFILE", [0, 0], "mluc", [0, 0, 0, 0], "enUS", mlucSrgb);
  assert.equal(haProfiloColoreNonStandard(buf), false);
});

test("elaboraImmagine propaga profiloColoreEsteso:false anche nel fallback senza createImageBitmap", async () => {
  // Verifica solo la forma del risultato in questo ambiente senza browser:
  // il percorso reale (createImageBitmap+canvas) è verificato con un browser
  // reale in scripts/check-admin-ui.js, non riproducibile qui.
  const fileFinto = { type: "image/jpeg", size: 1, name: "x.jpg" };
  const r = await elaboraImmagine(fileFinto);
  assert.equal(typeof r.profiloColoreEsteso, "boolean");
});
