import type { World } from './world';
import type { Wire } from './wire';
import { getWasm } from './wasm';

/** `renderType` of a wire drawn as straight segments (see Wire.setRenderType). */
export const RENDER_SEGMENTS = 0;
/** `renderType` of a wire drawn as a chain of cubic Béziers, the default. */
export const RENDER_BEZIER = 1;

/**
 * One wire's shape as the engine last built it (World.advance), read
 * straight from WASM memory — views, not copies: valid until the next
 * advance(), and to be copied (`.slice()`) to be kept.
 */
export interface WireRender {
  wire: Wire;
  /** The wire's index in its World. */
  index: number;
  /** Half the stroke width. */
  radius: number;
  /** RENDER_SEGMENTS or RENDER_BEZIER. */
  renderType: number;
  /**
   * The points to draw, in world coordinates. RENDER_SEGMENTS: x, y of each
   * point. RENDER_BEZIER: x, y of the start, then cp1x, cp1y, cp2x, cp2y,
   * x, y of each curve. Fewer than 2 values: nothing to draw.
   */
  path: Float32Array;
  /**
   * The wire's whole record in the render buffer, `path` included — equal
   * to last frame's (compare values) means the wire is drawn the same:
   * nothing to redraw.
   */
  record: Float32Array;
}

/**
 * Calls `fn` with the render data of every wire of `world`, in index order
 * — what the renderers draw from, for code drawing cables its own way (an
 * SVG edge of a graph library, a WebGL layer). Reads the buffer built by
 * the last World.advance(): a wire added since isn't in it yet.
 */
export function forEachWireRender(world: World, fn: (wire: WireRender) => void): void {
  const engine = world.getWasmWorld();
  const len = engine.wire_data_len();
  if (len === 0) return;
  const data = new Float32Array(getWasm().memory.buffer, engine.wire_data_ptr(), len);
  const wires = world.getWiresView();
  // Per wire: node count, radius, render type, path length, then the path.
  let offset = 0;
  for (let index = 0; index < wires.length && offset + 4 <= len; index++) {
    const pathLength = data[offset + 3]!;
    const end = offset + 4 + pathLength;
    fn({
      wire: wires[index]!,
      index,
      radius: data[offset + 1]!,
      renderType: data[offset + 2]!,
      path: data.subarray(offset + 4, end),
      record: data.subarray(offset, end),
    });
    offset = end;
  }
}

/**
 * Traces `path` (see WireRender.path) through the moveTo/lineTo/
 * bezierCurveTo of `target` — a CanvasRenderingContext2D, a Path2D, or
 * anything with those three methods. Returns false, tracing nothing, for a
 * path too short to draw.
 */
export function tracePath(
  target: Pick<CanvasPath, 'moveTo' | 'lineTo' | 'bezierCurveTo'>,
  path: Float32Array,
  renderType: number
): boolean {
  if (path.length < 2) return false;
  target.moveTo(path[0]!, path[1]!);
  if (renderType === RENDER_SEGMENTS) {
    for (let i = 2; i + 1 < path.length; i += 2) target.lineTo(path[i]!, path[i + 1]!);
  } else {
    for (let i = 2; i + 5 < path.length; i += 6) {
      target.bezierCurveTo(
        path[i]!,
        path[i + 1]!,
        path[i + 2]!,
        path[i + 3]!,
        path[i + 4]!,
        path[i + 5]!
      );
    }
  }
  return true;
}

/**
 * `path` (see WireRender.path) as SVG path data — the `d` of a `<path>` in
 * world coordinates, '' for a path too short to draw.
 */
export function svgPathData(path: Float32Array, renderType: number): string {
  if (path.length < 2) return '';
  let d = `M ${path[0]!} ${path[1]!}`;
  if (renderType === RENDER_SEGMENTS) {
    for (let i = 2; i + 1 < path.length; i += 2) d += ` L ${path[i]!} ${path[i + 1]!}`;
  } else {
    for (let i = 2; i + 5 < path.length; i += 6) {
      d += ` C ${path[i]!} ${path[i + 1]!}, ${path[i + 2]!} ${path[i + 3]!}, ${path[i + 4]!} ${path[i + 5]!}`;
    }
  }
  return d;
}

/**
 * The SVG path data of one wire as last built (see svgPathData), '' if it
 * isn't in the render buffer. Walks the buffer up to it: to draw many
 * wires, use forEachWireRender once per frame instead.
 */
export function wirePath(world: World, wire: Wire): string {
  const index = world.getWiresView().indexOf(wire);
  let d = '';
  if (index < 0) return d;
  forEachWireRender(world, (render) => {
    if (render.index === index) d = svgPathData(render.path, render.renderType);
  });
  return d;
}
