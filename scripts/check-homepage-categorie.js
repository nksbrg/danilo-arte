#!/usr/bin/env node
"use strict";
/**
 * Test di integrazione della homepage pubblica con un browser reale
 * (Playwright) e un endpoint REST Supabase SIMULATO (nessuna rete reale,
 * nessun dato di produzione toccato — vedi CATEGORIE-OPERE.md).
 *
 * Verifica, con query DOM/CSS reali, cose che node:test non può controllare:
 * - le tre sezioni "01/Ricami 02/Fuori di tela 03/Paciughi" esistono, nello
 *   stesso ordine, come sezioni verticali della stessa pagina (non tab, non
 *   pagine separate);
 * - ogni opera finisce nella galleria della propria categoria, e SOLO lì;
 * - l'ordinamento (ordine.asc, titolo.asc) resta coerente ALL'INTERNO di
 *   ciascuna categoria anche quando le opere arrivano intrecciate fra le
 *   categorie nella risposta REST;
 * - la sezione "da classificare" è assente quando non serve, e appare (con le
 *   opere corrette) solo quando esiste davvero un'opera senza categoria;
 * - nessuna opera scompare silenziosamente: il totale mostrato nelle quattro
 *   gallerie corrisponde sempre al totale restituito dalla query;
 * - i collegamenti rapidi (anchor) portano alla sezione giusta senza
 *   nasconderne il titolo dietro la nav fissa;
 * - il lightbox si apre/chiude e mostra le informazioni corrette;
 * - nessun overflow orizzontale e nessun errore JavaScript, anche su
 *   viewport di uno smartphone.
 *
 * Richiede: Playwright installato e dist/ già generata.
 * Uso: node scripts/build.js && node scripts/check-homepage-categorie.js
 *
 * Non è parte di `node --test` (richiede un browser e una porta locale).
 */

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = 8570;

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("dist/ non trovata o incompleta: eseguire prima `node scripts/build.js`.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".jpg": "image/jpeg" };

// Opere di prova intenzionalmente INTRECCIATE fra categorie e con "ordine"
// non monotono nell'elenco grezzo, per verificare che il raggruppamento per
// categoria non comprometta l'ordinamento interno di ciascuna sezione (deve
// restare quello di "ordine", non quello di arrivo dall'API).
function opereFinte({ conNonClassificate }) {
  const base = [
    // "Ricamo Uno" porta anche larghezza_px/altezza_px (PR #4,
    // supabase/migrations/0007_dimensioni_immagine.sql): verifica che
    // categoria e dimensioni dichiarate funzionino insieme, nella stessa
    // galleria di categoria, senza che l'una dipenda dalla presenza
    // dell'altra (le altre opere di prova qui sotto NON hanno
    // larghezza_px/altezza_px, come un'opera caricata prima della PR #4).
    { titolo: "Ricamo Tre", categoria: "ricami", ordine: 3, image_path: "opera-prova-1.jpg" },
    { titolo: "Paciugo Uno", categoria: "paciughi", ordine: 1, image_path: "opera-prova-2.jpg" },
    { titolo: "Ricamo Uno", categoria: "ricami", ordine: 1, image_path: "opera-prova-3.jpg", larghezza_px: 1200, altezza_px: 900 },
    { titolo: "Fuori Due", categoria: "fuori_di_tela", ordine: 2, image_path: "opera-prova-1.jpg" },
    { titolo: "Ricamo Due", categoria: "ricami", ordine: 2, image_path: "opera-prova-2.jpg" },
    { titolo: "Fuori Uno", categoria: "fuori_di_tela", ordine: 1, image_path: "opera-prova-3.jpg" },
    { titolo: "Paciugo Due", categoria: "paciughi", ordine: 2, image_path: "opera-prova-1.jpg" },
  ];
  const opere = base.map((o) => ({
    tecnica: "Tecnica di prova", dimensioni: "10x10cm", anno: 2024, descrizione: `Descrizione di ${o.titolo}.`,
    ...o,
  }));
  if (conNonClassificate) {
    opere.push(
      { titolo: "Senza Categoria Uno", categoria: null, ordine: 0, image_path: "opera-prova-2.jpg", tecnica: "x", dimensioni: "x", anno: 2019, descrizione: "" },
      { titolo: "Senza Categoria Due", categoria: null, ordine: 5, image_path: "opera-prova-3.jpg", tecnica: "x", dimensioni: "x", anno: 2019, descrizione: "" }
    );
  }
  // L'ordine di arrivo dall'API (REST reale: ordine.asc,titolo.asc sull'intera
  // tabella) non coincide con l'ordine di definizione sopra: lo ricalcoliamo
  // qui per restituire un elenco realistico, già "ordinato globalmente" ma
  // ancora intrecciato fra categorie diverse.
  opere.sort((a, b) => a.ordine - b.ordine || a.titolo.localeCompare(b.titolo, "it"));
  return opere;
}

function avviaServer(catalogo) {
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split("?")[0]);
    if (req.url.startsWith("/rest/v1/opere")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(catalogo));
      return;
    }
    if (p === "/supabase-config.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(`window.SUPABASE_URL = "http://localhost:${PORT}"; window.SUPABASE_PUBLISHABLE_KEY = "chiave-finta";`);
      return;
    }
    const fsPath = p.startsWith("/storage/v1/object/public/opere/")
      ? path.join(DIST, "assets", "test-opere", path.basename(p))
      : path.join(DIST, p === "/" ? "/index.html" : p);
    fs.readFile(fsPath, (err, data) => {
      if (err) { res.statusCode = 404; res.end("not found: " + fsPath); return; }
      res.setHeader("Content-Type", MIME[path.extname(fsPath)] || "application/octet-stream");
      res.end(data);
    });
  });
}

let superati = 0;
function controlla(etichetta, condizione) {
  if (!condizione) throw new Error(`FALLITO: ${etichetta}`);
  superati++;
  console.log(`  ok - ${etichetta}`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    // --- Struttura, distribuzione per categoria, ordinamento interno ----
    {
      const catalogo = opereFinte({ conNonClassificate: false });
      const server = avviaServer(catalogo);
      await new Promise((resolve) => server.listen(PORT, resolve));
      const erroriPagina = [];
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.on("pageerror", (e) => erroriPagina.push(e.message));
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);

        const idSezioniInOrdine = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".opere-sezione:not(.opere-sezione-provvisoria)")).map((el) => el.id)
        );
        controlla("le tre sezioni esistono nell'ordine 01/02/03 (ricami, fuori-di-tela, paciughi)", JSON.stringify(idSezioniInOrdine) === JSON.stringify(["ricami", "fuori-di-tela", "paciughi"]));

        const numerazione = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".opere-sezione:not(.opere-sezione-provvisoria) .section-label")).map((el) => el.textContent.trim())
        );
        controlla("ogni sezione mostra la propria numerazione (01, 02, 03)", JSON.stringify(numerazione) === JSON.stringify(["01", "02", "03"]));

        controlla("sono sezioni verticali della stessa pagina, non tab/pagine separate (stesso <body>, nessuna navigazione)", await page.evaluate(() => document.querySelectorAll("#ricami, #fuori-di-tela, #paciughi").length === 3));

        const titoliRicami = await page.evaluate(() => Array.from(document.querySelectorAll("#gallery-ricami .gallery-overlay-text")).map((el) => el.textContent));
        controlla("la sezione Ricami contiene solo le opere di categoria 'ricami', in ordine corretto", JSON.stringify(titoliRicami) === JSON.stringify(["Ricamo Uno", "Ricamo Due", "Ricamo Tre"]));

        // Integrazione categoria + larghezza_px/altezza_px (PR #4): "Ricamo
        // Uno" ha entrambe le proprietà, le altre opere di Ricami no. Le due
        // informazioni devono convivere nella stessa galleria di categoria,
        // ciascuna applicata correttamente in base a cosa è disponibile per
        // ogni singola opera.
        const dimensioniImg = await page.evaluate(() => {
          const immagini = Array.from(document.querySelectorAll("#gallery-ricami .gallery-item img"));
          return immagini.map((img) => ({ haWidth: img.hasAttribute("width"), haHeight: img.hasAttribute("height"), decoding: img.decoding }));
        });
        controlla("l'opera con larghezza_px/altezza_px (Ricamo Uno) ha gli attributi width/height sull'immagine", dimensioniImg[0].haWidth && dimensioniImg[0].haHeight);
        controlla("le altre opere di Ricami, senza quelle colonne valorizzate, non hanno width/height forzati", !dimensioniImg[1].haWidth && !dimensioniImg[2].haWidth);
        controlla("tutte le immagini della galleria usano decoding=\"async\" indipendentemente dalla categoria", dimensioniImg.every((d) => d.decoding === "async"));
        // img.width/img.height (proprietà IDL) riportano la dimensione
        // RESA (vincolata da width:100% nel CSS della galleria), non
        // l'attributo HTML: per verificare il valore effettivamente
        // impostato da index.html si legge l'attributo direttamente.
        const wxh = await page.evaluate(() => { const img = document.querySelector("#gallery-ricami .gallery-item img"); return [img.getAttribute("width"), img.getAttribute("height")]; });
        controlla("gli attributi width/height riportano esattamente i valori di larghezza_px/altezza_px (1200x900)", wxh[0] === "1200" && wxh[1] === "900");

        const titoliFuori = await page.evaluate(() => Array.from(document.querySelectorAll("#gallery-fuori-di-tela .gallery-overlay-text")).map((el) => el.textContent));
        controlla("la sezione Fuori di tela contiene solo le proprie opere, in ordine corretto", JSON.stringify(titoliFuori) === JSON.stringify(["Fuori Uno", "Fuori Due"]));

        const titoliPaciughi = await page.evaluate(() => Array.from(document.querySelectorAll("#gallery-paciughi .gallery-overlay-text")).map((el) => el.textContent));
        controlla("la sezione Paciughi contiene solo le proprie opere, in ordine corretto", JSON.stringify(titoliPaciughi) === JSON.stringify(["Paciugo Uno", "Paciugo Due"]));

        const totaleVisualizzato = await page.evaluate(() => document.querySelectorAll(".gallery-item").length);
        controlla("nessuna opera scompare silenziosamente: il totale mostrato corrisponde al totale del catalogo", totaleVisualizzato === catalogo.length);

        controlla("la sezione 'da classificare' NON è presente quando tutte le opere sono classificate", await page.evaluate(() => document.getElementById("opere-da-classificare").classList.contains("nascosto")));

        controlla("nessun errore JavaScript", erroriPagina.length === 0);
        await page.close();
      } finally {
        server.close();
      }
    }

    // --- Opere non classificate: sezione provvisoria visibile -----------
    {
      const catalogo = opereFinte({ conNonClassificate: true });
      const server = avviaServer(catalogo);
      await new Promise((resolve) => server.listen(PORT, resolve));
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);

        controlla("con opere non classificate, la sezione provvisoria appare", !(await page.evaluate(() => document.getElementById("opere-da-classificare").classList.contains("nascosto"))));
        const titoliNonClassificate = await page.evaluate(() => Array.from(document.querySelectorAll("#gallery-da-classificare .gallery-overlay-text")).map((el) => el.textContent));
        controlla("la sezione provvisoria mostra esattamente le opere senza categoria, in ordine corretto", JSON.stringify(titoliNonClassificate) === JSON.stringify(["Senza Categoria Uno", "Senza Categoria Due"]));
        controlla("le opere non classificate NON sono duplicate nelle tre sezioni definitive", (await page.evaluate(() => document.querySelectorAll("#gallery-ricami .gallery-item, #gallery-fuori-di-tela .gallery-item, #gallery-paciughi .gallery-item").length)) === 7);
        const totaleVisualizzato = await page.evaluate(() => document.querySelectorAll(".gallery-item").length);
        controlla("il totale mostrato (3 sezioni + provvisoria) corrisponde al totale del catalogo", totaleVisualizzato === catalogo.length);
        await page.close();
      } finally {
        server.close();
      }
    }

    // --- Navigazione tramite anchor link, con header fisso ---------------
    {
      const catalogo = opereFinte({ conNonClassificate: false });
      const server = avviaServer(catalogo);
      await new Promise((resolve) => server.listen(PORT, resolve));
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);

        await page.click('.opere-quicklinks a[href="#fuori-di-tela"]');
        await page.waitForTimeout(1300); // scroll-behavior:smooth, su una distanza lunga

        const altezzaNav = await page.evaluate(() => document.querySelector("nav").getBoundingClientRect().height);
        const topTitolo = await page.evaluate(() => document.querySelector("#fuori-di-tela .section-title").getBoundingClientRect().top);
        controlla("il collegamento rapido 'Fuori di tela' porta alla sezione giusta", await page.evaluate(() => document.querySelector("#fuori-di-tela").getBoundingClientRect().top <= 100));
        controlla("il titolo della sezione non resta nascosto sotto la nav fissa", topTitolo >= altezzaNav - 5);

        await page.click('a[href="#opere"]');
        await page.waitForTimeout(1300);
        controlla("la voce di menu 'Opere' porta all'inizio dell'area opere", await page.evaluate(() => document.querySelector("#opere").getBoundingClientRect().top <= 100));

        await page.close();
      } finally {
        server.close();
      }
    }

    // --- Lightbox: apertura, informazioni corrette, chiusura -------------
    {
      const catalogo = opereFinte({ conNonClassificate: false });
      const server = avviaServer(catalogo);
      await new Promise((resolve) => server.listen(PORT, resolve));
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);

        await page.locator("#gallery-paciughi .gallery-item").first().click();
        await page.waitForTimeout(150);
        controlla("il lightbox si apre al click su un'opera", await page.evaluate(() => document.getElementById("lightbox").classList.contains("open")));
        controlla("il lightbox mostra il titolo corretto dell'opera", (await page.evaluate(() => document.getElementById("lightboxCaption").textContent)) === "Paciugo Uno");

        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
        controlla("Escape chiude il lightbox", !(await page.evaluate(() => document.getElementById("lightbox").classList.contains("open"))));

        await page.locator("#gallery-ricami .gallery-item").first().click();
        await page.waitForTimeout(150);
        await page.locator("#lightbox").click({ position: { x: 5, y: 5 } });
        await page.waitForTimeout(150);
        controlla("un clic fuori dall'immagine chiude il lightbox", !(await page.evaluate(() => document.getElementById("lightbox").classList.contains("open"))));

        await page.close();
      } finally {
        server.close();
      }
    }

    // --- Layout della fotografia: una sola opera per categoria -----------
    // Due regressioni riscontrate in sequenza su questo stesso componente:
    // 1) con `columns:3` fisso, una categoria con una sola opera lasciava
    //    2 colonne vuote e comprimeva l'unica immagine in una colonna
    //    stretta, facendo scattare min-height:200px al posto delle
    //    proporzioni reali ("stretta, eccessivamente alta, enormi spazi
    //    vuoti");
    // 2) la correzione successiva (column-count adattivo) eliminava gli
    //    spazi vuoti ma faceva sì che l'unica foto riempisse l'intera
    //    larghezza della sezione, apparendo sproporzionatamente grande
    //    ("immagine enorme a tutta pagina") e non più "a mosaico".
    // Il comportamento corretto, verificato qui: con poche opere, column-
    // count resta adattivo (niente colonne vuote) MA ogni fotografia è
    // comunque limitata alla dimensione che avrebbe in un mosaico a 3
    // colonne pienamente popolato (--tile-ideale), centrata nello spazio
    // assegnato — stessa dimensione "a mosaico" di sempre, indipendente dal
    // numero di opere e coerente fra le tre categorie.
    {
      const catalogoUnaOpera = [
        { titolo: "Ricamo Unico", categoria: "ricami", ordine: 1, image_path: "opera-prova-1.jpg", tecnica: "Ricamo", dimensioni: "30x30cm", anno: 2024, descrizione: "" },
        { titolo: "Fuori Unico", categoria: "fuori_di_tela", ordine: 1, image_path: "opera-prova-2.jpg", tecnica: "Mista", dimensioni: "40x40cm", anno: 2024, descrizione: "" },
        { titolo: "Paciugo Unico", categoria: "paciughi", ordine: 1, image_path: "opera-prova-3.jpg", tecnica: "Acrilico", dimensioni: "50x50cm", anno: 2024, descrizione: "" },
      ];
      const server = avviaServer(catalogoUnaOpera);
      await new Promise((resolve) => server.listen(PORT, resolve));
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);

        const larghezzeItem = [];
        for (const [nomeSezione, idGalleria] of [["Ricami", "gallery-ricami"], ["Fuori di tela", "gallery-fuori-di-tela"], ["Paciughi", "gallery-paciughi"]]) {
          const info = await page.evaluate((id) => {
            const container = document.getElementById(id);
            const item = container.querySelector(".gallery-item");
            const rectContainer = container.getBoundingClientRect();
            const rectItem = item.getBoundingClientRect();
            return {
              colonne: getComputedStyle(container).columnCount,
              larghezzaContainer: rectContainer.width,
              larghezzaItem: rectItem.width,
              altezzaItem: rectItem.height,
              spazioSinistra: rectItem.left - rectContainer.left,
              spazioDestra: rectContainer.right - rectItem.right,
            };
          }, idGalleria);
          larghezzeItem.push(info.larghezzaItem);
          controlla(`${nomeSezione}, una sola opera: la galleria usa 1 colonna (non 3 fisse, niente colonne vuote)`, info.colonne === "1");
          controlla(`${nomeSezione}, una sola opera: l'immagine NON riempie l'intera larghezza della galleria (non più "enorme a tutta pagina")`, info.larghezzaItem < info.larghezzaContainer * 0.6);
          controlla(`${nomeSezione}, una sola opera: l'immagine è comunque di dimensione ragionevole, non ridotta a miniatura`, info.larghezzaItem > info.larghezzaContainer * 0.15);
          controlla(`${nomeSezione}, una sola opera: è centrata nello spazio disponibile (spazio simmetrico ai lati)`, Math.abs(info.spazioSinistra - info.spazioDestra) < 2);
          // Foto di prova reali 1200x900 (4:3, vedi assets/test-opere/):
          // un'altezza coerente con quel rapporto conferma che le
          // proporzioni naturali sono rispettate, non quelle forzate da
          // min-height su una colonna stretta né un ritaglio arbitrario.
          const rapportoAtteso = 900 / 1200;
          const rapportoReale = info.altezzaItem / info.larghezzaItem;
          controlla(`${nomeSezione}, una sola opera: l'altezza rispetta le proporzioni reali della foto (4:3)`, Math.abs(rapportoReale - rapportoAtteso) < 0.05);
        }

        controlla("una sola opera: le tre categorie mostrano fotografie della STESSA dimensione (mosaico coerente, non una diversa per sezione)", Math.max(...larghezzeItem) - Math.min(...larghezzeItem) < 2);

        await page.close();
      } finally {
        server.close();
      }
    }

    // --- Layout della fotografia: il mosaico a più colonne resta invariato
    // quando una categoria ha abbastanza opere da riempirlo, E le due
    // situazioni (poche/molte opere) risultano visivamente coerenti fra
    // loro (stessa dimensione di tassello) ---------------------------------
    {
      const catalogoMolte = [];
      for (let i = 1; i <= 5; i++) {
        catalogoMolte.push({ titolo: `Ricamo ${i}`, categoria: "ricami", ordine: i, image_path: `opera-prova-${(i % 3) + 1}.jpg`, tecnica: "Ricamo", dimensioni: "10x10cm", anno: 2024, descrizione: "" });
      }
      const server = avviaServer(catalogoMolte);
      await new Promise((resolve) => server.listen(PORT, resolve));
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        const info = await page.evaluate(() => {
          const container = document.getElementById("gallery-ricami");
          const item = container.querySelector(".gallery-item");
          return { colonne: getComputedStyle(container).columnCount, larghezzaItem: item.getBoundingClientRect().width };
        });
        controlla("categoria con 5 opere: il mosaico a 3 colonne resta quello originale (nessuna regressione nella direzione opposta)", info.colonne === "3");
        // Stessa identica larghezza di tassello misurata sopra con 1 sola
        // opera: il limite di dimensione non altera il mosaico quando le
        // colonne reali sono già 3 (è "inerte", come documentato nel CSS).
        controlla("il tassello del mosaico con 5 opere ha la stessa dimensione di quello con 1 sola opera (coerenza visiva)", info.larghezzaItem > 380 && info.larghezzaItem < 400);
        await page.close();
      } finally {
        server.close();
      }
    }

    // --- Responsive mobile: nessun overflow, nessun errore ---------------
    {
      const catalogo = opereFinte({ conNonClassificate: true });
      const server = avviaServer(catalogo);
      await new Promise((resolve) => server.listen(PORT, resolve));
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const erroriPagina = [];
        page.on("pageerror", (e) => erroriPagina.push(e.message));
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        controlla("nessun overflow orizzontale a 390px di larghezza", overflow <= 1);

        const sezioniVisibili = await page.evaluate(() => Array.from(document.querySelectorAll(".opere-sezione:not(.nascosto)")).length);
        controlla("tutte e quattro le sezioni (3 definitive + provvisoria) sono presenti e leggibili su mobile", sezioniVisibili === 4);

        const quicklinksAPiena = await page.evaluate(() => {
          const nav = document.querySelector(".opere-quicklinks");
          return nav.getBoundingClientRect().width <= document.documentElement.clientWidth + 1;
        });
        controlla("i collegamenti rapidi vanno a capo invece di causare overflow su smartphone", quicklinksAPiena);

        controlla("nessun errore JavaScript su viewport smartphone", erroriPagina.length === 0);
        await page.close();
      } finally {
        server.close();
      }
    }

    console.log(`\n${superati} controlli superati.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("\nFALLITO:", err.message);
  process.exit(1);
});
