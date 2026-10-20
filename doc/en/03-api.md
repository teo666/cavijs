# Cavijs — API Reference

TypeScript wrapper around the [`cavi`](../../../cavi/doc/en/03-api.md) WASM engine. Import from `cavijs`: `src/index.ts` exports every class below and registers the custom elements.

## `Cavi` (`src/core/cavi.ts`)

Main facade class — the recommended entry point.

```typescript
static initWasm(): Promise<void>          // loads the WASM module (sets Cavi.wasm)
init(): Promise<void>
getWorld(): World
setRenderer(renderer: IRenderer | null): void  // stops and unregisters the previous one
destroy(): void                         // tears the simulation down for good (see below)
isDestroyed(): boolean
getRenderer(): IRenderer | null
addWire(x1, y1, x2, y2, nodes, tension, radius, type): Wire
deleteWire(wire: Wire | number): void  // by handle (preferred) or current index
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
getWireByIndex(index: number): Wire | null
getWires(): Wire[]
update(): void                          // one physics step — the render loop already steps
setMouse(x: number, y: number): void
releaseMouse(): void
setStepRate(stepsPerSecond: number): void  // default 60
getStepRate(): number
setTimeStep(timeStep: number): void     // simulated time per engine sub-step, default 0.3
setSubsteps(substeps: number): void     // engine sub-steps per step, default 2 (changes speed too)
setConstraintIterations(iterations: number): void  // link relaxation passes per sub-step, default 1 (stiffness only)
setSleepEnabled(enabled: boolean): void  // see World.setSleepEnabled
render(): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement | null
getSurface(): HTMLElement | null        // the renderer's drawing surface (container unless a `surface` was given)
setCoordinateTransformProvider(fn: (() => CoordinateTransform) | null): void
getCoordinateTransform(): CoordinateTransform
notifyCoordinateTransformChanged(): void  // optional: dispatches cavi-transform-change for page code
static for(el: Element): Cavi | null   // the Cavi `el` belongs to
static whenReady(el: Element, fn: (cavi: Cavi) => void): void
```

`Cavi.wasm: InitOutput` (static) holds the loaded WASM module, including `.memory`, used by `Renderer` for zero-copy buffer access. `Cavi.for(el)` returns the `Cavi` an element belongs to — the one whose renderer container (registered by `setRenderer`) is `el` or its nearest ancestor — so several worlds can coexist on one page; it returns `null` inside a `<cavi-world>` that is still initializing, and falls back to `Cavi.shared` (the most recently initialized world, kept for backward compatibility) outside any registered container. `Cavi.whenReady(el, fn)` runs `fn` as soon as that instance exists. See [Zoom, pan and multiple worlds](./06-zoom-multiworld.md).

## `World` (`src/core/world.ts`)

Wraps `WasmWorld`; exposes cable management and global parameters.

```typescript
getWasmWorld(): WasmWorld               // for renderers and parameters: add/remove wires and nodes only through World/Wire
addWire(x1, y1, x2, y2, nodes, tension, radius, renderType): Wire
deleteWire(wire: Wire | number): void  // by handle (preferred) or current index
clearAllWires(): void
setAcceleration(x: number, y: number): void
getAcceleration(): { x: number, y: number }
setRenderer(renderer: IRenderer | null): void  // stops the previous one
destroy(): void
isDestroyed(): boolean
getRenderer(): IRenderer | null
getWireByIndex(index: number): Wire | null
getWires(): Wire[]                      // a copy
getWiresView(): readonly Wire[]         // the live list, no copy: for per-frame readers (renderers)
getWireCount(): number
update(): void                          // exactly one physics step
addFrameTask(task: FrameTask): () => void  // registers per-frame DOM work, returns an unregister function
runFrameTasks(): void                   // runs every task: all reads, then all writes (the renderer calls it)
advance(elapsedMs: number): number      // fixed-rate stepping, returns steps run
setStepRate(stepsPerSecond: number): void
getStepRate(): number
setTimeStep(timeStep: number): void     // simulated time per engine sub-step, default 0.3
setSubsteps(substeps: number): void     // engine sub-steps per step, default 2 (changes speed too)
setConstraintIterations(iterations: number): void  // link relaxation passes per sub-step, default 1 (stiffness only)
holdWire(wire: Wire): void              // the wire being dragged: the mouse leaves it alone
releaseHeldWire(wire?: Wire): void       // only if `wire` is the held one, when given
getHeldWire(): Wire | null
setPointerRadius(radius: number): void   // the held point's reach on the other wires, default 20
setSleepEnabled(enabled: boolean): void  // sleeping of still wires, default true
setSleepThreshold(threshold: number): void  // default 0.01
setSleepSteps(steps: number): void       // default 30
getSleepingWireCount(): number
setMouse(x: number, y: number): void
releaseMouse(): void                    // parks the engine mouse out of reach
getWireDataPtr(): number
getWireDataLen(): number
setMouseRadius(radius: number): void
getMouseRadius(): number
setFriction(friction: number): void
getFriction(): number
```

`World`'s constructor sets `response_coef` to `0.0` by default (wire self-collision response disabled unless explicitly enabled). It keeps its own `Wire[]` array in sync with WASM wire indices: `deleteWire` shifts the index of every later `Wire` handle down **in place** (`Wire._setIndex`) and sets the deleted one to `-1`, turning it into a no-op. Every `Wire`/`Node` reference held anywhere (a `CaviWireElement`, a `CableSession`, a `Plug`'s `Node`) therefore stays valid across deletions — no rebinding needed. `World` also holds the coordinate-transform provider (`setCoordinateTransformProvider`/`getCoordinateTransform`), so a renderer always reads its own world's zoom.

## `Wire` (`src/core/wire.ts`)

TypeScript counterpart of a WASM wire. Adds a `meta: WireMeta` dictionary that lives purely in JS (never sent to WASM) for rendering/extension data such as color.

```typescript
delete(): void                          // deletes this wire from its world, whatever its current index
addNode(x: number, y: number, fixed?: boolean): void
addNodeAt(index: number, x: number, y: number, fixed?: boolean): void
removeNode(index: number): boolean        // false if it would leave fewer than 2 nodes
getNodeCount(): number
setNodeCount(count: number): void
growTo(count: number, spawn?: 'interpolate' | 'stack'): void
shrinkTo(count: number): void
getNode(index: number): Node | null
setMetaData(key: string, value: any): void
getMetaData(key: string): any
getAllMetaData(): WireMeta
setColor(color: string): void
getColor(): string | undefined
setRadius(radius: number): void
getRadius(): number
setRenderType(renderType: number): void  // 0 = segments, 1 = bezier
getRenderType(): number
setLinkDistance(distance: number): void  // rest distance between nodes (setRadius no longer changes it)
getLinkDistance(): number
setBendStiffness(stiffness: number): void   // 0 (default, a chain) to 1
getBendStiffness(): number
setEndDirection(end: 0 | 1, direction: { x: number; y: number } | null): void
getEndDirection(end: 0 | 1): { x: number; y: number } | null
isSleeping(): boolean
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

`setNodeCount(count)` resizes the wire at runtime: it rebuilds the entire node vector, preserving the position and `fixed` state of the two terminal nodes and evenly redistributing intermediate nodes between them (any state on previously-existing intermediate nodes is lost).

`growTo(count, spawn?)` and `shrinkTo(count)` resize it without that: they insert or remove nodes one at a time right before the last node, so every other node keeps its live physics state and the cable doesn't snap straight — how a cable grows while it is pulled out of a jack. New nodes start evenly on the line from the node before the last to the last (`'interpolate'`, default), or on top of the node before the last (`'stack'`). `shrinkTo` never goes below 2 nodes; the cable pulls itself in over the next steps. Size them with `nodeCountForDistance` (see [`cavijs/core`](#cavijscore-srccoreindexts)).

`setBendStiffness(k)` makes the wire resist bending. At 0 (the default) it is a chain of links: hung from a point it drops straight down like a plumb line and folds where the rope runs out. Stiffer, it curves all along, like a real cable. The engine reduces the curvature of every three consecutive nodes by `k` once per constraint iteration, so it adds up with `World.setConstraintIterations` (about `1 − (1 − k)^n`); fixed nodes never move. `setEndDirection(end, { x, y })` gives an end the direction it leaves its anchor by — a plug out of its jack, an edge out of its handle — and, with a bend stiffness, the wire leaves that end along it and curves away gradually (a virtual fixed node behind the end, in the engine). Both wake the wire.

`getNode(index)` returns one handle per node, and the handle follows its node when nodes are inserted or removed before it through this `Wire` (`addNodeAt`, `removeNode`, `setNodeCount`): a `Plug` bound to the terminal stays on the terminal when [`Jack`](./05-jack-plug.md) grows a cable by inserting nodes, or when nodes are added from code. The handle of a removed node (or of an intermediate node dropped by `setNodeCount`) is invalidated: its methods then do nothing. Node edits made directly on the `WasmWorld` (`getWasmWorld()`) bypass this bookkeeping.

### Tearing a world down

`Cavi.destroy()` stops the renderer, frees the WASM world, unregisters the renderer container from `Cavi.for`, and clears `Cavi.shared` if it points at this instance. Every `Wire` and `Node` handle of the world is invalidated, so elements still holding one clean up without touching freed memory. The instance must not be used afterwards (`isDestroyed()` tells). `<cavi-world>` does this by itself when it is removed from the page — not when it is just moved — and builds a new world if it is inserted again later, keeping the coordinate transform registered with `setCoordinateTransform`.

## `cavijs/core` (`src/core/index.ts`)

The simulation without the page: `import { … } from 'cavijs/core'` registers no custom element and touches no DOM, on import or after. For code that brings its own rendering and interaction — a graph library's edges (Vue Flow, React Flow), a framework's components, a worker. Everything in it is also exported by `cavijs`.

| Export                                                                        | What                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initWasm(source?)`, `isWasmReady()`, `getWasm()`                             | Loads the cavi WASM module once per page (later calls share the load; a failed one is forgotten, so the next call retries). `source` — a URL, a `Response`, the bytes or a compiled module — is where the `.wasm` comes from when the bundler doesn't serve it next to `cavi`'s JS (CDN, CSP, a bundler other than Vite). On a page with `<cavi-world>`s, call it before they connect and they share it. `Cavi.initWasm()` is the same load. |
| `World`, `Wire`, `Node`, `DEFAULT_WIRE_COLORS`                                | As above. A `World` needs no renderer: call `advance(elapsedMs)` from your own frame loop.                                                                                                                                                                                                                                                                                                                                                   |
| `nodeCountForDistance(distance, { min, perUnit, max }?)`                      | How many nodes a cable reaching `distance` should have: `min + floor(distance × perUnit)`, at most `max` (defaults 4, 1/30, 60: the rule a cable pulled out of a jack grows by). Pair it with `Wire.growTo`/`shrinkTo`.                                                                                                                                                                                                                      |
| `forEachWireRender(world, fn)`                                                | Calls `fn` with each wire's render data as the last `advance()` built it: `{ wire, index, radius, renderType, path, record }`, views into WASM memory, valid until the next `advance()`. `record` equal to last frame's means the wire looks the same: nothing to redraw.                                                                                                                                                                    |
| `svgPathData(path, renderType)`, `tracePath(target, path, renderType)`        | A `path` as SVG path data (the `d` of a `<path>`, in world coordinates), or traced through the `moveTo`/`lineTo`/`bezierCurveTo` of a canvas context or `Path2D`. Both renderers draw with these.                                                                                                                                                                                                                                            |
| `wirePath(world, wire)`                                                       | One wire's SVG path data. Walks the buffer up to it: for many wires, use `forEachWireRender` once per frame.                                                                                                                                                                                                                                                                                                                                 |
| `RENDER_SEGMENTS`, `RENDER_BEZIER`                                            | The two `renderType`s.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `IDENTITY_TRANSFORM`, `screenToWorld`, `worldToScreen`, `CoordinateTransform` | The pure coordinate math, for mapping a library's viewport (`{ x, y, zoom }` is `{ translateX, translateY, scale }`).                                                                                                                                                                                                                                                                                                                        |

```ts
import { World, initWasm, forEachWireRender, svgPathData } from 'cavijs/core';

await initWasm();
const world = new World();
const wire = world.addWire(0, 0, 200, 0, 8, 20, 5);
let last = performance.now();
requestAnimationFrame(function frame(now) {
  world.advance(now - last);
  last = now;
  forEachWireRender(world, ({ index, path, renderType }) => {
    pathEls[index].setAttribute('d', svgPathData(path, renderType));
  });
  requestAnimationFrame(frame);
});
```

`World` reads the page only to measure the view for its frame tasks (orphan cleanup), and only with a renderer set: never with `cavijs/core` alone.

## `Node` (`src/core/node.ts`)

TypeScript counterpart of a WASM node — a single point in a wire (position, velocity, fixed state).

```typescript
get x(): number      // readonly, sourced live from WASM if bound to a world/wire index
get y(): number
get fixed(): boolean
set fixed(value: boolean)
setPosition(x: number, y: number): void
setMousePosition(x: number, y: number): void   // forwards to World.setMouse
```

A `Node` is either "live" (constructed with `world`/`wire`/`nodeIndex`, as `Wire.getNode()` does) — `x`/`y`/`fixed` are then always read fresh from WASM through its `Wire`, so it follows the wire's index if an earlier wire is deleted — or a plain data holder (constructed with just `x`/`y`/`fixed`), used e.g. by tests. `Wire.getNode(index)` returns `null` for an out-of-range index.

## `Renderer` (`src/renderer/renderer.ts`)

Canvas 2D renderer implementing `IRenderer`.

```typescript
constructor(container: HTMLElement, world: World, options?: RendererOptions & { canvas?: HTMLCanvasElement })
// uses options.canvas (any canvas, anywhere: its on-screen placement is measured every
// frame), else '#wireCanvas' in the host (options.surface, else container),
// creating one if missing

render(): void            // main render method; includes the self-scheduling animation loop
clear(): void
getFPS(): number
drawInteractionRadii(x: number, y: number): void
setDebugDrawNodes(enabled: boolean): void
getDebugDrawNodes(): boolean
getContainer(): HTMLElement   // the element passed to the constructor (world origin)
getSurface(): HTMLElement     // options.surface, else the container
stop(): void                  // stops the loop, removes the pointer listener, clears the canvas
```

**Features:**

- Direct WASM memory access for efficient rendering (zero-copy `Float32Array` view over `Cavi.wasm.memory.buffer`)
- Reads wire colors from `Wire` metadata. `World.addWire` gives every new wire a color from `DEFAULT_WIRE_COLORS` (`['#00ff88', '#ff00ff', '#ffaa00']`, in creation order), so deleting a wire never recolors the others
- Supports both segment (`ctx.lineTo`) and Bezier (`ctx.bezierCurveTo`) rendering, per the `render_type` encoded in the wire data buffer
- Built-in `requestAnimationFrame` loop with FPS tracking (updated once per second)
- Draws mouse/pointer interaction radius indicators (dashed circles) at the current mouse position
- Listens for pointer events on the document while running (removed by `stop()`) and feeds the physics mouse position in world coordinates, through the same zoom-aware `clientToWorld` used everywhere else (`PointerTracker`, `src/renderer/pointer.ts`). Whenever no pointer hovers the surface — it left the surface or the window, or a touch ended — the engine mouse is parked out of reach (`World.releaseMouse`), since the engine applies it to every cable on every step
- `render()` is idempotent (a second call does not start a second loop) and can be called again after `stop()`
- HiDPI: the canvas backing store is `devicePixelRatio` times its CSS size (see `sizeCanvasToHost`), and the renderer scales its drawing accordingly
- `options.surface`: see [Zoom, pan and multiple worlds](./06-zoom-multiworld.md) — the canvas lives on an untransformed element and the renderer applies the registered zoom itself, so cables are never clipped to the container's box
- Steps the physics with `world.advance(elapsed)` every frame: a fixed `getStepRate()` steps per second (default 60) whatever the display's refresh rate, so cables move at the same speed on 60, 120 or 144 Hz screens. Long gaps (a background tab) are not replayed. Callers should **not** also call `Cavi.update()`/`World.update()` per frame if using `Renderer.render()`'s loop
- `setDebugDrawNodes(true)` (global option, defaults to `false`) enables a debug overlay that draws the circumference of every node of every wire (read straight from WASM, not by parsing the path buffer) at its real physical position, with radius equal to `Wire.getRadius()` — useful for checking node positions independently of the rendered path (segments/Bezier)

## `IRenderer` (`src/core/types.ts`)

```typescript
interface IRenderer {
  render: () => void;
  setDebugDrawNodes: (enabled: boolean) => void;
  getDebugDrawNodes: () => boolean;
  getContainer: () => HTMLElement;
  getSurface?: () => HTMLElement; // optional: defaults to getContainer()
  stop: () => void;
}
```

Implement this to build a custom renderer (e.g. WebGL, SVG) — `Cavi.setRenderer()` / `World.setRenderer()` accept anything satisfying it.

## `IInteractionController` (`src/core/types.ts`)

```typescript
interface IInteractionController {
  attach: (cavi: Cavi) => void;
  detach: () => void;
}
```

Contract for anything that drives user interaction (drag, click, touch...) with `Jack`/`Plug` — pluggable the same way as `IRenderer`. See [Jack & Plug Components](./05-jack-plug.md#interaction-standardinteractioncontroller-and-cavi-interaction) for the standard implementations (`StandardInteractionController` for the pointer, `KeyboardInteractionController` for the keyboard), and how `<cavi-interaction>` attaches a list of them (`controllers`, `no-keyboard`).

## `SvgRenderer` (`src/renderer/renderer-svg.ts`)

A drop-in alternative to `Renderer` implementing the same `IRenderer`: each wire is an SVG `<path>`, kept from frame to frame and rewritten only when the cable moved or changed. It creates its own `<svg>` inside the container (or uses `options.svg`), and supports `options.surface` like `Renderer` (see [Zoom, pan and multiple worlds](./06-zoom-multiworld.md)). `<cavi-world>` always uses the canvas `Renderer`, so `SvgRenderer` is set up by hand (see `examples/main-svg.ts`).

```typescript
constructor(container: HTMLElement, world: World, options?: RendererOptions & { svg?: SVGSVGElement })
```

## `<cavi-debug>` (`src/debug/debugwc.ts`)

A debug panel for any world on the page: live statistics, the event log, and toggles for the debug overlays. See [Debugging and events](./07-debug.md).

The demo pages `demo-basic.html` and `demo-svg.html` use their own control panel, `<cavi-controls>` (`examples/controls.ts`). It is example code, not part of the library.

## Full usage example

```typescript
import { Cavi, Renderer } from 'cavijs';

await Cavi.initWasm();

const cavi = new Cavi();
const container = document.getElementById('container') as HTMLElement;
const renderer = new Renderer(container, cavi.getWorld()); // creates #wireCanvas if missing
cavi.setRenderer(renderer);

const wire1 = cavi.addWire(100, 100, 500, 100, 20, 10, 5, 1);
wire1.setColor('#ff0000');
wire1.setMetaData('label', 'Cable A');

const wire2 = cavi.addWire(100, 200, 500, 200, 25, 15, 8, 1);
wire2.setColor('#00ff00');

cavi.setAcceleration(0, 9.8);

renderer.render(); // starts the internal animation loop
```

## `<cavi-world>` attributes

The settings attributes are live: changing one later applies it to the running world, and removing one restores its default.

| Attribute                | Default       | Description                                                                                                 |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `gravity-x`, `gravity-y` | `0`, `5`      | Global acceleration                                                                                         |
| `step-rate`              | `60`          | Physics steps per second, whatever the display's frame rate                                                 |
| `sleep`                  | on            | `off` keeps simulating cables at rest instead of putting them to sleep                                      |
| `orphan-cleanup`         | on            | `off` keeps cables with no fixed end even once out of view                                                  |
| `cable-drop-behavior`    | `detach`      | A new cable dropped in empty space: `detach` (falls away), `dangle` (stays on its jack), `cancel` (removed) |
| `plug-spread-mode`       | `towardOther` | How a jack's plugs fan out on hover: `towardOther` or `radial`                                              |
| `plug-spread-radius`     | `1.8`         | How far they fan out, in jack half-sizes                                                                    |
| `plug-spread-timeout`    | `500`         | Ms before they close again once the pointer leaves                                                          |
| `debug-nodes`            | absent        | Draws every node and the pointer radii                                                                      |
| `wire-shadows`           | absent        | Soft shadow under every cable (canvas renderer)                                                             |

Read only when the world is set up:

| Attribute              | Description                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `surface="<selector>"` | An untransformed ancestor to draw on, for pan/zoom — see [Zoom, pan and multiple worlds](./06-zoom-multiworld.md) |
| `canvas="<selector>"`  | A canvas of your own to draw into                                                                                 |
| `no-interaction`       | No default `<cavi-interaction>`: nothing reacts to the pointer or keyboard unless you add a controller            |

## `<cavi-wire>` attributes

All live: changing one updates the running cable.

| Attribute     | Default   | Description                                                                                                   |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `length`      | `10`      | Node count (changing it redistributes the nodes between the two ends)                                         |
| `tension`     | `20`      | Rest distance between neighbouring nodes                                                                      |
| `size`        | `5`       | Radius (half the thickness)                                                                                   |
| `color`       | `#ffffff` | Stroke color                                                                                                  |
| `type`        | `''`      | Connection type, given to its plugs; empty is a wildcard                                                      |
| `render-type` | bezier    | `segments` for straight segments (the old `renderType` spelling still works)                                  |
| `bend`        | `0`       | Bend stiffness, 0 to 1 (see `Wire.setBendStiffness`): stiffer curves smoothly instead of hanging like a chain |

`id` is not live but always there: a `<cavi-wire>` without one gets one generated when connected (see [Saving and restoring cables](#saving-and-restoring-cables)).

## Saving and restoring cables

`captureCables(cavi)` and `applyCables(cavi, snapshot)` (`src/component/cables.ts`) read the cables of one world as plain data and put them back. The data is safe to `JSON.stringify`, for saving a configuration or keeping an undo history:

```json
{
  "version": 1,
  "wires": [
    { "id": "w-3", "ends": ["out-1", "in-4"], "type": "audio", "color": "#ffaa00", "length": 14 },
    { "id": "w-4", "ends": ["out-2", null], "type": "audio", "length": 9 }
  ]
}
```

- **What is saved:** for each `<cavi-wire>` in the world's container, its `id`, the ids of the jacks its first and last node are plugged into (`null` for a free end), and the attributes it has set among `type`, `color`, `length`, `tension`, `size` and `render-type` (as `renderType`). The physics state is not saved: a restored cable starts straight between its jacks and settles on its own.
- **What is left out:** a cable plugged into nothing (it is falling away, see orphan cleanup), and an end in a jack without an `id`, which could not be found again. An end in a jack removed from the page is free already, even before the jack lets its plugs go.
- **Jacks are not saved.** They belong to the page: put them back first, with the same ids. An end whose jack isn't on the page is left free; a cable with neither jack there is not restored.
- **`applyCables` touches only what differs**, cable by cable, by `id`: a cable the world has and the snapshot doesn't is deleted (`CaviWireElement.delete()`, so its jacks are free right away); one both have keeps its live physics state, gets its attributes updated and only the ends that changed jack moved (`Plug.disconnect`/`connect`); a missing one is created in the container. Every end that leaves a jack is pulled out before anything is plugged in, so cables can trade jacks at `max-plugs`. An end that can't be plugged in (full, wrong type) is left free with a `console.warn`.
- It throws on anything but a version 1 snapshot, and on a `Cavi` without a renderer container. Call it between gestures: a plug being dragged stays where it is.

```ts
const cavi = worldEl.getCavi()!;
localStorage.setItem('cables', JSON.stringify(captureCables(cavi)));
// later, once the jacks are back on the page:
applyCables(cavi, JSON.parse(localStorage.getItem('cables')!));
```

## Undo and redo: `CaviHistory`

`CaviHistory` (`src/component/history.ts`) keeps undo/redo steps for one world. Each step (`HistoryEntry`) is the cables as `captureCables` reads them plus, optionally, the page's own state:

```ts
const history = new CaviHistory(worldEl.getCavi()!, {
  // optional: what cavijs doesn't own and the cables depend on
  app: {
    capture: () => app.getModules(), // JSON-safe
    restore: async (modules) => app.setModules(modules), // jacks back, same ids
  },
  limit: 100, // most undo steps kept (default)
});

history.commit(); // after a change of the page's own
history.batch(() => app.removeModule(m)); // several changes, one step
await history.undo();
await history.redo();
history.canUndo; // also canRedo
history.addEventListener('change', updateButtons);
localStorage.setItem('state', JSON.stringify(history.capture()));
await history.load(JSON.parse(localStorage.getItem('state')!));
```

- **When a step is recorded:** at the end of every user gesture on the cables (`cavi-change`), by itself, and whenever the page calls `commit()`. Never twice the same state: a gesture that changed nothing (a plug put back where it was) records nothing. Cables are compared regardless of their order in the page. A gesture's step is recorded a microtask after `cavi-change`, once no other gesture is in progress in the world (`Jack.isDragActive`): with two fingers, the step is the state both leave.
- **Undo, redo and load put a state back in order:** `app.restore` first, awaited, then `applyCables`, which only touches the cables that differ — so the cables find their jacks on the page. A change not recorded yet is recorded first, so it is what `undo()` undoes. Once a state is back, its entry becomes what restoring it left on the page (the page's state read back, an end whose jack didn't come back as free), so that difference never counts as a new step.
- **They refuse (resolve to `false`) while a gesture is in progress** in the world: the controller owns that one, Escape cancels it. Calls run one after the other, so pressing Ctrl+Z three times quickly undoes three steps.
- **The page's state is stored as JSON:** later changes to the object `capture` returned don't reach the history, and `restore` always gets a fresh copy.
- **`batch(fn)`** records everything `fn` does as one step, folding in `commit()` calls and gestures ending meanwhile; for an `fn` returning a promise it returns a promise and records once it settles. Removing a module is the typical case: its jacks go, and the cable ends in them are let go — `captureCables` already counts an end in a removed jack as free.
- **`load(entry)`** puts back a state from `capture()` — saved earlier, maybe in another visit — as a new step, undoable like any other. **`clear()`** forgets every step; **`destroy()`** stops listening to the world.
- **`change`** (a plain `Event`) is dispatched whenever `canUndo`/`canRedo` may have changed.

Create it once the world is ready (`caviready`): the state at that moment is the first step. `examples/demo-d3-interaction.ts` (`bindHistory`) uses it with the units' positions as the page's state, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, and Save/Load buttons.

## `Jack` / `Plug`

See [Jack & Plug components](./05-jack-plug.md).
