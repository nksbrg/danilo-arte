# Migrazione a Supabase — ILO | Fuori di Tela

Stato: **codice completo sul branch `claude/supabase-migration`, non collegato a nessun progetto Supabase reale, non mergiato su `main`, non in produzione.** Il sito pubblico e `/admin` (Decap CMS) continuano a funzionare esattamente come oggi: questa migrazione non li disattiva né li modifica.

## 1. Architettura

```text
/pannello (NUOVO — proprietario, Supabase)      /admin (ESISTENTE — Decap CMS, invariato)
   │                                                │
   ├── Supabase Auth (email+password + MFA TOTP)    └── Decap Turbo + Cloudinary
   ├── Supabase Postgres (tabella opere, RLS)
   └── Supabase Storage (bucket "opere")
            │
            ▼
   pubblico (PostgREST, lettura via RLS)
            │
            ▼
   index.html → fetch Supabase REST
                se non configurato/non risponde → fetch /data/opere.json
                (catalogo statico esistente, generato da scripts/build.js:
                 invariato, è la rete di sicurezza per il rollback)
```

Niente Notion (già rimosso in una fase precedente), niente Netlify Function nuova: Supabase Storage accetta upload autenticati direttamente dal browser, protetti dalle policy RLS — non serve firmare nulla lato server.

## 2. File creati o modificati

| File | Cosa fa |
|---|---|
| `supabase/migrations/0001_opere.sql` | Tabella `opere`, vincoli, indice, trigger `updated_at`, GRANT |
| `supabase/migrations/0002_admin_auth_helpers.sql` | Tabella `admins` (whitelist), funzioni `is_admin()`, `has_mfa()`, `is_verified_admin()`, `mio_stato_admin()` |
| `supabase/migrations/0003_opere_rls.sql` | Policy RLS sulla tabella `opere` |
| `supabase/migrations/0004_storage_opere.sql` | Bucket Storage `opere` + policy |
| `supabase/tests/_shim_supabase_auth.sql` | Emulazione minima di `auth`/`storage` per testare le policy su Postgres "nudo" |
| `supabase/tests/rls.sql` | 14 asserzioni reali contro le policy (vedi §5) |
| `test/run-rls-tests.sh` | Esegue il test SQL sopra end-to-end |
| `pannello/index.html`, `app.js`, `validazione.js`, `style.css` | Nuovo pannello amministrativo |
| `scripts/migrate-to-supabase.js` | Inventario + migrazione (vedi §6) |
| `test/validazione.test.js` | Test della validazione file (tipo/dimensione/HEIC) |
| `test/migrate-to-supabase.test.js` | Test della classificazione per la migrazione |
| `scripts/build.js` | Copia `pannello/` in `dist/`, genera `dist/supabase-config.js` |
| `test/build.test.js` | +3 test su `contenutoConfigSupabase` |
| `index.html` | `caricaOpere()` prova prima Supabase, poi il catalogo statico (invariato) |
| `netlify.toml` | CSP dedicata a `/pannello/*`; `connect-src` del sito pubblico esteso a Supabase |

Nulla di quanto già esistente (Decap, Cloudinary, `content/opere/*.json`, le opere di test) è stato eliminato o modificato nei dati.

## 3. Variabili d'ambiente da configurare su Netlify

| Nome | Dove si usa | Segreta? |
|---|---|---|
| `SUPABASE_URL` | Build (`scripts/build.js` → `dist/supabase-config.js`), sito pubblico, pannello | No — è l'indirizzo del progetto |
| `SUPABASE_PUBLISHABLE_KEY` | Come sopra | No, per progettazione di Supabase: protetta dalle policy RLS, non dalla segretezza |

**Nessuna** `service_role key` va su Netlify: serve solo per `scripts/migrate-to-supabase.js --esegui`, eseguito a mano da un computer, mai committata, mai nel sito.

Se queste due variabili mancano, `scripts/build.js` **non fallisce**: scrive un `supabase-config.js` vuoto, il sito pubblico resta sul catalogo statico e il pannello mostra "Configurazione mancante" invece di un errore JavaScript (verificato, vedi §5).

## 4. Database: cosa fa ogni pezzo e perché

- **`public.opere`**: una riga = un'opera visibile. Non esiste uno stato "bozza/pubblicata": è la scelta di prodotto richiesta ("ogni opera salvata è automaticamente visibile"). Se in futuro servisse una bozza, si aggiunge una colonna, senza toccare le policy esistenti.
- **`public.admins`**: whitelist amministrativa, **scrivibile solo con la service_role key**, mai dal client. Non usiamo `user_metadata` (modificabile dall'utente stesso) né il semplice ruolo `authenticated`, come esplicitamente richiesto.
- **`is_admin()`**: l'utente è nella whitelist?
- **`has_mfa()`**: la sessione corrente ha completato la verifica a due fattori (`aal2`)? Letto dal JWT della sessione, non da un flag "ha attivato l'MFA prima o poi".
- **`is_verified_admin()`**: `is_admin() AND has_mfa()`. È la condizione di **ogni** policy di scrittura su `opere` e su `storage.objects`. Un amministratore che non ha ancora attivato l'MFA non può scrivere nulla, nemmeno per errore.
- **`mio_stato_admin()`**: espone solo lo stato dell'utente che chiama (mai il contenuto di `admins`), per mostrare messaggi corretti nel pannello invece di un errore generico del database.

### Creare un amministratore

Dopo aver creato l'utente in Supabase Auth (dashboard → Authentication → Users → Invite), nella SQL Editor del progetto:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'indirizzo@esempio.ch';
```

Poi l'utente deve attivare l'MFA al primo accesso al pannello (il pannello lo richiede automaticamente, vedi `pannello/app.js`, `renderAttivazioneMfa`).

## 5. Test eseguiti per davvero in questo ambiente

**Database / RLS — eseguiti contro un vero PostgreSQL locale** (non un vero progetto Supabase: niente GoTrue, niente MFA reale; `auth.uid()`/`auth.jwt()` sono state riprodotte fedelmente secondo la documentazione Supabase in `supabase/tests/_shim_supabase_auth.sql`). Comando: `./test/run-rls-tests.sh`. **14/14 superati**, tra cui:
- anonimo legge le opere, non può scrivere;
- utente autenticato ma non in whitelist non può scrivere;
- amministratore in whitelist ma **senza** sessione MFA (`aal1`) non può scrivere;
- amministratore con sessione MFA (`aal2`) può inserire/modificare/eliminare;
- stessi controlli sul bucket Storage;
- ordinamento deterministico a parità di "ordine";
- `mio_stato_admin()` riflette correttamente whitelist+MFA.

Un bug reale è stato trovato e corretto durante questo collaudo: mancavano i `GRANT` a livello di tabella (su un progetto Supabase vero sono impostati dalla piattaforma; nella migrazione li ho resi espliciti — vedi commento in `0001_opere.sql`).

**Logica pura — Node, `node --test`, 27/27 superati**: validazione file (tipo MIME, dimensione, HEIC, nomi ingannevoli tipo `virus.jpg` con MIME eseguibile), classificazione della migrazione (bozza/nascosta/archiviata mai incluse automaticamente, rilevamento duplicati), generazione di `supabase-config.js` (incluso un test che verifica che un valore con virgolette non possa "rompere" fuori dalla stringa JavaScript generata).

**Browser reale (Playwright), sito servito da `dist/`**:
- sito pubblico senza Supabase configurato → usa il catalogo statico, galleria e mosaico corretti, zero errori;
- pannello senza configurazione → messaggio "Configurazione mancante" in italiano, nessun crash visibile (bug trovato e corretto: una doppia dichiarazione globale di `escapeHtml` tra `validazione.js` e `app.js` mandava in errore l'intera pagina — risolto incapsulando `validazione.js` in una IIFE);
- pannello con configurazione presente ma libreria Supabase non raggiungibile (il CDN non è accessibile da questo sandbox) → messaggio "Impossibile caricare il pannello" in italiano invece di un errore silenzioso in console (bug trovato e corretto allo stesso modo: controllo esplicito di `window.supabase` prima dell'uso).

**Build**: `node scripts/build.js` eseguito più volte, `dist/` verificata con `find`/`ls`: contiene esattamente i file pubblici attesi, incluso il nuovo `pannello/` e `supabase-config.js`.

## 6. Cosa NON è stato possibile verificare qui (richiede accesso reale)

Questo ambiente di sviluppo non ha accesso a Internet: nessuna delle chiamate verso servizi reali è stata eseguita.

- **Login reale, MFA reale**: le chiamate `supabase.auth.signInWithPassword`, `supabase.auth.mfa.enroll/challenge/verify`, `supabase.auth.resetPasswordForEmail` in `pannello/app.js` sono scritte secondo l'API documentata di `@supabase/supabase-js` v2 così come la conosco, ma **non eseguite contro un progetto reale**. Da collaudare appena esistono credenziali.
- **Upload reale su Storage**: la logica è scritta e la *validazione* è testata, ma nessun file è mai stato davvero caricato su un bucket Supabase.
- **La libreria Supabase via CDN**: `pannello/index.html` carica `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` (il pattern che la documentazione ufficiale consiglia per l'uso diretto da `<script>`, senza bundler). Non è stato possibile raggiungere questo URL da qui per confermarlo dal vivo, né verificare quale sia l'ultima versione pubblicata (ho trovato indizi di versioni intorno alla 2.11x/2.118 cercando online, ma nessuna fonte affidabile al 100%): verificarlo al primo collaudo reale, e se si preferisce una versione fissa invece di "@2", sostituirla dopo aver controllato npmjs.com/package/@supabase/supabase-js.
- **CSP di `/pannello/*`**: scritta per includere esattamente gli host necessari (jsDelivr, il progetto Supabase), ma mai osservata da un browser reale. Primo collaudo: aprire `/pannello`, controllare la console per blocchi CSP.
- **Migrazione reale** (`scripts/migrate-to-supabase.js --esegui`): la parte di rete (download da Cloudinary, upload su Storage, insert nella tabella) non è mai stata eseguita. Solo la classificazione (quali opere migrare, quali richiedono una decisione, duplicati sospetti) è testata.
- **HEIC**: il pannello rifiuta le foto HEIC con un messaggio esplicativo invece di tentare una conversione (vedi `pannello/validazione.js`). Non è stata implementata una conversione automatica (richiederebbe una libreria WASM non verificabile in questo ambiente): da valutare come miglioramento futuro se Danilo usa davvero spesso foto HEIC da iPhone senza cambiare le impostazioni della fotocamera.
- **Smartphone reale**: il CSS è responsive e il pannello è stato pensato per funzionare a schermi stretti, ma non è stato aperto su un dispositivo reale.
- **`supabase.auth.mfa.getAuthenticatorAssuranceLevel()` e la UMD build esatta**: scritte secondo l'API v2 che conosco; verificare che la versione effettivamente caricata le esponga allo stesso modo.

## 7. Procedura di migrazione dei dati

```bash
# 1. Solo inventario (nessuna scrittura, si può eseguire quante volte si vuole)
node scripts/migrate-to-supabase.js
```

Il report distingue:
- opere pronte per la migrazione automatica (stato `pubblicata` o senza campo `stato`);
- opere che richiedono una **decisione esplicita** (`bozza`, `nascosta`, `archiviata` — mai migrate di default, come richiesto);
- opere senza immagine (non migrabili così come sono);
- possibili duplicati (stesso titolo e anno).

```bash
# 2. Migrazione reale, solo le pubblicate (serve service_role key, MAI committata)
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
node scripts/migrate-to-supabase.js --esegui

# Per includere ANCHE bozze/nascoste/archiviate, esplicitamente:
node scripts/migrate-to-supabase.js --esegui --includi-bozza --includi-nascosta
```

Lo script non modifica né elimina mai `content/opere/*.json`, non tocca Cloudinary. Dopo la migrazione, confrontare manualmente il numero di opere migrate con l'inventario e controllare a campione che le foto corrispondano (nessun controllo automatico sostituisce questo confronto, come richiesto).

## 8. Transizione e cutover

1. Creare il progetto Supabase, applicare le 4 migrazioni (SQL Editor o CLI), creare l'amministratore (§4).
2. Impostare `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` su un **deploy di anteprima** Netlify (non quello di produzione) e collaudare `/pannello` dal vivo: login, MFA, aggiunta/modifica/eliminazione di un'opera di prova.
3. Eseguire la migrazione reale (§7) verso lo stesso progetto.
4. Confrontare il catalogo pubblico Supabase con `data/opere.json` (conteggio, titoli, immagini).
5. Solo a questo punto, impostare le stesse variabili d'ambiente sul sito di **produzione** e fare deploy: da quel momento `index.html` userà Supabase (il catalogo statico resta come rollback automatico se Supabase non risponde).
6. **Questo passaggio — impostare le variabili d'ambiente in produzione — è il "momento esatto" del cutover**: va registrato (data/ora, chi l'ha fatto) in un commit o in un messaggio a chi gestisce il sito.
7. Decap CMS resta attivo finché non si è certi che il nuovo pannello funzioni: disattivarlo (rimuovere `/admin` da `dist/` in `scripts/build.js`, disinstallare la Decap Turbo GitHub App) è un passo **successivo e separato**, da fare solo a collaudo completato — per evitare di avere due sistemi di scrittura attivi (Decap che scrive `content/opere/*.json` e il pannello che scrive su Supabase) più a lungo del necessario.

### Rollback

Rimuovere (o svuotare) `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` su Netlify e fare un nuovo deploy: il sito torna immediatamente al catalogo statico `data/opere.json`, generato da Decap come oggi. Nessuna modifica di codice necessaria.

## 9. Limiti noti

- Niente conversione automatica HEIC→JPEG (vedi §6).
- `mio_stato_admin()` e i messaggi del pannello aiutano l'esperienza d'uso ma **non sono** il meccanismo di sicurezza: quello sono le policy RLS, testate in §5.
- La CSP di `/pannello/*` e la versione di `supabase-js` vanno confermate al primo collaudo reale (§6).
- Non è stato implementato un meccanismo di "immagini ottimizzate per il web" (ridimensionamento/conversione automatica lato server): Supabase Storage serve il file originale. Se servisse, Supabase offre trasformazioni immagine on-the-fly lato Storage (da verificare se disponibili sul piano del progetto) come miglioramento futuro, non incluso qui per non introdurre una dipendenza non verificabile in questo ambiente.
