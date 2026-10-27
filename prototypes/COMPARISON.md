# Confronto Concept A vs Concept B

Due prototipi statici, navigabili, separati dalla homepage di produzione (`index.html` su `main` non è stato toccato). Entrambi usano gli stessi testi e le stesse sezioni della homepage attuale (hero, Chi sono, Opere nelle tre categorie Ricami/Fuori di tela/Paciughi, Contatti+Atelier) e la stessa foto di Danilo già pubblicata sul sito. **Le immagini nella galleria sono segnaposto generati per questo prototipo** (non opere reali: vedi nota in fondo) — servono solo a verificare che entrambe le direzioni reggano con formati verticali, orizzontali e quadrati.

## In una frase

- **Concept A — Playful Editorial Gallery**: una rivista d'arte che si prende sul serio quanto basta. Tipografia serif (Fraunces), molto respiro, palette ridotta, doodle minimi e mirati.
- **Concept B — Experimental Art Studio**: un catalogo da studio creativo indipendente. Tipografia grottesca espressiva (Bricolage Grotesque), composizione a collage, blocchi colore più audaci, maggiore energia compositiva.

Entrambi risolvono il problema di partenza (Boogaloo + colori saturi = effetto "Art Attack per bambini"): in nessuno dei due resta un font cartoon, un colore primario puro usato in blocco, o un'icona/emoji decorativa.

## Dove sono uguali (non negoziabile in entrambi)

- Stesse 3 categorie di opere, stesso ordine (Ricami → Fuori di tela → Paciughi), stessa logica di sezione.
- Nessuna foto viene ritagliata, stirata o deformata: sempre `height:auto` + `object-fit:contain`, mosaico a colonne responsive che si adatta anche con poche opere per categoria.
- Testo biografico di "Chi sono" invariato nel contenuto.
- Form di contatto e sezione Atelier con gli stessi campi e la stessa mappa, solo restyling visivo.
- Nessuna dipendenza da Supabase/CMS: sono pagine statiche di sola presentazione.

## Dove divergono

| | Concept A | Concept B |
|---|---|---|
| **Temperatura** | Quieta, editoriale, "da parete di galleria" | Dinamica, collage, "da tavolo di studio" |
| **Titoli** | Serif con corsivi-accento (Fraunces) | Grottesca extra-bold maiuscola con evidenziatore (Bricolage Grotesque) |
| **Colore dominante** | Vermiglio bruciato, usato con parsimonia | Arancio-rosso acceso, usato anche a piena sezione (Contatti) |
| **Composizione hero** | Due colonne nette, mosaico ordinato e leggermente inclinato | Collage di opere sovrapposte, ruotate, con ombre offset |
| **Doodle** | Pochissimi, a tratto sottile, "annotazione a margine" | Rotazioni, nastro adesivo, timbri — il "gesto" sostituisce il tratto disegnato |
| **Bottoni/card** | Pillola, bordo sottile, hover leggero | Squadrati, bordo spesso, ombra offset, hover "a scatto" |
| **Rischio percepito** | Più sicuro, meno distintivo se non eseguito con cura nei dettagli tipografici | Più memorabile, richiede disciplina per non scivolare verso il collage "disordinato" |

## Trade-off principali

1. **Sicurezza vs riconoscibilità.** A è la scelta più facile da difendere in ogni contesto (anche un ipotetico catalogo stampato, una newsletter, un profilo social): è sobria e scala bene. B è più rischiosa ma più "Instagrammabile": la composizione a collage con ombre offset è il tipo di dettaglio che fa screenshottare una pagina.
2. **Sforzo di manutenzione futura.** A, con la sua griglia pulita, è più facile da estendere quando le opere reali saranno molte di più (il mosaico resta leggibile). B richiede più attenzione quando si aggiungono nuove opere alla composizione hero in collage (le rotazioni e le sovrapposizioni vanno curate a mano o con una logica un po' più elaborata).
3. **Coerenza con il nome del brand.** "Fuori di Tela" (soggetti che escono dalla cornice) è reso in A soprattutto a parole e con un piccolo doodle; in B è reso anche visivamente, nella logica stessa del collage (le opere "scappano" dai loro riquadri, si sovrappongono, sconfinano).
4. **Tono "irriverente".** A lo affida quasi interamente alla voce (testi, un corsivo rosso su "e…") restando visivamente composta. B lo mette anche nella forma (titoli-adesivo, rotazioni, timbri) — più vicino allo spirito "Art Attack... ma fatto da un adulto con gusto", se il criterio di successo è "si vede subito che non è un sito per bambini ma nemmeno un sito asettico".

## Raccomandazione

Nessuna delle due è "più corretta" in astratto — dipende da quanto rischio tipografico si vuole correre. Se l'obiettivo primario è *sofisticazione percepita al primo sguardo* (collezionisti, gallerie, stampa), **A** è la scelta più sicura. Se l'obiettivo primario è *memorabilità e condivisione* (social, passaparola, pubblico più giovane) senza perdere la sofisticazione, **B** rende più esplicita la personalità "Fuori di Tela". Entrambe reggono il criterio richiesto: nessuna sembra un laboratorio per bambini.

## Nota sulle immagini placeholder

Le fotografie reali delle opere vivono in Supabase e non sono state toccate in questa fase (né lette, né modificate). Per poter valutare entrambi i concept con immagini verticali, orizzontali e quadrate — come richiesto — la galleria dei due prototipi usa illustrazioni SVG astratte generate ad hoc (`prototypes/shared/assets/opere/*.svg`), ispirate al linguaggio a blocchi di colore piatto/ricamo/gesto pittorico visibile nella foto di Danilo già pubblicata sul sito, ma **non sono opere reali**: servono solo a verificare il comportamento del mosaico. Una volta scelta una direzione, il passo successivo è applicarla a `index.html` con le fotografie reali già presenti su Supabase, senza modificarne dati o logica di caricamento.
