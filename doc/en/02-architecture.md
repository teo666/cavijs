# Cavijs — Architecture

## File layout

```
src/
├── main.ts        demo entry point (used by index.html)
├── cavi.ts         Cavi — facade class
├── world.ts        World — wraps WasmWorld
├── wire.ts          Wire — wraps a WASM wire + metadata
├── node.ts          Node — wraps a WASM node
├── renderer.ts       Renderer — Canvas 2D rendering + animation loop
├── controls.ts        CaviControls — <cavi-controls> debug panel Web Component
├── jack.ts            Jack — <cavi-jack> Web Component
├── plug.ts            Plug — <cavi-plug> Web Component
├── types.ts           shared interfaces (IRenderer, WireMeta) + re-exports
├── example2.ts, wirewc.ts, style2.css   experimental/alternate entry (index2.html)
└── style.css          styling for the main demo
```

## Data flow

```
 index.html
     │
     ▼
 main.ts ── Cavi.initWasm() ─────────────► loads cavi.wasm, sets Cavi.wasm
     │
     ├── new Cavi() ──► new World() ──► new WasmWorld()   (WASM instance)
     │
     ├── new Renderer(canvas, cavi.getWorld())
     │        └── reads canvas#wireCanvas from the DOM, gets 2D context
     │
     ├── cavi.addWire(...) ──► World.addWire ──► WasmWorld.add_wire_with_count
     │        └── returns a Wire (TS) wrapping the WASM wire's index
     │
     ├── wire.setColor(...) / wire.setMetaData(...)  (render-only, stored in TS, not WASM)
     │
     └── renderer.render()
              │  (self-scheduling via requestAnimationFrame)
              ├── world.update() ──► WasmWorld.update()  (physics step, rebuilds wire_data_buffer)
              ├── drawAllWires()
              │     ├── reads WasmWorld.wire_data_ptr()/wire_data_len()
              │     ├── builds a Float32Array VIEW directly into WASM memory (zero-copy)
              │     ├── for each wire: looks up its Wire (for color metadata) and draws
              │     │     using ctx.lineTo (segments) or ctx.bezierCurveTo (bezier)
              └── drawInteractionRadii() — draws mouse/pointer radius indicators
```

## Key design points

### Facade (`Cavi`)
`Cavi` is the intended single entry point for consumers: static `Cavi.initWasm()` loads the WASM module once (`Cavi.wasm` holds the `InitOutput`, including `.memory` used by the renderer for zero-copy buffer views), then each `Cavi` instance owns one `World`.

### Metadata lives in TypeScript, not WASM
`Wire` keeps a plain `meta: WireMeta` object (e.g. `color`) entirely on the JS side. The WASM layer has no concept of color or labels — this is a deliberate boundary (see [`cavi`'s overview](../../../cavi/doc/en/01-overview.md)) so rendering concerns never leak into the physics engine.

### Zero-copy rendering
`Renderer.drawAllWires()` does **not** call per-node WASM getters. Instead it reads the flat `f32` buffer that `WasmWorld::update()` rebuilds every frame, via a `Float32Array` view over `Cavi.wasm.memory.buffer`. This mirrors the buffer layout documented in `cavi`'s architecture doc (`[node_count, radius, render_type, path_length, ...path_data]` per wire) and avoids one JS↔WASM call per node.

### Render loop ownership
`Renderer.render()` drives the whole loop: it updates physics (`world.update()`), clears the canvas, draws, and re-schedules itself via `requestAnimationFrame`. Callers only need to call `renderer.render()` once to start it.

### Mouse interaction
`Renderer`'s constructor attaches a `mousemove` listener on the container. If a wire endpoint is being dragged (`draggedWire`/`draggedEndpoint` state), it calls `set_wire_start`/`set_wire_end` on the WASM world directly; otherwise it just forwards the pointer position via `set_mouse` for the physics engine's mouse-repulsion behavior.

### Web Components for connectors
`Jack` and `Plug` are native custom elements (`customElements.define`) using Shadow DOM, independent of the `Cavi`/`World`/`Wire` class hierarchy — they interact with a `Node` instance directly (`Plug.setNode`) rather than going through `Cavi`. See [Jack & Plug](./05-jack-plug.md).

## Build tooling

- **Vite** — dev server & bundler (`vite`, `vite build`, `vite preview`)
- **TypeScript** — `tsc` type-checks before `vite build`
- **Prettier** — formatting (`format` / `format:check` scripts)
- Depends on the npm package `cavi` (the compiled WASM output of the sibling Rust project) — see [Getting started](./04-getting-started.md) for how this resolves in this workspace.
