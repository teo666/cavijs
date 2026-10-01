import type { Cavi } from './cavi';

export interface IRenderer {
  render: () => void;
  setDebugDrawNodes: (enabled: boolean) => void;
  getDebugDrawNodes: () => boolean;
  /**
   * Soft cast shadow under every wire. Optional: renderers that can't draw
   * one (e.g. SvgRenderer) simply leave it out.
   */
  setWireShadows?: (enabled: boolean) => void;
  getWireShadows?: () => boolean;
  getContainer: () => HTMLElement;
  /**
   * The element the drawing surface (canvas/svg) is sized to and clipped
   * by. Defaults to getContainer(). Differs from it only when the renderer
   * was given a `surface` (see RendererOptions): an untransformed ancestor
   * the drawing lives in, so a consumer's pan/zoom never clips cables to
   * the container's own box. Optional for backward compatibility with
   * custom renderers written before it existed.
   */
  getSurface?: () => HTMLElement;
  stop: () => void;
}

/** Options shared by Renderer and SvgRenderer. */
export interface RendererOptions {
  /**
   * An element *outside* the pan/zoom-transformed subtree (typically the
   * fixed-size frame the consumer's zoom listens on) to host the drawing
   * surface. When set, the canvas/svg is placed in it, sized to it, and the
   * renderer itself maps world coordinates through the registered
   * CoordinateTransform (Cavi.setCoordinateTransformProvider) — instead of
   * living inside the world container and being CSS-scaled with it, which
   * clips every cable to the container's box (visible as soon as you zoom
   * out) and blurs the canvas raster when zooming in.
   *
   * The surface should be positioned (worldwc sets `position: relative` on
   * it if it is `static`), and the world content drawn over the surface
   * should not have an opaque background, since cables are drawn beneath it.
   */
  surface?: HTMLElement;
}

/**
 * Contract for anything that drives user interaction (drag, click, touch...)
 * with Jack/Plug — pluggable the same way IRenderer is: `attach` wires up
 * whatever listeners this implementation needs against the given Cavi
 * instance (and, transitively, the live Jack/Plug registries), `detach`
 * tears them down. Jack/Plug themselves stay pure domain/data elements and
 * never assume any particular controller is attached — see
 * StandardInteractionController (src/interaction.ts) for the default
 * pointer/mouse/touch implementation, and <cavi-interaction>
 * (src/interactionwc.ts) for how it's wired up declaratively.
 */
export interface IInteractionController {
  attach: (cavi: Cavi) => void;
  detach: () => void;
}

/**
 * Contract for anything that keeps a <cavi-world>'s canvas backing store
 * sized to its container and announces layout changes — pluggable the same
 * way IInteractionController is: `attach` starts watching `container` (and
 * sizes `canvas` to match it), `detach` tears that down. See
 * StandardResizeController (src/resize.ts) for the default ResizeObserver
 * implementation, and CaviWorldElement (src/worldwc.ts) for how it's wired
 * up by default.
 */
export interface IResizeController {
  /**
   * `surface`, when given, is what `canvas` gets sized to instead of
   * `container` (see RendererOptions.surface) — `cavi-resize` is still
   * announced on `container`. Renderer additionally re-checks the canvas
   * size at the start of every frame (see sizeCanvasToHost), so a resize
   * never blanks a frame that was already drawn.
   */
  attach: (container: HTMLElement, canvas: HTMLCanvasElement, surface?: HTMLElement) => void;
  detach: () => void;
}

export interface WireMeta {
  [key: string]: any;
  color?: string;
}

export { Node } from './node';
export { Wire } from './wire';
export { World } from './world';
export { Cavi } from './cavi';
