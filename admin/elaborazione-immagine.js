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
 * Limite noto: la decodifica tramite canvas converte l'immagine nello
 * spazio colore di lavoro del browser (sRGB). Per fotografie con profilo
 * colore molto più ampio di sRGB (es. Display P3, Adobe RGB) salvate così
 * come sono scattate, questo potrebbe comportare una conversione dello
 * spazio colore. Per questo motivo le immagini che NON superano la soglia
 * di ridimensionamento non vengono MAI toccate (restano byte per byte
 * quelle originali, profilo colore incluso).
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
      return { blob: file, larghezza: null, altezza: null, ridimensionata: false };
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_) {
      // File non decodificabile come immagine dal browser (non dovrebbe
      // succedere, visto che validaFile() ha già controllato il tipo MIME):
      // meglio lasciare che sia Supabase Storage a rifiutarlo con un
      // errore chiaro, piuttosto che bloccare qui il caricamento.
      return { blob: file, larghezza: null, altezza: null, ridimensionata: false };
    }

    const dimensioniOriginali = { larghezza: bitmap.width, altezza: bitmap.height };
    const dimensioni = calcolaDimensioniRidotte(bitmap.width, bitmap.height, latoMassimo);

    if (!dimensioni.ridimensionata) {
      bitmap.close();
      return { blob: file, larghezza: dimensioniOriginali.larghezza, altezza: dimensioniOriginali.altezza, ridimensionata: false };
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

      return { blob, larghezza: dimensioni.larghezza, altezza: dimensioni.altezza, ridimensionata: true };
    } catch (_) {
      // Il ridimensionamento è fallito per qualche motivo: meglio caricare
      // l'originale a piena risoluzione che bloccare la pubblicazione
      // dell'opera.
      return { blob: file, larghezza: dimensioniOriginali.larghezza, altezza: dimensioniOriginali.altezza, ridimensionata: false };
    }
  }

  esporta({ LATO_MASSIMO_PX, calcolaDimensioniRidotte, elaboraImmagine });
})(function (api) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.ElaborazioneImmagine = api;
  }
});
