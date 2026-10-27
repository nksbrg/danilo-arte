# Correzione del mosaico fotografico nelle gallerie per categoria

Branch `claude/fix-mosaico-galleria`, creato dall'ultimo commit di `main` (che include già le PR #4, #5 e #6). **Non mergiato su `main`.**

Affina la correzione della PR #6, che aveva eliminato gli spazi vuoti ma, come segnalato, faceva sì che una categoria con poche opere mostrasse una fotografia a piena larghezza della sezione ("enorme a tutta pagina") invece di una vera disposizione a mosaico.

Un vecchio `index.html` è stato fornito come riferimento storico **solo per confrontare le regole CSS/JS della galleria**: non è stato copiato, ripristinato né usato per sostituire alcun file. Nessuna modifica a struttura delle categorie, CMS, Supabase, database, upload, navigazione o altre sezioni della homepage.

## 1. Confronto con il vecchio file di riferimento

Le regole CSS della galleria nel vecchio `index.html` fornito sono **identiche** a quelle attualmente su `main` (stesso `.gallery-item`, stesso `object-fit:cover`, stesso `min-height:200px`, stesso hover, stesso overlay) — l'unica differenza è `.gallery { columns:3; column-gap:12px; }` **fisso**, invariato dal vecchio file fino a prima della PR #6. La logica JavaScript di costruzione degli elementi (`creaElementoGalleria`/l'equivalente inline nel vecchio file) è anch'essa identica nella sostanza.

Questo conferma che il problema non è mai stato nelle regole di stile della singola fotografia, ma unicamente nel numero di colonne della galleria, non più adeguato a gallerie (una per categoria) spesso molto più piccole dell'unica galleria originale.

## 2. Cosa non andava nella correzione precedente (PR #6)

La PR #6 aveva introdotto `column-count:min(3, var(--n-opere, 3))`, impostando il numero di colonne al numero reale di opere di ciascuna galleria. Risolveva gli spazi vuoti, ma con una sola opera il risultato era `column-count:1`: la fotografia, priva di qualunque altro limite di larghezza, si distendeva a riempire **l'intera larghezza della sezione** (fino a 1200px e oltre su schermi larghi) — non più "a mosaico" ma un blocco enorme, visivamente in rottura con il resto del sito.

## 3. La correzione

Aggiunta una proprietà CSS personalizzata, `--tile-ideale`, che esprime quanto sarebbe larga **una singola fotografia in un mosaico a pieno numero di colonne**, alla larghezza di finestra corrente — e usata come `max-width` su `.gallery-item`, con centratura orizzontale:

```css
.gallery {
  column-count:min(3, var(--n-opere, 3));
  column-gap:12px;
  --tile-ideale:calc((100vw - 104px) / 3); /* 2×40px di padding laterale (.opere) + 2×12px di column-gap, come a 3 colonne piene */
}
.gallery-item {
  break-inside:avoid;
  max-width:var(--tile-ideale, none);
  margin:0 auto 12px; /* margini laterali auto: centra il tassello nello spazio assegnato da column-count */
  border:3px solid var(--black); overflow:hidden; position:relative; cursor:pointer; display:block;
}
```

Con lo stesso principio nei due breakpoint responsive esistenti (`--tile-ideale:calc((100vw - 60px) / 2)` sotto i 900px, coerente con `column-count:min(2, ...)` di quel breakpoint; `--tile-ideale:none` sotto i 540px, dove la galleria è sempre a 1 colonna piena larghezza come è sempre stata, nessun limite necessario).

**Regole CSS modificate**: solo `.gallery` e `.gallery-item` (e i loro overridi nei due `@media`). **Nessuna funzione JavaScript modificata**: la correzione è interamente in CSS, non è stato necessario toccare `popolaGalleria()`, `creaElementoGalleria()` o `caricaOpere()` (già corrette dalla PR #6 per il conteggio delle opere tramite `--n-opere`).

**Perché funziona**:
- **Poche opere** (1 o 2): `column-count` resta adattivo (niente colonne vuote, merito della PR #6), ma ogni fotografia è comunque limitata a `--tile-ideale` — la stessa dimensione che avrebbe in un mosaico pienamente popolato — e centrata nello spazio (più ampio) che la singola colonna le assegna. Risultato: una fotografia di dimensione equilibrata, non un blocco enorme, con margini bianchi simmetrici ai lati che richiamano visivamente l'armonia del mosaico originale.
- **Abbastanza opere da riempire le colonne** (3 o più): la larghezza naturale di ciascuna colonna coincide già con `--tile-ideale` (per costruzione: è lo stesso calcolo), quindi il limite è **inerte** — nessun cambiamento visibile rispetto al mosaico originale.
- **`--tile-ideale` si ricalcola con la finestra** (è un `calc()` su `100vw`, non un valore fisso), quindi resta coerente a qualunque larghezza desktop, non solo a quella testata.

Nessuna modifica a: proporzioni (`object-fit:cover` invariato), bordo, hover, overlay, lightbox, lazy loading/`decoding="async"`, attributi `width`/`height` da `larghezza_px`/`altezza_px` (PR #4), struttura delle tre categorie, collegamenti rapidi, numerazione, separatori (PR #5).

## 4. Verifiche visive reali eseguite

Con Chromium via Playwright, catalogo di prova con **fotografie di proporzioni diverse** (verticale 900×1400, quadrata 1000×1000, panoramica 1600×700, standard 1200×900) e **quantità diverse per categoria** (Ricami: 1 opera verticale; Fuori di tela: 2 opere, quadrata e panoramica; Paciughi: 5 opere miste, per verificare il mosaico pienamente popolato), su quattro viewport:

| Viewport | Risultato |
|---|---|
| Desktop 1280px | Ricami: 1 foto verticale, 392px di larghezza, centrata. Fuori di tela: 2 foto (quadrata 392×392, panoramica 392×206), stessa larghezza di tassello. Paciughi: mosaico a 3 colonne invariato, stessa larghezza di tassello (392px) delle altre due categorie. |
| Desktop ampio 1920px | Stessa disposizione, tassello scalato coerentemente a 605px in tutte e tre le categorie (nessuna differenza fra poche/molte opere). |
| Tablet 768px | 1-2 colonne secondo il breakpoint esistente, tassello 354px coerente fra le tre categorie. |
| Smartphone 390px | 1 colonna piena larghezza in tutte e tre le categorie, invariato rispetto a sempre. |

Screenshot inviati separatamente per la revisione (desktop, desktop ampio, tablet, mobile): confermano fotografie inserite armoniosamente nel mosaico, proporzioni naturali rispettate (nessun ritaglio anomalo), dimensioni equilibrate e coerenti fra le tre categorie e fra scenari con poche/molte opere, nessuna fotografia ridotta a miniatura né ingrandita a piena pagina.

## 5. Vincolo fondamentale: componenti esterni alla galleria

**Non è stato necessario modificare alcun componente esterno alla galleria.** La correzione è contenuta interamente nelle regole CSS `.gallery`/`.gallery-item` già introdotte dalla PR #6; nessuna modifica a navigazione, CMS, Supabase, database, upload o altre sezioni della homepage.

## 6. Test automatici

**`scripts/check-homepage-categorie.js` aggiornato — 46/46 superati** (28 di PR #5 + 18 di PR #6/#7, di cui 10 riscritte per riflettere il comportamento corretto):
- con una sola opera per categoria: la galleria usa 1 colonna (niente colonne vuote); l'immagine **non** riempie più l'intera larghezza della galleria; è comunque di dimensione ragionevole (non una miniatura); è centrata simmetricamente; rispetta le proporzioni reali della foto di prova (4:3);
- le tre categorie, con una sola opera ciascuna, mostrano fotografie della **stessa identica dimensione** (coerenza del mosaico fra sezioni diverse);
- con 5 opere in una categoria: il mosaico a 3 colonne resta quello originale, con la **stessa** dimensione di tassello misurata nello scenario a 1 sola opera (nessuna discontinuità visiva fra categorie sparse e popolate).

**Verificato che i nuovi controlli intercettano davvero la regressione**: ripristinando temporaneamente il codice della PR #6 (prima di questa correzione), il controllo "l'immagine NON riempie l'intera larghezza della galleria" fallisce correttamente; con la correzione applicata torna verde.

**Nessuna regressione nelle suite esistenti**, tutte rieseguite dopo la modifica:

| Suite | Risultato |
|---|---|
| `node --test` | 46/46 ✅ |
| `./test/run-rls-tests.sh` | ✅ (non toccato da questo fix) |
| `node scripts/check-admin-ui.js` | 59/59 ✅ |
| `node scripts/check-mobile.js` | 81/81 ✅ |
| `node scripts/check-performance.js` | invariato: CLS -100%, nessuna differenza di comportamento mobile (`--tile-ideale:none` sotto i 540px) |
| `node scripts/check-homepage-categorie.js` | 46/46 ✅ |
| `node scripts/build.js` | ✅ |

## 7. Diff Git — nessuna modifica estranea alla galleria

```
 index.html                          | 26 +++++++++++++++++---------
 scripts/check-homepage-categorie.js | 70 +++++++++++++++++++++++++------------
```

In `index.html` il diff tocca **esclusivamente** le regole `.gallery`/`.gallery-item` (base e nei due `@media`) e i relativi commenti: nessuna riga di JavaScript, nessun'altra regola CSS, nessun markup HTML modificato. Verificato leggendo l'intero diff prima di concludere.

## 8. Cosa richiede verifica manuale

- **Il sito pubblicato davvero**: questa correzione non è ancora in produzione finché la PR non viene mergiata.
- **Browser reali non emulati**: nessun dispositivo fisico disponibile in questo ambiente, WebKit non installato; tutte le verifiche sono con Chromium (reale) a viewport desktop/tablet/smartphone emulati.
- `calc()` con `var()` e `min()` nel valore di `column-count`/`max-width` richiede un browser moderno (Chromium/Firefox/Safari recenti) — stesso livello di compatibilità già richiesto dalla PR #6, nessun nuovo requisito.
