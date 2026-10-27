#!/usr/bin/env node
"use strict";

/**
 * Da eseguire UNA VOLTA, a mano, prima del lancio pubblico del sito:
 *   node scripts/rimuovi-opere-prova.js
 *
 * Rimuove le 3 opere fittizie usate per collaudare il prototipo del CMS
 * (content/opere/opera-di-prova-*.json) e le relative immagini segnaposto
 * (assets/test-opere/). Dopo l'esecuzione la galleria parte vuota: le opere
 * vere si aggiungono solo tramite il pannello /admin.
 *
 * Non tocca nessun'altra opera. Non fa nulla automaticamente durante la
 * build: va lanciato di proposito da chi decide che il collaudo è finito.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content", "opere");
const TEST_ASSETS_DIR = path.join(ROOT, "assets", "test-opere");
const PREFISSO_TEST = "opera-di-prova-";

function main() {
  let rimossi = 0;

  if (fs.existsSync(CONTENT_DIR)) {
    for (const nome of fs.readdirSync(CONTENT_DIR)) {
      if (nome.startsWith(PREFISSO_TEST) && nome.endsWith(".json")) {
        fs.rmSync(path.join(CONTENT_DIR, nome));
        console.log(`[rimuovi-opere-prova] rimosso content/opere/${nome}`);
        rimossi++;
      }
    }
  }

  if (fs.existsSync(TEST_ASSETS_DIR)) {
    fs.rmSync(TEST_ASSETS_DIR, { recursive: true, force: true });
    console.log(`[rimuovi-opere-prova] rimossa cartella assets/test-opere/`);
  }

  if (rimossi === 0) {
    console.log("[rimuovi-opere-prova] Nessuna opera di prova trovata (già rimosse?).");
  } else {
    console.log(
      `[rimuovi-opere-prova] Fatto: ${rimossi} opere di prova rimosse. ` +
        `Ricorda di eseguire "node scripts/build.js" e di fare commit/push della cartella content/.`
    );
  }
}

main();
