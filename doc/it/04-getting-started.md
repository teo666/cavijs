# Cavijs — Guida introduttiva / Avvio

## Prerequisiti

- Node.js e [pnpm](https://pnpm.io).
- Il pacchetto `cavi`: la build WASM del progetto Rust gemello [`cavi`](../../../cavi/doc/it/01-overview.md), installata da npm (`"cavi": "^0.2.0"`). Per lavorare insieme sul motore e su cavijs, fai puntare `package.json` a una build locale (`"cavi": "link:../cavi/pkg"`), con `../cavi` presente e compilato con `wasm-pack build --target web` (servono Rust e `wasm-pack`); finché c'è il link, la CI compila da sé `teo666/cavi`.
- Per i test end-to-end: Google Chrome (Playwright usa quello installato, `channel: 'chrome'`, senza scaricare un browser).

## Installazione

```bash
pnpm install
```

## Script (`package.json`)

| Script           | A cosa serve                                                  |
| ---------------- | ------------------------------------------------------------- |
| `pnpm dev`       | Server di sviluppo Vite per le demo                           |
| `pnpm build`     | Controllo dei tipi, poi build del sito delle demo in `dist/`  |
| `pnpm build:lib` | Build della libreria: `dist-lib/cavijs.js` e i file dei tipi  |
| `pnpm preview`   | Serve il sito delle demo compilato                            |
| `pnpm test`      | Test unitari (vitest, jsdom, il modulo WASM vero)             |
| `pnpm test:e2e`  | Test end-to-end: le demo in Chrome, guidate con un mouse vero |
| `pnpm lint`      | oxlint                                                        |
| `pnpm format`    | Formatta con Prettier (`format:check` controlla soltanto)     |

## Avviare le demo

`pnpm dev` serve `examples/` (la `root` di Vite) sotto la base `/cavijs/`: apri l'URL stampato seguito da `/cavijs/`. `examples/index.html` elenca tutte le demo:

- `demo-basic.html` / `demo-svg.html` — un `Cavi` costruito a mano (`examples/main.ts`, `examples/main-svg.ts`), canvas o SVG, con un pannello di controllo (`<cavi-controls>`, `examples/controls.ts`).
- `demo-jack-plug.html` — jack e cavi dichiarati in HTML dentro un `<cavi-world>`.
- `demo-patchbay*.html` — un patchbay da synth modulare, con varianti con pan/zoom.
- `demo-d3-interaction.html`, `demo-noop-interaction.html` — controller di interazione personalizzati.
- `demo-two-worlds.html` — due mondi nella stessa pagina, uno in uno shadow root.

La tabella "Demos" del README indica lo script e il renderer di ogni pagina.
