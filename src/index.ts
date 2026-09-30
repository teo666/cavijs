/**
 * Cavijs - TypeScript wrapper for the cavi WASM simulation
 *
 * Main exports for using cavi in the browser. Importing this module also
 * registers every custom element (<cavi-world>, <cavi-jack>, <cavi-wire>,
 * <cavi-plug>, <cavi-interaction>, <cavi-controls>).
 */

export { Cavi } from './core/cavi';
export { World } from './core/world';
export { Wire } from './core/wire';
export { Node } from './core/node';
export {
  IDENTITY_TRANSFORM,
  clientToWorld,
  containerOrigin,
  readTransformFromElement,
  screenToWorld,
  worldToClient,
  worldToScreen,
} from './core/coords';
export type { CoordinateTransform } from './core/coords';
export { Renderer } from './renderer/renderer';
export { SvgRenderer } from './renderer/renderer-svg';
export { StandardResizeController, sizeCanvasToHost } from './renderer/resize';
export { Jack } from './component/jack';
export type { CableSession } from './component/jack';
export { Plug } from './component/plug';
export { CaviWireElement } from './component/wirewc';
export { CaviWorldElement } from './component/worldwc';
export { CaviInteractionElement } from './component/interactionwc';
export { CaviControls } from './component/controls';
export { StandardInteractionController } from './interaction/interaction';
export type {
  IRenderer,
  IInteractionController,
  IResizeController,
  RendererOptions,
  WireMeta,
} from './core/types';
