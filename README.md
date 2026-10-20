# Cavijs

cavijs is a wrapper written in typescript that allow to use cavi inside browser without handle directly with cavi.

The main purpose of cavi is to handle cable and mouse interaction, generating as a result spline point to be passed in js, js receive the point and renders wires.

The purpose is to avoid to store render information in the wasm project and let js to handle renderer and keep information about that, this because in that manner is possible to easly extend rendere behavior.

The TS project contain following classes:

- **Cavi** - Main entry point and facade
- **World** - Simulation container
- **Wire** - Individual wire representation
- **Node** - Individual node/point in a wire
- **Renderer** - Canvas-based rendering implementation
- **SvgRenderer** - SVG-based rendering implementation, drop-in alternative to Renderer

And these custom elements:

- **`<cavi-world>`** - a world declared in HTML: creates the `Cavi`, its canvas and renderer
- **`<cavi-jack>`** / **`<cavi-plug>`** - fixed connection points, and the cable ends that plug into them
- **`<cavi-wire>`** - a cable declared in HTML, with its two plugs
- **`<cavi-interaction>`** - attaches the interaction controllers: `StandardInteractionController` (mouse, touch) and `KeyboardInteractionController` (Tab, Space/Enter, Escape)
- **`<cavi-debug>`** - debug panel: statistics, event log, overlays

## Architecture

The architecture separates concerns:

- **Rust/WASM**: Physics simulation, collision detection, spline calculations
- **TypeScript**: Rendering, metadata, UI interaction, extensibility

## Classes

### Cavi

Main facade class that simplifies usage. Provides:

- WASM initialization
- Wire management through World wrapper
- Renderer integration
- Convenience methods for common operations

**Methods:**

```typescript
static initWasm(): Promise<void>
init(): Promise<void>
getWorld(): World
setRenderer(renderer: IRenderer): void
getRenderer(): IRenderer | null
addWire(x1, y1, x2, y2, nodes, tension, radius, type): Wire
deleteWire(index: number): void
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
getWireByIndex(index: number): Wire | null
getWires(): Wire[]
update(): void
setMouse(x: number, y: number): void
render(): void
```

### World

Main container for cavi simulation. Exposes all methods to interact with cables and global parameter configuration.

**Capabilities:**

- Add a new Wire
- Delete a Wire
- Set acceleration (gravity)
- Get acceleration
- Set renderer class
- Get wires by their index

**Methods:**

```typescript
addWire(x1, y1, x2, y2, nodes, tension, radius, renderType): Wire
deleteWire(index: number): void
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
setRenderer(renderer: IRenderer): void
getRenderer(): IRenderer | null
getWireByIndex(index: number): Wire | null
getWires(): Wire[]
getWireCount(): number
update(): void
setMouse(x: number, y: number): void
setMouseRadius(radius: number): void
setFriction(friction: number): void
```

During render, the renderer class receives the wire instance with its context that allows rendering the wire with specific color passed in early initialization.

### Wire

Wire is the TypeScript class corresponding to Wire in cavi.

Wire is logically connected to the WASM Wire but contains methods to change properties like radius and tension. It also contains a meta dictionary that allows the user to extend with information useful for rendering, for example adding the color.

**Minimal implementation methods:**

- Add a node
- Remove a node
- Change and set meta data (for example render color)
- Change radius

**Methods:**

```typescript
addNode(x: number, y: number, fixed?: boolean): void
addNodeAt(index: number, x: number, y: number, fixed?: boolean): void
removeNode(index: number): void
getNodeCount(): number
setMetaData(key: string, value: any): void
getMetaData(key: string): any
getAllMetaData(): WireMeta
setColor(color: string): void
getColor(): string | undefined
setRadius(radius: number): void
getRadius(): number
getIndex(): number
```

**Metadata Example:**

```typescript
const wire = world.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire.setColor('#ff0000');
wire.setMetaData('thickness', 2);
wire.setMetaData('pattern', 'dashed');
```

### Node

Node is the corresponding TypeScript class of Node in cavi. Represents a single point in a wire with position, velocity, and fixed state.

**Properties:**

```typescript
x: number (readonly, from WASM)
y: number (readonly, from WASM)
fixed: boolean (get/set)
```

**Methods:**

```typescript
setPosition(x: number, y: number): void
```

### Renderer

Renderer class is responsible to render wires inside a `<canvas>`. In each render cycle it uses the WASM buffer and wire metadata instances to determine rendering properties like color.

**Constructor:**

```typescript
constructor(container: HTMLElement, world: World, options?: RendererOptions & { canvas?: HTMLCanvasElement })
```

Uses `options.canvas` (any canvas, anywhere on the page — its placement is measured every frame), else an existing `#wireCanvas` inside the host (`options.surface`, else `container`), creating one if there is none. `<cavi-world>` (`src/component/worldwc.ts`) creates the canvas and keeps it sized through its `IResizeController`. `options.surface` enables the pan/zoom-friendly mode described in [Pan/zoom and multiple worlds](#panzoom-and-multiple-worlds).

**Features:**

- Direct WASM memory access for efficient rendering (zero-copy)
- HiDPI: the canvas backing store follows `devicePixelRatio`
- Uses wire metadata for rendering colors (with fallback to default colors)
- Supports both segment and Bezier curve rendering
- Built-in animation loop with FPS tracking
- Mouse interaction visualization (pointer and mouse radii)
- Automatic physics updates in render cycle

**Methods:**

```typescript
render(): void           // Starts the animation loop (idempotent, restartable after stop())
clear(): void            // Clear the canvas
getFPS(): number         // Get current frames per second
drawInteractionRadii(x: number, y: number): void  // Draw mouse interaction zones
getSurface(): HTMLElement // options.surface, else the container
stop(): void             // Cancel the loop, remove the pointer listener, clear the canvas
```

The renderer reads wire colors from metadata and automatically handles the render loop, physics updates, and visualization.

### SvgRenderer

`SvgRenderer` is a drop-in alternative to `Renderer`: it implements the same `IRenderer` interface and renders each wire as an SVG `<path>` (one pooled, updated-in-place element per wire) instead of stroking a `<canvas>`. Anywhere `Renderer` is used, `SvgRenderer` can be substituted without other code changes.

Unlike `Renderer`, it is **self-contained**: its constructor creates its own `<svg id="wireSvg">` inside the given container if one doesn't already exist, and manages its own sizing internally (an internal `ResizeObserver`, no `viewBox` — wire coordinates map 1:1 to SVG user-space pixels, just like the canvas backing store).

**Constructor:**

```typescript
constructor(container: HTMLElement, world: World, options?: RendererOptions)
```

`container` can be any plain `HTMLElement` (it does not need a pre-created `#wireSvg`, nor does it need to come from `<cavi-world>`).

**Features:**

- Same zero-copy WASM buffer reading and wire-color-fallback logic as `Renderer`
- Per-wire `<path>` pooling: DOM nodes are created/removed only when the wire count changes, never recreated every frame
- Segment and Bezier curve rendering via `M`/`L`/`C` path commands
- Debug overlay (physics nodes, mouse/pointer interaction radii) as SVG `<circle>`/`<text>` elements, toggled the same way as `Renderer`
- Dispatches a `cavi-resize` CustomEvent on `container` on every resize — same contract as `StandardResizeController` (`src/renderer/resize.ts`), so code that listens for `cavi-resize` (e.g. to reposition jacks, see `examples/patchbay-shared.ts`) works unchanged regardless of which renderer is active

**Methods:**

```typescript
render(): void           // Main render method (includes animation loop)
getFPS(): number         // Get current frames per second
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement
stop(): void             // Cancel the animation loop and disconnect the internal ResizeObserver
```

**Usage** (swap-in replacement for `Renderer`):

```typescript
import { Cavi, SvgRenderer } from 'cavijs';

await Cavi.initWasm();
const cavi = new Cavi();

const container = document.getElementById('wireArea') as HTMLElement;
const renderer = new SvgRenderer(container, cavi.getWorld());
cavi.setRenderer(renderer);

renderer.render();
```

## Usage Example

```typescript
import { Cavi, Renderer } from 'cavijs';

// Initialize WASM
await Cavi.initWasm();

// Create instance
const cavi = new Cavi();

// Setup renderer (pass the container holding a #wireCanvas element, and world)
const container = document.getElementById('container') as HTMLElement;
const renderer = new Renderer(container, cavi.getWorld());
cavi.setRenderer(renderer);

// Add wires with metadata for custom colors
const wire1 = cavi.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire1.setColor('#ff0000');
wire1.setMetaData('label', 'Cable A');

const wire2 = cavi.addWire(100, 200, 500, 200, 25, 15, 8, 1);
wire2.setColor('#00ff00');

// Configure physics
cavi.setAcceleration(0, 9.8);

// Start rendering (renderer handles animation loop internally)
renderer.render();
```

## Pan/zoom and multiple worlds

cavijs does not implement pan/zoom: the page transforms a wrapper around `<cavi-world>` (e.g. with d3-zoom) and registers the current transform with `setCoordinateTransform(() => ({ scale, translateX, translateY }))`, calling `notifyCoordinateTransformChanged()` after each step.

To keep cables visible and sharp at any zoom, give the world a **surface**, an untransformed element such as the frame the zoom listens on: `<cavi-world surface="#zoomFrame">`, or `new Renderer(container, world, { surface })` / `new SvgRenderer(container, world, { surface })`. The canvas/svg is then placed in and sized to that element, and the renderer applies the zoom itself, so cables are no longer clipped to the container's box when zooming out.

To draw into a canvas of your own — e.g. stacked above jacks and plugs — use `<cavi-world canvas="#myCanvas">` (or the `.canvas` property; `{ canvas }` / `{ svg }` for a hand-made renderer). It can sit anywhere on the page: its on-screen position is measured every frame.

Several `<cavi-world>`s can coexist on one page, also inside shadow roots: every element resolves its own world with `Cavi.for(element)`, `<cavi-plug jack="id">` looks the id up among its own world's jacks (so worlds can reuse ids), and each world has a single interaction controller with its own pointer and drag state — see `examples/demo-two-worlds.html`. `Cavi.shared` remains as a fallback for single-world setups.

Details: [doc/en/06-zoom-multiworld.md](doc/en/06-zoom-multiworld.md).

## Saving and restoring cables

`captureCables(cavi)` reads a world's cables as plain JSON-safe data — for each cable its `id`, the ids of the jacks its two ends are plugged into, and its attributes — and `applyCables(cavi, snapshot)` puts them back, touching only the cables that differ. Jacks are not saved: the page restores them first, with the same ids. `Plug.connect(jack)`/`disconnect()` plug and unplug from code, and `CaviWireElement.delete()` deletes a cable freeing its jacks right away.

`CaviHistory` builds undo/redo on top: a step at the end of every gesture on the cables (the `cavi-change` event) and whenever the page commits a change of its own, with the page's own state (jacks, modules) put back before the cables. `examples/demo-d3-interaction.html` has Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Save/Load.

Details: [doc/en/03-api.md](doc/en/03-api.md#saving-and-restoring-cables), [undo and redo](doc/en/03-api.md#undo-and-redo-cavihistory).

## `cavijs/core`: the simulation alone

`import { World, initWasm, forEachWireRender, svgPathData } from 'cavijs/core'` gets the engine without the page: no custom element registered, no DOM touched. `initWasm(source?)` loads the WASM once (from a URL of your choice if needed), a `World` runs from your own frame loop, `forEachWireRender`/`svgPathData` turn its cables into SVG path data, and `Wire.growTo`/`shrinkTo` with `nodeCountForDistance` keep a cable's length in step with its ends — the pieces to draw cavijs cables as another library's edges.

Details: [doc/en/03-api.md](doc/en/03-api.md#cavijscore-srccoreindexts).

## Debug overlay and events

Drop `<cavi-debug>` next to (or inside) a world for live stats — FPS, wires, nodes, jacks/plugs, physics and view parameters, a per-wire table — and a log of the events the world emits (`cavi-wire-add`, `cavi-plug-attach`, `cavi-cable-end`, …). `mode="floating"` is a draggable window, `mode="panel"` a panel docked to the right edge; `Alt+Shift+D` toggles it.

```html
<cavi-debug for="panel" open></cavi-debug>
```

Details: [doc/en/07-debug.md](doc/en/07-debug.md).

## Building

```bash
pnpm build       # type-check + demo site (dist/, deployed to GitHub Pages)
pnpm build:lib   # library: dist-lib/cavijs.js, dist-lib/core.js (cavijs/core) + dist-lib/types/*.d.ts
pnpm test        # vitest (jsdom + the real cavi WASM module)
pnpm test:e2e    # Playwright: the demos in Chrome, driven with a real mouse
```

The end-to-end tests (`e2e/`) start their own Vite server and use the locally installed Google Chrome, so no browser download is needed. They cover every demo loading and drawing, cable creation/relocation/drop with both interaction controllers, fixed-rate physics on emulated 120 Hz and 30 Hz displays, the held cable, the release throw, sleeping, a world removed and inserted back, and two worlds (one in a shadow root) with the same jack ids.

The WASM engine comes from the `cavi` package; after modifying its Rust code, rebuild it there with `wasm-pack build --target web`.

## Control panels

`<cavi-debug>` is the library's debug panel for any world on the page: live statistics, the event log, and toggles for the debug overlays (see `doc/en/07-debug.md`).

`demo-basic.html` and `demo-svg.html` have their own panel, `<cavi-controls>` (`examples/controls.ts`), with sliders for the physics and buttons to add or clear wires. It is example code: it drives the `Cavi` those demos build by hand, not any world.

## Development

The TypeScript wrapper is designed to be extended. Custom renderers can be created by implementing the `IRenderer` interface:

```typescript
interface IRenderer {
  render(): void;
  stop(): void;
  setDebugDrawNodes(enabled: boolean): void;
  getDebugDrawNodes(): boolean;
  getContainer(): HTMLElement;
  getSurface?(): HTMLElement; // optional, defaults to getContainer()
}
```

The default `Renderer` (canvas) and `SvgRenderer` (SVG) classes both provide complete implementations with:

- Efficient zero-copy WASM memory access
- Wire metadata support (colors and custom properties)
- Built-in animation loop and physics updates
- Mouse interaction visualization
- FPS tracking accessible via `getFPS()`

`SvgRenderer` (see above) is a working example of an alternative `IRenderer` implementation — a reasonable reference for anyone writing a third one (e.g. WebGL).

Wire metadata allows attaching arbitrary rendering information without modifying core WASM code. Colors and other properties set via wire metadata are automatically used during rendering.

## Project Layout

- `src/` — the library itself, nothing else. Organized by concern:
  - `src/core/` — `Cavi`, `World`, `Wire`, `Node`, the WASM loader (`wasm.ts`), the render buffer reader (`render-data.ts`), and the shared `types.ts` (`IRenderer`, `IInteractionController`, `WireMeta`, ...); `index.ts` is the `cavijs/core` entry point
  - `src/renderer/` — `Renderer` (canvas), `SvgRenderer` (SVG), `StandardResizeController`
  - `src/interaction/` — `StandardInteractionController` (pointer), `KeyboardInteractionController` (keyboard)
  - `src/component/` — the custom elements: `<cavi-jack>`, `<cavi-plug>`, `<cavi-wire>`, `<cavi-world>`, `<cavi-interaction>`
  - `src/debug/` — `<cavi-debug>`, statistics and event formatting
  - `src/index.ts` — the public entry point, re-exporting the above
  - `src/tests/` — all `*.test.ts` files
- `examples/` — every demo page and its driving script, kept out of `src/` since none of it is library code. Vite's `root` points here (see `vite.config.ts`), so `npm run dev` serves `examples/index.html` at `/`.

## Demos

The `examples/demo-*.html` pages (built via `vite.config.ts`'s `build.rollupOptions.input`) show the library in different setups:

| Demo                                   | Script                               | Renderer                                | Description                                                                                                           |
| -------------------------------------- | ------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `examples/demo-basic.html`             | `examples/main.ts`                   | `Renderer` (canvas)                     | Minimal setup, a few static wires, with the demos' own control panel (`examples/controls.ts`)                         |
| `examples/demo-svg.html`               | `examples/main-svg.ts`               | `SvgRenderer`                           | Same minimal setup, using the SVG renderer                                                                            |
| `examples/demo-jack-plug.html`         | `examples/example2.ts`               | `Renderer` (canvas, via `<cavi-world>`) | Hand-authored `<cavi-jack>`/`<cavi-wire>` markup                                                                      |
| `examples/demo-noop-interaction.html`  | `examples/exampleNoopInteraction.ts` | `Renderer` (canvas, via `<cavi-world>`) | Custom no-op `IInteractionController` example                                                                         |
| `examples/demo-patchbay.html`          | `examples/example3.ts`               | `Renderer` (canvas, via `<cavi-world>`) | Full modular-synth patchbay: many jacks materialized from CSS layout, pre-patched cables, interactive drag-to-connect |
| `examples/demo-patchbay-svg.html`      | `examples/example3-svg.ts`           | `SvgRenderer`                           | Same patchbay, wired manually to `SvgRenderer` (shares its logic via `examples/patchbay-shared.ts`)                   |
| `examples/demo-patchbay-zoom.html`     | `examples/demo-patchbay-zoom.ts`     | `Renderer` (canvas, via `<cavi-world>`) | Full-screen d3-zoom pan/zoom with CSS-positioned jacks and a draggable module, using `surface`                        |
| `examples/demo-patchbay-zoom-svg.html` | `examples/demo-patchbay-zoom-svg.ts` | `SvgRenderer`                           | Same full-screen zoom demo on the SVG renderer                                                                        |
| `examples/demo-d3-interaction.html`    | `examples/demo-d3-interaction.ts`    | `Renderer` (canvas, via `<cavi-world>`) | Custom `IInteractionController` built on d3-drag, several draggable modules under d3-zoom                             |
| `examples/demo-two-worlds.html`        | `examples/demo-two-worlds.ts`        | `Renderer` (canvas, via `<cavi-world>`) | Two worlds on one page, one inside a shadow root, with the same jack ids                                              |

`examples/index.html` links every demo. Run `npm run dev` and open any of these pages to try them.
