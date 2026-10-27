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
- **Nessun filtro, nessuna correzione automatica del colore**: il modulo si limita a decodificare, ridimensionare e ricomprimere. Le fotografie già entro 2400px non vengono MAI toccate, quindi il loro profilo colore originale è preservato byte-per-byte. Per le fotografie più grandi, dalla revisione del 2026-10-27 (vedi §9) è stato aggiunto un controllo conservativo: un JPEG con un profilo colore ICC incorporato non chiaramente identificabile come sRGB (es. Display P3, molto comune su iPhone; Adobe RGB) **non viene ridimensionato né ricompresso**, per evitare il rischio di perdita di saturazione che una conversione tramite `<canvas>` (il cui backing store è sRGB per specifica) comporterebbe sui colori più saturi dell'originale. Dettagli tecnici completi, limiti dichiarati dell'euristica usata e perché non si può affermare "nessuna modifica di colore" in modo assoluto: vedi §9.
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
- Dalla revisione del 2026-10-27 (§9), le fotografie JPEG di grandi dimensioni con un profilo colore non chiaramente sRGB non vengono più ridimensionate (si veda §2 e §9 per il meccanismo e i suoi limiti dichiarati): il rischio di perdita di fedeltà cromatica per questo caso specifico è stato quindi eliminato, a costo di un file più pesante per quelle foto. Resta un rischio residuo **basso** per PNG/WebP di grandi dimensioni con un profilo colore esteso (il controllo è implementato solo per JPEG, vedi §9) e per l'euristica stessa, che si basa sulla ricerca di byte noti e non su un parser ICC completo.
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

## 9. Revisione del 2026-10-27 (PR #4): race condition e fedeltà cromatica

Revisione richiesta prima del merge, su due punti specifici. Entrambi sono stati verificati come problemi reali (non ipotetici) e corretti; nessuna modifica al design, all'autenticazione, alle policy RLS o alla MFA. Nessuna migrazione applicata al Supabase di produzione.

### 9.1 Race condition nella selezione delle fotografie — confermata parzialmente, corretta

Lo scenario descritto (foto A selezionata, poi foto B prima che A finisca, B termina prima di A) **era già protetto correttamente** dal contatore di generazione introdotto nella prima versione di `admin/app.js`: il risultato tardivo di A non sovrascriveva mai B. Verificato con un test che impone questo identico ordine di arrivo in modo deterministico (non affidato al timing reale di canvas, vedi §9.3).

Sono stati però trovati e corretti tre problemi reali più sottili, non coperti dalla versione precedente:

1. **Doppia elaborazione e possibile incoerenza anteprima/upload**: se l'amministratore premeva "Salva" mentre l'elaborazione della foto era ancora in corso, il gestore di invio avviava un **secondo** calcolo indipendente (`elaborazioneCorrente || await elaboraImmagine(file)`), anziché attendere quello già in corso. Risultato: lavoro duplicato e, in teoria, un'anteprima e un file caricato calcolati da due chiamate separate (stesso file sorgente, ma non garantito essere byte-per-byte la stessa elaborazione). **Corretto**: ora esiste un'unica promise di elaborazione per selezione (`elaborazionePromise`), condivisa tra l'anteprima e il salvataggio — il file caricato è sempre, garantito, lo stesso oggetto risultato mostrato (o in corso di calcolo) in anteprima.
2. **Nessuna gestione di un eventuale fallimento dell'elaborazione**: né il listener di selezione né il gestore di invio avevano un `try/catch` attorno alla chiamata a `elaboraImmagine()`. Pur non essendoci oggi un percorso noto che la fa fallire (il modulo gestisce già i propri errori internamente), un'eccezione imprevista avrebbe lasciato il pulsante "Salva" disabilitato permanentemente e prodotto un errore JavaScript non gestito. **Corretto**: un `try/catch` di difesa ripiega sempre su `{ blob: file, ridimensionata: false, ... }` (il file originale) se succede l'imprevisto.
3. **Possibile scrittura su un modulo già chiuso**: se l'amministratore selezionava una foto, annullava il modulo prima che l'elaborazione finisse, e riapriva subito un nuovo modulo "Aggiungi opera" (stessi `id` nel DOM), il risultato tardivo della selezione precedente poteva, in teoria, scrivere nell'anteprima del modulo NUOVO. **Corretto**: gli elementi DOM dell'anteprima/messaggio sono ora catturati una sola volta all'apertura del modulo (non più ri-letti con `document.getElementById` dentro il codice asincrono); un modulo chiuso scrive solo su nodi ormai staccati dal documento, senza alcun effetto visibile e senza errori.

Verificato anche: selezione ripetuta/rapidissima di 8 file in sequenza (nessun errore JavaScript, l'interfaccia riflette solo l'ultima selezione); salvataggio con elaborazione fallita (il salvataggio riesce comunque, ripiegando sul file originale); modifica di un'opera esistente con sostituzione della foto (il payload di update contiene il nuovo percorso e le nuove dimensioni, coerenti tra loro, e la vecchia foto viene rimossa da Storage solo dopo che l'update è andato a buon fine).

### 9.2 Fedeltà cromatica — analisi e comportamento conservativo aggiunto

**Cosa è garantito dalle API, cosa dipende dal browser** (vedi anche il commento esteso in testa a `admin/elaborazione-immagine.js`):
- Un `<canvas>` 2D creato con `getContext("2d")` (senza l'opzione `colorSpace:"display-p3"`, non usata qui) ha per specifica un backing store **sRGB**. Questo è garantito dalle specifiche attuali, non un dettaglio implementativo.
- Quando `drawImage()` disegna una sorgente sRGB, non c'è conversione significativa (sostanzialmente un'identità, a parte il normale arrotondamento di quantizzazione JPEG). Questo copre la grande maggioranza delle fotografie reali.
- Quando `drawImage()` disegna una sorgente con un profilo più ampio di sRGB (Display P3, molto comune nelle foto di un iPhone; Adobe RGB, più raro), i browser aggiornati (Chrome/Firefox/Safari recenti) eseguono una conversione **color-managed corretta**: i colori già dentro sRGB restano invariati, quelli più saturi vengono compressi sul bordo della gamma sRGB (gamut mapping). **Non è stato possibile verificare questo comportamento su ogni versione/motore browser**: è quanto previsto dalle specifiche correnti, non una garanzia assoluta su qualunque browser Danilo potesse usare.
- Il file ricompresso da `canvas.toBlob()` non porta con sé un profilo ICC esplicito per un profilo wide-gamut: è un file sRGB semplice. Non c'è quindi un "profilo sbagliato" nel file di uscita, ma una possibile perdita di saturazione nei colori più estremi dell'originale, se questo era più ampio di sRGB.
- **Non affermiamo che "nessuna modifica di colore" sia garantita in modo assoluto** per le fotografie che vengono effettivamente ridimensionate: è una cosa che, con le sole API del browser, non è dimostrabile con certezza matematica per ogni possibile browser e ogni possibile immagine.

**Decisione presa, con le sole API native del browser, senza servizi esterni**: prima di ridimensionare un JPEG (il formato dominante per le foto da fotocamera/telefono), il codice cerca nei byte del file un segmento JPEG APP2 con marcatore `ICC_PROFILE`. Se presente e la stringa "sRGB" non vi compare (cercata sia in ASCII semplice sia in UTF-16BE, la codifica usata dal tag ICC `mluc` per le descrizioni testuali — vedi sotto), la fotografia **non viene ridimensionata né ricompressa**: viene caricata invariata, a piena risoluzione, con il suo profilo colore originale intatto qualunque esso sia. Un JPEG senza alcun profilo ICC incorporato è considerato sRGB per convenzione universale del web (comportamento invariato per la stragrande maggioranza delle foto). **Limite dichiarato esplicitamente**: questo controllo è implementato solo per JPEG, non per PNG/WebP (meno comuni come formato di una fotocamera in questo contesto), per restare nei limiti di complessità richiesti; e si basa sulla ricerca di sequenze di byte note, non su un parser ICC completo — un profilo che dichiari "sRGB" nella propria descrizione pur non essendolo byte-per-byte identico allo standard non verrebbe rilevato come "esteso" (caso non realistico in pratica, ma non escludibile in teoria).

**Bug reale trovato e corretto durante la verifica con un browser reale** (non con sola lettura del codice):
1. Un JPEG generato da `canvas.toBlob()` in Chromium incorpora di serie un vero profilo sRGB, la cui descrizione testuale è codificata nel tag ICC `mluc` come **UTF-16BE** (un byte `0x00` prima di ogni carattere: `\0s\0R\0G\0B`, non `sRGB` in ASCII semplice). La prima versione della ricerca, solo ASCII, non la trovava: ogni fotografia (anche quelle generate dal browser stesso, certamente sRGB) veniva quindi erroneamente considerata "a profilo esteso" e MAI ridimensionata — un falso positivo che avrebbe vanificato l'intera ottimizzazione per la stragrande maggioranza delle foto reali. **Corretto** aggiungendo una ricerca equivalente in UTF-16BE.
2. La ricerca della stringa "sRGB" non era delimitata alla lunghezza dichiarata del segmento JPEG che contiene il marcatore, ma proseguiva fino alla fine del file. Con un file che contiene (per qualunque motivo) più di un profilo ICC, o anche solo per una coincidenza statisticamente rara nei dati binari compressi di una fotografia di diversi MB, questo poteva portare a concludere erroneamente che il profilo fosse sRGB quando non lo era (il caso opposto, più pericoloso, del punto precedente: un vero falso negativo che avrebbe fatto ridimensionare una foto a profilo esteso). **Corretto** delimitando la ricerca alla lunghezza dichiarata nei 2 byte che precedono il marcatore (struttura standard di un segmento JPEG `FF E2 <lunghezza> ICC_PROFILE\0...`).

Entrambi i bug sono stati trovati con un test end-to-end in un browser reale (non erano individuabili dalla sola lettura del codice) e sono ora coperti da test di non-regressione, sia a livello di funzione pura (`node --test`) sia end-to-end (vedi §9.3).

**Comportamento conservativo per profili non gestibili in modo affidabile**: è esattamente quanto sopra — qualunque profilo ICC che non dichiari esplicitamente "sRGB" (in nessuna delle due codifiche cercate) blocca il ridimensionamento per quella foto, a prescindere da quale sia il profilo reale. Non si tenta di distinguere Display P3 da Adobe RGB da qualunque altro profilo: "non sRGB o non determinabile" è trattato in un unico modo, il più prudente.

**Non è stato possibile verificare**: la resa visiva/colorimetrica reale di una fotografia wide-gamut autentica su uno schermo a gamma estesa (questo ambiente è headless, senza un simile dispositivo); è stato verificato con certezza il meccanismo di rilevamento ed esclusione dal ridimensionamento (con un file JPEG reale contenente un marcatore ICC non-sRGB costruito ad hoc), non la fedeltà percettiva finale su un display reale.

### 9.3 Test aggiunti e risultati

- **`node --test`**: 46/46 superati (31 preesistenti + 15 nuovi: 9 sul rilevamento del profilo colore incluso il caso UTF-16BE e il caso del limite di lunghezza del segmento, 6 di supporto).
- **`./test/run-rls-tests.sh`**: invariato, 16 RLS + 2 hardening + 1 vincolo dimensioni, tutti superati (nessuna modifica in quest'area).
- **`node scripts/check-admin-ui.js`** (Chromium reale): **42/42 superati** (20 preesistenti + 22 nuovi), tra cui:
  - race condition riprodotta con un ordine di completamento **deterministico** (non affidato al timing reale di canvas): un modulo di elaborazione sostitutivo (`test-mock-elaborazione-controllata.js`, usato solo nei test) permette di far terminare volutamente la foto selezionata per prima DOPO quella selezionata per seconda, e verificare che l'interfaccia e i dati salvati riflettano sempre e solo la seconda;
  - elaborazione che fallisce (simulata): il salvataggio riesce comunque;
  - selezione rapidissima di 8 file in sequenza: nessun errore JavaScript;
  - profilo colore esteso, con la **pipeline reale** (canvas + createImageBitmap, non mockata): un JPEG 4800×3200 reale con un segmento ICC "Display P3" costruito a mano non viene ridimensionato, il file caricato è byte-per-byte identico all'originale, le dimensioni salvate sono quelle originali;
  - modifica di un'opera esistente con sostituzione della foto: nuovo percorso e nuove dimensioni coerenti nel payload di update, vecchia foto rimossa da Storage dopo il successo dell'update.
- **`node scripts/check-mobile.js`**: invariato, 81/81 superati (nessuna modifica all'interfaccia visibile).
- **`node scripts/check-performance.js`**: invariato nei risultati (nessuna modifica al meccanismo `larghezza_px`/`altezza_px`).
- **Galleria pubblica**: verificata funzionante (nessuna modifica a `index.html` in questa revisione); copertura via `scripts/check-mobile.js`, che naviga ed esercita la galleria pubblica reale ad ogni esecuzione.
- `node scripts/build.js`: eseguita con successo, nessun nuovo avviso.

Come richiesto esplicitamente: **non è stato considerato sufficiente che il codice compilasse** — entrambi i bug della sezione 9.2 (falso positivo UTF-16BE e falso negativo del limite di lunghezza) sono stati trovati eseguendo per davvero il codice in un browser, non leggendo il sorgente.
