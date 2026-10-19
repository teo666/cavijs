/**
 * cavijs/core — the simulation without the page: the WASM loader, World,
 * Wire and Node, and the render data to draw cables with. No custom
 * element is registered and nothing touches the DOM, on import or after:
 * for code that brings its own rendering and interaction (a graph library's
 * edges, a framework's components, a worker). Everything here is also
 * exported by the main entry, `cavijs`.
 */

export { getWasm, initWasm, isWasmReady } from './wasm';
export { DEFAULT_WIRE_COLORS, World } from './world';
export { Wire, nodeCountForDistance } from './wire';
export type { NodeCountOptions, NodeSpawn } from './wire';
export { Node } from './node';
export {
  RENDER_BEZIER,
  RENDER_SEGMENTS,
  forEachWireRender,
  svgPathData,
  tracePath,
  wirePath,
} from './render-data';
export type { WireRender } from './render-data';
export { IDENTITY_TRANSFORM, screenToWorld, worldToScreen } from './coords';
export type { CoordinateTransform } from './coords';
export type { FrameContext, FrameTask, WorldRect } from './frame';
export type { IRenderer, WireMeta } from './types';
