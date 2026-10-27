# CMS del sito — ILO | Fuori di Tela (Fase 3B)

Stato: **prototipo nel branch `claude/clever-darwin-ay3nu6`, non ancora attivo
sui servizi reali.** Il branch `main` non è stato toccato. Nessun deploy
definitivo è stato effettuato.

Rispetto alla Fase 3: **Notion è stato rimosso completamente dal progetto.**
Il sito non è ancora online e non c'è nulla da migrare: le opere vere si
caricano solo tramite il nuovo CMS, da zero.

## 1. Architettura definitiva

```text
/admin (Decap CMS)
   │
   ├── autenticazione → Decap Turbo (email+password, nessun account GitHub
   │                      richiesto per Danilo — vedi §4)
   └── foto → Cloudinary Media Library (upload dal CMS, non copia-incolla URL)
                        │
                        ▼
              content/opere/<slug>.json   (una riga per opera, nel repository)
                        │
                        ▼
              scripts/build.js   (Node, zero dipendenze)
              eseguito da Netlify come build command
                        │
                        ▼
              dist/   (SOLO i file pubblici — vedi §3)
              dist/data/opere.json: solo le opere "pubblicata", ordinate
                        │
                        ▼
              index.html → fetch('/data/opere.json')
                           Nessun fallback, nessuna chiamata a servizi
                           esterni. Catalogo vuoto o assente → messaggio
                           "Nessuna opera pubblicata ancora." (o un
                           messaggio di errore se il file manca del tutto).
```

Non esiste più alcun percorso verso Notion: niente Netlify Function, niente
variabili d'ambiente `NOTION_TOKEN`/`NOTION_DATABASE_ID`, niente chiamata di
rete dal browser verso servizi diversi dal proprio dominio.

## 2. File creati, modificati, eliminati rispetto alla Fase 3

| File | Cosa cambia |
|---|---|
| `netlify/functions/notion.js` | **Eliminato** |
| `index.html` | `caricaOpere()` legge solo `/data/opere.json`, nessun fallback |
| `scripts/build-opere.js` → `scripts/build.js` | Rinominato ed esteso: oltre a generare il catalogo, assembla `dist/` |
| `scripts/rimuovi-opere-prova.js` | **Nuovo**: rimuove le 3 opere fittizie prima del lancio (vedi §6) |
| `test/build.test.js` | **Nuovo**: test automatici sul catalogo (vedi §5) |
| `netlify.toml` | `publish = "dist"` (non più `"."`), niente più `functions =`, CSP senza `api.notion.com` |
| `COME-AGGIORNARE.txt` | Riscritto: nessun riferimento a Notion, descrive il flusso CMS |
| `README-CMS.md` | Questo file |

`admin/index.html`, `admin/config.yml`, `content/opere/*.json`,
`assets/test-opere/*.jpg` restano come nella Fase 3 (nessuna modifica
sostanziale necessaria).

## 3. Sicurezza della pubblicazione

Prima (Fase 3): `publish = "."` pubblicava **l'intero repository**, inclusi
`content/opere/*.json` (bozze e nascoste comprese), `scripts/`,
`README-CMS.md`, `COME-AGGIORNARE.txt` e `netlify.toml` stesso — tutti
raggiungibili dal dominio pubblico.

Ora: `scripts/build.js` assembla una cartella `dist/` che contiene solo:

```
dist/
├── index.html
├── thanks.html
├── assets/…
├── admin/index.html
├── admin/config.yml      (nessun segreto: cloud_name e api_key non sono
│                           dati sensibili, lo conferma la documentazione
│                           Decap; l'api_secret di Cloudinary non ci va MAI)
└── data/opere.json       (solo opere "pubblicata")
```

`content/opere/*.json`, `scripts/`, `test/`, `README-CMS.md`,
`COME-AGGIORNARE.txt`, `netlify.toml`, `.git/` **non vengono copiati in
`dist/`** e quindi non sono raggiungibili dal dominio pubblico. Verificato
con `ls -R dist` dopo il build (vedi §5).

**Avvertenza che non posso togliere con il codice**: se il repository
GitHub `nksbrg/danilo-arte` è pubblico, chiunque può comunque leggere
`content/opere/*.json` — bozze e opere nascoste comprese — direttamente su
GitHub, a prescindere da cosa pubblica Netlify. Il build qui descritto
protegge solo il **dominio del sito**, non il repository. Se le opere non
pubblicate devono restare riservate, il repository deve essere privato: è
una decisione che spetta a te, non l'ho cambiata e non la cambio
autonomamente.

## 4. Verificato in questo ambiente (senza accesso a Internet)

- `node scripts/build.js` su opere con stato misto (pubblicata / bozza /
  nascosta / archiviata) → `dist/data/opere.json` contiene solo le
  pubblicate, ordinate in modo deterministico anche a parità di "ordine"
  (pareggio risolto per titolo).
- `node --test test/` → test automatici sulla lettura/filtro/ordinamento del
  catalogo, vedi §5.
- Sito servito da `dist/` con un server statico locale e aperto con un
  browser headless reale (Playwright): homepage, galleria, mosaico hero,
  lightbox verificati con un'opera pubblicata; galleria con catalogo vuoto
  mostra "Nessuna opera pubblicata ancora."; modulo contatti presente,
  campi e honeypot intatti (l'invio reale a Netlify Forms non è testabile
  senza un deploy reale).
- `ls -R dist/` dopo il build: confermato che non compaiono
  `content/`, `scripts/`, `test/`, `README-CMS.md`, `COME-AGGIORNARE.txt`,
  `netlify.toml`.

**Non verificabile qui** (richiede account reali e Internet): login Decap
Turbo, login/upload Cloudinary, comportamento su smartphone reale, il
deploy Netlify vero e proprio. Vedi §7 per l'elenco completo di cosa resta
da controllare dal vivo.

## 5. Test automatici

`test/build.test.js` usa il test runner integrato di Node (`node:test`,
nessuna dipendenza da installare). Esegue, su cartelle di fixture temporanee
(mai sul vero `content/opere/`):

- Le opere "bozza", "nascosta" e "archiviata" sono escluse dal catalogo
  pubblico; solo "pubblicata" vi compare.
- L'ordinamento rispetta il campo "ordine"; a parità di "ordine" il
  risultato è sempre lo stesso (per titolo), indipendentemente dall'ordine
  con cui i file vengono letti dal filesystem.
- Un file con "titolo" o "immagine" mancanti fa fallire il build con un
  errore leggibile, invece di generare un catalogo corrotto in silenzio.

Si esegue con: `node --test test/`

## 6. Contenuti iniziali e rimozione prima del lancio

Le 3 opere fittizie (`content/opere/opera-di-prova-*.json`) restano, come
richiesto, solo per collaudare il prototipo. Prima di lanciare il sito con
le opere vere di Danilo:

```
node scripts/rimuovi-opere-prova.js
node scripts/build.js
```

Il primo comando rimuove le 3 opere di prova e le immagini segnaposto
associate; il secondo rigenera `dist/` (che risulterà con un catalogo
vuoto, finché Danilo non pubblica opere vere dal pannello). Dopo aver
verificato il risultato, fare commit e push di `content/` e `assets/`.

## 7. Cosa resta da verificare con accesso reale (non testabile qui)

- **Login di Danilo**: Decap Turbo fa accedere gli invitati con email e
  password tramite link di invito; non serve un account GitHub. Solo chi
  crea il sito Turbo e lo collega al repository deve avere accesso a
  GitHub — non Danilo. (Dedotto dalla documentazione ufficiale Decap,
  cercata ma non raggiungibile direttamente da questo ambiente — nessun
  browser reale l'ha confermato.)
- **Piano gratuito Decap Turbo**: 1 sito, 1 posto, gratis a tempo
  indeterminato, nessuna carta di credito — coerente con un solo
  utilizzatore permanente (Danilo) a costo €0/mese.
- **Cloudinary — possibile secondo login**: la documentazione Decap dice che
  per usare la Media Library serve essere loggati anche nell'account
  Cloudinary collegato alla api_key. Quindi Danilo potrebbe dover
  autenticarsi **due volte** (Decap Turbo + Cloudinary). Da provare dal vivo
  prima di considerare "un solo accesso" un fatto acquisito.
- **Usabilità su smartphone**: nessuna fonte indipendente affidabile
  trovata. Da provare su un telefono reale.
- **CSP di `/admin/*`**: gli host elencati in `netlify.toml` sono dedotti
  dalla documentazione, non osservati da un browser reale. Al primo
  accesso vero, controllare la console per errori CSP e correggere.
- **Collegamento Netlify↔GitHub**: non verificabile dal repository se oggi
  esista un deploy automatico collegato a GitHub, o solo quello manuale
  descritto storicamente. Senza quel collegamento, `scripts/build.js` non
  gira mai da solo.
- **"Le mie opere" con miniature**: Decap mostra di default un elenco
  testuale (titolo — stato), non miniature. La foto si vede aprendo la
  singola opera. Non sviluppato apposta per non introdurre complessità non
  richiesta esplicitamente.

## 8. Passaggi manuali per attivare i servizi reali

Non eseguiti in questa fase, come richiesto. In sintesi (dettagli nella
Fase 3, invariati):

1. Installare la Decap Turbo GitHub App su `nksbrg/danilo-arte`.
2. Creare un sito su decapcms.org/turbo collegato al repository e al branch
   `claude/clever-darwin-ay3nu6`; copiare l'ID del sito in
   `admin/config.yml` al posto di `DA-CONFIGURARE-turbo-site-id`; invitare
   Danilo via email.
3. Confermare cloud name e API key Cloudinary (account già esistente, non
   crearne uno nuovo) e inserirli in `admin/config.yml`.
4. Confermare che Netlify sia collegato a GitHub con deploy automatico.
5. Decidere se il repository GitHub deve restare pubblico o diventare
   privato, alla luce dell'avvertenza al §3.
