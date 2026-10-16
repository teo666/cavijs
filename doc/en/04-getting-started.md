# Cavijs — Getting Started / Running

## Prerequisites

- Node.js and [pnpm](https://pnpm.io).
- The `cavi` package: the WASM build of the sibling [`cavi`](../../../cavi/doc/en/01-overview.md) Rust project, installed from npm (`"cavi": "^0.2.0"`). To work on the engine and cavijs together, point `package.json` at a local build instead (`"cavi": "link:../cavi/pkg"`), with `../cavi` checked out and built by `wasm-pack build --target web` (which needs Rust and `wasm-pack`); CI builds `teo666/cavi` itself while the link is there.
- For the end-to-end tests: Google Chrome (Playwright uses the installed one, `channel: 'chrome'`, so no browser download is needed).

## Install

```bash
pnpm install
```

## Scripts (`package.json`)

| Script           | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server for the demos                                   |
| `pnpm build`     | Type-check, then build the demo site into `dist/`               |
| `pnpm build:lib` | Build the library: `dist-lib/cavijs.js` and its type files      |
| `pnpm preview`   | Serve the built demo site                                       |
| `pnpm test`      | Unit tests (vitest, jsdom, the real WASM module)                |
| `pnpm test:e2e`  | End-to-end tests: the demos in Chrome, driven with a real mouse |
| `pnpm lint`      | oxlint                                                          |
| `pnpm format`    | Format with Prettier (`format:check` only checks)               |

## Running the demos

`pnpm dev` serves `examples/` (Vite's `root`) under the `/cavijs/` base: open the printed URL followed by `/cavijs/`. `examples/index.html` links every demo:

- `demo-basic.html` / `demo-svg.html` — a `Cavi` set up by hand (`examples/main.ts`, `examples/main-svg.ts`), canvas or SVG, with a control panel (`<cavi-controls>`, `examples/controls.ts`).
- `demo-jack-plug.html` — jacks and cables declared in HTML inside a `<cavi-world>`.
- `demo-patchbay*.html` — a modular-synth patchbay, with pan/zoom variants.
- `demo-d3-interaction.html`, `demo-noop-interaction.html` — custom interaction controllers.
- `demo-two-worlds.html` — two worlds on one page, one in a shadow root.

The README's "Demos" table lists the script and renderer behind each page.
