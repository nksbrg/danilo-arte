# Security Hardening — ILO | Fuori di Tela

Audit e correzioni sul branch `claude/security-hardening`. **Non mergiato su `main`.**
Nessuna modifica a design, testi, contenuti, URL pubblici, whitelist amministrativa o MFA (rimane disattivata, come richiesto).

Supabase project ID indicato: `izogaoyxrwqtfxfkqcwq`. Questo ambiente di sviluppo non ha accesso a Internet: **nessuna delle verifiche qui descritte è stata eseguita contro il progetto Supabase reale**, salvo dove esplicitamente segnalato come test locale. Vedi §6 per cosa è stato verificato per davvero e come.

## 1. Riepilogo delle vulnerabilità trovate e correzioni

| # | Area | Problema | Gravità | Correzione |
|---|---|---|---|---|
| V1 | Frontend (sito pubblico) | `err.message` inserito via `innerHTML` in `index.html` (XSS riflesso, già identificato) | Media | Sostituito con `createTextNode`/`textContent` (stesso pattern già usato altrove nel file) |
| V2 | Database | `public.rls_auto_enable()` (SECURITY DEFINER, non presente nelle migrazioni del repo) eseguibile da `anon`/`authenticated` | Media | Nuova migrazione `0006`: `REVOKE EXECUTE` da `PUBLIC`/`anon`/`authenticated`; verificato che un event trigger non dipende da questi permessi |
| V3 | Database | `search_path` non fissato su `set_updated_at()` e `has_mfa()` | Bassa | `ALTER FUNCTION ... SET search_path = public, pg_temp` (non tocca corpo/firma) |
| V4 | Auth (UX) | Un utente autenticato ma non in whitelist arrivava alla dashboard (che non può comunque usare, per via delle RLS) invece di un messaggio chiaro | Bassa (UX/difesa in profondità, non un bypass reale) | Nuovo controllo via `mio_stato_admin()` prima di renderizzare la dashboard; schermata "Accesso non autorizzato" con pulsante di uscita |
| V5 | Auth (concorrenza) | `onAuthStateChange` poteva innescare chiamate concorrenti a `avvia()` che si risolvono fuori ordine (es. all'avvio pagina, o durante l'impostazione password), lasciando la UI in uno stato non coerente con la sessione reale | Bassa | Contatore di generazione (`generazioneAvvio`): solo l'ultima chiamata avviata aggiorna l'interfaccia; rimosso il flag `cambioPasswordInCorso`, diventato superfluo e basato su un'assunzione di tempistica non verificabile |
| V5b | Auth (regressione) | La rimozione di `cambioPasswordInCorso` (V5) aveva lasciato un riferimento residuo a quella variabile nel gestore di invio del modulo "Imposta password" (`if (cambioPasswordInCorso) return;`), mai rimosso: `ReferenceError` a runtime, invisibile a `node --check` (errore di riferimento, non di sintassi) | Media (avrebbe rotto il flusso di recupero password/primo accesso) | Trovato eseguendo per davvero il flusso di recupero password con un browser (Playwright): la sostituzione per sbaglio non rimuoveva questo utilizzo. Sostituito con un controllo su `button.disabled`, coerente con il resto del file |
| V6 | CSP (pannello `/admin`) | `style-src` includeva `'unsafe-inline'` e un `font-src`/`style-src` per Google Fonts mai usato dal pannello | Bassa | Rifattorizzati tutti gli stili inline di `admin/app.js` in classi CSS (`admin/style.css`); `style-src`/`font-src` ridotti a `'self'` |
| V7 | CSP (entrambe le policy) | Mancavano `object-src`, `base-uri`, `form-action`, `frame-ancestors` | Bassa | Aggiunte a entrambe le policy in `netlify.toml`; aggiunto anche `Strict-Transport-Security` |
| V8 | Supply chain | `supabase-js` caricato da CDN con versione maggiore "flottante" (`@2`, non bloccata) | Bassa/Media | Bloccata a `2.112.4` (versione reale riscontrata su fonti indipendenti in fase di ricerca, non inventata — **da confermare al primo collaudo reale**, vedi §8) |

Nessuna vulnerabilità critica trovata nel disegno RLS esistente: la whitelist `public.admins` (scrivibile solo con `service_role`), l'assenza di dipendenza da `user_metadata`, e le policy su `opere`/`storage.objects` erano già corrette. Il lavoro di questo audit le ha **verificate con query reali** (non solo lette) e **rafforzate ai margini**.

## 2. Rischi residui, per gravità

**Media**
- `public.rls_auto_enable()` non è definita in nessuna migrazione di questo repository: esiste solo nel progetto Supabase reale (presumibilmente creata a mano in passato). La migrazione 0006 ne revoca i permessi in modo difensivo (non fallisce se la funzione non esiste), ma **non è stato possibile leggerne il corpo reale**: se contiene logica diversa da quella ipotizzata (abilitazione automatica della RLS via event trigger), va verificata a mano prima di fidarsi ciecamente del comportamento atteso. Vedi §5.
- La versione bloccata di `supabase-js` (`2.112.4`) è stata dedotta da ricerche esterne (fonti indipendenti che la citano come realmente pubblicata), non verificata scaricandola davvero in questo ambiente. Se risultasse sbagliata, il pannello mostra "Impossibile caricare il pannello" (fallisce in modo visibile, non silenzioso) — comunque da controllare al primo collaudo.

**Bassa**
- `data-id="${o.id}"` in `admin/app.js` non passa da `escapeHtml()`: innocuo perché `o.id` è sempre un UUID generato da Postgres (`gen_random_uuid()`), ma segnalato per trasparenza.
- Il sito pubblico mantiene `'unsafe-inline'` in `script-src`/`style-src` (CSS/JS inline esistenti in `index.html`): rimuoverlo richiederebbe un refactoring esteso e un collaudo completo, esplicitamente escluso da questo intervento per non rischiare regressioni (vedi richiesta originale, punto 4).
- Nessuna conversione automatica HEIC→JPEG lato pannello (limite preesistente, non introdotto da questo audit).
- Senza accesso reale al progetto Supabase, nessuna delle policy, funzioni o della versione CDN è stata verificata "sul vivo": solo contro un PostgreSQL locale con un'emulazione fedele di `auth.uid()`/`auth.jwt()` (vedi §6).

**Informativo (nessuna azione in questo audit)**
- Nessun backup configurato: vedi raccomandazione in §7.

## 3. Migrazioni SQL da applicare al progetto Supabase reale

Le migrazioni `0001`-`0005` risultano già applicate (il pannello e il sito funzionano, come indicato nella richiesta). **Da applicare ora, in ordine:**

```
supabase/migrations/0006_hardening_sicurezza.sql
```

Effetti: fissa il `search_path` di `set_updated_at()` e `has_mfa()` (nessun cambiamento di comportamento osservabile); se `public.rls_auto_enable()` esiste nel progetto, le revoca `EXECUTE` da `PUBLIC`/`anon`/`authenticated` (verificato con test reali che questo non rompe un event trigger collegato, vedi §6) e stampa un `NOTICE`/`WARNING` a seconda che trovi o meno un event trigger collegato — **leggere l'output dell'applicazione della migrazione** per questo motivo.

Non elimina né ricrea alcuna funzione esistente: usa solo `ALTER FUNCTION` e `REVOKE`.

## 4. Impostazioni da modificare manualmente nella dashboard Supabase

Non eseguibili da qui (richiedono accesso alla dashboard reale):

1. **Protezione password compromesse** (Authentication → Policies / Auth settings → "Leaked password protection" o dicitura equivalente nella versione corrente della dashboard): **da attivare**. Verifica le password in fase di login/registrazione contro database di password compromesse note (HaveIBeenPwned k-anonymity), senza inviare la password in chiaro. Nessuna controindicazione nota per un solo amministratore.
2. **Verificare `public.rls_auto_enable()` a mano** (SQL Editor): `select pg_get_functiondef('public.rls_auto_enable()'::regprocedure);` per leggerne il corpo reale e confermare che sia davvero collegata solo a un event trigger di auto-abilitazione RLS e non ad altro. La migrazione 0006 stampa già un avviso se non trova un event trigger collegato.
3. **Rate limiting / protezione brute-force sul login** (Authentication → Rate Limits): verificare che i limiti di default di Supabase siano attivi (lo sono salvo disattivazione esplicita); non è stato possibile verificarlo da qui.
4. **URL di redirect consentiti per invito/recupero password** (Authentication → URL Configuration): verificare che includano l'URL reale del sito (`https://grand-salamander-6d8544.netlify.app/admin/` o il dominio definitivo) e non altri — altrimenti `resetPasswordForEmail`/gli inviti potrebbero reindirizzare altrove.
5. **Secret rotation**: se in passato la `service_role key` è mai stata incollata in una chat, un file, o un repository (anche temporaneamente), ruotarla dalla dashboard (Settings → API). Non risulta nel codice di questo repository in nessuna delle sue versioni verificabili da qui, ma è una verifica che solo chi ha accesso alla dashboard/alla cronologia reale può fare con certezza.

## 5. Nota su `public.rls_auto_enable()`

Non è definita in nessuna migrazione di questo repository. La migrazione 0006 presume (in base al nome e al comportamento tipico di questo pattern) che sia la funzione di un event trigger che abilita automaticamente la RLS sulle tabelle appena create, e revoca i permessi EXECUTE diretti senza toccare l'event trigger (verificato con un test reale, §6, che ricrea esattamente questo scenario e conferma che l'automazione continua a funzionare dopo la revoca). **Prima di considerare questo punto chiuso**, eseguire la verifica manuale del punto 2 in §4: se il corpo della funzione reale fa qualcosa di diverso, la sola revoca dei permessi potrebbe non essere sufficiente o potrebbe non essere la correzione giusta.

## 6. Risultati effettivi dei test

Nessun test è stato eseguito contro il progetto Supabase reale (nessun accesso a Internet in questo ambiente). Tutto quanto segue è stato eseguito per davvero in questa sessione, non solo scritto:

**`node --test` (logica pura, zero dipendenze) — 27/27 superati**
Validazione file upload, generazione sicura di `supabase-config.js`, classificazione della migrazione, catalogo statico legacy.

**`./test/run-rls-tests.sh` (PostgreSQL locale reale, 16.15, con emulazione fedele di `auth.uid()`/`auth.jwt()`/`storage.*` — non un vero progetto Supabase) — 16/16 test RLS + 2 nuovi gruppi di test di hardening superati**, tra cui, aggiunti/verificati in questa sessione:
- anonimo: legge le opere, non può scrivere (invariato, ri-verificato);
- autenticato ma non in whitelist: non può scrivere, con o senza MFA (invariato, ri-verificato);
- admin in whitelist: può scrivere SENZA sessione MFA e anche con un JWT privo del claim `aal` (conferma che l'MFA non è più richiesta, come da vincolo);
- `search_path` fissato correttamente su `set_updated_at()`/`has_mfa()` (nuovo);
- scenario con `rls_auto_enable()` + event trigger reale: EXECUTE revocato da `anon`/`authenticated`, **l'event trigger continua a funzionare** dopo la revoca (verificato creando davvero una tabella e controllando `pg_class.relrowsecurity`) (nuovo);
- scenario con `rls_auto_enable()` orfana (nessun event trigger): la migrazione avvisa invece di fallire silenziosamente (nuovo).

Un bug reale è stato trovato e corretto durante questo collaudo: i `GRANT` mancanti erano già stati risolti in una sessione precedente; questa sessione non ne ha trovati di nuovi nelle policy, ma ha trovato e corretto il bug V5 (race condition) descritto sopra, non presente nei test automatici precedenti perché richiede un browser reale per essere osservato.

**`node scripts/check-admin-ui.js` (Playwright, client Supabase SIMULATO — non è un test contro un vero progetto Supabase) — 14/14 controlli superati**, tra cui, in questa sessione:
- senza configurazione Supabase: messaggio chiaro, non un crash muto;
- utente admin: dashboard, **zero violazioni CSP** sotto la policy irrigidita di `/admin/*` (verificato servendo `dist/` con gli HEADER ESATTI di `netlify.toml`, non un server di sviluppo generico);
- le classi CSS che sostituiscono gli stili inline (`.azioni-form`, `.card-stretta`, `.nascosto`, `.overlay-conferma`) producono gli stessi valori calcolati di prima (`margin-top: 16px`, `max-width: 400px`, ecc.);
- utente autenticato ma fuori whitelist: vede "Accesso non autorizzato", **nessun controllo di gestione opere nel DOM**, con un pulsante di uscita;
- due eventi di autenticazione ravvicinati (login + refresh simulati): la UI si stabilizza sullo stato corretto, zero errori JavaScript (verifica diretta della correzione V5);
- **un link di recupero password mostra il modulo "Imposta la tua password" e, dopo il salvataggio, arriva alla dashboard** — eseguendo per davvero questo flusso è stato trovato e corretto il bug V5b (un `ReferenceError` a runtime che lo avrebbe bloccato, introdotto da questa stessa sessione nella correzione di V5 e mai rilevato da `node --check`, che verifica solo la sintassi);
- modulo "Aggiungi opera", conferma di eliminazione, logout: si aprono/funzionano come prima.

Durante questi test il proxy di rete del sandbox ha segnalato tentativi di connessione falliti verso `cdn.jsdelivr.net` ed `esempio.supabase.co`: attesi e innocui, non un problema del codice. Il primo viene dal `<script src>` reale in `admin/index.html` quando si carica la pagina vera (senza mock) per testare il messaggio di configurazione mancante — il browser tenta comunque di scaricare lo script anche se la logica dell'app si ferma prima di usarlo. Il secondo viene dalle immagini `<img>` che puntano a un dominio Supabase finto usato nei dati di test: il browser, essendo reale, tenta davvero di caricarle. Nessuno dei due influisce sull'esito dei controlli.

**Verifica manuale aggiuntiva (browser reale, non automatizzata in uno script committato)**: la correzione V1 (XSS) è stata verificata iniettando un payload `<img src=x onerror=...>` nel percorso di errore corretto e confermando che il codice JavaScript iniettato NON viene eseguito e il testo compare letteralmente, invariato, in pagina.

**Build**: `node scripts/build.js` eseguito più volte in questa sessione, nessun errore, `dist/` verificata.

**Non verificato in questo ambiente** (richiede accesso reale):
- login, recupero password, inviti contro un vero progetto Supabase Auth;
- il comportamento reale di `rls_auto_enable()` (corpo non leggibile da qui);
- il caricamento reale di `supabase-js@2.112.4` da jsdelivr.net;
- rate limiting, protezione password compromesse, configurazione URL di redirect (dashboard Supabase);
- comportamento su smartphone reale;
- il deploy Netlify vero e proprio (solo build locale eseguita).

## 7. Backup e recupero dati — proposta

Nessuna automazione configurata in questo audit (come richiesto: niente servizi a pagamento, niente automazioni senza autorizzazione). Per un portfolio artistico di piccole dimensioni:

- **Database**: Supabase esegue backup automatici giornalieri su tutti i piani a pagamento (Pro e superiori) con restore point-in-time disponibile a seconda del piano; sul piano Free i backup automatici non sono garantiti. Verificare il piano attuale del progetto `izogaoyxrwqtfxfkqcwq` nella dashboard (Settings → Billing) prima di assumere che un backup automatico esista già.
- **Backup manuale a costo zero, sostenibile per un solo amministratore**: un `pg_dump` periodico (manuale o schedulato localmente, non su un servizio a pagamento) dello schema `public` verso un file conservato altrove (es. scaricato a mano una volta al mese). Non implementato qui: richiede una decisione su dove conservarlo e con quale frequenza, che spetta a chi gestisce il sito.
- **Storage (fotografie)**: `content/opere/*.json` nel repository Git conserva già `image_path` per ogni opera migrata da Cloudinary/Decap: il repository stesso funge da registro, ma non da backup delle fotografie caricate DOPO la migrazione (quelle esistono solo nel bucket Supabase). Un backup minimo: scaricare periodicamente il contenuto del bucket `opere` (la dashboard Supabase permette di scaricare i singoli file; per un backup completo servirebbe uno script con la `service_role key`, non creato qui per non introdurre un'automazione non richiesta).
- **Raccomandazione minima concreta**: prima di qualunque operazione massiva (migrazione, pulizia, cambio di schema), esportare manualmente `select * from public.opere` in CSV/JSON dalla dashboard Supabase — azione gratuita, immediata, già disponibile senza alcuna configurazione aggiuntiva.

## 8. File creati o modificati

| File | Modifica |
|---|---|
| `index.html` | Corretto V1 (XSS); aggiunto `connect-src` a Supabase nella CSP (già presente da sessione precedente, non toccato qui) |
| `admin/app.js` | V4 (schermata non autorizzato), V5 (contatore di generazione), stili inline → classi CSS (V6) |
| `admin/style.css` | Nuove classi `.azioni-form`, `.card-stretta`, `.nascosto`, `.overlay-conferma` |
| `admin/index.html` | Versione di `supabase-js` bloccata (V8) |
| `netlify.toml` | CSP: `object-src`, `base-uri`, `form-action`, `frame-ancestors`, HSTS (V7); CSP `/admin/*` irrigidita (V6) |
| `supabase/migrations/0006_hardening_sicurezza.sql` | **Nuovo**: V2, V3 |
| `supabase/tests/hardening.sql` | **Nuovo**: test di V2/V3 |
| `test/run-rls-tests.sh` | Esegue anche `hardening.sql` |
| `scripts/check-admin-ui.js` | **Nuovo**: test Playwright del pannello (spostato fuori da `test/` perché Node vi include per default ogni file `.js`, causando un'esecuzione accidentale da ~7s ad ogni `node --test` — bug trovato e corretto durante questa sessione) |

## 9. Cosa richiede attenzione durante il deploy

- **Applicare `supabase/migrations/0006_hardening_sicurezza.sql`** al progetto reale (SQL Editor o CLI) e leggerne l'output (`NOTICE`/`WARNING` su `rls_auto_enable()`).
- **Verificare `public.rls_auto_enable()` a mano** prima o subito dopo (§4, punto 2).
- **Attivare "Leaked password protection"** nella dashboard Auth (§4, punto 1) — non è una migrazione, è un'impostazione.
- **Il pannello userà `supabase-js@2.112.4` invece di `@2`**: al primo deploy, aprire `/admin` e controllare che si carichi (se la pagina mostra "Impossibile caricare il pannello", la versione va aggiornata in `admin/index.html`).
- **La CSP di `/admin/*` è più stretta**: se in futuro si aggiunge qualunque script/stile/risorsa esterna al pannello, andrà aggiunta esplicitamente a `netlify.toml` (altrimenti verrà bloccata silenziosamente dal browser).
- **HSTS è stato aggiunto** (`max-age` 1 anno, senza `preload`): non ha effetti immediati su un dominio `*.netlify.app` già servito in HTTPS, ma se in futuro si collega un dominio personalizzato, verificare che HTTPS sia configurato correttamente PRIMA del primo deploy con questo header attivo (altrimenti i browser rifiuteranno connessioni HTTP a quel dominio per la durata di `max-age`).
- Nessuna opera, fotografia, account o bucket Storage è stato toccato da questo audit.
