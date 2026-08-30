# Cavijs — Panoramica

`cavijs` è un wrapper TypeScript attorno al motore fisico WebAssembly [`cavi`](../../../cavi/doc/it/01-overview.md). Permette al browser di usare `cavi` senza gestire direttamente i binding WASM, e fornisce rendering su Canvas, UI DOM/Web Component e interazione (mouse/drag) sopra la simulazione grezza.

## Scopo

Il compito di `cavi` è gestire la fisica dei cavi e l'interazione col mouse, producendo dati di spline/punti. Il compito di `cavijs` è:

- Inizializzare e mantenere il modulo WASM
- Avvolgere i tipi WASM `World`/`Wire`/`Node` in classi TS ergonomiche
- Possedere il **rendering** (un renderer Canvas 2D) ed eventuali metadati solo-rendering (es. colore per cavo), che deliberatamente **non** sono memorizzati in WASM — mantenendo fisica e presentazione indipendenti così il renderer può essere sostituito o esteso senza toccare il codice Rust
- Fornire elementi DOM interattivi — i Web Component `cavi-jack` / `cavi-plug` — per collegare i cavi a punti di connessione fissi, e un pannello di debug/tuning `cavi-controls`

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
- **`Renderer`** — renderer Canvas 2D con loop di animazione integrato
- **`CaviControls`** — pannello di debug/tuning Web Component `<cavi-controls>`
- **`Jack`** / **`Plug`** — Web Component `<cavi-jack>` / `<cavi-plug>` che modellano punti di connessione fissi e terminali di cavo trascinabili (vedi [Jack & Plug](./05-jack-plug.md))

## Stato

- Il wrapper principale della simulazione (`Cavi`, `World`, `Wire`, `Node`, `Renderer`, `CaviControls`) è implementato e dimostrato in `src/main.ts`.
- `Jack`/`Plug` sono una funzionalità più recente, in evoluzione attiva (vedi le note di design in `spec.md` / `spec_en.md` e la cronologia commit recente: "jack plug", "better plug ui/ux", "added connection constrains") — considerarne il comportamento come lavoro in corso.
- `src/example2.ts`, `index2.html`, `src/style2.css`, `src/wirewc.ts` sembrano essere un punto di ingresso alternativo/sperimentale — verificarne il contenuto prima di farci affidamento.

Vedi anche:

- [Architettura](./02-architecture.md)
- [Riferimento API](./03-api.md)
- [Guida introduttiva / avvio](./04-getting-started.md)
- [Componenti Jack & Plug](./05-jack-plug.md)
