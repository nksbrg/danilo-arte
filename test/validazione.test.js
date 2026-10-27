"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, validaFile, estensioneDa, MAX_BYTES } = require("../pannello/validazione.js");

function fileFinto({ name = "foto.jpg", type = "image/jpeg", size = 1024 }) {
  return { name, type, size };
}

test("escapeHtml neutralizza i caratteri HTML pericolosi", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('xss')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;"
  );
});

test("escapeHtml gestisce valori nulli o indefiniti senza lanciare errori", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("validaFile accetta JPEG, PNG e WebP entro il limite di dimensione", () => {
  assert.equal(validaFile(fileFinto({ type: "image/jpeg" })), null);
  assert.equal(validaFile(fileFinto({ type: "image/png" })), null);
  assert.equal(validaFile(fileFinto({ type: "image/webp" })), null);
});

test("validaFile rifiuta un tipo MIME non ammesso", () => {
  const errore = validaFile(fileFinto({ name: "script.svg", type: "image/svg+xml" }));
  assert.match(errore, /non supportato/i);
});

test("validaFile rifiuta un file eseguibile camuffato da immagine (estensione .jpg ma MIME non immagine)", () => {
  const errore = validaFile(fileFinto({ name: "virus.jpg", type: "application/x-msdownload" }));
  assert.match(errore, /non supportato/i);
});

test("validaFile rifiuta i file HEIC/HEIF con un messaggio esplicativo", () => {
  const errore1 = validaFile(fileFinto({ name: "IMG_1234.HEIC", type: "" }));
  const errore2 = validaFile(fileFinto({ name: "foto.jpg", type: "image/heic" }));
  assert.match(errore1, /HEIC/);
  assert.match(errore2, /HEIC/);
});

test("validaFile rifiuta un file troppo grande", () => {
  const errore = validaFile(fileFinto({ size: MAX_BYTES + 1 }));
  assert.match(errore, /troppo grande/i);
});

test("validaFile accetta un file esattamente al limite di dimensione", () => {
  assert.equal(validaFile(fileFinto({ size: MAX_BYTES })), null);
});

test("estensioneDa mappa i tipi MIME ammessi all'estensione corretta", () => {
  assert.equal(estensioneDa({ type: "image/jpeg" }), "jpg");
  assert.equal(estensioneDa({ type: "image/png" }), "png");
  assert.equal(estensioneDa({ type: "image/webp" }), "webp");
});

test("estensioneDa ha un fallback ragionevole per un tipo sconosciuto", () => {
  assert.equal(estensioneDa({ type: "boh" }), "jpg");
});
