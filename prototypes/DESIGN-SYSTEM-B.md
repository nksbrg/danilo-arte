# Concept B — Experimental Art Studio

Design system di riferimento per il prototipo `concept-b-experimental-studio/index.html`.

**Registro**: studio creativo indipendente, catalogo da mostra temporanea, collage editoriale. ~55% editoriale / ~45% gioco grafico — più audace e dinamico di Concept A, ma le regole restano rigide (griglia, palette, poche forme ripetute): è "sperimentale e curato", non caotico.

## 1. Tipografia

| Ruolo | Font | Note |
|---|---|---|
| Display / titoli | **Bricolage Grotesque** (variabile, `opsz,wght`, 400–800) | Grottesca nata per essere espressiva: curve leggermente irregolari, ottima in peso 800 e MAIUSCOLO per titoli-manifesto. Sostituisce Boogaloo con qualcosa di altrettanto carattere ma disegnato, non "da fumetto". |
| Corpo / UI | **Space Grotesk** | Più personalità di un'Inter, resta leggibilissima; pesi 400/500/700. |
| Etichette, timbri, numerazioni | **JetBrains Mono** | Usato nei "timbri" (stamp) da catalogo — `ILO — Danilo Bergaglio, Arona`, numeri di sezione, didascalie. |

Google Fonts:
```
Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800
Space+Grotesk:wght@400;500;600;700
JetBrains+Mono:wght@400;600
```

Scala: titoli hero fino a `clamp(3rem, 9vw, 8.2rem)` in maiuscolo, peso 800, con parole chiave evidenziate da un "pennarellone" (`background:ink` o `background:hot` dietro il testo, leggermente ruotato) invece che dal colore soltanto — è il principale sostituto visivo dell'energia che prima dava Boogaloo.

## 2. Palette

```css
--paper:    #F1EBDC   /* base, leggermente più "grezza" di un ivory puro */
--paper-dim:#E7DFC9   /* superfici secondarie */
--ink:      #15130F   /* testo, blocchi scuri, nav */
--hot:      #FF4616   /* accento dominante — sezione Contatti, highlight, hover */
--cobalt:   #1E3FD9   /* accento secondario — tag "Paciughi", blob hero */
--mustard:  #E7B23D   /* accento — tag "Ricami", blob hero */
--sage:     #6E8F52   /* accento di servizio */
```

Qui il colore è più audace: un intero blocco-sezione (Contatti) in `--hot` pieno, bilanciato da grandi superfici neutre di carta e inchiostro. Non è "arcobaleno ovunque": restano sempre 2 colori dominanti per vista (carta/inchiostro + un accento), mai più di 3.

## 3. Spaziatura e griglia

- Container 1360px; sezioni 130px di padding verticale (90px sotto i 980px).
- Composizione "collage": hero con 3 card-opera sovrapposte, ruotate (-5°/+4°/-3°) e con ombra netta offset (`box-shadow:8px 8px 0`), come fossero appoggiate su un tavolo da studio.
- Numerazioni di categoria come "etichette da cassa" (sfondo ink, testo paper, leggera rotazione) invece di un numero mono a terra.
- Griglia opere: stesso meccanismo a `column-count` di Concept A (3→2→1), ma ogni card ha una rotazione minima alternata (±0.3°/0.8°) che si raddrizza in hover — energia senza compromettere l'allineamento generale.

## 4. Doodle e segni grafici

Stesso principio del filtro ruvido (`feTurbulence`/`feDisplacementMap`, scala 9 — più marcata di Concept A) applicato a una freccia gestuale in hero. Il resto del linguaggio "a mano" passa soprattutto per: rotazioni leggere, nastro adesivo (`.about-tape`) sulla foto di Danilo, timbri con cornice netta. Meno linee disegnate, più "gesto compositivo" — è la differenza principale rispetto a Concept A.

## 5. Bottoni e componenti

- Bottoni squadrati (`border-radius:2px`), bordo 2px, hover con spostamento + ombra offset (`translate(-3px,-3px); box-shadow:4px 4px 0`) — un richiamo "pop" ma pulito, senza arrotondamenti giocattolo.
- Tag/categoria ruotati alternativamente (±1.2°), bordo pieno colorato.
- Card opera: bordo 3px + ombra offset netta, come tasselli ritagliati e incollati.
- Form: campi pieni con bordo 2px su fondo `--hot`, focus con ombra offset — coerente con l'estetica "etichetta/adesivo" del resto della pagina.

## 6. Trattamento immagini

- Foto di Danilo: cornice spessa 3px ruotata -2°, ombra offset `--hot`, striscia di "nastro" in alto — la inserisce nel linguaggio collage senza toccarne il contenuto.
- Opere: stesso principio di Concept A — `width:100%; height:auto; object-fit:contain`, proporzioni naturali sempre rispettate, nessun crop. Le card ruotano leggermente ma l'immagine al loro interno resta sempre intera e non deformata.
