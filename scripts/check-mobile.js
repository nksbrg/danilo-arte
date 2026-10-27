#!/usr/bin/env node
"use strict";
/**
 * Audit mobile ed emulazione dispositivi per il sito pubblico e il
 * pannello /admin, con Playwright.
 *
 * IMPORTANTE SUI LIMITI DI QUESTA VERIFICA:
 * - Motore di rendering: solo Chromium (motore di Chrome/Edge/Android).
 *   WebKit (il motore reale di Safari) non è installato in questo ambiente
 *   di sviluppo: i profili "iPhone" qui sotto emulano viewport, user agent
 *   e supporto touch di un iPhone, MA renderizzano con il motore Chromium,
 *   non con WebKit. Non è quindi un vero test di Safari iOS: eventuali bug
 *   specifici del motore WebKit (es. comportamento di 100vh con la barra
 *   degli indirizzi, differenze di scroll momentum) NON possono essere
 *   rilevati così. Vanno verificati su un dispositivo Apple reale o con
 *   BrowserStack/simulatore Xcode.
 * - Nessun dispositivo fisico è stato usato: tutto qui è emulazione.
 *
 * Uso: node scripts/build.js && node scripts/check-mobile.js
 */

const { chromium, devices } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = 8535;

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("dist/ non trovata o incompleta: eseguire prima `node scripts/build.js`.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const fsPath = path.join(DIST, p === "/" ? "/index.html" : p);
  fs.readFile(fsPath, (err, data) => {
    if (err) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", MIME[path.extname(fsPath)] || "application/octet-stream");
    res.end(data);
  });
});

let superati = 0;
let avvisi = 0;
function controlla(etichetta, condizione) {
  if (!condizione) throw new Error(`FALLITO: ${etichetta}`);
  superati++;
  console.log(`  ok - ${etichetta}`);
}
function avvisa(testo) {
  avvisi++;
  console.log(`  ATTENZIONE - ${testo}`);
}

// Profili reali di Playwright: viewport + user agent + touch, dispositivi
// emulati, non fisici. "(EMULATO)" lo ricorda in ogni riga di log.
const DISPOSITIVI = [
  { nome: "iPhone SE (telefono piccolo)", profilo: devices["iPhone SE"] },
  { nome: "iPhone 13 (telefono medio)", profilo: devices["iPhone 13"] },
  { nome: "iPhone 14 Pro Max (telefono grande)", profilo: devices["iPhone 14 Pro Max"] },
  { nome: "Pixel 7 (Android medio)", profilo: devices["Pixel 7"] },
  { nome: "Galaxy S9+ (Android piccolo)", profilo: devices["Galaxy S9+"] },
  { nome: "iPad Mini (tablet)", profilo: devices["iPad Mini"] },
];

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch();
  try {
    console.log("\n=== SITO PUBBLICO — nessun overflow orizzontale, menu, lightbox ===");
    for (const { nome, profilo } of DISPOSITIVI) {
      const context = await browser.newContext({ ...profilo });
      const page = await context.newPage();
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      controlla(`${nome} (EMULATO, ${profilo.viewport.width}px): nessun overflow orizzontale (scrollWidth - innerWidth = ${overflow})`, overflow <= 1);

      const largo = profilo.viewport.width > 900;
      const hamburgerVisibile = await page.evaluate(() => getComputedStyle(document.querySelector(".hamburger")).display !== "none");
      const navLinksVisibili = await page.evaluate(() => getComputedStyle(document.querySelector(".nav-links")).display !== "none");
      if (largo) {
        controlla(`${nome}: sopra i 900px i link di navigazione sono visibili (non serve l'hamburger)`, navLinksVisibili);
      } else {
        controlla(`${nome}: sotto i 900px compare l'hamburger`, hamburgerVisibile);
        controlla(`${nome}: sotto i 900px i link di navigazione normali sono nascosti (niente doppio menu)`, !navLinksVisibili);

        // Interazione touch reale (tap, non click) sull'hamburger.
        await page.tap(".hamburger");
        await page.waitForTimeout(200);
        const menuAperto = await page.evaluate(() => document.getElementById("mobileMenu")?.classList.contains("open"));
        controlla(`${nome}: tap sull'hamburger apre il menu mobile`, menuAperto);
        await page.tap("#menuClose");
        await page.waitForTimeout(200);
        const menuChiuso = await page.evaluate(() => !document.getElementById("mobileMenu")?.classList.contains("open"));
        controlla(`${nome}: tap su chiudi richiude il menu`, menuChiuso);
      }

      // "gallery-ricami" è una delle quattro gallerie (una per categoria più
      // quella provvisoria "da classificare", vedi CATEGORIE-OPERE.md):
      // condividono tutte la stessa classe/regola CSS ".gallery", quindi
      // basta verificarne una per controllare il comportamento a colonne a
      // ogni breakpoint.
      const colonneGalleria = await page.evaluate(() => getComputedStyle(document.getElementById("gallery-ricami")).columnCount);
      const atteso = profilo.viewport.width <= 540 ? "1" : profilo.viewport.width <= 900 ? "2" : "3";
      controlla(`${nome}: la galleria usa ${atteso} colonna/e alla larghezza ${profilo.viewport.width}px (trovato: ${colonneGalleria})`, colonneGalleria === atteso);

      // Lightbox: apertura/chiusura testata direttamente (nessuna opera
      // reale nel catalogo di prova), compatibile con touch.
      await page.evaluate(() => openLightbox("/assets/test-opere/opera-prova-1.jpg", "Prova", "2024 · Olio", "Una descrizione di prova."));
      await page.waitForTimeout(150);
      const lightboxAperto = await page.evaluate(() => document.getElementById("lightbox").classList.contains("open"));
      controlla(`${nome}: il lightbox si apre`, lightboxAperto);
      const lightboxStaDentroViewport = await page.evaluate(() => {
        const img = document.getElementById("lightboxImg");
        const r = img.getBoundingClientRect();
        return r.width <= window.innerWidth && r.height <= window.innerHeight;
      });
      controlla(`${nome}: l'immagine nel lightbox resta dentro lo schermo (max-width/max-height rispettati)`, lightboxStaDentroViewport);
      // Tap in un angolo, deliberatamente FUORI dall'immagine (che è
      // centrata): un tap al centro del lightbox cadrebbe sull'immagine
      // stessa, non sullo sfondo, e non proverebbe la chiusura "tocca fuori
      // per chiudere".
      await page.locator("#lightbox").tap({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(150);
      const lightboxChiuso = await page.evaluate(() => !document.getElementById("lightbox").classList.contains("open"));
      controlla(`${nome}: tap fuori dall'immagine chiude il lightbox`, lightboxChiuso);

      controlla(`${nome}: nessun errore JavaScript durante la navigazione`, erroriPagina.length === 0);

      await context.close();
    }

    console.log("\n=== PANNELLO /admin — login, elenco, modulo, eliminazione ===");
    const MOCK_SETUP = `
window.SUPABASE_URL = "https://esempio.supabase.co";
window.SUPABASE_PUBLISHABLE_KEY = "chiave-finta";
function client() {
  const opere = [
    { id: "11111111-1111-1111-1111-111111111111", titolo: "Opera con un titolo piuttosto lungo per il test", tecnica: "Olio su tela", dimensioni: "80x60cm", anno: 2020, descrizione: "desc", ordine: 1, image_path: "a.jpg" },
  ];
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }),
      onAuthStateChange: () => {},
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ data: { is_admin: true, has_mfa: false }, error: null }),
    from: () => ({
      select: () => ({ order: () => ({ order: async () => ({ data: opere, error: null }) }) }),
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: "https://esempio.supabase.co/storage/v1/object/public/opere/" + p } }), upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  };
}
window.supabase = { createClient: () => client() };
`;
    const MOCK_HTML = `<!doctype html><html lang="it"><head><meta charset="UTF-8"><title>test</title><link rel="stylesheet" href="style.css"></head><body><div id="app"></div><script src="test-mock-setup.js"></script><script src="validazione.js"></script><script src="elaborazione-immagine.js"></script><script src="app.js"></script></body></html>`;
    fs.writeFileSync(path.join(DIST, "admin", "test-mock-setup.js"), MOCK_SETUP);
    fs.writeFileSync(path.join(DIST, "admin", "test-mock.html"), MOCK_HTML);

    for (const { nome, profilo } of [DISPOSITIVI[0], DISPOSITIVI[3], DISPOSITIVI[5]]) {
      const context = await browser.newContext({ ...profilo });
      const page = await context.newPage();

      // Login: nessun file di configurazione -> login senza mock, solo
      // controllo che il modulo stia dentro lo schermo. Qui app.js lancia
      // DI PROPOSITO un errore quando manca la configurazione (vedi
      // SECURITY-AUDIT.md: ferma l'esecuzione dopo aver mostrato il
      // messaggio "Configurazione mancante"), quindi non registriamo gli
      // errori di pagina in questa fase: non sarebbero un bug.
      await page.goto(`http://localhost:${PORT}/admin/index.html`, { waitUntil: "load" });
      await page.waitForTimeout(600);
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      controlla(`admin ${nome}: nessun overflow orizzontale sulla schermata iniziale`, overflow <= 1);

      // Dashboard/modulo/eliminazione con il client simulato: da qui in
      // avanti NESSUN errore è atteso, quindi li registriamo per davvero.
      const erroriPagina = [];
      page.on("pageerror", (e) => erroriPagina.push(e.message));
      await page.goto(`http://localhost:${PORT}/admin/test-mock.html`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      controlla(`admin ${nome}: nessun overflow orizzontale nella dashboard (opere con titolo lungo)`, overflow <= 1);

      await page.tap("#btn-aggiungi");
      await page.waitForTimeout(150);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      controlla(`admin ${nome}: nessun overflow orizzontale nel modulo "Aggiungi opera"`, overflow <= 1);
      const campoFotoRaggiungibile = await page.evaluate(() => {
        const el = document.getElementById("campo-foto");
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth;
      });
      controlla(`admin ${nome}: il selettore della fotografia è interamente visibile, non tagliato`, campoFotoRaggiungibile);

      await page.tap("#btn-annulla");
      await page.waitForTimeout(150);
      await page.tap(".btn-elimina");
      await page.waitForTimeout(150);
      const overlayDentroSchermo = await page.evaluate(() => {
        const card = document.querySelector(".overlay-conferma .card");
        if (!card) return false;
        const r = card.getBoundingClientRect();
        return r.left >= 0 && r.right <= window.innerWidth && r.width > 0;
      });
      controlla(`admin ${nome}: la finestra di conferma eliminazione sta dentro lo schermo, non tagliata ai lati`, overlayDentroSchermo);
      const pulsantiConfermaRaggiungibili = await page.evaluate(() => {
        const si = document.getElementById("conferma-elimina").getBoundingClientRect();
        const no = document.getElementById("annulla-elimina").getBoundingClientRect();
        return si.width > 0 && no.width > 0 && si.bottom <= window.innerHeight && no.bottom <= window.innerHeight;
      });
      controlla(`admin ${nome}: i pulsanti "Sì, elimina"/"Annulla" sono raggiungibili col dito, non fuori schermo`, pulsantiConfermaRaggiungibili);

      controlla(`admin ${nome}: nessun errore JavaScript`, erroriPagina.length === 0);
      await context.close();
    }

    fs.rmSync(path.join(DIST, "admin", "test-mock-setup.js"), { force: true });
    fs.rmSync(path.join(DIST, "admin", "test-mock.html"), { force: true });

    console.log(`\n${superati} controlli superati${avvisi ? `, ${avvisi} avvisi` : ""}.`);
  } finally {
    server.close();
    await browser.close();
  }
}

main().catch((err) => {
  fs.rmSync(path.join(DIST, "admin", "test-mock-setup.js"), { force: true });
  fs.rmSync(path.join(DIST, "admin", "test-mock.html"), { force: true });
  server.close();
  console.error("\nFALLITO:", err.message);
  process.exit(1);
});
