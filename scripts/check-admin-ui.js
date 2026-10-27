#!/usr/bin/env node
"use strict";
/**
 * Test di integrazione del pannello /admin con un browser reale
 * (Playwright) e un client Supabase SIMULATO (nessuna rete reale: non è un
 * test contro un vero progetto Supabase, vedi SECURITY-AUDIT.md).
 *
 * Verifica, con query DOM/CSS reali, cose che node:test non può controllare:
 * - la CSP irrigidita di /admin/* (netlify.toml) non rompe il pannello;
 * - un utente admin vede la dashboard, uno autenticato ma fuori whitelist
 *   vede "Accesso non autorizzato" e NON i controlli di gestione;
 * - eventi di autenticazione ravvicinati (race condition) non lasciano la
 *   UI in uno stato incoerente (vedi "generazioneAvvio" in admin/app.js);
 * - logout, form "Aggiungi opera" e conferma eliminazione si aprono.
 *
 * Richiede: Playwright installato (non incluso in questo repository: non ha
 * un package.json/node_modules proprio) e dist/ già generata.
 * Uso:
 *   node scripts/build.js && node scripts/check-admin-ui.js
 *
 * Non è parte di `node --test` (richiede un browser e una porta locale):
 * eseguirlo separatamente, come indicato sopra.
 */

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = 8532;

if (!fs.existsSync(path.join(DIST, "admin", "app.js"))) {
  console.error("dist/ non trovata o incompleta: eseguire prima `node scripts/build.js`.");
  process.exit(1);
}

const CSP_ADMIN = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none';";

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };

const MOCK_SETUP = `
window.SUPABASE_URL = "https://esempio.supabase.co";
window.SUPABASE_PUBLISHABLE_KEY = "chiave-finta";
const parametri = new URLSearchParams(window.location.search);
const modalitaAdmin = parametri.get("admin") !== "no";
let listenerAuth = null;
let chiamate = 0;
function client() {
  const opere = [{ id: "11111111-1111-1111-1111-111111111111", titolo: "Opera A", tecnica: "Olio", dimensioni: "10x10", anno: 2020, descrizione: "desc", ordine: 1, image_path: "a.jpg" }];
  return {
    auth: {
      getSession: async () => {
        chiamate++;
        await new Promise((r) => setTimeout(r, chiamate === 1 ? 60 : 10));
        return { data: { session: { user: { id: "u1" } } }, error: null };
      },
      onAuthStateChange: (cb) => { listenerAuth = cb; },
      signOut: async () => { window.__loggedOut = true; return { error: null }; },
      updateUser: async () => ({ data: {}, error: null }),
    },
    rpc: async (nome) => nome === "mio_stato_admin"
      ? { data: { is_admin: modalitaAdmin, has_mfa: false }, error: null }
      : { data: null, error: { message: "rpc sconosciuta" } },
    from: () => ({
      select: () => ({ order: () => ({ order: async () => ({ data: opere, error: null }) }) }),
      insert: (payload) => { window.__ultimoInsert = payload; return Promise.resolve({ error: null }); },
      update: (payload) => ({ eq: () => { window.__ultimoUpdate = payload; return Promise.resolve({ error: null }); } }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    storage: {
      from: () => ({
        getPublicUrl: (p) => ({ data: { publicUrl: "https://esempio.supabase.co/storage/v1/object/public/opere/" + p } }),
        upload: async (nomeFile, blob) => {
          window.__ultimoUpload = { nomeFile, dimensioneByte: blob.size, tipo: blob.type };
          return { error: null };
        },
        remove: async (percorsi) => { window.__ultimaRimozione = percorsi; return { error: null }; },
      }),
    },
  };
}
window.supabase = { createClient: () => client() };
window.__simulaEventiRavvicinati = () => { listenerAuth("SIGNED_IN", {}); listenerAuth("TOKEN_REFRESHED", {}); };
`;

const MOCK_HTML = `<!doctype html><html lang="it"><head><meta charset="UTF-8"><title>test</title><link rel="stylesheet" href="style.css"></head><body><div id="app"></div><script src="test-mock-setup.js"></script><script src="validazione.js"></script><script src="elaborazione-immagine.js"></script><script src="app.js"></script></body></html>`;

// Sostituto di admin/elaborazione-immagine.js con un esito/tempo di
// risoluzione CONTROLLABILE per nome file (window.__comportamento), per
// riprodurre in modo deterministico l'ordine di completamento delle
// elaborazioni asincrone (vedi la verifica "race condition" più sotto):
// con il modulo vero, basato su canvas reale, l'ordine di arrivo dipende da
// tempi di decodifica non controllabili a piacere da un test.
const MOCK_ELABORAZIONE_CONTROLLATA = `
window.__risoluzioni = [];
window.__comportamento = {}; // nome file -> { ritardoMs, rifiuta, larghezza, altezza, profiloColoreEsteso }
window.ElaborazioneImmagine = {
  LATO_MASSIMO_PX: 2400,
  calcolaDimensioniRidotte: (w, h) => ({ larghezza: w, altezza: h, ridimensionata: false }),
  elaboraImmagine: (file) => new Promise((resolve, reject) => {
    const cfg = window.__comportamento[file.name] || {};
    setTimeout(() => {
      window.__risoluzioni.push(file.name);
      if (cfg.rifiuta) { reject(new Error("elaborazione fallita (simulata dal test)")); return; }
      resolve({
        blob: file,
        larghezza: cfg.larghezza ?? null,
        altezza: cfg.altezza ?? null,
        ridimensionata: cfg.larghezza != null,
        profiloColoreEsteso: !!cfg.profiloColoreEsteso,
      });
    }, cfg.ritardoMs ?? 0);
  }),
};
`;

const MOCK_HTML_RACE = `<!doctype html><html lang="it"><head><meta charset="UTF-8"><title>test</title><link rel="stylesheet" href="style.css"></head><body><div id="app"></div><script src="test-mock-setup.js"></script><script src="validazione.js"></script><script src="test-mock-elaborazione-controllata.js"></script><script src="app.js"></script></body></html>`;

fs.writeFileSync(path.join(DIST, "admin", "test-mock-setup.js"), MOCK_SETUP);
fs.writeFileSync(path.join(DIST, "admin", "test-mock.html"), MOCK_HTML);
fs.writeFileSync(path.join(DIST, "admin", "test-mock-elaborazione-controllata.js"), MOCK_ELABORAZIONE_CONTROLLATA);
fs.writeFileSync(path.join(DIST, "admin", "test-mock-race.html"), MOCK_HTML_RACE);

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const fsPath = path.join(DIST, p === "/" ? "/index.html" : p);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", p.startsWith("/admin/") ? CSP_ADMIN : "default-src 'self'");
  fs.readFile(fsPath, (err, data) => {
    if (err) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", MIME[path.extname(fsPath)] || "application/octet-stream");
    res.end(data);
  });
});

function pulisci() {
  fs.rmSync(path.join(DIST, "admin", "test-mock-setup.js"), { force: true });
  fs.rmSync(path.join(DIST, "admin", "test-mock.html"), { force: true });
  fs.rmSync(path.join(DIST, "admin", "test-mock-elaborazione-controllata.js"), { force: true });
  fs.rmSync(path.join(DIST, "admin", "test-mock-race.html"), { force: true });
}

let superati = 0;
function controlla(etichetta, condizione) {
  if (!condizione) throw new Error(`FALLITO: ${etichetta}`);
  superati++;
  console.log(`  ok - ${etichetta}`);
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch();
  try {
    // --- Config/libreria mancante (nessun mock caricato) -------------
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/index.html`, { waitUntil: "load" });
      await page.waitForTimeout(800);
      const testo = await page.evaluate(() => document.getElementById("app").innerText);
      controlla("senza config Supabase mostra un messaggio, non un crash muto", /Configurazione mancante|Impossibile caricare/.test(testo));
      await page.close();
    }

    // --- Utente admin: dashboard, nessuna violazione CSP --------------
    {
      const page = await browser.newPage();
      const violazioniCsp = [];
      page.on("console", (m) => { if (/content security policy/i.test(m.text())) violazioniCsp.push(m.text()); });
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      controlla("admin vede la dashboard", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Le mie opere");
      controlla("nessuna violazione CSP nella dashboard admin", violazioniCsp.length === 0);

      await page.click("#btn-aggiungi");
      await page.waitForTimeout(150);
      controlla("il modulo 'Aggiungi opera' si apre", await page.evaluate(() => !!document.getElementById("form-opera")));
      const marginTop = await page.evaluate(() => getComputedStyle(document.querySelector(".azioni-form")).marginTop);
      controlla("le classi CSS sostitutive degli stili inline funzionano (.azioni-form)", marginTop === "16px");

      await page.click("#btn-annulla");
      await page.waitForTimeout(150);
      await page.click(".btn-elimina");
      await page.waitForTimeout(150);
      controlla("la conferma di eliminazione si apre", await page.evaluate(() => !!document.querySelector(".overlay-conferma")));
      await page.click("#annulla-elimina");

      await page.click("#btn-logout");
      await page.waitForTimeout(200);
      controlla("il logout chiama auth.signOut()", await page.evaluate(() => window.__loggedOut === true));
      await page.close();
    }

    // --- Utente autenticato ma fuori whitelist ------------------------
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=no`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      controlla("utente non in whitelist vede 'Accesso non autorizzato'", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Accesso non autorizzato");
      controlla("nessun controllo di gestione opere esposto", !(await page.evaluate(() => !!document.getElementById("btn-aggiungi"))));
      controlla("ha comunque un modo per uscire", await page.evaluate(() => !!document.getElementById("btn-logout-non-autorizzato")));
      await page.close();
    }

    // --- Ridimensionamento reale di una foto grande durante l'upload ---
    // Genera un'immagine 4800x3200 (tipica di una fotocamera) direttamente
    // nel browser via canvas (nessun file di test da portarsi dietro) e la
    // seleziona davvero nel campo file, esercitando il percorso completo:
    // validazione -> elaborazione (ridimensionamento) -> upload -> payload
    // salvato, con un client Supabase simulato che registra cosa riceve.
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(150);

      const esito = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 4800;
        canvas.height = 3200;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#b45a28";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
        const file = new File([blob], "foto-grande.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById("campo-foto");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { dimensioneOriginaleByte: blob.size };
      });

      await page.waitForTimeout(900); // l'elaborazione (ridimensionamento+compressione) è asincrona
      const testoEsito = await page.evaluate(() => document.getElementById("esito-foto")?.textContent || "");
      controlla("mostra un messaggio di ottimizzazione per una foto grande", /ottimizzata per il web/i.test(testoEsito));
      controlla("il messaggio riporta le nuove dimensioni (2400 sul lato lungo)", /2400/.test(testoEsito));
      const anteprimaVisibile = await page.evaluate(() => !document.getElementById("anteprima-nuova-foto").classList.contains("nascosto"));
      controlla("l'anteprima della foto ridimensionata si mostra", anteprimaVisibile);

      await page.fill("#campo-titolo", "Opera di prova ridimensionamento");
      await page.click("#btn-salva");
      await page.waitForTimeout(300);

      const [upload, insert] = await page.evaluate(() => [window.__ultimoUpload, window.__ultimoInsert]);
      controlla("la foto caricata è più piccola dell'originale (4800x3200 -> max 2400px di lato)", upload && upload.dimensioneByte < esito.dimensioneOriginaleByte);
      controlla("il payload salvato contiene le dimensioni corrette (2400x1600, proporzioni 3:2 invariate)", insert && insert.larghezza_px === 2400 && insert.altezza_px === 1600);
      controlla("nessun ritaglio: l'opera è stata salvata senza errori", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Le mie opere");

      await page.close();
    }

    // --- Race condition: selezione di una seconda foto prima che
    // l'elaborazione della prima sia terminata --------------------------
    // Usa test-mock-race.html (modulo di elaborazione CONTROLLABILE, non il
    // vero canvas) per imporre un ordine di completamento deterministico:
    // la foto A (selezionata per prima) viene fatta terminare DOPO la foto B
    // (selezionata per seconda, prima che A sia pronta). Il risultato di A
    // non deve mai sovrascrivere quello di B, né in anteprima né, soprat-
    // tutto, nei dati effettivamente caricati al salvataggio.
    {
      const page = await browser.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      const selezionaFileFinto = (nomeFile) => page.evaluate((nome) => {
        const file = new File(["contenuto di prova"], nome, { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById("campo-foto");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, nomeFile);
      await page.goto(`http://localhost:${PORT}/admin/test-mock-race.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(200);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(100);

      await page.evaluate(() => {
        window.__comportamento = {
          "foto-a.jpg": { ritardoMs: 350, larghezza: 1111, altezza: 1111 },
          "foto-b.jpg": { ritardoMs: 40, larghezza: 2222, altezza: 2222 },
        };
      });

      await selezionaFileFinto("foto-a.jpg");
      await page.waitForTimeout(60); // l'elaborazione di A è partita ma non è ancora finita (350ms)
      await selezionaFileFinto("foto-b.jpg"); // selezione di una seconda foto PRIMA che A finisca

      await page.waitForTimeout(150); // B (40ms) è ormai terminata, A (350ms) ancora no
      const dopoB = await page.evaluate(() => document.getElementById("esito-foto")?.textContent || "");
      controlla("race: il risultato di B (più veloce) aggiorna subito l'interfaccia", /2222/.test(dopoB));

      await page.waitForTimeout(350); // ora anche A, selezionata per prima, è terminata
      const dopoEntrambe = await page.evaluate(() => document.getElementById("esito-foto")?.textContent || "");
      controlla("race: il risultato tardivo di A (selezionata per prima) NON sovrascrive quello di B", /2222/.test(dopoEntrambe) && !/1111/.test(dopoEntrambe));
      controlla("race: l'ordine di risoluzione reale era A dopo B (non è un falso positivo per via dei tempi)", await page.evaluate(() => JSON.stringify(window.__risoluzioni) === JSON.stringify(["foto-b.jpg", "foto-a.jpg"])));

      const anteprimaSrcDopo = await page.evaluate(() => document.getElementById("anteprima-nuova-foto").src);
      controlla("race: l'anteprima resta visibile e coerente con B dopo l'arrivo tardivo di A", /blob:/.test(anteprimaSrcDopo));

      // Il pulsante di salvataggio deve usare B (il file ATTUALMENTE nel
      // campo), non un risultato misto o quello di A.
      await page.fill("#campo-titolo", "Opera di prova race condition");
      await page.click("#btn-salva");
      await page.waitForTimeout(200);
      const [uploadRace, insertRace] = await page.evaluate(() => [window.__ultimoUpload, window.__ultimoInsert]);
      controlla("race: il salvataggio ha comunque caricato un file", !!uploadRace);
      controlla("race: le dimensioni salvate nel database corrispondono a B (2222x2222), non ad A", insertRace && insertRace.larghezza_px === 2222 && insertRace.altezza_px === 2222);
      controlla("race: nessun errore JavaScript durante tutta la sequenza", erroriPagina.length === 0);

      await page.close();
    }

    // --- Comportamento quando l'elaborazione di una foto fallisce -------
    // (createImageBitmap/canvas potrebbero in teoria lanciare un errore
    // imprevisto: non deve mai bloccare il salvataggio né generare un
    // errore JavaScript non gestito).
    {
      const page = await browser.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/admin/test-mock-race.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(200);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(100);

      await page.evaluate(() => { window.__comportamento = { "foto-rotta.jpg": { ritardoMs: 20, rifiuta: true } }; });
      await page.evaluate(() => {
        const file = new File(["x"], "foto-rotta.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById("campo-foto");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(150);

      await page.fill("#campo-titolo", "Opera con elaborazione fallita");
      await page.click("#btn-salva");
      await page.waitForTimeout(200);
      const insertFallito = await page.evaluate(() => window.__ultimoInsert);
      controlla("elaborazione fallita: il salvataggio comunque riesce (ripiega sul file originale)", !!insertFallito);
      controlla("elaborazione fallita: nessun errore JavaScript non gestito", erroriPagina.length === 0);
      await page.close();
    }

    // --- Selezione ripetuta e rapidissima di più file: nessun errore -----
    {
      const page = await browser.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/admin/test-mock-race.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(200);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(100);

      await page.evaluate(() => {
        window.__comportamento = {};
        for (let i = 0; i < 8; i++) window.__comportamento[`rapida-${i}.jpg`] = { ritardoMs: 5 + (i % 3) * 10, larghezza: 10 + i, altezza: 10 + i };
      });
      await page.evaluate(() => {
        for (let i = 0; i < 8; i++) {
          const file = new File(["x"], `rapida-${i}.jpg`, { type: "image/jpeg" });
          const dt = new DataTransfer();
          dt.items.add(file);
          const input = document.getElementById("campo-foto");
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await page.waitForTimeout(400);
      controlla("selezione rapida di 8 file in sequenza: nessun errore JavaScript", erroriPagina.length === 0);
      const testoFinale = await page.evaluate(() => document.getElementById("esito-foto")?.textContent || "");
      controlla("selezione rapida: l'interfaccia riflette solo l'ultimo file selezionato (rapida-7)", /17/.test(testoFinale));
      await page.close();
    }

    // --- Profilo colore esteso: una fotografia JPEG grande con un
    // marcatore ICC non riconoscibile come sRGB NON deve essere
    // ridimensionata (vedi admin/elaborazione-immagine.js). Usa la
    // PIPELINE REALE (canvas + createImageBitmap, non mockata): genera un
    // JPEG reale 4800x3200 via canvas, poi inserisce "a mano" un segmento
    // APP2 con un marcatore ICC_PROFILE contenente "Display P3" (senza la
    // parola "sRGB"), simulando una fotografia con un profilo colore esteso
    // incorporato, come produrrebbe ad esempio un iPhone.
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(150);

      const esito = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 4800;
        canvas.height = 3200;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#2a7fb0";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const blobOriginale = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
        const bytesOriginali = new Uint8Array(await blobOriginale.arrayBuffer());

        // Costruisce un segmento APP2 JPEG "a mano": FF E2 <lunghezza 2B> +
        // "ICC_PROFILE\0" + numero-blocco(1) + blocchi-totali(1) + payload.
        // Il payload non è un vero profilo ICC valido (non serve: la nostra
        // euristica cerca solo le sottosequenze di byte "ICC_PROFILE"/
        // "sRGB", vedi admin/elaborazione-immagine.js); contiene "Display
        // P3" e volutamente nessuna occorrenza di "sRGB".
        const testo = "ICC_PROFILE\0" + String.fromCharCode(1, 1) + "Display P3 (profilo di prova, non valido ICC) ".padEnd(64, ".");
        const payload = Uint8Array.from(Array.from(testo).map((c) => c.charCodeAt(0)));
        const lunghezza = payload.length + 2; // +2 per il campo lunghezza stesso
        const segmento = new Uint8Array(4 + payload.length);
        segmento.set([0xff, 0xe2, (lunghezza >> 8) & 0xff, lunghezza & 0xff], 0);
        segmento.set(payload, 4);

        // Inserisce il segmento subito dopo SOI (FF D8, i primi 2 byte).
        const conIcc = new Uint8Array(2 + segmento.length + (bytesOriginali.length - 2));
        conIcc.set(bytesOriginali.subarray(0, 2), 0);
        conIcc.set(segmento, 2);
        conIcc.set(bytesOriginali.subarray(2), 2 + segmento.length);

        const blobConIcc = new Blob([conIcc], { type: "image/jpeg" });
        const file = new File([blobConIcc], "foto-display-p3.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById("campo-foto");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { dimensioneConIcc: conIcc.length };
      });

      await page.waitForTimeout(900);
      const testoEsito = await page.evaluate(() => document.getElementById("esito-foto")?.textContent || "");
      controlla("profilo colore esteso: mostra un messaggio dedicato (non quello di ottimizzazione)", /profilo colore esteso/i.test(testoEsito));
      controlla("profilo colore esteso: NON dichiara un'ottimizzazione avvenuta", !/ottimizzata per il web/i.test(testoEsito));

      await page.fill("#campo-titolo", "Opera con profilo colore esteso");
      await page.click("#btn-salva");
      await page.waitForTimeout(300);
      const [uploadIcc, insertIcc] = await page.evaluate(() => [window.__ultimoUpload, window.__ultimoInsert]);
      controlla("profilo colore esteso: il file caricato ha ESATTAMENTE le stesse dimensioni in byte dell'originale (nessuna ricompressione)", uploadIcc && uploadIcc.dimensioneByte === esito.dimensioneConIcc);
      controlla("profilo colore esteso: le dimensioni salvate sono quelle ORIGINALI (4800x3200), non ridotte a 2400px", insertIcc && insertIcc.larghezza_px === 4800 && insertIcc.altezza_px === 3200);
      controlla("profilo colore esteso: il salvataggio comunque riesce, senza errori", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Le mie opere");

      await page.close();
    }

    // --- Modifica di un'opera esistente con sostituzione della foto -----
    // Verifica il percorso "inModifica" (distinto dall'inserimento di
    // un'opera nuova testato sopra): la nuova foto viene elaborata e
    // caricata, il payload di update contiene il nuovo image_path e le
    // nuove dimensioni, e la vecchia foto viene rimossa da Storage SOLO
    // dopo che l'update è andato a buon fine.
    {
      const page = await browser.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.click(".btn-modifica");
      await page.waitForTimeout(150);
      controlla("modifica: il modulo si apre precompilato con i dati dell'opera esistente", (await page.evaluate(() => document.getElementById("campo-titolo")?.value)) === "Opera A");

      const esito = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 3600;
        canvas.height = 2400;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#4caf50";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
        const file = new File([blob], "foto-sostituzione.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById("campo-foto");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });

      await page.waitForTimeout(900);
      await page.click("#btn-salva");
      await page.waitForTimeout(300);

      const [uploadMod, updateMod, rimozioneMod] = await page.evaluate(() => [window.__ultimoUpload, window.__ultimoUpdate, window.__ultimaRimozione]);
      controlla("modifica: la nuova foto viene caricata su Storage", !!uploadMod);
      controlla("modifica: il payload di update contiene il nuovo image_path", updateMod && typeof updateMod.image_path === "string" && updateMod.image_path !== "a.jpg");
      controlla("modifica: le dimensioni salvate corrispondono alla nuova foto (3600x2400 -> 2400x1600, ridimensionata)", updateMod && updateMod.larghezza_px === 2400 && updateMod.altezza_px === 1600);
      controlla("modifica: la vecchia foto (a.jpg) viene rimossa da Storage dopo l'update", Array.isArray(rimozioneMod) && rimozioneMod.includes("a.jpg"));
      controlla("modifica: nessun errore JavaScript durante tutto il flusso", erroriPagina.length === 0);

      await page.close();
    }

    // --- Race condition su eventi di autenticazione ravvicinati -------
    {
      const page = await browser.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__simulaEventiRavvicinati());
      await page.waitForTimeout(400);
      controlla("la UI si stabilizza sullo stato corretto dopo eventi auth ravvicinati", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Le mie opere");
      controlla("nessun errore JavaScript durante la race", erroriPagina.length === 0);
      await page.close();
    }

    // --- Link di recupero password: deve mostrare il modulo nuova
    // password, non la dashboard direttamente ---------------------------
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si#type=recovery`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      controlla("un link di recupero password mostra il modulo nuova password, non la dashboard", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Imposta la tua password");
      await page.fill("#nuova-password", "una-password-lunga-123");
      await page.fill("#conferma-password", "una-password-lunga-123");
      await page.click("#form-nuova-password button[type=submit]");
      await page.waitForTimeout(300);
      controlla("dopo aver impostato la password si arriva alla dashboard", (await page.evaluate(() => document.querySelector("h1")?.textContent)) === "Le mie opere");
      await page.close();
    }

    console.log(`\n${superati} controlli superati.`);
  } finally {
    pulisci();
    server.close();
    await browser.close();
  }
}

main().catch((err) => {
  pulisci();
  server.close();
  console.error("\nFALLITO:", err.message);
  process.exit(1);
});
