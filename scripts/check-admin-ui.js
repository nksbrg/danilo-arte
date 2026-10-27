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
    from: () => ({ select: () => ({ order: () => ({ order: async () => ({ data: opere, error: null }) }) }) }),
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: "https://esempio.supabase.co/storage/v1/object/public/opere/" + p } }) }) },
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
