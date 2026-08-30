# Cavijs — Getting Started / Running

## Prerequisites

- Node.js — **available** in this environment (`node v24.19.0`, `npm 11.17.0`)
- The `cavi` npm dependency (`package.json` → `"cavi": "^0.1.0"`) needs to resolve to the WASM build of the sibling [`cavi`](../../../cavi/doc/en/01-overview.md) Rust project. `cargo`/`wasm-pack` are **not installed** in this environment, so `cavi`'s `pkg/` output does not currently exist — confirm with the project owner how this dependency should resolve (npm registry publish vs. `npm link` / `file:` reference to a locally built `pkg/`) before installing.

## Install dependencies

`node_modules/` does not currently exist in this workspace.

```bash
npm install
```

> **Nothing has been installed automatically.** Ask before running `npm install` (or any other install command) — in particular, confirm how the `cavi` dependency should be sourced, since a plain `npm install` may fail or pull an unexpected version if `cavi` isn't published to a registry this project can reach.

## Scripts (`package.json`)

| Script                 | Command              | Purpose                                     |
| ---------------------- | -------------------- | ------------------------------------------- |
| `npm run dev`          | `vite`               | Start the Vite dev server (hot reload)      |
| `npm run build`        | `tsc && vite build`  | Type-check, then produce a production build |
| `npm run preview`      | `vite preview`       | Serve the production build locally          |
| `npm run format`       | `prettier --write .` | Format the codebase                         |
| `npm run format:check` | `prettier --check .` | Check formatting without writing            |

## Running the demo

`index.html` loads `src/main.ts`, which:

1. Initializes the WASM module (`Cavi.initWasm()`)
2. Creates a `Cavi` instance and a `Renderer` bound to `#wireCanvas`
3. Adds three demo wires (red/yellow/green, two bezier + one segment-rendered)
4. Sets gravity (`cavi.setAcceleration(0, 10.0)`)
5. Mounts a `<cavi-controls>` debug panel (`#controls` in `index.html`) if present

Once dependencies are installed, start the dev server with `npm run dev` and open the printed local URL; the canvas should show three draggable/gravity-affected wires with a live stats/tuning panel.

There is also `index2.html` / `src/example2.ts` — an alternate entry point; inspect it before use, as it may be experimental or unmaintained relative to `main.ts`.
