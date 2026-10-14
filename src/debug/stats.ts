import { Cavi } from '../core/cavi';
import type { CoordinateTransform } from '../core/coords';
import { Jack } from '../component/jack';
import type { Plug } from '../component/plug';

/** One wire, as listed by <cavi-debug>'s wire table. */
export interface WireStats {
  index: number;
  nodes: number;
  radius: number;
  /** Polyline length through the current node positions, in world units. */
  length: number;
  color: string | undefined;
  /** Whether the first/last node is fixed (plugged into a jack, or held). */
  startFixed: boolean;
  endFixed: boolean;
}

/** A snapshot of one Cavi world, as shown by <cavi-debug>. */
export interface CaviStats {
  /** Frames per second reported by the renderer, null if it doesn't report any. */
  fps: number | null;
  wires: number;
  nodes: number;
  minNodes: number;
  maxNodes: number;
  /** Wire terminals (first/last node) that are not fixed — dangling cable ends. */
  freeEnds: number;
  /** Wires with no terminal fixed (see CaviWireElement.isOrphan). */
  orphanWires: number;
  /** Size of the per-frame render buffer shared with WASM. */
  bufferBytes: number;
  jacks: number;
  /** Jacks whose `max-plugs` is reached. */
  fullJacks: number;
  plugs: number;
  pluggedPlugs: number;
  gravity: { x: number; y: number };
  friction: number;
  mouseRadius: number;
  pointerRadius: number;
  responseCoef: number;
  /** Physics steps per second (World.advance). */
  stepRate: number;
  /** Last pointer position in world coordinates, null if the renderer doesn't track it. */
  pointer: { x: number; y: number } | null;
  transform: CoordinateTransform;
  container: { width: number; height: number } | null;
  wireList: WireStats[];
}

/** Optional renderer extras that Renderer and SvgRenderer both provide. */
interface RendererExtras {
  getFPS?: () => number;
  mouseX?: number;
  mouseY?: number;
}

/**
 * Collects a CaviStats snapshot of `cavi`. Reads node positions straight
 * from WASM (no Node wrappers), so it is cheap enough to poll a few times a
 * second; terminal fixed state needs a temporary WasmNode copy, freed
 * right away.
 */
export function collectStats(cavi: Cavi): CaviStats {
  const world = cavi.getWorld();
  const wasm = world.getWasmWorld();
  const renderer = cavi.getRenderer() as (RendererExtras & object) | null;

  const wireList: WireStats[] = [];
  let nodes = 0;
  let minNodes = Infinity;
  let maxNodes = 0;
  let freeEnds = 0;
  let orphanWires = 0;
  for (const wire of world.getWires()) {
    const index = wire.getIndex();
    if (index < 0) continue;
    const count = wasm.get_wire_node_count(index);
    if (count === 0) continue;
    let length = 0;
    let px = wasm.get_wire_node_x(index, 0);
    let py = wasm.get_wire_node_y(index, 0);
    for (let i = 1; i < count; i++) {
      const x = wasm.get_wire_node_x(index, i);
      const y = wasm.get_wire_node_y(index, i);
      length += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    const startFixed = isNodeFixed(cavi, index, 0);
    const endFixed = count > 1 ? isNodeFixed(cavi, index, count - 1) : startFixed;
    if (!startFixed) freeEnds++;
    if (count > 1 && !endFixed) freeEnds++;
    if (!startFixed && !endFixed) orphanWires++;

    nodes += count;
    minNodes = Math.min(minNodes, count);
    maxNodes = Math.max(maxNodes, count);
    wireList.push({
      index,
      nodes: count,
      radius: wasm.get_wire_radius(index),
      length,
      color: wire.getColor(),
      startFixed,
      endFixed,
    });
  }

  const jacks = [...Jack.registry].filter((jack) => Cavi.for(jack) === cavi);
  const plugs = [...document.querySelectorAll<Plug>('cavi-plug')].filter(
    (plug) => Cavi.for(plug) === cavi
  );
  const container = cavi.getContainer();
  const fps = renderer?.getFPS?.();
  const accel = world.getAcceleration();

  return {
    fps: typeof fps === 'number' ? fps : null,
    wires: wireList.length,
    nodes,
    minNodes: wireList.length ? minNodes : 0,
    maxNodes,
    freeEnds,
    orphanWires,
    bufferBytes: wasm.wire_data_len() * Float32Array.BYTES_PER_ELEMENT,
    jacks: jacks.length,
    fullJacks: jacks.filter((jack) => !jack.canAcceptMore()).length,
    plugs: plugs.length,
    pluggedPlugs: plugs.filter((plug) => plug.jack !== null).length,
    gravity: accel,
    friction: wasm.get_friction(),
    mouseRadius: wasm.get_mouse_radius(),
    pointerRadius: wasm.get_pointer_radius(),
    responseCoef: wasm.get_response_coef(),
    stepRate: world.getStepRate(),
    pointer:
      typeof renderer?.mouseX === 'number' && typeof renderer.mouseY === 'number'
        ? { x: renderer.mouseX, y: renderer.mouseY }
        : null,
    transform: cavi.getCoordinateTransform(),
    container: container ? { width: container.clientWidth, height: container.clientHeight } : null,
    wireList,
  };
}

function isNodeFixed(cavi: Cavi, wireIndex: number, nodeIndex: number): boolean {
  // Same temporary-copy read as Node.fixed — WasmWorld has no direct getter.
  const copy = cavi.getWorld().getWasmWorld().get_wire_node(wireIndex, nodeIndex);
  if (!copy) return false;
  const fixed = copy.get_fixed();
  copy.free();
  return fixed;
}
