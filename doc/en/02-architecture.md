# Cavijs — Architecture

## File layout

```
src/
├── index.ts                  public entry point: exports, registers the custom elements
├── core/
│   ├── cavi.ts               Cavi — facade (WASM init, wires, renderer, Cavi.for)
│   ├── world.ts              World — wraps WasmWorld, fixed-rate stepping, frame tasks
│   ├── wire.ts, node.ts      Wire / Node handles
│   ├── coords.ts             viewport <-> world coordinates, CoordinateTransform
│   ├── events.ts             domain events (cavi-wire-add, cavi-plug-attach, ...)
│   ├── frame.ts              FrameTask (per-frame read/write work)
│   └── types.ts              IRenderer, IInteractionController, IResizeController, ...
├── renderer/
│   ├── renderer.ts           Renderer — Canvas 2D
│   ├── renderer-svg.ts       SvgRenderer — SVG
│   ├── pointer.ts            PointerTracker — feeds the physics mouse
│   └── resize.ts             StandardResizeController
├── component/                custom elements
│   ├── worldwc.ts            <cavi-world>
│   ├── wirewc.ts             <cavi-wire>
│   ├── jack.ts, plug.ts      <cavi-jack>, <cavi-plug>
│   └── interactionwc.ts      <cavi-interaction>
├── interaction/
│   ├── interaction.ts        StandardInteractionController — pointer
│   └── keyboard.ts           KeyboardInteractionController — keyboard
├── debug/                    <cavi-debug>, statistics, event formatting
└── tests/                    unit tests (vitest, jsdom, real WASM)

examples/                     demo pages and their scripts (Vite's root)
e2e/                          end-to-end tests (Playwright, Chrome)
```

## Data flow

```
 examples/demo-basic.html
     │
     ▼
 examples/main.ts ── Cavi.initWasm() ─────────────► loads cavi.wasm, sets Cavi.wasm
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
              ├── world.advance(elapsed) ──► WasmWorld.update() × N  (fixed-rate physics steps, rebuild wire_data_buffer)
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

`Renderer.render()` drives the whole loop: it advances physics (`world.advance(elapsed)`), clears the canvas, draws, and re-schedules itself via `requestAnimationFrame`. Callers only need to call `renderer.render()` once to start it.

The engine's step has a fixed time delta, so `World.advance` turns the real time elapsed since the previous frame into a fixed number of steps per second (`setStepRate`, default 60) with an accumulator: one step per frame at 60 Hz, one every other frame at 120 Hz, two per frame at 30 Hz. Then, on every frame, `build_render_data(alpha)` rebuilds the render buffer with the cables drawn `alpha` of the way between the last two steps (`alpha` = time left in the accumulator / step duration). A display faster than the step rate therefore draws a new position on every frame instead of repeating the last step's, and the buffer always matches the current wires. Drawing trails the simulation by at most one step; fixed nodes (plugged or dragged ends) are drawn where they are. Plugs follow the drawn position too (`Node.getRenderPosition`), so they stay on the cable.

### Mouse interaction

While running, each renderer's `PointerTracker` (`src/renderer/pointer.ts`) forwards the pointer position over the drawing surface via `set_mouse`, for the physics engine's mouse-repulsion behavior. The engine applies its mouse to every cable on every step, so when no pointer hovers the surface (it left the surface or the window, or a touch ended) the mouse is parked far out of reach (`World.releaseMouse`) — also at startup, since the engine's mouse otherwise starts at (0, 0). Dragging is handled by the interaction controller, not the renderer.

### Web Components for connectors

`Jack` and `Plug` are native custom elements (`customElements.define`) using Shadow DOM, independent of the `Cavi`/`World`/`Wire` class hierarchy — they interact with a `Node` instance directly (`Plug.setNode`) rather than going through `Cavi`. See [Jack & Plug](./05-jack-plug.md).

## Build tooling

- **Vite** — dev server & bundler (`vite`, `vite build`, `vite preview`)
- **TypeScript** — `tsc` type-checks before `vite build`
- **Prettier** — formatting (`format` / `format:check` scripts)
- Depends on the npm package `cavi` (the compiled WASM output of the sibling Rust project) — see [Getting started](./04-getting-started.md) for how this resolves in this workspace.
