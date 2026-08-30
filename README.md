# Cavijs

cavijs is a wrapper written in typescript that allow to use cavi inside browser without handle directly with cavi.

The main purpose of cavi is to handle cable and mouse interaction, generating as a result spline point to be passed in js, js receive the point and renders wires.

The purpose is to avoid to store render information in the wasm project and let js to handle renderer and keep information about that, this because in that manner is possible to easly extend rendere behavior.

The TS project contain following classes:

- **Cavi** - Main entry point and facade
- **World** - Simulation container
- **Wire** - Individual wire representation
- **Node** - Individual node/point in a wire
- **Socket** - Connection point (future implementation)
- **Jack** - Connector (future implementation)
- **Renderer** - Canvas-based rendering implementation
- **SvgRenderer** - SVG-based rendering implementation, drop-in alternative to Renderer

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
constructor(container: HTMLElement, world: World)
```

Looks up an existing `#wireCanvas` element inside `container` (it does not create one itself — see e.g. `CaviWorldElement`/`<cavi-world>` in `src/component/worldwc.ts`, which creates and sizes the canvas before constructing the renderer).

**Features:**

- Direct WASM memory access for efficient rendering (zero-copy)
- Uses wire metadata for rendering colors (with fallback to default colors)
- Supports both segment and Bezier curve rendering
- Built-in animation loop with FPS tracking
- Mouse interaction visualization (pointer and mouse radii)
- Automatic physics updates in render cycle

**Methods:**

```typescript
render(): void           // Main render method (includes animation loop)
clear(): void            // Clear the canvas
getFPS(): number         // Get current frames per second
drawInteractionRadii(x: number, y: number): void  // Draw mouse interaction zones
stop(): void             // Cancel the animation loop
```

The renderer reads wire colors from metadata and automatically handles the render loop, physics updates, and visualization.

### SvgRenderer

`SvgRenderer` is a drop-in alternative to `Renderer`: it implements the same `IRenderer` interface and renders each wire as an SVG `<path>` (one pooled, updated-in-place element per wire) instead of stroking a `<canvas>`. Anywhere `Renderer` is used, `SvgRenderer` can be substituted without other code changes.

Unlike `Renderer`, it is **self-contained**: its constructor creates its own `<svg id="wireSvg">` inside the given container if one doesn't already exist, and manages its own sizing internally (an internal `ResizeObserver`, no `viewBox` — wire coordinates map 1:1 to SVG user-space pixels, just like the canvas backing store).

**Constructor:**

```typescript
constructor(container: HTMLElement, world: World)
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

## Building

After modifying Rust code:

```bash
wasm-pack build --target web
```

## CaviControls Component

CaviControls is a web component that provides a GUI control panel for the Cavi simulation.

**Features:**

- Real-time statistics display (FPS, wire count, total points, buffer size, mouse position, acceleration)
- Interactive controls for mouse radius, pointer radius, response coefficient, and friction
- Acceleration controls (X and Y axes)
- Per-wire node count adjustment
- Actions: Add random wire, clear all wires, add nodes to specific wires
- Auto-updating stats (refreshes every 100ms)
- Scrollable interface with custom styling

**Usage:**

```typescript
import { CaviControls } from 'cavijs';

// Create and add controls to DOM
const controls = document.createElement('cavi-controls') as CaviControls;
document.body.appendChild(controls);

// Link with Cavi instance
controls.setCavi(cavi);
```

**Statistics Display:**

- **FPS**: Current rendering performance
- **Wires**: Number of wires in simulation
- **Total Points**: Sum of all nodes across all wires
- **Buffer Size**: WASM memory buffer size in KB
- **Mouse X/Y**: Current mouse position
- **Accel X/Y**: Current acceleration values

## Development

The TypeScript wrapper is designed to be extended. Custom renderers can be created by implementing the `IRenderer` interface:

```typescript
interface IRenderer {
  render(): void;
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
  - `src/core/` — `Cavi`, `World`, `Wire`, `Node`, and the shared `types.ts` (`IRenderer`, `IInteractionController`, `WireMeta`, ...)
  - `src/renderer/` — `Renderer` (canvas), `SvgRenderer` (SVG), `StandardResizeController`
  - `src/interaction/` — `StandardInteractionController`
  - `src/component/` — the custom elements: `<cavi-jack>`, `<cavi-plug>`, `<cavi-wire>`, `<cavi-world>`, `<cavi-controls>`, `<cavi-interaction>`
  - `src/index.ts` — the public entry point, re-exporting the above
  - `src/tests/` — all `*.test.ts` files
- `examples/` — every demo page and its driving script, kept out of `src/` since none of it is library code. Vite's `root` points here (see `vite.config.ts`), so `npm run dev` serves `examples/index.html` at `/`.

## Demos

The `examples/demo-*.html` pages (built via `vite.config.ts`'s `build.rollupOptions.input`) show the library in different setups:

| Demo                                  | Script                               | Renderer                                | Description                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/demo-basic.html`            | `examples/main.ts`                   | `Renderer` (canvas)                     | Minimal setup, a few static wires                                                                                                                                                                                   |
| `examples/demo-svg.html`              | `examples/main-svg.ts`               | `SvgRenderer`                           | Same minimal setup, using the SVG renderer                                                                                                                                                                          |
| `examples/demo-jack-plug.html`        | `examples/example2.ts`               | `Renderer` (canvas, via `<cavi-world>`) | Hand-authored `<cavi-jack>`/`<cavi-wire>` markup                                                                                                                                                                    |
| `examples/demo-patchbay.html`         | `examples/example3.ts`               | `Renderer` (canvas, via `<cavi-world>`) | Full modular-synth patchbay: many jacks materialized from CSS layout, pre-patched cables, interactive drag-to-connect                                                                                               |
| `examples/demo-patchbay-svg.html`     | `examples/example3-svg.ts`           | `SvgRenderer`                           | Same patchbay demo, wired manually to `SvgRenderer` instead of `<cavi-world>`'s canvas `Renderer`; shares its jack-materialization/control-wiring logic with `demo-patchbay.html` via `examples/patchbay-shared.ts` |
| `examples/demo-noop-interaction.html` | `examples/exampleNoopInteraction.ts` | `Renderer` (canvas, via `<cavi-world>`) | Custom no-op `IInteractionController` example                                                                                                                                                                       |

Run `npm run dev` and open any of these pages to try them.
