# Cavijs — Panoramica

`cavijs` è un wrapper TypeScript attorno al motore fisico WebAssembly [`cavi`](../../../cavi/doc/it/01-overview.md). Permette al browser di usare `cavi` senza gestire direttamente i binding WASM, e fornisce rendering su Canvas, UI DOM/Web Component e interazione (mouse/drag) sopra la simulazione grezza.

## Scopo

Il compito di `cavi` è gestire la fisica dei cavi e l'interazione col mouse, producendo dati di spline/punti. Il compito di `cavijs` è:

- Inizializzare e mantenere il modulo WASM
- Avvolgere i tipi WASM `World`/`Wire`/`Node` in classi TS ergonomiche
- Possedere il **rendering** (un renderer Canvas 2D e uno SVG) ed eventuali metadati solo-rendering (es. colore per cavo), che deliberatamente **non** sono memorizzati in WASM — mantenendo fisica e presentazione indipendenti così il renderer può essere sostituito o esteso senza toccare il codice Rust
- Fornire custom element — `<cavi-world>`, `<cavi-jack>`, `<cavi-wire>`, `<cavi-plug>` — per dichiarare in HTML un mondo, i suoi punti di connessione e i suoi cavi, controller di interazione per mouse, touch e tastiera, e un pannello `<cavi-debug>`

## Divisione dell'architettura

| Responsabilità                                                       | Dove                  |
| -------------------------------------------------------------------- | --------------------- |
| Simulazione fisica, collision detection, matematica di spline/curve  | Rust/WASM (`cavi`)    |
| Rendering, metadati dei cavi (colori, etichette…), UI, estensibilità | TypeScript (`cavijs`) |

## Classi principali

- **`Cavi`** — facade/punto di ingresso principale (init WASM, gestione cavi, collegamento del renderer)
- **`World`** — contenitore della simulazione, wrapper sottile sopra `WasmWorld`
- **`Wire`** — un singolo cavo; avvolge un cavo WASM e aggiunge un dizionario di metadati
- **`Node`** — un singolo punto di un cavo
- **`Renderer`** / **`SvgRenderer`** — renderer Canvas 2D e SVG, ciascuno con il proprio loop di animazione
- **`<cavi-world>`** / **`<cavi-wire>`** — un mondo e un cavo dichiarati in HTML
- **`StandardInteractionController`** / **`KeyboardInteractionController`** — interazione da puntatore e da tastiera, collegate da `<cavi-interaction>`
- **`<cavi-debug>`** — pannello di debug: statistiche, log degli eventi, overlay (vedi [Debug ed eventi](./07-debug.md))
- **`Jack`** / **`Plug`** — Web Component `<cavi-jack>` / `<cavi-plug>` che modellano punti di connessione fissi e terminali di cavo trascinabili (vedi [Jack & Plug](./05-jack-plug.md))

## Stato

- Tutto quanto sopra è implementato e coperto da test unitari (`pnpm test`) e da test end-to-end in Chrome (`pnpm test:e2e`).
- Le demo in `examples/` mostrano ogni configurazione; `examples/index.html` le elenca tutte (vedi [Guida introduttiva](./04-getting-started.md)).
- Il lavoro ancora aperto è in `TODO.md`.

Vedi anche:

- [Architettura](./02-architecture.md)
- [Riferimento API](./03-api.md)
- [Guida introduttiva / avvio](./04-getting-started.md)
- [Componenti Jack & Plug](./05-jack-plug.md)
- [Zoom, pan e più mondi](./06-zoom-multiworld.md)
- [Debug ed eventi](./07-debug.md)
