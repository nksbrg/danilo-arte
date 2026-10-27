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
  // Opera A: già classificata (ricami). Opera B: senza categoria (NULL),
  // come un'opera esistente prima dell'introduzione del campo — serve a
  // verificare precompilazione vuota, badge "Da classificare" e filtro.
  const opere = [
    { id: "11111111-1111-1111-1111-111111111111", titolo: "Opera A", tecnica: "Olio", dimensioni: "10x10", anno: 2020, descrizione: "desc", ordine: 1, image_path: "a.jpg", categoria: "ricami" },
    { id: "22222222-2222-2222-2222-222222222222", titolo: "Opera B", tecnica: "Acrilico", dimensioni: "20x20", anno: 2021, descrizione: "desc b", ordine: 2, image_path: "b.jpg", categoria: null },
  ];
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
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}
window.supabase = { createClient: () => client() };
window.__simulaEventiRavvicinati = () => { listenerAuth("SIGNED_IN", {}); listenerAuth("TOKEN_REFRESHED", {}); };
`;

const MOCK_HTML = `<!doctype html><html lang="it"><head><meta charset="UTF-8"><title>test</title><link rel="stylesheet" href="style.css"></head><body><div id="app"></div><script src="test-mock-setup.js"></script><script src="validazione.js"></script><script src="app.js"></script></body></html>`;

fs.writeFileSync(path.join(DIST, "admin", "test-mock-setup.js"), MOCK_SETUP);
fs.writeFileSync(path.join(DIST, "admin", "test-mock.html"), MOCK_HTML);

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
      await page.locator(".btn-elimina").first().click();
      await page.waitForTimeout(150);
      controlla("la conferma di eliminazione si apre", await page.evaluate(() => !!document.querySelector(".overlay-conferma")));
      await page.click("#annulla-elimina");

      controlla("l'elenco mostra la categoria di Opera A (classificata)", /Ricami/.test(await page.evaluate(() => document.querySelectorAll(".opera-riga")[0].textContent)));
      controlla("l'elenco mostra 'Da classificare' per Opera B (senza categoria)", /Da classificare/.test(await page.evaluate(() => document.querySelectorAll(".opera-riga")[1].textContent)));
      controlla("il badge di un'opera senza categoria usa lo stile dedicato", await page.evaluate(() => document.querySelectorAll(".opera-riga")[1].querySelector(".badge-categoria.non-classificata") !== null));

      await page.selectOption("#filtro-categoria", "ricami");
      await page.waitForTimeout(100);
      controlla("il filtro per categoria mostra solo le opere di quella categoria", (await page.evaluate(() => document.querySelectorAll(".opera-riga").length)) === 1);
      await page.selectOption("#filtro-categoria", "_nessuna");
      await page.waitForTimeout(100);
      controlla("il filtro 'Da classificare' mostra solo le opere senza categoria", (await page.evaluate(() => document.querySelectorAll(".opera-riga").length)) === 1 && /Opera B/.test(await page.evaluate(() => document.querySelector(".opera-riga").textContent)));
      await page.selectOption("#filtro-categoria", "");
      await page.waitForTimeout(100);
      controlla("il filtro 'Tutte' ripristina l'elenco completo", (await page.evaluate(() => document.querySelectorAll(".opera-riga").length)) === 2);

      await page.click("#btn-logout");
      await page.waitForTimeout(200);
      controlla("il logout chiama auth.signOut()", await page.evaluate(() => window.__loggedOut === true));
      await page.close();
    }

    // --- Campo categoria: nuova opera (selezione vuota obbligatoria) -----
    {
      const page = await browser.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(150);

      controlla("nuova opera: la categoria parte senza selezione (placeholder)", (await page.evaluate(() => document.getElementById("campo-categoria").value)) === "");

      // Compila tutto TRANNE la categoria: foto e titolo validi, categoria
      // lasciata sul placeholder vuoto e disabilitato.
      await page.evaluate(() => {
        const file = new File(["x"], "foto.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById("campo-foto").files = dt.files;
      });
      await page.fill("#campo-titolo", "Opera senza categoria scelta");
      await page.click("#btn-salva");
      await page.waitForTimeout(200);
      controlla("nuova opera: il salvataggio è bloccato se la categoria non è selezionata (validazione nativa del <select required>)", (await page.evaluate(() => window.__ultimoInsert)) === undefined);

      await page.selectOption("#campo-categoria", "paciughi");
      await page.click("#btn-salva");
      await page.waitForTimeout(200);
      const insertNuova = await page.evaluate(() => window.__ultimoInsert);
      controlla("nuova opera: con una categoria scelta il salvataggio riesce e la invia correttamente", insertNuova && insertNuova.categoria === "paciughi");
      controlla("nuova opera: nessun errore JavaScript durante tutto il flusso", erroriPagina.length === 0);
      await page.close();
    }

    // --- Campo categoria: modifica di un'opera già classificata ---------
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.locator(".btn-modifica").first().click(); // Opera A, categoria "ricami"
      await page.waitForTimeout(150);
      controlla("modifica di un'opera classificata: il menu è precompilato con la categoria corretta", (await page.evaluate(() => document.getElementById("campo-categoria").value)) === "ricami");
      controlla("modifica di un'opera classificata: nessun suggerimento di classificazione mancante", !(await page.evaluate(() => !!document.querySelector(".hint"))) || !(await page.evaluate(() => document.body.textContent.includes("non ha ancora una categoria"))));
      await page.close();
    }

    // --- Campo categoria: modifica di un'opera senza categoria ----------
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.locator(".btn-modifica").nth(1).click(); // Opera B, categoria NULL
      await page.waitForTimeout(150);
      controlla("modifica di un'opera senza categoria: il menu parte vuoto (nessuna preselezione arbitraria)", (await page.evaluate(() => document.getElementById("campo-categoria").value)) === "");
      controlla("modifica di un'opera senza categoria: viene mostrato un avviso esplicito", await page.evaluate(() => document.body.textContent.includes("non ha ancora una categoria")));

      await page.selectOption("#campo-categoria", "fuori_di_tela");
      await page.click("#btn-salva");
      await page.waitForTimeout(200);
      const updateOperaB = await page.evaluate(() => window.__ultimoUpdate);
      controlla("modifica di un'opera senza categoria: la classificazione scelta viene salvata correttamente", updateOperaB && updateOperaB.categoria === "fuori_di_tela");
      await page.close();
    }

    // --- Campo categoria: difesa lato interfaccia contro un valore
    // manomesso (non selezionabile dal menu reale) ----------------------
    {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html?admin=si`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.click("#btn-aggiungi");
      await page.waitForTimeout(150);

      await page.evaluate(() => {
        const file = new File(["x"], "foto.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById("campo-foto").files = dt.files;
      });
      await page.fill("#campo-titolo", "Opera con categoria manomessa");
      await page.evaluate(() => {
        // Simula una manomissione del DOM (es. da devtools): un'opzione con
        // un valore che l'interfaccia non offre mai normalmente.
        const sel = document.getElementById("campo-categoria");
        const opt = document.createElement("option");
        opt.value = "colore-a-caso";
        opt.textContent = "Colore a caso";
        sel.appendChild(opt);
        sel.value = "colore-a-caso";
      });
      // requestSubmit (non .click() sul bottone) per bypassare la validazione
      // nativa del browser e verificare che sia il controllo esplicito in
      // app.js, non solo l'HTML, a fermare un valore non ammesso.
      await page.evaluate(() => document.getElementById("form-opera").requestSubmit());
      await page.waitForTimeout(200);
      controlla("categoria manomessa: il salvataggio viene bloccato anche aggirando la validazione nativa del <select>", (await page.evaluate(() => window.__ultimoInsert)) === undefined);
      controlla("categoria manomessa: viene mostrato un messaggio di errore chiaro in italiano", await page.evaluate(() => document.getElementById("esito-form").textContent.includes("categoria valida")));
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
