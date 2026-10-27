# Correzione definitiva: fotografie deformate/ritagliate nella galleria

Branch `claude/fix-aspect-ratio-galleria`, creato dall'ultimo commit di `main` (che include già le PR #4, #5, #6 e #7). **Non mergiato su `main`.**

Risolve il problema segnalato dopo le PR #6 e #7: le fotografie delle opere apparivano ancora "eccessivamente alte e strette, come strisce verticali" sul sito pubblicato, nonostante le due correzioni precedenti. Un vecchio `index.html` è stato fornito come riferimento storico **solo per confronto**: non è stato copiato, ripristinato né usato per sostituire alcun file. Nessuna modifica a CMS, Supabase, database, categorie, navigazione o altre sezioni della homepage.

## 1. Perché le PR #6 e #7 non bastavano

Entrambe le correzioni precedenti intervenivano **esclusivamente** su `.gallery` e `.gallery-item` (numero di colonne, larghezza massima del tassello). Nessuna delle due ha mai toccato `.gallery-item img`, cioè la regola che determina **l'altezza** della singola fotografia. Il problema segnalato era lì, non nel numero di colonne — da cui l'istruzione esplicita di non dare per scontato che la causa fosse quella.

## 2. La causa reale (misurata, non assunta)

Codice precedente:

```css
.gallery-item img { width:100%; display:block; transition:transform 0.4s; min-height:200px; object-fit:cover; }
```

```js
// creaElementoGalleria(op), solo se l'opera ha larghezza_px/altezza_px (PR #4):
img.width = op.larghezzaPx;
img.height = op.altezzaPx;
```

Impostare `img.height = altezzaPx` equivale a scrivere l'attributo HTML `height="<altezzaPx>"` sull'`<img>`. Il foglio di stile dello user agent mappa quell'attributo a un'altezza CSS **in pixel letterali** (es. `height:1600px`), non a un rapporto d'aspetto. La regola `.gallery-item img` sovrascrive **solo** `width` (`width:100%`): non avendo mai specificato `height`, quell'altezza letterale in pixel resta pienamente in vigore.

Risultato: un'opera con `altezza_px` di, ad esempio, 1600px (dimensione tipica di un file già ridimensionato da `admin/elaborazione-immagine.js` al lato lungo di 2400px) veniva renderizzata con un tassello **largo quanto la colonna del mosaico** (poche centinaia di pixel, per via di PR #6/#7) **ma alto 1600px letterali**, un riquadro grottescamente sproporzionato. `object-fit:cover` riempiva quel riquadro ritagliando pesantemente l'immagine — da cui l'aspetto "a strisce verticali" con soggetti visibilmente tagliati, confermato nello screenshot fornito (giraffa con le zampe tagliate, figura della ballerina ritagliata, ecc.).

**Verificato con Playwright, prima di modificare qualunque codice**, misurando `naturalWidth`/`naturalHeight` contro `getBoundingClientRect()` su immagini di prova di proporzioni reali diverse (orizzontale 16:9, verticale 9:16, quadrata, panoramica 3:1), tutte con `larghezza_px`/`altezza_px` dichiarate come le opere reali:

| Opera (codice precedente) | Dichiarata | naturale (decodificata) | **renderizzata** | rapporto renderizzato vs naturale | Scarto |
|---|---|---|---|---|---|
| Landscape | 1600×900 | 1600×900 (1.778) | 386×**900** | 0.429 | **75.9%** |
| Portrait | 900×1600 | 900×1600 (0.563) | 386×**1600** | 0.241 | **57.1%** |
| Square | 1200×1200 | 1200×1200 (1.000) | 386×**1200** | 0.322 | **67.8%** |
| Panoramic | 1800×600 | 1800×600 (3.000) | 386×**600** | 0.643 | **78.6%** |

In ogni caso l'altezza renderizzata coincide **esattamente** con il valore dichiarato in pixel (900, 1600, 1200, 600), indipendentemente dalla larghezza reale del tassello — prova diretta del meccanismo descritto sopra, non un'ipotesi.

**Checklist richiesta, risposte verificate**:
1. **`naturalWidth`/`naturalHeight`**: corrette, il browser decodifica le fotografie senza alterarle (confermato per tutte le proporzioni di prova).
2. **Attributi HTML `width`/`height` vs dimensioni reali**: quando presenti, corrispondono — l'errore non è nei valori dichiarati ma in come la galleria li applica (vedi punto precedente).
3. **Regole CSS**: la causa è qui — `.gallery-item img` non sovrascriveva `height`, lasciando vigente l'altezza letterale in pixel dell'attributo HTML; `min-height:200px` e `object-fit:cover` erano sintomi aggravanti (il ritaglio), non la causa primaria.
4. **Interazione con PR #6/#7**: le due correzioni, riducendo la larghezza del tassello, hanno reso il mismatch larghezza-stretta/altezza-letterale-enorme ancora più evidente (prima di PR #6/#7, con `columns:3` fisso, il problema esisteva comunque ma era mascherato da colonne più larghe in media).
5. **Supabase**: le immagini originali non sono alterate — l'intera distorsione avviene nel browser, lato rendering CSS. `admin/elaborazione-immagine.js` ridimensiona sempre entrambe le dimensioni con lo stesso fattore (`calcolaDimensioniRidotte`), non può introdurre un cambio di proporzioni.

## 3. La correzione

```css
.gallery-item img { width:100%; height:auto; display:block; transition:transform 0.4s; object-fit:contain; }
```

- **`height:auto`** (la vera correzione): sovrascrive l'altezza letterale in pixel dell'attributo HTML. Con `width:100%` esplicito e `height:auto` esplicito, il browser usa la regola moderna `aspect-ratio: attr(width) / attr(height) auto` del proprio foglio di stile per calcolare l'altezza in proporzione alla larghezza reale del tassello — e, una volta che l'immagine è caricata, la parola chiave `auto` fa sì che il browser preferisca il rapporto **naturale reale** dell'immagine decodificata a quello dichiarato, se i due non coincidessero esattamente (rete di sicurezza aggiuntiva contro un eventuale valore `larghezza_px`/`altezza_px` non più fedele al file). Le opere senza quegli attributi (caricate prima della PR #4) erano già corrette: senza attributo `height`, l'altezza era già `auto` di default.
- **Rimosso `min-height:200px`**: un minimo forzato è incompatibile con "nessuna deformazione" — con `height:auto` funzionante, un'opera panoramica stretta può legittimamente avere un'altezza renderizzata inferiore a 200px (è la sua proporzione reale) senza che nulla la forzi più in alto.
- **`object-fit:cover` → `object-fit:contain`**: con `height:auto` il riquadro combacia già esattamente con le proporzioni dell'immagine, quindi `object-fit` non ha più nulla da ritagliare in condizioni normali; resta come garanzia che, in un caso limite (es. `larghezza_px`/`altezza_px` storicamente salvate in modo errato per una singola opera), l'immagine venga mostrata **per intero** (con eventuale lettera-boxing) anziché ritagliata.

Nessuna modifica a `.gallery`/`.gallery-item` (colonne, `--tile-ideale`, centratura — tutto invariato da PR #6/#7), a bordo, hover, overlay, lightbox, `loading="lazy"`/`decoding="async"`, struttura delle tre categorie, collegamenti rapidi, CMS, Supabase.

## 4. Verifiche dopo la correzione

Stessa misurazione di prima (immagini di proporzioni reali diverse, con e senza `larghezza_px`/`altezza_px` dichiarate, incluso un caso di mismatch deliberato dichiarato-vs-file-reale), desktop 1280px e mobile 390px:

| Opera | naturale | **renderizzata (dopo)** | Scarto |
|---|---|---|---|
| Landscape 16:9 | 1600×900 | 386×217.1 | **0.0%** |
| Portrait 9:16 | 900×1600 | 386×686.2 | **0.0%** |
| Square 1:1 | 1200×1200 | 386×386.0 | **0.0%** |
| Panoramic 3:1 | 1800×600 | 386×128.7 | **0.0%** |
| Senza attributi width/height | 900×1600 | 386×686.2 | **0.0%** |
| **Mismatch** (dichiarata 1600×900, file reale 900×1600) | 900×1600 | 386×686.2 | **0.0%** (il browser usa il rapporto reale, non quello dichiarato errato) |

Stessi risultati, 0.0% di scarto su tutte le righe, alla larghezza mobile (390px).

Confermato visivamente con screenshot reali (desktop e mobile, inviati separatamente): la sezione "Ricami" mostra una foto verticale intera, "Fuori di tela" una quadrata e una panoramica affiancate nelle rispettive proporzioni, "Paciughi" fotografie orizzontali — nessun soggetto tagliato, nessuna fotografia stirata, mosaico armonioso con proporzioni diverse che convivono naturalmente, esattamente come richiesto.

## 5. Test automatici

**Nuove fotografie di prova committate** in `assets/test-opere/` (reali file JPEG, non placeholder): `opera-prova-4.jpg` (900×1350, verticale), `opera-prova-5.jpg` (1600×600, panoramica), `opera-prova-6.jpg` (1000×1000, quadrata) — le tre esistenti (`opera-prova-1/2/3.jpg`) erano tutte 1200×900 (4:3), non sufficientemente varie per questo tipo di verifica.

**Nuovi controlli in `scripts/check-homepage-categorie.js`** (14 aggiunti, 60/60 totali superati): per ciascuna di 5 opere di proporzioni esplicitamente diverse (verticale, quadrata, panoramica, orizzontale, e una senza `larghezza_px`/`altezza_px`), su desktop e mobile:
- il rapporto `naturalWidth/naturalHeight` coincide con il rapporto di `getBoundingClientRect()` entro il 2% di tolleranza (non il 5% usato nei controlli precedenti sulla singola proporzione 4:3: qui si verifica la fedeltà assoluta, non solo l'assenza di un minimo forzato);
- le opere di proporzioni diverse hanno altezze di tassello **diverse fra loro** (prova che non esiste più un'altezza uniformata, come un `min-height` residuo farebbe).

Questi controlli sono distinti da quelli di PR #6/#7 (colonne vuote, tassello "a tutta pagina"): verificano la **fedeltà delle proporzioni**, non il numero di colonne.

**Verificato che i nuovi controlli intercettano davvero la regressione**: ripristinando temporaneamente `min-height:200px`/`object-fit:cover` senza `height:auto` (il codice delle PR #6/#7), il primo controllo fallisce immediatamente:
```
FALLITO: desktop, "Verticale": il rapporto d'aspetto renderizzato (0.286) coincide con quello intrinseco naturalWidth/naturalHeight (0.667) [...]
```
Ripristinata la correzione, tutti i 60 controlli tornano verdi.

**Nessuna regressione nelle suite esistenti**, tutte rieseguite dopo la modifica:

| Suite | Risultato |
|---|---|
| `node --test` | 46/46 ✅ |
| `./test/run-rls-tests.sh` | ✅ (non toccato da questo fix) |
| `node scripts/check-admin-ui.js` | 59/59 ✅ |
| `node scripts/check-mobile.js` | 81/81 ✅ |
| `node scripts/check-performance.js` | CLS invariato: -100% (la riserva di spazio via `aspect-ratio` da `width`/`height` continua a funzionare con `height:auto`, non è stata disattivata) |
| `node scripts/check-homepage-categorie.js` | 60/60 ✅ (46 preesistenti + 14 nuovi) |
| `node scripts/build.js` | ✅ |

## 6. Diff — nessuna modifica estranea alla galleria

```
 index.html                          | 14 +++++++++++++-
 scripts/check-homepage-categorie.js | 81 ++++++++++++++++++++++++++++++++++
 assets/test-opere/opera-prova-4.jpg | nuovo file (fotografia di prova, verticale)
 assets/test-opere/opera-prova-5.jpg | nuovo file (fotografia di prova, panoramica)
 assets/test-opere/opera-prova-6.jpg | nuovo file (fotografia di prova, quadrata)
```

In `index.html` il diff tocca **esclusivamente** la singola regola `.gallery-item img` (una riga di codice, più un commento che ne spiega il motivo). Nessuna riga di JavaScript, nessun'altra regola CSS, nessun markup HTML, nessun file CMS/Supabase modificato. Verificato leggendo l'intero diff prima di concludere (`git diff --stat`, `git status`).

## 7. Cosa richiede verifica manuale

- **Il sito pubblicato davvero**: questa correzione non è ancora in produzione finché la PR non viene mergiata. Dopo il merge, confrontare la homepage reale con lo screenshot del problema originale.
- **Le opere realmente esistenti su Supabase**: non avendo accesso ai dati di produzione, questa correzione è stata verificata con fotografie di prova dalle proporzioni deliberatamente varie (incluso un caso di mismatch dichiarato/reale) per coprire lo scenario generale; il meccanismo della correzione (`height:auto` + `object-fit:contain`) è indipendente dai valori specifici di `larghezza_px`/`altezza_px` di ciascuna opera reale.
- **Browser reali non emulati**: nessun dispositivo fisico disponibile in questo ambiente, WebKit non installato; tutte le verifiche sono con Chromium (reale) a viewport desktop/smartphone emulati. `aspect-ratio: attr() auto` è supportato da Chromium/Edge recenti; Firefox e Safari supportano la stessa risoluzione `width`/`height` → rapporto d'aspetto da tempo (è il meccanismo standard raccomandato per prevenire il CLS), quindi nessun nuovo requisito di compatibilità rispetto a quanto già richiesto dalla PR #4.
