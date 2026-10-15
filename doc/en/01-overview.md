# Cavijs — Overview

`cavijs` is a TypeScript wrapper around the [`cavi`](../../../cavi/doc/en/01-overview.md) WebAssembly physics engine. It lets the browser use `cavi` without dealing with the WASM bindings directly, and provides Canvas rendering, DOM/Web Component UI, and interaction (mouse/drag) on top of the raw simulation.

## Purpose

`cavi`'s job is to handle cable physics and mouse interaction, producing spline/point data. `cavijs`'s job is to:

- Initialize and hold the WASM module
- Wrap the WASM `World`/`Wire`/`Node` types in ergonomic TS classes
- Own **rendering** (a Canvas 2D renderer and an SVG one) and any render-only metadata (e.g. per-wire color), which intentionally is **not** stored in WASM — keeping physics and presentation independent so the renderer can be swapped or extended without touching Rust code
- Provide custom elements — `<cavi-world>`, `<cavi-jack>`, `<cavi-wire>`, `<cavi-plug>` — for declaring a world, its connection points and its cables in HTML, interaction controllers for mouse, touch and keyboard, and a `<cavi-debug>` panel

## Architecture split

| Concern                                                       | Where                 |
| ------------------------------------------------------------- | --------------------- |
| Physics simulation, collision detection, spline/curve math    | Rust/WASM (`cavi`)    |
| Rendering, wire metadata (colors, labels…), UI, extensibility | TypeScript (`cavijs`) |

## Main classes

- **`Cavi`** — main facade/entry point (WASM init, wire management, renderer wiring)
- **`World`** — simulation container, thin wrapper over the WASM `WasmWorld`
- **`Wire`** — a single cable; wraps a WASM wire and adds a metadata dictionary
- **`Node`** — a single point on a wire
- **`Renderer`** / **`SvgRenderer`** — Canvas 2D and SVG renderers, each with its own animation loop
- **`<cavi-world>`** / **`<cavi-wire>`** — a world and a cable declared in HTML
- **`StandardInteractionController`** / **`KeyboardInteractionController`** — pointer and keyboard interaction, attached by `<cavi-interaction>`
- **`<cavi-debug>`** — debug panel: statistics, event log, overlays (see [Debugging and events](./07-debug.md))
- **`Jack`** / **`Plug`** — `<cavi-jack>` / `<cavi-plug>` Web Components modeling fixed connection points and draggable cable terminals (see [Jack & Plug](./05-jack-plug.md))

## Status

- Everything above is implemented and covered by unit tests (`pnpm test`) and end-to-end tests in Chrome (`pnpm test:e2e`).
- The demos in `examples/` show each setup; `examples/index.html` links them all (see [Getting started](./04-getting-started.md)).
- Open work is tracked in `TODO.md`.

See also:

- [Architecture](./02-architecture.md)
- [API reference](./03-api.md)
- [Getting started / running](./04-getting-started.md)
- [Jack & Plug components](./05-jack-plug.md)
- [Zoom, pan and multiple worlds](./06-zoom-multiworld.md)
- [Debugging and events](./07-debug.md)
