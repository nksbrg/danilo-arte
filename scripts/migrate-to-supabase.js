#!/usr/bin/env node
"use strict";

/**
 * Migrazione di content/opere/*.json verso Supabase (tabella public.opere +
 * bucket Storage "opere"). Procedura ripetibile, mai distruttiva sui dati di
 * origine: non modifica né elimina mai content/opere/*.json, non tocca
 * Cloudinary.
 *
 * USO:
 *   node scripts/migrate-to-supabase.js
 *       Solo inventario e report (DEFAULT, nessuna scrittura da nessuna
 *       parte). Da eseguire per primo, quante volte si vuole.
 *
 *   node scripts/migrate-to-supabase.js --esegui
 *       Migra davvero le opere con stato "pubblicata" (o senza campo
 *       "stato", trattate come pubblicate) verso Supabase: carica la foto
 *       nello Storage e inserisce la riga nella tabella. Richiede
 *       SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nell'ambiente (MAI committare
 *       questi valori). La service_role key bypassa le policy RLS: usarla
 *       solo da questo script, mai nel pannello o nel sito pubblico.
 *
 *   --includi-bozza / --includi-nascosta / --includi-archiviata
 *       Da aggiungere a --esegui per migrare ANCHE le opere in quello stato.
 *       Mai automatico: va deciso esplicitamente ogni volta, come richiesto
 *       (le opere non pubblicate non diventano pubbliche "di default").
 *
 * Questo script NON è stato eseguito contro un vero progetto Supabase in
 * questo ambiente (nessun accesso a Internet nel sandbox di sviluppo): solo
 * la classificazione/il report (funzioni pure, sotto) hanno test automatici
 * reali. Vedi README-SUPABASE.md.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content", "opere");

/**
 * Legge content/opere/*.json così com'è (senza scartare nulla per stato):
 * a differenza di scripts/build.js, qui ci serve l'inventario COMPLETO,
 * bozze e nascoste comprese, per poterle presentare a chi decide.
 */
function leggiInventario(contentDir = CONTENT_DIR) {
  if (!fs.existsSync(contentDir)) return [];
  return fs
    .readdirSync(contentDir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort()
    .map((nomeFile) => {
      const dati = JSON.parse(fs.readFileSync(path.join(contentDir, nomeFile), "utf8"));
      return { _file: nomeFile, stato: dati.stato || "pubblicata", ...dati };
    });
}

/**
 * Classifica l'inventario SENZA scrivere da nessuna parte. Pura e testabile.
 *
 * - daMigrare: stato "pubblicata" (o assente) con un'immagine presente.
 * - daDecidere: stato "bozza"/"nascosta"/"archiviata" — richiedono una scelta
 *   esplicita dell'operatore (mai migrate automaticamente).
 * - senzaImmagine: qualunque riga priva del campo "immagine" (non
 *   migrabile: la tabella Supabase richiede image_path NOT NULL).
 * - duplicatiSospetti: gruppi con stesso titolo+anno (normalizzati), da
 *   controllare a mano prima di migrare — non vengono mai scartati da soli.
 */
function classificaOpere(opere) {
  const daMigrare = [];
  const daDecidere = [];
  const senzaImmagine = [];

  for (const o of opere) {
    if (!o.immagine) {
      senzaImmagine.push(o);
      continue;
    }
    if ((o.stato || "pubblicata") === "pubblicata") {
      daMigrare.push(o);
    } else {
      daDecidere.push(o);
    }
  }

  const chiave = (o) => `${(o.titolo || "").trim().toLowerCase()}::${o.anno ?? ""}`;
  const gruppi = new Map();
  for (const o of opere) {
    const k = chiave(o);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(o);
  }
  const duplicatiSospetti = [...gruppi.values()].filter((g) => g.length > 1);

  return { daMigrare, daDecidere, senzaImmagine, duplicatiSospetti };
}

function formattaReport(classificazione) {
  const { daMigrare, daDecidere, senzaImmagine, duplicatiSospetti } = classificazione;
  const righe = [];
  righe.push(`Opere pronte per la migrazione automatica (stato "pubblicata"): ${daMigrare.length}`);
  daMigrare.forEach((o) => righe.push(`  - ${o._file}: "${o.titolo}"`));

  righe.push("");
  righe.push(`Opere che richiedono una decisione esplicita (stato diverso da "pubblicata"): ${daDecidere.length}`);
  daDecidere.forEach((o) => righe.push(`  - ${o._file}: "${o.titolo}" (stato: ${o.stato})`));

  righe.push("");
  righe.push(`Opere senza immagine, NON migrabili così come sono: ${senzaImmagine.length}`);
  senzaImmagine.forEach((o) => righe.push(`  - ${o._file}: "${o.titolo || "(senza titolo)"}"`));

  righe.push("");
  righe.push(`Possibili duplicati (stesso titolo e anno): ${duplicatiSospetti.length}`);
  duplicatiSospetti.forEach((gruppo) => {
    righe.push(`  - ${gruppo.map((o) => o._file).join(" / ")}`);
  });

  return righe.join("\n");
}

// -------------------------------------------------------------------
// Parte "reale" (I/O verso Supabase): NON eseguita né testata in questo
// ambiente. Isolata qui sotto per tenerla separata dalla logica pura sopra,
// che invece È testata (vedi test/migrate-to-supabase.test.js).
// -------------------------------------------------------------------

async function caricaImmagine(supabaseUrl, serviceRoleKey, opera) {
  const sorgente = opera.immagine;
  let buffer, contentType;

  if (/^https?:\/\//.test(sorgente)) {
    const res = await fetch(sorgente);
    if (!res.ok) throw new Error(`Download immagine fallito (${res.status}): ${sorgente}`);
    buffer = Buffer.from(await res.arrayBuffer());
    contentType = res.headers.get("content-type") || "image/jpeg";
  } else {
    const percorsoLocale = path.join(ROOT, sorgente.replace(/^\//, ""));
    buffer = fs.readFileSync(percorsoLocale);
    contentType = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }
      [path.extname(percorsoLocale).toLowerCase()] || "image/jpeg";
  }

  const estensione = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[contentType] || "jpg";
  const imagePath = `migrati/${crypto.randomUUID()}.${estensione}`;

  const res = await fetch(`${supabaseUrl}/storage/v1/object/opere/${imagePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": contentType,
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Upload Storage fallito (${res.status}) per ${opera._file}: ${await res.text()}`);

  return imagePath;
}

async function inserisciOpera(supabaseUrl, serviceRoleKey, opera, imagePath) {
  const res = await fetch(`${supabaseUrl}/rest/v1/opere`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      titolo: opera.titolo,
      tecnica: opera.tecnica || null,
      dimensioni: opera.dimensioni || null,
      anno: opera.anno ?? null,
      descrizione: opera.descrizione || null,
      ordine: opera.ordine ?? 0,
      image_path: imagePath,
    }),
  });
  if (!res.ok) throw new Error(`Inserimento riga fallito (${res.status}) per ${opera._file}: ${await res.text()}`);
  return (await res.json())[0];
}

async function eseguiMigrazione(opereDaMigrare) {
  const url = process.env.SUPABASE_URL;
  const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chiave) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate nell'ambiente per --esegui. " +
        "Non committarle mai: vedi README-SUPABASE.md."
    );
  }

  const risultati = [];
  for (const opera of opereDaMigrare) {
    try {
      const imagePath = await caricaImmagine(url, chiave, opera);
      const riga = await inserisciOpera(url, chiave, opera, imagePath);
      risultati.push({ file: opera._file, esito: "ok", id: riga.id });
      console.log(`[migrate] OK: ${opera._file} -> opere.id=${riga.id}`);
    } catch (err) {
      risultati.push({ file: opera._file, esito: "errore", messaggio: err.message });
      console.error(`[migrate] ERRORE su ${opera._file}: ${err.message}`);
    }
  }
  return risultati;
}

function main() {
  const argv = process.argv.slice(2);
  const esegui = argv.includes("--esegui");
  const includiBozza = argv.includes("--includi-bozza");
  const includiNascosta = argv.includes("--includi-nascosta");
  const includiArchiviata = argv.includes("--includi-archiviata");

  const inventario = leggiInventario();
  const classificazione = classificaOpere(inventario);

  console.log(formattaReport(classificazione));

  if (!esegui) {
    console.log("\n(Solo inventario: nessuna scrittura. Aggiungi --esegui per migrare davvero.)");
    return;
  }

  let daMigrare = [...classificazione.daMigrare];
  if (includiBozza) daMigrare = daMigrare.concat(classificazione.daDecidere.filter((o) => o.stato === "bozza"));
  if (includiNascosta) daMigrare = daMigrare.concat(classificazione.daDecidere.filter((o) => o.stato === "nascosta"));
  if (includiArchiviata) daMigrare = daMigrare.concat(classificazione.daDecidere.filter((o) => o.stato === "archiviata"));

  console.log(`\n[migrate] Avvio migrazione reale di ${daMigrare.length} opere verso Supabase...`);
  eseguiMigrazione(daMigrare).then((risultati) => {
    const ok = risultati.filter((r) => r.esito === "ok").length;
    const errori = risultati.length - ok;
    console.log(`\n[migrate] Completato: ${ok} migrate, ${errori} con errore.`);
    if (errori > 0) process.exitCode = 1;
  });
}

if (require.main === module) {
  main();
}

module.exports = { leggiInventario, classificaOpere, formattaReport };
