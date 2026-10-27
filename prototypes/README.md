# Prototipi — Redesign direzione artistica homepage ILO | Fuori di Tela

Due concept visivi alternativi per la homepage, realizzati come prototipi HTML/CSS statici e navigabili, **separati dalla homepage di produzione** (`index.html` su `main` non è stato modificato). Nessuna modifica a CMS, Supabase, autenticazione, upload o configurazioni Netlify.

## Come guardarli

Ogni concept è un singolo file HTML autosufficiente (HTML + CSS + un po' di JS per menu mobile, lightbox e reveal-on-scroll). Basta aprirlo in un browser, anche da file system:

- `concept-a-editorial-gallery/index.html` — **Concept A — Playful Editorial Gallery**
- `concept-b-experimental-studio/index.html` — **Concept B — Experimental Art Studio**

## Contenuto della cartella

```
prototypes/
├── concept-a-editorial-gallery/index.html   prototipo A
├── concept-b-experimental-studio/index.html prototipo B
├── shared/assets/
│   ├── danilo.jpg                           foto di Danilo (già pubblicata sul sito), ridimensionata
│   └── opere/*.svg                          illustrazioni placeholder (NON opere reali, vedi sotto)
├── screenshots/                             screenshot desktop + mobile di entrambi i concept
├── DESIGN-SYSTEM-A.md                       tipografia, palette, spaziature, doodle, componenti — Concept A
├── DESIGN-SYSTEM-B.md                       idem — Concept B
├── COMPARISON.md                            confronto sintetico e trade-off tra i due concept
└── README.md                                questo file
```

## Cosa sono (e cosa NON sono) le immagini della galleria

Le fotografie reali delle opere di Danilo vivono in Supabase e questo lavoro non le ha né lette né modificate. Per verificare che entrambi i layout reggano con opere verticali, orizzontali, quadrate e panoramiche — come richiesto — la galleria usa illustrazioni SVG astratte generate per l'occasione (`shared/assets/opere/`), nello stesso registro cromatico del brand ma dichiaratamente non reali. Il passo successivo, una volta scelta una direzione, è applicarla a `index.html` con le fotografie reali già esistenti.

## Prossimi passi

1. Guardare entrambi i prototipi (desktop + mobile; gli screenshot in `screenshots/` sono un riferimento rapido).
2. Leggere `COMPARISON.md` per i trade-off.
3. Scegliere una direzione (o chiedere una via di mezzo) prima di qualsiasi modifica a `index.html` di produzione.
