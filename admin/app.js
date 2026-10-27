"use strict";

/**
 * Pannello amministrativo proprietario — Supabase Auth + Postgres + Storage.
 *
 * Le chiamate all'SDK Supabase JS v2 (supabase.auth.mfa.*, supabase.storage.*,
 * supabase.from(...)) sono scritte secondo l'API documentata v2 così come la
 * conosco, ma NON è stato possibile eseguirle contro un vero progetto
 * Supabase in questo ambiente (nessun accesso a Internet nel sandbox di
 * sviluppo). Vedi README-SUPABASE.md, sezione "Cosa resta da verificare",
 * prima di considerare questo pannello collaudato end-to-end.
 *
 * La sicurezza vera non dipende da questo file: ogni scrittura è comunque
 * filtrata dalle policy RLS lato database (supabase/migrations/), che SONO
 * state testate con query reali (vedi supabase/tests/). Questo codice esiste
 * per l'esperienza d'uso, non per l'autorizzazione.
 */

const BUCKET = "opere";
const { escapeHtml, validaFile, estensioneDa } = window.Validazione;

const app = document.getElementById("app");

function mostraErroreConfigurazione() {
  app.innerHTML = `
    <div class="card">
      <h1>Configurazione mancante</h1>
      <p class="messaggio errore">
        Il pannello non è collegato a nessun progetto Supabase
        (mancano le variabili d'ambiente SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY
        su Netlify). Vedi README-SUPABASE.md.
      </p>
    </div>`;
}

function mostraErroreLibreria() {
  app.innerHTML = `
    <div class="card">
      <h1>Impossibile caricare il pannello</h1>
      <p class="messaggio errore">
        La libreria Supabase non si è caricata (problema di rete o il
        servizio che la distribuisce non è raggiungibile). Controlla la tua
        connessione e ricarica la pagina.
      </p>
    </div>`;
}

if (!window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) {
  mostraErroreConfigurazione();
  throw new Error("Configurazione Supabase mancante");
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  mostraErroreLibreria();
  throw new Error("Libreria Supabase non disponibile (CDN non raggiungibile?)");
}

const supabase = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_PUBLISHABLE_KEY
);

// ---------------------------------------------------------------------
// Utility di rendering generiche
// ---------------------------------------------------------------------

function renderMessaggio(tipo, testo) {
  return `<p class="messaggio ${tipo}">${escapeHtml(testo)}</p>`;
}

function messaggioErroreSupabase(error) {
  if (!error) return "Errore sconosciuto.";
  // Non esponiamo mai error.details/hint grezzi (potrebbero contenere
  // dettagli interni del database): solo il messaggio, già pensato da
  // Supabase per essere mostrato.
  return error.message || "Si è verificato un errore. Riprova.";
}

// I link di invito e recupero password aprono una sessione temporanea.
// Non mandiamo l'utente direttamente al pannello MFA prima che abbia scelto
// una password personale. Il flag viene catturato prima che l'SDK pulisca l'URL.
let cambioPasswordRichiesto = /(?:^|[&#])type=(?:invite|recovery)(?:&|$)/.test(window.location.hash)
  || new URLSearchParams(window.location.search).get("type") === "recovery";
let cambioPasswordInCorso = false;

function renderNuovaPassword(messaggio) {
  app.innerHTML = `
    <h1>Imposta la tua password</h1>
    <div class="card">
      <p>Scegli una password per accedere alla gestione delle opere.</p>
      ${messaggio ? renderMessaggio(messaggio.tipo, messaggio.testo) : ""}
      <form id="form-nuova-password">
        <label for="nuova-password">Nuova password (almeno 12 caratteri)</label>
        <input type="password" id="nuova-password" minlength="12" required autocomplete="new-password">
        <label for="conferma-password">Conferma password</label>
        <input type="password" id="conferma-password" minlength="12" required autocomplete="new-password">
        <p style="margin-top:16px;"><button type="submit">Salva password</button></p>
      </form>
    </div>`;
  document.getElementById("form-nuova-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (cambioPasswordInCorso) return;
    const password = document.getElementById("nuova-password").value;
    const conferma = document.getElementById("conferma-password").value;
    if (password !== conferma) {
      renderNuovaPassword({ tipo: "errore", testo: "Le password non coincidono." });
      return;
    }
    cambioPasswordInCorso = true;
    const { error } = await supabase.auth.updateUser({ password });
    cambioPasswordInCorso = false;
    if (error) {
      renderNuovaPassword({ tipo: "errore", testo: messaggioErroreSupabase(error) });
      return;
    }
    cambioPasswordRichiesto = false;
    // Il link non deve rimanere nella cronologia dopo l'attivazione.
    window.history.replaceState(null, "", "/admin/");
    await instradaDopoLogin();
  });
}

// ---------------------------------------------------------------------
// Avvio: capiamo lo stato di autenticazione corrente
// ---------------------------------------------------------------------

async function avvia() {
  app.innerHTML = "Verifica dell'accesso in corso…";
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    app.innerHTML = renderMessaggio("errore", messaggioErroreSupabase(error));
    return;
  }
  if (!session) {
    renderLogin();
    return;
  }
  await instradaDopoLogin();
}

supabase.auth.onAuthStateChange((evento, _sessione) => {\n  if (evento === "PASSWORD_RECOVERY") cambioPasswordRichiesto = true;
  // Ad ogni cambio di sessione (login, logout, refresh) ricalcoliamo la
  // schermata corretta da zero, invece di tentare aggiornamenti parziali.
  avvia();
});

avvia();

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------

function renderLogin(messaggio) {
  app.innerHTML = `
    <h1>Gestione opere</h1>
    <div class="card">
      <form id="form-login">
        ${messaggio ? renderMessaggio(messaggio.tipo, messaggio.testo) : ""}
        <label for="email">Email</label>
        <input type="email" id="email" required autocomplete="username">
        <label for="password">Password</label>
        <input type="password" id="password" required autocomplete="current-password">
        <p style="margin-top:16px;">
          <button type="submit">Accedi</button>
        </p>
      </form>
      <p><a href="#" id="link-recupero">Password dimenticata?</a></p>
    </div>
  `;

  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const bottone = e.target.querySelector("button");
    bottone.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    bottone.disabled = false;
    if (error) {
      renderLogin({ tipo: "errore", testo: "Accesso non riuscito: email o password non corrette." });
      return;
    }
    // onAuthStateChange si occupa del resto (MFA, dashboard).
  });

  document.getElementById("link-recupero").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = (document.getElementById("email").value || "").trim();
    if (!email) {
      renderLogin({ tipo: "errore", testo: "Inserisci prima la tua email, poi clicca di nuovo su \"Password dimenticata?\"." });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/admin/",
    });
    renderLogin(
      error
        ? { tipo: "errore", testo: messaggioErroreSupabase(error) }
        : { tipo: "successo", testo: "Se l'indirizzo è registrato, riceverai a breve un'email per reimpostare la password." }
    );
  });
}

// ---------------------------------------------------------------------
// Instradamento dopo il login: serve attivare/verificare l'MFA?
// ---------------------------------------------------------------------

async function instradaDopoLogin() {
  app.innerHTML = "Verifica dell'autenticazione a due fattori…";

  const { data: aal, error: erroreAal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (erroreAal) {
    app.innerHTML = renderMessaggio("errore", messaggioErroreSupabase(erroreAal));
    return;
  }

  if (aal.currentLevel === "aal2") {
    renderDashboard();
    return;
  }

  const { data: fattori, error: erroreFattori } = await supabase.auth.mfa.listFactors();
  if (erroreFattori) {
    app.innerHTML = renderMessaggio("errore", messaggioErroreSupabase(erroreFattori));
    return;
  }

  const fattoreTotp = (fattori.totp || [])[0];
  if (fattoreTotp) {
    renderSfidaMfa(fattoreTotp.id);
  } else {
    renderAttivazioneMfa();
  }
}

// ---------------------------------------------------------------------
// MFA — attivazione (nessun fattore registrato: obbligatoria)
// ---------------------------------------------------------------------

async function renderAttivazioneMfa() {
  app.innerHTML = `
    <h1>Attiva la verifica in due passaggi</h1>
    <div class="card">
      <p>
        Per gestire le opere è obbligatorio attivare la verifica in due
        passaggi (TOTP), con un'app come Google Authenticator o Authy.
        Questo passaggio va fatto una sola volta.
      </p>
      <div id="riquadro-enroll">Generazione del codice QR…</div>
    </div>
  `;

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  const riquadro = document.getElementById("riquadro-enroll");

  if (error) {
    riquadro.innerHTML = renderMessaggio("errore", messaggioErroreSupabase(error));
    return;
  }

  const factorId = data.id;
  riquadro.innerHTML = `
    <p>1. Inquadra questo codice con la tua app di autenticazione:</p>
    <img src="${data.totp.qr_code}" alt="Codice QR per l'attivazione" style="max-width:200px;">
    <p class="hint">Non riesci a inquadrarlo? Inserisci questo codice a mano: <code>${escapeHtml(data.totp.secret)}</code></p>
    <form id="form-verifica-enroll">
      <label for="codice-enroll">2. Inserisci il codice a 6 cifre mostrato dall'app</label>
      <input type="text" id="codice-enroll" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="one-time-code">
      <p style="margin-top:16px;"><button type="submit">Conferma e attiva</button></p>
      <div id="esito-enroll"></div>
    </form>
  `;

  document.getElementById("form-verifica-enroll").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codice = document.getElementById("codice-enroll").value.trim();
    const esito = document.getElementById("esito-enroll");
    const { data: sfida, error: erroreSfida } = await supabase.auth.mfa.challenge({ factorId });
    if (erroreSfida) {
      esito.innerHTML = renderMessaggio("errore", messaggioErroreSupabase(erroreSfida));
      return;
    }
    const { error: erroreVerifica } = await supabase.auth.mfa.verify({
      factorId, challengeId: sfida.id, code: codice,
    });
    if (erroreVerifica) {
      esito.innerHTML = renderMessaggio("errore", "Codice non corretto. Riprova.");
      return;
    }
    avvia();
  });
}

// ---------------------------------------------------------------------
// MFA — sfida (fattore già registrato, sessione ancora aal1)
// ---------------------------------------------------------------------

function renderSfidaMfa(factorId) {
  app.innerHTML = `
    <h1>Verifica in due passaggi</h1>
    <div class="card">
      <form id="form-sfida-mfa">
        <label for="codice-sfida">Inserisci il codice a 6 cifre dalla tua app di autenticazione</label>
        <input type="text" id="codice-sfida" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="one-time-code">
        <p style="margin-top:16px;"><button type="submit">Conferma</button></p>
        <div id="esito-sfida"></div>
      </form>
      <p><button type="button" class="secondario" id="annulla-sfida">Esci</button></p>
    </div>
  `;

  document.getElementById("annulla-sfida").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  document.getElementById("form-sfida-mfa").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codice = document.getElementById("codice-sfida").value.trim();
    const esito = document.getElementById("esito-sfida");
    const { data: sfida, error: erroreSfida } = await supabase.auth.mfa.challenge({ factorId });
    if (erroreSfida) {
      esito.innerHTML = renderMessaggio("errore", messaggioErroreSupabase(erroreSfida));
      return;
    }
    const { error: erroreVerifica } = await supabase.auth.mfa.verify({
      factorId, challengeId: sfida.id, code: codice,
    });
    if (erroreVerifica) {
      esito.innerHTML = renderMessaggio("errore", "Codice non corretto. Riprova.");
      return;
    }
    avvia();
  });
}

// ---------------------------------------------------------------------
// Dashboard: elenco opere
// ---------------------------------------------------------------------

function urlPubblicoImmagine(imagePath) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(imagePath);
  return data.publicUrl;
}

async function renderDashboard(messaggio) {
  app.innerHTML = `
    <div class="topbar">
      <h1>Le mie opere</h1>
      <button type="button" class="secondario" id="btn-logout">Esci</button>
    </div>
    ${messaggio ? renderMessaggio(messaggio.tipo, messaggio.testo) : ""}
    <div class="card">
      <button type="button" id="btn-aggiungi">+ Aggiungi opera</button>
    </div>
    <div id="elenco-opere" class="card">Caricamento delle opere…</div>
  `;

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
  document.getElementById("btn-aggiungi").addEventListener("click", () => renderFormOpera());

  const { data: opere, error } = await supabase
    .from("opere")
    .select("id, titolo, tecnica, dimensioni, anno, descrizione, ordine, image_path")
    .order("ordine", { ascending: true })
    .order("titolo", { ascending: true });

  const elenco = document.getElementById("elenco-opere");

  if (error) {
    elenco.innerHTML = renderMessaggio("errore", "Impossibile caricare le opere: " + messaggioErroreSupabase(error));
    return;
  }

  if (!opere.length) {
    elenco.innerHTML = "<p>Nessuna opera ancora. Clicca \"Aggiungi opera\" per iniziare.</p>";
    return;
  }

  elenco.innerHTML = opere.map((o) => `
    <div class="opera-riga" data-id="${o.id}">
      <img src="${escapeHtml(urlPubblicoImmagine(o.image_path))}" alt="">
      <div class="info">
        <strong>${escapeHtml(o.titolo)}</strong>
        <span>${escapeHtml([o.anno, o.tecnica].filter(Boolean).join(" · "))}</span>
      </div>
      <div class="azioni">
        <button type="button" class="secondario btn-modifica">Modifica</button>
        <button type="button" class="pericolo btn-elimina">Elimina</button>
      </div>
    </div>
  `).join("");

  elenco.querySelectorAll(".btn-modifica").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".opera-riga").dataset.id;
      const opera = opere.find((o) => String(o.id) === id);
      renderFormOpera(opera);
    });
  });
  elenco.querySelectorAll(".btn-elimina").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".opera-riga").dataset.id;
      const opera = opere.find((o) => String(o.id) === id);
      renderConfermaEliminazione(opera);
    });
  });
}

// ---------------------------------------------------------------------
// Eliminazione con conferma esplicita
// ---------------------------------------------------------------------

function renderConfermaEliminazione(opera) {
  const sfondo = document.createElement("div");
  sfondo.className = "card";
  sfondo.style.cssText = "position:fixed;inset:0;max-width:none;margin:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10;";
  sfondo.innerHTML = `
    <div class="card" style="max-width:400px;">
      <p><strong>Eliminare definitivamente "${escapeHtml(opera.titolo)}"?</strong></p>
      <p class="hint">L'opera sparirà subito dal sito. L'operazione non si può annullare dal pannello.</p>
      <div id="esito-elimina"></div>
      <p style="margin-top:16px;">
        <button type="button" class="pericolo" id="conferma-elimina">Sì, elimina</button>
        <button type="button" class="secondario" id="annulla-elimina">Annulla</button>
      </p>
    </div>
  `;
  document.body.appendChild(sfondo);

  document.getElementById("annulla-elimina").addEventListener("click", () => sfondo.remove());

  document.getElementById("conferma-elimina").addEventListener("click", async () => {
    const bottone = document.getElementById("conferma-elimina");
    bottone.disabled = true;
    const { error } = await supabase.from("opere").delete().eq("id", opera.id);
    if (error) {
      document.getElementById("esito-elimina").innerHTML = renderMessaggio("errore", messaggioErroreSupabase(error));
      bottone.disabled = false;
      return;
    }
    // Pulizia della fotografia associata: best-effort, non blocca l'esito
    // (l'opera è già stata eliminata correttamente anche se questo fallisce).
    await supabase.storage.from(BUCKET).remove([opera.image_path]).catch(() => {});
    sfondo.remove();
    renderDashboard({ tipo: "successo", testo: `"${opera.titolo}" eliminata.` });
  });
}

// ---------------------------------------------------------------------
// Modulo opera: aggiunta / modifica
// ---------------------------------------------------------------------

function renderFormOpera(opera) {
  const inModifica = Boolean(opera);
  app.innerHTML = `
    <h1>${inModifica ? "Modifica opera" : "Aggiungi opera"}</h1>
    <div class="card">
      <form id="form-opera">
        <label for="campo-foto">Fotografia principale ${inModifica ? '<span class="facoltativo">(lascia vuoto per non cambiarla)</span>' : ""}</label>
        <input type="file" id="campo-foto" accept="image/jpeg,image/png,image/webp" ${inModifica ? "" : "required"}>
        <div id="esito-foto"></div>
        ${inModifica ? `<img src="${escapeHtml(urlPubblicoImmagine(opera.image_path))}" class="anteprima-foto" alt="Foto attuale">` : ""}
        <img id="anteprima-nuova-foto" class="anteprima-foto" style="display:none;" alt="Anteprima">

        <label for="campo-titolo">Titolo</label>
        <input type="text" id="campo-titolo" required value="${escapeHtml(opera?.titolo || "")}">

        <label for="campo-tecnica">Tecnica <span class="facoltativo">(facoltativa)</span></label>
        <input type="text" id="campo-tecnica" value="${escapeHtml(opera?.tecnica || "")}">

        <label for="campo-dimensioni">Dimensioni <span class="facoltativo">(facoltative)</span></label>
        <input type="text" id="campo-dimensioni" value="${escapeHtml(opera?.dimensioni || "")}" placeholder="Esempio: 80 × 60 cm">

        <label for="campo-anno">Anno <span class="facoltativo">(facoltativo)</span></label>
        <input type="number" id="campo-anno" value="${opera?.anno ?? ""}">

        <label for="campo-descrizione">Descrizione <span class="facoltativo">(facoltativa)</span></label>
        <textarea id="campo-descrizione">${escapeHtml(opera?.descrizione || "")}</textarea>

        <details class="avanzate">
          <summary>Avanzate</summary>
          <label for="campo-ordine">Ordine di visualizzazione <span class="facoltativo">(facoltativo)</span></label>
          <input type="number" id="campo-ordine" value="${opera?.ordine ?? 0}">
          <p class="hint">Numero più basso = opera mostrata prima nella galleria.</p>
        </details>

        <div id="esito-form"></div>
        <p style="margin-top:16px;">
          <button type="submit" id="btn-salva">Salva</button>
          <button type="button" class="secondario" id="btn-annulla">Annulla</button>
        </p>
      </form>
    </div>
  `;

  document.getElementById("btn-annulla").addEventListener("click", () => renderDashboard());

  const campoFoto = document.getElementById("campo-foto");
  campoFoto.addEventListener("change", () => {
    const esitoFoto = document.getElementById("esito-foto");
    const anteprima = document.getElementById("anteprima-nuova-foto");
    esitoFoto.innerHTML = "";
    anteprima.style.display = "none";
    const file = campoFoto.files[0];
    if (!file) return;
    const erroreValidazione = validaFile(file);
    if (erroreValidazione) {
      esitoFoto.innerHTML = renderMessaggio("errore", erroreValidazione);
      campoFoto.value = "";
      return;
    }
    anteprima.src = URL.createObjectURL(file);
    anteprima.style.display = "block";
  });

  document.getElementById("form-opera").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btnSalva = document.getElementById("btn-salva");
    const esitoForm = document.getElementById("esito-form");
    btnSalva.disabled = true;
    esitoForm.innerHTML = "Salvataggio in corso…";

    const file = campoFoto.files[0] || null;

    const valori = {
      titolo: document.getElementById("campo-titolo").value.trim(),
      tecnica: document.getElementById("campo-tecnica").value.trim() || null,
      dimensioni: document.getElementById("campo-dimensioni").value.trim() || null,
      anno: document.getElementById("campo-anno").value ? Number(document.getElementById("campo-anno").value) : null,
      descrizione: document.getElementById("campo-descrizione").value.trim() || null,
      ordine: document.getElementById("campo-ordine").value ? Number(document.getElementById("campo-ordine").value) : 0,
    };

    let nuovoImagePath = null;
    if (file) {
      nuovoImagePath = `${new Date().getFullYear()}/${crypto.randomUUID()}.${estensioneDa(file)}`;
      const { error: erroreUpload } = await supabase.storage
        .from(BUCKET)
        .upload(nuovoImagePath, file, { contentType: file.type, upsert: false });
      if (erroreUpload) {
        esitoForm.innerHTML = renderMessaggio("errore", "Caricamento della foto non riuscito: " + messaggioErroreSupabase(erroreUpload));
        btnSalva.disabled = false;
        return;
      }
    }

    try {
      if (inModifica) {
        const payload = { ...valori };
        if (nuovoImagePath) payload.image_path = nuovoImagePath;
        const { error } = await supabase.from("opere").update(payload).eq("id", opera.id);
        if (error) throw error;
        if (nuovoImagePath && opera.image_path) {
          // Rimuove la vecchia foto SOLO dopo che il salvataggio è andato a
          // buon fine. Se questa pulizia fallisce non è un problema grave
          // (resta un file non più referenziato): non blocca il salvataggio.
          await supabase.storage.from(BUCKET).remove([opera.image_path]).catch(() => {});
        }
      } else {
        const { error } = await supabase.from("opere").insert({ ...valori, image_path: nuovoImagePath });
        if (error) throw error;
      }
    } catch (error) {
      if (nuovoImagePath) {
        // Il salvataggio nel database è fallito ma la foto era già stata
        // caricata: la rimuoviamo per non lasciare un file orfano.
        await supabase.storage.from(BUCKET).remove([nuovoImagePath]).catch(() => {});
      }
      esitoForm.innerHTML = renderMessaggio("errore", "Salvataggio non riuscito: " + messaggioErroreSupabase(error));
      btnSalva.disabled = false;
      return;
    }

    renderDashboard({ tipo: "successo", testo: inModifica ? "Opera aggiornata." : "Opera pubblicata sul sito." });
  });
}
