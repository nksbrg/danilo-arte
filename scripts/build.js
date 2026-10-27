#!/usr/bin/env node
"use strict";

/**
 * Build di produzione del sito.
 *
 * Legge content/opere/*.json (scritto da Decap CMS), genera il catalogo
 * pubblico filtrato per stato e assembla dist/ con SOLO i file destinati al
 * dominio pubblico. Eseguito da Netlify come build command, e a mano in
 * sviluppo con: node scripts/build.js
 *
 * Il sito non legge più da nessun servizio esterno: niente Notion, niente
 * fallback. Se content/opere/ non contiene opere pubblicate, il catalogo
 * generato è un array vuoto e il frontend mostra un messaggio appropriato.
 *
 * Cosa finisce in dist/ (tutto il resto NON è pubblico):
 *   dist/index.html
 *   dist/thanks.html
 *   dist/assets/...            (immagini statiche del sito)
 *   dist/admin/index.html      (pannello Decap CMS)
 *   dist/admin/config.yml      (nessun segreto: vedi admin/config.yml)
 *   dist/data/opere.json       (generato qui, solo opere "pubblicata")
 *
 * Cosa NON finisce mai in dist/ (quindi non è raggiungibile dal dominio
 * pubblico): content/opere/*.json (inclusi bozza e nascosta), scripts/,
 * test/, README-CMS.md, COME-AGGIORNARE.txt, netlify.toml, .git.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content", "opere");
const DIST_DIR = path.join(ROOT, "dist");

const STATI_VALIDI = new Set(["bozza", "pubblicata", "nascosta", "archiviata"]);

// File e cartelle pubblicati così come sono, copiati dentro dist/ con lo
// stesso percorso relativo. Qualunque cosa non elencata qui resta fuori da
// dist/ e quindi fuori dal dominio pubblico.
const FILE_PUBBLICI = ["index.html", "thanks.html", "assets", "admin"];

/**
 * Legge e valida content/opere/*.json. Lancia un errore (non termina il
 * processo) in modo da restare testabile con test automatici.
 */
function leggiOpere(contentDir = CONTENT_DIR) {
  if (!fs.existsSync(contentDir)) {
    return [];
  }

  const file = fs
    .readdirSync(contentDir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort(); // ordine di lettura deterministico, indipendente dal filesystem

  const opere = [];
  const ordiniVisti = new Map();

  for (const nomeFile of file) {
    const percorso = path.join(contentDir, nomeFile);
    const raw = fs.readFileSync(percorso, "utf8");

    let dati;
    try {
      dati = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${nomeFile} non è JSON valido: ${err.message}`);
    }

    if (!dati || typeof dati !== "object" || Array.isArray(dati)) {
      throw new Error(`${nomeFile}: il contenuto deve essere un oggetto JSON`);
    }
    if (!dati.titolo || typeof dati.titolo !== "string" || !dati.titolo.trim()) {
      throw new Error(`${nomeFile}: campo "titolo" obbligatorio e mancante`);
    }
    if (!dati.immagine || typeof dati.immagine !== "string" || !dati.immagine.trim()) {
      throw new Error(`${nomeFile}: campo "immagine" obbligatorio e mancante`);
    }
    if (dati.stato !== undefined && !STATI_VALIDI.has(dati.stato)) {
      throw new Error(
        `${nomeFile}: "stato" non valido ("${dati.stato}"). Valori ammessi: ${[...STATI_VALIDI].join(", ")}`
      );
    }
    if (dati.anno !== undefined && dati.anno !== null && typeof dati.anno !== "number") {
      throw new Error(`${nomeFile}: "anno" deve essere un numero`);
    }
    if (dati.ordine !== undefined && dati.ordine !== null && typeof dati.ordine !== "number") {
      throw new Error(`${nomeFile}: "ordine" deve essere un numero`);
    }

    const stato = dati.stato || "bozza";

    if (stato === "pubblicata" && dati.ordine !== undefined && dati.ordine !== null) {
      if (ordiniVisti.has(dati.ordine)) {
        console.warn(
          `[build] ATTENZIONE: "ordine" ${dati.ordine} duplicato tra ` +
            `"${ordiniVisti.get(dati.ordine)}" e "${nomeFile}". Il pareggio è risolto per titolo (A-Z).`
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

/**
 * Filtra le sole opere pubblicate, le ordina in modo deterministico
 * (per "ordine", poi per titolo a parità di "ordine" così il risultato non
 * dipende mai dall'ordine di lettura dei file) e rimuove i campi interni.
 */
function costruisciCatalogoPubblico(opere) {
  return opere
    .filter((o) => o.stato === "pubblicata")
    .sort((a, b) => a.ordine - b.ordine || a.titolo.localeCompare(b.titolo, "it"))
    .map((o) => ({
      titolo: o.titolo,
      immagine: o.immagine,
      tecnica: o.tecnica,
      dimensioni: o.dimensioni,
      anno: o.anno,
      descrizione: o.descrizione,
    }));
}

function copiaFilePubblici(rootDir, distDir) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  for (const nome of FILE_PUBBLICI) {
    const sorgente = path.join(rootDir, nome);
    if (!fs.existsSync(sorgente)) continue;
    fs.cpSync(sorgente, path.join(distDir, nome), { recursive: true });
  }
}

function main() {
  const tutteLeOpere = leggiOpere();
  const perStato = { bozza: 0, pubblicata: 0, nascosta: 0, archiviata: 0 };
  tutteLeOpere.forEach((o) => {
    perStato[o.stato] = (perStato[o.stato] || 0) + 1;
  });

  const catalogo = costruisciCatalogoPubblico(tutteLeOpere);

  copiaFilePubblici(ROOT, DIST_DIR);

  const dataDir = path.join(DIST_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "opere.json"),
    JSON.stringify(catalogo, null, 2) + "\n",
    "utf8"
  );

  console.log(`[build] Opere totali in content/opere/: ${tutteLeOpere.length}`);
  console.log(
    `[build]   di cui pubblicata=${perStato.pubblicata} bozza=${perStato.bozza} ` +
      `nascosta=${perStato.nascosta} archiviata=${perStato.archiviata}`
  );
  console.log(`[build] Catalogo pubblico: dist/data/opere.json (${catalogo.length} opere)`);
  console.log(`[build] dist/ pronta con: ${FILE_PUBBLICI.join(", ")}, data/`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\n[build] ERRORE: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { leggiOpere, costruisciCatalogoPubblico, STATI_VALIDI };
