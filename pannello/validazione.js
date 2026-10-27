"use strict";

/**
 * Logica pura di validazione file e sanitizzazione testo, condivisa tra
 * pannello/app.js (nel browser) e i test automatici (in Node). Nessuna
 * dipendenza da window/document: per questo è testabile con node:test senza
 * un browser o una libreria DOM.
 *
 * Tutto dentro una IIFE: nel browser, più tag <script> classici condividono
 * lo stesso scope lessicale top-level, quindi funzioni/const dichiarate qui
 * "a vista" entrerebbero in conflitto con gli stessi nomi destrutturati da
 * app.js (es. "Identifier 'escapeHtml' has already been declared"). Solo
 * "window.Validazione" viene esposto di proposito.
 */
(function (esporta) {
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const TIPI_AMMESSI = ["image/jpeg", "image/png", "image/webp"];
  const ESTENSIONI_HEIC = [".heic", ".heif"];

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /**
   * Restituisce un messaggio d'errore in italiano se il file non è
   * accettabile, oppure null se può essere caricato. Controlla SOLO ciò che è
   * verificabile lato client (nome, tipo MIME dichiarato dal browser,
   * dimensione) — non è un controllo di sicurezza sufficiente da solo: il
   * contenuto reale viene comunque validato da Supabase Storage tramite
   * allowed_mime_types e file_size_limit sul bucket (vedi migrazione 0004),
   * che è la barriera che conta davvero.
   */
  function validaFile(file) {
    const nome = (file.name || "").toLowerCase();
    if (ESTENSIONI_HEIC.some((ext) => nome.endsWith(ext)) || file.type === "image/heic" || file.type === "image/heif") {
      return "Le foto in formato HEIC (tipico dell'iPhone) non sono ancora supportate. " +
        "Sul telefono: Impostazioni → Fotocamera → Formati → \"Più compatibile\", oppure scegli \"Esporta come JPEG\" durante la condivisione.";
    }
    if (!TIPI_AMMESSI.includes(file.type)) {
      return "Formato non supportato. Usa una foto JPEG, PNG o WebP.";
    }
    if (file.size > MAX_BYTES) {
      return `Il file è troppo grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Il massimo è ${MAX_BYTES / 1024 / 1024} MB.`;
    }
    return null;
  }

  function estensioneDa(file) {
    return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type] || "jpg";
  }

  esporta({ MAX_BYTES, TIPI_AMMESSI, ESTENSIONI_HEIC, escapeHtml, validaFile, estensioneDa });
})(function (api) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.Validazione = api;
  }
});
