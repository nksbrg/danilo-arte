"use strict";

/**
 * Ridimensionamento e compressione delle fotografie PRIMA dell'upload su
 * Supabase Storage. Obiettivo: evitare di caricare fotografie fotocamera a
 * piena risoluzione (spesso 4000+ px di lato, diversi MB) quando il sito le
 * mostra al massimo a larghezza di viewport — senza mai tagliare, deformare
 * o alterare i colori dell'opera.
 *
 * Principi (vedi anche il vincolo "fedeltà cromatica" nella richiesta):
 * - Si ridimensiona SOLO se il lato lungo supera LATO_MASSIMO_PX: una foto
 *   già ragionevole non viene mai ricompressa, per non introdurre perdita
 *   di qualità senza un beneficio reale.
 * - Mai ritaglio: il ridimensionamento mantiene sempre le proporzioni
 *   originali (scala uniforme sui due lati).
 * - Stesso formato in uscita di quello in ingresso (JPEG→JPEG, PNG→PNG,
 *   WebP→WebP): non si introduce una conversione di formato non richiesta
 *   (es. PNG con trasparenza che diventerebbe JPEG).
 * - Qualità alta (0.92) quando si ricomprime: bilancia la riduzione di peso
 *   con una perdita visiva minima. Non è una "compressione aggressiva".
 * - Se qualunque cosa va storta (API non disponibile, errore di
 *   decodifica), si ripiega SEMPRE sul file originale, invariato: nessuna
 *   foto fallisce l'upload a causa di questo modulo.
 *
 * Nota sulla fedeltà cromatica (spazio colore/profilo ICC), verificata e
 * documentata onestamente, senza affermazioni assolute non dimostrabili:
 *
 * - Un `<canvas>` 2D standard (senza l'opzione `colorSpace:"display-p3"`,
 *   non usata qui) ha per specifica un backing store sRGB. Quando
 *   `drawImage()` disegna una sorgente con un profilo ICC più ampio di
 *   sRGB (es. Display P3, molto comune nelle foto scattate con iPhone;
 *   Adobe RGB, più raro ma possibile da fotocamere/editor), i browser
 *   moderni applicano una conversione color-managed corretta (non
 *   un'alterazione arbitraria): i colori già dentro la gamma sRGB restano
 *   invariati, mentre quelli più saturi di sRGB vengono "compressi" sul
 *   bordo della gamma sRGB (gamut mapping). Per un'opera d'arte con colori
 *   molto saturi, questo può essere una perdita visibile, anche se non una
 *   conversione "sbagliata" o casuale.
 * - Questo comportamento è quello previsto dalle specifiche nei browser
 *   moderni (Chrome/Firefox/Safari aggiornati); non è stato possibile
 *   verificarlo su ogni versione/motore browser che Danilo potrebbe usare
 *   per caricare le opere, quindi non va considerato garantito al 100% in
 *   ogni ambiente.
 * - Il file ricompresso da `canvas.toBlob()` non porta con sé un profilo
 *   ICC esplicito: è semplicemente un file sRGB (coerente con i pixel già
 *   convertiti da drawImage). Non c'è quindi un problema di "profilo
 *   sbagliato nel file di uscita", ma un'eventuale perdita di saturazione
 *   nei colori più estremi dell'originale, se questo era più ampio di sRGB.
 *
 * Comportamento CONSERVATIVO adottato per restare nei limiti di
 * complessità richiesti (solo API native, nessuna libreria, nessun
 * sistema di color management completo): prima di ridimensionare un JPEG
 * (il formato di gran lunga più comune per le fotografie da fotocamera/
 * telefono), si cerca nei byte del file un marcatore di profilo ICC
 * incorporato (segmento JPEG APP2 "ICC_PROFILE"). Se presente e la parola
 * "sRGB" NON compare nei byte del profilo, il profilo è considerato "non
 * riconosciuto in modo affidabile come sRGB" (può essere Display P3, Adobe
 * RGB, o qualunque altro profilo) e la fotografia NON viene ridimensionata
 * né ricompressa: viene caricata invariata, a piena risoluzione e con il
 * suo profilo ICC originale intatto, qualunque esso sia — a costo di un
 * file più pesante, mai di una possibile perdita di fedeltà cromatica.
 * Un file JPEG senza alcun profilo ICC incorporato è, per convenzione
 * universale del web, considerato sRGB (comportamento invariato, nessun
 * impatto sulla maggioranza delle fotografie). Per PNG e WebP (formati
 * meno comuni per fotografie da fotocamera in questo contesto) questo
 * controllo non è implementato, per non introdurre un'analisi del formato
 * PNG (profilo ICC compresso nel chunk `iCCP`, più complesso da leggere):
 * resta il limite preesistente, documentato come rischio residuo.
 */
(function (esporta) {
  const LATO_MASSIMO_PX = 2400;
  const QUALITA_JPEG = 0.92;
  const QUALITA_WEBP = 0.92;

  /**
   * Calcola le dimensioni scalate (sempre con le stesse proporzioni)
   * affinché il lato più lungo non superi latoMassimo. Se l'immagine è già
   * entro il limite, restituisce le dimensioni originali invariate.
   * Funzione pura, senza dipendenze dal browser: testabile con node:test.
   */
  function calcolaDimensioniRidotte(larghezza, altezza, latoMassimo = LATO_MASSIMO_PX) {
    const latoLungo = Math.max(larghezza, altezza);
    if (latoLungo <= latoMassimo) {
      return { larghezza, altezza, ridimensionata: false };
    }
    const fattore = latoMassimo / latoLungo;
    return {
      larghezza: Math.max(1, Math.round(larghezza * fattore)),
      altezza: Math.max(1, Math.round(altezza * fattore)),
      ridimensionata: true,
    };
  }

  function qualitaPer(mimeType) {
    if (mimeType === "image/jpeg") return QUALITA_JPEG;
    if (mimeType === "image/webp") return QUALITA_WEBP;
    return undefined; // image/png: ignorata dal browser, PNG resta senza perdita
  }

  /**
   * Cerca la sottosequenza di byte "ascii" (una stringa solo ASCII) dentro
   * "haystack" (un Uint8Array), a partire da "inizio". Restituisce l'indice
   * della prima occorrenza o -1. Funzione pura, usata per individuare
   * marcatori binari (es. "ICC_PROFILE", "sRGB") senza decodificare l'intero
   * file come testo (più robusto e più leggero su file binari grandi).
   */
  function trovaSottosequenzaBytes(haystack, ascii, inizio = 0) {
    const bytesCercati = [];
    for (let i = 0; i < ascii.length; i++) bytesCercati.push(ascii.charCodeAt(i));
    const ultimoInizioPossibile = haystack.length - bytesCercati.length;
    for (let i = Math.max(0, inizio); i <= ultimoInizioPossibile; i++) {
      let trovato = true;
      for (let j = 0; j < bytesCercati.length; j++) {
        if (haystack[i + j] !== bytesCercati[j]) { trovato = false; break; }
      }
      if (trovato) return i;
    }
    return -1;
  }

  /**
   * Come trovaSottosequenzaBytes, ma cerca "ascii" codificato UTF-16BE (un
   * byte 0x00 prima di ogni carattere): è così che il tag 'mluc' (multi
   * localized unicode), lo standard ICC v4 per le descrizioni testuali dei
   * profili, codifica il testo — confermato osservando byte per byte il
   * profilo sRGB che Chromium incorpora davvero nei JPEG generati da
   * <canvas>, dove "sRGB" compare come "\0s\0R\0G\0B", non come testo ASCII
   * semplice. Senza questo controllo, un normalissimo profilo sRGB verrebbe
   * scambiato per un profilo "non riconosciuto" (falso positivo verificato
   * con un browser reale durante questa verifica).
   */
  function trovaTestoUtf16BE(haystack, ascii, inizio = 0) {
    const bytesCercati = [];
    for (let i = 0; i < ascii.length; i++) { bytesCercati.push(0, ascii.charCodeAt(i)); }
    const ultimoInizioPossibile = haystack.length - bytesCercati.length;
    for (let i = Math.max(0, inizio); i <= ultimoInizioPossibile; i++) {
      let trovato = true;
      for (let j = 0; j < bytesCercati.length; j++) {
        if (haystack[i + j] !== bytesCercati[j]) { trovato = false; break; }
      }
      if (trovato) return i;
    }
    return -1;
  }

  /**
   * Rileva, con un'euristica volutamente semplice (vedi commento in testa al
   * file), se un JPEG porta un profilo colore ICC incorporato che non è
   * chiaramente sRGB. Non analizza la vera e propria tabella dei tag ICC
   * (evitiamo un parser completo del formato ICC, fuori scopo qui): cerca
   * solo il marcatore del profilo e, al suo interno, la stringa "sRGB", sia
   * in ASCII semplice sia in UTF-16BE (tag 'mluc', vedi trovaTestoUtf16BE).
   * Restituisce true per "meglio essere prudenti" ogni volta che un profilo
   * è presente ma non chiaramente identificabile come sRGB.
   */
  function haProfiloColoreNonStandard(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const posizioneMarcatore = trovaSottosequenzaBytes(bytes, "ICC_PROFILE");
    if (posizioneMarcatore === -1) return false; // nessun profilo: per convenzione, sRGB

    // Delimita la ricerca di "sRGB" al segmento JPEG APP2 che contiene
    // QUESTO marcatore, non al resto del file (che include anche i dati
    // binari dell'immagine compressa): senza questo limite, su un file
    // reale di diversi MB la ricerca sarebbe lenta (scansione di tutto il
    // file) e, più grave, potrebbe imbattersi per puro caso nella sequenza
    // di byte "sRGB" nei dati binari compressi, concludendo erroneamente
    // che il profilo È sRGB. Un segmento JPEG standard è strutturato come
    // "FF E2 <lunghezza, 2 byte big-endian> ICC_PROFILE\0 ...": i 2 byte
    // subito prima del marcatore dichiarano la lunghezza del segmento
    // (lunghezza stessa inclusa).
    let fineSegmento = bytes.length;
    if (posizioneMarcatore >= 2) {
      const lunghezzaDichiarata = (bytes[posizioneMarcatore - 2] << 8) | bytes[posizioneMarcatore - 1];
      if (lunghezzaDichiarata >= 2) {
        fineSegmento = Math.min(bytes.length, posizioneMarcatore - 2 + lunghezzaDichiarata);
      }
    }
    const finestra = bytes.subarray(posizioneMarcatore, fineSegmento);
    const sRgbAscii = trovaSottosequenzaBytes(finestra, "sRGB");
    const sRgbUtf16 = trovaTestoUtf16BE(finestra, "sRGB");
    return sRgbAscii === -1 && sRgbUtf16 === -1;
  }

  /**
   * Elabora un File immagine per l'upload. Restituisce sempre:
   *   { blob, larghezza, altezza, ridimensionata }
   * "blob" è il File originale, invariato, se non serve (o non è possibile)
   * ridimensionare: in quel caso "ridimensionata" è false e nessuna
   * ricompressione ha avuto luogo.
   *
   * Richiede createImageBitmap (con imageOrientation: "from-image", per
   * applicare correttamente la rotazione EXIF delle foto scattate con il
   * telefono prima di disegnarle sul canvas — altrimenti un ridimensiona-
   * mento potrebbe "perdere" l'orientamento corretto). Se l'API non è
   * disponibile nel browser, si ripiega sul file originale.
   */
  async function elaboraImmagine(file, opzioni = {}) {
    const latoMassimo = opzioni.latoMassimo || LATO_MASSIMO_PX;

    if (typeof createImageBitmap !== "function") {
      return { blob: file, larghezza: null, altezza: null, ridimensionata: false, profiloColoreEsteso: false };
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_) {
      // File non decodificabile come immagine dal browser (non dovrebbe
      // succedere, visto che validaFile() ha già controllato il tipo MIME):
      // meglio lasciare che sia Supabase Storage a rifiutarlo con un
      // errore chiaro, piuttosto che bloccare qui il caricamento.
      return { blob: file, larghezza: null, altezza: null, ridimensionata: false, profiloColoreEsteso: false };
    }

    const dimensioniOriginali = { larghezza: bitmap.width, altezza: bitmap.height };
    const dimensioni = calcolaDimensioniRidotte(bitmap.width, bitmap.height, latoMassimo);

    if (!dimensioni.ridimensionata) {
      bitmap.close();
      return { blob: file, larghezza: dimensioniOriginali.larghezza, altezza: dimensioniOriginali.altezza, ridimensionata: false, profiloColoreEsteso: false };
    }

    // Vedi commento in testa al file: per un JPEG con un profilo colore non
    // chiaramente sRGB (es. Display P3, molto comune su iPhone), si evita
    // deliberatamente il passaggio da canvas (che potrebbe comprimere i
    // colori più saturi nella gamma sRGB) e si carica l'originale intatto.
    if (file.type === "image/jpeg") {
      let profiloEsteso = false;
      try {
        profiloEsteso = haProfiloColoreNonStandard(await file.arrayBuffer());
      } catch (_) {
        // Lettura del file non riuscita per qualche motivo: non blocchiamo
        // il ridimensionamento per questo soltanto, trattandolo come se
        // non fosse stato trovato alcun profilo esteso (comportamento
        // preesistente, invariato in caso di dubbio su questo controllo).
      }
      if (profiloEsteso) {
        bitmap.close();
        return { blob: file, larghezza: dimensioniOriginali.larghezza, altezza: dimensioniOriginali.altezza, ridimensionata: false, profiloColoreEsteso: true };
      }
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = dimensioni.larghezza;
      canvas.height = dimensioni.altezza;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, dimensioni.larghezza, dimensioni.altezza);
      bitmap.close();

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob ha restituito null"))),
          file.type,
          qualitaPer(file.type)
        );
      });

      return { blob, larghezza: dimensioni.larghezza, altezza: dimensioni.altezza, ridimensionata: true, profiloColoreEsteso: false };
    } catch (_) {
      // Il ridimensionamento è fallito per qualche motivo: meglio caricare
      // l'originale a piena risoluzione che bloccare la pubblicazione
      // dell'opera.
      return { blob: file, larghezza: dimensioniOriginali.larghezza, altezza: dimensioniOriginali.altezza, ridimensionata: false, profiloColoreEsteso: false };
    }
  }

  esporta({ LATO_MASSIMO_PX, calcolaDimensioniRidotte, elaboraImmagine, haProfiloColoreNonStandard, trovaSottosequenzaBytes, trovaTestoUtf16BE });
})(function (api) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.ElaborazioneImmagine = api;
  }
});
