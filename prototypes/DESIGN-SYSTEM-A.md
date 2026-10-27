# Concept A — Playful Editorial Gallery

Design system di riferimento per il prototipo `concept-a-editorial-gallery/index.html`.

**Registro**: galleria d'arte contemporanea / rivista d'arte indipendente, con una venatura irriverente. ~70% editoriale sofisticato, ~30% gioco grafico. È il concept più "quieto": lascia parlare le opere e la tipografia, e usa i doodle con grande parsimonia (un arrow, una ring, uno scribble — mai di più in una sezione).

## 1. Tipografia

| Ruolo | Font | Note |
|---|---|---|
| Display / titoli | **Fraunces** (serif variabile, `ital,opsz,wght`) | Sostituisce Boogaloo. Serif contemporaneo con personalità, usato in peso basso (380–460) per i titoli e in corsivo (460–560) per le parole-accento ("…nell'**arte**", "d'**arte!**"). È la stessa famiglia che userebbe una rivista d'arte indipendente oggi. |
| Testo editoriale / UI | **Inter** | Molto leggibile, neutro, lascia campo al display. Pesi 400/500/600/700/800. |
| Etichette, numeri di catalogo, didascalie | **Space Mono** | Dà il tocco "scheda da catalogo d'arte" a numerazioni (01/02/03), dimensioni delle opere, eyebrow label. |

Google Fonts:
```
Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,380;0,9..144,460;0,9..144,600;0,9..144,680;1,9..144,420;1,9..144,560
Inter:wght@400;500;600;700;800
Space Mono:wght@400;700
```

Scala: titoli hero `clamp(3.2rem, 7.4vw, 6.6rem)`, titoli di sezione `clamp(2.4rem, 5vw, 4.2rem)`, corpo `1–1.1rem` / line-height 1.65–1.8. Niente MAIUSCOLO spinto sui titoli (solo su eyebrow/etichette mono) — è uno dei segnali più forti di "rivista", non "cartoon".

## 2. Palette

```css
--ivory:       #F6F1E7   /* base */
--ivory-deep:  #EFE7D6   /* superfici secondarie, placeholder */
--ink:         #181511   /* testo, sezioni dark (Chi sono, Contatti) */
--ink-soft:    #4A463E   /* testo secondario */
--vermillion:  #C94F3D   /* accento dominante — CTA, corsivi, hover */
--cobalt:      #2B5FAD   /* accento secondario — tag "Paciughi", dettagli */
--ochre:       #D99A2B   /* accento — tag "Ricami", eyebrow su fondo scuro */
--sage:        #6E7F5C   /* accento — tag "Materiali recuperati" */
```

Un solo colore dominante (vermiglio bruciato) usato con decisione su CTA e accenti tipografici; ochre/cobalt/sage restano "colori di servizio" per i tag di categoria, mai protagonisti. Niente giallo/blu/rosso/verde saturi da fumetto: tutte le tinte sono abbassate di luminosità e desaturate rispetto all'originale per sembrare pigmenti, non plastica.

## 3. Spaziatura e griglia

- Container 1320px, padding laterale 48px (28px tablet, 20px mobile).
- Sezioni con padding verticale 120px (84–90px sotto i 980px).
- Griglia hero e "Chi sono" asimmetriche (1.05fr/0.95fr e 0.82fr/1.18fr), mai 50/50.
- Mosaico opere: `column-count` 3→2→1 via breakpoint, stesso meccanismo a colonne dell'originale (preserva aspect ratio naturale, nessun crop forzato).

## 4. Doodle e segni grafici

Un solo filtro SVG (`feTurbulence` + `feDisplacementMap`, scala 6) applicato a pochi tratti disegnati: una freccia che collega headline e mosaico in hero, uno scribble leggero sopra il mosaico, un anello imperfetto accanto alla foto di Danilo. Tratto sottile (2.5–3px), colore ink o vermiglio, mai più di 1–2 doodle per sezione. Sono interventi editoriali (tipo le annotazioni a penna su una bozza di stampa), non sticker.

## 5. Bottoni e componenti

- Bottoni pillola (`border-radius:999px`), bordo 1.5px, hover con leggero sollevamento (`translateY(-2px)`) — nessuna ombra "fumettosa" offset.
- Tag/categoria: pillola mono con solo bordo colorato (outline), mai riempimento pieno.
- Card opera: bordo sottile 1px, nessuna ombra decorativa; la cornice lascia parlare l'immagine.
- Form: campi "a sottolineatura" (bottom-border) su fondo ink, non box pieni — registro da modulo di rivista, non da form scolastico.

## 6. Trattamento immagini

- Foto di Danilo: cornice sottile 1px con padding interno (mat), non un riquadro colorato spesso.
- Opere: sempre `width:100%; height:auto; object-fit:contain` nel mosaico — proporzioni naturali garantite, mai stretch/crop. Didascalia sotto ogni opera in stile scheda di catalogo (titolo + dimensioni).
