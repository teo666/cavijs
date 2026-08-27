# Cavijs — API Reference

TypeScript wrapper around the [`cavi`](../../../cavi/doc/en/03-api.md) WASM engine. Import from `cavijs` (`src/types.ts` re-exports `Node`, `Wire`, `World`, `Cavi`).

## `Cavi` (`src/cavi.ts`)

Main facade class — the recommended entry point.

```typescript
static initWasm(): Promise<void>          // loads the WASM module (sets Cavi.wasm)
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
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement | null
```

`Cavi.wasm: InitOutput` (static) holds the loaded WASM module, including `.memory`, used by `Renderer` for zero-copy buffer access. `Cavi.shared` is a static slot for a shared instance (currently unused by the demo — check before relying on it).

## `World` (`src/world.ts`)

Wraps `WasmWorld`; exposes cable management and global parameters.

```typescript
getWasmWorld(): WasmWorld
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
getWireDataPtr(): number
getWireDataLen(): number
setMouseRadius(radius: number): void
getMouseRadius(): number
setFriction(friction: number): void
getFriction(): number
```

`World`'s constructor sets `response_coef` to `0.0` by default (wire self-collision response disabled unless explicitly enabled). It keeps its own `Wire[]` array in sync with WASM wire indices — `deleteWire` re-creates `Wire` wrappers for every wire after the deleted index, since indices shift, also carrying that old wrapper's metadata (`meta`, e.g. `color`) over onto the new one — since it lives only in JS, never in WASM, it would otherwise silently reset (fixed here, at the `World`/`Wire` level, rather than in `CaviWireElement`/DOM, since it's a plain `World`/`Wire` concern).

> **Careful**: `deleteWire`/`Cavi.deleteWire` only re-create `World`'s own internal `Wire` wrappers. Any `Wire`/`Node` obtained **before** the deletion and held elsewhere (a cache, a closure, etc.) keeps its old index and silently keeps reading/writing the wrong wire once indices shift. `CaviWireElement` (`src/wirewc.ts`) already handles this for declarative and `Jack`-created cables via its own static registry plus a rebind step (`_rebindAfterIndexShift`) run right after every `deleteWire` — see the auto-cleanup section in [`Jack`/`Plug`](./05-jack-plug.md). Anything that calls `deleteWire` outside of `CaviWireElement` (e.g. directly on `World`/`Cavi`) needs to rebind any already-cached references itself.

## `Wire` (`src/wire.ts`)

TypeScript counterpart of a WASM wire. Adds a `meta: WireMeta` dictionary that lives purely in JS (never sent to WASM) for rendering/extension data such as color.

```typescript
addNode(x: number, y: number, fixed?: boolean): void
addNodeAt(index: number, x: number, y: number, fixed?: boolean): void
removeNode(index: number): void
getNodeCount(): number
setNodeCount(count: number): void
getNode(index: number): Node | null
setMetaData(key: string, value: any): void
getMetaData(key: string): any
getAllMetaData(): WireMeta
setColor(color: string): void
getColor(): string | undefined
setRadius(radius: number): void
getRadius(): number
getIndex(): number
```

**Metadata example:**
```typescript
const wire = world.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire.setColor('#ff0000');
wire.setMetaData('thickness', 2);
wire.setMetaData('pattern', 'dashed');
```

A `Wire` constructed without `(world, wireIndex)` args is "detached" — all its methods that talk to WASM become no-ops / return defaults, which is what happens if you `new Wire()` directly instead of via `World.addWire`.

`setNodeCount(count)` resizes the wire at runtime: it rebuilds the entire node vector, preserving the position and `fixed` state of the two terminal nodes and evenly redistributing intermediate nodes between them (any state on previously-existing intermediate nodes is lost). Used by [`Jack`](./05-jack-plug.md) to grow a cable while it's being dragged out of a socket — since the last node's index changes after a resize, anything holding a reference to the terminal node (e.g. a `Plug`) must rebind via `wire.getNode(wire.getNodeCount() - 1)`.

## `Node` (`src/node.ts`)

TypeScript counterpart of a WASM node — a single point in a wire (position, velocity, fixed state).

```typescript
get x(): number      // readonly, sourced live from WASM if bound to a world/wire index
get y(): number
get fixed(): boolean
set fixed(value: boolean)
setPosition(x: number, y: number): void
setMousePosition(x: number, y: number): void   // forwards to World.setMouse
```

A `Node` can be either "live" (constructed with `world`/`wireIndex`/`nodeIndex`, e.g. via `Wire.getNode()`) — in which case `x`/`y` always read fresh from WASM — or a plain data holder (constructed with just `x`/`y`/`fixed`/optional `wasmNode` copy), used e.g. by `Plug` to bind to a specific node.

## `Renderer` (`src/renderer.ts`)

Canvas 2D renderer implementing `IRenderer`.

```typescript
constructor(container: HTMLElement, world: World)
// looks up '#wireCanvas' inside `container` and gets its 2D context

render(): void            // main render method; includes the self-scheduling animation loop
clear(): void
getFPS(): number
drawInteractionRadii(x: number, y: number): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement   // the element passed to the constructor
```

**Features:**
- Direct WASM memory access for efficient rendering (zero-copy `Float32Array` view over `Cavi.wasm.memory.buffer`)
- Reads wire colors from `Wire` metadata, falling back to a default palette (`['#00ff88', '#ff00ff', '#ffaa00']`) by wire index
- Supports both segment (`ctx.lineTo`) and Bezier (`ctx.bezierCurveTo`) rendering, per the `render_type` encoded in the wire data buffer
- Built-in `requestAnimationFrame` loop with FPS tracking (updated once per second)
- Draws mouse/pointer interaction radius indicators (dashed circles) at the current mouse position
- Attaches its own `mousemove` listener on `container`; also drives wire-endpoint dragging (`set_wire_start`/`set_wire_end`) when `draggedWire`/`draggedEndpoint` are set (drag-start/drag-end wiring for this is not present in `Renderer` itself — see `Plug` for the drag interaction model used by the Jack/Plug components)
- Calls `world.update()` internally every frame — callers should **not** also call `Cavi.update()`/`World.update()` per frame if using `Renderer.render()`'s loop
- `setDebugDrawNodes(true)` (global option, defaults to `false`) enables a debug overlay that draws the circumference of every node of every wire (via `Wire.getNode()`, not path-buffer parsing) at its real physical position, with radius equal to `Wire.getRadius()` — useful for checking node positions independently of the rendered path (segments/Bezier)

## `IRenderer` (`src/types.ts`)

```typescript
interface IRenderer {
    render: () => void;
    setDebugDrawNodes: (enabled: boolean) => void;
    getDebugDrawNodes: () => boolean;
    getContainer: () => HTMLElement;
}
```

Implement this to build a custom renderer (e.g. WebGL, SVG) — `Cavi.setRenderer()` / `World.setRenderer()` accept anything satisfying it.

## `CaviControls` (`src/controls.ts`)

A `<cavi-controls>` Web Component providing a debug/tuning GUI panel (Shadow DOM), styled as a dark scrollable card.

```typescript
setCavi(cavi: Cavi): void   // binds the panel to a Cavi instance and starts stats polling
```

**Displays (auto-refreshed every 100ms):** FPS, wire count, total points across all wires, WASM buffer size (KB), mouse X/Y, acceleration X/Y.

**Provides controls for:** mouse radius, pointer radius, response coefficient, friction, acceleration X/Y, per-wire node count, plus actions (add random wire, clear all wires, add nodes to a wire) — see `src/controls.ts` for the exact control IDs/wiring.

```typescript
import { CaviControls } from 'cavijs';

const controls = document.createElement('cavi-controls') as CaviControls;
document.body.appendChild(controls);
controls.setCavi(cavi);
```

## Full usage example

```typescript
import { Cavi, Renderer } from 'cavijs';

await Cavi.initWasm();

const cavi = new Cavi();
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas, cavi.getWorld());
cavi.setRenderer(renderer);

const wire1 = cavi.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire1.setColor('#ff0000');
wire1.setMetaData('label', 'Cable A');

const wire2 = cavi.addWire(100, 200, 500, 200, 25, 15, 8, 1);
wire2.setColor('#00ff00');

cavi.setAcceleration(0, 9.8);

renderer.render(); // starts the internal animation loop
```

## `Jack` / `Plug`

See [Jack & Plug components](./05-jack-plug.md).
