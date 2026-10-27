# Prototipo CMS — ILO | Fuori di Tela (Fase 3)

Stato: **prototipo nel branch `claude/clever-darwin-ay3nu6`, non attivo, non collegato a nulla di reale.**
Il branch `main` e il sito pubblico non sono stati toccati. Notion e la relativa
Netlify Function restano l'unica fonte dati realmente funzionante finché
qualcuno non completa i passaggi manuali più sotto.

## 1. Architettura implementata

```text
/admin (Decap CMS, in locale non testabile: serve Internet + account reali)
   │
   ├── autenticazione → Decap Turbo (email+password, nessun account GitHub
   │                      richiesto per Danilo — vedi §4)
   ├── foto → Cloudinary Media Library (upload dal CMS, non copia-incolla URL)
   └── scrive → content/opere/<slug>.json   (una riga per opera)
                        │
                        ▼
              scripts/build-opere.js   (Node, zero dipendenze)
              eseguito da Netlify come build command
                        │
                        ▼
              data/opere.json   (generato, MAI versionato — vedi .gitignore)
              solo le opere con stato "pubblicata", ordinate per "ordine"
                        │
                        ▼
              index.html → prova /data/opere.json, se assente usa ancora
                           /.netlify/functions/notion (percorso invariato)
```

Decisioni di design, da convalidare con l'uso reale:

- **Niente pulsanti separati "Salva bozza" / "Pubblica" / "Nascondi" nell'interfaccia Decap.**
  Decap non li offre in modo nativo senza attivare l'"Editorial Workflow" (un
  sistema a rami Git con una bacheca a colonne), la cui compatibilità con il
  backend `turbo-github` non è documentata e non è stato possibile verificarla
  in questo ambiente. Ho scelto un'unica scelta "Stato" (Bozza / Pubblicata /
  Nascosta) nel modulo opera: Danilo cambia lo stato e preme l'unico pulsante
  "Salva" di Decap. **Questo è l'esperimento principale da validare con
  Danilo**: se il flusso a stato singolo risulta meno chiaro delle tre azioni
  separate richieste, vale la pena investire nel vero editorial workflow.
- **Eliminazione disattivata nel pannello** (`delete: false` in
  `admin/config.yml`): un'opera si nasconde, non si cancella. Applica a
  livello di interfaccia la regola "non cancellare opere esistenti".
- Il catalogo generato (`data/opere.json`) espone solo i campi che il sito
  pubblico già usa (titolo, immagine, tecnica, dimensioni, anno, descrizione):
  nessun dato di bozza o nascosto finisce mai nel file pubblicato.

## 2. File creati o modificati

| File | Cosa fa |
|---|---|
| `admin/index.html` | Pagina che carica Decap CMS da CDN (`unpkg.com`) |
| `admin/config.yml` | Configurazione CMS: backend Turbo, Cloudinary, modello dati opere |
| `content/opere/*.json` | 3 opere di **prova con dati fittizi** (una per ogni stato) |
| `assets/test-opere/*.jpg` | 3 immagini segnaposto generate per i test, nessuna foto reale |
| `scripts/build-opere.js` | Genera `data/opere.json` da `content/opere/*.json`, valida i campi obbligatori |
| `netlify.toml` | Aggiunge il build command, `publish = "."`, e una CSP dedicata a `/admin/*` |
| `index.html` | `caricaOpere()` ora prova prima `/data/opere.json`, poi Notion (invariato) |
| `.gitignore` | Esclude `data/opere.json` (file generato, non va in Git) |

Nessun file Notion-related è stato toccato o rimosso.

## 3. Cosa ho potuto verificare in questo ambiente (senza accesso a Internet)

Eseguito davvero, non solo letto nella documentazione:

- `node scripts/build-opere.js` sulle 3 opere di prova → genera `data/opere.json`
  con **solo** l'opera "pubblicata" (1 di 3), ordinata correttamente, bozza e
  nascosta escluse. Un JSON non valido o un campo obbligatorio mancante ferma
  il build con un errore leggibile (provato forzando un file malformato).
- Servito il sito con un server statico locale e aperto con un browser headless
  reale (Playwright): la galleria mostra l'unica opera pubblicata, il mosaico
  hero mostra la sua immagine, il lightbox si apre al click con titolo,
  metadati e descrizione corretti, **zero errori in console**.
- Screenshot della pagina risultante conservato per questo collaudo.

Questo dimostra che la catena "contenuto → build → catalogo statico →
rendering sito" funziona. **Non dimostra** che Decap CMS, Decap Turbo o
Cloudinary funzionino nella realtà: quella parte richiede Internet e account
veri, che questo ambiente di sviluppo non ha.

## 4. Cosa resta da verificare con accesso reale (non testabile qui)

Confermato solo dalla documentazione ufficiale Decap (ricerca mirata, non
lettura diretta delle pagine — anche quella bloccata dalla rete del
sandbox), **mai da un browser reale**:

- **Login di Danilo**: Decap Turbo fa accedere gli invitati con email e
  password tramite un link di invito; **non serve un account GitHub**. Solo
  chi crea il sito Turbo e lo collega al repository (un passo tecnico, fatto
  una volta) deve avere accesso a GitHub — non Danilo.
- **Piano gratuito**: Decap Turbo Free = 1 sito, 1 posto, gratis a tempo
  indeterminato, nessuna carta di credito. Coincide con l'ipotesi di costo
  €0/mese fatta in Fase 2, per un solo utilizzatore permanente (Danilo).
- **Cloudinary — possibile secondo login**: la documentazione Decap dice
  esplicitamente che per usare la Media Library di Cloudinary "l'utente deve
  avere eseguito l'accesso all'account Cloudinary collegato alla api_key".
  Questo suggerisce che Danilo potrebbe dover autenticarsi **anche** su
  Cloudinary, oltre che su Decap Turbo — cioè **due login distinti**, proprio
  il caso che andava segnalato esplicitamente. Non è stato possibile
  verificare se questo valga solo per sfogliare la libreria media esistente o
  anche per il semplice caricamento di una nuova foto. **Da provare dal vivo
  prima di considerare il flusso "un solo login" risolto.**
- **Usabilità su smartphone**: nessuna fonte indipendente affidabile trovata.
  Un sito di terzi (concorrente di Decap, quindi non neutrale) descrive
  l'editor su mobile come "utilizzabile ma a volte scomodo". Da provare su un
  telefono reale prima di dire a Danilo che funziona bene da smartphone.
- **CSP di `/admin/*`**: ho scritto una policy che permette gli host
  presumibilmente necessari (unpkg.com, api.cloudinary.com, api.github.com,
  dominio Decap, Supabase) dedotti dalla documentazione, ma **non osservati
  da un browser reale**. Al primo accesso reale, aprire la console del
  browser: se compaiono blocchi CSP, aggiungere l'host mancante in
  `netlify.toml` nel blocco `for = "/admin/*"`.
- **Localizzazione italiana completa**: ho impostato `locale: "it"`, ma non
  ho potuto verificare se copre tutte le stringhe dell'interfaccia (pulsanti,
  messaggi di errore) nella versione di Decap CMS caricata da CDN.
- **"Le mie opere" con miniature**: Decap mostra di default un elenco
  testuale (titolo — stato) nella lista a sinistra, non miniature delle
  foto. La foto si vede aprendo la singola opera (anteprima automatica a
  destra). Se Danilo ha bisogno delle miniature nell'elenco per riconoscere
  le opere a colpo d'occhio, serve svilupparlo appositamente: non l'ho
  costruito ora per non introdurre complessità non richiesta esplicitamente
  e non verificabile qui.

## 5. Passaggi manuali per attivare davvero il prototipo

Da fare fuori da questa sessione, con accesso reale ai servizi:

1. **GitHub**: installare la Decap Turbo GitHub App su `nksbrg/danilo-arte`
   (richiede i permessi di un proprietario del repository).
2. **Decap Turbo**: creare un account su decapcms.org/turbo, creare un sito
   collegato al repository e al branch `claude/clever-darwin-ay3nu6`, copiare
   l'ID del sito e incollarlo in `admin/config.yml` al posto di
   `DA-CONFIGURARE-turbo-site-id`. Invitare Danilo come membro di quel sito
   (email, non serve account GitHub).
3. **Cloudinary**: confermare cloud name e API key dell'account già in uso
   (non crearne uno nuovo), inserirli in `admin/config.yml` al posto dei
   placeholder `DA-CONFIGURARE-*`. Verificare se serve login Cloudinary
   separato per Danilo (vedi punto critico sopra) e, se sì, decidere se è
   accettabile o se serve un upload firmato lato server.
4. **Netlify**: confermare che questo sito sia davvero collegato a GitHub con
   deploy automatico (il file `COME-AGGIORNARE.txt` descrive solo un deploy
   manuale trascinando la cartella — non verificabile da qui se oggi sia
   anche collegato a GitHub). Senza collegamento Git→Netlify, il build
   command aggiunto a `netlify.toml` non verrà mai eseguito automaticamente.
5. Solo a questo punto: aprire `/admin` dal sito di anteprima, loggarsi come
   Danilo farebbe, e ripetere i test di usabilità del punto 6.

## 6. Modalità di accesso al CMS (una volta attivato)

Danilo apre `https://<dominio-del-sito>/admin`, inserisce email e password
Decap Turbo (ricevute via invito), e arriva direttamente al pannello in
italiano con "Le mie opere" e "Aggiungi opera". Nessun passaggio da GitHub,
Netlify o Notion è previsto in questo flusso.

## 7. Prossimi passi per migrare le opere da Notion

Non ancora fatto, come richiesto. Il piano resta quello della Fase 2
(sezione "Piano di implementazione", passi 4, 8, 9, 11, 12): export completo
da Notion (incluse bozze e pagine oltre la prima), conversione nello schema
`content/opere/*.json` usato qui, inventario e verifica delle immagini
Cloudinary realmente in uso, dual-run tra vecchio e nuovo catalogo, e cutover
solo dopo collaudo con Danilo. Questo prototipo non contiene alcun dato reale
di Danilo: solo 3 opere di test con etichette esplicite "dato fittizio".
