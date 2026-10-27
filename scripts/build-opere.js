#!/usr/bin/env node
"use strict";

/**
 * Genera data/opere.json (catalogo pubblico) a partire da content/opere/*.json.
 * Eseguito come build command su Netlify, e a mano in sviluppo con:
 *   node scripts/build-opere.js
 *
 * Non scrive mai dentro content/opere: è un processo di sola lettura su quella
 * cartella. Il file generato NON va versionato in Git (vedi .gitignore).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content", "opere");
const OUTPUT_DIR = path.join(ROOT, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "opere.json");

const STATI_VALIDI = new Set(["bozza", "pubblicata", "nascosta", "archiviata"]);

function erroreFatale(messaggio) {
  console.error(`\n[build-opere] ERRORE: ${messaggio}\n`);
  process.exit(1);
}

function leggiOpere() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.warn(`[build-opere] Cartella ${CONTENT_DIR} assente: catalogo vuoto.`);
    return [];
  }

  const file = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"));

  const opere = [];
  const ordiniVisti = new Map();

  for (const nomeFile of file) {
    const percorso = path.join(CONTENT_DIR, nomeFile);
    let raw;
    try {
      raw = fs.readFileSync(percorso, "utf8");
    } catch (err) {
      erroreFatale(`impossibile leggere ${nomeFile}: ${err.message}`);
    }

    let dati;
    try {
      dati = JSON.parse(raw);
    } catch (err) {
      erroreFatale(`${nomeFile} non è JSON valido: ${err.message}`);
    }

    if (!dati || typeof dati !== "object" || Array.isArray(dati)) {
      erroreFatale(`${nomeFile}: il contenuto deve essere un oggetto JSON`);
    }
    if (!dati.titolo || typeof dati.titolo !== "string" || !dati.titolo.trim()) {
      erroreFatale(`${nomeFile}: campo "titolo" obbligatorio e mancante`);
    }
    if (!dati.immagine || typeof dati.immagine !== "string" || !dati.immagine.trim()) {
      erroreFatale(`${nomeFile}: campo "immagine" obbligatorio e mancante`);
    }
    if (dati.stato !== undefined && !STATI_VALIDI.has(dati.stato)) {
      erroreFatale(
        `${nomeFile}: "stato" non valido ("${dati.stato}"). Valori ammessi: ${[...STATI_VALIDI].join(", ")}`
      );
    }
    if (dati.anno !== undefined && dati.anno !== null && typeof dati.anno !== "number") {
      erroreFatale(`${nomeFile}: "anno" deve essere un numero`);
    }
    if (dati.ordine !== undefined && dati.ordine !== null && typeof dati.ordine !== "number") {
      erroreFatale(`${nomeFile}: "ordine" deve essere un numero`);
    }

    const stato = dati.stato || "bozza";

    if (stato === "pubblicata" && dati.ordine !== undefined && dati.ordine !== null) {
      if (ordiniVisti.has(dati.ordine)) {
        console.warn(
          `[build-opere] ATTENZIONE: "ordine" ${dati.ordine} duplicato tra ` +
            `"${ordiniVisti.get(dati.ordine)}" e "${nomeFile}". L'ordinamento tra le due non è garantito.`
        );
      } else {
        ordiniVisti.set(dati.ordine, nomeFile);
      }
    }

    opere.push({
      _file: nomeFile,
      titolo: dati.titolo.trim(),
      immagine: dati.immagine.trim(),
      tecnica: typeof dati.tecnica === "string" ? dati.tecnica.trim() : "",
      dimensioni: typeof dati.dimensioni === "string" ? dati.dimensioni.trim() : "",
      anno: typeof dati.anno === "number" ? dati.anno : null,
      descrizione: typeof dati.descrizione === "string" ? dati.descrizione.trim() : "",
      ordine: typeof dati.ordine === "number" ? dati.ordine : 0,
      stato,
    });
  }

  return opere;
}

function costruisciCatalogoPubblico(opere) {
  return opere
    .filter((o) => o.stato === "pubblicata")
    .sort((a, b) => a.ordine - b.ordine)
    .map((o) => ({
      titolo: o.titolo,
      immagine: o.immagine,
      tecnica: o.tecnica,
      dimensioni: o.dimensioni,
      anno: o.anno,
      descrizione: o.descrizione,
    }));
}

function main() {
  const tutteLeOpere = leggiOpere();
  const totali = tutteLeOpere.length;
  const perStato = { bozza: 0, pubblicata: 0, nascosta: 0, archiviata: 0 };
  tutteLeOpere.forEach((o) => {
    perStato[o.stato] = (perStato[o.stato] || 0) + 1;
  });

  const catalogo = costruisciCatalogoPubblico(tutteLeOpere);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalogo, null, 2) + "\n", "utf8");

  console.log(`[build-opere] Opere totali trovate: ${totali}`);
  console.log(
    `[build-opere]   di cui pubblicata=${perStato.pubblicata} bozza=${perStato.bozza} ` +
      `nascosta=${perStato.nascosta} archiviata=${perStato.archiviata}`
  );
  console.log(`[build-opere] Catalogo pubblico scritto in ${path.relative(ROOT, OUTPUT_FILE)} (${catalogo.length} opere pubblicate)`);
}

main();
