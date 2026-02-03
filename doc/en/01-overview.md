# Cavijs — Overview

`cavijs` is a TypeScript wrapper around the [`cavi`](../../../cavi/doc/en/01-overview.md) WebAssembly physics engine. It lets the browser use `cavi` without dealing with the WASM bindings directly, and provides Canvas rendering, DOM/Web Component UI, and interaction (mouse/drag) on top of the raw simulation.

## Purpose

`cavi`'s job is to handle cable physics and mouse interaction, producing spline/point data. `cavijs`'s job is to:

- Initialize and hold the WASM module
- Wrap the WASM `World`/`Wire`/`Node` types in ergonomic TS classes
- Own **rendering** (a Canvas 2D renderer) and any render-only metadata (e.g. per-wire color), which intentionally is **not** stored in WASM — keeping physics and presentation independent so the renderer can be swapped or extended without touching Rust code
- Provide interactive DOM elements — `cavi-jack` / `cavi-plug` Web Components — for connecting cables to fixed connection points, and a `cavi-controls` debug/tuning panel

## Architecture split

| Concern | Where |
|---|---|
| Physics simulation, collision detection, spline/curve math | Rust/WASM (`cavi`) |
| Rendering, wire metadata (colors, labels…), UI, extensibility | TypeScript (`cavijs`) |

## Main classes

- **`Cavi`** — main facade/entry point (WASM init, wire management, renderer wiring)
- **`World`** — simulation container, thin wrapper over the WASM `WasmWorld`
- **`Wire`** — a single cable; wraps a WASM wire and adds a metadata dictionary
- **`Node`** — a single point on a wire
- **`Renderer`** — Canvas 2D renderer with a built-in animation loop
- **`CaviControls`** — a `<cavi-controls>` Web Component debug/tuning panel
- **`Jack`** / **`Plug`** — `<cavi-jack>` / `<cavi-plug>` Web Components modeling fixed connection points and draggable cable terminals (see [Jack & Plug](./05-jack-plug.md))

## Status

- The core simulation wrapper (`Cavi`, `World`, `Wire`, `Node`, `Renderer`, `CaviControls`) is implemented and demonstrated in `src/main.ts`.
- `Jack`/`Plug` are a newer, actively evolving feature (see `spec.md` / `spec_en.md` design notes and recent commit history: "jack plug", "better plug ui/ux", "added connection constrains") — treat their behavior as work-in-progress.
- `src/example2.ts`, `index2.html`, `src/style2.css`, `src/wirewc.ts` appear to be an alternate/experimental entry point — check their contents before relying on them.

See also:
- [Architecture](./02-architecture.md)
- [API reference](./03-api.md)
- [Getting started / running](./04-getting-started.md)
- [Jack & Plug components](./05-jack-plug.md)
