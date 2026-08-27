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
- **Renderer** - Rendering interface

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

Renderer class is responsible to render wires inside canvas. In each render cycle it uses the WASM buffer and wire metadata instances to determine rendering properties like color.

**Constructor:**
```typescript
constructor(canvas: HTMLCanvasElement, world: World)
```

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
```

The renderer reads wire colors from metadata and automatically handles the render loop, physics updates, and visualization.


## Usage Example

```typescript
import { Cavi, Renderer } from 'cavijs';

// Initialize WASM
await Cavi.initWasm();

// Create instance
const cavi = new Cavi();

// Setup renderer (pass both canvas and world)
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas, cavi.getWorld());
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

The default `Renderer` class provides a complete implementation with:
- Efficient zero-copy WASM memory access
- Wire metadata support (colors and custom properties)
- Built-in animation loop and physics updates
- Mouse interaction visualization
- FPS tracking accessible via `getFPS()`

Wire metadata allows attaching arbitrary rendering information without modifying core WASM code. Colors and other properties set via wire metadata are automatically used during rendering.