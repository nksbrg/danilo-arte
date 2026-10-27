# Audit immagini e mobile — ILO | Fuori di Tela

Audit e correzioni sul branch `claude/image-mobile-optimization`. **Non mergiato su `main`.**
Nessuna modifica a design, identità visiva, testi, contenuti artistici, autenticazione, policy RLS o MFA (rimane disattivata). Nessuna fotografia esistente in Supabase Storage è stata sostituita, cancellata o modificata, e **non è necessaria alcuna migrazione delle immagini esistenti** (vedi §3): nessuna conferma da richiedere su questo punto.

Supabase project ID: `izogaoyxrwqtfxfkqcwq`. Questa sessione ha accesso a Internet per la ricerca (vedi §4), ma non al progetto Supabase reale: tutte le verifiche di comportamento sono state eseguite con PostgreSQL locale e con un server HTTP/browser (Chromium via Playwright) locale che emula Supabase REST/Storage. Vedi §6 per cosa è stato verificato per davvero e come.

## 1. Audit del flusso fotografico (CMS → Storage → galleria → lightbox)

Flusso tracciato leggendo `admin/app.js`, `admin/validazione.js`, `index.html` e gli schemi SQL:

1. **Upload CMS**: `validaFile()` (preesistente) controlla tipo MIME (`image/jpeg`, `image/png`, `image/webp`) e peso massimo (10 MB). Nessuna verifica di dimensioni in pixel, nessuna compressione: il file veniva caricato su Storage e servito al pubblico **esattamente come fornito dall'utente**, incluse fotografie scattate con smartphone moderni (spesso 4000–8000 px di lato, diversi MB).
2. **Storage**: bucket `opere`, lettura pubblica, scrittura solo admin (RLS/policy invariate in questo audit).
3. **Galleria pubblica**: `index.html` carica il catalogo via REST e mostra ogni fotografia a piena risoluzione originale in un layout a colonne (mosaico), con `object-fit:cover`. Nessun `width`/`height` dichiarato: il browser non può riservare lo spazio corretto prima del caricamento (causa di layout shift, vedi §5).
4. **Lightbox**: la stessa immagine a piena risoluzione viene semplicemente scalata via CSS (`max-width/max-height`, `object-fit:contain`) per l'ingrandimento — nessun doppio caricamento, nessuna versione separata ad alta risoluzione necessaria perché è già l'originale.

**Problemi individuati:**

| # | Problema | Impatto | Gravità |
|---|---|---|---|
| P1 | Nessun ridimensionamento/compressione all'upload: una fotografia di uno smartphone moderno (es. 4032×3024, alcuni MB) viene servita intera a tutti i visitatori, anche su schermi piccoli | Tempi di caricamento galleria più lunghi, soprattutto su mobile/rete lenta; spreco di banda | Media |
| P2 | Nessun attributo `width`/`height` sulle immagini di galleria: il browser non conosce le proporzioni finché l'immagine non arriva, causando un salto di layout (layout shift) quando la foto si carica | Esperienza visiva instabile durante lo scroll, specialmente su connessioni lente; il contenuto sottostante si sposta | Media (misurato, vedi §5) |
| P3 | Nessuna gestione esplicita dell'orientamento EXIF lato client prima dell'eventuale ridimensionamento: se non gestito correttamente, un ridimensionamento via `<canvas>` può produrre foto ruotate | Rischio di distorsione dell'opera (gravissimo per un portfolio artistico) se non affrontato correttamente nella correzione | Alta (per il rischio, mitigato dalla correzione: vedi §2) |
| P4 | Formati non supportati (es. HEIC, tipico di iPhone) già gestiti da `validaFile()` con un messaggio esplicativo (comportamento preesistente, confermato corretto in questo audit, non una lacuna) | — | — (nessuna azione necessaria) |

Nessun problema trovato nella gestione di lightbox/zoom, nel comportamento desktop, o nell'uso dei permessi di Storage.

## 2. Ottimizzazione implementata

**`admin/elaborazione-immagine.js`** (nuovo): modulo eseguito nel browser dell'amministratore al momento della selezione del file nel modulo "Aggiungi/Modifica opera", **prima** dell'upload:

- Decodifica il file con `createImageBitmap(file, { imageOrientation: "from-image" })` — l'API moderna del browser che applica la rotazione EXIF correttamente durante la decodifica (a differenza di `canvas.drawImage()` da solo, che la ignora). **Verificato con un test reale**: una fotografia 4000×3000 con tag EXIF `Orientation=6` (90°) viene ridimensionata a 1800×2400 (orientamento verticale corretto, non orizzontale), con verifica pixel-per-pixel che conferma una vera rotazione e non uno specchiamento.
- **Nessuna fotografia viene toccata se il lato lungo è già entro 2400px**: in questo caso il file originale viene caricato byte-per-byte invariato (0 differenza, nessuna ricompressione, fedeltà totale) — coerente con il vincolo "evita compressione eccessiva".
- Per fotografie più grandi: ridimensionamento proporzionale (**nessun ritaglio, nessuna alterazione delle proporzioni**) al lato lungo massimo di 2400px (una risoluzione ampiamente sufficiente per la visualizzazione più grande possibile del sito, il lightbox a piena larghezza), poi ricompressione JPEG/WebP a qualità 0.92 (compressione leggera, non "eccessiva": preserva i dettagli).
- **Nessun filtro, nessuna correzione automatica del colore**: il modulo si limita a decodificare, ridimensionare e ricomprimere. Resta una cautela documentata nel codice: la decodifica tramite `<canvas>` converte nello spazio colore di lavoro del browser (sRGB); per fotografie con profilo colore più ampio (Display P3, Adobe RGB) questo potrebbe alterare leggermente la resa rispetto all'originale. **Mitigazione**: le fotografie già entro 2400px — l'uso più comune per opere fotografate con cura — non vengono MAI toccate, quindi il loro profilo colore originale è preservato byte-per-byte. Il trade-off qualità/prestazioni riguarda quindi solo le fotografie insolitamente grandi.
- Se `createImageBitmap` non è disponibile (browser molto datato) o la decodifica fallisce per qualsiasi motivo, il file originale viene caricato invariato: **mai un fallimento silenzioso che blocchi la pubblicazione di un'opera**.
- **Verificato con un test reale nel browser** (Playwright, non solo lettura del codice): fotografia di prova 4800×3200 JPEG qualità 95 → 336.831 byte originali, ridotta a 2400×1600 → 47.332 byte (**-86%**), proporzioni 3:2 invariate; fotografia di prova 800×600 (già sotto soglia) → 0 byte di differenza.

**`supabase/migrations/0007_dimensioni_immagine.sql`** (nuovo): aggiunge due colonne opzionali a `public.opere`, `larghezza_px`/`altezza_px`, popolate dal pannello al momento del salvataggio (mai per le opere esistenti, che restano `NULL`). Usate **solo** per dichiarare `width`/`height` sull'`<img>` della galleria pubblica (riserva dello spazio corretto, risolve P2) — mai per autorizzazione o validazione. Vincolo CHECK che garantisce che le due colonne siano sempre entrambe valorizzate o entrambe `NULL` (mai una sola).

**`index.html`**: la galleria pubblica dichiara `width`/`height` sull'`<img>` quando `larghezza_px`/`altezza_px` sono note (opere caricate dopo questa modifica), e aggiunge `decoding="async"` a tutte le immagini di galleria, mosaico e lightbox (decodifica fuori dal thread principale, non blocca lo scroll). Il lazy loading (`loading="lazy"`) sulle immagini di galleria era **già presente** nel codice esistente — confermato corretto in questo audit, non una modifica.

**Scelta deliberatamente NON fatta**: generare più formati/risoluzioni (es. `srcset` con varianti WebP/AVIF a più dimensioni) lato server. Avrebbe richiesto una funzione edge/servizio esterno a pagamento (fuori dai vincoli), oppure generare le varianti nel browser dell'admin e caricarne più di una per opera (aumento di complessità e di spazio Storage occupato non giustificato dalla scala del sito, un portfolio personale, non un e-commerce). Il ridimensionamento a 2400px lato lungo copre già il caso che conta davvero: le fotografie sovradimensionate di uno smartphone moderno.

## 3. Fotografie esistenti su Supabase Storage

**Nessuna fotografia già presente in Storage viene toccata da questa modifica.** Le colonne `larghezza_px`/`altezza_px` sono opzionali (`NULL` per le opere esistenti) e la galleria pubblica gestisce esplicitamente il caso `NULL` (nessun attributo `width`/`height` dichiarato, comportamento identico a oggi). L'elaborazione lato client (`elaborazione-immagine.js`) si attiva solo quando l'amministratore seleziona una **nuova** fotografia nel modulo di upload — non viene mai eseguita retroattivamente sulle opere esistenti.

**Non è quindi necessaria alcuna migrazione delle fotografie esistenti**, e di conseguenza **non viene richiesta alcuna conferma** su questo punto, come da vincolo esplicito della richiesta originale (che prevedeva di chiedere conferma solo se una migrazione fosse stata necessaria).

## 4. Limiti reali di Supabase Storage e compatibilità

Verificato tramite ricerca web in questa sessione (pagine ufficiali Supabase e fonti indipendenti concordanti; non è stato possibile raggiungere direttamente `supabase.com` da questo ambiente per una citazione diretta della pagina, quindi **da confermare a vista sulla dashboard del progetto reale prima di fare affidamento totale su questi numeri**):

- **Piano Free**: limite per singolo file **50 MB**; quota totale storage file **1 GB**.
- **Piano Pro**: quota totale storage file **100 GB** (oltre soglia, fatturazione a consumo).

Il limite esistente lato CMS (`MAX_BYTES` in `admin/validazione.js`, preesistente, non modificato) è **10 MB per file**, già ampiamente sotto il limite di 50 MB del piano Free. Nessuna fotografia elaborata da questa modifica può quindi mai superare i limiti di Storage, su nessuno dei due piani. **Nessun servizio a pagamento introdotto**: l'intera elaborazione avviene nel browser dell'amministratore con API native (`canvas`, `createImageBitmap`), zero dipendenze nuove.

## 5. Performance — risultati di `scripts/check-performance.js`

Lighthouse non è installabile in questo ambiente di sviluppo (nessun accesso diretto al pacchetto npm/CDN necessario per l'installazione in sandbox). Le misure sotto usano le stesse API del browser che Lighthouse stesso legge (`PerformanceObserver` con `layout-shift`, `getBoundingClientRect`), tramite Chromium reale via Playwright — non sono stime.

**1) Spostamento verticale reale della galleria** (pagina pubblica reale, fotografia volutamente ritardata per rendere osservabile l'effetto):
- Senza `larghezza_px`/`altezza_px` (comportamento di oggi): 206px → 258px dopo il caricamento della foto (**52px di salto**).
- Con `larghezza_px`/`altezza_px` (dopo questa modifica): 906px → 906px (**nessuno spostamento**, spazio corretto fin dal primo render).

**2) Cumulative Layout Shift (CLS)**, misurato con lo stesso `PerformanceObserver` di Lighthouse: **senza** = 0.0054–0.1196 a seconda del tentativo (vedi nota sotto), **con** = 0.0000, costante. **100% di miglioramento** confermato su misure ripetute.

> **Nota tecnica importante, scoperta durante questa verifica**: la galleria reale usa un layout CSS multi-colonna (`columns:`, per l'effetto mosaico). È stato verificato con test isolati che **Chromium non attribuisce correttamente le voci `layout-shift` ai figli di un contenitore multi-colonna**, anche quando lo spostamento è reale e misurabile (misura 1 sopra lo dimostra). La misura 2 è quindi eseguita su un layout di controllo equivalente ma senza `columns`, per dimostrare con il numero CLS standard che il meccanismo funziona davvero; inoltre, per il jitter di schedulazione di questo ambiente sandbox condiviso, il test ripete la misura su 3 tentativi e riporta il valore massimo osservato (un singolo tentativo può non catturare lo scatto per puro timing, ma non può produrre un falso positivo). **Implicazione pratica**: un report Lighthouse/PageSpeed Insights reale su questo sito potrebbe riportare un CLS già basso o nullo per la galleria indipendentemente da questa correzione, proprio per questo limite del motore con i layout a colonne — la misura 1 (spostamento diretto in pixel) resta la prova più affidabile dell'effetto visivo reale, che la correzione comunque elimina.

**Peso delle risorse**: vedi §2 (-86% su una fotografia sovradimensionata di prova, 0% di differenza sulle fotografie già ottimali).

## 6. Risultati effettivi dei test

**`node --test` — 35/35 superati** (27 preesistenti + 8 nuovi per `calcolaDimensioniRidotte`/`elaboraImmagine`, incluso il fallback quando `createImageBitmap` non è disponibile).

**`./test/run-rls-tests.sh` (PostgreSQL locale 16, emulazione fedele di `auth.uid()`/`auth.jwt()`) — 16 test RLS + 2 gruppi di hardening + nuovo test del vincolo `larghezza_px`/`altezza_px`, tutti superati.** Un bug reale è stato trovato e corretto durante questo collaudo: il vincolo CHECK iniziale (`(larghezza_px is null and altezza_px is null) or (larghezza_px > 0 and altezza_px > 0)`) non rifiutava una coppia con un solo valore impostato, per via della semantica di Postgres `valore > 0 AND NULL > 0` → `NULL`, che un CHECK considera superato. Corretto in `(larghezza_px is null) = (altezza_px is null) and (...)`, verificato con un test che inserisce esplicitamente una coppia non valida e conferma il rifiuto.

**`node scripts/check-admin-ui.js` (Chromium reale, pannello admin con mock Supabase) — 20/20 controlli superati**, inclusi 6 nuovi specifici per il ridimensionamento: messaggio di ottimizzazione mostrato, dimensioni corrette riportate (2400×1600), anteprima aggiornata, file effettivamente più piccolo caricato, payload salvato con le dimensioni corrette, nessun errore.

**`node scripts/check-mobile.js` (nuovo, Chromium reale via Playwright, dispositivi EMULATI — vedi nota sotto) — 81/81 controlli superati**, su sito pubblico e pannello admin, a 6 larghezze (iPhone SE 320px, iPhone 13 390px, iPhone 14 Pro Max 430px, Pixel 7 412px, Galaxy S9+ 320px, iPad Mini 768px):
- Nessun overflow orizzontale su nessuna larghezza, né sul sito pubblico né nel pannello.
- Menu hamburger: compare/scompare correttamente sotto i 900px, si apre/chiude con un vero tocco (`page.tap()`), nessun doppio menu.
- Galleria: numero di colonne corretto a ogni breakpoint (540px→1, 900px→2, oltre→3).
- Lightbox: si apre, l'immagine resta sempre dentro lo schermo, un tocco fuori dall'immagine lo chiude.
- Pannello admin: selettore foto, finestra di conferma eliminazione e relativi pulsanti sempre interamente visibili e raggiungibili col dito, a tutte le larghezze testate.
- Zero errori JavaScript in ogni scenario.

**Nessun problema mobile reale è stato trovato**: il design responsive esistente (breakpoint a 540px/900px, menu hamburger, layout del pannello) era già solido. Questo audit lo ha verificato a fondo, non lo ha dovuto correggere.

### Distinzione emulato vs. fisico (richiesta esplicitamente dalla consegna)

**Tutti** i test mobile di questa sessione sono **emulati**: Chromium con viewport, user-agent e `devicePixelRatio` del dispositivo impostati via `playwright.devices`. **Nessun dispositivo fisico è stato usato**, e nessun test "Safari iOS" in questo report è un test WebKit reale: il motore WebKit **non è installato** in questo ambiente (`webkit.launch()` fallisce esplicitamente, verificato), quindi ogni test etichettato "iPhone" usa Chromium con viewport/UA iPhone — **non** il motore di rendering reale di Safari. Da verificare manualmente su un iPhone fisico con Safari e su un Android fisico con Chrome, specialmente per: comportamento della tastiera virtuale nei moduli del pannello, gesture di pizzico-per-zoom nel lightbox (non riproducibile via `page.tap()`), velocità di scroll percepita su hardware reale.

## 7. Rischi residui e cose da verificare a mano

**Media**
- I numeri di limite Storage (§4) vengono da ricerca web, non da una chiamata diretta all'API del progetto reale o alla pagina ufficiale (irraggiungibile da questo ambiente): confermare sulla dashboard Supabase reale prima di fare affidamento totale, specialmente se il piano dovesse cambiare in futuro.
- Il CLS reale della pagina di produzione (col suo layout a colonne effettivo) andrebbe confermato con PageSpeed Insights/Lighthouse su un dominio reale: non è detto che il limite di attribuzione di Chromium osservato in questo ambiente isolato (§5) si manifesti identico in un Chromium di versione diversa o in condizioni di rete reali.

**Bassa**
- Possibile perdita di fedeltà cromatica minima per fotografie con profilo colore più ampio di sRGB (Display P3, Adobe RGB) **solo se più grandi di 2400px di lato lungo** (vedi §2): compromesso esplicito qualità/prestazioni, nella direzione meno invasiva possibile (le fotografie già ottimali non vengono mai toccate).
- La miniatura 64×64 nell'elenco opere del pannello admin carica la stessa immagine a piena risoluzione usata dalla galleria pubblica (comportamento preesistente, non introdotto né corretto in questo audit): impatto trascurabile perché visibile solo all'amministratore, non al pubblico, e non in scala (poche opere per un portfolio personale).
- Nessuna conversione automatica HEIC→JPEG lato pannello: limite preesistente, confermato ma non affrontato in questo audit (già segnalato all'utente con un messaggio chiaro, non un fallimento silenzioso).

**Da verificare manualmente (nessun dispositivo fisico disponibile in questo ambiente)**
- Comportamento reale su Safari iOS (motore WebKit, non emulabile qui) e Chrome Android fisico: gesture di zoom nel lightbox, tastiera virtuale nei moduli, velocità di scroll percepita.
- Un collaudo reale di upload di una fotografia HEIC/HEIF da un iPhone fisico (il test attuale verifica solo che il messaggio di errore compaia, con un file finto del tipo MIME corrispondente).
- Lighthouse/PageSpeed Insights completo contro il sito pubblicato (non eseguibile in questo ambiente, vedi §5).

## 8. File modificati/aggiunti

Nuovi: `admin/elaborazione-immagine.js`, `supabase/migrations/0007_dimensioni_immagine.sql`, `supabase/tests/dimensioni_immagine.sql`, `test/elaborazione-immagine.test.js`, `scripts/check-mobile.js`, `scripts/check-performance.js`, questo file.
Modificati: `admin/app.js` (chiamata all'elaborazione prima dell'upload), `admin/index.html` (nuovo script), `index.html` (`width`/`height`/`decoding` sulla galleria pubblica), `scripts/check-admin-ui.js` (nuovi controlli), `test/run-rls-tests.sh` (nuovo test incluso nella suite).

Nessun file di contenuto, stile generale o identità visiva modificato.
