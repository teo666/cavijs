/**
 * Screen (viewport/DOM pixel) <-> world (logical, physics-space) coordinate
 * conversion. cavijs itself never applies zoom/pan — this is the single,
 * centralized conversion point a consumer's own pan/zoom implementation
 * (e.g. d3-zoom on the <cavi-world> container) plugs into via
 * Cavi.setCoordinateTransformProvider, so every position derived from
 * getBoundingClientRect() (Jack.getWorldPosition in auto-detect mode) is
 * converted back to a stable logical space before reaching the WASM physics
 * engine, regardless of any CSS transform the consumer applies for zoom/pan.
 */
export interface CoordinateTransform {
  /** Uniform zoom factor. 1 = no zoom. */
  scale: number;
  /** Pan offset, in screen px. */
  translateX: number;
  /** Pan offset, in screen px. */
  translateY: number;
}

export const IDENTITY_TRANSFORM: Readonly<CoordinateTransform> = {
  scale: 1,
  translateX: 0,
  translateY: 0,
};

/** Converts a screen-space point (already relative to the untransformed container origin) into world space. */
export function screenToWorld(
  x: number,
  y: number,
  t: CoordinateTransform
): { x: number; y: number } {
  return {
    x: (x - t.translateX) / t.scale,
    y: (y - t.translateY) / t.scale,
  };
}

/** Converts a world-space point into screen space (already relative to the untransformed container origin). */
export function worldToScreen(
  x: number,
  y: number,
  t: CoordinateTransform
): { x: number; y: number } {
  return {
    x: x * t.scale + t.translateX,
    y: y * t.scale + t.translateY,
  };
}

/**
 * Convenience opt-in helper: decomposes `el`'s current computed transform
 * into a {scale, translateX, translateY} CoordinateTransform via DOMMatrix.
 * Only the uniform scale (matrix.a) and translation (matrix.e/f) components
 * are read — rotation/skew are not representable in this model and are
 * silently discarded.
 *
 * cavijs never calls this itself: a consumer names the element explicitly
 * (e.g. `cavi.setCoordinateTransformProvider(() => readTransformFromElement(viewportEl))`)
 * rather than cavijs guessing which ancestor's `transform` is "the" zoom —
 * see Cavi.setCoordinateTransformProvider for why.
 */
export function readTransformFromElement(el: Element): CoordinateTransform {
  const computed = getComputedStyle(el).transform;
  if (!computed || computed === 'none') return { ...IDENTITY_TRANSFORM };
  const matrix = new DOMMatrix(computed);
  return {
    scale: matrix.a || 1,
    translateX: matrix.e,
    translateY: matrix.f,
  };
}

/**
 * The screen-space (viewport px) origin of a world container's *padding
 * box* — the point world coordinate (0, 0) actually renders at.
 *
 * This is the anchor every screen<->world conversion in cavijs goes
 * through, and it is deliberately the padding box rather than the border
 * box getBoundingClientRect() returns: both things world coordinates are
 * expressed against resolve there, not against the border edge —
 * `<cavi-plug>`'s `position: absolute; left/top` (which resolves against
 * its containing block's padding box, per CSSOM View) and the renderer's
 * `#wireCanvas` (`position: absolute; top: 0; left: 0`, same rule). A
 * container with a border would otherwise shift every jack/plug/cable by
 * exactly the border width.
 *
 * Border widths come from `clientLeft`/`clientTop`, which are defined as
 * exactly that in unscaled CSS px and need no `border-style: none`
 * special-casing (unlike `getComputedStyle().borderLeftWidth`), so they're
 * scaled by the current zoom before being added to the already-transformed
 * client rect.
 */
export function containerOrigin(
  container: Element | null | undefined,
  scale: number = 1
): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  return {
    x: rect.left + (container.clientLeft || 0) * scale,
    y: rect.top + (container.clientTop || 0) * scale,
  };
}

/**
 * Converts a raw viewport point (e.g. PointerEvent.clientX/clientY) into
 * world coordinates relative to `container` — the single conversion every
 * pointer-driven position in cavijs goes through.
 *
 * `container` must be the renderer's own container (Cavi.getContainer()),
 * *not* whatever `offsetParent` an individual Jack/Plug happens to have:
 * an intermediate `position: relative` wrapper (a CSS-Grid panel, a
 * draggable module box, ...) becomes the `offsetParent` of some elements
 * and not others, so anchoring on it would put jacks, plugs and the canvas
 * in three different origins — visibly misaligning cables from their jacks
 * as soon as any wrapper is not at the container's own top-left.
 */
export function clientToWorld(
  clientX: number,
  clientY: number,
  container: Element | null | undefined,
  t: CoordinateTransform
): { x: number; y: number } {
  const origin = containerOrigin(container, t.scale);
  return {
    x: (clientX - origin.x) / t.scale,
    y: (clientY - origin.y) / t.scale,
  };
}

/** Inverse of clientToWorld: a world point back to raw viewport coordinates. */
export function worldToClient(
  x: number,
  y: number,
  container: Element | null | undefined,
  t: CoordinateTransform
): { x: number; y: number } {
  const origin = containerOrigin(container, t.scale);
  return {
    x: x * t.scale + origin.x,
    y: y * t.scale + origin.y,
  };
}
